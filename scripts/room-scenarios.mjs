/**
 * Wertungs-Szenarien des Freunde-Modus gegen das echte Projekt (Etappe B):
 *   1. Gruppe/Abstieg mit Listen-Antworten inkl. Tippfehler (Zusammenfassen)
 *   2. Global/Aufstieg: Punkte wie im normalen Spiel
 *   3. Eigene Fragen (KI-Prüfung) + Korrektur durch den Gastgeber + spontane Frage
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
console.log('Szenarien OK');
process.exit(0);
