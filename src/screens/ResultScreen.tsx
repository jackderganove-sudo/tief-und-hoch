import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { MAX_POINTS, pointsToMeters, totalPoints } from '../domain/scoring';
import { buildShareText } from '../domain/share';
import type { Mode, Question } from '../domain/types';
import { services, type DayRecord } from '../services';
import { PixelWorld } from '../pixel/PixelWorld';
import { TIER_COLOR } from '../components/tierStyle';
import { modeTheme } from '../components/PlayShell';
import { Panel, PxButton, TierIcon } from '../components/px';
import { AiBadge } from '../components/AiBadge';
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
  const [aiHintRow, setAiHintRow] = useState<number | null>(null);
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
        <PxButton tone="wood" onClick={onHome}>
          {t('result.home')}
        </PxButton>
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

  const theme = modeTheme(mode);

  return (
    <div className="relative min-h-dvh w-full">
      <div className="fixed inset-0">
        <PixelWorld view={mode} meters={meters} />
      </div>

      <div className="relative z-10 mx-auto max-w-xl px-3 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Panel tone={theme.panel} className="px-1 text-center">
            <p className="font-tiny text-xs uppercase opacity-75">{t('result.title', { mode: t(`modes.${mode}.name`) })}</p>
            <p className="mt-2 text-6xl font-bold leading-none tabular-nums" style={{ color: theme.accent, textShadow: rare ? '3px 3px 0 #0e0a16' : '3px 3px 0 rgba(58,36,22,0.25)' }}>
              {rare && meters > 0 ? '−' : ''}
              {fmt.format(meters)} m
            </p>
            <p className="mt-2 text-lg">{t('result.points', { points, max: MAX_POINTS })}</p>
            <p className="mt-3 flex justify-center gap-1" aria-label={record.results.map((r) => t(`tiers.${r.tier}`)).join(', ')}>
              {record.results.map((r, i) => (
                <TierIcon key={i} tier={r.tier} scale={2} />
              ))}
            </p>
            <PxButton tone={rare ? 'gold' : theme.primary} onClick={share} className="mt-4 w-full text-xl">
              {t('result.share')} ↗
            </PxButton>
            {toast && <p className="mt-2 whitespace-pre-line text-sm">{toast}</p>}
            <p className="mt-3 text-sm opacity-80">{t('home.nextIn', { time: countdown })}</p>
          </Panel>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-3">
          <Panel tone={theme.panel} className="px-1">
            <ol>
              {record.results.map((r, i) => {
                const q = questions.find((x) => x.id === r.questionId);
                return (
                  <li key={r.questionId} className={`flex items-center gap-2 py-2 ${i ? 'border-t-2 border-dashed border-current/20' : ''}`}>
                    <TierIcon tier={r.tier} scale={2} className="shrink-0" />
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm opacity-75">
                        {i + 1}. {q?.prompt ?? '…'}
                      </p>
                      <p className="flex items-center text-lg">
                        <span className="truncate">{r.matched ?? (r.input.trim() ? `„${r.input}“` : '—')}</span>
                        {r.source === 'ai' && !r.unchecked && (
                          <AiBadge mode={mode} open={aiHintRow === i} onToggle={() => setAiHintRow((v) => (v === i ? null : i))} />
                        )}
                      </p>
                      {aiHintRow === i && <p className="text-sm leading-snug opacity-85">{t('game.aiBadgeHint')}</p>}
                    </div>
                    <div className="text-right leading-tight">
                      <p className="text-base font-bold" style={{ color: TIER_COLOR[r.tier], textShadow: rare ? '1px 1px 0 #0e0a16' : undefined }}>
                        {t(`tiers.${r.tier}`)}
                      </p>
                      <p className="text-sm tabular-nums opacity-75">{r.points}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mt-3">
          <Panel tone={theme.panel} className="px-1">
            <h2 className="text-xl font-bold">{t('result.stats')}</h2>
            <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
              {[
                [t('result.played'), stats.played],
                [t('result.average'), avg],
                [t('result.best'), stats.best],
                [t('result.streak'), streak],
              ].map(([label, value]) => (
                <div key={label}>
                  <dd className="text-2xl font-bold tabular-nums">{value}</dd>
                  <dt className="text-xs opacity-75">{label}</dt>
                </div>
              ))}
            </dl>
          </Panel>
        </motion.section>

        <div className="mt-3 flex gap-2">
          <PxButton tone={theme.secondary} onClick={onHome} className="flex-1 text-lg">
            {t('result.home')}
          </PxButton>
          {!otherDone && (
            <PxButton tone={rare ? 'coral' : 'teal'} onClick={onOtherMode} className="flex-1 text-lg">
              {t('result.otherMode', { mode: t(`modes.${other}.name`) })} {rare ? '▲' : '▼'}
            </PxButton>
          )}
        </div>
      </div>
    </div>
  );
}
