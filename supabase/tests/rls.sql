-- RLS-Tests für Spieler-, Fremd- und Admin-Rechte.
-- Läuft komplett in einer Transaktion und wird IMMER zurückgerollt (nichts bleibt in der DB).
-- Ausführen: npm run test:rls   (schlägt bei der ersten Verletzung mit "FAIL: …" fehl)

begin;

-- Testdaten (als postgres)
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-admin@example.invalid'),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-player@example.invalid'),
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-other@example.invalid');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-00000000a001');
insert into public.ai_verdicts (id, question_id, normalized_answer, valid, ai_valid, canonical_text, estimated_base_score, model)
values ('00000000-0000-4000-8000-0000000000e1', 'de-food-001', 'rlstestgemuese', true, true, 'RLS-Testgemüse', 5, 'test');
insert into public.submissions (user_id, question_id, lang, mode, day, raw_answer, normalized_answer, source, score)
values ('00000000-0000-4000-8000-00000000b001', 'de-food-001', 'de', 'rare', public.berlin_today(), 'geheim', 'geheim', 'list', 10);

-- ================================================================ anon (ohne Anmeldung)
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

do $$ begin
  begin perform 1 from public.ai_verdicts; raise exception 'FAIL: anon liest ai_verdicts'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.submissions; raise exception 'FAIL: anon liest submissions'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.admins; raise exception 'FAIL: anon liest admins'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.admin_verdicts; raise exception 'FAIL: anon liest admin_verdicts'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.ai_judge_log; raise exception 'FAIL: anon liest ai_judge_log'; exception when insufficient_privilege then null; end;
  begin
    insert into public.approved_answers (question_id, text, base_score) values ('de-food-001', 'x', 1);
    raise exception 'FAIL: anon schreibt approved_answers';
  exception when insufficient_privilege then null; end;
  begin update public.app_meta set value = 99; raise exception 'FAIL: anon ändert app_meta'; exception when insufficient_privilege then null; end;
  begin perform public.approve_verdict('00000000-0000-4000-8000-0000000000e1', 'x'); raise exception 'FAIL: anon ruft approve_verdict'; exception when insufficient_privilege then null; end;
  begin perform public.reject_verdicts(array['00000000-0000-4000-8000-0000000000e1']::uuid[]); raise exception 'FAIL: anon ruft reject_verdicts'; exception when insufficient_privilege then null; end;
  -- erlaubt: freigegebene Antworten und Revision lesen
  perform 1 from public.approved_answers;
  perform 1 from public.app_meta;
end $$;
reset role;

-- ================================================================ Spieler (angemeldet, kein Admin)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}';

