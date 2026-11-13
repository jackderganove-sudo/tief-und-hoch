import { describe, expect, it, vi } from 'vitest';
import { RoomSync, type ChannelHandlers } from './roomSync';
import type { RoomState } from './roomApi';

const base = (over: Partial<RoomState> = {}): RoomState => ({
  code: 'ABCDEF',
  status: 'question',
  settings: { mode: 'rare', scoring: 'group', source: 'random', topics: [], count: 5, seconds: 25, lang: 'de', show_attempts: false },
  custom_prompts: null,
  index: 0,
  count: 5,
  round: 1,
  ends_at: new Date(10_000).toISOString(),
  now: new Date(1_000).toISOString(),
  version: 1,
  host_id: 'a',
  me: 'a',
  players: [
    { user_id: 'a', name: 'A', avatar: 0, color: 0, from_index: 0, online: true, answered: false, attempts: 0, points: 0 },
    { user_id: 'b', name: 'B', avatar: 0, color: 1, from_index: 0, online: true, answered: false, attempts: 0, points: 0 },
  ],
  question: null,
  my_answer: null,
  reveal: null,
  reveals: null,
  ...over,
});

function setup(states: RoomState[]) {
  let handlers: ChannelHandlers | null = null;
  const subscribe = vi.fn((_c: string, h: ChannelHandlers) => {
    handlers = h;
    return () => {};
  });
  const queue = [...states];
  const fetchState = vi.fn(async () => queue.length > 1 ? queue.shift()! : queue[0]);
  const timers: { fn: () => void; ms: number }[] = [];
  const sync = new RoomSync('ABCDEF', {
    fetchState,
    subscribe,
    tick: vi.fn(async () => ({})),
    now: () => 1_000,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as never);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  return { sync, fetchState, subscribe, timers, h: () => handlers! };
}

describe('Wiederverbinden & Zustand', () => {
  it('nach (Wieder-)Verbindung wird der Zustand vom Server geholt', async () => {
    const { sync, fetchState, h } = setup([base()]);
    sync.start();
    await sync.refresh();
    fetchState.mockClear();
    h().onStatus('CLOSED');
    expect(sync.connected).toBe(false);
    h().onStatus('SUBSCRIBED');
    await Promise.resolve();
    expect(sync.connected).toBe(true);
    expect(fetchState).toHaveBeenCalled();
  });

  it('Verbindungsabbruch → erneuter Verbindungsversuch mit Backoff', async () => {
    const { sync, subscribe, timers, h } = setup([base()]);
    sync.start();
    h().onStatus('CHANNEL_ERROR');
    const retry = timers.find((t) => t.ms === 1000);
    expect(retry).toBeDefined();
    retry!.fn();
    expect(subscribe).toHaveBeenCalledTimes(2);
    h().onStatus('TIMED_OUT');
    expect(timers.some((t) => t.ms === 2000)).toBe(true);
  });

  it('ältere Antworten überschreiben keinen neueren Stand', async () => {
    const { sync } = setup([base({ version: 5, status: 'reveal' }), base({ version: 3 })]);
    await sync.refresh();
    await sync.refresh();
    expect((sync.state as RoomState).version).toBe(5);
  });

  it('„hat geantwortet“ setzt das Häkchen ohne Inhalt', async () => {
    const { sync, h } = setup([base()]);
    sync.start();
    await sync.refresh();
    h().onAnswered({ idx: 0, user_id: 'b' });
    expect((sync.state as RoomState).players.find((p) => p.user_id === 'b')!.answered).toBe(true);
    h().onAnswered({ idx: 3, user_id: 'a' }); // andere Frage → ignorieren
    expect((sync.state as RoomState).players.find((p) => p.user_id === 'a')!.answered).toBe(false);
  });

  it('Gastgeber offline (auch in der Lobby) → Server anstoßen, damit die Rolle wechselt', async () => {
    const lobby = base({ status: 'lobby', ends_at: null, players: [{ ...base().players[0], online: false }, base().players[1]] });
    const { sync } = setup([lobby]);
    const tick = (sync as unknown as { deps: { tick: ReturnType<typeof vi.fn> } }).deps.tick;
    await sync.refresh();
    expect(tick).toHaveBeenCalledTimes(1);
    await sync.refresh(); // gedrosselt
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('Serverzeit: Uhrversatz wird ausgeglichen, Tick zum Phasenende (Serverzeit)', async () => {
    // Server ist 4 s voraus (now = 5000 bei Gerätezeit 1000) → Ende 10000 Server = 6000 Gerät
    const { sync, timers } = setup([base({ now: new Date(5_000).toISOString() })]);
    await sync.refresh();
    expect(sync.offsetMs).toBe(4_000);
    const tick = timers.find((t) => t.ms >= 5_000 + 150 && t.ms < 5_000 + 600);
    expect(tick).toBeDefined();
  });
});
