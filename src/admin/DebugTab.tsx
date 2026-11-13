import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, berlinDateKey } from '../domain/daily';
import { MODE_TIERS, totalPoints } from '../domain/scoring';
import { MODES, TOPIC_EMOJI, type Lang, type Mode, type Question, type TierId } from '../domain/types';
import { adminDebugFlag, setAdminDebugFlag, setDayOffset, storedDayOffset } from '../debug/debugState';
import { CachedJudge } from '../services/CachedJudge';
import { progressStores, services } from '../services';
import { currentLang } from '../i18n';
import { PxButton } from '../components/px';
import { adminDb, confirmAdmin } from './adminApi';
import { Card, Chips, ConfirmButton, ErrorLine, Field } from './ui';

const BASE = import.meta.env.BASE_URL;
const go = (params: Record<string, string>) => location.assign(`${BASE}?${new URLSearchParams(params)}`);
const TIER_CHOICES: Record<Mode, TierId[]> = {
  rare: [...MODE_TIERS.rare, 'tooClever', 'invalid'],
  common: [...MODE_TIERS.common, 'invalid'],
};
/** Mitten in jede Zone (zones.ts) – Abstieg und Aufstieg, alte und neue. */
const ZONE_JUMPS: ['rare' | 'common', number, string][] = [
  ['rare', 150, 'Erde'],
  ['rare', 600, 'Fels'],
  ['rare', 1250, 'Kristall'],
  ['rare', 1950, 'Pilze'],
  ['rare', 2600, 'Lava'],
  ['rare', 3000, 'Lavafall'],
  ['rare', 4500, 'Hölle'],
  ['rare', 7000, 'Höllentor'],
  ['rare', 8000, 'Eis-Hölle'],
  ['rare', 10000, 'Kristall-Hölle'],
  ['rare', 12000, 'Abgrund'],
  ['common', 600, 'Wiese'],
  ['common', 1900, 'Wolken'],
  ['common', 3100, 'Höhenwind'],
  ['common', 4150, 'Abendrot'],
  ['common', 4950, 'Sterne'],
  ['common', 5400, 'Wolkendecke'],
  ['common', 6200, 'Himmel'],
  ['common', 7000, 'Himmelstor'],
  ['common', 8000, 'Kristallwolken'],
  ['common', 10000, 'Polarlicht'],
  ['common', 12500, 'Weltraum'],
];
const modeName = (m: Mode) => (m === 'rare' ? '▼ Abstieg' : '▲ Aufstieg');

/**
 * Debug-Werkzeuge – wirken nur auf dieses Gerät. Eingeschaltet wird nach einer
 * Server-Prüfung (is_admin); gespielt wird in einer Sandbox, echte Statistik und
 * Sync bleiben unberührt, gespeicherte Antworten sind is_debug.
 */
