import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { standings } from '../domain/roomScoring';
import { CUSTOM_PROMPT_MAX } from '../domain/room';
import { Panel, PxButton, TierIcon } from '../components/px';
import { modeTheme } from '../components/PlayShell';
import { playerColor } from '../pixel/playerColors';
import { roomCall, type RoomPlayer, type RoomState } from './roomApi';
import { Avatar } from './ui';

/** Auflösung: Antworten nach Gruppen, wer was gesagt hat, Punkte, Zwischenstand. */
export function RevealPhase({ s, isHost, endsAt }: { s: RoomState; isHost: boolean; endsAt: number | null }) {
  const { t } = useTranslation();
  const theme = modeTheme(s.settings.mode);
  const r = s.reveal!;
  const byId = new Map(s.players.map((p) => [p.user_id, p]));
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState('');
  const left = useSecondsLeft(endsAt);
  const maxCount = Math.max(1, ...r.groups.map((g) => g.count));
  const last = s.index + 1 >= s.count;

  // eigene abgelehnte Versuche, ohne die Antwort, die ohnehin oben steht
  const myFinal = r.players[s.me]?.answer;
  const mine = (s.my_attempts ?? []).filter((a) => a !== myFinal);

  const ranking = standings(Object.fromEntries(s.players.map((p) => [p.user_id, p.points])));

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-3">
      <Panel tone={theme.panel} className="px-1">
        <p className="font-tiny text-xs uppercase opacity-75">{s.question?.custom ? t('friends.hostQuestion') : t(`friends.scoringName.${r.scoring}`)}</p>
        <h2 className="text-xl font-bold leading-tight">{s.question?.prompt}</h2>
        {r.list && (r.list.top || r.list.rarest) && (
          <p className="mt-1 text-sm opacity-80">
            {r.list.top && t('game.topAnswer', { answer: r.list.top })} {r.list.rarest && `· ${t('game.rareAnswer', { answer: r.list.rarest })}`}
          </p>
        )}

        <ul className="mt-3 grid gap-2">
          {r.groups.filter((g) => g.valid).map((g) => {
            const mine = g.players.includes(s.me);
            const players = g.players.map((u) => byId.get(u)).filter((p): p is RoomPlayer => !!p);
            const solo = g.count === 1 && g.valid;
            const tag = solo
              ? mine
                ? t('friends.onlyYou')
                : t('friends.onlyName', { name: players[0]?.name ?? '?' })
              : mine
                ? t('friends.youPlus', { count: g.count - 1 })
                : null;
            return (
              <li
                key={g.key}
                className={`px-field ${s.settings.mode === 'rare' ? 'px-field-dark' : 'px-field-light'} px-1 py-1 ${g.valid ? '' : 'opacity-70'}`}
                style={mine ? { boxShadow: 'inset 0 0 0 3px #f2b53a', background: s.settings.mode === 'rare' ? '#3a2e1a' : '#fff1c9' } : undefined}
              >
                <div className="flex items-center gap-2">
                  {g.valid ? <TierIcon tier={g.tier} scale={2} /> : <span className="w-8 text-center text-xl">✗</span>}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-lg font-bold leading-tight ${g.valid ? '' : 'line-through'}`}>{g.text}</span>
                    {tag && <span className="block text-sm font-bold text-[#f2b53a]">{tag}</span>}
                    {g.special === 'majority' && <span className="block text-sm font-bold text-[#7ec850]">{t('friends.majority')}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xl font-bold tabular-nums">{g.valid ? `+${g.points}` : '0'}</span>
                    <span className="block text-xs opacity-70">{t('friends.times', { count: g.count })}</span>
                  </span>
                </div>
                {/* Pixel-Balken: wie viele haben das gesagt */}
                <div className="mt-1 flex h-2 gap-[2px]" aria-hidden>
                  {Array.from({ length: g.count }, (_, i) => (
                    <span key={i} className="h-full" style={{ width: `${100 / maxCount}%`, background: playerColor(players[i]?.color ?? 0) }} />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {players.map((p) => {
                    const key = `${g.key}|${p.user_id}`;
                    const raw = r.players[p.user_id]?.answer;
                    return (
                      <button key={p.user_id} type="button" onClick={() => setOpen(open === key ? null : key)} className="flex items-center gap-1 bg-black/15 py-0.5 pl-0.5 pr-1 text-sm" title={raw ?? ''}>
                        <Avatar player={p} scale={2} />
                        <span className="max-w-[7rem] truncate">{p.user_id === s.me ? t('friends.you') : p.name}</span>
                        {open === key && raw && <span className="italic opacity-80">„{raw}“</span>}
                        {(r.players[p.user_id]?.attempts ?? 1) > 1 && <span className="text-xs opacity-65">{t('friends.triesShort', { count: r.players[p.user_id]?.attempts })}</span>}
                      </button>
                    );
                  })}
                </div>
                {isHost && (r.scoring === 'group' || !g.valid) && (
                  <button
                    type="button"
                    className="mt-1 text-sm underline decoration-dotted underline-offset-4 opacity-80"
                    onClick={() => void roomCall('override', { code: s.code, user_ids: g.players, valid: !g.valid }).catch(() => {})}
                  >
                    {g.valid ? t('friends.markInvalid') : t('friends.markValid')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {r.groups.some((g) => !g.valid) && (
          <div className="mt-3">
            <p className="font-tiny text-xs uppercase opacity-75">✗ {t('friends.invalidAnswers')}</p>
            <ul className="mt-1 grid gap-1">
              {r.groups
                .filter((g) => !g.valid)
                .map((g) => (
                  <li key={g.key} className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="line-through opacity-80">{g.text}</span>
                    <span className="opacity-70">
                      {g.players.map((u) => (u === s.me ? t('friends.you') : byId.get(u)?.name ?? '?')).join(', ')}
                    </span>
                    {isHost && (
                      <button type="button" className="underline decoration-dotted underline-offset-4 opacity-80" onClick={() => void roomCall('override', { code: s.code, user_ids: g.players, valid: true }).catch(() => {})}>
                        {t('friends.markValid')}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}
        {r.missed.length > 0 && (
          <p className="mt-2 text-sm opacity-75">
            {t('friends.missed')}: {r.missed.map((u) => (u === s.me ? t('friends.you') : byId.get(u)?.name ?? '?')).join(', ')}
          </p>
        )}
        {r.unchecked.length > 0 && <p className="mt-1 text-sm opacity-75">{t('friends.unchecked', { count: r.unchecked.length })}</p>}
        {/* eigene Fehlversuche – sieht nur man selbst */}
        {mine.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-x-2 text-sm leading-snug opacity-75" data-rejected>
            <span>{t('game.yourAttempts')}:</span>
            {mine.map((a) => (
              <s key={a}>{a}</s>
            ))}
          </p>
        )}
        {/* Fehlversuche aller – nur wenn der Raum es in den Einstellungen erlaubt */}
        {r.funny && r.funny.length > 0 && (
          <details className="mt-2 text-sm" data-funny>
            <summary className="cursor-pointer underline decoration-dotted underline-offset-4">😄 {t('friends.funnyAttempts', { count: r.funny.length })}</summary>
            <ul className="mt-1 grid gap-0.5">
              {r.funny.map((f, i) => (
                <li key={i}>
                  <s>{f.text}</s> <span className="opacity-70">– {f.user_id === s.me ? t('friends.you') : byId.get(f.user_id)?.name ?? '?'}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>

      <Panel tone={theme.panel} className="px-1">
        <p className="font-tiny text-xs uppercase opacity-75">{t('friends.standings')}</p>
        <ol className="mt-1 grid gap-1">
          {ranking.map(({ userId, points, place }) => {
            const p = byId.get(userId)!;
            const gained = r.players[userId]?.points ?? 0;
            return (
              <li key={userId} className={`flex items-center gap-2 ${userId === s.me ? 'font-bold' : ''}`}>
                <span className="w-6 text-right tabular-nums">{place}.</span>
                <Avatar player={p} scale={2} crown={userId === s.host_id} />
                <span className="min-w-0 flex-1 truncate">{userId === s.me ? t('friends.you') : p.name}</span>
                {gained > 0 && <span className="text-sm text-[#7ec850] tabular-nums">+{gained}</span>}
                <span className="w-12 text-right tabular-nums">{points}</span>
              </li>
            );
          })}
        </ol>
      </Panel>

      {isHost ? (
        <div className="grid gap-2">
          <PxButton tone="gold" className="w-full text-2xl" onClick={() => void roomCall('next', { code: s.code }).catch(() => {})}>
            {last ? t('friends.toResult') : t('friends.next')} {left !== null && <span className="text-base opacity-75">({left})</span>}
          </PxButton>
          {asking ? (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (prompt.trim().length >= 3) void roomCall('next', { code: s.code, custom_prompt: prompt.trim() }).catch(() => {});
              }}
            >
              <span className="px-field px-field-light min-w-0 flex-1">
                <input autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={CUSTOM_PROMPT_MAX} className="w-full bg-transparent px-1 text-base" placeholder={t('friends.set.ownPlaceholder')} />
              </span>
              <PxButton tone="wood" small type="submit" className="text-base" disabled={prompt.trim().length < 3}>
                {t('friends.ask')}
              </PxButton>
            </form>
          ) : (
            <button type="button" className="px-shadow text-base text-[#f3e2bb] underline decoration-dotted underline-offset-4" onClick={() => setAsking(true)}>
              ✍ {t('friends.askOwn')}
            </button>
          )}
        </div>
      ) : (
        <p className="px-shadow text-center text-base text-[#f3e2bb]">{left !== null ? t('friends.nextIn', { n: left }) : ''}</p>
      )}
    </motion.div>
  );
}

function useSecondsLeft(endsAt: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) return setLeft(null);
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}
