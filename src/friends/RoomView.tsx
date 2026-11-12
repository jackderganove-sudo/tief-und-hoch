import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { pointsToMeters } from '../domain/scoring';
import { PixelWorld, type CrewInput } from '../pixel/PixelWorld';
import { playerColor } from '../pixel/playerColors';
import { Panel, PxButton } from '../components/px';
import { modeTheme } from '../components/PlayShell';
import { isPreview, roomCall, type RoomState } from './roomApi';
import { useRoom } from './useRoom';
import { Lobby } from './Lobby';
import { QuestionPhase } from './QuestionPhase';
import { MatchMoment } from './MatchMoment';
import { RevealPhase } from './RevealPhase';
import { FinalPhase } from './FinalPhase';

/** Ein Raum: gemeinsame Szene im Hintergrund, darüber die jeweilige Phase. */
export function RoomView({ code, onLeft, onNeedJoin, onExit }: { code: string; onLeft: () => void; onNeedJoin: () => void; onExit: () => void }) {
  const { t } = useTranslation();
  const { state, connected, sync } = useRoom(code);

  useEffect(() => {
    if (isPreview(state) && (state.error === 'not_member' || state.error === 'kicked' || state.error === 'not_found')) onNeedJoin();
  }, [state, onNeedJoin]);

  const leave = async () => {
    await roomCall('leave', { code }).catch(() => {});
    onLeft();
  };

  if (!state || isPreview(state)) {
    return (
      <div className="grid h-dvh place-items-center bg-[#17121f] text-[#f3e2bb]">
        <p className="animate-pulse text-xl">{t('friends.connecting')}</p>
      </div>
    );
  }
  return <Room s={state} connected={connected} localTime={(iso) => sync.localTime(iso)} onLeave={() => void leave()} onExit={onExit} />;
}

function Room({ s, connected, localTime, onLeave, onExit }: { s: RoomState; connected: boolean; localTime: (iso: string | null) => number | null; onLeave: () => void; onExit: () => void }) {
  const { t } = useTranslation();
  const mode = s.settings.mode;
  const theme = modeTheme(mode);
  const me = s.players.find((p) => p.user_id === s.me);
  const isHost = s.host_id === s.me;

  // Match-Moment: einmal pro Auflösung, erst nach Ende der Frage (Auflösung existiert erst dann)
  const [matchSeen, setMatchSeen] = useState<string | null>(null);
  const revealKey = s.reveal ? `${s.round}:${s.reveal.idx}` : null;
  const showMatch = s.status === 'reveal' && !!s.reveal && revealKey !== matchSeen && !!me && s.reveal.players[s.me] !== undefined;

  // Szene: alle Spieler, Höhe/Tiefe nach Punkten (bis zur letzten Auflösung)
  const crew = useMemo<CrewInput[]>(() => {
    const many = s.players.length > 10;
    const top = new Set([...s.players].sort((a, b) => b.points - a.points).slice(0, 3).map((p) => p.user_id));
    return s.players.map((p) => {
      const last = s.status === 'reveal' && !showMatch ? s.reveal?.players[p.user_id] : undefined;
      return {
        id: p.user_id,
        name: p.user_id === s.me ? t('friends.you') : p.name,
        color: playerColor(p.color),
        meters: pointsToMeters(p.points - (showMatch ? (s.reveal?.players[p.user_id]?.points ?? 0) : 0)),
        me: p.user_id === s.me,
        mood: last ? (last.points >= 100 ? 'cheer' : last.points === 0 ? 'flinch' : 'idle') : 'idle',
        label: !many || p.user_id === s.me || top.has(p.user_id),
      };
    });
  }, [s, showMatch, t]);

  // eigene Figur zeigt erst nach dem Match-Moment die neuen Meter
  const pending = showMatch ? (s.reveal?.players[s.me]?.points ?? 0) : 0;
  const myMeters = pointsToMeters((me?.points ?? 0) - pending);
  const view = s.status === 'lobby' ? 'home' : mode;

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PixelWorld view={view} meters={myMeters} crew={view === 'home' ? undefined : crew} />

      <div className="relative z-20 mx-auto flex h-full max-w-xl flex-col overflow-y-auto px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <header className="flex items-stretch gap-2">
          <PxButton tone={theme.secondary} small onClick={s.status === 'lobby' || s.status === 'finished' ? onLeave : onExit} aria-label={t('friends.leave')} className="shrink-0 text-base">
            ←
          </PxButton>
          <Panel tone={theme.panel} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1 leading-none">
            <span className="truncate font-bold">
              👥 {s.status === 'lobby' ? t('friends.lobby') : s.index >= 0 ? t('friends.questionOf', { n: s.index + 1, total: s.count }) : t('friends.getReady')}
            </span>
            <span className="flex shrink-0 items-center gap-1 font-mono text-sm tracking-widest opacity-80">
              {!connected && <span title={t('friends.reconnecting')} className="inline-block size-2 animate-pulse bg-[#e2603a]" />}
              {s.code}
            </span>
          </Panel>
          {s.status !== 'lobby' && (
            <Panel tone={theme.panel} className="flex shrink-0 items-center px-1 font-bold leading-none tabular-nums">
              {(me?.points ?? 0) - pending}
            </Panel>
          )}
        </header>

        <div className="mt-3">
          {s.status === 'lobby' && <Lobby s={s} isHost={isHost} onLeave={onLeave} />}
          {s.status === 'countdown' && <Countdown endsAt={localTime(s.ends_at)} />}
          {(s.status === 'question' || s.status === 'scoring') && <QuestionPhase s={s} endsAt={localTime(s.question?.ends_at ?? s.ends_at)} />}
          {s.status === 'reveal' && s.reveal && !showMatch && <RevealPhase s={s} isHost={isHost} endsAt={localTime(s.ends_at)} />}
          {s.status === 'finished' && <FinalPhase s={s} isHost={isHost} onLeave={onLeave} />}
        </div>
      </div>

      {showMatch && s.reveal && <MatchMoment s={s} onDone={() => setMatchSeen(revealKey)} />}
    </div>
  );
}

function Countdown({ endsAt }: { endsAt: number | null }) {
  const { t } = useTranslation();
  const [n, setN] = useState(3);
  const raf = useRef(0);
  useEffect(() => {
    const tick = () => {
      setN(Math.max(1, Math.ceil(((endsAt ?? Date.now()) - Date.now()) / 1000)));
      raf.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf.current);
  }, [endsAt]);
  return (
    <div className="grid place-items-center pt-[18vh]">
      <Panel tone="wood" className="px-6 text-center">
        <p className="text-xl">{t('friends.getReady')}</p>
        <motion.p key={n} initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-8xl font-bold leading-none tabular-nums">
          {n}
        </motion.p>
      </Panel>
    </div>
  );
}
