-- Admin-Dashboard: Debug-Runden, Sperren, Admin-Protokoll, Kennzahlen.
--
-- 1. submissions.is_debug: Runden aus dem Admin-Debug-Modus. Zählen nirgends (Häufigkeiten,
--    Spielerzahlen, spätere Bestenlisten). Nur Admins dürfen sie anlegen; normale Runden
--    müssen auf „heute“ (Europe/Berlin, ±1 Tag Toleranz) fallen – kein Vor-/Zurückdatieren.
-- 2. player_bans: gesperrte Spieler speichern keine Antworten, bekommen keine KI-Prüfung
--    (Edge Function) und können ihr Profil nicht ändern.
-- 3. admin_log: jede Admin-Aktion (Freigaben, Sperren, Namen) wird protokolliert.
-- 4. admin_* Funktionen: SECURITY DEFINER mit is_admin()-Prüfung – Nicht-Admins bekommen 42501.

-- ---------------------------------------------------------------- 1. Debug-Runden

alter table public.submissions add column is_debug boolean not null default false;
create index submissions_created_idx on public.submissions (created_at desc);

create function public.berlin_today() returns date
  language sql stable set search_path = ''
as $$ select (now() at time zone 'Europe/Berlin')::date $$;

create function public.check_submission() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_debug then
    if not public.is_admin() then
      raise exception 'Debug-Runden nur für Admins' using errcode = '42501';
    end if;
  elsif new.day not between public.berlin_today() - 1 and public.berlin_today() + 1 then
    raise exception 'Spieltag liegt nicht heute' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.check_submission() from public, anon, authenticated;
create trigger submissions_check before insert on public.submissions
  for each row execute function public.check_submission();

-- Häufigkeiten in der Prüfliste ohne Debug-Runden
create or replace view public.admin_verdicts with (security_invoker = true) as
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
  v.unchecked_reason,
  v.reviewed_at,
  v.created_at,
  (select count(*) from public.submissions s where s.question_id = v.question_id and s.normalized_answer = v.normalized_answer and not s.is_debug) as plays,
  (select count(*) from public.submissions s where s.question_id = v.question_id and s.normalized_answer = v.normalized_answer and s.is_practice and not s.is_debug) as practice_plays,
  (select s.raw_answer from public.submissions s where s.question_id = v.question_id and s.normalized_answer = v.normalized_answer order by s.created_at desc limit 1) as raw_answer,
  a.id as approved_id,
  a.text as approved_text,
  a.aliases as approved_aliases,
  a.base_score as approved_base_score,
  a.merged_into as approved_merged_into
from public.ai_verdicts v
left join public.approved_answers a on a.verdict_id = v.id;

-- ---------------------------------------------------------------- 2. Sperren

create table public.player_bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text check (char_length(reason) <= 200),
  banned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.player_bans enable row level security;
-- keine Policies: nur über admin_set_ban / is_banned / service_role
revoke all on table public.player_bans from anon, authenticated;
grant all on table public.player_bans to service_role;

create function public.is_banned(p_user uuid default auth.uid()) returns boolean
  language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.player_bans where user_id = p_user) $$;
revoke all on function public.is_banned(uuid) from public, anon;
grant execute on function public.is_banned(uuid) to authenticated, service_role;

drop policy "Spieler speichern eigene Antworten" on public.submissions;
create policy "Spieler speichern eigene Antworten"
  on public.submissions for insert to authenticated
  with check ((select auth.uid()) = user_id and not (select public.is_banned()));

drop policy "Eigenes Profil anlegen" on public.profiles;
drop policy "Eigenes Profil ändern" on public.profiles;
create policy "Eigenes Profil anlegen" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id and not (select public.is_banned()));
create policy "Eigenes Profil ändern" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and not (select public.is_banned()));

-- ---------------------------------------------------------------- 3. Admin-Protokoll

create table public.admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index admin_log_created_idx on public.admin_log (created_at desc);
alter table public.admin_log enable row level security;
create policy "Admins lesen das Protokoll" on public.admin_log for select to authenticated using ((select public.is_admin()));
revoke all on table public.admin_log from anon, authenticated;
grant select on table public.admin_log to authenticated;
grant all on table public.admin_log to service_role;

create function public.log_admin(p_action text, p_target text, p_detail jsonb default null) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'nur für Admins' using errcode = '42501';
  end if;
  insert into public.admin_log (admin_id, action, target, detail) values (auth.uid(), p_action, p_target, p_detail);
end;
$$;
revoke all on function public.log_admin(text, text, jsonb) from public, anon;
-- prüft selbst is_admin(); wird aus SECURITY-INVOKER-Funktionen (reject_verdicts) aufgerufen
grant execute on function public.log_admin(text, text, jsonb) to authenticated;

