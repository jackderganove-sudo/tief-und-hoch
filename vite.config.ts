import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // host: true macht den Dev-Server im WLAN erreichbar (Test auf Handy/iPad).
  server: { host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
