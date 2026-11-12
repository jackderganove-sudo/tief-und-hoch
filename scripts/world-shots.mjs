/**
 * Welt-Querschnitt fotografieren:  node scripts/world-shots.mjs [mobile|desktop]
 * Legt screenshots/world-<view>-<m>.png an und ein Übersichtsbild pro Modus.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5198;
const vpName = process.argv[2] ?? 'mobile';
const vp = vpName === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {}
  await sleep(250);
}
mkdirSync('screenshots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: vp });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shots = [['home', 0]];
for (const m of [0, 400, 1000, 1700, 2600, 3200, 4200, 4900, 5500, 5800, 6300, 6800, 7000]) shots.push(['rare', m]);
for (const m of [0, 100, 300, 800, 1500, 2300, 3100, 3800, 4600, 5300, 6000, 7000]) shots.push(['common', m]);
for (const [view, m] of shots) {
  await page.goto(`http://localhost:${PORT}/?world=${view}&m=${m}`);
  await sleep(1300);
  await page.screenshot({ path: `screenshots/world-${vpName}-${view}-${m}.png` });
}
await browser.close();
proc.kill();
if (errors.length) console.log(errors.join('\n'));
console.log('ok');
