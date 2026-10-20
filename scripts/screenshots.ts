// Regenerates the README screenshots in docs/screenshots/ from the fictional demo data.
//   npm run screenshots   (set PW_CHROMIUM_PATH to use an installed Chromium)
//
// Starts its own local Worker on port 8790 with a fresh local database under .wrangler/screenshots,
// loads scripts/seed-demo.ts with "now" fixed at 15:10 today (London), and drives the app at the
// Pixel 7 viewport with the local dev auth stub, signed in as Alex. Nothing here touches a deployed database.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { chromium, devices, type Page } from '@playwright/test';
import { localDateOf, zonedTimeToUtc } from '../src/shared/time';

const PORT = 8790;
const BASE = `http://localhost:${PORT}`;
const DIR = '.wrangler/screenshots';
const OUT = 'docs/screenshots';
const TZ = 'Europe/London';
const NOW = zonedTimeToUtc(localDateOf(new Date(), TZ), '15:10', TZ);

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit' });

rmSync(DIR, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'track-local', '--local', '--persist-to', DIR]);
run('npx', ['tsx', 'scripts/seed-demo.ts', '--now', NOW.toISOString(), '--persist-to', DIR]);
run('npx', ['vite', 'build']);

const server = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '--port',
    String(PORT),
    '--persist-to',
    DIR,
    '--var',
    'DEV_AUTH_STUB:1',
    '--var',
    'DEV_AUTH_EMAIL:alex@example.com',
  ],
  { stdio: 'ignore', detached: true },
);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/version`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('The local Worker did not start.');
}

// --lang makes native date inputs use dd/mm/yyyy, as on a UK phone.
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--lang=en-GB'],
  env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB' },
});
try {
  await waitForServer();

  async function phone(scheme: 'light' | 'dark'): Promise<Page> {
    const context = await browser.newContext({
      ...devices['Pixel 7'],
      deviceScaleFactor: 2,
      locale: 'en-GB',
      timezoneId: TZ,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    await page.goto(BASE);
    await page.getByRole('heading', { level: 1, name: 'Sam' }).waitFor();
    await page.waitForTimeout(500);
    return page;
  }
  const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

  const dark = await phone('dark');
  await shot(dark, 'home-dark');
  await dark.context().close();

  const page = await phone('light');
  await shot(page, 'home-light');
  // The running nap and the medicine status.
  // Close-up of the running nap and the medicine status.
  await page.screenshot({
    path: `${OUT}/home-timer-medication.png`,
    clip: { x: 0, y: 0, width: 412, height: 360 },
  });

  await page.mouse.wheel(0, -10_000);
  await page.getByRole('navigation', { name: 'Quick log' }).getByRole('button', { name: 'Formula' }).click();
  await page.getByRole('dialog', { name: 'Log Formula' }).waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'log-entry');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('heading', { name: 'History' }).waitFor();
  await page.getByRole('button', { name: /Previous/ }).click();
  await page.waitForTimeout(600);
  await shot(page, 'history');

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'export');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, 'settings');

  await page.goto(`${BASE}/settings/schedule`);
  await page.getByText('Overnight sleep').first().waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'schedule');
  await page.getByRole('link', { name: /14:30/ }).click();
  await page.getByText('Schedule item · Sam').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'schedule-edit');
  await page.context().close();

  // GitHub social preview: three phones side by side on a plain background.
  const card = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await card.setContent(
    `<html><body style="margin:0;width:1280px;height:640px;background:#e9edf5;display:flex;align-items:center;justify-content:center;gap:56px;font-family:sans-serif">
      ${['home-light', 'home-dark', 'history']
        .map(
          (n) =>
            `<img src="data:image/png;base64,${readFileSync(`${OUT}/${n}.png`).toString('base64')}" style="height:560px;border-radius:28px;box-shadow:0 12px 40px rgba(20,24,33,.25);border:8px solid #141821">`,
        )
        .join('')}
    </body></html>`,
  );
  await card.waitForTimeout(300);
  await card.screenshot({ path: `${OUT}/social-preview.png` });
  console.log(`Wrote the screenshots to ${OUT}/.`);
} finally {
  await browser.close();
  if (server.pid) process.kill(-server.pid);
}
