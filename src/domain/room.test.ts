import { describe, expect, it } from 'vitest';
import {
  acceptsAnswer,
  ANSWER_GRACE_MS,
  cleanRoomCode,
  isRoomCode,
  makeRoomCode,
  nextHost,
  nextTransition,
  PENDING_GRACE_MS,
  planQuestions,
  playsQuestion,
  sanitizeSettings,
  settingsProblem,
} from './room';
import { groupScore, scoreQuestion, standings, type RoomAnswerInput } from './roomScoring';

const ans = (userId: string, key: string, valid = true, extra: Partial<RoomAnswerInput> = {}): RoomAnswerInput => ({
  userId,
  raw: key,
  valid,
  groupKey: key,
  display: key,
  ...extra,
});
const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('Raumcode', () => {
  it('6 Zeichen ohne verwechselbare Zeichen', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeRoomCode();
      expect(isRoomCode(c)).toBe(true);
      expect(c).not.toMatch(/[IO01]/);
    }
    expect(cleanRoomCode(' ab-c d2 3x')).toBe('ABCD23');
    expect(isRoomCode('ABCDE1')).toBe(false);
  });
});

describe('Einstellungen', () => {
  it('begrenzt alles auf erlaubte Werte', () => {
    const s = sanitizeSettings({ mode: 'common', count: 99, seconds: 17, lang: 'fr', topics: ['food', 'nope'], source: 'topics', scoring: 'group' });
    expect(s).toMatchObject({ mode: 'common', count: 20, seconds: 25, lang: 'de', topics: ['food'], source: 'topics', scoring: 'group' });
    expect(sanitizeSettings({ count: 2 }).count).toBe(5);
  });
  it('eigene Fragen → Wertung immer „Gruppe“; ohne Fragen nicht startbar', () => {
    const s = sanitizeSettings({ source: 'custom', scoring: 'global', custom_prompts: ['  Nenne   ein Tier ', 'x'] });
    expect(s.scoring).toBe('group');
    expect(s.custom_prompts).toEqual(['Nenne ein Tier']);
    expect(settingsProblem(sanitizeSettings({ source: 'custom' }))).toBe('no_custom_prompts');
  });
  it('gemischt: eigene Fragen gleichmäßig verteilt, Gesamtzahl stimmt', () => {
    const s = sanitizeSettings({ source: 'mixed', count: 8, custom_prompts: ['Frage A', 'Frage B'] });
    const plan = planQuestions(s, players(30), () => 0.3);
    expect(plan).toHaveLength(8);
    const customAt = plan.map((p, i) => (p.kind === 'custom' ? i : -1)).filter((i) => i >= 0);
    expect(customAt).toHaveLength(2);
    expect(customAt[1] - customAt[0]).toBeGreaterThanOrEqual(3);
  });
});

