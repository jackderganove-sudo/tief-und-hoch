/**
 * Hält den Raumzustand aktuell – auch auf dem Handy, wenn die App im Hintergrund war,
 * der Bildschirm aus oder das Netz kurz weg:
 *  - Realtime-Ankündigungen („Zustand neu“) → Zustand vom Server holen
 *  - „hat geantwortet“ → Häkchen sofort setzen (ohne Inhalt)
 *  - Wiederverbinden mit Backoff, beim Zurückkommen (sichtbar/online) sofort neu laden
 *  - Herzschlag alle 15 s (Server sieht „online“; verpasste Ankündigungen fallen auf)
 *  - Timer-Ende nach Serverzeit → „tick“ an den Server (der entscheidet, nicht der Client)
 *
 * Ohne React und ohne Supabase-Abhängigkeit, damit es testbar ist.
 */
import type { RoomPreview, RoomState } from './roomApi';

export interface ChannelHandlers {
  onState: () => void;
  onAnswered: (p: { idx: number; user_id: string }) => void;
  /** „versucht es noch“ – nur die Anzahl */
  onTried?: (p: { idx: number; user_id: string; n: number }) => void;
  onStatus: (s: 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT') => void;
}

export interface SyncDeps {
  fetchState: (code: string) => Promise<RoomState | RoomPreview>;
  subscribe: (code: string, h: ChannelHandlers) => () => void;
  tick: (code: string) => Promise<unknown>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export type SyncListener = (s: RoomState | RoomPreview | null, info: { connected: boolean; offsetMs: number }) => void;

export class RoomSync {
  state: RoomState | RoomPreview | null = null;
  connected = false;
  /** Serverzeit − Gerätezeit */
  offsetMs = 0;
  private unsub: (() => void) | null = null;
  private listeners = new Set<SyncListener>();
  private fetching: Promise<void> | null = null;
  private refetchAgain = false;
  private retry = 0;
  private timers: unknown[] = [];
  private tickTimer: unknown = null;
  private stopped = false;
  private hostNudgeAt = Number.NEGATIVE_INFINITY;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (t: unknown) => void;