do $$
declare n int;
begin
  if public.is_admin() then raise exception 'FAIL: Spieler ist Admin'; end if;
  select count(*) into n from public.ai_verdicts; if n > 0 then raise exception 'FAIL: Spieler sieht % KI-Urteile', n; end if;
  select count(*) into n from public.admin_verdicts; if n > 0 then raise exception 'FAIL: Spieler sieht admin_verdicts'; end if;
  select count(*) into n from public.admins; if n > 0 then raise exception 'FAIL: Spieler sieht admins'; end if;
  select count(*) into n from public.submissions; if n > 0 then raise exception 'FAIL: Spieler sieht fremde Antworten'; end if;
  begin perform 1 from public.ai_judge_log; raise exception 'FAIL: Spieler liest ai_judge_log'; exception when insufficient_privilege then null; end;

  update public.ai_verdicts set valid = false, review_status = 'rejected' where id = '00000000-0000-4000-8000-0000000000e1';
  get diagnostics n = row_count; if n > 0 then raise exception 'FAIL: Spieler ändert KI-Urteil'; end if;
  begin update public.ai_verdicts set canonical_text = 'x'; raise exception 'FAIL: Spieler ändert canonical_text'; exception when insufficient_privilege then null; end;
  begin delete from public.ai_verdicts; raise exception 'FAIL: Spieler löscht KI-Urteile'; exception when insufficient_privilege then null; end;
  begin
    insert into public.approved_answers (question_id, text, base_score) values ('de-food-001', 'Schummel', 100);
    raise exception 'FAIL: Spieler gibt Antwort frei';
  exception when insufficient_privilege then null; end;
  update public.approved_answers set base_score = 100;
  begin insert into public.admins (user_id) values ('00000000-0000-4000-8000-00000000c001'); raise exception 'FAIL: Spieler macht sich zum Admin'; exception when insufficient_privilege then null; end;
  begin perform public.approve_verdict('00000000-0000-4000-8000-0000000000e1', 'x'); raise exception 'FAIL: Spieler ruft approve_verdict'; exception when insufficient_privilege then null; end;
  begin perform public.reject_verdicts(array['00000000-0000-4000-8000-0000000000e1']::uuid[]); raise exception 'FAIL: Spieler ruft reject_verdicts'; exception when insufficient_privilege then null; end;
  begin perform public.reset_verdicts(array['00000000-0000-4000-8000-0000000000e1']::uuid[]); raise exception 'FAIL: Spieler ruft reset_verdicts'; exception when insufficient_privilege then null; end;
  begin update public.app_meta set value = 99; raise exception 'FAIL: Spieler ändert app_meta'; exception when insufficient_privilege then null; end;
  begin
    insert into public.submissions (user_id, question_id, lang, mode, day, raw_answer, source, score)
    values ('00000000-0000-4000-8000-00000000b001', 'de-food-001', 'de', 'rare', public.berlin_today(), 'fremd', 'list', 100);
    raise exception 'FAIL: Spieler schreibt Antwort für anderen';
  exception when insufficient_privilege then null; end;
  -- erlaubt: eigene Antwort speichern und lesen
  insert into public.submissions (question_id, lang, mode, day, raw_answer, source, score)
  values ('de-food-001', 'de', 'rare', public.berlin_today(), 'eigene', 'list', 10);
  select count(*) into n from public.submissions; if n <> 1 then raise exception 'FAIL: Spieler sieht eigene Antwort nicht (%)', n; end if;
end $$;
reset role;

-- unverändert geblieben?
do $$ begin
  if (select review_status from public.ai_verdicts where id = '00000000-0000-4000-8000-0000000000e1') <> 'pending' then
    raise exception 'FAIL: Urteil wurde von Nicht-Admin verändert';
  end if;
  if exists (select 1 from public.approved_answers where base_score = 100 and text = 'Schummel') then raise exception 'FAIL: Schummel-Freigabe existiert'; end if;
end $$;

-- ================================================================ Admin
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}';

do $$
declare n int; rev0 bigint; rev1 bigint;
begin
  if not public.is_admin() then raise exception 'FAIL: Admin nicht erkannt'; end if;
  select count(*) into n from public.admin_verdicts where id = '00000000-0000-4000-8000-0000000000e1'; if n <> 1 then raise exception 'FAIL: Admin sieht Urteil nicht'; end if;
  select plays into n from public.admin_verdicts where id = '00000000-0000-4000-8000-0000000000e1'; if n <> 0 then raise exception 'FAIL: falsche Spielzahl %', n; end if;
  select value into rev0 from public.app_meta where key = 'review_revision';

  perform public.approve_verdict('00000000-0000-4000-8000-0000000000e1', 'RLS-Testgemüse', array['rls gemuese'], 7);
  if (select review_status from public.ai_verdicts where id = '00000000-0000-4000-8000-0000000000e1') <> 'approved' then raise exception 'FAIL: Freigabe nicht gespeichert'; end if;
  if not exists (select 1 from public.approved_answers where verdict_id = '00000000-0000-4000-8000-0000000000e1' and base_score = 7) then raise exception 'FAIL: approved_answers fehlt'; end if;
  select value into rev1 from public.app_meta where key = 'review_revision'; if rev1 <= rev0 then raise exception 'FAIL: Revision nicht erhöht'; end if;

  -- Zusammenführen überschreibt dieselbe Freigabe
  perform public.approve_verdict('00000000-0000-4000-8000-0000000000e1', 'RLS-Testgemüse', '{}', 80, 'Karotte');
  select count(*) into n from public.approved_answers where verdict_id = '00000000-0000-4000-8000-0000000000e1' and merged_into = 'Karotte'; if n <> 1 then raise exception 'FAIL: Zusammenführen'; end if;

  perform public.reject_verdicts(array['00000000-0000-4000-8000-0000000000e1']::uuid[]);
  if (select valid from public.ai_verdicts where id = '00000000-0000-4000-8000-0000000000e1') then raise exception 'FAIL: Ablehnen setzt valid nicht auf false'; end if;
  if exists (select 1 from public.approved_answers where verdict_id = '00000000-0000-4000-8000-0000000000e1') then raise exception 'FAIL: Ablehnen entfernt Freigabe nicht'; end if;

  perform public.reset_verdicts(array['00000000-0000-4000-8000-0000000000e1']::uuid[]);
  if (select review_status from public.ai_verdicts where id = '00000000-0000-4000-8000-0000000000e1') <> 'pending' then raise exception 'FAIL: Zurücksetzen'; end if;
  if not (select valid from public.ai_verdicts where id = '00000000-0000-4000-8000-0000000000e1') then raise exception 'FAIL: Zurücksetzen stellt KI-Urteil nicht her'; end if;

  -- auch Admins können sich nicht per Tabelle Rechte geben oder den Zähler fälschen
  begin insert into public.admins (user_id) values ('00000000-0000-4000-8000-00000000c001'); raise exception 'FAIL: Admin schreibt admins'; exception when insufficient_privilege then null; end;
  begin update public.app_meta set value = 0; raise exception 'FAIL: Admin ändert app_meta'; exception when insufficient_privilege then null; end;
