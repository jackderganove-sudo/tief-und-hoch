/**
 * Wertungs-Szenarien des Freunde-Modus gegen das echte Projekt (Etappe B):
 *   1. Gruppe/Abstieg mit Listen-Antworten inkl. Tippfehler (Zusammenfassen)
 *   2. Global/Aufstieg: Punkte wie im normalen Spiel
 *   3. Eigene Fragen (KI-Prüfung) + Korrektur durch den Gastgeber + spontane Frage
 *   4. Mehrere Versuche: einzeln geprüft, nur die erste gültige zählt, nach Ablauf nichts mehr,
 *      doppelte sofort abgelehnt, höchstens 3 KI-Prüfungen, Fehlversuche nur mit Raum-Einstellung
 *
 *   node scripts/room-scenarios.mjs
 */
import { assert, bots, call, listAnswers, sleep, state, waitFor } from './lib/room-bots.mjs';

const [host, b, c, d] = await bots(4);
const all = [host, b, c, d];

async function room(settings) {
  const r = await call(host, 'create', { name: host.name, avatar: 3, settings });
  assert(r.status === 200, `create ${JSON.stringify(r.body)}`);
  for (const p of [b, c, d]) assert((await call(p, 'join', { code: r.body.code, name: p.name })).status === 200, 'join');
  const s = await call(host, 'start', { code: r.body.code });
  assert(s.status === 200, `start ${JSON.stringify(s.body)}`);
  return r.body.code;
}
const typo = (t) => (t.length > 5 ? t.slice(0, -2) + t.at(-1) + t.at(-2) : t);

// ---------------------------------------------------------------- 1. Gruppe, Abstieg
{
  const code = await room({ mode: 'rare', scoring: 'group', source: 'random', count: 5, seconds: 15, lang: 'de' });
  const st = await waitFor(host, code, (s) => s.status === 'question');
  const list = (await listAnswers(code, st.index)).sort((x, y) => y.baseScore - x.baseScore);
  const [a0, a1] = list;
  // host + b: dieselbe Antwort (b mit Tippfehler), c: andere Listen-Antwort, d: Unsinn
  await Promise.all([
    call(host, 'answer', { code, idx: st.index, answer: a0.text }),
    call(b, 'answer', { code, idx: st.index, answer: typo(a0.text) }),
    call(c, 'answer', { code, idx: st.index, answer: a1.text }),
    call(d, 'answer', { code, idx: st.index, answer: 'xqzv blorp' }),
  ]);
  const rv = await waitFor(host, code, (s) => s.status === 'reveal');
  const r = rv.reveal;
  console.log('1 Gruppe/Abstieg:', r.groups.map((g) => `${g.text}×${g.count}=${g.points}${g.special ? ` (${g.special})` : ''}`).join(', '));
  assert(r.players[host.id].group === r.players[b.id].group, 'Tippfehler nicht zusammengefasst');
  assert(r.players[host.id].points === 30 && r.players[c.id].points === 100 && r.players[c.id].special === 'only_you', 'Gruppenwertung Abstieg falsch');
  assert(r.players[d.id].points === 0, 'Unsinn bekam Punkte');
  assert(r.players[b.id].answer === typo(a0.text), 'Original-Schreibweise fehlt');
  assert(rv.players.find((p) => p.user_id === c.id).points === 100, 'Zwischenstand falsch');
  await call(host, 'leave', { code });
  for (const p of [b, c, d]) await call(p, 'leave', { code });
}

// ---------------------------------------------------------------- 2. Global, Aufstieg
{
  const code = await room({ mode: 'common', scoring: 'global', source: 'topics', topics: ['food', 'animals'], count: 5, seconds: 15, lang: 'de' });
  const st = await waitFor(host, code, (s) => s.status === 'question');
  assert(['food', 'animals'].includes(st.question.topic), `Thema nicht aus der Auswahl: ${st.question.topic}`);
  const list = (await listAnswers(code, st.index)).sort((x, y) => y.baseScore - x.baseScore);
  await Promise.all(all.map((p, i) => call(p, 'answer', { code, idx: st.index, answer: list[i === 3 ? list.length - 1 : 0].text })));
  const rv = await waitFor(host, code, (s) => s.status === 'reveal');
  const r = rv.reveal;
  console.log('2 Global/Aufstieg:', r.groups.map((g) => `${g.text}×${g.count}=${g.points}`).join(', '));
  const expectTop = list[0].baseScore >= 80 ? 100 : list[0].baseScore >= 55 ? 85 : list[0].baseScore >= 30 ? 60 : list[0].baseScore >= 12 ? 30 : 10;
  assert(r.players[host.id].points === expectTop, `globale Punkte ${r.players[host.id].points} statt ${expectTop}`);
  for (const p of all) await call(p, 'leave', { code });
}