  constructor(
    readonly code: string,
    private deps: SyncDeps,
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  start() {
    this.stopped = false;
    this.connect();
    void this.refresh();
    const beat = () => {
      if (this.stopped) return;
      void this.refresh();
      this.timers.push(this.setTimer(beat, 15_000));
    };
    this.timers.push(this.setTimer(beat, 15_000));
  }

  stop() {
    this.stopped = true;
    this.unsub?.();
    this.unsub = null;
    this.timers.forEach((t) => this.clearTimer(t));
    this.timers = [];
    if (this.tickTimer) this.clearTimer(this.tickTimer);
  }

  subscribe(l: SyncListener) {
    this.listeners.add(l);
    l(this.state, { connected: this.connected, offsetMs: this.offsetMs });
    return () => void this.listeners.delete(l);
  }

  /** Beim Zurückkommen (App sichtbar, Netz wieder da): neu verbinden und Zustand holen. */
  resume() {
    if (this.stopped) return;
    if (!this.connected) this.connect();
    void this.refresh();
  }

  /** Server-Zeitpunkt in Gerätezeit. */
  localTime(iso: string | null): number | null {
    return iso ? Date.parse(iso) - this.offsetMs : null;
  }

  private emit() {
    for (const l of this.listeners) l(this.state, { connected: this.connected, offsetMs: this.offsetMs });
  }

  private connect() {
    this.unsub?.();
    this.unsub = this.deps.subscribe(this.code, {
      onState: () => void this.refresh(),
      onAnswered: ({ idx, user_id }) => {
        const s = this.state;
        if (!s || 'error' in s || s.index !== idx) return;
        this.state = { ...s, players: s.players.map((p) => (p.user_id === user_id ? { ...p, answered: true } : p)) };
        this.emit();
      },
      onTried: ({ idx, user_id, n }) => {
        const s = this.state;
        if (!s || 'error' in s || s.index !== idx) return;
        this.state = { ...s, players: s.players.map((p) => (p.user_id === user_id ? { ...p, attempts: Math.max(p.attempts ?? 0, n) } : p)) };
        this.emit();
      },
      onStatus: (st) => {
        if (st === 'SUBSCRIBED') {
          this.connected = true;
          this.retry = 0;
          void this.refresh(); // verpasste Ankündigungen nachholen
        } else {
          this.connected = false;
          if (!this.stopped) {
            // Wiederverbinden: 1 s, 2 s, 4 s … höchstens 15 s
            const wait = Math.min(15_000, 1000 * 2 ** this.retry++);
            this.timers.push(this.setTimer(() => !this.stopped && !this.connected && this.connect(), wait));
          }
        }
        this.emit();
      },
    });
  }

  /** Zustand holen; parallele Anfragen werden zusammengelegt, ältere Versionen ignoriert. */
  refresh(): Promise<void> {
    if (this.fetching) {
      this.refetchAgain = true;
      return this.fetching;
    }
    const sentAt = this.now();
    this.fetching = this.deps
      .fetchState(this.code)
      .then((s) => {
        if ('error' in s) this.state = s;
        else {
          const prev = this.state && !('error' in this.state) ? this.state : null;
          // Nicht hinter einen neueren Stand zurückfallen (Antworten können überholen)
          if (!prev || s.version >= prev.version || s.round !== prev.round) this.state = s;
          const recv = this.now();
          this.offsetMs = Date.parse(s.now) - (sentAt + recv) / 2;
        }
        this.emit();
        this.scheduleTick();
        this.nudgeIfHostGone();
      })
      .catch(() => {
        /* offline – Herzschlag/Resume versucht es wieder */
      })
      .finally(() => {
        this.fetching = null;
        if (this.refetchAgain) {
          this.refetchAgain = false;
          void this.refresh();
        }
      });
    return this.fetching;
  }

  /**
   * Gastgeber nicht erreichbar (App zu, Netz weg) – z. B. in der Lobby, wo kein Timer tickt:
   * Server anstoßen, er gibt die Rolle an den am längsten Anwesenden weiter (höchstens alle 10 s).
   */
  private nudgeIfHostGone() {
    const s = this.state;
    if (!s || 'error' in s || s.status === 'finished') return;
    const host = s.players.find((p) => p.user_id === s.host_id);
    if (host && host.online) return;
    if (this.now() - this.hostNudgeAt < 10_000) return;
    this.hostNudgeAt = this.now();
    void this.deps.tick(this.code).catch(() => {});
  }

  /** Bei Phasenende (Serverzeit) den Server anstoßen; solange der Zustand gleich bleibt, wiederholen. */
  private scheduleTick() {
    if (this.tickTimer) this.clearTimer(this.tickTimer);
    this.tickTimer = null;
    const s = this.state;
    if (!s || 'error' in s || !s.ends_at || this.stopped) return;
    if (!['countdown', 'question', 'reveal', 'scoring'].includes(s.status)) return;
    const due = (this.localTime(s.ends_at) ?? 0) - this.now();
    // kleine Streuung, damit nicht 30 Geräte in derselben Millisekunde anfragen
    const jitter = Math.floor(Math.random() * 400);
    const version = s.version;
    this.tickTimer = this.setTimer(
      async () => {
        const cur = this.state;
        if (this.stopped || !cur || 'error' in cur || cur.version !== version) return;
        await this.deps.tick(this.code).catch(() => {});
        await this.refresh();
        const after = this.state;
        // Noch nichts passiert (z. B. KI prüft noch) → in 1,5 s erneut
        if (after && !('error' in after) && after.version === version) {
          this.tickTimer = this.setTimer(() => {
            this.tickTimer = null;
            void this.deps.tick(this.code).then(() => this.refresh());
          }, 1500);
        }
      },
      Math.max(0, due) + 150 + jitter,
    );
  }
}