end $$;
reset role;


-- ================================================================ Konten: Profile & Fortschritt
insert into public.profiles (user_id, display_name, avatar) values ('00000000-0000-4000-8000-00000000b001', 'Bodo Beispiel', 3);
insert into public.player_progress (user_id, snapshot) values ('00000000-0000-4000-8000-00000000b001', '{"version":1,"days":{},"modes":{},"settings":{}}');

set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
do $$
declare n int;
begin
  select count(*) into n from public.profiles; if n < 1 then raise exception 'FAIL: Spielernamen nicht öffentlich lesbar'; end if;
  begin perform 1 from public.player_progress; raise exception 'FAIL: anon liest Fortschritt'; exception when insufficient_privilege then null; end;
  begin insert into public.profiles (user_id, display_name) values ('00000000-0000-4000-8000-00000000b001', 'Hacker'); raise exception 'FAIL: anon schreibt Profil'; exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}';
do $$
declare n int;
begin
  -- eigenes Profil anlegen und ändern geht
  insert into public.profiles (user_id, display_name, avatar) values ('00000000-0000-4000-8000-00000000c001', 'Clara', 1);
  update public.profiles set avatar = 5 where user_id = '00000000-0000-4000-8000-00000000c001';
  -- fremdes Profil: lesbar (Name), aber nicht änderbar/löschbar
  select count(*) into n from public.profiles where display_name = 'Bodo Beispiel'; if n <> 1 then raise exception 'FAIL: fremder Name nicht lesbar'; end if;
  update public.profiles set display_name = 'Gekapert' where user_id = '00000000-0000-4000-8000-00000000b001';
  get diagnostics n = row_count; if n > 0 then raise exception 'FAIL: fremdes Profil geändert'; end if;
  delete from public.profiles where user_id = '00000000-0000-4000-8000-00000000b001';
  get diagnostics n = row_count; if n > 0 then raise exception 'FAIL: fremdes Profil gelöscht'; end if;
  begin
    insert into public.profiles (user_id, display_name) values ('00000000-0000-4000-8000-00000000b001', 'Doppelt');
    raise exception 'FAIL: Profil für anderen angelegt';
  exception when insufficient_privilege or unique_violation then null; end;
  -- Namensregeln: eindeutig (ohne Groß/Klein) und ohne Beleidigungen
  begin update public.profiles set display_name = 'bodo beispiel' where user_id = '00000000-0000-4000-8000-00000000c001'; raise exception 'FAIL: doppelter Name'; exception when unique_violation then null; end;
  begin update public.profiles set display_name = 'Fuck3r' where user_id = '00000000-0000-4000-8000-00000000c001'; raise exception 'FAIL: Beleidigung als Name'; exception when check_violation then null; end;
  -- Fortschritt: nur der eigene
  select count(*) into n from public.player_progress; if n <> 0 then raise exception 'FAIL: fremder Fortschritt sichtbar'; end if;
  insert into public.player_progress (user_id, snapshot) values ('00000000-0000-4000-8000-00000000c001', '{"version":1}');
  select count(*) into n from public.player_progress; if n <> 1 then raise exception 'FAIL: eigener Fortschritt nicht sichtbar'; end if;
  update public.player_progress set snapshot = '{"x":1}' where user_id = '00000000-0000-4000-8000-00000000b001';
  get diagnostics n = row_count; if n > 0 then raise exception 'FAIL: fremden Fortschritt geändert'; end if;
  begin
    insert into public.player_progress (user_id, snapshot) values ('00000000-0000-4000-8000-00000000b001', '{}');
    raise exception 'FAIL: Fortschritt für anderen gespeichert';
  exception when insufficient_privilege or unique_violation then null; end;
