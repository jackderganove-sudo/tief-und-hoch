import { useEffect, useState } from 'react';
import { PxButton } from '../components/px';
import { adminDb, loadAiStatus, type AiStatus, type Overview } from './adminApi';
import { Card, ErrorLine, Stat } from './ui';

const n = (v: number | undefined | null) => (v ?? 0).toLocaleString('de-DE');
const RED = '#e2603a';
const GOLD = '#f2b53a';
const GREEN = '#7ec850';

/** Übersicht: Spieler, Runden, Punkte, KI – heute und 7 Tage (Debug-Runden zählen nicht). */
export function OverviewTab({
  overview: o,
  error,
  onRefresh,
  onOpenReview,
}: {
  overview: Overview | null;
  error: string | null;
  onRefresh: () => void;
  onOpenReview: () => void;
}) {
  const [ai, setAi] = useState<AiStatus | null>(null);
  useEffect(() => {
    void loadAiStatus(adminDb!).then(setAi).catch(() => {});
  }, [o]);

  if (!o) return error ? <ErrorLine error={error} /> : <p className="mt-6 text-center opacity-70">Lade …</p>;

  const open = o.open_pending + o.open_unchecked;
  const quota = o.primary_quota_hit_at ? new Date(o.primary_quota_hit_at) : null;
  const breaker = o.breaker_recent > 0;

  return (
    <div className="grid gap-3">
      <ErrorLine error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Spieler heute" right={<RefreshButton onClick={onRefresh} />}>
          <dl className="grid grid-cols-3 gap-2">
            <Stat label="Aktiv" value={n(o.active_today)} />
            <Stat label="Eingeloggt" value={n(o.signed_in_today)} hint={`${n(o.active_today - o.signed_in_today)} anonym`} />
            <Stat label="Neu" value={n(o.new_today)} />
          </dl>
        </Card>
        <Card title="Spieler 7 Tage">
          <dl className="grid grid-cols-3 gap-2">
            <Stat label="Aktiv" value={n(o.active_week)} />
            <Stat label="Eingeloggt" value={n(o.signed_in_week)} hint={`${n(o.active_week - o.signed_in_week)} anonym`} />
            <Stat label="Neu" value={n(o.new_week)} hint={`${n(o.new_signed_in_week)} mit Login`} />
          </dl>
        </Card>
        <Card title="Runden (Tagesspiel)">
          <dl className="grid grid-cols-2 gap-2">
            <Stat label="▼ Abstieg heute" value={n(o.rounds_today?.rare)} hint={`7 Tage: ${n(o.rounds_week?.rare)}`} />
            <Stat label="▲ Aufstieg heute" value={n(o.rounds_today?.common)} hint={`7 Tage: ${n(o.rounds_week?.common)}`} />
          </dl>
          <p className="mt-1 text-xs opacity-70">
            Übung heute: {n(o.practice_today)} Antworten · Debug heute: {n(o.debug_today)} (zählen nicht)
          </p>
        </Card>
        <Card title="Ø Punkte (fertige Runden)">
          <dl className="grid grid-cols-2 gap-2">
            <Stat label="▼ Abstieg heute" value={o.avg_points_today?.rare ?? '–'} hint={`7 Tage: ${o.avg_points_week?.rare ?? '–'}`} />
            <Stat label="▲ Aufstieg heute" value={o.avg_points_today?.common ?? '–'} hint={`7 Tage: ${o.avg_points_week?.common ?? '–'}`} />
          </dl>
        </Card>
      </div>

      <Card title="KI-Prüfungen heute">
        <dl className="grid grid-cols-4 gap-2">
          <Stat label="OK" value={n(o.ai_today?.ok)} color={GREEN} />
          <Stat label="Cache" value={n(o.ai_today?.cache)} />
          <Stat label="Fehler" value={n(o.ai_today?.error)} color={o.ai_today?.error ? RED : undefined} />
          <Stat label="Limit" value={n(o.ai_today?.limited)} color={o.ai_today?.limited ? GOLD : undefined} />
        </dl>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="Modell" value={<span className="text-lg">{(o.last_model ?? '–').replace('gemini-', '')}</span>} />
          <Stat
            label="Breaker"
            value={<span className="text-lg">{breaker ? 'aktiv' : 'ruhig'}</span>}
            color={breaker ? GOLD : GREEN}
            hint={quota ? `Kontingent heute erschöpft (${quota.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}) – Ersatzmodell urteilt` : 'Hauptmodell verfügbar'}
          />
        </dl>
        {ai && ai.top_users.length > 0 && (
          <div className="mt-2">
            <p className="font-tiny text-[0.6rem] uppercase opacity-70">Pro Spieler heute (Top 5)</p>
            <ul className="mt-0.5 grid gap-x-3 text-sm sm:grid-cols-2">
              {ai.top_users.map((u) => (
                <li key={u.short_id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {u.short_id}… <span className="opacity-60">({u.is_admin ? 'Admin' : u.provider})</span>
                  </span>
                  <span className="tabular-nums">
                    {u.checks}
                    {u.limited ? <span style={{ color: RED }}> · {u.limited}× Limit</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Offene KI-Antworten">
        <div className="flex flex-wrap items-center gap-3">
          <span className="bg-[#e2603a] px-2 text-2xl font-bold leading-9 text-white tabular-nums">{n(open)}</span>
          <span className="text-sm opacity-85">
            {n(o.open_pending)} offen · {n(o.open_unchecked)} nicht geprüft
            {o.banned ? ` · ${n(o.banned)} Spieler gesperrt` : ''}
          </span>
          <PxButton tone="teal" small className="ml-auto text-base" onClick={onOpenReview}>
            Zum KI-Checker →
          </PxButton>
        </div>
      </Card>
    </div>
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm underline decoration-dotted underline-offset-4 opacity-80" aria-label="Aktualisieren">
      ↻
    </button>
  );
}
