import { describe, expect, it } from 'vitest';
import { isApprovedResult, mergeApproved, type ApprovedAnswer } from './approved';
import { matchAnswer } from './matchAnswer';
import { scoreAiVerdict, scoreAnswer } from './scoring';
import type { Question } from './types';

const question: Question = {
  id: 'de-food-001',
  lang: 'de',
  topic: 'food',
  prompt: 'Nenne eine Gemüsesorte',
  modes: ['rare', 'common'],
  answers: [
    { text: 'Karotte', aliases: ['Möhre'], baseScore: 80 },
    { text: 'Tomate', aliases: [], baseScore: 50 },
  ],
};
const row = (r: Partial<ApprovedAnswer>): ApprovedAnswer => ({ question_id: 'de-food-001', text: 'Mangold', aliases: [], base_score: 2, merged_into: null, ...r });

describe('Freigegebene Antworten', () => {
  it('werden normale Listen-Antworten mit voller Wertung (auch Kern)', () => {
    const q = mergeApproved(question, [row({ aliases: ['Krautstiel'] })]);
    const m = matchAnswer(q, 'Mangolt'); // Tippfehler-Toleranz gilt auch hier
    expect(m?.answer.text).toBe('Mangold');
    const r = scoreAnswer({ mode: 'rare', questionId: q.id, input: 'Mangolt', match: m, frequency: m!.answer.baseScore });
    expect(r).toMatchObject({ tier: 'core', points: 100, source: 'list' });
    expect(matchAnswer(q, 'Krautstiel')?.answer.text).toBe('Mangold');
  });

  it('Variante wird Alias der Listen-Antwort', () => {
    const q = mergeApproved(question, [row({ text: 'gelbe Rübe', aliases: ['Gelbrübe'], merged_into: 'Karotte' })]);
    expect(q.answers).toHaveLength(2);
    expect(matchAnswer(q, 'Gelbe Rübe')?.answer.text).toBe('Karotte');
    expect(matchAnswer(q, 'gelbrübe')?.answer.text).toBe('Karotte');
  });

  it('ignoriert andere Fragen und Doppeltes, verändert das Original nicht', () => {
    expect(mergeApproved(question, [row({ question_id: 'de-food-002' })])).toBe(question);
    const q = mergeApproved(question, [row({ text: 'Tomate' }), row({ text: 'Mangold' }), row({ text: 'mangold' })]);
    expect(q.answers.map((a) => a.text)).toEqual(['Karotte', 'Tomate', 'Mangold']);
    expect(question.answers).toHaveLength(2);
  });

  it('alte KI-Ergebnisse verlieren das Badge, sobald freigegeben', () => {
    const q = mergeApproved(question, [row({ text: 'Mangold', aliases: ['Krautstiel'] })]);
    expect(isApprovedResult(q, { input: 'krautstiel', matched: 'Krautstiel' })).toBe(true);
    expect(isApprovedResult(q, { input: 'Spinat', matched: 'Spinat' })).toBe(false);
    expect(isApprovedResult(question, { input: 'Mangold', matched: 'Mangold' })).toBe(false);
  });

  it('Freigabe-Urteil der Edge Function zählt ohne Badge und ohne Deckel', () => {
    const r = scoreAiVerdict({ mode: 'rare', question, input: 'Mangold', verdict: { status: 'valid', approved: true, canonicalText: 'Mangold', estimatedBaseScore: 2 } });
    expect(r).toMatchObject({ source: 'list', tier: 'core', points: 100 });
    const c = scoreAiVerdict({ mode: 'common', question, input: 'Mangold', verdict: { status: 'valid', approved: true, canonicalText: 'Mangold', estimatedBaseScore: 2 } });
    expect(c).toMatchObject({ source: 'list', tier: 'meadow' });
  });
});
