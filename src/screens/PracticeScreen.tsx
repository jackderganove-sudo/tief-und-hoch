import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { QUESTIONS_PER_DAY, TIERS, pointsToMeters, totalPoints } from '../domain/scoring';
import { MODES, TOPICS, type AnswerResult, type Lang, type Mode, type TopicId, type TopicSelection } from '../domain/types';
import { usePractice } from '../game/usePractice';
import { services } from '../services';
import { PlayShell, modeTheme } from '../components/PlayShell';
import { QuestionCard } from '../components/QuestionCard';
import { TierReveal } from '../components/TierReveal';
import { TopicPicker } from '../components/TopicPicker';
import { PixelWorld } from '../pixel/PixelWorld';
import { localeFor } from '../i18n';

const SETUP_KEY = 'tuh:v1:practice';

interface Setup {
  mode: Mode;
  topics: TopicSelection;
}

function loadSetup(): Setup {
  try {
    const raw = JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null') as Partial<Setup> | null;
    const mode: Mode = raw?.mode === 'common' ? 'common' : 'rare';
    const topics: TopicSelection = Array.isArray(raw?.topics)
      ? TOPICS.filter((t) => (raw!.topics as string[]).includes(t))
      : 'all';
    return { mode, topics: Array.isArray(topics) && topics.length === 0 ? 'all' : topics };
  } catch {
    return { mode: 'rare', topics: 'all' };
  }
}

function saveSetup(setup: Setup) {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
  } catch {
    /* ignorieren */
  }
}

/** Übungsmodus: erst Modus + Themen wählen, dann endlos spielen. */
export function PracticeScreen({ lang, dateKey, onExit }: { lang: Lang; dateKey: string; onExit: () => void }) {
  const [setup, setSetup] = useState<Setup>(loadSetup);
  const [session, setSession] = useState(0); // 0 = Auswahl, sonst laufende Sitzung

  if (session === 0) {
    return (
      <PracticeSetup
        lang={lang}
        setup={setup}
        onChange={setSetup}
        onExit={onExit}
        onStart={() => {
          saveSetup(setup);
          setSession((n) => n + 1);
        }}
      />
    );
  }
  return (
    <PracticeSession
      key={session}
      lang={lang}
      dateKey={dateKey}
      setup={setup}
      onExit={onExit}
      onSetup={() => setSession(0)}
      onAgain={() => setSession((n) => n + 1)}
    />
  );
}

