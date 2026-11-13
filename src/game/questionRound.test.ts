import { describe, expect, it, vi } from 'vitest';
import { MAX_AI_CHECKS } from '../domain/attempts';
import type { AiVerdict } from '../domain/scoring';
import type { Question } from '../domain/types';
import type { AnswerJudge } from '../services/AnswerJudge';
import { LocalScoreService } from '../services/ScoreService';
import { QuestionRound, type RoundState } from './questionRound';

const question: Question = {
  id: 'de-food-001',
  lang: 'de',
  topic: 'food',
  prompt: 'Nenne ein Gemüse',
  modes: ['rare', 'common'],
  answers: [
    { text: 'Karotte', aliases: ['Möhre'], baseScore: 90 },
    { text: 'Pastinake', aliases: [], baseScore: 3 },
  ],
};

/** KI-Attrappe: Urteile je Eingabe, einstellbare Dauer, zählt echte Anfragen. */
function fakeJudge(verdicts: Record<string, AiVerdict>, clock: { t: number }, takesMs = 2000) {
  const calls: { input: string; cacheOnly: boolean }[] = [];
  const judge: AnswerJudge = {
    async judge(_q, input, opts) {
      calls.push({ input, cacheOnly: opts?.cacheOnly === true });
      clock.t += takesMs;
      if (opts?.cacheOnly) return verdicts[input]?.cached ? verdicts[input] : { status: 'uncached' };
      return verdicts[input] ?? { status: 'invalid' };
    },
  };
  return { judge, calls };
}

function setup(verdicts: Record<string, AiVerdict> = {}, takesMs = 2000) {
  const clock = { t: 0 };
  const { judge, calls } = fakeJudge(verdicts, clock, takesMs);
  const states: RoundState[] = [];
  const round = new QuestionRound(question, 'rare', new LocalScoreService(judge), { deadline: 25_000 }, (s) => states.push(s), () => clock.t);
  return { round, calls, states, clock };
}

describe('mehrere Versuche pro Frage', () => {
  it('Fehlversuche beenden die Frage nicht – die erste gültige Antwort zählt', async () => {
    const { round } = setup();
    await round.attempt('Stein');
    expect(round.state.result).toBeNull();
    expect(round.state.feedback).toMatchObject({ kind: 'invalid', input: 'Stein' });
    await round.attempt('Holz');
    expect(round.state.tried).toEqual(['Stein', 'Holz']);
    await round.attempt('Pastinake');
    expect(round.state.result).toMatchObject({ matched: 'Pastinake', points: 100, attempts: 3, rejected: ['Stein', 'Holz'], timedOut: false });
  });

  it('nach der gültigen Antwort ist Schluss', async () => {
    const { round } = setup();
    await round.attempt('Karotte');
    const first = round.state.result;
    await round.attempt('Pastinake');
    expect(round.state.result).toBe(first);
    expect(first).toMatchObject({ matched: 'Karotte', attempts: 1, rejected: [] });
  });

  it('Zeitablauf ohne gültige Antwort: 0 Punkte, Versuche bleiben sichtbar', async () => {
    const { round } = setup();
    await round.attempt('Stein');
    await round.attempt('Holz');
    await round.expire('');
    expect(round.state.result).toMatchObject({ tier: 'invalid', points: 0, timedOut: true, matched: null, attempts: 2, rejected: ['Stein', 'Holz'] });
  });

  it('was beim Zeitablauf noch im Feld steht, ist der letzte Versuch', async () => {
    const a = setup();
    await a.round.attempt('Stein');
    await a.round.expire('Möhre');
    expect(a.round.state.result).toMatchObject({ matched: 'Karotte', points: 10, timedOut: true, attempts: 2, rejected: ['Stein'] });

    const b = setup();
    await b.round.expire('Stein');
    expect(b.round.state.result).toMatchObject({ points: 0, timedOut: true, input: 'Stein', attempts: 1, rejected: ['Stein'] });
  });

  it('doppelte Eingabe: sofort abgelehnt, ohne Prüfung und ohne neuen Versuch', async () => {
    const { round, calls } = setup();
    await round.attempt('Stein');
    expect(calls).toHaveLength(1);
    await round.attempt('  STEIN ');
    expect(calls).toHaveLength(1);
    expect(round.state.feedback).toMatchObject({ kind: 'duplicate' });
    expect(round.state.count).toBe(1);
    expect(round.state.tried).toEqual(['Stein']);
  });

  it('leere Eingabe zählt nicht als Versuch', async () => {
    const { round, states } = setup();
    await round.attempt('   ');
    expect(states).toHaveLength(0);
    expect(round.state.count).toBe(0);
  });

  it('„Meintest du …?“ bei knapp verfehlter Listen-Antwort', async () => {
    const { round } = setup();
    await round.attempt('Garrotä');
    expect(round.state.feedback).toMatchObject({ kind: 'invalid', hint: 'Karotte' });
  });
});

