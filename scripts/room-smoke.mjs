/**
 * Freunde-Modus Ende-zu-Ende gegen das echte Supabase-Projekt:
 * mehrere anonyme Clients spielen eine komplette Runde.
 *
 *   node scripts/room-smoke.mjs [spieler=3] [--code=ABCDEF zum Beitreten in einen bestehenden Raum]
 *
 * Prüft: Erstellen/Beitreten, Start, Antworten (einmal, nur in der Fragephase),
 * Abgabe nach Ablauf abgelehnt, Antworten erst in der Auflösung sichtbar,
 * Realtime-Ankündigungen, Endstand.
 */
import { assert, bots, call, listAnswers, sleep, state } from './lib/room-bots.mjs';
const smart = process.argv.includes('--smart');
const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3);
const joinCode = process.argv.find((a) => a.startsWith('--code='))?.slice(7);

const ANSWERS = { de: ['Tomate', 'Apfel', 'Hund', 'Rot', 'Pizza', 'Berlin', 'Fußball', 'Mario'], en: ['Tomato', 'Apple', 'Dog', 'Red', 'Pizza'] };

const t0 = Date.now();
const players = await bots(N);
const host = players[0];
let code = joinCode;
if (!code) {
  const c = await call(host, 'create', { name: host.name, avatar: 1, settings: { mode: 'rare', scoring: 'group', count: 5, seconds: 15, lang: 'de' } });
  assert(c.status === 200, `create ${JSON.stringify(c.body)}`);
  code = c.body.code;
}
console.log('Raum', code);
for (const p of joinCode ? players : players.slice(1)) {
  const j = await call(p, 'join', { code, name: p.name, avatar: 2 });
  assert(j.status === 200, `join ${p.name}: ${JSON.stringify(j.body)}`);
}
const dup = await call(players[1] ?? host, 'join', { code, name: host.name });
if (players.length > 1) assert(dup.status === 409 && dup.body.error === 'name_taken', `doppelter Name nicht abgelehnt: ${JSON.stringify(dup.body)}`);

// Realtime mithören (Ankündigungen ohne Inhalt)
let events = 0;
const ch = host.sb.channel(`room:${code}`).on('broadcast', { event: '*' }, () => events++);
await new Promise((r) => ch.subscribe((s) => s === 'SUBSCRIBED' && r()));

if (joinCode) {
  console.log(`${N} Bots im Raum ${code} – warte auf den Start durch den Gastgeber …`);
} else {
  const s = await call(host, 'start', { code });
  assert(s.status === 200, `start ${JSON.stringify(s.body)}`);
}

let lastIdx = -1;
const smartCache = {};
let checkedLate = false;
for (;;) {
  const st = await state(host, code);
  if (st.status === 'finished') {
    const ranking = [...st.players].sort((a, b) => b.points - a.points).map((p) => `${p.name} ${p.points}`);
    console.log('Ende:', ranking.slice(0, 5).join(', '), ranking.length > 5 ? `… (${ranking.length})` : '');
    assert((st.reveals ?? []).length === st.count, 'Auflösungen fürs Endbild fehlen');
    break;
  }
  if (st.status === 'question' && st.index !== lastIdx) {
    lastIdx = st.index;
    // Gastfenster: Antworten anderer dürfen nicht sichtbar sein
    assert(!st.reveal && !JSON.stringify(st).includes('"groups"'), 'Auflösung vor Ende sichtbar');
    const lateBot = !checkedLate && players.length > 1 && st.index === 1 ? players[players.length - 1] : null;
    await Promise.all(
      players.map(async (p, i) => {
        if (p === lateBot) return;
        await sleep(Math.random() * 1500);
        const words = ANSWERS.de;
        // --smart: echte Antworten aus der Liste (nur Test, über die Verwaltungs-API) – mal gleich, mal selten
        let text = words[(i * 7 + st.index) % (i % 3 === 0 ? 2 : words.length)];
        if (smart && !st.question?.custom) {
          const list = (smartCache[st.index] ??= await listAnswers(code, st.index)).slice().sort((a, b) => b.baseScore - a.baseScore);
          if (list.length) text = list[[0, 0, 1, 2, list.length - 1, 1, 3, 0][i % 8] % list.length].text;
        }
        const r = await call(p, 'answer', { code, idx: st.index, answer: text });
        assert(r.status === 200, `answer ${p.name}: ${JSON.stringify(r.body)}`);
      }),
    );
    const again = await call(players[0], 'answer', { code, idx: st.index, answer: 'Nochmal' });
    assert(again.status === 409 && ['already_answered', 'too_late'].includes(again.body.error), `Doppelabgabe nicht abgelehnt: ${again.status} ${JSON.stringify(again.body)}`);
    if (lateBot) {
      // nach Ablauf (Serverzeit) abgeben → muss abgelehnt werden
      const wait = Date.parse(st.ends_at) - Date.parse(st.now) + 1500;
      await sleep(Math.max(0, wait));
      const late = await call(lateBot, 'answer', { code, idx: st.index, answer: 'Zu spät' });
      assert(late.status === 409 && late.body.error === 'too_late', `späte Abgabe angenommen: ${JSON.stringify(late.body)}`);
      checkedLate = true;
      console.log('  späte Abgabe abgelehnt ✓');
    }
  }
  if (st.status === 'reveal' && st.reveal?.idx === st.index) {
    const r = st.reveal;
    console.log(`  Frage ${st.index + 1}/${st.count}: ${r.groups.map((g) => `${g.text}×${g.count}=${g.points}`).join(', ')}`);
    if (!joinCode) await call(host, 'next', { code });
    else await sleep(1500);
  }
  await call(host, 'tick', { code });
  await sleep(700);
}
console.log(`Realtime-Ankündigungen empfangen: ${events}`);
assert(events > 5, 'zu wenige Realtime-Ankündigungen');
console.log(`OK in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await host.sb.removeAllChannels();
process.exit(0);
