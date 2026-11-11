import { describe, expect, it } from 'vitest';
import { compact, normalize } from './normalize';
import { allowedTypos, levenshtein } from './levenshtein';
import { matchAnswer } from './matchAnswer';
import { MAX_POINTS, scoreAnswer, tierFor } from './scoring';
import { addDays, berlinDateKey, msUntilNextBerlinDay, selectDailyQuestions, selectDailySets } from './daily';
import { deriveModes, distributionIssues, qualifiesFor } from './quality';
import { TOPICS } from './types';
import { buildShareText } from './share';
import type { Mode, Question } from './types';

const pasta: Question = {
  id: 'de-food-001',
  lang: 'de',
  topic: 'food',
  prompt: 'Nenne ein Nudelgericht',
  modes: ['rare', 'common'],
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
  const pool: Question[] = TOPICS.flatMap((topic) =>
    Array.from({ length: 12 }, (_, i) => ({
      ...pasta,
      id: `de-${topic}-${String(i + 1).padStart(3, '0')}`,
      topic,
      // jede dritte Frage nur Rare, jede vierte nur Common
      modes: i % 3 === 0 ? (['rare'] as Mode[]) : i % 4 === 0 ? (['common'] as Mode[]) : (['rare', 'common'] as Mode[]),
    })),
  );

  it('selects 7 distinct questions deterministically, independent of pool order', () => {
    const a = selectDailyQuestions(pool, '2026-11-11', 'de', 'rare');
    const b = selectDailyQuestions([...pool].reverse(), '2026-11-11', 'de', 'rare');
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(new Set(a.map((q) => q.id)).size).toBe(7);
  });

  it('only uses questions that allow the mode and mixes topics', () => {
    for (let d = 0; d < 40; d++) {
      const date = addDays('2026-11-01', d);
      const sets = selectDailySets(pool, date, 'de');
      for (const mode of ['rare', 'common'] as const) {
        expect(sets[mode]).toHaveLength(7);
        expect(sets[mode].every((q) => q.modes.includes(mode))).toBe(true);
        // 11 Themen im Pool → jede Tagesfrage aus einem anderen Thema
        expect(new Set(sets[mode].map((q) => q.topic)).size).toBe(7);
      }
      // Kein Verrat: dieselbe Frage nie am selben Tag in beiden Modi
      const rareIds = new Set(sets.rare.map((q) => q.id));
      expect(sets.common.some((q) => rareIds.has(q.id))).toBe(false);
    }
  });

  it('uses different seeds for rare and common', () => {
    const both = pool.map((q) => ({ ...q, modes: ['rare', 'common'] as Mode[] }));
    const rare = selectDailyQuestions(both, '2026-11-11', 'de', 'rare').map((q) => q.id);
    const common = selectDailyQuestions(both, '2026-11-11', 'de', 'common').map((q) => q.id);
    expect(rare).not.toEqual(common);
  });

  it('rarely repeats a question before the pool is used up', () => {
    const rarePool = pool.filter((q) => q.modes.includes('rare'));
    const days = Math.floor(rarePool.length / 7);
    // Start an einer Rundengrenze: Tag d mit (d * 7) % n === 0
    const start = addDays('1970-01-01', rarePool.length * 300);
    const seen = new Set<string>();
    let repeats = 0;
    for (let d = 0; d < days; d++) {
      for (const q of selectDailyQuestions(pool, addDays(start, d), 'de', 'rare')) {
        if (seen.has(q.id)) repeats++;
        seen.add(q.id);
      }
    }
    // Wiederholungen entstehen nur durch Themen-Ersatz am Rundenende.
    expect(repeats).toBeLessThanOrEqual(4);
    expect(seen.size).toBeGreaterThanOrEqual(days * 7 - 4);
  });
});

describe('quality rules', () => {
  const scores = (list: number[]) => list.map((baseScore) => ({ baseScore }));
  it('derives modes from the score distribution', () => {
    const longTail = [100, 60, 40, 20, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1];
    expect(deriveModes(scores(longTail))).toEqual(['rare', 'common']);
    expect(deriveModes(scores([70, 40, 20, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1]))).toEqual(['rare']);
    expect(deriveModes(scores([100, 70, 50, 30, 20, 15, 12]))).toEqual(['common']);
    expect(qualifiesFor('common', scores([90, 90, 85, 80, 70, 60, 10]))).toBe(false);
  });
  it('flags implausible distributions', () => {
    expect(distributionIssues(scores([100, 50, 30, 10, 5, 2, 1, 1]))).toEqual([]);
    expect(distributionIssues(scores([30, 20, 10, 5, 1]))).toHaveLength(1);
    expect(distributionIssues(scores([90, 80, 70, 60, 5, 1]))).toHaveLength(1);
    expect(distributionIssues(scores([90, 50, 40, 30, 25, 20]))).toHaveLength(1);
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
