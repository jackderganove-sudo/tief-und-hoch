-- Freunde-Modus: Live-Räume für 2–30 Spieler.
--
-- Anti-Schummeln: Fragen mit Antworten (questions) und alle Raum-Tabellen sind für Clients
-- NICHT lesbar. Gesteuert wird alles von der Edge Function "room" (service_role); Clients
-- lesen nur den bereinigten Zustand über room_state(): während der Frage nur den Fragetext,
-- Antworten und Punkte erst in der Auflösung. Änderungen werden per Realtime-Broadcast
-- angekündigt (nur „Zustand neu“ bzw. „Spieler X hat geantwortet“, nie Inhalte).
--
-- Raum-Runden schreiben nie in submissions → zählen nicht für Tagesergebnis, Serien,
-- globale Seltenheit oder Bestenlisten. Ihre Antworten stehen mit room_id in room_answers.

-- ---------------------------------------------------------------- Fragen (serverseitig)

create table public.questions (
  id text primary key,
  lang text not null check (lang in ('de', 'en')),
  topic text not null,
  prompt text not null,
  modes text[] not null,
  -- [{text, aliases, baseScore, tooClever?}] – freigegebene Antworten (approved_answers) mischt die Funktion live dazu
  answers jsonb not null,
  updated_at timestamptz not null default now()
);
create index questions_lang_idx on public.questions (lang);
alter table public.questions enable row level security;
revoke all on table public.questions from anon, authenticated;
grant all on table public.questions to service_role;

-- ---------------------------------------------------------------- Räume

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  -- 6 Zeichen ohne verwechselbare (kein I, O, 0, 1)
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  status text not null default 'lobby' check (status in ('lobby', 'countdown', 'question', 'scoring', 'reveal', 'finished')),
  settings jsonb not null,
  current_index integer not null default -1,
  question_count integer not null default 0,
  phase_ends_at timestamptz,
  -- „Nochmal“ zählt hoch (gleiche Leute, neue Runde)
  round integer not null default 1,
  -- jede Änderung erhöht version → Broadcast an alle im Raum
  version integer not null default 0,
  ended_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index rooms_activity_idx on public.rooms (last_activity_at);
create index rooms_created_by_idx on public.rooms (created_by, created_at desc);

create table public.room_players (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (public.display_name_ok(name)),
  avatar smallint not null default 0 check (avatar between 0 and 11),
  color smallint not null default 0 check (color between 0 and 29),
  -- spielt ab dieser Frage mit (später Beitretende: ab der nächsten)
  from_index integer not null default 0,
  kicked boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_id, user_id)
);
create unique index room_players_name_unique on public.room_players (room_id, lower(name)) where not kicked;

create table public.room_questions (
  room_id uuid not null references public.rooms (id) on delete cascade,
  idx integer not null,
  question_id text references public.questions (id) on delete set null,
  -- eigene Frage des Gastgebers (ohne Antwortliste)
  custom_prompt text check (char_length(custom_prompt) <= 120),
  prompt text not null,
  topic text,
  lang text not null,
  started_at timestamptz,
  ends_at timestamptz,
  -- Auflösung (Gruppen, Punkte) – erst nach dem Ende der Frage gefüllt
  reveal jsonb,
  primary key (room_id, idx)
);

create table public.room_answers (
  room_id uuid not null references public.rooms (id) on delete cascade,
  idx integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  raw text not null check (char_length(raw) <= 60),
  normalized text not null,
  -- pending = KI prüft noch
  status text not null default 'pending' check (status in ('pending', 'valid', 'invalid', 'unchecked')),
  list_answer text,
  canonical text,
  base_score smallint,
  source text check (source in ('list', 'ai')),
  -- Wertung „Global“ (wie im normalen Spiel), beim Eingang berechnet
  global_tier text,
  global_points smallint,
  -- Korrektur des Gastgebers (gültig/ungültig)
  override_valid boolean,
  points smallint not null default 0,
  tier text,
  created_at timestamptz not null default now(),
  -- nur einmal pro Frage
  primary key (room_id, idx, user_id)
);

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_questions enable row level security;
alter table public.room_answers enable row level security;
-- keine Policies: nur die Edge Function (service_role) und die SECURITY-DEFINER-Funktionen unten
revoke all on table public.rooms, public.room_players, public.room_questions, public.room_answers from anon, authenticated;
grant all on table public.rooms, public.room_players, public.room_questions, public.room_answers to service_role;

-- ---------------------------------------------------------------- Realtime-Ankündigungen

create function public.room_broadcast_state() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    perform realtime.send(
      jsonb_build_object('v', new.version, 'status', new.status, 'idx', new.current_index),
      'state', 'room:' || new.code, false);
  end if;
  return new;