function PracticeSetup({
  lang,
  setup,
  onChange,
  onStart,
  onExit,
}: {
  lang: Lang;
  setup: Setup;
  onChange: (s: Setup) => void;
  onStart: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const theme = modeTheme(setup.mode);
  const [counts, setCounts] = useState<Record<TopicId, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCounts(null);
    void services.questions.getTopicCounts(lang, setup.mode).then((c) => !cancelled && setCounts(c));
    return () => {
      cancelled = true;
    };
  }, [lang, setup.mode]);

  const selected = counts
    ? TOPICS.filter((topic) => (setup.topics === 'all' || setup.topics.includes(topic)) && counts[topic] > 0)
    : [];
  const available = counts ? selected.reduce((s, topic) => s + counts[topic], 0) : 0;

  return (
    <div className={`relative min-h-dvh w-full ${theme.text}`}>
      <div className="fixed inset-0">
        <PixelWorld view={setup.mode} meters={setup.mode === 'rare' ? 2600 : 1800} />
      </div>
      <div className="relative z-10 mx-auto max-w-xl px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onExit} className={`rounded-full px-3 py-1.5 text-sm font-medium backdrop-blur ${theme.ghost}`}>
          ← {t('game.back')}
        </button>
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-4 rounded-3xl p-5 backdrop-blur-md ${theme.card}`}
        >
          <h1 className="font-display text-4xl font-bold">∞ {t('practice.title')}</h1>
          <p className="mt-2 text-sm opacity-80">{t('practice.intro')}</p>

          <h2 className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] opacity-70">{t('practice.mode')}</h2>
          <div role="radiogroup" aria-label={t('practice.mode')} className="mt-2 grid grid-cols-2 gap-2">
            {MODES.map((mode) => {
              const active = setup.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...setup, mode })}
                  className={`rounded-2xl px-3 py-3 text-left ring-2 transition ${
                    active ? (mode === 'rare' ? 'bg-cave-950 text-cream ring-glow-crystal' : 'bg-white text-[#1d2a52] ring-balloon') : `ring-transparent ${theme.ghost}`
                  }`}
                >
                  <span className="font-display text-xl font-bold">
                    {mode === 'rare' ? '⛏️' : '🎈'} {t(`modes.${mode}.name`)}
                  </span>
                  <span className="mt-0.5 block text-xs opacity-75">{t(`modes.${mode}.tagline`)}</span>
                </button>
              );
            })}
          </div>

          <h2 className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] opacity-70">{t('topics.legend')}</h2>
          <div className="mt-2">
            <TopicPicker
              value={setup.topics}
              onChange={(topics) => onChange({ ...setup, topics })}
              counts={counts ?? undefined}
              tone={theme.rare ? 'dark' : 'light'}
            />
          </div>

          <p className="mt-4 text-sm opacity-75" aria-live="polite">
            {!counts ? t('home.loading') : selected.length === 0 ? t('practice.pickTopic') : t('practice.available', { count: available })}
          </p>
          <button
            type="button"
            onClick={onStart}
            disabled={available === 0}
            className={`mt-3 w-full rounded-2xl px-6 py-3.5 text-lg font-semibold transition active:scale-[0.98] disabled:opacity-40 ${theme.primary}`}
          >
            {t('practice.start')}
          </button>
        </motion.section>
      </div>
    </div>
  );
}

function PracticeSession({
  lang,
  dateKey,
  setup,
  onExit,
  onSetup,
  onAgain,
}: {
  lang: Lang;
  dateKey: string;
  setup: Setup;
  onExit: () => void;
  onSetup: () => void;
  onAgain: () => void;
}) {
  const { t } = useTranslation();
  const { mode } = setup;
  const theme = modeTheme(mode);
  const game = usePractice(mode, lang, setup.topics, dateKey);
  const n = game.results.length;
  const avg = n ? totalPoints(game.results) / n : 0;
  // Höhenmesser: Schnitt, hochgerechnet auf ein Tagesspiel mit 7 Fragen.
  const meters = pointsToMeters(Math.round(avg * QUESTIONS_PER_DAY));

  return (
    <PlayShell
      mode={mode}
      meters={meters}
      locale={localeFor(lang)}
      title={`∞ ${t(`modes.${mode}.name`)}`}
      backLabel={game.status === 'summary' || n === 0 ? t('game.back') : t('practice.end')}
      onBack={game.status === 'summary' || n === 0 ? onSetup : game.finish}
      info={game.status === 'question' ? t('practice.questionNo', { n: n + 1 }) : n > 0 ? t('practice.average', { points: Math.round(avg) }) : null}
      strip={<EmojiStrip results={game.results} />}
      fx={game.lastResult ? { key: n, tier: game.lastResult.tier, points: game.lastResult.points } : null}
    >
      <AnimatePresence mode="wait">
        {game.status === 'loading' && (
          <motion.p key="loading" className="text-center opacity-70" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {t('home.loading')}
          </motion.p>
        )}

        {game.status === 'empty' && (
          <motion.div key="empty" className={`rounded-3xl p-6 text-center backdrop-blur-md ${theme.card}`}>
            {t('practice.noQuestions')}
          </motion.div>
        )}

        {game.status === 'question' && game.question && game.deadline && (
          <QuestionCard key={`q-${n}`} question={game.question} deadline={game.deadline} mode={mode} onSubmit={game.submit} />
        )}

        {game.status === 'reveal' && game.lastResult && game.question && (
          <TierReveal
            key={`r-${n}`}
            result={game.lastResult}
            question={game.question}
            mode={mode}
            nextLabel={t('game.next')}
            onNext={game.next}
            secondaryLabel={t('practice.end')}
            onSecondary={game.finish}
          />
        )}

        {game.status === 'summary' && (
          <motion.section
            key="summary"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-3xl p-6 text-center backdrop-blur-md ${theme.card}`}
          >
            <p className="text-sm uppercase tracking-[0.2em] opacity-70">{t('practice.summary')}</p>
            <p className="mt-2 font-display text-5xl font-bold tabular-nums" style={{ color: theme.rare ? '#8be9fd' : '#ff7a59' }}>
              {t('practice.average', { points: Math.round(avg) })}
            </p>
            <p className="mt-1 opacity-80">{t('practice.answered', { count: n })}</p>
            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div>
                <dd className="font-display text-2xl font-bold tabular-nums">
                  {game.results.filter((r) => r.matched).length}/{n}
                </dd>
                <dt className="text-xs opacity-70">{t('practice.valid')}</dt>
              </div>
              <div>
                <dd className="font-display text-2xl font-bold tabular-nums">
                  {theme.rare && meters > 0 ? '−' : ''}
                  {new Intl.NumberFormat(localeFor(lang)).format(meters)} m
                </dd>
                <dt className="text-xs opacity-70">{t('practice.projected')}</dt>
              </div>
            </dl>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={onExit} className={`flex-1 rounded-2xl px-4 py-3 font-semibold ${theme.ghost}`}>
                {t('result.home')}
              </button>
              <button type="button" onClick={onAgain} autoFocus className={`flex-1 rounded-2xl px-4 py-3 font-semibold ${theme.primary}`}>
                {t('practice.again')}
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </PlayShell>
  );
}

/** Die letzten Ergebnisse als Emoji-Reihe. */
function EmojiStrip({ results }: { results: AnswerResult[] }) {
  const { t } = useTranslation();
  const last = results.slice(-12);
  return (
    <p className="h-6 text-center text-lg tracking-wide" aria-label={last.map((r) => t(`tiers.${r.tier}`)).join(', ')}>
      {results.length > last.length && <span className="opacity-50">… </span>}
      {last.map((r) => TIERS[r.tier].emoji).join('')}
    </p>
  );
}