end $$;
reset role;

-- ================================================================ Admin-Dashboard: Nicht-Admin bekommt nichts
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}';

do $$
declare n int;
begin
  begin perform public.admin_overview(); raise exception 'FAIL: Spieler ruft admin_overview'; exception when insufficient_privilege then null; end;
  begin perform * from public.admin_players(); raise exception 'FAIL: Spieler ruft admin_players'; exception when insufficient_privilege then null; end;
  begin perform public.admin_set_ban('00000000-0000-4000-8000-00000000a001', true, 'x'); raise exception 'FAIL: Spieler sperrt'; exception when insufficient_privilege then null; end;
  begin perform public.admin_reset_name('00000000-0000-4000-8000-00000000a001'); raise exception 'FAIL: Spieler setzt Namen zurück'; exception when insufficient_privilege then null; end;
  begin perform * from public.admin_question_stats('de-food-001'); raise exception 'FAIL: Spieler ruft admin_question_stats'; exception when insufficient_privilege then null; end;
  begin perform * from public.admin_question_flags(); raise exception 'FAIL: Spieler ruft admin_question_flags'; exception when insufficient_privilege then null; end;
  begin perform public.log_admin('fake', null); raise exception 'FAIL: Spieler schreibt admin_log'; exception when insufficient_privilege then null; end;
  begin insert into public.admin_log (action) values ('fake'); raise exception 'FAIL: Spieler schreibt admin_log direkt'; exception when insufficient_privilege then null; end;
  select count(*) into n from public.admin_log; if n > 0 then raise exception 'FAIL: Spieler liest admin_log'; end if;
  begin perform 1 from public.player_bans; raise exception 'FAIL: Spieler liest player_bans'; exception when insufficient_privilege then null; end;
  -- Debug-Runden nur für Admins, normale Runden nur „heute“
  begin
    insert into public.submissions (question_id, lang, mode, day, raw_answer, source, score, is_debug)
    values ('de-food-002', 'de', 'rare', public.berlin_today(), 'debug', 'list', 100, true);
    raise exception 'FAIL: Spieler speichert Debug-Runde';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.submissions (question_id, lang, mode, day, raw_answer, source, score)
    values ('de-food-002', 'de', 'rare', public.berlin_today() + 5, 'zukunft', 'list', 100);
    raise exception 'FAIL: Spieler datiert Runde vor';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ================================================================ Admin-Dashboard: Admin
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}';