describe('Wertung „Gruppe“', () => {
  it('Abstieg, 30 Spieler: nur du = 100, je mehr Gleiche desto weniger', () => {
    const ps = players(30);
    // 1× einzigartig, 2× gleich, 6× gleich, 21× gleich
    const answers = [ans('p1', 'a'), ans('p2', 'b'), ans('p3', 'b'), ...ps.slice(3, 9).map((p) => ans(p, 'c')), ...ps.slice(9).map((p) => ans(p, 'd'))];
    const r = scoreQuestion({ mode: 'rare', scoring: 'group', participants: ps, answers });
    expect(r.perPlayer.p1).toMatchObject({ points: 100, special: 'only_you' });
    expect(r.perPlayer.p2.points).toBe(85); // 1/29 ≈ 3 % → aber k ≥ 2 höchstens 85
    expect(r.perPlayer.p4.points).toBe(60); // 5/29 ≈ 17 %
    expect(r.perPlayer.p10.points).toBe(10); // 20/29 ≈ 69 %
    expect(r.groups[0]).toMatchObject({ count: 21, text: 'd' });
  });

  it('Aufstieg, 30 Spieler: größte Gruppe = 100, Einzelgänger = 10', () => {
    const ps = players(30);
    const answers = [...ps.slice(0, 12).map((p) => ans(p, 'top')), ...ps.slice(12, 20).map((p) => ans(p, 'zwei')), ...ps.slice(20, 29).map((p, i) => ans(p, `solo${i}`))];
    const r = scoreQuestion({ mode: 'common', scoring: 'group', participants: ps, answers });
    expect(r.perPlayer.p1).toMatchObject({ points: 100, special: 'majority' });
    expect(r.perPlayer.p13.points).toBe(30); // 7/28 = 25 % → Silber
    expect(r.perPlayer.p21.points).toBe(10);
    expect(r.perPlayer.p30).toMatchObject({ points: 0, group: null }); // keine Antwort
    expect(r.missed).toEqual(['p30']);
  });

  it('2 Spieler – Abstieg: verschieden = je 60, gleich = je 10', () => {
    expect(scoreQuestion({ mode: 'rare', scoring: 'group', participants: ['a', 'b'], answers: [ans('a', 'x'), ans('b', 'y')] }).perPlayer.a.points).toBe(60);
    expect(scoreQuestion({ mode: 'rare', scoring: 'group', participants: ['a', 'b'], answers: [ans('a', 'x'), ans('b', 'x')] }).perPlayer.b.points).toBe(10);
  });

  it('2 Spieler – Aufstieg: gleich = je 100, verschieden = je 10', () => {
    const same = scoreQuestion({ mode: 'common', scoring: 'group', participants: ['a', 'b'], answers: [ans('a', 'x'), ans('b', 'x')] });
    expect(same.perPlayer.a).toMatchObject({ points: 100, special: 'same_pair' });
    expect(scoreQuestion({ mode: 'common', scoring: 'group', participants: ['a', 'b'], answers: [ans('a', 'x'), ans('b', 'y')] }).perPlayer.a.points).toBe(10);
  });

  it('ungültige Antworten = 0 und zählen nicht als „gleiche Antwort“', () => {
    const r = scoreQuestion({ mode: 'rare', scoring: 'group', participants: ['a', 'b', 'c'], answers: [ans('a', 'x'), ans('b', 'quatsch', false), ans('c', 'quatsch', false)] });
    expect(r.perPlayer.a).toMatchObject({ points: 100, special: 'only_you' });
    expect(r.perPlayer.b.points).toBe(0);
    expect(r.groups.find((g) => !g.valid)?.count).toBe(2);
  });

  it('groupScore ist monoton: mehr Gleiche → nie mehr Punkte (Abstieg), nie weniger (Aufstieg)', () => {
    const pts = (m: 'rare' | 'common', k: number) => ({ moss: 10, stone: 30, crystal: 60, ember: 85, core: 100, meadow: 10, treetops: 30, clouds: 60, sunset: 85, stars: 100 })[groupScore(m, k, 30, 30, 30).tier as 'moss'] ?? 0;
    for (let k = 2; k < 30; k++) expect(pts('rare', k + 1)).toBeLessThanOrEqual(pts('rare', k));
    for (let k = 1; k < 29; k++) expect(pts('common', k + 1)).toBeGreaterThanOrEqual(pts('common', k));
  });
});

describe('Wertung „Global“', () => {
  it('nimmt die Wertung wie im normalen Spiel, Gruppen trotzdem zusammengefasst', () => {
    const r = scoreQuestion({
      mode: 'rare',
      scoring: 'global',
      participants: ['a', 'b', 'c'],
      answers: [ans('a', 'fenchel', true, { globalTier: 'core', globalPoints: 100 }), ans('b', 'tomate', true, { globalTier: 'moss', globalPoints: 10 }), ans('c', 'tomate', true, { globalTier: 'moss', globalPoints: 10 })],
    });
    expect(r.perPlayer.a.points).toBe(100);
    expect(r.perPlayer.b.points).toBe(10);
    expect(r.groups[0]).toMatchObject({ text: 'tomate', count: 2 });
  });
});

describe('Anzeige der Gruppen', () => {
  it('nimmt die schönere Schreibweise', () => {
    const r = scoreQuestion({ mode: 'rare', scoring: 'group', participants: ['a', 'b'], answers: [ans('a', 'rot', true, { display: 'rot' }), ans('b', 'rot', true, { display: 'Rot' })] });
    expect(r.groups[0].text).toBe('Rot');
  });
});

describe('Zwischenstand', () => {
  it('gleiche Punkte = gleicher Platz', () => {
    expect(standings({ a: 300, b: 300, c: 100 })).toEqual([
      { userId: 'a', points: 300, place: 1 },
      { userId: 'b', points: 300, place: 1 },
      { userId: 'c', points: 100, place: 3 },
    ]);
  });
});

