import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Für GitHub Pages liegt die App unter /tief-und-hoch/ – der Workflow setzt
// VITE_BASE entsprechend. Lokal (dev, preview, build) bleibt es bei "/".
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  // Feste Konstante statt import.meta.env-Zugriff: nur so entfernt der Bundler
  // den Debug-Code vollständig, wenn VITE_ENABLE_DEBUG nicht gesetzt ist.
  define: { __DEBUG_BUILD__: JSON.stringify(process.env.VITE_ENABLE_DEBUG === 'true') },
  plugins: [react(), tailwindcss()],
  // host: true macht den Dev-Server im WLAN erreichbar (Test auf Handy/iPad).
  server: { host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