end;
$$;
create trigger rooms_broadcast after insert or update on public.rooms
  for each row execute function public.room_broadcast_state();

-- „hat geantwortet“ – ohne Inhalt
create function public.room_broadcast_answered() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  c text;
begin
  select code into c from public.rooms where id = new.room_id;
  perform realtime.send(jsonb_build_object('idx', new.idx, 'user_id', new.user_id), 'answered', 'room:' || c, false);
  return new;
end;
$$;
create trigger room_answers_broadcast after insert on public.room_answers
  for each row execute function public.room_broadcast_answered();

revoke all on function public.room_broadcast_state(), public.room_broadcast_answered() from public, anon, authenticated;

-- ---------------------------------------------------------------- Zustand für Clients

-- Bereinigter Raumzustand für Mitspieler. Antworten anderer und Punkte der laufenden Frage
-- gibt es erst in der Auflösung; Antwortlisten nie (nur die Gruppen der Auflösung).
create function public.room_state(p_code text) returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  r public.rooms;
  me public.room_players;
  q public.room_questions;
  result jsonb;
begin
  select * into r from public.rooms where code = upper(p_code);
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  select * into me from public.room_players where room_id = r.id and user_id = auth.uid();
  if not found or me.kicked then
    -- Vorschau zum Beitreten (keine Spielinhalte)
    return jsonb_build_object(
      'error', case when me.kicked then 'kicked' else 'not_member' end,
      'code', r.code,
      'status', r.status,
      'players', (select count(*) from public.room_players p where p.room_id = r.id and not p.kicked),
      'host', (select p.name from public.room_players p where p.room_id = r.id and p.user_id = r.host_id),
      'lang', r.settings ->> 'lang'
    );
  end if;
  update public.room_players set last_seen = now() where room_id = r.id and user_id = me.user_id;

  select * into q from public.room_questions where room_id = r.id and idx = r.current_index;

  select jsonb_build_object(
    'code', r.code,
    'status', r.status,
    'settings', r.settings - 'custom_prompts',
    'custom_prompts', case when r.host_id = auth.uid() then r.settings -> 'custom_prompts' else null end,
    'index', r.current_index,
    'count', r.question_count,
    'round', r.round,
    'ends_at', r.phase_ends_at,
    'now', now(),
    'version', r.version,
    'host_id', r.host_id,
    'me', auth.uid(),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'name', p.name,
        'avatar', p.avatar,
        'color', p.color,
        'from_index', p.from_index,
        'online', p.last_seen > now() - interval '45 seconds',
        'answered', exists (select 1 from public.room_answers a where a.room_id = r.id and a.idx = r.current_index and a.user_id = p.user_id),
        -- Punkte nur bis zur letzten aufgelösten Frage
        'points', coalesce((select sum(a.points) from public.room_answers a
                            join public.room_questions rq on rq.room_id = a.room_id and rq.idx = a.idx
                            where a.room_id = r.id and a.user_id = p.user_id and rq.reveal is not null
                              and (rq.idx < r.current_index or r.status in ('reveal', 'finished'))), 0)
      ) order by p.joined_at)
      from public.room_players p where p.room_id = r.id and not p.kicked
    ), '[]'::jsonb),
    'question', case when q.idx is not null and r.status in ('question', 'scoring', 'reveal', 'finished') then jsonb_build_object(
      'idx', q.idx,
      'prompt', q.prompt,
      'topic', q.topic,
      'custom', q.custom_prompt is not null,
      'ends_at', q.ends_at
    ) end,
    'my_answer', (select a.raw from public.room_answers a where a.room_id = r.id and a.idx = r.current_index and a.user_id = auth.uid()),
    'reveal', case when r.status in ('reveal', 'finished') then q.reveal end,
    -- Endbildschirm: alle Auflösungen (für „Gedankenleser“ und „Einzelgänger“)
    'reveals', case when r.status = 'finished' then (
      select jsonb_agg(rq.reveal order by rq.idx) from public.room_questions rq where rq.room_id = r.id and rq.reveal is not null
    ) end
  ) into result;
  return result;
end;
$$;
revoke all on function public.room_state(text) from public, anon;
grant execute on function public.room_state(text) to authenticated;

-- ---------------------------------------------------------------- Aufräumen

-- Räume laufen nach 2 h ohne Aktivität ab
create function public.cleanup_rooms() returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.rooms where last_activity_at < now() - interval '2 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.cleanup_rooms() from public, anon, authenticated;

select cron.schedule('cleanup-rooms', '*/10 * * * *', 'select public.cleanup_rooms()');
