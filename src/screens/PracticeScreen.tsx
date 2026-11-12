import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { QUESTIONS_PER_DAY, pointsToMeters, totalPoints } from '../domain/scoring';
import { MODES, TOPICS, type AnswerResult, type Lang, type Mode, type TopicId, type TopicSelection } from '../domain/types';
import { usePractice } from '../game/usePractice';
import { services } from '../services';
import { PlayShell, modeTheme } from '../components/PlayShell';
import { QuestionCard } from '../components/QuestionCard';
import { TierReveal } from '../components/TierReveal';
import { TopicPicker } from '../components/TopicPicker';
import { Panel, PxButton, TierIcon } from '../components/px';
import { PixelWorld } from '../pixel/PixelWorld';
import { localeFor } from '../i18n';

const SETUP_KEY = 'hal:v1:practice';

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
    <div className="relative min-h-dvh w-full">
      <div className="fixed inset-0">
        <PixelWorld view={setup.mode} meters={setup.mode === 'rare' ? 2600 : 1800} />
      </div>
      <div className="relative z-10 mx-auto max-w-xl px-3 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <PxButton tone={theme.secondary} small onClick={onExit} aria-label={t('game.back')} className="text-base">
          ← {t('game.back')}
        </PxButton>
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
          <Panel tone={theme.panel} className="px-1">
            <h1 className="text-4xl font-bold leading-none">∞ {t('practice.title')}</h1>
            <p className="mt-2 text-base leading-snug opacity-85">{t('practice.intro')}</p>

            <h2 className="mt-4 font-tiny text-xs uppercase opacity-75">{t('practice.mode')}</h2>
            <div role="radiogroup" aria-label={t('practice.mode')} className="mt-1 grid grid-cols-2 gap-2">
              {MODES.map((mode) => {
                const active = setup.mode === mode;
                return (
                  <PxButton
                    key={mode}
                    role="radio"
                    aria-checked={active}
                    tone={active ? 'gold' : theme.secondary}
                    onClick={() => onChange({ ...setup, mode })}
                    className="text-left text-lg"
                  >
                    {mode === 'rare' ? '▼' : '▲'} {t(`modes.${mode}.name`)}
                  </PxButton>
                );
              })}
            </div>

            <h2 className="mt-4 font-tiny text-xs uppercase opacity-75">{t('topics.legend')}</h2>
            <div className="mt-1">
              <TopicPicker
                value={setup.topics}
                onChange={(topics) => onChange({ ...setup, topics })}
                counts={counts ?? undefined}
                tone={theme.rare ? 'dark' : 'light'}
              />
            </div>

            <p className="mt-3 text-base" aria-live="polite">
              {!counts ? t('home.loading') : selected.length === 0 ? t('practice.pickTopic') : t('practice.available', { count: available })}
            </p>
            <PxButton tone={theme.rare ? 'gold' : theme.primary} onClick={onStart} disabled={available === 0} className="mt-2 w-full text-xl">
              {t('practice.start')}
            </PxButton>
          </Panel>
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
          <motion.div key="empty">
            <Panel tone={theme.panel} className="text-center">
              {t('practice.noQuestions')}
            </Panel>
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
          <motion.section key="summary" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <Panel tone={theme.panel} className="px-1 text-center">
              <p className="font-tiny text-xs uppercase opacity-75">{t('practice.summary')}</p>
              <p className="mt-2 text-5xl font-bold tabular-nums" style={{ color: theme.accent }}>
                {t('practice.average', { points: Math.round(avg) })}
              </p>
              <p className="mt-1 text-lg">{t('practice.answered', { count: n })}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <dd className="text-2xl font-bold tabular-nums">
                    {game.results.filter((r) => r.matched).length}/{n}
                  </dd>
                  <dt className="text-sm opacity-75">{t('practice.valid')}</dt>
                </div>
                <div>
                  <dd className="text-2xl font-bold tabular-nums">
                    {theme.rare && meters > 0 ? '−' : ''}
                    {new Intl.NumberFormat(localeFor(lang)).format(meters)} m
                  </dd>
                  <dt className="text-sm opacity-75">{t('practice.projected')}</dt>
                </div>
              </dl>
              <div className="mt-4 flex gap-2">
                <PxButton tone={theme.secondary} onClick={onExit} className="flex-1 text-lg">
                  {t('result.home')}
                </PxButton>
                <PxButton tone={theme.rare ? 'gold' : theme.primary} onClick={onAgain} autoFocus className="flex-1 text-lg">
                  {t('practice.again')}
                </PxButton>
              </div>
            </Panel>
          </motion.section>
        )}
      </AnimatePresence>
    </PlayShell>
  );
}

/** Die letzten Ergebnisse als Icon-Reihe. */
function EmojiStrip({ results }: { results: AnswerResult[] }) {
  const { t } = useTranslation();
  const last = results.slice(-10);
  return (
    <p className="flex h-8 items-center justify-center gap-1" aria-label={last.map((r) => t(`tiers.${r.tier}`)).join(', ')}>
      {last.map((r, i) => (
        <TierIcon key={results.length - last.length + i} tier={r.tier} scale={2} />
      ))}
    </p>
  );
}
