-- Anti-Schummel-Tests für den Freunde-Modus. Läuft in einer Transaktion und wird zurückgerollt.
-- Ausführen: npm run test:rls (zusammen mit rls.sql)
begin;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'room-host@example.invalid'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'room-guest@example.invalid'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'room-outsider@example.invalid');
insert into public.questions (id, lang, topic, prompt, modes, answers)
values ('zz-test-001', 'de', 'food', 'Nenne ein Testgemüse', array['rare','common'], '[{"text":"Geheimantwort","aliases":[],"baseScore":5}]');
insert into public.rooms (id, code, host_id, created_by, status, settings, current_index, question_count, phase_ends_at)
values ('00000000-0000-4000-8000-0000000000d1', 'TESTAB', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f1',
        'question', '{"mode":"rare","scoring":"group","source":"custom","topics":[],"count":5,"seconds":25,"lang":"de","custom_prompts":["Geheime Hostfrage"]}', 0, 1, now() + interval '20 seconds');
insert into public.room_players (room_id, user_id, name, color) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1', 'Gastgeberin', 0),
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f2', 'Gast Eins', 1);
insert into public.room_questions (room_id, idx, question_id, prompt, lang, reveal)
values ('00000000-0000-4000-8000-0000000000d1', 0, 'zz-test-001', 'Nenne ein Testgemüse', 'de', '{"groups":[{"text":"Geheimantwort"}]}');
insert into public.room_answers (room_id, idx, user_id, raw, normalized, status, points)
values ('00000000-0000-4000-8000-0000000000d1', 0, '00000000-0000-4000-8000-0000000000f1', 'Antwort der Gastgeberin', 'antwort der gastgeberin', 'valid', 100);

-- ================================================================ Gast während der Frage
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}';

do $$
declare s jsonb;
begin
  begin perform 1 from public.questions; raise exception 'FAIL: Spieler liest questions (Antwortlisten)'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.room_answers; raise exception 'FAIL: Spieler liest room_answers'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.room_questions; raise exception 'FAIL: Spieler liest room_questions'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.rooms; raise exception 'FAIL: Spieler liest rooms direkt'; exception when insufficient_privilege then null; end;
  begin
    insert into public.room_answers (room_id, idx, user_id, raw, normalized) values ('00000000-0000-4000-8000-0000000000d1', 0, '00000000-0000-4000-8000-0000000000f2', 'x', 'x');
    raise exception 'FAIL: Spieler schreibt Antwort an der Funktion vorbei';
  exception when insufficient_privilege then null; end;
  begin update public.rooms set status = 'reveal'; raise exception 'FAIL: Spieler ändert Raumstatus'; exception when insufficient_privilege then null; end;

  s := public.room_state('testab');
  if s ->> 'status' <> 'question' then raise exception 'FAIL: Zustand %', s; end if;
  if s -> 'question' ->> 'prompt' <> 'Nenne ein Testgemüse' then raise exception 'FAIL: Fragetext fehlt'; end if;
  if s::text like '%Geheimantwort%' then raise exception 'FAIL: Antwortliste/Auflösung vor Ende sichtbar'; end if;
  if s::text like '%Antwort der Gastgeberin%' then raise exception 'FAIL: fremde Antwort vor Auflösung sichtbar'; end if;
  if s::text like '%Geheime Hostfrage%' then raise exception 'FAIL: geplante Hostfragen für Gäste sichtbar'; end if;
  if (select (p ->> 'points')::int from jsonb_array_elements(s -> 'players') p where p ->> 'name' = 'Gastgeberin') <> 0 then
    raise exception 'FAIL: Punkte der laufenden Frage vor Auflösung sichtbar';
  end if;
  if not (select (p ->> 'answered')::boolean from jsonb_array_elements(s -> 'players') p where p ->> 'name' = 'Gastgeberin') then
    raise exception 'FAIL: „hat geantwortet“ fehlt';
  end if;
