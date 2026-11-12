import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './de.json';
import en from './en.json';
import type { Lang } from '../domain/types';

const LANG_KEY = 'hal:v1:lang';

const SITE = 'https://playhighsandlows.github.io/';

/** Sprache aus der Adresse (?lang=de / ?lang=en) – hat Vorrang vor der gespeicherten Wahl. */
function urlLang(): Lang | null {
  try {
    const l = new URLSearchParams(location.search).get('lang');
    return l === 'de' || l === 'en' ? l : null;
  } catch {
    return null;
  }
}

function initialLang(): Lang {
  const fromUrl = urlLang();
  if (fromUrl) return fromUrl;
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

/** Titel, Beschreibung, Sprache und Canonical passend zur Sprache setzen (Suchmaschinen rendern JS). */
function applyDocumentLanguage(lng: string) {
  document.documentElement.lang = lng;
  if (/\/admin\/?$/.test(location.pathname)) return; // eigener Titel, noindex
  document.title = i18n.t('seo.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', i18n.t('seo.description'));
  // Canonical: „/“ ist die Startseite mit automatischer Sprache (x-default),
  // ?lang=de und ?lang=en sind die festen Sprachfassungen und verweisen auf sich selbst.
  const canonical = urlLang() ? `${SITE}?lang=${lng}` : SITE;
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonical);
}

i18n.on('languageChanged', (lng) => {
  applyDocumentLanguage(lng);
  try {
    localStorage.setItem(LANG_KEY, lng);
  } catch {
    /* ignorieren */
  }
  // Steht die Sprache in der Adresse, beim Umschalten mitziehen (teilbare Links)
  if (urlLang() && urlLang() !== lng) {
    const u = new URL(location.href);
    u.searchParams.set('lang', lng);
    history.replaceState(history.state, '', u);
  }
});
applyDocumentLanguage(i18n.language);

export function currentLang(): Lang {
  return i18n.language === 'en' ? 'en' : 'de';
}

export function localeFor(lang: Lang): string {
  return lang === 'de' ? 'de-DE' : 'en-GB';
}

export default i18n;
