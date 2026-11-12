-- Admin-Bereich: KI-Urteile prüfen, freigegebene Antworten für alle Spieler.
--
-- Rechte-Modell (RLS überall, Rechte ausdrücklich vergeben):
--   admins            nur der eigene Eintrag lesbar (für "bin ich Admin?"), sonst nichts
--   ai_verdicts       Admins: lesen; Änderungen nur über die Funktionen unten
--   approved_answers  alle lesen; schreiben nur Admins
--   submissions       Admins lesen zusätzlich alles (Häufigkeiten)
--   app_meta          alle lesen (Revisionszähler), schreiben nur Trigger
-- Die Funktionen laufen als SECURITY INVOKER: RLS gilt also auch dort, und
-- zusätzlich prüfen sie is_admin() ausdrücklich.

-- ---------------------------------------------------------------- admins

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create policy "Eigenen Admin-Eintrag sehen"
  on public.admins for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.admins from anon, authenticated;
grant select on table public.admins to authenticated;
grant all on table public.admins to service_role;

-- SECURITY DEFINER, damit Policies anderer Tabellen sie nutzen können, ohne
-- dass admins selbst lesbar sein muss. Fester search_path gegen Umleitung.
create function public.is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------- ai_verdicts: Prüfstatus

alter table public.ai_verdicts
  add column ai_valid boolean,
  add column review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users (id) on delete set null;

-- ai_valid = ursprüngliches KI-Urteil (bleibt, auch wenn ich später anders entscheide)
update public.ai_verdicts set ai_valid = valid;
alter table public.ai_verdicts alter column ai_valid set not null;

create index ai_verdicts_review_idx on public.ai_verdicts (review_status, created_at desc);

create policy "Admins lesen KI-Urteile"
  on public.ai_verdicts for select to authenticated
  using ((select public.is_admin()));

create policy "Admins prüfen KI-Urteile"
  on public.ai_verdicts for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select on table public.ai_verdicts to authenticated;
grant update (valid, review_status, reviewed_at, reviewed_by) on table public.ai_verdicts to authenticated;

-- ---------------------------------------------------------------- submissions: normalisierte Antwort

alter table public.submissions add column normalized_answer text check (char_length(normalized_answer) <= 100);
create index submissions_norm_idx on public.submissions (question_id, normalized_answer);

create policy "Admins lesen alle Antworten"
  on public.submissions for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------- approved_answers