end $$;
reset role;

-- ================================================================ Außenstehender
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}';
do $$
declare s jsonb;
begin
  s := public.room_state('TESTAB');
  if s ->> 'error' <> 'not_member' then raise exception 'FAIL: Außenstehender bekommt Zustand %', s; end if;
  if s ? 'question' or s::text like '%Testgemüse%' then raise exception 'FAIL: Außenstehender sieht die Frage'; end if;
end $$;
reset role;

-- ================================================================ Auflösung: jetzt sichtbar
update public.rooms set status = 'reveal' where id = '00000000-0000-4000-8000-0000000000d1';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}';
do $$
declare s jsonb;
begin
  s := public.room_state('TESTAB');
  if s -> 'reveal' -> 'groups' -> 0 ->> 'text' <> 'Geheimantwort' then raise exception 'FAIL: Auflösung fehlt nach Ende'; end if;
  if (select (p ->> 'points')::int from jsonb_array_elements(s -> 'players') p where p ->> 'name' = 'Gastgeberin') <> 100 then
    raise exception 'FAIL: Punkte nach Auflösung fehlen';
  end if;
end $$;
reset role;

-- ================================================================ Entfernter Spieler
update public.room_players set kicked = true where user_id = '00000000-0000-4000-8000-0000000000f2';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}';
do $$ begin
  if public.room_state('TESTAB') ->> 'error' <> 'kicked' then raise exception 'FAIL: entfernter Spieler sieht noch den Raum'; end if;
end $$;
reset role;

-- ================================================================ Admin-Funktionen für Räume
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';
do $$ begin
  begin perform public.admin_rooms(); raise exception 'FAIL: Nicht-Admin sieht Räume'; exception when insufficient_privilege then null; end;
  begin perform public.admin_end_room('00000000-0000-4000-8000-0000000000d1'); raise exception 'FAIL: Nicht-Admin beendet Raum'; exception when insufficient_privilege then null; end;
  begin perform public.admin_room_ban('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f2'); raise exception 'FAIL: Nicht-Admin sperrt im Raum'; exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000f3');
update public.room_players set kicked = false where user_id = '00000000-0000-4000-8000-0000000000f2';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}';
do $$ begin
  if jsonb_array_length(public.admin_rooms()) < 1 then raise exception 'FAIL: Admin sieht den Raum nicht'; end if;
  perform public.admin_room_ban('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f2', 'Test');
  if not public.is_banned('00000000-0000-4000-8000-0000000000f2') then raise exception 'FAIL: Spieler nicht gesperrt'; end if;
  perform public.admin_end_room('00000000-0000-4000-8000-0000000000d1');
end $$;
reset role;
do $$ begin
  if (select status from public.rooms where code = 'TESTAB') <> 'finished' then raise exception 'FAIL: Raum nicht beendet'; end if;
  if not (select kicked from public.room_players where user_id = '00000000-0000-4000-8000-0000000000f2') then raise exception 'FAIL: Spieler nicht entfernt'; end if;
  if (select count(*) from public.admin_log where action in ('room.end', 'player.ban') and admin_id = '00000000-0000-4000-8000-0000000000f3') <> 2 then raise exception 'FAIL: nicht protokolliert'; end if;
end $$;

-- Aufräumen nach 2 h
update public.rooms set last_activity_at = now() - interval '3 hours' where id = '00000000-0000-4000-8000-0000000000d1';
do $$ begin
  perform public.cleanup_rooms();
  if exists (select 1 from public.rooms where id = '00000000-0000-4000-8000-0000000000d1') then raise exception 'FAIL: abgelaufener Raum nicht aufgeräumt'; end if;
  if exists (select 1 from public.room_answers where room_id = '00000000-0000-4000-8000-0000000000d1') then raise exception 'FAIL: Antworten des Raums übrig'; end if;
end $$;

select 'Raum-Tests bestanden' as result;
rollback;
