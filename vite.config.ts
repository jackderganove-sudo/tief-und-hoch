import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Die App liegt im Wurzelverzeichnis (https://playhighsandlows.github.io/).
// VITE_BASE nur setzen, falls sie einmal in einem Unterordner laufen soll.
const base = process.env.VITE_BASE ?? '/';

// Kennung dieses Builds (Commit in CI, sonst Zeitpunkt) – z. B. leert eine neue
// App-Version den lokalen Cache der KI-Urteile.
const buildId = process.env.GITHUB_SHA?.slice(0, 12) ?? `local-${Date.now()}`;

export default defineConfig({
  base,
  // Build-Infos fürs Admin-Dashboard (System). Debug gibt es im Live-Build nur für Admins.
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __COMMIT__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Installierbare App: Manifest + Service Worker (Workbox)
    VitePWA({
      // Neue Version nie automatisch aktivieren – die App zeigt einen Hinweis (UpdateToast)
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png', 'favicon-64.png'],
      manifest: {
        id: '/',
        name: 'Highs & Lows',
        short_name: 'Highs & Lows',
        description: 'Jeden Tag 7 Fragen: Je seltener deine Antwort, desto tiefer – je häufiger, desto höher. Ein Pixel-Trivia-Spiel.',
        lang: 'de',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        // Android: immersiv ohne Status- und Gestenleiste; sonst (z. B. iOS) standalone
        display_override: ['fullscreen', 'standalone'],
        display: 'standalone',
        orientation: 'portrait',
        // neutral dunkel: färbt u. a. die untere Android-Leiste, wenn sie nicht transparent ist
        theme_color: '#16121f',
        background_color: '#16121f',
        categories: ['games', 'education'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          { src: 'screenshots/home.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Startseite: Aufstieg oder Abstieg' },
          { src: 'screenshots/descent.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Abstieg bis zum glühenden Kern' },
          { src: 'screenshots/ascent.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Aufstieg im Heißluftballon' },
        ],
      },
      workbox: {
        // App-Shell, Code (inkl. Fragen-Chunks), Grafiken, Schriften → offline spielbar
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2,webmanifest}'],
        globIgnores: ['screenshots/**', 'og-image.png', 'google*.html', 'sitemap.*', 'robots.txt'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // /admin & Co. aus dem Cache – auch der OAuth-Rücksprung (?code=…) landet in der App
        navigateFallback: 'index.html',
        runtimeCaching: [
          // Supabase (Datenbank, KI-Prüfung, Anmeldung) NIE cachen
          { urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'), handler: 'NetworkOnly' },
          { urlPattern: ({ url }) => url.hostname === 'github.com' || url.hostname.endsWith('.github.com'), handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
  // host: true macht den Dev-Server im WLAN erreichbar (Test auf Handy/iPad).
  server: { host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
