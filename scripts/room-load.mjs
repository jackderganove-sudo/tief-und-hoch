/**
 * Lasttest Freunde-Modus: N anonyme Bots (Standard 30) spielen eine komplette Runde,
 * alle mit eigenem Realtime-Kanal. Misst Antwortzeiten der Function und die Zeit
 * bis zur Auflösung; prüft, dass jede Ankündigung bei allen ankommt.
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
        await sleep(500 + Math.random() * 6000);
        // Verteilung: viele gleiche, einige seltene, ein paar Unsinn
        const text = list.length ? list[[0, 0, 0, 1, 1, 2, 3, 4, list.length - 1][i % 9] % list.length].text : 'Bot-Antwort';
        const t = Date.now();
        const r = await call(p, 'answer', { code, idx: st.index, answer: i % 11 === 10 ? 'qwxz' : text });
        answerT.push(Date.now() - t);
        assert(r.status === 200 || r.body.error === 'too_late', `answer ${p.name}: ${JSON.stringify(r.body)}`);
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