-- Prüfentscheidungen (Freigeben/Ablehnen/Zurücksetzen) automatisch protokollieren –
-- nur wenn ein Admin sie auslöst (nicht der Nachprüf-Cron der Edge Function)
create function public.log_verdict_review() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if new.review_status is distinct from old.review_status and public.is_admin() then
    insert into public.admin_log (admin_id, action, target, detail)
    values (auth.uid(), 'verdict.' || new.review_status, new.question_id,
            jsonb_build_object('answer', new.normalized_answer, 'from', old.review_status));
  end if;
  return new;
end;
$$;
revoke all on function public.log_verdict_review() from public, anon, authenticated;
create trigger ai_verdicts_log after update on public.ai_verdicts
  for each row execute function public.log_verdict_review();

-- ---------------------------------------------------------------- 4. Admin-Funktionen

create function public.require_admin() returns void
  language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'nur für Admins' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.require_admin() from public, anon;
grant execute on function public.require_admin() to authenticated;

-- Übersicht: Spieler, Runden, Punkte, KI – heute und 7 Tage (ohne Debug-Runden)
create function public.admin_overview() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  d_today date := public.berlin_today();
  since_today timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  since_week timestamptz := since_today - interval '6 days';
  result jsonb;
begin
  perform public.require_admin();
  with act as (
    select s.user_id, s.created_at from public.submissions s where not s.is_debug and s.created_at >= since_week
    union all
    select l.user_id, l.created_at from public.ai_judge_log l where l.user_id is not null and l.created_at >= since_week
  ),
  players as (
    select a.user_id, bool_or(a.created_at >= since_today) as is_today, coalesce(u.is_anonymous, true) as anon
    from act a left join auth.users u on u.id = a.user_id
    group by a.user_id, u.is_anonymous
  ),
  rounds as (
    select s.user_id, s.mode, s.day, sum(s.score) as points, count(*) as answers
    from public.submissions s
    where not s.is_debug and not s.is_practice and s.day between d_today - 6 and d_today
    group by s.user_id, s.mode, s.day
  )
  select jsonb_build_object(
    'active_today', (select count(*) from players where is_today),
    'active_week', (select count(*) from players),
    'signed_in_today', (select count(*) from players where is_today and not anon),
    'signed_in_week', (select count(*) from players where not anon),
    'new_today', (select count(*) from auth.users u where u.created_at >= since_today),
    'new_week', (select count(*) from auth.users u where u.created_at >= since_week),
    'new_signed_in_week', (select count(*) from auth.users u where u.created_at >= since_week and not u.is_anonymous),
    'rounds_today', (select jsonb_object_agg(m, n) from (select mode m, count(*) n from rounds where day = d_today group by mode) x),
    'rounds_week', (select jsonb_object_agg(m, n) from (select mode m, count(*) n from rounds group by mode) x),
    'avg_points_today', (select jsonb_object_agg(m, n) from (select mode m, round(avg(points)) n from rounds where day = d_today and answers >= 7 group by mode) x),
    'avg_points_week', (select jsonb_object_agg(m, n) from (select mode m, round(avg(points)) n from rounds where answers >= 7 group by mode) x),
    'practice_today', (select count(*) from public.submissions s where s.is_practice and not s.is_debug and s.created_at >= since_today),
    'debug_today', (select count(*) from public.submissions s where s.is_debug and s.created_at >= since_today),
    'ai_today', (select jsonb_build_object(
        'ok', count(*) filter (where kind = 'model'),
        'cache', count(*) filter (where kind = 'cache'),
        'error', count(*) filter (where kind = 'error'),
        'limited', count(*) filter (where kind = 'limited'))
      from public.ai_judge_log where created_at >= since_today),
    'last_model', (select l.model from public.ai_judge_log l where l.kind = 'model' and l.model is not null order by l.created_at desc limit 1),
    'primary_quota_hit_at', (select max(l.created_at) from public.ai_judge_log l where l.primary_status = 429 and l.created_at >= since_today),
    'breaker_recent', (select count(*) from public.ai_judge_log l where l.primary_status in (429, 503) and l.created_at >= now() - interval '10 minutes'),
    'open_pending', (select count(*) from public.ai_verdicts v where v.review_status = 'pending'),
    'open_unchecked', (select count(*) from public.ai_verdicts v where v.review_status = 'unchecked'),
    'banned', (select count(*) from public.player_bans)
  ) into result;
  return result;
end;
$$;

-- Spielerliste: Name, Login-Art (keine E-Mail), erstellt, letzte Aktivität, Runden, KI heute
create function public.admin_players(p_search text default null, p_limit int default 100)
returns table (
  user_id uuid,
  display_name text,
  provider text,
  is_admin boolean,
  banned boolean,
  ban_reason text,
  created_at timestamptz,
  last_active timestamptz,
  rounds bigint,
  answers bigint,
  ai_today bigint
)
  language plpgsql stable security definer set search_path = ''
as $$
declare
  since_today timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
