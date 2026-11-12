import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../components/px';
import { avatarSprite } from '../pixel/avatars';
import { PixelSprite } from '../components/px';
import { adminDb, banInRoom, endRoom, loadRooms, type AdminRoom } from './adminApi';
import { ConfirmButton, ErrorLine, fmtDate } from './ui';

const STATUS: Record<string, [string, string]> = {
  lobby: ['Lobby', '#9aa3b5'],
  countdown: ['Start', '#f2b53a'],
  question: ['Frage', '#7ec850'],
  scoring: ['Auswertung', '#f2b53a'],
  reveal: ['Auflösung', '#8be9fd'],
  finished: ['Beendet', '#9aa3b5'],
};

/** Freunde-Modus: aktive Räume, Spieler, Status; Raum beenden, Spieler im Raum sperren. */
export function RoomsTab({ selfId, onChanged }: { selfId: string; onChanged: () => void }) {
  const db = adminDb!;
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRooms(await loadRooms(db));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [db]);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (a: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await a();
      await refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <ErrorLine error={error} />
      {rooms === null && !error && <p className="text-center opacity-70">Lade …</p>}
      {rooms?.length === 0 && <p className="text-center opacity-70">Keine Räume in den letzten 2 Stunden.</p>}
      {rooms?.map((r) => {
        const [label, color] = STATUS[r.status] ?? [r.status, '#fff'];
        const online = r.players.filter((p) => p.online).length;
        return (
          <Panel key={r.id} tone="stone" className="px-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-2xl font-bold tracking-widest">{r.code}</span>
              <span className="font-bold" style={{ color }}>
                {label}
                {r.index >= 0 && r.status !== 'lobby' ? ` ${r.index + 1}/${r.count}` : ''}
              </span>
              <span className="text-sm opacity-75">
                {r.mode === 'rare' ? '▼' : '▲'} {r.scoring} · {r.source} · Runde {r.round}
              </span>
            </div>
            <p className="text-sm opacity-75">
              {r.players.length} Spieler ({online} online) · Gastgeber {r.host ?? '–'} · aktiv {fmtDate(r.last_activity_at)}
            </p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {r.players.map((p) => (
                <li key={p.user_id} className="flex items-center gap-2 text-sm">
                  <PixelSprite id={`av-${p.avatar}`} make={() => avatarSprite(p.avatar)} w={12} h={12} scale={2} className={p.online ? '' : 'opacity-40'} />
                  <span className="min-w-0 flex-1 truncate">
                    {p.host && '👑 '}
                    {p.name}
                    {p.banned && <span className="ml-1 bg-[#e2603a] px-1 text-xs text-white">gesperrt</span>}
                  </span>
                  {p.user_id !== selfId && !p.banned && (
                    <ConfirmButton tone="stone" disabled={busy} confirmLabel="Sperren?" onConfirm={() => void run(() => banInRoom(db, r.id, p.user_id))} className="!text-sm">
                      Sperren
                    </ConfirmButton>
                  )}
                </li>
              ))}
            </ul>
            {r.status !== 'finished' && (
              <div className="mt-2">
                <ConfirmButton tone="coral" disabled={busy} confirmLabel="Raum wirklich beenden?" onConfirm={() => void run(() => endRoom(db, r.id))}>
                  Raum beenden
                </ConfirmButton>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