describe('Ablauf (Serverzeit)', () => {
  const base = { index: 0, count: 5, endsAt: 1000, allAnswered: false, pending: false };
  it('Countdown → erste Frage erst nach Ablauf', () => {
    expect(nextTransition({ ...base, status: 'countdown', index: -1, now: 999 })).toBeNull();
    expect(nextTransition({ ...base, status: 'countdown', index: -1, now: 1000 })).toEqual({ to: 'question', index: 0 });
  });
  it('Frage → Auswertung: wenn alle geantwortet haben sofort, sonst bei Ablauf', () => {
    expect(nextTransition({ ...base, status: 'question', now: 500 })).toBeNull();
    expect(nextTransition({ ...base, status: 'question', now: 500, allAnswered: true })).toEqual({ to: 'scoring' });
    expect(nextTransition({ ...base, status: 'question', now: 1000 })).toEqual({ to: 'scoring' });
  });
  it('laufende KI-Prüfungen: höchstens PENDING_GRACE_MS warten', () => {
    expect(nextTransition({ ...base, status: 'question', now: 1000 + PENDING_GRACE_MS - 1, pending: true })).toBeNull();
    expect(nextTransition({ ...base, status: 'question', now: 1000 + PENDING_GRACE_MS, pending: true })).toEqual({ to: 'scoring' });
  });
  it('Auflösung → nächste Frage bzw. Ende', () => {
    expect(nextTransition({ ...base, status: 'reveal', index: 2, now: 1000 })).toEqual({ to: 'question', index: 3 });
    expect(nextTransition({ ...base, status: 'reveal', index: 4, now: 1000 })).toEqual({ to: 'finished' });
    expect(nextTransition({ ...base, status: 'lobby', now: 99999 })).toBeNull();
  });
  it('Antworten nur während der Frage und bis Ablauf (+ Netz-Toleranz)', () => {
    expect(acceptsAnswer('question', 1000, 1000 + ANSWER_GRACE_MS)).toBe(true);
    expect(acceptsAnswer('question', 1000, 1001 + ANSWER_GRACE_MS)).toBe(false);
    expect(acceptsAnswer('reveal', 1000, 500)).toBe(false);
    expect(acceptsAnswer('lobby', null, 0)).toBe(false);
  });
  it('später Beitretende spielen erst ab ihrer Frage mit; entfernte nie', () => {
    expect(playsQuestion({ kicked: false, from_index: 3 }, 2)).toBe(false);
    expect(playsQuestion({ kicked: false, from_index: 3 }, 3)).toBe(true);
    expect(playsQuestion({ kicked: true, from_index: 0 }, 3)).toBe(false);
  });
  it('Gastgeber weg → der am längsten Anwesende übernimmt', () => {
    const now = Date.parse('2026-11-15T12:00:00Z');
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    const ps = [
      { user_id: 'host', kicked: false, joined_at: ago(600), last_seen: ago(120) },
      { user_id: 'b', kicked: false, joined_at: ago(500), last_seen: ago(5) },
      { user_id: 'c', kicked: false, joined_at: ago(550), last_seen: ago(200) },
    ];
    expect(nextHost(ps, 'host', now)).toBe('b');
    expect(nextHost([{ ...ps[0], last_seen: ago(3) }, ps[1]], 'host', now)).toBe('host');
  });
});

describe('Endbildschirm: Gedankenleser & Einzelgänger', async () => {
  const { matchAwards, myMatch } = await import('./roomScoring');
  it('findet das Paar mit den meisten gleichen Antworten und den häufigsten Einzelgänger', () => {
    const reveals = [
      { groups: [{ valid: true, players: ['a', 'b', 'c'] }, { valid: true, players: ['d'] }] },
      { groups: [{ valid: true, players: ['a', 'b'] }, { valid: true, players: ['d'] }, { valid: false, players: ['c'] }] },
      { groups: [{ valid: true, players: ['b', 'c'] }, { valid: true, players: ['a'] }, { valid: true, players: ['d'] }] },
    ];
    expect(matchAwards(reveals)).toEqual({ mindReaders: { a: 'a', b: 'b', count: 2 }, loner: { userId: 'd', count: 3 } });
    expect(matchAwards([])).toEqual({ mindReaders: null, loner: null });
  });
  it('Match-Moment: andere in meiner Gruppe', () => {
    const r = { groups: [{ key: 'v:x', valid: true, players: ['me', 'max', 'lisa'] }, { key: 'v:y', valid: true, players: ['tom'] }] };
    expect(myMatch(r, 'me')).toEqual({ group: 'v:x', others: ['max', 'lisa'], valid: true });
    expect(myMatch(r, 'tom').others).toEqual([]);
    expect(myMatch(r, 'nobody').group).toBeNull();
  });
});
