-- Eingaben, die nicht geprüft werden konnten (KI nicht erreichbar, Limit, Kontingent der Frage
-- verbraucht), getrennt von den abgelehnten: Sie waren nicht falsch, nur nicht gewertet.
alter table public.submissions
  add column unchecked_attempts text[] not null default '{}'
    check (cardinality(unchecked_attempts) <= 20 and char_length(array_to_string(unchecked_attempts, '')) <= 1300);

-- Freunde-Modus: eigene nicht geprüfte Versuche getrennt ausweisen (my_unchecked)
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
    -- davon bzw. zusätzlich: nicht geprüft (KI nicht erreichbar, Limit, Kontingent verbraucht) – nicht falsch
    'my_unchecked', coalesce((select jsonb_agg(t.raw order by t.n) from public.room_attempts t
                              where t.room_id = r.id and t.idx = r.current_index and t.user_id = auth.uid()
                                and (t.status = 'unchecked' or t.reason in ('list_only', 'limited'))), '[]'::jsonb),
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
