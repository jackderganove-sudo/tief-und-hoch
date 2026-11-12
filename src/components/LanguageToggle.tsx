import { useTranslation } from 'react-i18next';
import { LANGS } from '../domain/types';
import { PxButton } from './px';

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation();
  return (
    <div role="group" aria-label={t('lang.label')} className={`flex gap-1 ${className}`}>
      {LANGS.map((lng) => (
        <PxButton
          key={lng}
          small
          tone={i18n.language === lng ? 'gold' : 'wood'}
          onClick={() => void i18n.changeLanguage(lng)}
          aria-pressed={i18n.language === lng}
          title={t(`lang.${lng}`)}
          className="text-sm uppercase"
        >
          {lng}
        </PxButton>
      ))}
    </div>
  );
}
