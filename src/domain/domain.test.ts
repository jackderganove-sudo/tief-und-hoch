import { describe, expect, it } from 'vitest';
import { compact, normalize } from './normalize';
import { allowedTypos, levenshtein } from './levenshtein';
import { matchAnswer } from './matchAnswer';
import { MAX_POINTS, scoreAnswer, tierFor } from './scoring';
import {
  addDays,
  berlinDateKey,
  msUntilNextBerlinDay,
  selectDailyQuestions,
} from './daily';
import { buildShareText } from './share';
import type { Question } from './types';

const pasta: Question = {
  id: 'de-common-pasta',
  lang: 'de',
  mode: 'common',
  prompt: 'Nenne ein Nudelgericht',
  answers: [
    { text: 'Spaghetti Bolognese', aliases: ['Spag Bol', 'Bolognese'], baseScore: 100 },
    { text: 'Lasagne', aliases: ['Lasagna'], baseScore: 70 },
    { text: 'Käsespätzle', aliases: [], baseScore: 30 },
    { text: 'Spaghetti Carbonara', aliases: ['Carbonara'], baseScore: 65 },
    { text: 'Penne all’arrabbiata', aliases: ['Arrabbiata'], baseScore: 10, tooClever: true },
  ],
};

describe('normalize', () => {
  it('handles umlauts, case, whitespace and punctuation', () => {
    expect(normalize('  Käsespätzle ')).toBe('kaesespaetzle');
    expect(normalize('KAESESPAETZLE')).toBe('kaesespaetzle');
    expect(normalize('Straße')).toBe('strasse');
    expect(normalize('Crème-Brûlée!')).toBe('creme brulee');
    expect(compact('Spag  Bol')).toBe('spagbol');
  });
});

describe('levenshtein', () => {
  it('computes distances', () => {
    expect(levenshtein('lasagne', 'lasange')).toBe(2);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
  it('scales tolerance with length', () => {
    expect(allowedTypos(3)).toBe(0);
    expect(allowedTypos(5)).toBe(1);
    expect(allowedTypos(8)).toBe(2);
    expect(allowedTypos(15)).toBe(3);
  });
});

describe('matchAnswer', () => {
  it('matches exact text and aliases after normalization', () => {
    expect(matchAnswer(pasta, 'spag bol')?.answer.text).toBe('Spaghetti Bolognese');
    expect(matchAnswer(pasta, 'Kaesespaetzle')).toMatchObject({ distance: 0 });
    expect(matchAnswer(pasta, 'spaghettibolognese')?.distance).toBe(0);
  });
  it('tolerates typos and reports them as fuzzy', () => {
    const m = matchAnswer(pasta, 'Lasange');
    expect(m?.answer.text).toBe('Lasagne');
    expect(m?.distance).toBeGreaterThan(0);
  });
  it('rejects unrelated or too short input', () => {
    expect(matchAnswer(pasta, 'Pizza')).toBeNull();
    expect(matchAnswer(pasta, 'xy')).toBeNull();
    expect(matchAnswer(pasta, '   ')).toBeNull();
  });
});

describe('scoring', () => {
  it('rare scores inversely, common directly', () => {
    expect(tierFor('rare', 2)).toBe('core');
    expect(tierFor('rare', 8)).toBe('ember');
    expect(tierFor('rare', 20)).toBe('crystal');
    expect(tierFor('rare', 40)).toBe('stone');
    expect(tierFor('rare', 90)).toBe('moss');
    expect(tierFor('rare', 2, true)).toBe('tooClever');
    expect(tierFor('common', 95)).toBe('stars');
    expect(tierFor('common', 60)).toBe('sunset');
    expect(tierFor('common', 35)).toBe('clouds');
    expect(tierFor('common', 15)).toBe('treetops');
    expect(tierFor('common', 2)).toBe('meadow');
    expect(tierFor('common', 2, true)).toBe('meadow');
  });
  it('gives 0 for invalid answers', () => {
    const r = scoreAnswer({ mode: 'rare', questionId: 'x', input: 'Pizza', match: null, frequency: null });
    expect(r).toMatchObject({ tier: 'invalid', points: 0, matched: null });
    expect(MAX_POINTS).toBe(700);
  });
});

describe('daily', () => {
  it('uses Berlin calendar days', () => {
    // 23:30 UTC am 10.11. ist in Berlin (UTC+1) schon der 11.11.
    expect(berlinDateKey(new Date('2026-11-10T23:30:00Z'))).toBe('2026-11-11');
    expect(berlinDateKey(new Date('2026-11-10T22:30:00Z'))).toBe('2026-11-10');
    // Sommerzeit: UTC+2
    expect(berlinDateKey(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('finds the next day change', () => {
    const ms = msUntilNextBerlinDay(new Date('2026-11-10T22:00:00Z'));
    expect(Math.abs(ms - 3_600_000)).toBeLessThanOrEqual(1000);
  });
  it('selects 7 distinct questions deterministically and rotates without repeats', () => {
    const pool: Question[] = Array.from({ length: 20 }, (_, i) => ({
      ...pasta,
      id: `q${String(i).padStart(2, '0')}`,
    }));
    const a = selectDailyQuestions(pool, '2026-11-11', 'de', 'rare');
    const b = selectDailyQuestions([...pool].reverse(), '2026-11-11', 'de', 'rare');
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(new Set(a.map((q) => q.id)).size).toBe(7);
    const other = selectDailyQuestions(pool, '2026-11-11', 'de', 'common');
    expect(other.map((q) => q.id)).not.toEqual(a.map((q) => q.id));
    // Zwei aufeinanderfolgende Tage innerhalb einer Runde überschneiden sich nicht.
    const days = ['2026-11-12', '2026-11-13', '2026-11-14'].map((d) =>
      selectDailyQuestions(pool, d, 'de', 'rare').map((q) => q.id),
    );
    for (const d of days) expect(new Set(d).size).toBe(7);
  });
});

describe('share', () => {
  it('builds an emoji summary', () => {
    const results = ['Lasagne', 'Spag Bol', 'Pizza'].map((input) => {
      const match = matchAnswer(pasta, input);
      return scoreAnswer({
        mode: 'common',
        questionId: pasta.id,
        input,
        match,
        frequency: match?.answer.baseScore ?? null,
      });
    });
    const text = buildShareText('common', '2026-11-11', results, {
      title: 'Tief & Hoch',
      modeName: 'Aufstieg',
      measureLabel: 'Höhe',
      locale: 'de-DE',
    });
    expect(text).toBe('Tief & Hoch · Aufstieg 🎈 11.11.2026\n🌇⭐⬛\nHöhe: 1.850 m (185/700)');
  });
});
