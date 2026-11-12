/**
 * Robustheit des Freunde-Modus gegen das echte Projekt (Etappe D):
 *  1. Später Beitretende spielen erst ab der nächsten Frage (Abgabe vorher abgelehnt)
 *  2. „Reload“: Zustand vom Server inkl. eigener Abgabe, keine Doppelabgabe
 *  3. Gastgeber verschwindet (kein Herzschlag mehr) → Rolle geht an den nächsten
 *  4. Verpasste Frage = 0 Punkte
 *
 *   node scripts/room-robust.mjs
 */
import { assert, bots, call, listAnswers, sleep, state, waitFor } from './lib/room-bots.mjs';

const [host, b, c, late] = await bots(4);
const r = await call(host, 'create', { name: host.name, settings: { mode: 'common', scoring: 'group', count: 5, seconds: 15, lang: 'de' } });
const code = r.body.code;
for (const p of [b, c]) assert((await call(p, 'join', { code, name: p.name })).status === 200, 'join');
assert((await call(host, 'start', { code })).status === 200, 'start');
let st = await waitFor(b, code, (s) => s.status === 'question');
console.log('Raum', code, '– Frage', st.index + 1);

// 1. später Beitretender
assert((await call(late, 'join', { code, name: late.name })).status === 200, 'late join');
const lateState = await state(late, code);
const meLate = lateState.players.find((p) => p.user_id === late.id);
assert(meLate.from_index === st.index + 1, `from_index ${meLate.from_index}`);
const lateAns = await call(late, 'answer', { code, idx: st.index, answer: 'Hund' });
assert(lateAns.status === 403 && lateAns.body.error === 'not_playing', `später Beitretender durfte antworten: ${JSON.stringify(lateAns.body)}`);
console.log('1 später Beitretender steigt erst ab der nächsten Frage ein ✓');

// 2. Reload: eigene Abgabe kommt vom Server, keine Doppelabgabe
const word = (await listAnswers(code, st.index))[0].text;
await call(b, 'answer', { code, idx: st.index, answer: word });
const reloaded = await state(b, code);
assert(reloaded.my_answer === word, 'eigene Abgabe nach Reload fehlt');
const dup = await call(b, 'answer', { code, idx: st.index, answer: 'Maus' });
assert(dup.status === 409, 'Doppelabgabe nach Reload angenommen');
console.log('2 Reload: Abgabe vom Server, keine Doppelabgabe ✓');

// 4. c antwortet nicht → 0 Punkte; host antwortet
await call(host, 'answer', { code, idx: st.index, answer: word });
st = await waitFor(b, code, (s) => s.status === 'reveal', 40_000);
assert(st.reveal.missed.includes(c.id) && st.reveal.players[c.id].points === 0, 'verpasste Frage ≠ 0 Punkte');
assert(st.reveal.players[b.id].points === 100, 'gleiche Antwort im Aufstieg ≠ 100');
console.log(`4 verpasste Frage = 0 Punkte ✓ (${word}×2 = 100 im Aufstieg)`);

// 3. Gastgeber verschwindet: ab jetzt fragt er nichts mehr ab; die anderen halten den Raum am Laufen
console.log('3 Gastgeber schweigt – warte auf Übergabe (≤ 60 s) …');
const t0 = Date.now();
for (;;) {
  const s = await state(b, code);
  await state(c, code);
  await state(late, code);
  if (s.host_id !== host.id) {
    console.log(`  neuer Gastgeber: ${s.players.find((p) => p.user_id === s.host_id)?.name} nach ${Math.round((Date.now() - t0) / 1000)} s ✓`);
    break;
  }
  assert(Date.now() - t0 < 70_000, 'Gastgeber wurde nicht übergeben');
  await call(b, 'tick', { code });
  await sleep(3000);
}
for (const p of [host, b, c, late]) await call(p, 'leave', { code });
console.log('Robustheit OK');
process.exit(0);
