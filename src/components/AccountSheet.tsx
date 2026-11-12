import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MODES } from '../domain/types';
import { services } from '../services';
import { expectLogin, getAccountState, refreshProfile, useAccount } from '../services/accountState';
import { deleteAccount, EmailLoginError, saveProfile, sendEmailCode, signInWith, signOut, verifyEmailCode, type EmailStep, type Provider } from '../services/supabase/account';
import { AVATAR_COUNT, avatarSprite } from '../pixel/avatars';
import { PixelSprite, PxButton } from './px';
import { Sheet } from './Sheet';
import { PrivacySheet } from './PrivacySheet';

/** Anmelde-Auswahl: Google, Discord, E-Mail – GitHub kleiner unter „Weitere Optionen“. */
export function SignInButtons({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState(false);
  const [more, setMore] = useState(false);
  const go = (p: Provider) => {
    setBusy(p);
    setErr(null);
    signInWith(p).catch((e) => {
      setErr(String(e?.message ?? e));
      setBusy(null);
    });
  };
  if (email) return <EmailLogin onBack={() => setEmail(false)} />;
  return (
    <div className={`grid gap-2 ${compact ? (EMAIL_LOGIN_ENABLED ? 'grid-cols-3' : 'grid-cols-2') : ''}`}>
      <PxButton tone="gold" small={compact} disabled={!!busy} className="w-full text-base" onClick={() => go('google')}>
        {compact ? 'Google' : t('account.google')}
      </PxButton>
      <PxButton tone="violet" small={compact} disabled={!!busy} className="w-full text-base" onClick={() => go('discord')}>
        {compact ? 'Discord' : t('account.discord')}
      </PxButton>
      {EMAIL_LOGIN_ENABLED && (
        <PxButton tone="wood" small={compact} disabled={!!busy} className="w-full text-base" onClick={() => setEmail(true)}>
          {compact ? t('account.emailShort') : t('account.email')}
        </PxButton>
      )}
      {!compact &&
        (more ? (
          <PxButton tone="stone" small disabled={!!busy} className="w-full text-base" onClick={() => go('github')}>
            {t('account.github')}
          </PxButton>
        ) : (
          <button type="button" className="justify-self-center text-sm underline decoration-dotted underline-offset-4 opacity-80" onClick={() => setMore(true)}>
            {t('account.moreOptions')}
          </button>
        ))}
      {err && <p className={`text-sm text-[#a8372a] ${compact ? 'col-span-3' : ''}`}>{t('account.loginError', { message: err })}</p>}
    </div>
  );
}

const RESEND_SECONDS = 60;
/**
 * E-Mail-Code-Login erst anbieten, wenn eigenes SMTP + Code-Vorlage eingerichtet sind
 * (mit dem Standard-Mailversand von Supabase lässt sich die Vorlage nicht ändern – die Mail
 * enthielte nur einen Link, der im Browser statt in der App aufgeht). Schalter: Repo-Variable.
 */
export const EMAIL_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_EMAIL_LOGIN === 'true';
const PROVIDER_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub', discord: 'Discord', email: 'E-Mail' };

/** E-Mail → 6-stelliger Code → fertig. Kein Passwort, kein Link. */
export function EmailLogin({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<EmailStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const explain = (e: unknown) => {
    const kind = e instanceof EmailLoginError ? e.kind : 'other';
    setMsg(kind === 'other' ? t('account.loginError', { message: (e as Error)?.message ?? String(e) }) : t(`account.emailErrors.${kind}`));
  };

  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setStep(await sendEmailCode(address));
      setWait(RESEND_SECONDS);
      setCode('');
    } catch (e) {
      explain(e);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!step) return;
    setBusy(true);
    setMsg(null);
    try {
      expectLogin();
      await verifyEmailCode(address, code, step);
      setMsg(t('account.emailDone'));
    } catch (e) {
      explain(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!step ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="block">
            <span className="font-tiny text-xs uppercase opacity-75">{t('account.emailLabel')}</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="name@example.com"
              className="px-field px-field-light mt-1 block w-full bg-transparent px-1 text-lg [--px:2px]"
            />
          </label>
          <PxButton type="submit" tone="coral" disabled={busy || !address.includes('@')} className="mt-2 w-full text-lg">
            {t('account.sendCode')}
          </PxButton>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-sm leading-snug">{t('account.codeSent', { email: address })}</p>
          <label className="mt-2 block">
            <span className="font-tiny text-xs uppercase opacity-75">{t('account.codeLabel')}</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              aria-label={t('account.codeLabel')}
              className="px-field px-field-light mt-1 block w-full bg-transparent px-1 text-center text-3xl tracking-[0.4em] [--px:2px]"
            />
          </label>
          <PxButton type="submit" tone="coral" disabled={busy || code.length !== 6} className="mt-2 w-full text-lg">
            {t('account.verifyCode')}
          </PxButton>
          <div className="mt-2 flex justify-between text-sm">
            <button type="button" disabled={busy || wait > 0} className="underline decoration-dotted underline-offset-4 disabled:no-underline disabled:opacity-60" onClick={() => void send()}>
              {wait > 0 ? t('account.resendIn', { s: wait }) : t('account.resend')}
            </button>
            <button type="button" className="underline decoration-dotted underline-offset-4" onClick={() => setStep(null)}>
              {t('account.otherEmail')}
            </button>
          </div>
        </form>
      )}
      {msg && <p className="mt-2 text-sm leading-snug" role="status">{msg}</p>}
      <button type="button" className="mt-3 text-sm underline decoration-dotted underline-offset-4 opacity-80" onClick={onBack}>
        ← {t('account.otherMethods')}
      </button>
    </div>
  );
}

