/**
 * Fortschritt zwischen Geräten synchronisieren: localStorage bleibt der Offline-Cache,
 * der Server hält einen Snapshot pro Konto (Tabelle player_progress, RLS: nur eigener).
 * Beim Start bzw. nach dem Login: Server-Stand holen, mit dem Gerät zusammenführen,
 * zurückschreiben. Danach jede Änderung (gebündelt) hochladen.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeSnapshots, sameSnapshot, type MergeSummary, type Snapshot } from '../../domain/progressSync';
import type { ProgressRepository } from '../ProgressRepository';

export class ProgressSync {
  private userId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private applying = false;

  constructor(
    private readonly db: SupabaseClient,
    private readonly repo: ProgressRepository,
    private readonly onImported: (snapshot: Snapshot) => void = () => {},
  ) {
    repo.onChange(() => {
      if (!this.applying) this.schedulePush();
    });
  }

  /** Für dieses Konto synchronisieren (null = abgemeldet). Liefert die Zusammenfassung des Zusammenführens. */
  async attach(userId: string | null): Promise<MergeSummary | null> {
    this.userId = userId;
    if (!userId) return null;
    const { data, error } = await this.db.from('player_progress').select('snapshot').eq('user_id', userId).maybeSingle();
    if (error) {
      console.warn('Fortschritt nicht geladen:', error.message);
      return null;
    }
    const local = this.repo.exportSnapshot();
    if (!data) {
      await this.push(local);
      return null;
    }
    const { merged, summary } = mergeSnapshots(data.snapshot as Snapshot, local);
    if (!sameSnapshot(merged, local)) {
      this.applying = true;
      try {
        this.repo.importSnapshot(merged);
      } finally {
        this.applying = false;
      }
      this.onImported(merged);
    }
    if (!sameSnapshot(merged, data.snapshot as Snapshot)) await this.push(merged);
    return summary;
  }

  private schedulePush() {
    if (!this.userId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(this.repo.exportSnapshot()), 1500);
  }

  private async push(snapshot: Snapshot) {
    if (!this.userId) return;
    const { error } = await this.db
      .from('player_progress')
      .upsert({ user_id: this.userId, snapshot, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) console.warn('Fortschritt nicht gespeichert:', error.message);
  }
}
