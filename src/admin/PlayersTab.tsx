import { useCallback, useEffect, useState } from 'react';
import { Panel, PxButton } from '../components/px';
import { adminDb, loadPlayers, resetName, setBan, type PlayerRow } from './adminApi';
import { ConfirmButton, ErrorLine, Field, fmtDate } from './ui';

const PROVIDER: Record<string, string> = { google: 'Google', discord: 'Discord', github: 'GitHub', email: 'E-Mail', anonym: 'anonym' };

/** Spieler: Liste ohne E-Mails, sperren/entsperren, Namen zurücksetzen (alles protokolliert). */
export function PlayersTab({ selfId, onChanged }: { selfId: string; onChanged: () => void }) {
  const db = adminDb!;
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PlayerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyBanned, setOnlyBanned] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setRows(await loadPlayers(db, search.trim()));
    } catch (e) {
      setError(String(e));
    }
  }, [db, search]);

  useEffect(() => {
    const id = window.setTimeout(() => void refresh(), 250);
    return () => window.clearTimeout(id);
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = (rows ?? []).filter((r) => !onlyBanned || r.banned);

  return (
    <div className="grid gap-3">
      <Panel tone="stone" className="px-1">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Name oder ID-Anfang">
              <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" className="w-full bg-transparent px-1 text-base" />
            </Field>
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={onlyBanned} onChange={(e) => setOnlyBanned(e.target.checked)} />
            nur gesperrte
          </label>
        </div>
        <p className="mt-1 text-xs opacity-60">Keine E-Mails – nur die Login-Art. Runden ohne Übung/Debug, sortiert nach letzter Aktivität.</p>
      </Panel>
      <ErrorLine error={error} />
      {rows === null && !error && <p className="text-center opacity-70">Lade …</p>}
      {rows && shown.length === 0 && <p className="text-center opacity-70">Keine Spieler gefunden.</p>}
      <ul className="grid gap-2">
        {shown.map((r) => (
          <li key={r.user_id}>
            <PlayerCard r={r} self={r.user_id === selfId} busy={busy} run={run} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlayerCard({ r, self, busy, run }: { r: PlayerRow; self: boolean; busy: boolean; run: (a: () => Promise<unknown>) => Promise<void> }) {
  const db = adminDb!;
  const [reason, setReason] = useState('');
  const [banning, setBanning] = useState(false);
  return (
    <Panel tone="stone" className={`px-1 ${r.banned ? 'outline-2 outline-[#e2603a]' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-lg font-bold">{r.display_name ?? <span className="opacity-60">ohne Namen</span>}</span>
        <span className="font-tiny text-[0.65rem] uppercase opacity-70">
          {PROVIDER[r.provider] ?? r.provider} · {r.user_id.slice(0, 8)}
        </span>
        {r.is_admin && <span className="bg-[#2e8b84] px-1 text-xs">Admin</span>}
        {r.banned && <span className="bg-[#e2603a] px-1 text-xs text-white">gesperrt{r.ban_reason ? `: ${r.ban_reason}` : ''}</span>}
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="font-tiny text-[0.6rem] uppercase opacity-60">erstellt</dt>
          <dd>{fmtDate(r.created_at)}</dd>
        </div>
        <div>
          <dt className="font-tiny text-[0.6rem] uppercase opacity-60">zuletzt aktiv</dt>
          <dd>{fmtDate(r.last_active)}</dd>
        </div>
        <div>
          <dt className="font-tiny text-[0.6rem] uppercase opacity-60">Runden</dt>
          <dd className="tabular-nums">
            {r.rounds} <span className="opacity-60">({r.answers} Antw.)</span>
          </dd>
        </div>
        <div>
          <dt className="font-tiny text-[0.6rem] uppercase opacity-60">KI heute</dt>
          <dd className="tabular-nums" style={{ color: r.ai_today >= 50 ? '#f2b53a' : undefined }}>
            {r.ai_today}
          </dd>
        </div>
      </dl>
      {!self && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.banned ? (
            <PxButton tone="teal" small disabled={busy} className="text-base" onClick={() => void run(() => setBan(db, r.user_id, false))}>
              Entsperren
            </PxButton>
          ) : banning ? (
            <form
              className="flex w-full flex-wrap items-end gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                setBanning(false);
                void run(() => setBan(db, r.user_id, true, reason.trim() || undefined));
              }}
            >
              <div className="min-w-0 flex-1">
                <Field label="Grund (optional)">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus className="w-full bg-transparent px-1 text-base" />
                </Field>
              </div>
              <PxButton tone="coral" small type="submit" disabled={busy} className="text-base">
                Wirklich sperren
              </PxButton>
              <PxButton tone="stone" small className="text-base" onClick={() => setBanning(false)}>
                Abbrechen
              </PxButton>
            </form>
          ) : (
            <PxButton tone="coral" small disabled={busy} className="text-base" onClick={() => setBanning(true)}>
              Sperren …
            </PxButton>
          )}
          {r.display_name && !banning && (
            <ConfirmButton tone="stone" disabled={busy} confirmLabel="Namen wirklich zurücksetzen?" onConfirm={() => void run(() => resetName(db, r.user_id))}>
              Namen zurücksetzen
            </ConfirmButton>
          )}
        </div>
      )}
    </Panel>
  );
}