begin
  perform public.require_admin();
  return query
  select
    u.id,
    p.display_name,
    case when u.is_anonymous then 'anonym' else coalesce(u.raw_app_meta_data ->> 'provider', 'email') end,
    exists (select 1 from public.admins a where a.user_id = u.id),
    b.user_id is not null,
    b.reason,
    u.created_at,
    greatest(u.last_sign_in_at, s.last_at, l.last_at),
    coalesce(s.rounds, 0),
    coalesce(s.answers, 0),
    coalesce(l.today, 0)
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join public.player_bans b on b.user_id = u.id
  left join lateral (
    select max(x.created_at) as last_at,
           count(distinct (x.mode, x.day)) filter (where not x.is_practice) as rounds,
           count(*) as answers
    from public.submissions x where x.user_id = u.id and not x.is_debug
  ) s on true
  left join lateral (
    select max(y.created_at) as last_at, count(*) filter (where y.kind = 'model' and y.created_at >= since_today) as today
    from public.ai_judge_log y where y.user_id = u.id
  ) l on true
  where p_search is null or p_search = ''
     or p.display_name ilike '%' || p_search || '%'
     or u.id::text like lower(p_search) || '%'
  order by greatest(u.last_sign_in_at, s.last_at, l.last_at) desc nulls last
  limit least(greatest(p_limit, 1), 500);
end;
$$;

create function public.admin_set_ban(p_user uuid, p_banned boolean, p_reason text default null) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_user = auth.uid() then
    raise exception 'sich selbst sperren geht nicht' using errcode = '22023';
  end if;
  if p_banned then
    insert into public.player_bans (user_id, reason, banned_by) values (p_user, left(p_reason, 200), auth.uid())
    on conflict (user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, created_at = now();
  else
    delete from public.player_bans where user_id = p_user;
  end if;
  perform public.log_admin(case when p_banned then 'player.ban' else 'player.unban' end, p_user::text,
                           jsonb_build_object('reason', p_reason));
end;
$$;

-- Namen zurücksetzen: neutraler, eindeutiger Name „Spieler-xxxxxx“
create function public.admin_reset_name(p_user uuid) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  old_name text;
  new_name text := 'Spieler-' || left(replace(p_user::text, '-', ''), 6);
begin
  perform public.require_admin();
  select display_name into old_name from public.profiles where user_id = p_user;
  if old_name is null then
    return null;
  end if;
  update public.profiles set display_name = new_name, updated_at = now() where user_id = p_user;
  perform public.log_admin('player.reset_name', p_user::text, jsonb_build_object('old', old_name, 'new', new_name));
  return new_name;
end;
$$;

-- Echte Häufigkeiten einer Frage (Tagesrunden, ohne Übung/Debug), je erkannter Antwort
create function public.admin_question_stats(p_question text)
returns table (answer text, source text, plays bigint, avg_score numeric)
  language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select coalesce(s.matched_answer, '∅ ' || s.normalized_answer), s.source, count(*), round(avg(s.score), 1)
  from public.submissions s
  where s.question_id = p_question and not s.is_debug and not s.is_practice
  group by 1, 2
  order by 3 desc
  limit 200;
end;
$$;

-- Auffällige Fragen: oft „Daneben“ (0 Punkte) oder oft KI-Prüfungen (Antwortliste zu dünn)
create function public.admin_question_flags(p_min_plays int default 5)
returns table (question_id text, plays bigint, misses bigint, ai bigint, miss_rate numeric, ai_rate numeric)
  language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select s.question_id, count(*), count(*) filter (where s.score = 0), count(*) filter (where s.source = 'ai'),
         round(100.0 * count(*) filter (where s.score = 0) / count(*), 1),
         round(100.0 * count(*) filter (where s.source = 'ai') / count(*), 1)
  from public.submissions s
  where not s.is_debug
  group by s.question_id
  having count(*) >= p_min_plays
  order by greatest(count(*) filter (where s.score = 0), count(*) filter (where s.source = 'ai'))::numeric / count(*) desc
  limit 100;
end;
$$;

-- Bulk-Ablehnen protokollieren (die einzelnen Statuswechsel loggt der Trigger)
create or replace function public.reject_verdicts(p_ids uuid[]) returns integer
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
  set valid = false, review_status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  where id = any (p_ids);
  get diagnostics n = row_count;
  if n > 1 then
    perform public.log_admin('verdict.bulk_reject', null, jsonb_build_object('count', n));
  end if;
  return n;
end;
$$;

revoke all on function
  public.admin_overview(), public.admin_players(text, int), public.admin_set_ban(uuid, boolean, text),
  public.admin_reset_name(uuid), public.admin_question_stats(text), public.admin_question_flags(int)
from public, anon;
grant execute on function
  public.admin_overview(), public.admin_players(text, int), public.admin_set_ban(uuid, boolean, text),
  public.admin_reset_name(uuid), public.admin_question_stats(text), public.admin_question_flags(int)
to authenticated;
