import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ulid } from 'ulid';
import { api, axe, seedIds } from './helpers';

// The projects run one after the other (workers: 1), so replacing all data here can't disturb another
// test. The import puts back exactly what the backup holds, so later tests still find their data.

test('download a backup, then import it to replace everything (FR-SET-10, FR-SET-11)', async ({
  page,
  request,
}) => {
  await page.goto('/settings');
  const backupSection = page.getByRole('region', { name: 'Backup and import' });
  await expect(backupSection.getByText(/^Last backup: /)).toBeVisible();

  // Storage meter for Admin (FR-SET-12).
  const storage = page.getByRole('region', { name: 'Storage' });
  await expect(storage.getByText(/MB of 500 MB/)).toBeVisible();
  await expect(storage.getByRole('meter', { name: 'Database storage used' })).toBeVisible();

  const downloading = page.waitForEvent('download');
  await backupSection.getByRole('button', { name: 'Download backup' }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^track-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await file.path();
  const backup = JSON.parse(readFileSync(path, 'utf8')) as {
    schemaVersion: number;
    tables: Record<string, unknown[]>;
  };
  expect(backup.schemaVersion).toBe(1);
  expect(backup.tables.children!.length).toBeGreaterThan(0);
  await expect(backupSection.getByText('Last backup: today')).toBeVisible();
  await axe(page);

  // Something logged after the backup is gone once it's imported.
  const ids = await seedIds(request);
  const lateId = ulid();
  await api(request, 'PUT', `/entries/${lateId}`, {
    childId: ids.sam,
    activityTypeId: ids.type.Bath,
    startUtc: new Date().toISOString(),
    endUtc: null,
    tz: 'Europe/London',
  });

  await page.getByTestId('import-file').setInputFiles(path);
  const sheet = page.getByRole('dialog', { name: 'Import backup' });
  await expect(sheet.getByText(/replaces all data on every phone/)).toBeVisible();
  const replace = sheet.getByRole('button', { name: 'Replace all data' });
  await expect(replace).toBeDisabled();
  await sheet.getByLabel('Type REPLACE to confirm').fill('replace');
  await expect(replace).toBeDisabled();
  await sheet.getByLabel('Type REPLACE to confirm').fill('REPLACE');
  await axe(page);
  await replace.click();
  await expect(page.getByText('Backup imported')).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toBeHidden();

  const day = new Date().toISOString().slice(0, 10);
  const r = await api<{ entries: { id: string }[] }>(
    request,
    'GET',
    `/children/${ids.sam}/entries?from=${day}T00:00:00Z&to=${new Date(Date.now() + 86_400_000).toISOString()}`,
  );
  expect(r.entries.some((e) => e.id === lateId)).toBe(false);
});

test('a file that is not a backup is refused with a clear message (FR-SET-11 AC3)', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('import-file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}'),
  });
  await expect(page.getByRole('alert')).toHaveText("This file isn't a Track backup.");
  await expect(page.getByRole('dialog', { name: 'Import backup' })).toHaveCount(0);
});

test('a Writer can download a backup but not import or see storage', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-dev-user-email': 'jamie@example.com' });
  await page.goto('/settings');
  const backupSection = page.getByRole('region', { name: 'Backup and import' });
  await expect(backupSection.getByRole('button', { name: 'Download backup' })).toBeEnabled();
  await expect(backupSection.getByRole('button', { name: 'Import' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Storage' })).toHaveCount(0);
});
