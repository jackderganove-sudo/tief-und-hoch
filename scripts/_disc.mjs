import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b = await chromium.connectOverCDP('http://localhost:9222', { timeout: 20000 });
const s = await b.newBrowserCDPSession();
// alte Inkognito-Kontexte schließen, neuen öffnen
const { browserContextIds } = await s.send('Target.getBrowserContexts');
for (const id of browserContextIds) await s.send('Target.disposeBrowserContext', { browserContextId: id }).catch(() => {});
const { browserContextId } = await s.send('Target.createBrowserContext');
await s.send('Target.createTarget', { url: 'https://playhighsandlows.github.io/?lang=de&t=discord', browserContextId });
await new Promise((r) => setTimeout(r, 4000));
await b.close();
const b2 = await chromium.connectOverCDP('http://localhost:9222', { timeout: 20000 });
const p = b2.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('t=discord'));
// anonymer Spieler: Übung starten (legt die anonyme Sitzung an)
await p.getByText('∞ Übung').click();
await p.getByText('Übung starten').click();
await p.getByPlaceholder('Deine Antwort …').waitFor();
for (let i = 0; i < 20; i++) {
  const u = await p.evaluate(() => JSON.parse(localStorage.getItem('hal:v1:auth') || 'null')?.user);
  if (u) { writeFileSync('/tmp/claude-1000/-home-jack--claude-spares-spare-dkCZQU/b38ff9d3-e124-4217-8966-609e79b6782d/scratchpad/anon.txt', u.id); console.log('anonymer Spieler:', u.id, 'anonym:', u.is_anonymous); break; }
  await p.waitForTimeout(500);
}
await p.goto('https://playhighsandlows.github.io/?lang=de&t=discord');
await p.getByRole('button', { name: 'Anmelden' }).click();
await p.getByRole('button', { name: 'Mit Discord anmelden' }).click();
await p.waitForURL(/discord\.com/, { timeout: 15000 });
console.log('weitergeleitet zu:', new URL(p.url()).host + new URL(p.url()).pathname);
await b2.close();
