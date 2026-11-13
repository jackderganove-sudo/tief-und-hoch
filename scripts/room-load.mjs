/**
 * Lasttest Freunde-Modus: N anonyme Bots (Standard 30) spielen eine komplette Runde,
 * alle mit eigenem Realtime-Kanal. Misst Antwortzeiten der Function und die Zeit
 * bis zur Auflösung; prüft, dass jede Ankündigung bei allen ankommt.
 *
 * Mehrere Versuche: Die Bots raten erst 0–3-mal falsch (Tippsalat, der nie an die KI geht),
 * dann richtig; jeder elfte findet gar nichts Gültiges. Geprüft wird, dass nur die erste
 * gültige Antwort zählt und die Versuche korrekt gezählt werden.
 *
 *   node scripts/room-load.mjs [30] [--code=ABCDEF   in einen bestehenden Raum (Gastgeber startet)]
 */
import { assert, bots, call, listAnswers, sleep, state } from './lib/room-bots.mjs';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 30);
const joinCode = process.argv.find((a) => a.startsWith('--code='))?.slice(7);
const t0 = Date.now();
const players = await bots(N, 'Bot');
console.log(`${N} Bots angemeldet in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const host = players[0];
let code = joinCode;
if (!code) {
  const r = await call(host, 'create', { name: host.name, settings: { mode: 'rare', scoring: 'group', count: 5, seconds: 15, lang: 'de' } });
  assert(r.status === 200, `create ${JSON.stringify(r.body)}`);
  code = r.body.code;
}
const joinT = [];
await Promise.all(
  (joinCode ? players : players.slice(1)).map(async (p) => {
    const t = Date.now();
    const j = await call(p, 'join', { code, name: p.name, avatar: Math.floor(Math.random() * 12) });
    joinT.push(Date.now() - t);
    assert(j.status === 200, `join ${p.name}: ${JSON.stringify(j.body)}`);
  }),
);
console.log(`Raum ${code}: ${N} Spieler, Beitritt p50 ${pct(joinT, 50)} ms, p95 ${pct(joinT, 95)} ms`);

// Jeder Bot hört mit (wie echte Geräte)
const received = new Map(players.map((p) => [p.id, 0]));
const chans = await Promise.all(
  players.map(
    (p) =>
      new Promise((resolve) => {
        const ch = p.sb
          .channel(`room:${code}`)
          .on('broadcast', { event: '*' }, () => received.set(p.id, received.get(p.id) + 1))
          .subscribe((s) => s === 'SUBSCRIBED' && resolve(ch));
      }),
  ),
);
console.log(`${chans.length} Realtime-Kanäle verbunden`);

if (!joinCode) assert((await call(host, 'start', { code })).status === 200, 'start');
else console.log('Warte auf den Start durch den Gastgeber …');

const answerT = [];
const revealDelay = [];
let attemptsSent = 0;
const expected = new Map();
let lastIdx = -1;
for (;;) {
  const st = await state(host, code);
  if (st.status === 'finished') break;
  if (st.status === 'question' && st.index !== lastIdx) {
    lastIdx = st.index;
    const list = st.question.custom ? [] : (await listAnswers(code, st.index)).sort((a, b) => b.baseScore - a.baseScore);
    const startedAt = Date.now();
    await Promise.all(
      players.map(async (p, i) => {
        await sleep(300 + Math.random() * 3000);
        // Verteilung: viele gleiche, einige seltene; jeder elfte findet nichts Gültiges
        const text = list.length ? list[[0, 0, 0, 1, 1, 2, 3, 4, list.length - 1][i % 9] % list.length].text : 'Bot-Antwort';
        const hopeless = i % 11 === 10;
        // erst falsch raten (ohne KI: Wiederholungen, Zahlen, Sonderzeichen), dann die richtige Antwort
        const wrong = ['zzzz', '12345', 'hahaha', '?!?', 'xyxyxy'].slice(0, hopeless ? 5 : i % 4);
        for (const w of [...wrong, ...(hopeless ? [] : [text])]) {
          const t = Date.now();
          const r = await call(p, 'answer', { code, idx: st.index, answer: w });
          answerT.push(Date.now() - t);
          attemptsSent++;
          assert(r.status === 200 || r.body.error === 'too_late', `answer ${p.name}: ${JSON.stringify(r.body)}`);
          if (r.status !== 200) break;
          assert(r.body.accepted === (w === text), `„${w}“ ${r.body.accepted ? 'angenommen' : 'abgelehnt'}: ${JSON.stringify(r.body)}`);
          await sleep(150 + Math.random() * 500);
        }
        expected.set(p.id, { tries: wrong.length + (hopeless ? 0 : 1), valid: !hopeless });
      }),
    );
    const allIn = Date.now();
    // bis zur Auflösung (alle haben geantwortet → sofort)
    for (;;) {
      const s = await state(players[1] ?? host, code);
      if (s.status === 'reveal' || s.status === 'finished') break;
      await call(host, 'tick', { code });
      await sleep(300);
    }
    revealDelay.push(Date.now() - allIn);
    const s = await state(host, code);
    // nur die erste gültige Antwort zählt; Versuche stimmen; wer nichts Gültiges fand, hat 0 Punkte
    if (list.length) {
      for (const p of players) {
        const e = expected.get(p.id);
        const got = s.reveal.players[p.id];
        if (!e || !got) continue;
        assert(got.attempts === e.tries, `${p.name}: ${got.attempts} Versuche gezählt statt ${e.tries}`);
        assert(e.valid ? got.points > 0 : got.points === 0, `${p.name}: ${got.points} Punkte bei ${e.valid ? 'gültiger' : 'keiner gültigen'} Antwort`);
      }
      assert(s.reveal.groups.filter((g) => g.valid).every((g) => !['zzzz', '12345', 'hahaha', '?!?', 'xyxyxy'].includes(g.text)), 'Fehlversuch als gültige Gruppe');
    }
    expected.clear();
    console.log(
      `  Frage ${st.index + 1}/${st.count}: ${((Date.now() - startedAt) / 1000).toFixed(1)} s, Gruppen ${s.reveal.groups
        .slice(0, 4)
        .map((g) => `${g.text}×${g.count}=${g.points}`)
        .join(', ')} …`,
    );
    if (!joinCode) await call(host, 'next', { code });
  }
  await call(host, 'tick', { code });
  await sleep(800);
}
const final = await state(host, code);
assert(final.players.length >= N, `Spieler am Ende: ${final.players.length}`);
const counts = [...received.values()];
console.log(`${attemptsSent} Versuche gesendet (richtige und falsche)`);
console.log(`Antwort-Aufrufe: p50 ${pct(answerT, 50)} ms, p95 ${pct(answerT, 95)} ms, max ${Math.max(...answerT)} ms`);
console.log(`Alle geantwortet → Auflösung: p50 ${pct(revealDelay, 50)} ms, max ${Math.max(...revealDelay)} ms`);
console.log(`Realtime-Ankündigungen pro Gerät: min ${Math.min(...counts)}, max ${Math.max(...counts)}, gesamt ${counts.reduce((a, b) => a + b, 0)}`);
assert(Math.min(...counts) > 0.8 * Math.max(...counts), 'einige Geräte haben deutlich weniger Ankündigungen bekommen');
console.log(`Lasttest OK in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const p of players) await p.sb.removeAllChannels();
if (!joinCode) for (const p of players) await call(p, 'leave', { code });
process.exit(0);

function pct(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
}
