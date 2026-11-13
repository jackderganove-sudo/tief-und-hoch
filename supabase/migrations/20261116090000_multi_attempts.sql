-- Mehrere Versuche pro Frage: Falsche Antworten beenden die Frage nicht mehr. Man gibt neu ein,
-- bis eine Antwort gilt oder die Zeit abläuft.
--
-- 1. submissions: Anzahl der Versuche und die abgelehnten Eingaben. Sie stehen NICHT als eigene
--    Zeilen in submissions und zählen deshalb nirgends für Häufigkeiten/Seltenheit.
-- 2. Freunde-Modus: room_attempts hält jeden Versuch einzeln fest (vom Server geprüft).
--    room_answers bleibt „eine Zeile pro Spieler und Frage“ = die gewertete Antwort; während
--    der Frage steht dort nur die erste gültige. „Hat geantwortet“ gibt es erst dann.

-- ---------------------------------------------------------------- 1. submissions

alter table public.submissions
  add column attempts smallint not null default 1 check (attempts between 0 and 500),
  add column invalid_attempts text[] not null default '{}'
    check (cardinality(invalid_attempts) <= 20 and char_length(array_to_string(invalid_attempts, '')) <= 1300);

-- ---------------------------------------------------------------- 2. Versuche im Raum

create table public.room_attempts (
  room_id uuid not null references public.rooms (id) on delete cascade,
  idx integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- laufende Nummer des Versuchs dieses Spielers bei dieser Frage
  n smallint not null check (n between 1 and 100),
  raw text not null check (char_length(raw) <= 60),
  normalized text not null,
  -- pending = KI prüft noch; unchecked = KI nicht erreichbar (darf wiederholt werden)
  status text not null default 'pending' check (status in ('pending', 'valid', 'invalid', 'unchecked')),
  -- warum abgelehnt: nonsense (gar nicht geprüft), ai, list_only (KI-Kontingent der Frage verbraucht), limited (Tageslimit)
  reason text check (reason in ('nonsense', 'ai', 'list_only', 'limited')),
  -- echte KI-Prüfung (zählt für das Kontingent von 3 pro Frage und Spieler)
  ai boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (room_id, idx, user_id, n)
);
alter table public.room_attempts enable row level security;
revoke all on table public.room_attempts from anon, authenticated;
grant all on table public.room_attempts to service_role;

alter table public.room_answers add column attempts smallint not null default 1;

-- „hat geantwortet“ nur noch bei einer gültigen Antwort
drop trigger room_answers_broadcast on public.room_answers;
create trigger room_answers_broadcast after insert on public.room_answers
  for each row when (new.status = 'valid') execute function public.room_broadcast_answered();

-- „versucht es noch“ – nur die Anzahl, nie der Inhalt
create function public.room_broadcast_tried() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  c text;
begin
  select code into c from public.rooms where id = new.room_id;
  perform realtime.send(jsonb_build_object('idx', new.idx, 'user_id', new.user_id, 'n', new.n), 'tried', 'room:' || c, false);
  return new;
end;
$$;
create trigger room_attempts_broadcast after insert on public.room_attempts
  for each row execute function public.room_broadcast_tried();
revoke all on function public.room_broadcast_tried() from public, anon, authenticated;

-- ---------------------------------------------------------------- Zustand für Clients

create or replace function public.room_state(p_code text) returns jsonb
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
        -- Häkchen erst bei einer gültigen Antwort
        'answered', exists (select 1 from public.room_answers a where a.room_id = r.id and a.idx = r.current_index and a.user_id = p.user_id and a.status = 'valid'),
        -- wie oft schon versucht (nur die Anzahl)
        'attempts', (select count(*) from public.room_attempts t where t.room_id = r.id and t.idx = r.current_index and t.user_id = p.user_id),
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
    -- eigene gewertete Antwort (nur eine gültige beendet die Frage für mich)
    'my_answer', (select a.raw from public.room_answers a where a.room_id = r.id and a.idx = r.current_index and a.user_id = auth.uid() and a.status = 'valid'),
    -- eigene abgelehnte Versuche dieser Frage (nach Reload wieder da)
    'my_attempts', coalesce((select jsonb_agg(t.raw order by t.n) from public.room_attempts t
                             where t.room_id = r.id and t.idx = r.current_index and t.user_id = auth.uid() and t.status = 'invalid'), '[]'::jsonb),
    'my_ai_left', greatest(0, 3 - (select count(*) from public.room_attempts t
                                   where t.room_id = r.id and t.idx = r.current_index and t.user_id = auth.uid() and t.ai)),
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
