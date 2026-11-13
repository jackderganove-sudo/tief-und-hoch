import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { attemptKey } from '../domain/attempts';
import type { Mode } from '../domain/types';
import { modeTheme } from './PlayShell';
import { PxButton } from './px';

/** Rückmeldung auf einen Fehlversuch. `id` zählt hoch, damit das Wackeln jedes Mal neu spielt. */
export interface AttemptFeedback {
  id: number;
  kind: 'invalid' | 'duplicate' | 'unchecked' | 'listOnly' | 'limited';
  input: string;
  /** „Meintest du …?“ */
  hint: string | null;
}

/**
 * Eingabefeld für beliebig viele Versuche (Tagesrunde, Übung, Freunde-Modus).
 *
 * Fehlversuch: Feld wackelt, rotes Pixel-Kreuz mit Text, Feld wird geleert – Fokus und
 * Tastatur bleiben offen, man tippt sofort weiter. Darunter klein die schon versuchten
 * Antworten (durchgestrichen). Während der Server prüft, ist die Eingabe gesperrt.
 */
export function AttemptInput({
  mode,
  checking,
  feedback,
  tried,
  unchecked = [],
  note = null,
  liveHint,
  onSubmit,
  valueRef,
}: {
  mode: Mode;
  /** Server/KI prüft gerade: Eingabe gesperrt, Lade-Animation */
  checking: boolean;
  feedback: AttemptFeedback | null;
  /** Eingaben, die nicht nochmal gehen (älteste zuerst) */
  tried: readonly string[];
  /** Davon bzw. zusätzlich: Eingaben, die nicht geprüft werden konnten (nicht falsch) */
  unchecked?: readonly string[];
  /** Dauerhinweis, z. B. „Nur noch Antworten aus der Liste möglich“ */
  note?: string | null;
  /** Hinweis beim Tippen („Gemeint: …?“) */
  liveHint?: (input: string) => string | null;
  onSubmit: (text: string) => void;
  /** Bekommt immer den aktuellen Text (für „Zeit abgelaufen“) */
  valueRef?: MutableRefObject<string>;
}) {
  const { t } = useTranslation();
  const theme = modeTheme(mode);
  const reduce = useReducedMotion();
  const [input, setInput] = useState('');
  const el = useRef<HTMLInputElement>(null);
  if (valueRef) valueRef.current = input;

  const shake = useAnimationControls();
  /** Text im Feld direkt nach der Rückmeldung – sie bleibt stehen, bis wieder getippt wird */
  const [base, setBase] = useState<string | null>(null);

  // Fehlversuch: Feld leeren (außer „nicht geprüft“ – da darf dieselbe Eingabe nochmal), Fokus halten,
  // wackeln. Das Feld wird dabei NICHT neu aufgebaut, sonst ginge die Tastatur zu.
  useEffect(() => {
    if (!feedback) return setBase(null);
    const keep = feedback.kind === 'unchecked' ? feedback.input : '';
    setInput(keep);
    setBase(keep);
    el.current?.focus({ preventScroll: true });
    if (!reduce) void shake.start({ x: [0, -7, 7, -5, 5, -2, 0], transition: { duration: 0.32 } });
  }, [feedback?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const typing = input.trim() !== '';
  const shown = !checking && feedback && base !== null && input === base ? feedback : null;
  const hint = !checking && typing && !shown ? (liveHint?.(input) ?? null) : null;
  // „nicht geprüft“ ist etwas anderes als „nicht gültig“: gelbes Fragezeichen statt rotem Kreuz
  const notChecked = shown?.kind === 'unchecked' || shown?.kind === 'listOnly' || shown?.kind === 'limited';
  const text = shown
    ? t(shown.kind === 'duplicate' ? 'game.alreadyTried' : shown.kind === 'unchecked' ? 'game.uncheckedRetry' : notChecked ? 'game.notChecked' : 'game.notValid')
    : '';
  const isUnchecked = (a: string) => unchecked.some((u) => attemptKey(u) === attemptKey(a));
  // nicht geprüfte, die noch einmal versucht werden dürfen, stehen nicht bei „versucht“
  const extra = unchecked.filter((u) => !tried.some((x) => attemptKey(x) === attemptKey(u)));

  /** Tippen auf Knöpfe darf dem Feld den Fokus nicht nehmen – sonst klappt die Tastatur zu. */
  const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

  return (
    <div>
      <motion.form
        // Wackeln bei jedem Fehlversuch (ohne Bewegung: nur Kreuz und Text)
        animate={shake}
        className="mt-4 flex gap-2 [@media(max-height:520px)]:mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!checking && input.trim()) onSubmit(input.trim());
          el.current?.focus({ preventScroll: true });
        }}
      >
        <input
          ref={el}
          value={input}
          // gesperrt = Eingaben verwerfen; nicht readOnly/disabled, das würde die Tastatur schließen
          onChange={(e) => !checking && setInput(e.target.value)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={60}
          // ohne eigene Mindestbreite – sonst sprengt das Feld schmale Raster (Freunde-Modus) seitlich
          size={1}
          aria-busy={checking}
          aria-invalid={!!shown}
          // iOS verschiebt nur den sichtbaren Ausschnitt – Feld nach dem Öffnen der Tastatur sicher ins Bild holen
          onFocus={(e) => {
            const node = e.currentTarget;
            window.setTimeout(() => node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
          }}
          placeholder={t('game.placeholder')}
          aria-label={t('game.placeholder')}
          className={`${theme.field} min-w-0 flex-1 bg-transparent px-1 text-xl placeholder:opacity-50 ${checking ? 'opacity-60' : ''}`}
          // rote Umrandung statt der gelben Fokus-Umrandung, solange die Rückmeldung steht
          style={shown ? { outline: `3px solid ${notChecked ? '#f2b53a' : '#e2541e'}`, outlineOffset: 0 } : undefined}
        />
        <PxButton tone={theme.rare ? 'gold' : theme.primary} type="submit" disabled={!typing || checking} className="text-lg" {...keepFocus}>
          {t('game.submit')}
        </PxButton>
      </motion.form>

      <div className="mt-1 min-h-6 text-base" role="status" aria-live="polite">
        {checking ? (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex items-center gap-2">
            <span className="px-loader" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {t('game.aiChecking')}
          </motion.p>
        ) : shown ? (
          <p className="flex flex-wrap items-center gap-x-2 font-bold" data-feedback={shown.kind}>
            {notChecked ? <PixelQuestion /> : <PixelCross />}
            <span>{text}</span>
            {shown.hint && (
              <button type="button" {...keepFocus} onClick={() => setInput(shown.hint!)} className="font-normal underline decoration-dotted underline-offset-4">
                {t('game.meantHint', { answer: shown.hint })}
              </button>
            )}
          </p>
        ) : hint ? (
          <button type="button" {...keepFocus} onClick={() => setInput(hint)} className="underline decoration-dotted underline-offset-4">
            {t('game.didYouMean', { answer: hint })}
          </button>
        ) : null}
      </div>

      {note && <p className="mt-1 text-sm font-bold opacity-90">{note}</p>}

      {tried.length + extra.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-sm leading-tight opacity-70" aria-label={t('game.triedLabel')} data-tried>
          {[...tried, ...extra].map((a) =>
            isUnchecked(a) ? (
              // nicht geprüft: nicht durchgestrichen, mit Fragezeichen
              <span key={a} className="max-w-[12rem] truncate" title={t('game.notCheckedShort')} data-unchecked>
                {a} <b aria-hidden>?</b>
              </span>
            ) : (
              <s key={a} className="max-w-[12rem] truncate">
                {a}
              </s>
            ),
          )}
        </p>
      )}
    </div>
  );
}

/** Gelbes Pixel-Fragezeichen: „nicht geprüft“ (nicht dasselbe wie falsch). */
export function PixelQuestion({ size = 18 }: { size?: number }) {
  // 5×7-Raster
  const rows = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden className="shrink-0">
      <rect x={0} y={0} width={9} height={9} fill="#3a2a10" />
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x + 2} y={y + 1} width={1} height={1} fill="#f2b53a" /> : null)))}
    </svg>
  );
}

/** Rotes Pixel-Kreuz (7×7), gestochen scharf. */
export function PixelCross({ size = 18 }: { size?: number }) {
  const cells = [0, 1, 2, 3, 4, 5, 6];
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden className="shrink-0">
      {/* dunkler Rand, darauf das rote Kreuz */}
      {cells.flatMap((i) => [
        <rect key={`a${i}`} x={i} y={i} width={3} height={3} fill="#3a1410" />,
        <rect key={`b${i}`} x={6 - i} y={i} width={3} height={3} fill="#3a1410" />,
      ])}
      {cells.flatMap((i) => [
        <rect key={`c${i}`} x={i + 1} y={i + 1} width={1} height={1} fill="#e2541e" />,
        <rect key={`d${i}`} x={7 - i} y={i + 1} width={1} height={1} fill="#e2541e" />,
      ])}
    </svg>
  );
}
