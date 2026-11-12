import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { TOPIC_EMOJI, type TopicId } from '../domain/types';
import { Panel, PxButton } from '../components/px';
import { TimerBar } from '../components/TimerBar';
import { modeTheme } from '../components/PlayShell';
import { roomCall, RoomError, type RoomState } from './roomApi';
import { Avatar } from './ui';

/** Fragephase: alle beantworten dieselbe Frage; man sieht nur, WER schon geantwortet hat. */
export function QuestionPhase({ s, endsAt }: { s: RoomState; endsAt: number | null }) {
  const { t } = useTranslation();
  const theme = modeTheme(s.settings.mode);
  const q = s.question;
  const me = s.players.find((p) => p.user_id === s.me);
  const late = !!me && me.from_index > s.index;
  const [input, setInput] = useState('');
  const [sent, setSent] = useState<string | null>(s.my_answer);
  const [error, setError] = useState<string | null>(null);

  // neue Frage → Eingabe leeren; nach Reload die eigene Abgabe vom Server übernehmen
  useEffect(() => {
    setInput('');
    setSent(s.my_answer);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.index, s.round]);
  useEffect(() => {
    if (s.my_answer !== null) setSent(s.my_answer);
  }, [s.my_answer]);

  const send = async (text: string) => {
    if (sent !== null) return;
    setSent(text);
    try {
      await roomCall('answer', { code: s.code, idx: s.index, answer: text });
    } catch (e) {
      const code = e instanceof RoomError ? e.code : 'other';
      if (code === 'already_answered') return;
      if (code !== 'too_late') setSent(null); // z. B. kurz offline → nochmal versuchen
      setError(t(`friends.errors.${code}`, { defaultValue: t('friends.errors.other') }));
    }
  };

  const answered = s.players.filter((p) => p.answered).length;
  const playing = s.players.filter((p) => p.from_index <= s.index).length;
  if (!q) return null;

  return (
    <motion.div key={`${s.round}-${s.index}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-3">
      <Panel tone={theme.panel} className="px-1">
        {endsAt && s.status === 'question' && (
          <TimerBar deadline={endsAt} mode={s.settings.mode} totalMs={s.settings.seconds * 1000} paused={false} onExpire={() => !sent && !late && void send(input.trim())} />
        )}
        <p className="mt-3 font-tiny text-xs uppercase opacity-75">
          {q.custom ? `✍ ${t('friends.hostQuestion')}` : q.topic ? `${TOPIC_EMOJI[q.topic as TopicId] ?? ''} ${t(`topics.${q.topic}`)}` : ''}
        </p>
        <h1 className="mt-1 text-[1.6rem] font-bold leading-[1.1] sm:text-3xl">{q.prompt}</h1>

        {late ? (
          <p className="mt-4 text-lg">{t('friends.lateJoin')}</p>
        ) : sent === null && s.status === 'question' ? (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) void send(input.trim());
            }}
          >
            <span className={`${theme.field} min-w-0 flex-1`}>
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={60}
                enterKeyHint="send"
                autoComplete="off"
                autoCapitalize="sentences"
                className="w-full bg-transparent px-1 text-xl"
                placeholder={t('game.placeholder')}
              />
            </span>
            <PxButton tone={theme.primary} type="submit" disabled={!input.trim()} className="text-xl">
              {t('game.submit')}
            </PxButton>
          </form>
        ) : (
          <p className="mt-4 text-lg">
            {sent ? (
              <>
                ✓ {t('friends.sent')} <b>„{sent}“</b>
              </>
            ) : s.status === 'scoring' ? (
              t('friends.scoring')
            ) : (
              t('friends.noAnswer')
            )}
          </p>
        )}
        {error && <p className="mt-2 text-base font-bold text-[#e2603a]">{error}</p>}
      </Panel>

      <Panel tone={theme.panel} className="px-1">
        <p className="font-tiny text-xs uppercase opacity-75">
          {s.status === 'scoring' ? t('friends.scoring') : t('friends.answeredCount', { n: answered, total: playing })}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {s.players.map((p) => (
            <li key={p.user_id} className="flex w-14 flex-col items-center gap-0.5" title={p.name}>
              <Avatar player={p} scale={3} check={p.answered} dim={!p.online || p.from_index > s.index} crown={p.user_id === s.host_id} />
              <span className="w-full truncate text-center text-xs">{p.user_id === s.me ? t('friends.you') : p.name}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </motion.div>
  );
}
