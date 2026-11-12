/**
 * Screenshots für die Sichtkontrolle:  npm run screenshots [-- --only=mobile] [-- --quick]
 * Startet einen eigenen Dev-Server, spielt beide Tagesmodi durch und legt PNGs
 * nach screenshots/<viewport>-<name>.png (Mobile 390x844, Desktop 1440x900).
 * --quick: nur Start + je erste Frage/Auflösung (schneller beim Iterieren).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5199;
const BASE = `http://localhost:${PORT}/`;
const OUT = 'screenshots';
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const quick = args.includes('--quick');
// --reduced: prefers-reduced-motion emulieren, Dateien bekommen das Präfix "reduced-"
const reduced = args.includes('--reduced');
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
].filter((v) => !only || v.name === only);

// Prompt → Antworten (um gezielt gute/schlechte Antworten zu tippen)
const answers = new Map();
for (const f of readdirSync('src/data/questions/de')) {
  for (const q of JSON.parse(readFileSync(`src/data/questions/de/${f}`, 'utf8'))) answers.set(q.prompt, q.answers);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(BASE)).ok) return proc;
    } catch {
      /* noch nicht bereit */
    }
    await sleep(250);
  }
  proc.kill();
  throw new Error('Dev-Server startet nicht');
}

async function playMode(page, vp, mode, picks) {
  const label = mode === 'rare' ? 'Abstieg' : 'Aufstieg';
  await page.getByRole('button', { name: new RegExp(label) }).first().click();
  await sleep(900);
  await page.screenshot({ path: `${OUT}/${vp.name}-${mode}-0-intro.png` });
  await page.getByRole('button', { name: /Los geht|Weiterspielen/ }).click();
  for (let i = 0; i < 7; i++) {
    await page.waitForSelector('input');
    await sleep(500);
    const prompt = (await page.locator('h1').first().innerText()).trim();
    const list = answers.get(prompt) ?? [];
    const pick = picks[i];
    // pick: Anteil 0..1 durch die nach Häufigkeit sortierte Liste, oder null = falsche Antwort
    const text = pick === null || !list.length ? 'xyzzy' : list[Math.min(list.length - 1, Math.floor(pick * list.length))].text;
    await page.locator('input').fill(text);
    if (i === 0) await page.screenshot({ path: `${OUT}/${vp.name}-${mode}-1-question.png` });
    await page.keyboard.press('Enter');
    await sleep(700);
    if (i === 0) await page.screenshot({ path: `${OUT}/${vp.name}-${mode}-2-travel.png` });
    await sleep(3200);
    if (i < 2 || i === 6) await page.screenshot({ path: `${OUT}/${vp.name}-${mode}-3-reveal-${i + 1}.png` });
    if (quick && i === 1) return false;
    await page.getByRole('button', { name: /^(Weiter|Zum Ergebnis)/ }).click();
  }
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/${vp.name}-${mode}-4-result.png` });
  await page.screenshot({ path: `${OUT}/${vp.name}-${mode}-4-result-full.png`, fullPage: true });
  return true;
}

mkdirSync(OUT, { recursive: true });
const server = await startServer();
const browser = await chromium.launch();
const problems = [];
try {
  for (const vp of VIEWPORTS) {
    const { name: vpName, ...opts } = vp;
    const name = reduced ? `reduced-${vpName}` : vpName;
    const ctx = await browser.newContext({ ...opts, viewport: { width: vp.width, height: vp.height }, locale: 'de-DE', reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(() => localStorage.setItem('tuh:v1:lang', 'de'));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: ${m.text()}`));
    await page.goto(BASE);
    await sleep(1800);
    await page.screenshot({ path: `${OUT}/${name}-start.png` });

    // Abstieg: seltene Antworten (Ende der Liste), eine falsche
    const doneRare = await playMode(page, { ...vp, name }, 'rare', [0.97, 0.5, null, 0.9, 0.99, 0.2, 0.95]);
    if (doneRare) await page.getByRole('button', { name: /Startseite/ }).click();
    else await page.goto(BASE);
    await sleep(800);
    // Aufstieg: häufige Antworten (Anfang der Liste)
    const doneCommon = await playMode(page, { ...vp, name }, 'common', [0, 0.05, null, 0, 0.3, 0, 0]);
    if (doneCommon) {
      await page.getByRole('button', { name: /Startseite/ }).click();
      await sleep(800);
      await page.screenshot({ path: `${OUT}/${name}-start-played.png` });
      await page.getByRole('button', { name: /Übung/ }).first().click();
      await sleep(1200);
      await page.screenshot({ path: `${OUT}/${name}-practice.png` });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (problems.length) {
  console.log('Konsolenfehler:\n' + [...new Set(problems)].join('\n'));
  process.exitCode = 1;
}
console.log(`Screenshots in ${OUT}/`);
