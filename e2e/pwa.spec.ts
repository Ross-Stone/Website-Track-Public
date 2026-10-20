import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function openControlled(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
  // Wait for the service worker to precache the shell and take control, then reload under it.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
}

test('the manifest and icons make the app installable (NFR-03, TECH-04)', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as Record<string, unknown> & {
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(m).toMatchObject({ name: 'Track', short_name: 'Track', start_url: '/', display: 'standalone' });
  // Android paints its navigation bar with these, so they stay dark (see the plan's "Manifest colours").
  expect(m).not.toHaveProperty('theme_color');
  expect(m.background_color).toBe('#141821');
  expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  for (const icon of m.icons) {
    const img = await request.get(icon.src);
    expect(img.ok()).toBe(true);
    expect(img.headers()['content-type']).toBe('image/png');
    expect(icon.src.startsWith('/icons/')).toBe(true); // the only paths that bypass Access
  }
});

test('offline: opens from the cached shell with cached data, banner and greyed controls (FR-SYNC-03)', async ({
  page,
  context,
}) => {
  await openControlled(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: /^Offline · last updated \d\d:\d\d$/ }),
  ).toBeVisible();
  const quick = page.getByRole('navigation', { name: 'Quick log' });
  await expect(quick.getByRole('button', { name: 'Formula' })).toBeDisabled();
  await expect(quick.getByRole('button', { name: 'Other' })).toBeDisabled();

  // History still opens today from this phone; Add is greyed out.
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('button', { name: 'Add' })).toBeDisabled();

  // Back online: the app notices and checks for changes (AC5).
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Offline/ })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Quick log' }).getByRole('button', { name: 'Formula' }),
  ).toBeEnabled();
});

test('an expired Access session shows "Sign in again" over the cached data (FR-AUTH-04)', async ({
  page,
}) => {
  await openControlled(page);
  // Access answers an expired session with a redirect to its login page.
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 302,
      headers: { location: 'https://example.cloudflareaccess.com/cdn-cgi/access/login' },
    }),
  );
  await page.getByRole('button', { name: /Refresh$/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/You can still see what was loaded at \d\d:\d\d/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Sam', includeHidden: true })).toBeAttached();
  // The button reloads through Access, past the cached shell.
  await page.unroute('**/api/**');
  await sheet.getByRole('button', { name: 'Sign in again' }).click();
  await expect(page).toHaveURL(/\/$/); // ?signin= is removed once back
  await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
});

test('pull down on Home refreshes (FR-HOME-05)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
  const versionCheck = page.waitForRequest((r) => r.url().endsWith('/api/version'));
  await page.evaluate(() => {
    const t = (y: number) => new Touch({ identifier: 1, target: document.body, clientX: 200, clientY: y });
    window.dispatchEvent(new TouchEvent('touchstart', { touches: [t(100)] }));
    window.dispatchEvent(new TouchEvent('touchmove', { touches: [t(180)] }));
    window.dispatchEvent(new TouchEvent('touchmove', { touches: [t(260)] }));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
  });
  await versionCheck;
});

test('a new version taking over an open app offers a refresh (TECH-04)', async ({ page }) => {
  await openControlled(page);
  await expect(page.getByText('A new version of Track is ready.')).toHaveCount(0);
  // "Deploy" a new version: change the service worker that the local server serves, as a new build does.
  // (Playwright can't intercept a service worker's own script, so the built file is edited and restored.)
  const file = 'dist/client/sw.js';
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, `${original}\n// next build ${Date.now()}\n`);
  try {
    // The browser's update check, which the app asks for on each sync.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            await (await navigator.serviceWorker.getRegistration())!.update();
            return document.body.textContent?.includes('A new version of Track is ready.');
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
  } finally {
    writeFileSync(file, original);
  }
  const banner = page.getByRole('status').filter({ hasText: 'A new version of Track is ready.' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
  await expect(page.getByText('A new version of Track is ready.')).toHaveCount(0);
});
