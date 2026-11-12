import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { matchAwards, standings } from '../domain/roomScoring';
import { Panel, PxButton } from '../components/px';
import { playerColor } from '../pixel/playerColors';
import { roomCall, roomLink, type RoomState } from './roomApi';
import { Avatar } from './ui';

/** Endbildschirm: Podest, Gedankenleser & Einzelgänger, Teilen, Nochmal. */
export function FinalPhase({ s, isHost, onLeave }: { s: RoomState; isHost: boolean; onLeave: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const byId = new Map(s.players.map((p) => [p.user_id, p]));
  const name = (u: string) => (u === s.me ? t('friends.you') : byId.get(u)?.name ?? '?');
  const ranking = standings(Object.fromEntries(s.players.map((p) => [p.user_id, p.points])));
  const awards = matchAwards(s.reveals ?? []);
  const podium = [ranking[1], ranking[0], ranking[2]];
  const heights = ['h-16', 'h-24', 'h-12'];

  const shareText = [
    t('friends.shareResult', { mode: t(`modes.${s.settings.mode}.name`) }),
    ...ranking.slice(0, 5).map((r) => `${['🥇', '🥈', '🥉'][r.place - 1] ?? `${r.place}.`} ${byId.get(r.userId)?.name} – ${r.points}`),
    roomLink(s.code).split('?')[0],
  ].join('\n');
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Highs & Lows', text: shareText });
      else {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* abgebrochen */
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-3">
      <Panel tone="wood" className="px-1">
        <h1 className="text-center text-3xl font-bold">🏆 {t('friends.final')}</h1>
        <div className="mt-4 flex items-end justify-center gap-2" aria-label={t('friends.podium')}>
          {podium.map((r, i) =>
            r ? (
              <motion.div key={r.userId} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: [0.4, 0.8, 0.2][i] }} className="flex w-24 flex-col items-center">
                <Avatar player={byId.get(r.userId)!} scale={i === 1 ? 5 : 4} />
                <span className="mt-1 w-full truncate text-center text-base font-bold">{name(r.userId)}</span>
                <span className="text-sm tabular-nums">{r.points}</span>
                <div className={`mt-1 grid w-full place-items-center ${heights[i]} border-2 border-[#3a2416] text-3xl font-bold text-[#3a2416]`} style={{ background: playerColor(byId.get(r.userId)?.color ?? 0) }}>
                  {r.place}
                </div>
              </motion.div>
            ) : (
              <div key={i} className="w-24" />
            ),
          )}
        </div>
        {ranking.length > 3 && (
          <ol className="mt-3 grid gap-1" start={4}>
            {ranking.slice(3).map((r) => (
              <li key={r.userId} className="flex items-center gap-2">
                <span className="w-6 text-right tabular-nums">{r.place}.</span>
                <Avatar player={byId.get(r.userId)!} scale={2} />
                <span className="min-w-0 flex-1 truncate">{name(r.userId)}</span>
                <span className="tabular-nums">{r.points}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {(awards.mindReaders || awards.loner) && (
        <Panel tone="wood" className="px-1">
          {awards.mindReaders && (
            <div className="flex items-center gap-2">
              <span className="flex -space-x-1">
                <Avatar player={byId.get(awards.mindReaders.a)!} scale={3} />
                <Avatar player={byId.get(awards.mindReaders.b)!} scale={3} />
              </span>
              <p className="leading-tight">
                <b>🔮 {t('friends.mindReaders')}</b>
                <br />
                {t('friends.mindReadersText', { a: name(awards.mindReaders.a), b: name(awards.mindReaders.b), count: awards.mindReaders.count })}
              </p>
            </div>
          )}
          {awards.loner && (
            <div className="mt-3 flex items-center gap-2">
              <Avatar player={byId.get(awards.loner.userId)!} scale={3} />
              <p className="leading-tight">
                <b>🐺 {t('friends.loner')}</b>
                <br />
                {t('friends.lonerText', { name: name(awards.loner.userId), count: awards.loner.count })}
              </p>
            </div>
          )}
        </Panel>
      )}

      <div className="grid gap-2">
        <PxButton tone="gold" className="w-full text-xl" onClick={() => void share()}>
          {copied ? t('friends.copied') : `📤 ${t('friends.shareResultButton')}`}
        </PxButton>
        {isHost ? (
          <PxButton tone="teal" className="w-full text-xl" onClick={() => void roomCall('again', { code: s.code }).catch(() => {})}>
            ↻ {t('friends.again')}
          </PxButton>
        ) : (
          <p className="px-shadow text-center text-[#f3e2bb]">{t('friends.waitAgain')}</p>
        )}
        <button type="button" className="px-shadow text-base text-[#f3e2bb] underline decoration-dotted underline-offset-4" onClick={onLeave}>
          {t('friends.leave')}
        </button>
      </div>
    </motion.div>
  );
}
