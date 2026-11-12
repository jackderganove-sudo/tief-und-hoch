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
values ('00000000-0000-4000-8000-00000000b001', 'de-food-001', 'de', 'rare', '2000-01-01', 'geheim', 'geheim', 'list', 10);

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
    values ('00000000-0000-4000-8000-00000000b001', 'de-food-001', 'de', 'rare', '2000-01-02', 'fremd', 'list', 100);
    raise exception 'FAIL: Spieler schreibt Antwort für anderen';
  exception when insufficient_privilege then null; end;
  -- erlaubt: eigene Antwort speichern und lesen
  insert into public.submissions (question_id, lang, mode, day, raw_answer, source, score)
  values ('de-food-001', 'de', 'rare', '2000-01-03', 'eigene', 'list', 10);
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

select 'RLS-Tests bestanden' as result;
rollback;
