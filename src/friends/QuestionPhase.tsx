import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { isDuplicate, rememberRejected } from '../domain/attempts';
import { TOPIC_EMOJI, type TopicId } from '../domain/types';
import { Panel } from '../components/px';
import { TimerBar } from '../components/TimerBar';
import { modeTheme } from '../components/PlayShell';
import { AttemptInput, type AttemptFeedback } from '../components/AttemptInput';
import { roomCall, RoomError, type AttemptReply, type RoomState } from './roomApi';
import { Avatar } from './ui';

/**
 * Fragephase: alle beantworten dieselbe Frage; man sieht nur, WER schon eine gültige Antwort
 * hat und wer noch rät (Anzahl der Versuche, nie der Inhalt).
 *
 * Falsche Antworten beenden die Frage nicht: Der Server prüft jeden Versuch einzeln, die erste
 * gültige Antwort zählt. Die Zeit läuft für alle gleich (Serveruhr) – nach Ablauf geht nichts mehr.
 */
export function QuestionPhase({ s, endsAt }: { s: RoomState; endsAt: number | null }) {
  const { t } = useTranslation();
  const theme = modeTheme(s.settings.mode);
  const q = s.question;
  const me = s.players.find((p) => p.user_id === s.me);
  const late = !!me && me.from_index > s.index;
  const [sent, setSent] = useState<string | null>(s.my_answer);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<AttemptFeedback | null>(null);
  const [tried, setTried] = useState<string[]>(s.my_attempts ?? []);
  const [aiLeft, setAiLeft] = useState<number | null>(s.my_ai_left ?? null);
  const [tooMany, setTooMany] = useState(false);
  const typed = useRef('');
  const fid = useRef(0);
  const busy = useRef(false);

  // neue Frage → alles zurücksetzen; nach Reload Abgabe und Versuche vom Server übernehmen
  useEffect(() => {
    setSent(s.my_answer);
    setError(null);
    setChecking(false);
    setFeedback(null);
    setTried(s.my_attempts ?? []);
    setAiLeft(s.my_ai_left ?? null);
    setTooMany(false);
    busy.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.index, s.round]);
  useEffect(() => {
    if (s.my_answer !== null) setSent(s.my_answer);
  }, [s.my_answer]);
  useEffect(() => {
    // Versuche von einem anderen Gerät/nach Reload dazunehmen
    const mine = s.my_attempts;
    if (mine?.length) setTried((cur) => mine.reduce((acc, a) => rememberRejected(acc, a), cur));
  }, [s.my_attempts]);

  const reject = (kind: AttemptFeedback['kind'], input: string, hint: string | null = null) => setFeedback({ id: ++fid.current, kind, input, hint });

  const send = async (text: string) => {
    if (sent !== null || busy.current || !text) return;
    setError(null);
    // doppelte Eingabe: sofort, ohne den Server zu fragen
    if (isDuplicate(tried, text)) return reject('duplicate', text);
    busy.current = true;
    // Lade-Anzeige erst, wenn die Prüfung spürbar dauert (Listen-Treffer sind sofort da)
    const loader = window.setTimeout(() => setChecking(true), 250);
    try {
      const r = await roomCall<AttemptReply>('answer', { code: s.code, idx: s.index, answer: text });
      setAiLeft(r.ai_left);
      if (r.accepted) return setSent(text);
      if (r.reason !== 'unchecked' && r.reason !== 'too_many') setTried((cur) => rememberRejected(cur, text));
      if (r.reason === 'too_many') setTooMany(true);
      reject(r.reason === 'duplicate' ? 'duplicate' : r.reason === 'unchecked' ? 'unchecked' : r.reason === 'list_only' ? 'listOnly' : r.reason === 'limited' ? 'limited' : 'invalid', text, r.hint ?? null);
    } catch (e) {
      const code = e instanceof RoomError ? e.code : 'other';
      if (code === 'already_answered' || code === 'busy') return;
      setError(t(`friends.errors.${code}`, { defaultValue: t('friends.errors.other') }));
    } finally {
      window.clearTimeout(loader);
      busy.current = false;
      setChecking(false);
    }
  };

  const answered = s.players.filter((p) => p.answered).length;
  const playing = s.players.filter((p) => p.from_index <= s.index).length;
  if (!q) return null;

  const note = tooMany
    ? t('friends.tooManyAttempts')
    : aiLeft === 0 && tried.length > 0
      ? t(q.custom ? 'friends.noAiLeftCustom' : 'game.listOnly')
      : null;

  return (
    <motion.div key={`${s.round}-${s.index}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-[minmax(0,1fr)] gap-3" data-world-quiet>
      <Panel tone={theme.panel} className="px-1">
        {endsAt && s.status === 'question' && (
          <TimerBar deadline={endsAt} mode={s.settings.mode} totalMs={s.settings.seconds * 1000} paused={false} onExpire={() => !sent && !late && void send(typed.current.trim())} />
        )}
        <p className="mt-3 font-tiny text-xs uppercase opacity-75">
          {q.custom ? `✍ ${t('friends.hostQuestion')}` : q.topic ? `${TOPIC_EMOJI[q.topic as TopicId] ?? ''} ${t(`topics.${q.topic}`)}` : ''}
        </p>
        <h1 className="mt-1 text-[1.6rem] font-bold leading-[1.1] sm:text-3xl">{q.prompt}</h1>

        {late ? (
          <p className="mt-4 text-lg">{t('friends.lateJoin')}</p>
        ) : sent === null && s.status === 'question' ? (
          <AttemptInput mode={s.settings.mode} checking={checking} feedback={feedback} tried={tried} note={note} valueRef={typed} onSubmit={(text) => void send(text)} />
        ) : (
          <>
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
            {tried.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-2 text-sm leading-tight opacity-70" data-tried>
                {tried.map((a) => (
                  <s key={a}>{a}</s>
                ))}
              </p>
            )}
          </>
        )}
        {error && <p className="mt-2 text-base font-bold text-[#e2603a]">{error}</p>}
      </Panel>

      <Panel tone={theme.panel} className="px-1">
        <p className="font-tiny text-xs uppercase opacity-75">
          {s.status === 'scoring' ? t('friends.scoring') : t('friends.answeredCount', { n: answered, total: playing })}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {s.players.map((p) => {
            const trying = !p.answered && (p.attempts ?? 0) > 0 && p.from_index <= s.index;
            return (
              <li key={p.user_id} className="flex w-14 flex-col items-center gap-0.5" title={p.name}>
                <Avatar player={p} scale={3} check={p.answered} dim={!p.online || p.from_index > s.index} crown={p.user_id === s.host_id} />
                <span className="w-full truncate text-center text-xs">{p.user_id === s.me ? t('friends.you') : p.name}</span>
                {/* „versucht es noch“: nur wie oft, nie was */}
                {trying && (
                  <span className="text-[0.65rem] leading-none opacity-75" title={t('friends.stillTrying', { count: p.attempts })} aria-label={t('friends.stillTrying', { count: p.attempts })}>
                    ✎ {p.attempts}×
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </motion.div>
  );
}
