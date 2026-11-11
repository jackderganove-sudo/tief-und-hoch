import { useTranslation } from 'react-i18next';
import { LANGS } from '../domain/types';

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation();
  return (
    <div role="group" aria-label={t('lang.label')} className={`flex rounded-full bg-black/30 p-0.5 text-xs font-semibold backdrop-blur ${className}`}>
      {LANGS.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => void i18n.changeLanguage(lng)}
          aria-pressed={i18n.language === lng}
          title={t(`lang.${lng}`)}
          className={`rounded-full px-2.5 py-1 uppercase transition-colors ${
            i18n.language === lng ? 'bg-white text-cave-950' : 'text-white/80 hover:text-white'
          }`}
        >
          {lng}
        </button>
      ))}
    </div>
  );
}
