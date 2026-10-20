import { expect, test } from '@playwright/test';
import { axe } from './helpers';

test('Home loads for Alex and a quick log appears straight away (FR-LOG-01 AC5)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
  const note = `smoke ${Date.now()}`; // a unique note, checked in the entry details
  await page.getByRole('navigation', { name: 'Quick log' }).getByRole('button', { name: 'Formula' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log Formula' });
  await expect(sheet.getByLabel('Amount (optional)')).toHaveValue('210');
  await sheet.getByLabel('Note (optional)').fill(note);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  const today = page.getByRole('region', { name: 'Today' });
  await expect(today.getByText('210 ml · Alex').first()).toBeVisible();
  // Open the newest Formula entry and check it's ours.
  await today
    .getByRole('button', { name: /Formula 210 ml · Alex/ })
    .last()
    .click();
  await expect(page.getByRole('dialog', { name: 'Formula' }).getByText(`Note: ${note}`)).toBeVisible();
});

test('a Read only user sees no logging controls (FR-AUTH-03 AC3)', async ({ page, request }) => {
  await request.post('/api/users', {
    headers: { 'x-dev-user-email': 'alex@example.com' },
    data: { email: 'granny@example.com', displayName: 'Granny', role: 'reader' },
  });
  await page.setExtraHTTPHeaders({ 'x-dev-user-email': 'granny@example.com' });
  await page.goto('/');
  await expect(page.getByText('View only')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Quick log' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('button', { name: 'Add' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`all three screens pass axe in the ${scheme} theme (TECH-12)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Sam' })).toBeVisible();
    await axe(page);
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await axe(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await axe(page);
  });
}
