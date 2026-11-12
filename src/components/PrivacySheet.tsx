import { useTranslation } from 'react-i18next';
import { Sheet } from './Sheet';

/** Kurze Datenschutz-Seite (DE/EN) – was gespeichert wird und wie man es löscht. */
export function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const body = t('privacy.body', { returnObjects: true }) as string[];
  return (
    <Sheet open={open} onClose={onClose} label={t('privacy.title')}>
      <h2 className="text-2xl font-bold">{t('privacy.title')}</h2>
      {body.map((p, i) => (
        <p key={i} className="mt-2 text-sm leading-snug">
          {p}
        </p>
      ))}
      <button type="button" className="mt-4 text-sm underline decoration-dotted underline-offset-4" onClick={onClose}>
        {t('account.close')}
      </button>
    </Sheet>
  );
}
