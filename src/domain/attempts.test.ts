import { describe, expect, it } from 'vitest';
import { AI_PAUSE_MAX_MS, isDuplicate, isNonsense, nearMiss, pickFunnyAttempts, rememberRejected, resumeDeadline } from './attempts';
import type { Question } from './types';

const question: Question = {
  id: 'de-food-001',
  lang: 'de',
  topic: 'food',
  prompt: 'Nenne ein Gemüse',
  modes: ['rare', 'common'],
  answers: [
    { text: 'Karotte', aliases: ['Möhre', 'Mohrrübe'], baseScore: 90 },
    { text: 'Brokkoli', aliases: [], baseScore: 40 },
    { text: 'Pastinake', aliases: [], baseScore: 3 },
  ],
};
const numeric: Question = { ...question, id: 'de-general-007', prompt: 'Nenne eine Glückszahl', answers: [{ text: '7', aliases: ['sieben'], baseScore: 80 }] };

describe('doppelte Eingaben', () => {
  it('erkennt dieselbe Antwort in anderer Schreibweise', () => {
    expect(isDuplicate(['Rote Bete'], 'rote  bete')).toBe(true);
    expect(isDuplicate(['Rote Bete'], 'ROTEBETE')).toBe(true);
    expect(isDuplicate(['Süßkartoffel'], 'suesskartoffel')).toBe(true);
    expect(isDuplicate(['Rote Bete'], 'Rote Rübe')).toBe(false);
    expect(isDuplicate([], '')).toBe(false);
  });

  it('merkt sich abgelehnte Versuche ohne Dopplungen und begrenzt die Liste', () => {
    let tried: string[] = [];
    tried = rememberRejected(tried, '  Stein ');
    tried = rememberRejected(tried, 'stein');
    tried = rememberRejected(tried, 'Holz');
    expect(tried).toEqual(['Stein', 'Holz']);
    for (let i = 0; i < 40; i++) tried = rememberRejected(tried, `Wort ${i}`);
    expect(tried).toHaveLength(20);
    expect(tried.at(-1)).toBe('Wort 39');
  });
});

describe('offensichtlicher Unsinn (geht nie an die KI)', () => {
  it.each(['a', '?', '!!!', '123', '4 2', 'aaaa', 'hahaha', 'xdxdxd', '   '])('„%s“ ist Unsinn', (input) => {
    expect(isNonsense(question, input)).toBe(true);
  });

  it.each(['Ei', 'Mangold', 'Dodo', 'Mama', 'Cha-Cha-Cha', 'Couscous', 'Bonbon', '7Up', 'Anna'])('„%s“ ist kein Unsinn', (input) => {
    expect(isNonsense(question, input)).toBe(false);
  });

  it('lässt Zahlen zu, wenn die Liste der Frage selbst Zahlen kennt', () => {
    expect(isNonsense(numeric, '13')).toBe(false);
    expect(isNonsense(question, '13')).toBe(true);
  });
});

describe('„Meintest du …?“', () => {
  it('schlägt eine Listen-Antwort knapp außerhalb der Tippfehler-Toleranz vor', () => {
    // Karotte (7 Zeichen) erlaubt 2 Tippfehler – 3 sind knapp daneben
    expect(nearMiss(question, 'Garrotä')).toBe('Karotte');
    expect(nearMiss(question, 'Pastnaqe')).toBe('Pastinake');
  });

  it('schlägt nichts vor, wenn die Eingabe weit weg oder zu kurz ist', () => {
    expect(nearMiss(question, 'Zucchini')).toBeNull();
    expect(nearMiss(question, 'Kar')).toBeNull();
  });
});

describe('Timer-Pause während der KI-Prüfung', () => {
  it('schiebt die Deadline um die Wartezeit', () => {
    expect(resumeDeadline(25_000, 10_000, 12_500)).toBe(27_500);
  });
  it('höchstens um 6 Sekunden', () => {
    expect(resumeDeadline(25_000, 10_000, 30_000)).toBe(25_000 + AI_PAUSE_MAX_MS);
  });
  it('nie rückwärts', () => {
    expect(resumeDeadline(25_000, 10_000, 9_000)).toBe(25_000);
  });
});

describe('lustige Fehlversuche (Freunde-Modus)', () => {
  it('echte Wörter zuerst, höchstens zwei pro Spieler, keine doppelten', () => {
    const picked = pickFunnyAttempts([
      { user_id: 'a', raw: 'Ziegelstein', ai: true },
      { user_id: 'a', raw: 'Holz', ai: true },
      { user_id: 'a', raw: 'Beton', ai: true },
      { user_id: 'b', raw: 'ziegelstein', ai: false },
      { user_id: 'b', raw: 'x', ai: false },
      { user_id: 'b', raw: 'Schraube', ai: false },
    ]);
    // a: die zwei längsten von der KI abgelehnten; b: ohne die doppelte Schreibweise und ohne „x“
    expect(picked.map((p) => `${p.user_id}:${p.raw}`)).toEqual(['a:Ziegelstein', 'a:Beton', 'b:Schraube']);
  });
  it('begrenzt die Anzahl', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ user_id: `u${i}`, raw: `Versuch ${i}`, ai: true }));
    expect(pickFunnyAttempts(many, 8)).toHaveLength(8);
  });
});