create table public.approved_answers (
  id uuid primary key default gen_random_uuid(),
  question_id text not null,
  text text not null check (char_length(text) between 1 and 80),
  aliases text[] not null default '{}',
  base_score smallint not null check (base_score between 0 and 100),
  -- gesetzt: Variante dieser Listen-Antwort (zählt wie sie), sonst eigene Antwort
  merged_into text check (char_length(merged_into) <= 100),
  verdict_id uuid unique references public.ai_verdicts (id) on delete set null,
  exported_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index approved_answers_question_idx on public.approved_answers (question_id);
alter table public.approved_answers enable row level security;

create policy "Alle lesen freigegebene Antworten"
  on public.approved_answers for select to anon, authenticated
  using (true);

create policy "Admins schreiben freigegebene Antworten"
  on public.approved_answers for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.approved_answers from anon, authenticated;
grant select on table public.approved_answers to anon, authenticated;
grant insert, update, delete on table public.approved_answers to authenticated;
grant all on table public.approved_answers to service_role;

-- ---------------------------------------------------------------- app_meta: Revisionszähler

-- Steigt bei jeder Prüf-Entscheidung. Die App vergleicht ihn beim Start und
-- verwirft dann ihren lokalen KI-Cache (z. B. für inzwischen abgelehnte Antworten).
create table public.app_meta (
  key text primary key,
  value bigint not null default 0
);
insert into public.app_meta (key, value) values ('review_revision', 0);
alter table public.app_meta enable row level security;
create policy "Alle lesen app_meta" on public.app_meta for select to anon, authenticated using (true);
revoke all on table public.app_meta from anon, authenticated;
grant select on table public.app_meta to anon, authenticated;
grant all on table public.app_meta to service_role;

create function public.bump_review_revision() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.app_meta set value = value + 1 where key = 'review_revision';
  return null;
end;
$$;
revoke all on function public.bump_review_revision() from public, anon, authenticated;

create trigger ai_verdicts_review_revision
  after update of review_status, valid on public.ai_verdicts
  for each statement execute function public.bump_review_revision();
create trigger approved_answers_revision
  after insert or update or delete on public.approved_answers
  for each statement execute function public.bump_review_revision();

-- ---------------------------------------------------------------- Übersicht für den Admin-Bereich

-- security_invoker: RLS der Basistabellen gilt – Nicht-Admins sehen hier nichts.
create view public.admin_verdicts with (security_invoker = true) as
select
  v.id,
  v.question_id,
  split_part(v.question_id, '-', 1) as lang,
  split_part(v.question_id, '-', 2) as topic,
  v.normalized_answer,
  v.canonical_text,
  v.list_answer,
  v.estimated_base_score,
  v.reason,
  v.model,
  v.valid,
  v.ai_valid,
  v.review_status,
  v.reviewed_at,
  v.created_at,
  (select count(*) from public.submissions s where s.question_id = v.question_id and s.normalized_answer = v.normalized_answer) as plays,
  (select s.raw_answer from public.submissions s where s.question_id = v.question_id and s.normalized_answer = v.normalized_answer order by s.created_at desc limit 1) as raw_answer,
  a.id as approved_id,
  a.text as approved_text,
  a.aliases as approved_aliases,
  a.base_score as approved_base_score,
  a.merged_into as approved_merged_into
from public.ai_verdicts v
left join public.approved_answers a on a.verdict_id = v.id;

revoke all on table public.admin_verdicts from anon, authenticated;
grant select on table public.admin_verdicts to authenticated;

-- ---------------------------------------------------------------- Aktionen (RPC)

-- Freigeben bzw. als Variante einer Listen-Antwort zusammenführen.
create function public.approve_verdict(
  p_verdict uuid,
  p_text text,
  p_aliases text[] default '{}',
  p_base_score integer default null,
  p_merged_into text default null
) returns uuid
  language plpgsql security invoker set search_path = ''
as $$
declare
  v public.ai_verdicts;
  result uuid;
begin
  if not public.is_admin() then
    raise exception 'nur für Admins' using errcode = '42501';
  end if;
  select * into v from public.ai_verdicts where id = p_verdict for update;
  if not found then
    raise exception 'Urteil % nicht gefunden', p_verdict;
  end if;

  insert into public.approved_answers (question_id, text, aliases, base_score, merged_into, verdict_id, created_by)
  values (
    v.question_id,
    btrim(p_text),
    coalesce((select array_agg(distinct btrim(x)) from unnest(p_aliases) x where btrim(x) <> ''), '{}'),
    greatest(0, least(100, coalesce(p_base_score, v.estimated_base_score, 1))),
    nullif(btrim(p_merged_into), ''),
    v.id,
    (select auth.uid())
  )
  on conflict (verdict_id) do update set
    text = excluded.text,
    aliases = excluded.aliases,
    base_score = excluded.base_score,
    merged_into = excluded.merged_into,
    exported_at = null
  returning id into result;

  update public.ai_verdicts
  set valid = true, review_status = 'approved', reviewed_at = now(), reviewed_by = (select auth.uid())
  where id = p_verdict;
  return result;
end;
$$;

-- Ablehnen: Urteil wird ungültig (auch im Cache der Edge Function), Freigabe entfällt.
create function public.reject_verdicts(p_ids uuid[]) returns integer
  language plpgsql security invoker set search_path = ''
as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'nur für Admins' using errcode = '42501';
  end if;
  delete from public.approved_answers where verdict_id = any (p_ids);
  update public.ai_verdicts
  set valid = false, review_status = 'rejected', reviewed_at = now(), reviewed_by = (select auth.uid())
  where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Zurück auf "offen" (z. B. versehentlich entschieden).
create function public.reset_verdicts(p_ids uuid[]) returns integer
  language plpgsql security invoker set search_path = ''
as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'nur für Admins' using errcode = '42501';
  end if;
  delete from public.approved_answers where verdict_id = any (p_ids);
  update public.ai_verdicts
  set valid = ai_valid, review_status = 'pending', reviewed_at = null, reviewed_by = null
  where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.approve_verdict(uuid, text, text[], integer, text) from public, anon;
revoke all on function public.reject_verdicts(uuid[]) from public, anon;
revoke all on function public.reset_verdicts(uuid[]) from public, anon;
grant execute on function public.approve_verdict(uuid, text, text[], integer, text) to authenticated;
grant execute on function public.reject_verdicts(uuid[]) to authenticated;
grant execute on function public.reset_verdicts(uuid[]) to authenticated;
