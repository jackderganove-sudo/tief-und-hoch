import { describe, expect, it } from 'vitest';
import { practiceProgress } from './scoring';

const r = (...points: number[]) => points.map((p) => ({ points: p }));

describe('Übungsmodus: Tiefe/Höhe der Session', () => {
  it('startet bei 0 m', () => {
    expect(practiceProgress([])).toEqual({ meters: 0, points: 0, average: 0 });
  });

  it('ist die Summe der Punkte dieser Session × 10 m – keine Hochrechnung', () => {
    // der gemeldete Fall: eine Antwort mit 60 Punkten → 600 m, nicht 60 × 7 × 10 = 4.200 m
    expect(practiceProgress(r(60)).meters).toBe(600);
    expect(practiceProgress(r(60, 100, 0, 10)).meters).toBe(1700);
    expect(practiceProgress(r(60, 100, 0, 10)).average).toBe(42.5);
  });

  it('wächst mit jeder Antwort genau um deren Punkte × 10 m', () => {
    const answers = [85, 30, 0, 100, 15, 60, 10, 100];
    let before = 0;
    answers.forEach((p, i) => {
      const now = practiceProgress(r(...answers.slice(0, i + 1))).meters;
      expect(now - before).toBe(p * 10);
      before = now;
    });
  });

  it('eine neue Session beginnt wieder bei 0 (nichts aus früheren Runden)', () => {
    const first = practiceProgress(r(100, 100, 100));
    const second = practiceProgress(r(10));
    expect(first.meters).toBe(3000);
    expect(second.meters).toBe(100);
  });
});