/** Kleiner Profil-Knopf oben: anonym „Anmelden“, angemeldet der Avatar. */
export function AccountButton() {
  const { t } = useTranslation();
  const { account, profile } = useAccount();
  const [open, setOpen] = useState(false);
  const signedIn = account && !account.anonymous;
  return (
    <>
      <PxButton tone="wood" small onClick={() => setOpen(true)} aria-label={signedIn ? t('account.title') : t('account.signIn')} className="text-base">
        {signedIn ? <PixelSprite id={`av-${profile?.avatar ?? 0}`} make={() => avatarSprite(profile?.avatar ?? 0)} w={12} h={12} scale={2} /> : t('account.signIn')}
      </PxButton>
      <AccountSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { account, profile, admin, suggestedName } = useAccount();
  const [privacy, setPrivacy] = useState(false);
  const signedIn = account && !account.anonymous;
  return (
    <>
      <Sheet open={open && !privacy} onClose={onClose} label={t('account.title')}>
        {!signedIn ? (
          <>
            <h2 className="text-2xl font-bold">{t('account.saveTitle')}</h2>
            <p className="mt-2 text-base leading-snug">{t('account.saveText')}</p>
            <div className="mt-4">
              <SignInButtons />
            </div>
          </>
        ) : (
          <Profile key={account.id} userId={account.id} provider={account.provider} admin={admin} initial={profile} suggested={suggestedName} onDeleted={onClose} />
        )}
        <div className="mt-4 flex justify-between text-sm">
          <button type="button" className="underline decoration-dotted underline-offset-4" onClick={() => setPrivacy(true)}>
            {t('account.privacy')}
          </button>
          <button type="button" className="underline decoration-dotted underline-offset-4" onClick={onClose}>
            {t('account.close')}
          </button>
        </div>
      </Sheet>
      <PrivacySheet open={open && privacy} onClose={() => setPrivacy(false)} />
    </>
  );
}

function Profile({
  userId,
  provider,
  admin,
  initial,
  suggested,
  onDeleted,
}: {
  userId: string;
  provider: string | null;
  admin: boolean;
  initial: { display_name: string; avatar: number } | null;
  suggested: string;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  // ohne Profil: Name aus Discord/Google/GitHub als Vorschlag (änderbar)
  const [name, setName] = useState(initial?.display_name ?? suggested);
  const [avatar, setAvatar] = useState(initial?.avatar ?? 0);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initial) {
      setName(initial.display_name);
      setAvatar(initial.avatar);
    }
  }, [initial]);

  const save = async () => {
    setBusy(true);
    const err = await saveProfile(userId, { display_name: name, avatar });
    setBusy(false);
    setMsg(err ? t(`account.${err === 'other' ? 'invalid' : err}`) : t('account.saved'));
    if (!err) void refreshProfile();
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <PixelSprite id={`av-${avatar}`} make={() => avatarSprite(avatar)} w={12} h={12} scale={4} />
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold">{initial?.display_name ?? t('account.title')}</h2>
          {provider && <p className="text-sm opacity-75">{t('account.signedInWith', { provider: PROVIDER_NAMES[provider] ?? provider })}</p>}
        </div>
      </div>

      <label className="mt-4 block">
        <span className="font-tiny text-xs uppercase opacity-75">{t('account.name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder={t('account.namePlaceholder')}
          className="px-field px-field-light mt-1 block w-full bg-transparent px-1 text-lg [--px:2px]"
        />
      </label>
      <p className="mt-3 font-tiny text-xs uppercase opacity-75">{t('account.avatar')}</p>
      <div className="mt-1 grid grid-cols-6 gap-1">
        {Array.from({ length: AVATAR_COUNT }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${t('account.avatar')} ${i + 1}`}
            aria-pressed={avatar === i}
            onClick={() => setAvatar(i)}
            className={`grid place-items-center p-0.5 ${avatar === i ? 'px-field px-field-light [--px:2px]' : ''}`}
          >
            <PixelSprite id={`av-${i}`} make={() => avatarSprite(i)} w={12} h={12} scale={3} />
          </button>
        ))}
      </div>
      <PxButton tone="coral" disabled={busy || name.trim().length < 3} className="mt-3 w-full text-lg" onClick={() => void save()}>
        {t('account.save')}
      </PxButton>
      {msg && <p className="mt-1 text-sm">{msg}</p>}

      <h3 className="mt-4 font-tiny text-xs uppercase opacity-75">{t('account.stats')}</h3>
      <dl className="mt-1 grid grid-cols-2 gap-2 text-center">
        {MODES.map((m) => {
          const s = services.progress.getStats(m);
          return (
            <div key={m}>
              <dt className="text-sm font-bold">{t(`modes.${m}.name`)}</dt>
              <dd className="text-sm leading-tight">
                {t('account.played')}: {s.played} · {t('account.best')}: {s.best}
                <br />
                {t('account.streak')}: {s.currentStreak} (max {s.maxStreak})
              </dd>
            </div>
          );
        })}
      </dl>

      {admin && (
        <a href={`${import.meta.env.BASE_URL}admin`} className="px-btn px-btn-teal px-btn-sm mt-4 block w-full text-center text-base">
          <span className="px-btn-label">{t('account.admin')} →</span>
        </a>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <PxButton
          tone="wood"
          small
          className="text-base"
          onClick={() =>
            void signOut().then(() => {
              services.progress.clearAll();
              location.reload();
            })
          }
        >
          {t('account.logout')}
        </PxButton>
        <PxButton tone="coral" small className="text-base" onClick={() => setConfirmDelete(true)}>
          {t('account.delete')}
        </PxButton>
      </div>
      {confirmDelete && (
        <div className="mt-3 border-2 border-[#a8372a] p-2">
          <p className="text-sm leading-snug">{t('account.deleteConfirm')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PxButton tone="wood" small className="text-base" onClick={() => setConfirmDelete(false)}>
              {t('account.cancel')}
            </PxButton>
            <PxButton
              tone="coral"
              small
              disabled={busy}
              className="text-base"
              onClick={() => {
                setBusy(true);
                deleteAccount()
                  .then(() => {
                    services.progress.clearAll();
                    try {
                      for (const k of Object.keys(localStorage)) if (k.startsWith('hal:v1:') && k !== 'hal:v1:lang') localStorage.removeItem(k);
                    } catch {
                      /* egal */
                    }
                    onDeleted();
                    alert(t('account.deleted'));
                    location.reload();
                  })
                  .catch((e) => {
                    setBusy(false);
                    setMsg(String(e?.message ?? e));
                  });
              }}
            >
              {t('account.deleteYes')}
            </PxButton>
          </div>
        </div>
      )}
    </>
  );
}

/** Dezenter Hinweis nach der ersten fertigen Tagesrunde (nur anonym, einmal wegklickbar). */
export function SaveProgressHint() {
  const { t } = useTranslation();
  const { account } = useAccount();
  const KEY = 'hal:v1:hint-save-dismissed';
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return true;
    }
  });
  if (hidden || !account?.anonymous) return null;
  const played = MODES.reduce((n, m) => n + services.progress.getStats(m).played, 0);
  if (played < 1) return null;
  return (
    <div className="mt-3 border-2 border-dashed border-current/40 p-2 text-left">
      <p className="text-base font-bold">{t('account.hintTitle')}</p>
      <p className="text-sm leading-snug opacity-85">{t('account.hintText')}</p>
      <div className="mt-2">
        <SignInButtons compact />
      </div>
      <button
        type="button"
        className="mt-2 text-sm underline decoration-dotted underline-offset-4 opacity-80"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            /* egal */
          }
          setHidden(true);
        }}
      >
        {t('account.hintLater')}
      </button>
    </div>
  );
}

/** Einmalige Meldung nach dem Zusammenführen bzw. bei Login-Fehlern. */
export function AccountNotice() {
  const { t } = useTranslation();
  const { merged, error } = useAccount();
  const [closed, setClosed] = useState(false);
  if (closed || (!merged && !error)) return null;
  return (
    <div className="fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-3" role="status">
      <div className="px-wood max-w-sm px-1 text-sm leading-snug [--px:2px]">
        {merged ? (
          <>
            <p>{t('account.merged', { rounds: merged.addedRounds, rare: merged.streak.rare, common: merged.streak.common })}</p>
            {merged.duplicateDays > 0 && <p className="opacity-80">{t('account.mergedDup', { dups: merged.duplicateDays })}</p>}
          </>
        ) : (
          <p>{t('account.loginError', { message: getAccountState().error })}</p>
        )}
        <button type="button" className="mt-1 underline decoration-dotted underline-offset-4" onClick={() => setClosed(true)}>
          OK
        </button>
      </div>
    </div>
  );
}
