import { useEffect, useState } from 'react';
import { MODES, TOPIC_EMOJI, type Mode, type Question } from '../domain/types';
import { currentLang } from '../i18n';
import { totalPoints } from '../domain/scoring';
import { services } from '../services';
import { getDayOffset, setDayOffset } from './debugState';

const OPEN_KEY = 'tuh:v1:debug:panelOpen';
const daysLabel = (n: number) => `${n > 0 ? '+' : ''}${n} ${Math.abs(n) === 1 ? 'Tag' : 'Tage'}`;

/**
 * Debug-Werkzeuge (nur Dev-Server mit ?debug=1):
 * Spieltag vor/zurück, Tagesfortschritt und Statistik zurücksetzen.
 * `onChange` schickt die App zurück zur Startseite und lädt die Stände neu.
 */
export default function DebugPanel({ dateKey, onChange }: { dateKey: string; onChange: () => void }) {
  // Eingeklappt-Zustand merken, damit das Panel beim Spielen nicht im Weg ist.
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* ignorieren */
    }
  };
  const offset = getDayOffset();

  // Heutige Tagesfragen (in der aktuellen Sprache) mit Thema – zum Prüfen der Themen-Mischung.
  const lang = currentLang();
  const [daily, setDaily] = useState<Record<Mode, Question[]> | null>(null);
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

  const shift = (delta: number | null) => {
    setDayOffset(delta === null ? 0 : offset + delta);
    onChange();
  };
  const resetDay = (modes: readonly Mode[]) => {
    modes.forEach((m) => services.progress.clearDay(m, dateKey));
    onChange();
  };
  const resetStats = () => {
    MODES.forEach((m) => services.progress.clearStats(m));
    onChange();
  };

  const status = (mode: Mode) => {
    const d = services.progress.getDay(mode, dateKey);
    if (!d) return 'offen';
    if (d.finished) return `fertig · ${totalPoints(d.results)} P.`;
    return `läuft · ${d.results.length}/${d.questionIds.length}`;
  };

  const btn = 'rounded-md bg-white/10 px-2 py-1 hover:bg-white/20 active:bg-white/30';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 left-3 z-[100] rounded-full bg-black/80 px-3 py-1.5 font-mono text-xs text-lime-300 shadow-lg"
      >
        DEBUG {offset ? `${offset > 0 ? '+' : ''}${offset}d` : ''}
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 left-3 z-[100] max-h-[calc(100dvh-1.5rem)] w-72 overflow-y-auto rounded-xl bg-black/85 p-3 font-mono text-xs text-white shadow-2xl ring-1 ring-lime-400/40 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-bold text-lime-300">DEBUG</span>
        <button type="button" onClick={() => setOpen(false)} className="px-1 text-white/60 hover:text-white" aria-label="Debug-Panel einklappen">
          ✕
        </button>
      </div>

      <p className="mt-2">
        Spieltag <b>{dateKey}</b>{' '}
        <span className="text-white/60">({offset === 0 ? 'heute' : daysLabel(offset)})</span>
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" className={btn} onClick={() => shift(-1)}>
          ◀ Tag
        </button>
        <button type="button" className={btn} onClick={() => shift(null)} disabled={offset === 0}>
          Heute
        </button>
        <button type="button" className={btn} onClick={() => shift(1)}>
          Tag ▶
        </button>
      </div>

      <ul className="mt-3 space-y-0.5 text-white/80">
        {MODES.map((m) => (
          <li key={m} className="flex justify-between">
            <span>{m === 'rare' ? 'Abstieg' : 'Aufstieg'}</span>
            <span>{status(m)}</span>
          </li>
        ))}
      </ul>

      {MODES.map((m) => (
        <details key={m} className="mt-2">
          <summary className="cursor-pointer text-white/60 hover:text-white">
            Fragen {m === 'rare' ? 'Abstieg' : 'Aufstieg'} ({lang}) · {daily ? new Set(daily[m].map((q) => q.topic)).size : '…'} Themen
          </summary>
          <ol className="mt-1 max-h-40 space-y-1 overflow-y-auto pr-1">
            {daily?.[m].map((q, i) => (
              <li key={q.id} className="leading-tight">
                <span className="text-lime-300">
                  {i + 1}. {TOPIC_EMOJI[q.topic]} {q.topic}
                </span>{' '}
                <span className="text-white/50">{q.id}</span>
                <br />
                <span className="text-white/85">{q.prompt}</span>
              </li>
            ))}
          </ol>
        </details>
      ))}

      <p className="mt-3 text-white/60">Tagesfortschritt zurücksetzen:</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button type="button" className={btn} onClick={() => resetDay(['rare'])}>
          Abstieg
        </button>
        <button type="button" className={btn} onClick={() => resetDay(['common'])}>
          Aufstieg
        </button>
        <button type="button" className={btn} onClick={() => resetDay(MODES)}>
          Beide
        </button>
      </div>
      <button type="button" className={`${btn} mt-2 w-full text-red-300`} onClick={resetStats}>
        Statistik &amp; Serien löschen
      </button>
    </div>
  );
}