describe('KI-Prüfung bei mehreren Versuchen', () => {
  it('Listen-Antworten und offensichtlicher Unsinn gehen nie an die KI', async () => {
    const { round, calls } = setup();
    await round.attempt('aaaa');
    await round.attempt('123');
    await round.attempt('x');
    expect(calls).toHaveLength(0);
    expect(round.state.tried).toEqual(['aaaa', '123', 'x']);
    await round.attempt('Möhre');
    expect(calls).toHaveLength(0);
    expect(round.state.result?.matched).toBe('Karotte');
  });

  it('eine von der KI akzeptierte Antwort beendet die Frage', async () => {
    const { round, calls } = setup({ Mangold: { status: 'valid', canonicalText: 'Mangold', estimatedBaseScore: 8 } });
    await round.attempt('Stein');
    await round.attempt('Mangold');
    expect(calls.map((c) => c.input)).toEqual(['Stein', 'Mangold']);
    expect(round.state.result).toMatchObject({ matched: 'Mangold', source: 'ai', attempts: 2, rejected: ['Stein'] });
    expect(round.state.aiChecks).toBe(2);
  });

  it(`höchstens ${MAX_AI_CHECKS} KI-Prüfungen pro Frage – danach nur noch Liste und Cache`, async () => {
    const { round, calls } = setup({ Mangold: { status: 'valid', canonicalText: 'Mangold', estimatedBaseScore: 8 } });
    await round.attempt('Stein');
    await round.attempt('Holz');
    expect(round.state.listOnly).toBeNull();
    await round.attempt('Beton');
    expect(round.state.aiChecks).toBe(3);
    expect(round.state.listOnly).toBe('question');

    // 4. unbekannte Antwort: die KI wird nicht mehr gefragt (nur noch der Cache)
    await round.attempt('Mangold');
    expect(calls.at(-1)).toEqual({ input: 'Mangold', cacheOnly: true });
    expect(calls.filter((c) => !c.cacheOnly)).toHaveLength(3);
    expect(round.state.result).toBeNull();
    expect(round.state.feedback).toMatchObject({ kind: 'listOnly' });
    expect(round.state.aiChecks).toBe(3);

    // die Liste zählt weiter
    await round.attempt('Karotte');
    expect(round.state.result).toMatchObject({ matched: 'Karotte', attempts: 5 });
  });

  it('Cache-Treffer verbrauchen kein Kontingent – auch nicht nach dem Limit', async () => {
    const { round, calls } = setup({
      Mangold: { status: 'valid', canonicalText: 'Mangold', estimatedBaseScore: 8, cached: true },
      Ziegel: { status: 'invalid', cached: true },
    });
    await round.attempt('Ziegel');
    expect(round.state.aiChecks).toBe(0);
    await round.attempt('Stein');
    await round.attempt('Holz');
    await round.attempt('Beton');
    expect(round.state.aiChecks).toBe(3);
    await round.attempt('Mangold');
    expect(calls.at(-1)?.cacheOnly).toBe(true);
    expect(round.state.result).toMatchObject({ matched: 'Mangold', attempts: 5 });
  });

  it('KI-Tageslimit: sofort nur noch die Liste', async () => {
    const { round, calls } = setup({ Stein: { status: 'limited', scope: 'day' } });
    await round.attempt('Stein');
    expect(round.state.listOnly).toBe('day');
    expect(round.state.feedback).toMatchObject({ kind: 'limited' });
    expect(round.state.aiChecks).toBe(0);
    await round.attempt('Holz');
    expect(calls.at(-1)?.cacheOnly).toBe(true);
  });

  it('KI nicht erreichbar: dieselbe Eingabe darf noch einmal versucht werden', async () => {
    const { round, calls } = setup({ Mangold: { status: 'error' } });
    await round.attempt('Mangold');
    expect(round.state.feedback).toMatchObject({ kind: 'unchecked' });
    expect(round.state.tried).toEqual([]);
    await round.attempt('Mangold');
    expect(calls).toHaveLength(2);
    // gescheiterte Prüfungen zählen zum Kontingent (kein Dauerfeuer)
    expect(round.state.aiChecks).toBe(2);
  });
});

describe('Timer-Pause während der KI-Prüfung', () => {
  it('der Timer steht während der Prüfung und läuft bei Ablehnung weiter', async () => {
    const { round, states } = setup({}, 2000);
    const p = round.attempt('Stein');
    // sofort: Eingabe gesperrt, Timer angehalten
    expect(round.state.checking).toBe(true);
    expect(states.at(-1)?.checking).toBe(true);
    await p;
    expect(round.state.checking).toBe(false);
    // 2 s gewartet → Deadline rückt um 2 s nach hinten
    expect(round.state.deadline).toBe(27_000);
  });

  it('pausiert höchstens 6 s pro Prüfung', async () => {
    const { round } = setup({}, 9000);
    await round.attempt('Stein');
    expect(round.state.deadline).toBe(31_000);
  });

  it('Listen-Antworten und Unsinn pausieren nichts', async () => {
    const { round, states } = setup();
    await round.attempt('aaaa');
    expect(states.some((s) => s.checking)).toBe(false);
    expect(round.state.deadline).toBe(25_000);
  });

  it('während der Prüfung gibt es weder neue Versuche noch einen Zeitablauf', async () => {
    const { round, calls } = setup({}, 2000);
    const p = round.attempt('Stein');
    await round.attempt('Holz');
    await round.expire('Beton');
    await p;
    expect(calls).toHaveLength(1);
    expect(round.state.result).toBeNull();
    expect(round.state.tried).toEqual(['Stein']);
  });
});

describe('Fortsetzen nach einem Reload', () => {
  it('Versuche und KI-Kontingent bleiben erhalten', async () => {
    const clock = { t: 0 };
    const { judge, calls } = fakeJudge({}, clock);
    const round = new QuestionRound(question, 'rare', new LocalScoreService(judge), { deadline: 25_000, tried: ['Stein', 'Holz', 'Beton'], count: 3, aiChecks: 3, listOnly: 'question' }, vi.fn(), () => clock.t);
    await round.attempt('stein');
    expect(round.state.feedback?.kind).toBe('duplicate');
    await round.attempt('Mangold');
    expect(calls).toEqual([{ input: 'Mangold', cacheOnly: true }]);
    await round.expire('');
    expect(round.state.result).toMatchObject({ attempts: 4, rejected: ['Stein', 'Holz', 'Beton', 'Mangold'] });
  });
});
