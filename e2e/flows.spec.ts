import { expect, test } from '@playwright/test';
import { api, axe, deleteEntriesFor, endRunning, seedIds } from './helpers';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

test('confirm, skip and undo planned items (FR-LOG-03, FR-SCHED-03)', async ({ page, request }) => {
  const ids = await seedIds(request);
  const label = `Splash ${Date.now()}`;
  const { scheduleItem } = await api<{ scheduleItem: { id: string } }>(request, 'POST', '/schedule-items', {
    childId: ids.sam,
    activityTypeId: ids.type.Bath,
    label,
    startTime: '23:58',
    daysMask: 127,
  });
  try {
    await page.reload();
    const today = page.getByRole('region', { name: 'Today' });
    const row = today.getByRole('button', { name: new RegExp(label) });
    await row.click();
    await axe(page, 'sheet-planned');
    await page.getByRole('dialog').getByRole('button', { name: 'Skip today' }).click();
    await expect(today.getByRole('button', { name: new RegExp(`${label}.*Skipped`) })).toBeVisible();
    await row.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Undo skip' }).click();
    await expect(today.getByRole('button', { name: new RegExp(`${label}.*Skipped`) })).toHaveCount(0);
    // Done at the planned time: the planned row gives way to a logged Bath.
    await row.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Done at planned time · 23:58/ })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(row).toHaveCount(0);
  } finally {
    await deleteEntriesFor(request, ids.sam, scheduleItem.id);
    await api(request, 'DELETE', `/schedule-items/${scheduleItem.id}`);
  }
});

test('medication sheet shows each medicine status (FR-MED-02)', async ({ page }) => {
  await page
    .getByRole('navigation', { name: 'Quick log' })
    .getByRole('button', { name: 'Medication' })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Log medication' });
  await expect(sheet.getByRole('radio', { name: /Medicine B/ })).toBeVisible();
  await sheet.getByRole('radio', { name: /Medicine B/ }).click();
  await expect(sheet.getByLabel('Dose')).toHaveValue('3');
  await axe(page, 'sheet-med');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
});

test('the Poo sheet fits on the screen without scrolling when logging now', async ({ page }) => {
  const quick = page.getByRole('navigation', { name: 'Quick log' });
  await quick.getByRole('button', { name: 'Poo', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Log Poo' });
  await expect(sheet.getByRole('group', { name: 'Consistency (optional)' })).toBeVisible();
  const fits = await sheet.evaluate((d) => d.scrollHeight <= d.clientHeight);
  expect(fits).toBe(true);
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeInViewport({ ratio: 1 });
  await axe(page, 'sheet-poo');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
});

test('start and end a nap, delete it and undo (FR-LOG-04, FR-LOG-06)', async ({ page, request }) => {
  await endRunning(request, (await seedIds(request)).sam);
  await page.reload();
  await page.getByRole('navigation', { name: 'Quick log' }).getByRole('button', { name: 'Nap' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  const card = page.getByRole('region', { name: 'Nap · running' });
  await expect(card).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await axe(page, `home-running-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await card.getByRole('button', { name: 'End' }).click();
  await expect(card).toHaveCount(0);
  const today = page.getByRole('region', { name: 'Today' });
  await today
    .getByRole('button', { name: /Nap .* 0 h 0 m/ })
    .last()
    .click();
  await axe(page, 'sheet-entry');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('status')).toContainText('deleted');
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(today.getByRole('button', { name: /Nap .* 0 h 0 m/ }).last()).toBeVisible();
});

test('retrospective log: pick an earlier time today (FR-LOG-02)', async ({ page }) => {
  // 40 minutes ago, or just after midnight if that would be yesterday (in the browser's London time).
  const london = (d: Date, o: Intl.DateTimeFormatOptions) =>
    d.toLocaleString('en-GB', { timeZone: 'Europe/London', ...o });
  const now = new Date();
  const then = new Date(now.getTime() - 40 * 60_000);
  const sameDay = london(then, { dateStyle: 'short' }) === london(now, { dateStyle: 'short' });
  const hhmm = sameDay ? london(then, { hour: '2-digit', minute: '2-digit' }) : '00:01';
  const note = `retro ${Date.now()}`;
  await page.getByRole('navigation', { name: 'Quick log' }).getByRole('button', { name: 'Formula' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log Formula' });
  await sheet.getByRole('button', { name: 'Pick a time' }).click();
  await expect(sheet.getByRole('button', { name: 'Pick a time' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByLabel('Time', { exact: true }).fill(hhmm);
  await sheet.getByLabel('Note (optional)').fill(note);
  await axe(page, 'sheet-log-retro');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  // It sits on the timeline at the picked time, and its details say so.
  const today = page.getByRole('region', { name: 'Today' });
  const rows = today.getByRole('button', { name: new RegExp(`^${hhmm} Formula`) });
  await expect(rows.first()).toBeVisible();
  await rows.last().click();
  const details = page.getByRole('dialog', { name: 'Formula' });
  await expect(details.getByText(`Note: ${note}`)).toBeVisible();
});

test('history: add on a past day, navigate, export (FR-HIST-01, -02, -04)', async ({ page }) => {
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page).toHaveURL(/\/history\/\d{4}-\d{2}-\d{2}$/);
  const day = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bath' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log Bath' });
  await expect(sheet.getByLabel('Date')).toHaveValue(day);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.history-row', { hasText: 'Bath' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page).toHaveURL(/\/history$/);
  await page.getByRole('button', { name: 'Export' }).click();
  await axe(page, 'sheet-export');
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^track-export-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/,
  );
});

for (const scheme of ['light', 'dark'] as const) {
  test(`settings pages open and pass axe in the ${scheme} theme (TECH-12)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.getByRole('link', { name: 'Settings' }).click();
    for (const [link, heading, shot] of [
      ['Schedule', 'Schedule', 'settings-schedule'],
      ['Activity types and fields', 'Activity types', 'settings-types'],
      ['Child activity settings', 'Child activity settings', 'settings-child-activities'],
      ['Medicines', 'Medicines', 'settings-meds'],
      ['Children', 'Children', 'settings-children'],
      ['Users', 'Users', 'settings-users'],
    ] as const) {
      await page.getByRole('link', { name: new RegExp(`^${link}`) }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await axe(page, `${shot}-${scheme}`);
      await page.getByRole('link', { name: 'Back' }).click();
    }
    await page.getByRole('link', { name: /^Schedule/ }).click();
    await page.getByRole('link', { name: /Nap/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nap' })).toBeVisible();
    await axe(page, `settings-schedule-edit-${scheme}`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible();
    await page.getByRole('link', { name: 'Back' }).click();
    await page.getByRole('link', { name: /^Activity types/ }).click();
    await page.getByRole('link', { name: /Cereal/ }).click();
    await axe(page, `settings-type-${scheme}`);
  });
}
