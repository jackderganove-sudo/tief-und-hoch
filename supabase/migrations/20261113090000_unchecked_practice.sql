-- Nichts mehr verlieren + Übungsantworten speichern + Status für den Admin.
--
-- 1. ai_verdicts.review_status 'unchecked': Antworten, die wegen Fehler/Timeout/Limit nicht
--    geprüft werden konnten. Sie gelten nicht als Cache-Treffer (werden erneut geprüft).
-- 2. submissions.is_practice: Antworten aus dem Endlos-Modus. Zählen NICHT für echte
--    Häufigkeiten (Wiederholungen verzerren), werden aber gespeichert.
-- 3. ai_judge_log: welches Modell geantwortet hat und HTTP-Status des Hauptmodells
--    (für den instanzübergreifenden 429/503-Breaker und die Admin-Statusanzeige).

-- ---------------------------------------------------------------- 1. unchecked

alter table public.ai_verdicts drop constraint ai_verdicts_review_status_check;
alter table public.ai_verdicts
  add constraint ai_verdicts_review_status_check check (review_status in ('pending', 'approved', 'rejected', 'unchecked'));
-- Grund, warum nicht geprüft werden konnte (error | limited)
alter table public.ai_verdicts add column unchecked_reason text check (unchecked_reason in ('error', 'limited'));

-- Zurücksetzen auf „offen“: ein ungeprüftes Urteil bleibt ungeprüft
create or replace function public.reset_verdicts(p_ids uuid[]) returns integer
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
  set valid = ai_valid,
      review_status = case when model = 'none' then 'unchecked' else 'pending' end,
      reviewed_at = null,
      reviewed_by = null
  where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------- 2. Übung

alter table public.submissions add column is_practice boolean not null default false;
-- Tagesrunde: eine Antwort pro Spieler/Frage/Modus/Tag; Übung darf Fragen wiederholen
alter table public.submissions drop constraint submissions_user_id_question_id_mode_day_key;
create unique index submissions_daily_unique on public.submissions (user_id, question_id, mode, day) where not is_practice;

-- ---------------------------------------------------------------- 3. Log-Details

alter table public.ai_judge_log
  add column model text,
  add column primary_status smallint;
-- Nachprüf-Job (Cron) läuft ohne Spieler
alter table public.ai_judge_log alter column user_id drop not null;
create index ai_judge_log_primary_idx on public.ai_judge_log (created_at desc) where primary_status in (429, 503);

-- Übersicht mit is_practice/unchecked_reason neu anlegen (Spaltenliste ändert sich)
drop view public.admin_verdicts;
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
  v.unchecked_reason,
  v.reviewed_at,
  v.created_at,
  (select count(*) from public.submissions s where s.question_id = v.question_id and s.normalized_answer = v.normalized_answer) as plays,
  (select count(*) from public.submissions s where s.question_id = v.question_id and s.normalized_answer = v.normalized_answer and s.is_practice) as practice_plays,
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

-- ---------------------------------------------------------------- Admin-Statusanzeige

-- Kennzahlen „heute“ (Europe/Berlin) für die Kopfzeile im Admin. Nur für Admins.
create function public.admin_ai_status() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  since timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'nur für Admins' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'checks_today', count(*) filter (where kind = 'model'),
    'errors_today', count(*) filter (where kind = 'error'),
    'limited_today', count(*) filter (where kind = 'limited'),
    'cache_today', count(*) filter (where kind = 'cache'),
    'avg_ms_today', round(avg(ms) filter (where kind = 'model')),
    'last_model', (select l.model from public.ai_judge_log l where l.kind = 'model' and l.model is not null order by l.created_at desc limit 1),
    'primary_quota_hit_at', (select max(l.created_at) from public.ai_judge_log l where l.primary_status = 429 and l.created_at >= since),
    'unchecked_open', (select count(*) from public.ai_verdicts v where v.review_status = 'unchecked')
  )
  into result
  from public.ai_judge_log
  where created_at >= since;
  return result;
end;
$$;
revoke all on function public.admin_ai_status() from public, anon;
grant execute on function public.admin_ai_status() to authenticated;