// ---------------------------------------------------------------- 3. Eigene Fragen + Korrektur + spontane Frage
{
  const code = await room({ mode: 'rare', scoring: 'global', source: 'custom', custom_prompts: ['Nenne eine Farbe'], count: 5, seconds: 15, lang: 'de' });
  let st = await waitFor(host, code, (s) => s.status === 'question');
  assert(st.settings.scoring === 'group', 'eigene Fragen nicht auf „Gruppe“ umgestellt');
  assert(st.question.custom && st.question.prompt === 'Nenne eine Farbe', 'eigene Frage fehlt');
  await Promise.all([
    call(host, 'answer', { code, idx: st.index, answer: 'Rot' }),
    call(b, 'answer', { code, idx: st.index, answer: 'rot' }),
    call(c, 'answer', { code, idx: st.index, answer: 'Türkis' }),
    call(d, 'answer', { code, idx: st.index, answer: 'Bratwurst' }),
  ]);
  st = await waitFor(host, code, (s) => s.status === 'reveal', 40_000);
  const r = st.reveal;
  console.log('3 Eigene Frage (KI):', r.groups.map((g) => `${g.text}×${g.count}${g.valid ? '' : ' ✗'}=${g.points}`).join(', '));
  assert(r.players[host.id].group === r.players[b.id].group && r.players[host.id].points === 30, 'Rot/rot nicht zusammengefasst');
  assert(r.players[c.id].points === 100, 'Türkis nicht „Nur du!“');
  assert(r.players[d.id].points === 0, 'Bratwurst als Farbe gewertet');
  // Gastgeber korrigiert: Bratwurst doch gültig → einzigartig = 100
  const o = await call(host, 'override', { code, user_ids: [d.id], valid: true });
  assert(o.status === 200, `override ${JSON.stringify(o.body)}`);
  const st2 = await state(host, code);
  console.log('   nach Korrektur:', st2.reveal.groups.map((g) => `${g.text}×${g.count}${g.valid ? '' : ' ✗'}=${g.points}`).join(', '));
  assert(st2.reveal.players[d.id].points === 100, 'Korrektur nicht gewertet');
  const forbidden = await call(b, 'override', { code, user_ids: [b.id], valid: true });
  assert(forbidden.status === 403, 'Gast darf korrigieren');
  // spontane eigene Frage zwischen den Runden
  const n = await call(host, 'next', { code, custom_prompt: 'Nenne ein Haustier' });
  assert(n.status === 200, `next ${JSON.stringify(n.body)}`);
  const st3 = await waitFor(host, code, (s) => s.status === 'question' && s.index === 1);
  assert(st3.question.prompt === 'Nenne ein Haustier' && st3.count === 2, `spontane Frage fehlt (${st3.question.prompt}, ${st3.count})`);
  console.log('   spontane Frage eingeschoben ✓');
  for (const p of all) await call(p, 'leave', { code });
}

