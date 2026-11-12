import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cleanRoomCode, isRoomCode, ROOM_CODE_LENGTH } from '../domain/room';
import { currentLang } from '../i18n';
import { PixelWorld } from '../pixel/PixelWorld';
import { AVATAR_COUNT, avatarSprite } from '../pixel/avatars';
import { Panel, PixelSprite, PxButton } from '../components/px';
import { useAccount } from '../services/accountState';
import { fetchRoom, isPreview, roomCall, RoomError, savedRoomProfile, saveRoomProfile, type RoomPreview } from './roomApi';
import { RoomView } from './RoomView';
import { setUrlCode } from './roomUrl';

/** Freunde-Modus: Raum erstellen oder beitreten, dann der Raum selbst. */
export function FriendsScreen({ initialCode, onExit }: { initialCode?: string | null; onExit: () => void }) {
  const [code, setCode] = useState<string | null>(initialCode ?? null);
  const [joined, setJoined] = useState(false);

  useEffect(() => setUrlCode(code), [code]);
  const exit = () => {
    setUrlCode(null);
    onExit();
  };

  if (code && joined) {
    return (
      <RoomView
        code={code}
        onLeft={() => {
          setJoined(false);
          setCode(null);
        }}
        onNeedJoin={() => setJoined(false)}
        onExit={exit}
      />
    );
  }
  return (
    <Entry
      code={code}
      onCode={setCode}
      onJoined={(c) => {
        setCode(c);
        setJoined(true);
      }}
      onExit={exit}
    />
  );
}

function Entry({ code, onCode, onJoined, onExit }: { code: string | null; onCode: (c: string | null) => void; onJoined: (code: string) => void; onExit: () => void }) {
  const { t } = useTranslation();
  const { profile } = useAccount();
  const saved = savedRoomProfile();
  const [name, setName] = useState(saved?.name ?? profile?.display_name ?? '');
  const [avatar, setAvatar] = useState(saved?.avatar ?? profile?.avatar ?? 0);
  const [joinCode, setJoinCode] = useState(code ?? '');
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name && profile?.display_name) setName(profile.display_name);
  }, [profile, name]);

  // Über Link/QR gekommen: Raum anzeigen; wer schon drin ist, landet direkt im Raum
  useEffect(() => {
    if (!code) return setPreview(null);
    let cancelled = false;
    void fetchRoom(code)
      .then((s) => {
        if (cancelled) return;
        if (!isPreview(s)) onJoined(code);
        else setPreview(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, onJoined]);

  const nameOk = name.trim().length >= 3;
  const run = async (action: 'create' | 'join') => {
    setBusy(true);
    setError(null);
    try {
      const c = cleanRoomCode(joinCode);
      const r = await roomCall<{ code: string }>(action, { name: name.trim(), avatar, code: c, lang: currentLang() });
      saveRoomProfile({ name: name.trim(), avatar });
      onJoined(r.code);
    } catch (e) {
      setError(t(`friends.errors.${e instanceof RoomError ? e.code : 'other'}`, { defaultValue: t('friends.errors.other') }));
    } finally {
      setBusy(false);
    }
  };

  const canJoin = isRoomCode(cleanRoomCode(joinCode));

  return (
    <div className="relative min-h-dvh w-full">
      <div className="fixed inset-0">
        <PixelWorld view="home" />
      </div>
      <div className="relative z-10 mx-auto max-w-md px-3 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <PxButton tone="wood" small onClick={onExit} className="text-base">
          ← {t('game.back')}
        </PxButton>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
          <Panel tone="wood" className="px-1">
            <h1 className="text-4xl font-bold leading-none">👥 {t('friends.title')}</h1>
            <p className="mt-2 text-base leading-snug">{t('friends.intro')}</p>

            {preview && preview.error !== 'not_found' && (
              <p className="mt-3 border-2 border-[#3a2416] bg-[#f6e2b3] p-1 text-base leading-snug">
                {preview.error === 'kicked'
                  ? t('friends.kicked')
                  : t('friends.invite', { host: preview.host ?? '?', code: preview.code, count: preview.players ?? 0 })}
              </p>
            )}
            {preview?.error === 'not_found' && <p className="mt-3 text-base text-[#a8372a]">{t('friends.errors.not_found')}</p>}

            <label className="mt-4 block">
              <span className="font-tiny text-xs uppercase opacity-75">{t('friends.yourName')}</span>
              <span className="px-field px-field-light mt-1 block">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={20}
                  autoComplete="nickname"
                  className="w-full bg-transparent px-1 text-xl"
                  placeholder={t('friends.namePlaceholder')}
                />
              </span>
            </label>
            <p className="mt-1 text-xs opacity-70">{t('friends.nameRules')}</p>

            <p className="mt-3 font-tiny text-xs uppercase opacity-75">{t('account.avatar')}</p>
            <div className="mt-1 grid grid-cols-6 gap-1">
              {Array.from({ length: AVATAR_COUNT }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={avatar === i}
                  aria-label={`Avatar ${i + 1}`}
                  onClick={() => setAvatar(i)}
                  className={`px-field ${avatar === i ? 'px-field-light bg-[#f2b53a]/50' : 'px-field-light'} grid place-items-center py-1`}
                >
                  <PixelSprite id={`av-${i}`} make={() => avatarSprite(i)} w={12} h={12} scale={3} />
                </button>
              ))}
            </div>

            {error && <p className="mt-3 text-base font-bold text-[#a8372a]">{error}</p>}

            {!code && (
              <PxButton tone="gold" disabled={!nameOk || busy} className="mt-4 w-full text-2xl" onClick={() => void run('create')}>
                {t('friends.create')}
              </PxButton>
            )}

            <div className="mt-4 flex items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="font-tiny text-xs uppercase opacity-75">{t('friends.code')}</span>
                <span className="px-field px-field-light mt-1 block">
                  <input
                    value={joinCode}
                    onChange={(e) => {
                      const c = cleanRoomCode(e.target.value);
                      setJoinCode(c);
                      if (isRoomCode(c)) onCode(c);
                    }}
                    maxLength={ROOM_CODE_LENGTH + 2}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                    className="w-full bg-transparent px-1 font-mono text-2xl tracking-[0.3em] uppercase"
                    placeholder="ABC234"
                  />
                </span>
              </label>
              <PxButton tone={code ? 'gold' : 'teal'} disabled={!nameOk || !canJoin || busy || preview?.error === 'not_found'} className="text-xl" onClick={() => void run('join')}>
                {t('friends.join')}
              </PxButton>
            </div>
          </Panel>
        </motion.div>
      </div>
    </div>
  );
}
