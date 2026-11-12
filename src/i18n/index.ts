import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './de.json';
import en from './en.json';
import type { Lang } from '../domain/types';

const LANG_KEY = 'hal:v1:lang';

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    /* localStorage gesperrt */
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: initialLang(),
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(LANG_KEY, lng);
  } catch {
    /* ignorieren */
  }
});
document.documentElement.lang = i18n.language;

export function currentLang(): Lang {
  return i18n.language === 'en' ? 'en' : 'de';
}

export function localeFor(lang: Lang): string {
  return lang === 'de' ? 'de-DE' : 'en-GB';
}

export default i18n;