export function DebugTab() {
  const { t } = useTranslation();
  const [on, setOn] = useState(adminDebugFlag);
  const [offset, setOffset] = useState(storedDayOffset);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>(currentLang());
  const [daily, setDaily] = useState<Record<Mode, Question[]> | null>(null);
  const [, bump] = useState(0);
  const dateKey = addDays(berlinDateKey(), offset);

  const [qid, setQid] = useState('');
  const [qMode, setQMode] = useState<Mode>('rare');
  const [view, setView] = useState<'rare' | 'common' | 'home'>('rare');
  const [meters, setMeters] = useState(3000);
  const [tier, setTier] = useState<string>('core');
  const [rMode, setRMode] = useState<Mode>('rare');

  useEffect(() => {
    let cancelled = false;
    setDaily(null);
    void Promise.all(MODES.map((m) => services.questions.getDailyQuestions(dateKey, lang, m))).then(([rare, common]) => {
      if (!cancelled) setDaily({ rare, common });
    });
    return () => {
      cancelled = true;
    };
  }, [dateKey, lang]);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg((x) => (x === m ? null : x)), 3000);
  };

  const enable = async () => {
    setError(null);
    // Nicht nur das Frontend: der Server muss bestätigen, dass dieses Konto Admin ist
    if (!(await confirmAdmin(adminDb!))) return setError('Server bestätigt keinen Admin – Debug bleibt aus.');
    progressStores.seedSandbox();
    setAdminDebugFlag(true);
    setOn(true);
    flash('Debug an: Sandbox mit Kopie deines Spielstands angelegt.');
  };
  const disable = () => {
    progressStores.sandbox.clearAll();
    setAdminDebugFlag(false);
    setOn(false);
    setOffset(0);
    flash('Debug aus: Sandbox gelöscht, echter Spielstand aktiv.');
  };
  const shift = (d: number | null) => {
    const next = d === null ? 0 : offset + d;
    setDayOffset(next);
    setOffset(next);
  };
  const sandboxStatus = (m: Mode) => {
    const d = progressStores.sandbox.getDay(m, dateKey);
    if (!d) return 'offen';
    if (d.finished) return `fertig · ${totalPoints(d.results)} P.`;
    return `läuft · ${d.results.length}/${d.questionIds.length}`;
  };

  return (
    <div className="grid gap-3">
      <Card title="Debug-Modus auf diesem Gerät">
        <p className="text-base">
          Status: <b style={{ color: on ? '#7ec850' : '#9aa3b5' }}>{on ? 'an' : 'aus'}</b>
        </p>
        <p className="mt-1 text-sm leading-snug opacity-80">
          Im Debug-Modus spielst du in einer Sandbox (Kopie deines Spielstands). Echte Statistik, Serie und Konto-Sync bleiben unberührt;
          gespeicherte Antworten sind als Debug markiert und zählen nirgends. Unten links im Spiel erscheint ein DEBUG-Abzeichen.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {on ? (
            <PxButton tone="stone" small className="text-base" onClick={disable}>
              Debug ausschalten
            </PxButton>
          ) : (
            <PxButton tone="gold" small className="text-base" onClick={() => void enable()}>
              Debug einschalten
            </PxButton>
          )}
          <a href={BASE} className="px-btn px-btn-teal px-btn-sm text-base">
            <span className="px-btn-label">Zum Spiel →</span>
          </a>
        </div>
        <ErrorLine error={error} />
        {msg && <p className="mt-2 text-sm text-[#8be9fd]">{msg}</p>}
      </Card>

      <fieldset disabled={!on} className={`grid gap-3 ${on ? '' : 'opacity-50'}`}>
        <Card title="Spieltag">
          <p className="text-base">
            <b>{dateKey}</b> <span className="opacity-70">({offset === 0 ? 'heute' : `${offset > 0 ? '+' : ''}${offset} Tage`})</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <PxButton tone="stone" small className="text-base" onClick={() => shift(-1)}>
              ◀ Tag
            </PxButton>
            <PxButton tone="stone" small className="text-base" onClick={() => shift(null)} disabled={offset === 0}>
              Heute
            </PxButton>
            <PxButton tone="stone" small className="text-base" onClick={() => shift(1)}>
              Tag ▶
            </PxButton>
          </div>
          <ul className="mt-2 text-sm">
            {MODES.map((m) => (
              <li key={m} className="flex justify-between gap-2">
                <span>{modeName(m)}</span>
                <span className="opacity-85">{on ? sandboxStatus(m) : '–'}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-tiny text-[0.65rem] uppercase opacity-70">Sandbox zurücksetzen</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {MODES.map((m) => (
              <PxButton
                key={m}
                tone="stone"
                small
                className="text-base"
                onClick={() => {
                  progressStores.sandbox.clearDay(m, dateKey);
                  bump((x) => x + 1);
                  flash(`Tagesfortschritt ${modeName(m)} gelöscht.`);
                }}
              >
                Tag {m === 'rare' ? '▼' : '▲'}
              </PxButton>
            ))}
            <ConfirmButton
              tone="stone"
              confirmLabel="Statistik wirklich löschen?"
              onConfirm={() => {
                MODES.forEach((m) => progressStores.sandbox.clearStats(m));
                bump((x) => x + 1);
                flash('Sandbox-Statistik & Serien gelöscht.');
              }}
            >
              Statistik &amp; Serien
            </ConfirmButton>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="Frage direkt spielen">
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (qid.trim()) go({ play: qid.trim(), mode: qMode });
              }}
            >
              <Field label="Frage-ID (z. B. de-food-001)">
                <input value={qid} onChange={(e) => setQid(e.target.value)} className="w-full bg-transparent px-1 text-base" autoCapitalize="off" spellCheck={false} />
              </Field>
              <Chips label="Modus" value={qMode} onChange={setQMode} options={[['rare', '▼ Abstieg'], ['common', '▲ Aufstieg']]} />
              <PxButton tone="teal" small type="submit" className="text-base" disabled={!qid.trim()}>
                Spielen →
              </PxButton>
            </form>
          </Card>

          <Card title="Zone / Höhe anspringen">
            <div className="grid gap-2">
              <Chips label="Welt" value={view} onChange={setView} options={[['rare', '▼ Tiefe'], ['common', '▲ Höhe'], ['home', 'Start']]} />
              <Field label={`Meter: ${meters}`}>
                <input type="range" min={0} max={14000} step={50} value={meters} onChange={(e) => setMeters(Number(e.target.value))} className="w-full" />
              </Field>
              <PxButton tone="teal" small className="text-base" onClick={() => go({ world: view, m: String(meters) })}>
                Anzeigen →
              </PxButton>
              <p className="font-tiny text-[0.65rem] uppercase opacity-70">Jede Zone direkt</p>
              <div className="flex flex-wrap gap-1">
                {ZONE_JUMPS.map(([w, m, label]) => (
                  <button key={`${w}${m}`} type="button" className="px-field px-field-dark px-1 text-sm leading-6 [--px:2px]" onClick={() => go({ world: w, m: String(m) })}>
                    {w === 'rare' ? '▼' : '▲'} {label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Medaille erzwingen">
            <div className="grid gap-2">
              <Chips label="Modus" value={rMode} onChange={(m) => {
                setRMode(m);
                setTier(m === 'rare' ? 'core' : 'stars');
              }} options={[['rare', '▼ Abstieg'], ['common', '▲ Aufstieg']]} />
              <Chips
                label="Stufe"
                value={tier}
                onChange={setTier}
                options={TIER_CHOICES[rMode].map((id) => [id, t(`tiers.${id}`, id)] as [string, string])}
              />
              <PxButton tone="teal" small className="text-base" onClick={() => go({ reveal: tier, mode: rMode })}>
                Einblendung zeigen →
              </PxButton>
            </div>
          </Card>

          <Card title="Caches">
            <div className="grid gap-2">
              <PxButton
                tone="stone"
                small
                className="text-base"
                onClick={() => {
                  CachedJudge.clear();
                  flash('Lokaler KI-Cache geleert.');
                }}
              >
                KI-Cache (lokal) leeren
              </PxButton>
              <ConfirmButton tone="stone" confirmLabel="Wirklich leeren + neu laden?" onConfirm={() => void clearServiceWorker()}>
                Service-Worker-Cache leeren + neu laden
              </ConfirmButton>
            </div>
          </Card>
        </div>
      </fieldset>

      <Card
        title={`Fragen am ${dateKey}`}
        right={<Chips label="Sprache" value={lang} onChange={setLang} options={[['de', 'DE'], ['en', 'EN']]} />}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <div key={m}>
              <p className="font-tiny text-xs uppercase opacity-75">
                {modeName(m)} · {daily ? new Set(daily[m].map((q) => q.topic)).size : '…'} Themen
              </p>
              <ol className="mt-1 grid gap-1.5">
                {daily?.[m].map((q, i) => (
                  <li key={q.id} className="text-sm leading-tight">
                    <span className="text-[#8be9fd]">
                      {i + 1}. {TOPIC_EMOJI[q.topic]} {t(`topics.${q.topic}`, q.topic)}
                    </span>{' '}
                    <button type="button" className="font-tiny text-[0.65rem] underline decoration-dotted opacity-70" disabled={!on} onClick={() => go({ play: q.id, mode: m })}>
                      {q.id}
                    </button>
                    <br />
                    {q.prompt}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function clearServiceWorker() {
  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } finally {
    location.reload();
  }
}
