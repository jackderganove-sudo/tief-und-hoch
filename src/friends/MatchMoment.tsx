import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { myMatch } from '../domain/roomScoring';
import { Panel } from '../components/px';
import type { RoomState } from './roomApi';
import { Avatar, buzz, listNames } from './ui';

/**
 * „Match“-Moment direkt nach der Frage (erst wenn die Zeit vorbei ist – die Auflösung
 * existiert vorher gar nicht): Wer hatte dasselbe wie ich? 2,6 s, Tippen überspringt.
 */
export function MatchMoment({ s, onDone }: { s: RoomState; onDone: () => void }) {
  const { t } = useTranslation();
  const r = s.reveal!;
  const mine = r.players[s.me];
  const m = myMatch(r, s.me);
  const others = m.others.map((u) => s.players.find((p) => p.user_id === u)).filter((p): p is NonNullable<typeof p> => !!p);
  const me = s.players.find((p) => p.user_id === s.me)!;
  const rare = s.settings.mode === 'rare';

  let kind: 'pair' | 'alone' | 'invalid' | 'missed';
  if (!mine?.answer) kind = 'missed';
  else if (!m.valid) kind = 'invalid';
  else kind = others.length ? 'pair' : 'alone';

  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    // Erfolg: Doppel-Puls; allein im Aufstieg / ungültig: ein kurzer
    buzz(kind === 'pair' || (kind === 'alone' && rare) ? [35, 60, 35] : 25);
    const id = setTimeout(() => done.current(), 2600);
    return () => clearTimeout(id);
  }, [kind, rare]);

  const names = listNames(
    others.map((p) => p.name),
    t('friends.and'),
    (n) => t('friends.plusOthers', { count: n }),
  );
  const title =
    kind === 'pair'
      ? others.length > 3
        ? t('friends.match.many', { count: others.length })
        : t('friends.match.pair', { names })
      : kind === 'alone'
        ? rare
          ? t('friends.match.onlyYou')
          : t('friends.match.aloneCommon')
        : kind === 'invalid'
          ? t('friends.match.invalid')
          : t('friends.match.missed');
  const good = kind === 'pair' || (kind === 'alone' && rare);

  return (
    <AnimatePresence>
      <motion.div
        role="status"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-40 grid cursor-pointer place-items-center bg-[#0e0a16]/70 px-5"
        onClick={onDone}
        onTouchStart={onDone}
      >
        <motion.div initial={{ scale: 0.7, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
          <Panel tone={s.settings.mode === 'rare' ? 'stone' : 'wood'} className="relative max-w-sm px-3 text-center">
            <div className="relative flex items-center justify-center gap-1 pt-2">
              {/* Avatare „klatschen ab“: fliegen aufeinander zu */}
              <motion.span initial={{ x: kind === 'pair' ? -40 : 0 }} animate={{ x: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.15 }}>
                <Avatar player={me} scale={5} />
              </motion.span>
              {kind === 'pair' &&
                others.slice(0, 3).map((p, i) => (
                  <motion.span key={p.user_id} initial={{ x: 40 + i * 10 }} animate={{ x: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.15 }}>
                    <Avatar player={p} scale={others.length > 1 ? 4 : 5} />
                  </motion.span>
                ))}
              {kind === 'pair' && others.length > 3 && <span className="text-2xl font-bold">+{others.length - 3}</span>}
              {good && <Sparks />}
            </div>
            <p className={`mt-3 text-3xl font-bold leading-tight ${good ? 'text-[#f2b53a]' : ''}`}>{title}</p>
            {mine?.answer && <p className="mt-1 text-lg opacity-85">„{mine.answer}“</p>}
            <p className="mt-2 text-xs opacity-60">{t('friends.tapToSkip')}</p>
          </Panel>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Pixel-Funken rund um die Avatare. */
function Sparks() {
  const colors = ['#f2b53a', '#fff3a0', '#8be9fd', '#f08ae6'];
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 block size-1.5"
            style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: Math.cos(a) * 80, y: Math.sin(a) * 50, opacity: 0 }}
            transition={{ duration: 0.9, delay: 0.3 + (i % 3) * 0.05, ease: 'easeOut' }}
          />
        );
      })}
    </span>
  );
}
