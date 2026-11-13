import { describe, expect, it } from 'vitest';
import { caveZoneAt, milestoneOf, skyZoneAt } from './zones';
import { mergeSnapshots, emptySnapshot } from '../domain/progressSync';

describe('Zonen (neue Skala)', () => {
  it('Abstieg: Ø-Runde (~1.900 m) in der Mitte, Hölle ab 3.100 m, darunter endlos', () => {
    expect(caveZoneAt(100)).toBe('earth');
    expect(caveZoneAt(1900)).toBe('shroom');
    expect(caveZoneAt(2500)).toBe('lava');
    expect(caveZoneAt(3100)).toBe('hell');
    expect(caveZoneAt(6999)).toBe('hell');
    expect(caveZoneAt(7000)).toBe('icehell');
    expect(caveZoneAt(9500)).toBe('crystalhell');
    expect(caveZoneAt(11500)).toBe('abyss');
    expect(caveZoneAt(13500)).toBe('icehell');
  });
  it('Aufstieg: Ø-Runde (~4.300 m) im Abendrot, Himmel ab 5.500 m, darüber endlos', () => {
    expect(skyZoneAt(4300)).toBe('sunset');
    expect(skyZoneAt(5000)).toBe('stars');
    expect(skyZoneAt(5400)).toBe('deck');
    expect(skyZoneAt(5500)).toBe('heaven');
    expect(skyZoneAt(8000)).toBe('crystalclouds');
    expect(skyZoneAt(10000)).toBe('aurora');
    expect(skyZoneAt(50000)).toBe('space');
  });
  it('Erfolge: Hölle ab 3.100 m (Abstieg), Himmel ab 5.500 m (Aufstieg)', () => {
    expect(milestoneOf('rare', 3090)).toBeNull();
    expect(milestoneOf('rare', 3100)).toBe('hell');
    expect(milestoneOf('common', 5490)).toBeNull();
    expect(milestoneOf('common', 7000)).toBe('heaven');
  });
  it('Erfolge zusammenführen: beide behalten, früheres Datum gewinnt', () => {
    const remote = { ...emptySnapshot(), achievements: { hell: '2026-11-20' } };
    const local = { ...emptySnapshot(), achievements: { hell: '2026-11-14', heaven: '2026-11-15' } };
    expect(mergeSnapshots(remote, local).merged.achievements).toEqual({ hell: '2026-11-14', heaven: '2026-11-15' });
    expect(mergeSnapshots(emptySnapshot(), emptySnapshot()).merged.achievements).toBeUndefined();
  });
});
