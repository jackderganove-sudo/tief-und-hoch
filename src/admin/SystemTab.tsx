import { useEffect, useState } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../services/supabase/client';
import { adminDb, loadAdminLog, type AdminLogRow } from './adminApi';
import { Card, ErrorLine, fmtDate } from './ui';

const REPO = 'playhighsandlows/playhighsandlows.github.io';
const PROJECT_REF = SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split('.')[0] : '';

interface DeployRun {
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  head_sha: string;
  html_url: string;
  display_title: string;
}

const ACTION_LABEL: Record<string, string> = {
  'verdict.approved': 'KI-Antwort freigegeben',
  'verdict.rejected': 'KI-Antwort abgelehnt',
  'verdict.pending': 'KI-Antwort zurück auf offen',
  'verdict.unchecked': 'KI-Antwort zurück auf ungeprüft',
  'verdict.bulk_reject': 'Bulk-Ablehnen',
  'player.ban': 'Spieler gesperrt',
  'player.unban': 'Spieler entsperrt',
  'player.reset_name': 'Name zurückgesetzt',
};

/** System: Version, letzter Deploy, Supabase-Status, Links, Export-Befehl, Admin-Protokoll. */
export function SystemTab() {
  const [run, setRun] = useState<DeployRun | null | 'error'>(null);
  const [health, setHealth] = useState<{ ok: boolean; ms: number } | null>(null);
  const [log, setLog] = useState<AdminLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Öffentliches Repo: GitHub-API ohne Anmeldung (60 Anfragen/h)
    fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=1&branch=main`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { workflow_runs: DeployRun[] }) => setRun(d.workflow_runs[0] ?? 'error'))
      .catch(() => setRun('error'));
    if (SUPABASE_URL) {
      const t0 = performance.now();
      fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY } })
        .then((r) => setHealth({ ok: r.ok, ms: Math.round(performance.now() - t0) }))
        .catch(() => setHealth({ ok: false, ms: Math.round(performance.now() - t0) }));
    }
    loadAdminLog(adminDb!, 50)
      .then(setLog)
      .catch((e) => setError(String(e)));
  }, []);

  const commit = __COMMIT__ || __BUILD_ID__;
  const live = run && run !== 'error' && __COMMIT__ && run.head_sha === __COMMIT__;

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="App-Version">
          <dl className="grid gap-1 text-sm">
            <Row label="Commit">
              {__COMMIT__ ? (
                <a className="underline decoration-dotted" href={`https://github.com/${REPO}/commit/${__COMMIT__}`} target="_blank" rel="noreferrer">
                  {commit.slice(0, 7)}
                </a>
              ) : (
                commit
              )}
            </Row>
            <Row label="Gebaut">{fmtDate(__BUILD_TIME__)}</Row>
            <Row label="Modus">{import.meta.env.DEV ? 'Dev-Server' : 'Live-Build'}</Row>
          </dl>
        </Card>
        <Card title="Letzter Deploy">
          {run === null ? (
            <p className="text-sm opacity-70">Lade …</p>
          ) : run === 'error' ? (
            <p className="text-sm opacity-70">GitHub nicht erreichbar.</p>
          ) : (
            <dl className="grid gap-1 text-sm">
              <Row label="Status">
                <span style={{ color: run.conclusion === 'success' ? '#7ec850' : run.conclusion ? '#e2603a' : '#f2b53a' }}>
                  {run.conclusion ?? run.status}
                </span>
                {live ? <span className="opacity-70"> · diese Version</span> : null}
              </Row>
              <Row label="Zeit">{fmtDate(run.updated_at)}</Row>
              <Row label="Commit">
                <a className="underline decoration-dotted" href={run.html_url} target="_blank" rel="noreferrer">
                  {run.head_sha.slice(0, 7)} – {run.display_title.slice(0, 60)}
                </a>
              </Row>
            </dl>
          )}
        </Card>
        <Card title="Supabase">
          <dl className="grid gap-1 text-sm">
            <Row label="Auth-API">
              {health === null ? '…' : <span style={{ color: health.ok ? '#7ec850' : '#e2603a' }}>{health.ok ? 'erreichbar' : 'gestört'}</span>}
              {health ? <span className="opacity-70"> · {health.ms} ms</span> : null}
            </Row>
            <Row label="Datenbank">{log ? <span style={{ color: '#7ec850' }}>erreichbar</span> : error ? <span style={{ color: '#e2603a' }}>Fehler</span> : '…'}</Row>
            <Row label="Projekt">{PROJECT_REF || '–'}</Row>
          </dl>
        </Card>
        <Card title="Links">
          <ul className="grid gap-1 text-base">
            <li>
              <a className="underline decoration-dotted" href={`https://supabase.com/dashboard/project/${PROJECT_REF}`} target="_blank" rel="noreferrer">
                Supabase-Dashboard ↗
              </a>
            </li>
            <li>
              <a
                className="underline decoration-dotted"
                href={`https://search.google.com/search-console?resource_id=${encodeURIComponent('https://playhighsandlows.github.io/')}`}
                target="_blank"
                rel="noreferrer"
              >
                Google Search Console ↗
              </a>
            </li>
            <li>
              <a className="underline decoration-dotted" href={`https://github.com/${REPO}/actions`} target="_blank" rel="noreferrer">
                GitHub Actions ↗
              </a>
            </li>
          </ul>
        </Card>
      </div>

      <Card title="Freigegebene Antworten exportieren">
        <p className="text-sm leading-snug opacity-85">
          Freigaben gelten sofort für alle Spieler. Dauerhaft ins Repo (Fragen-JSONs) übernimmt sie das Skript – lokal im Projektordner:
        </p>
        <pre className="mt-2 overflow-x-auto bg-black/40 p-2 text-xs leading-relaxed">
          {`npm run review-ai-answers -- --apply-approved --dry-run
npm run review-ai-answers -- --apply-approved
npm run function-data
git diff   # prüfen, dann committen + pushen
npx supabase functions deploy judge-answer`}
        </pre>
      </Card>

      <Card title="Admin-Protokoll (letzte 50)">
        <ErrorLine error={error} />
        {log === null && !error && <p className="text-sm opacity-70">Lade …</p>}
        {log?.length === 0 && <p className="text-sm opacity-70">Noch keine Admin-Aktionen.</p>}
        <ul className="grid gap-1 text-sm">
          {log?.map((l) => (
            <li key={l.id} className="leading-snug">
              <span className="opacity-60">{fmtDate(l.created_at)}</span> · {ACTION_LABEL[l.action] ?? l.action}
              {l.target ? <span className="opacity-75"> · {l.target.length > 20 ? `${l.target.slice(0, 8)}…` : l.target}</span> : null}
              {l.detail && (l.detail.answer || l.detail.reason || l.detail.count || l.detail.old) ? (
                <span className="opacity-60"> · {String(l.detail.answer ?? l.detail.reason ?? (l.detail.count ? `${l.detail.count}×` : `${l.detail.old} → ${l.detail.new}`))}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 font-tiny text-[0.6rem] uppercase leading-5 opacity-60">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
