/**
 * Auf dem echten Android-Gerät spielen und Screenshots machen (Chrome per CDP über adb).
 *
 *   adb connect <IP:Port>                       # kabelloses Debugging
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   ADB_SERIAL=<IP:Port> node scripts/device-play.mjs Abstieg 7 pixel-app-rare
 *   adb forward --remove tcp:9222
 *
 * Spielt eine Übung (Abstieg: sehr seltene, Aufstieg: häufigste Antworten) in der offenen
 * Seite bzw. installierten App und legt nach jeder Fahrt screenshots/<prefix>-<n>.png ab.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const [mode, steps, prefix] = process.argv.slice(2);
const answers = new Map();
for (const f of readdirSync('src/data/questions/de')) for (const q of JSON.parse(readFileSync(`src/data/questions/de/${f}`, 'utf8'))) answers.set(q.prompt, q.answers);
const serial = process.env.ADB_SERIAL ? `-s ${process.env.ADB_SERIAL}` : '';
const shot = (name) => writeFileSync(`screenshots/${prefix}-${name}.png`, execSync(`adb ${serial} exec-out screencap -p`, { maxBuffer: 64 << 20 }));
const b = await chromium.connectOverCDP('http://localhost:9222');
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().startsWith('https://playhighsandlows.github.io'));
await p.goto('https://playhighsandlows.github.io/');
await p.waitForTimeout(1500);
shot('home');
console.log('home theme', await p.evaluate(() => document.querySelector('meta[name=theme-color]').content));
await p.getByText('∞ Übung').click();
await p.getByRole('radio', { name: new RegExp(mode) }).click();
await p.getByText('Übung starten').click();
for (let i = 0; i < Number(steps); i++) {
  const box = p.getByPlaceholder('Deine Antwort …');
  await box.waitFor();
  const list = (answers.get(await p.locator('h1').first().innerText()) ?? []).filter((a) => !a.tooClever);
  const a = mode === 'Abstieg' ? list[list.length - 1] : list[0];
  await box.fill(a ? a.text : 'xyzzy');
  await box.press('Enter');
  await p.getByRole('button', { name: 'Weiter' }).waitFor({ timeout: 9000 });
  await p.getByRole('button', { name: 'Weiter' }).click(); // Panel weg, Szene sichtbar
  await p.getByPlaceholder('Deine Antwort …').waitFor();
  await p.waitForTimeout(3500);
  const hud = (await p.locator('header').innerText()).match(/[−-]?[\d.]+ m/)?.[0];
  const theme = await p.evaluate(() => document.querySelector('meta[name=theme-color]').content);
  shot(`${i + 1}`);
  console.log(`${mode} ${i + 1}: ${hud} theme ${theme}`);
}
await b.close();
