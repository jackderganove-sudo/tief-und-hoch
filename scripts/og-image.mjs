/**
 * Vorschaubild für Link-Vorschauen erzeugen (WhatsApp, Messenger, Suchmaschinen):
 *   node scripts/og-image.mjs   → public/og-image.png (1200×630)
 * Fotografiert die Dev-Seite /?og (src/seo/OgPreview.tsx) – Pixel-Szene + Titel.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5197;
const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {
      /* startet noch */
    }
    await sleep(250);
  }
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.emulateMedia({ reducedMotion: 'reduce' }); // ruhiges Standbild
  await p.goto(`http://localhost:${PORT}/?og`);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: 'public/og-image.png' });
  await b.close();
  console.log('public/og-image.png (1200×630)');
} finally {
  proc.kill();
}