// ---------------------------------------------------------------- 4. Mehrere Versuche
for (const show of [false, true]) {
  const code = await room({ mode: 'rare', scoring: 'group', source: 'random', count: 5, seconds: 40, lang: 'de', show_attempts: show });
  const st = await waitFor(host, code, (s) => s.status === 'question');
  assert(st.settings.show_attempts === show, 'Einstellung „Fehlversuche zeigen“ nicht übernommen');
  const list = (await listAnswers(code, st.index)).sort((x, y) => y.baseScore - x.baseScore);
  const idx = st.index;
  const ans = (p, answer) => call(p, 'answer', { code, idx, answer });

  // d rät währenddessen nur falsch (vier echte Wörter → KI höchstens 3-mal)
  const wrong = ['Betonmischer', 'Gabelstapler', 'Regenschirm', 'Kugelschreiber'];
  const dTries = (async () => {
    const out = [];
    for (const w of wrong) out.push((await ans(d, w)).body);
    return out;
  })();

  // b: Unsinn (ohne KI), echtes falsches Wort (KI), doppelt, dann gültig
  const b1 = await ans(b, 'aaaa');
  assert(b1.status === 200 && b1.body.accepted === false && b1.body.reason === 'invalid' && b1.body.ai_left === 3, `Unsinn: ${JSON.stringify(b1.body)}`);
  const b2 = await ans(b, 'Ziegelstein');
  assert(b2.body.accepted === false && b2.body.reason === 'invalid' && b2.body.attempts === 2, `falsches Wort: ${JSON.stringify(b2.body)}`);
  const b3 = await ans(b, ' ZIEGELSTEIN ');
  assert(b3.body.accepted === false && b3.body.reason === 'duplicate' && b3.body.attempts === 2, `doppelt: ${JSON.stringify(b3.body)}`);
  // während b noch rät: andere sehen nur die Anzahl, kein Häkchen, nie den Inhalt
  const mid = await state(host, code);
  const bMid = mid.players.find((p) => p.user_id === b.id);
  assert(bMid.answered === false && bMid.attempts === 2, `„versucht es noch“ falsch: ${JSON.stringify(bMid)}`);
  assert(!JSON.stringify(mid).includes('Ziegelstein'), 'fremder Fehlversuch im Zustand sichtbar');
  const mine = await state(b, code);
  assert(JSON.stringify(mine.my_attempts) === JSON.stringify(['aaaa', 'Ziegelstein']) && mine.my_answer === null, `eigene Versuche: ${JSON.stringify(mine.my_attempts)}`);
  const b4 = await ans(b, list[0].text);
  assert(b4.body.accepted === true && b4.body.attempts === 3, `gültig im 3. Versuch: ${JSON.stringify(b4.body)}`);
  // nach der gültigen Antwort zählt nichts mehr
  const b5 = await ans(b, list[1].text);
  assert(b5.status === 409 && b5.body.error === 'already_answered', `zweite gültige Antwort angenommen: ${JSON.stringify(b5.body)}`);
  assert((await state(host, code)).players.find((p) => p.user_id === b.id).answered === true, 'Häkchen fehlt nach gültiger Antwort');

  // host und c: gültig auf Anhieb; d: nur Fehlversuche, KI höchstens 3-mal
  assert((await ans(host, list[0].text)).body.accepted === true, 'host');
  assert((await ans(c, list[1].text)).body.accepted === true, 'c');
  const replies = await dTries;
  assert(replies.every((r) => r.accepted === false), `d: ${JSON.stringify(replies)}`);
  assert(replies[3].reason === 'list_only' && replies[3].ai_left === 0, `4. KI-Versuch nicht gesperrt: ${JSON.stringify(replies)}`);
  // die Liste zählt auch nach dem KI-Limit weiter – aber d bleibt absichtlich ohne gültige Antwort
  assert((await state(host, code)).status === 'question', 'Frage endete, obwohl d noch rät');

  const rv = await waitFor(host, code, (s) => s.status === 'reveal', 70_000);
  // nach Ablauf der Fragezeit: keine Versuche mehr
  const late = await ans(d, list[2]?.text ?? list[0].text);
  assert(late.status === 409 && late.body.error === 'too_late', `Versuch nach Ablauf angenommen: ${JSON.stringify(late.body)}`);
  const r = rv.reveal;
  console.log(`4 Mehrere Versuche (Fehlversuche ${show ? 'an' : 'aus'}):`, r.groups.map((g) => `${g.text}×${g.count}${g.valid ? '' : ' ✗'}=${g.points}`).join(', '), '· Versuche', [host, b, c, d].map((p) => r.players[p.id].attempts).join('/'));
  // nur die akzeptierte Antwort zählt: host + b dieselbe Gruppe, b trotz zwei Fehlversuchen
  assert(r.players[host.id].group === r.players[b.id].group && r.players[b.id].points === r.players[host.id].points && r.players[b.id].points > 0, 'b nicht mit der akzeptierten Antwort gewertet');
  assert(r.players[c.id].points === 100, 'c (einzige mit dieser Antwort) nicht 100');
  assert(r.players[d.id].points === 0 && r.players[d.id].answer === 'Kugelschreiber', `d: ${JSON.stringify(r.players[d.id])}`);
  assert(r.players[b.id].attempts === 3 && r.players[d.id].attempts === 4 && r.players[host.id].attempts === 1, 'Anzahl der Versuche in der Auflösung falsch');
  assert(r.groups.filter((g) => g.valid).every((g) => !['Ziegelstein', 'aaaa'].includes(g.text)), 'Fehlversuch als Gruppe gewertet');
  if (show) {
    const texts = (r.funny ?? []).map((f) => f.text);
    assert(texts.includes('Ziegelstein') && texts.includes('Betonmischer'), `Fehlversuche fehlen: ${JSON.stringify(r.funny)}`);
    assert(!texts.includes('Kugelschreiber'), 'letzter Versuch doppelt (steht schon bei „ungültig“)');
  } else {
    assert(r.funny === null && !JSON.stringify(r).includes('Ziegelstein'), 'Fehlversuche sichtbar, obwohl der Raum es nicht erlaubt');
  }
  for (const p of all) await call(p, 'leave', { code });
}
console.log('Szenarien OK');
process.exit(0);
