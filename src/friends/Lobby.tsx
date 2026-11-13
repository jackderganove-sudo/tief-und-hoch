import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CUSTOM_PROMPT_MAX, QUESTION_COUNTS, QUESTION_SECONDS, ROOM_MIN_PLAYERS, sanitizeSettings, type RoomSettings } from '../domain/room';
import type { TopicSelection } from '../domain/types';
import { TOPICS } from '../domain/types';
import { Panel, PxButton } from '../components/px';
import { TopicPicker } from '../components/TopicPicker';
import { roomCall, roomLink, RoomError, type RoomState } from './roomApi';
import { Avatar, QrCode } from './ui';

/** Lobby: Code, Teilen, QR, Spielerliste, Einstellungen (nur Gastgeber), Start. */
export function Lobby({ s, isHost, onLeave }: { s: RoomState; isHost: boolean; onLeave: () => void }) {
  const { t } = useTranslation();
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = roomLink(s.code);

  const share = async () => {
    const text = t('friends.shareInvite', { code: s.code });
    try {
      if (navigator.share) await navigator.share({ title: 'Highs & Lows', text, url: link });
      else {
        await navigator.clipboard.writeText(`${text} ${link}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* abgebrochen */
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await roomCall('start', { code: s.code });
    } catch (e) {
      setError(t(`friends.errors.${e instanceof RoomError ? e.code : 'other'}`, { defaultValue: t('friends.errors.other') }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <Panel tone="wood" className="px-1 text-center">
        <p className="font-tiny text-xs uppercase opacity-75">{t('friends.code')}</p>
        <p className="select-all font-mono text-5xl font-bold tracking-[0.25em]" aria-label={[...s.code].join(' ')}>
          {s.code}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <PxButton tone="gold" small className="text-lg" onClick={() => void share()}>
            {copied ? t('friends.copied') : `📤 ${t('friends.share')}`}
          </PxButton>
          <PxButton tone="wood" small className="text-lg" onClick={() => setShowQr((x) => !x)} aria-expanded={showQr}>
            ▦ {t('friends.qr')}
          </PxButton>
        </div>
        {showQr && (
          <div className="mt-3 grid place-items-center">
            <QrCode text={link} size={208} />
            <p className="mt-1 break-all text-xs opacity-70">{link}</p>
          </div>
        )}
      </Panel>

      <Panel tone="wood" className="px-1">
        <h2 className="font-tiny text-xs uppercase opacity-75">{t('friends.players', { count: s.players.length })}</h2>
        <ul className="mt-2 grid gap-2">
          {s.players.map((p) => (
            <li key={p.user_id} className="flex items-center gap-2">
              <Avatar player={p} scale={3} crown={p.user_id === s.host_id} dim={!p.online} />
              <span className="min-w-0 flex-1 truncate text-lg font-bold">
                {p.name}
                {p.user_id === s.me && <span className="ml-1 text-sm font-normal opacity-70">({t('friends.you')})</span>}
              </span>
              {isHost && p.user_id !== s.me && (
                <button
                  type="button"
                  className="px-field px-field-light px-1 text-sm"
                  onClick={() => void roomCall('kick', { code: s.code, user_id: p.user_id }).catch(() => {})}
                  aria-label={t('friends.kick', { name: p.name })}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Settings s={s} editable={isHost} />

      {error && <p className="px-shadow text-center text-lg font-bold text-[#ffb3a0]">{error}</p>}
      {isHost ? (
        <PxButton tone="gold" disabled={busy || s.players.length < ROOM_MIN_PLAYERS} className="w-full text-2xl" onClick={() => void start()}>
          ▶ {s.players.length < ROOM_MIN_PLAYERS ? t('friends.waitForPlayers') : t('friends.start')}
        </PxButton>
      ) : (
        <Panel tone="wood" className="px-1 text-center text-lg">
          {t('friends.waitForHost')}
        </Panel>
      )}
      <button type="button" className="px-shadow text-base text-[#f3e2bb] underline decoration-dotted underline-offset-4" onClick={onLeave}>
        {t('friends.leave')}
      </button>
    </div>
  );
}

function Settings({ s, editable }: { s: RoomState; editable: boolean }) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<RoomSettings>(() => sanitizeSettings({ ...s.settings, custom_prompts: s.custom_prompts ?? [] }));
  const [draft, setDraft] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gäste sehen immer den Stand vom Server
  useEffect(() => {
    if (!editable) setLocal(sanitizeSettings({ ...s.settings, custom_prompts: [] }));
  }, [s.settings, editable]);

  const update = (patch: Partial<RoomSettings>) => {
    const next = sanitizeSettings({ ...local, ...patch });
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void roomCall('settings', { code: s.code, settings: next }).catch(() => {}), 350);
  };

  const v = editable ? local : sanitizeSettings({ ...s.settings, custom_prompts: [] });
  const usesTopics = v.source === 'topics' || v.source === 'mixed';
  const usesCustom = v.source === 'custom' || v.source === 'mixed';
  const topicValue: TopicSelection = v.topics.length === 0 || v.topics.length === TOPICS.length ? 'all' : v.topics;

  const Row = <T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) => (
    <div className="mt-3">
      <p className="font-tiny text-xs uppercase opacity-75">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
        {options.map(([val, text]) => (
          <PxButton
            key={String(val)}
            role="radio"
            aria-checked={value === val}
            disabled={!editable && value !== val}
            tone={value === val ? 'gold' : 'wood'}
            small
            onClick={() => editable && onChange(val)}
            className={`text-base ${value === val ? '' : 'opacity-80'}`}
          >
            {value === val ? '● ' : ''}
            {text}
          </PxButton>
        ))}
      </div>
    </div>
  );

  return (
    <Panel tone="wood" className="px-1">
      <h2 className="font-tiny text-xs uppercase opacity-75">{editable ? t('friends.settings') : t('friends.settingsByHost')}</h2>
      <Row label={t('friends.set.mode')} value={v.mode} onChange={(mode) => update({ mode })} options={[['rare', `▼ ${t('modes.rare.name')}`], ['common', `▲ ${t('modes.common.name')}`]]} />
      {v.source !== 'custom' && (
        <Row
          label={t('friends.set.scoring')}
          value={v.scoring}
          onChange={(scoring) => update({ scoring })}
          options={[['global', t('friends.set.global')], ['group', t('friends.set.group')]]}
        />
      )}
      <p className="mt-1 text-sm leading-snug opacity-80">
        {v.scoring === 'group' ? t(`friends.set.groupHint.${v.mode}`) : t('friends.set.globalHint')}
      </p>
      <Row
        label={t('friends.set.source')}
        value={v.source}
        onChange={(source) => update({ source })}
        options={[['random', t('friends.set.random')], ['topics', t('friends.set.topics')], ['custom', t('friends.set.custom')], ['mixed', t('friends.set.mixed')]]}
      />
      {usesTopics && editable && (
        <div className="mt-2">
          <TopicPicker value={topicValue} tone="light" onChange={(next) => update({ topics: next === 'all' ? [] : next })} />
        </div>
      )}
      {usesTopics && !editable && v.topics.length > 0 && <p className="mt-1 text-sm">{v.topics.map((x) => t(`topics.${x}`)).join(', ')}</p>}
      {usesCustom && editable && (
        <div className="mt-3">
          <p className="font-tiny text-xs uppercase opacity-75">{t('friends.set.ownQuestions', { count: local.custom_prompts.length })}</p>
          <ol className="mt-1 grid gap-1">
            {local.custom_prompts.map((p, i) => (
              <li key={`${i}-${p}`} className="flex items-center gap-1 text-base">
                <span className="min-w-0 flex-1 truncate">
                  {i + 1}. {p}
                </span>
                <button type="button" className="px-1 text-sm" aria-label={t('friends.set.remove')} onClick={() => update({ custom_prompts: local.custom_prompts.filter((_, k) => k !== i) })}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <form
            className="mt-1 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim().length >= 3) {
                update({ custom_prompts: [...local.custom_prompts, draft.trim()] });
                setDraft('');
              }
            }}
          >
            <span className="px-field px-field-light min-w-0 flex-1">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={CUSTOM_PROMPT_MAX} className="w-full bg-transparent px-1 text-base" placeholder={t('friends.set.ownPlaceholder')} />
            </span>
            <PxButton tone="wood" small type="submit" className="text-base" disabled={draft.trim().length < 3}>
              +
            </PxButton>
          </form>
          <p className="mt-1 text-xs opacity-70">{t('friends.set.ownHint')}</p>
        </div>
      )}
      {usesCustom && !editable && <p className="mt-1 text-sm opacity-80">{t('friends.set.ownSecret')}</p>}
      <div className="mt-3">
        <p className="font-tiny text-xs uppercase opacity-75">{t('friends.set.count', { count: v.count })}</p>
        <input
          type="range"
          min={QUESTION_COUNTS.min}
          max={QUESTION_COUNTS.max}
          value={v.count}
          disabled={!editable}
          onChange={(e) => update({ count: Number(e.target.value) })}
          className="mt-1 w-full accent-[#a8661c]"
          aria-label={t('friends.set.count', { count: v.count })}
        />
      </div>
      <Row label={t('friends.set.time')} value={v.seconds} onChange={(seconds) => update({ seconds })} options={QUESTION_SECONDS.map((x) => [x, `${x} s`] as [typeof x, string])} />
      <Row label={t('friends.set.lang')} value={v.lang} onChange={(lang) => update({ lang })} options={[['de', 'Deutsch'], ['en', 'English']]} />
      <Row
        label={t('friends.set.showAttempts')}
        value={v.show_attempts === true ? 'on' : 'off'}
        onChange={(x) => update({ show_attempts: x === 'on' })}
        options={[['off', t('friends.set.off')], ['on', t('friends.set.on')]]}
      />
      <p className="mt-1 text-sm leading-snug opacity-80">{t('friends.set.showAttemptsHint')}</p>
    </Panel>
  );
}