do $$
declare n int; n0 int; o jsonb; o0 jsonb;
begin
  o0 := public.admin_overview();
  -- Debug-Runde (auch an einem verschobenen Tag) ist erlaubt …
  insert into public.submissions (question_id, lang, mode, day, raw_answer, normalized_answer, source, score, is_debug)
  values ('de-food-001', 'de', 'rare', public.berlin_today() + 3, 'rlstestgemuese', 'rlstestgemuese', 'ai', 85, true);
  -- … zählt aber nirgends: Häufigkeit, Fragen-Statistik, Übersicht
  select plays into n from public.admin_verdicts where id = '00000000-0000-4000-8000-0000000000e1'; if n <> 0 then raise exception 'FAIL: Debug-Runde zählt in plays (%)', n; end if;
  select count(*) into n from public.admin_question_stats('de-food-001') where answer like '%rlstestgemuese%'; if n > 0 then raise exception 'FAIL: Debug-Runde in Fragen-Statistik'; end if;
  o := public.admin_overview();
  if (o ->> 'debug_today')::int < 1 then raise exception 'FAIL: Debug-Runde nicht als Debug gezählt'; end if;
  if o -> 'rounds_week' is distinct from o0 -> 'rounds_week' or o -> 'active_week' is distinct from o0 -> 'active_week' then
    raise exception 'FAIL: Debug-Runde zählt in der Übersicht (% → %)', o0 -> 'rounds_week', o -> 'rounds_week';
  end if;
  -- Spielerliste ohne E-Mails
  select count(*) into n from public.admin_players() p where p.user_id = '00000000-0000-4000-8000-00000000c001'; if n <> 1 then raise exception 'FAIL: Spieler fehlt in Liste'; end if;
  -- sperren → protokolliert
  perform public.admin_set_ban('00000000-0000-4000-8000-00000000c001', true, 'Spam im KI-Check');
  select count(*) into n from public.admin_log where action = 'player.ban' and target = '00000000-0000-4000-8000-00000000c001'; if n <> 1 then raise exception 'FAIL: Sperre nicht protokolliert'; end if;
  begin perform public.admin_set_ban('00000000-0000-4000-8000-00000000a001', true); raise exception 'FAIL: Admin sperrt sich selbst'; exception when invalid_parameter_value then null; end;
  -- Name zurücksetzen → protokolliert
  if public.admin_reset_name('00000000-0000-4000-8000-00000000c001') is null then raise exception 'FAIL: Name nicht zurückgesetzt'; end if;
  select count(*) into n from public.admin_log where action = 'player.reset_name' and target = '00000000-0000-4000-8000-00000000c001'; if n <> 1 then raise exception 'FAIL: Namensreset nicht protokolliert'; end if;
  -- Prüfentscheidung → automatisch protokolliert
  perform public.reset_verdicts(array['00000000-0000-4000-8000-0000000000e1']::uuid[]);
  select count(*) into n0 from public.admin_log where action = 'verdict.rejected';
  perform public.reject_verdicts(array['00000000-0000-4000-8000-0000000000e1']::uuid[]);
  select count(*) into n from public.admin_log where action = 'verdict.rejected'; if n <> n0 + 1 then raise exception 'FAIL: Ablehnen nicht protokolliert'; end if;
end $$;
reset role;

-- ================================================================ Gesperrter Spieler
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}';

do $$ begin
  if not public.is_banned() then raise exception 'FAIL: Sperre nicht erkannt'; end if;
  begin
    insert into public.submissions (question_id, lang, mode, day, raw_answer, source, score)
    values ('de-food-003', 'de', 'common', public.berlin_today(), 'gesperrt', 'list', 10);
    raise exception 'FAIL: gesperrter Spieler speichert Antwort';
  exception when insufficient_privilege then null; end;
  update public.profiles set display_name = 'Wieder Da' where user_id = '00000000-0000-4000-8000-00000000c001';
  raise exception 'FAIL: gesperrter Spieler ändert Namen';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ================================================================ Konto löschen: alle Daten verschwinden
do $$
declare n int;
begin
  delete from auth.users where id = '00000000-0000-4000-8000-00000000b001';
  select count(*) into n from public.submissions where user_id = '00000000-0000-4000-8000-00000000b001'; if n > 0 then raise exception 'FAIL: Antworten nach Konto-Löschung übrig'; end if;
  select count(*) into n from public.profiles where user_id = '00000000-0000-4000-8000-00000000b001'; if n > 0 then raise exception 'FAIL: Profil nach Konto-Löschung übrig'; end if;
  select count(*) into n from public.player_progress where user_id = '00000000-0000-4000-8000-00000000b001'; if n > 0 then raise exception 'FAIL: Fortschritt nach Konto-Löschung übrig'; end if;
end $$;

select 'RLS-Tests bestanden' as result;
rollback;
