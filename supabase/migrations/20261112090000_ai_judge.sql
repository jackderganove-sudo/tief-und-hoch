-- KI-Prüfung für Antworten außerhalb der Liste + Speicherung aller Antworten.
--
-- Im Projekt ist "Automatically expose new tables" AUS: Rechte werden hier
-- ausdrücklich vergeben. RLS ist auf allen Tabellen an.
--   submissions   Spieler (authenticated, auch anonyme Anmeldung): nur eigene Zeilen lesen/einfügen
--   ai_verdicts   nur die Edge Function (service_role) – Cache der KI-Urteile
--   ai_judge_log  nur die Edge Function – Rate-Limit und Verbrauchsübersicht

-- ---------------------------------------------------------------- submissions

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null check (char_length(question_id) <= 40),
  lang text not null check (lang in ('de', 'en')),
  mode text not null check (mode in ('rare', 'common')),
  day date not null,
  raw_answer text not null check (char_length(raw_answer) <= 100),
  matched_answer text check (char_length(matched_answer) <= 100),
  source text not null check (source in ('list', 'ai')),
  score smallint not null check (score between 0 and 100),
  created_at timestamptz not null default now(),
  -- eine Antwort pro Spieler, Frage, Modus und Tag (Wiederholungen nach Reload werden ignoriert)
  unique (user_id, question_id, mode, day)
);

create index submissions_question_idx on public.submissions (question_id, mode);

alter table public.submissions enable row level security;

create policy "Spieler lesen eigene Antworten"
  on public.submissions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Spieler speichern eigene Antworten"
  on public.submissions for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- ai_verdicts (Cache)

create table public.ai_verdicts (
  id uuid primary key default gen_random_uuid(),
  question_id text not null,
  normalized_answer text not null,
  valid boolean not null,
  canonical_text text,
  -- Antwort aus der kuratierten Liste, falls die KI eine Variante davon erkannt hat
  list_answer text,
  estimated_base_score smallint check (estimated_base_score between 0 and 100),
  reason text,
  model text not null,
  created_at timestamptz not null default now(),
  unique (question_id, normalized_answer)
);

alter table public.ai_verdicts enable row level security;
-- keine Policies: für anon/authenticated unsichtbar, die Edge Function nutzt service_role

-- ---------------------------------------------------------------- ai_judge_log

create table public.ai_judge_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id text not null,
  -- cache = aus ai_verdicts, model = Gemini gefragt, list = lokal erkannt, limited = Limit erreicht
  kind text not null check (kind in ('cache', 'model', 'list', 'limited', 'error')),
  ms integer,
  created_at timestamptz not null default now()
);

create index ai_judge_log_user_idx on public.ai_judge_log (user_id, created_at desc);
create index ai_judge_log_created_idx on public.ai_judge_log (created_at desc);

alter table public.ai_judge_log enable row level security;

-- ---------------------------------------------------------------- Rechte

revoke all on table public.submissions, public.ai_verdicts, public.ai_judge_log from anon, authenticated;

grant select, insert on table public.submissions to authenticated;

grant select, insert, update, delete on table public.submissions, public.ai_verdicts, public.ai_judge_log to service_role;
grant usage, select on sequence public.ai_judge_log_id_seq to service_role;
