import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { MAX_POINTS, TIERS, pointsToMeters, totalPoints } from '../domain/scoring';
import { buildShareText } from '../domain/share';
import type { Mode, Question } from '../domain/types';
import { services, type DayRecord } from '../services';
import { CaveScene } from '../components/scene/CaveScene';
import { SkyScene } from '../components/scene/SkyScene';
import { TIER_COLOR } from '../components/tierStyle';
import { localeFor } from '../i18n';
import { useCountdown } from '../game/useBerlinDay';

export function ResultScreen({
  mode,
  dateKey,
  onHome,
  onOtherMode,
}: {
  mode: Mode;
  dateKey: string;
  onHome: () => void;
  onOtherMode: () => void;
}) {
  const { t } = useTranslation();
  const [record] = useState<DayRecord | null>(() => services.progress.getDay(mode, dateKey));
  const [questions, setQuestions] = useState<Question[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const countdown = useCountdown();
  const rare = mode === 'rare';
  const other: Mode = rare ? 'common' : 'rare';
  const otherDone = services.progress.getDay(other, dateKey)?.finished ?? false;

  useEffect(() => {
    if (record) void services.questions.getQuestionsByIds(record.questionIds, record.lang).then(setQuestions);
  }, [record, mode]);

  if (!record) {
    return (
      <div className="grid h-dvh place-items-center">
        <button type="button" onClick={onHome} className="rounded-full bg-white/10 px-4 py-2">
          {t('result.home')}
        </button>
      </div>
    );
  }

  const locale = localeFor(record.lang);
  const points = totalPoints(record.results);
  const meters = pointsToMeters(points);
  const fmt = new Intl.NumberFormat(locale);
  const stats = services.progress.getStats(mode);
  const streak = services.progress.getStreak(mode, dateKey);
  const avg = stats.played ? Math.round(stats.totalPoints / stats.played) : 0;

  const share = async () => {
    const text = buildShareText(mode, dateKey, record.results, {
      title: t('app.title'),
      modeName: t(`modes.${mode}.name`),
      measureLabel: t(`modes.${mode}.measure`),
      locale,
      url: location.protocol === 'https:' ? location.origin + location.pathname : undefined,
    });
    try {
      // Auf Handys das native Teilen-Menü, sonst Zwischenablage.
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setToast(t('result.copied'));
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
      setToast(text); // Fallback: Text anzeigen, damit man ihn markieren kann
    }
    window.setTimeout(() => setToast(null), 2500);
  };

  const panel = rare ? 'bg-cave-900/80 ring-1 ring-white/10 text-cream' : 'bg-white/80 ring-1 ring-white/70 text-[#1d2a52]';

  return (
    <div className="relative min-h-dvh w-full">
      <div className="fixed inset-0">
        {rare ? <CaveScene progress={points / MAX_POINTS} showLift={false} /> : <SkyScene progress={points / MAX_POINTS} showBalloon={false} />}
      </div>

      <div className="relative z-10 mx-auto max-w-xl px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-3xl p-6 text-center shadow-2xl backdrop-blur-md ${panel}`}
        >
          <p className="text-sm uppercase tracking-[0.2em] opacity-70">{t('result.title', { mode: t(`modes.${mode}.name`) })}</p>
          <motion.p
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.15 }}
            className="mt-2 font-display text-6xl font-bold tabular-nums"
            style={{ color: rare ? '#8be9fd' : '#ff7a59', textShadow: rare ? '0 0 30px rgba(139,233,253,0.5)' : undefined }}
          >
            {rare && meters > 0 ? '−' : ''}
            {fmt.format(meters)} m
          </motion.p>
          <p className="mt-1 opacity-80">{t('result.points', { points, max: MAX_POINTS })}</p>
          <p className="mt-4 text-3xl tracking-wider" aria-label={record.results.map((r) => t(`tiers.${r.tier}`)).join(', ')}>
            {record.results.map((r) => TIERS[r.tier].emoji).join('')}
          </p>
          <button
            type="button"
            onClick={share}
            className={`mt-6 w-full rounded-2xl px-6 py-3.5 text-lg font-semibold transition active:scale-[0.98] ${
              rare ? 'bg-glow-crystal text-cave-950' : 'bg-balloon text-white'
            }`}
          >
            {t('result.share')} ↗
          </button>
          {toast && <p className="mt-3 whitespace-pre-line text-sm opacity-90">{toast}</p>}
          <p className="mt-4 text-sm opacity-70">{t('home.nextIn', { time: countdown })}</p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={`mt-4 rounded-3xl p-4 backdrop-blur-md ${panel}`}
        >
          <ol className="divide-y divide-current/10">
            {record.results.map((r, i) => {
              const q = questions.find((x) => x.id === r.questionId);
              return (
                <li key={r.questionId} className="flex items-center gap-3 py-2.5">
                  <span className="text-xl" aria-hidden>
                    {TIERS[r.tier].emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm opacity-70">
                      {i + 1}. {q?.prompt ?? '…'}
                    </p>
                    <p className="truncate font-medium">{r.matched ?? (r.input.trim() ? `„${r.input}“` : '—')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold" style={{ color: TIER_COLOR[r.tier] }}>
                      {t(`tiers.${r.tier}`)}
                    </p>
                    <p className="text-sm tabular-nums opacity-70">{r.points}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className={`mt-4 rounded-3xl p-4 backdrop-blur-md ${panel}`}
        >
          <h2 className="mb-3 font-display text-lg font-semibold">{t('result.stats')}</h2>
          <dl className="grid grid-cols-4 gap-2 text-center">
            {[
              [t('result.played'), stats.played],
              [t('result.average'), avg],
              [t('result.best'), stats.best],
              [t('result.streak'), streak],
            ].map(([label, value]) => (
              <div key={label}>
                <dd className="font-display text-2xl font-bold tabular-nums">{value}</dd>
                <dt className="text-xs opacity-70">{label}</dt>
              </div>
            ))}
          </dl>
        </motion.section>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onHome} className={`flex-1 rounded-2xl px-4 py-3 font-semibold backdrop-blur ${rare ? 'bg-white/10' : 'bg-white/60'}`}>
            {t('result.home')}
          </button>
          {!otherDone && (
            <button
              type="button"
              onClick={onOtherMode}
              className={`flex-1 rounded-2xl px-4 py-3 font-semibold ${rare ? 'bg-balloon text-white' : 'bg-cave-900 text-glow-crystal'}`}
            >
              {t('result.otherMode', { mode: t(`modes.${other}.name`) })} {rare ? '🎈' : '⛏️'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
