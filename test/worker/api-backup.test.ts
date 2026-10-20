import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bootstrap, StorageInfo } from '../../src/shared/api';
import {
  BACKUP_ENTRIES_PAGE,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  chunkRows,
  parseBackup,
  type Backup,
  type BackupTable,
} from '../../src/shared/backup';
import { api, ensureReader, JAMIE, newId, READER, ALEX, seedIds, version } from './api';

let ids: Awaited<ReturnType<typeof seedIds>>;
beforeAll(async () => {
  await ensureReader();
  ids = await seedIds();
});

async function addEntries(n: number) {
  const made: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = newId();
    const r = await api('PUT', `/entries/${id}`, {
      childId: ids.sam,
      activityTypeId: ids.type.Formula,
      startUtc: new Date(Date.UTC(2026, 8, 1, 8, i)).toISOString(),
      endUtc: null,
      tz: 'Europe/London',
      values: { amount: 100 + i },
      note: i === 0 ? 'Ñandú – “quotes”, commas, and\nnew lines' : null,
    });
    expect(r.status).toBe(201);
    made.push(id);
  }
  return made;
}

/** Downloads a full backup the way the app does: entries pages, then the rest. */
async function downloadBackup(as = ALEX): Promise<Backup> {
  const rows: unknown[] = [];
  let after = '';
  for (;;) {
    const r = await api<{ rows: unknown[]; next: string | null }>(
      'GET',
      `/backup?part=entries&after=${after}`,
      undefined,
      as,
    );
    expect(r.status).toBe(200);
    rows.push(...r.body.rows);
    if (!r.body.next) break;
    after = r.body.next;
  }
  const c = await api<Backup>('GET', '/backup?part=config', undefined, as);
  expect(c.status).toBe(200);
  return { ...c.body, tables: { ...c.body.tables, entries: rows } } as Backup;
}

/** Uploads and commits a backup the way the app does. */
async function importBackup(backup: Backup, counts?: Partial<Record<BackupTable, number>>, as = ALEX) {
  const start = await api<{ importId: string }>('POST', '/import/start', undefined, as);
  if (start.status !== 201) return start;
  const { importId } = start.body;
  for (const t of BACKUP_TABLES) {
    const chunks = chunkRows(backup.tables[t], 2000);
    for (let i = 0; i < chunks.length; i++) {
      const r = await rawPut(`/import/${importId}/${t}/${i}`, chunks[i]!, as);
      expect(r.status).toBe(204);
    }
  }
  const all = Object.fromEntries(BACKUP_TABLES.map((t) => [t, backup.tables[t].length]));
  return api(
    'POST',
    '/import',
    {
      importId,
      confirm: 'REPLACE',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      counts: { ...all, ...counts },
    },
    as,
  );
}

async function rawPut(path: string, body: string, as = ALEX) {
  const { createApp } = await import('../../src/worker/app');
  const { devEnv } = await import('./helpers');
  return createApp().request(
    `http://localhost/api${path}`,
    { method: 'PUT', headers: { 'x-dev-user-email': as, 'content-type': 'application/json' }, body },
    devEnv(),
  );
}

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe('GET /api/backup (W)', () => {
  it('is refused for Read only users', async () => {
    expect((await api('GET', '/backup', undefined, READER)).status).toBe(403);
    expect((await api('GET', '/backup?part=entries', undefined, READER)).status).toBe(403);
  });

  it('pages entries, including deleted ones, with every column', async () => {
    const made = await addEntries(3);
    await api('DELETE', `/entries/${made[1]}`);
    const backup = await downloadBackup(JAMIE);
    const byId = new Map(backup.tables.entries.map((e) => [e.id, e]));
    expect(byId.get(made[1]!)?.deleted_at).toBeTruthy(); // FR-ENTRY AC3: soft-deleted rows are kept
    expect(byId.get(made[0]!)?.note).toBe('Ñandú – “quotes”, commas, and\nnew lines');
    expect(JSON.parse(byId.get(made[2]!)!.values)).toEqual({ amount: 102 });
    // Columns match the database exactly, so a schema change can't silently drop data from backups.
    for (const t of BACKUP_TABLES) {
      const cols = (await env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map(
        (c) => c.name,
      );
      const rows = backup.tables[t] as Record<string, unknown>[];
      if (rows.length) expect(Object.keys(rows[0]!).sort()).toEqual(cols.sort());
    }
  });

  it('follows the cursor across pages', async () => {
    // Enough rows for several pages, inserted directly (ids sort after the API's ULIDs).
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO entries (id, child_id, activity_type_id, start_utc, tz, local_date, created_by, updated_by, created_at, updated_at)
       SELECT printf('ZZPAGE%05d', i), ?2, ?3, '2026-09-02T08:00:00.000Z', 'Europe/London', '2026-09-02', ?4, ?4, 'x', 'x' FROM n`,
    )
      .bind(BACKUP_ENTRIES_PAGE * 2 + 7, ids.sam, ids.type.Bath, ids.user[ALEX])
      .run();
    const all = await downloadBackup();
    expect(all.tables.entries).toHaveLength(await count('entries'));
    expect(new Set(all.tables.entries.map((e) => e.id)).size).toBe(all.tables.entries.length);
    await env.DB.prepare("DELETE FROM entries WHERE id LIKE 'ZZPAGE%'").run();

    const first = await api<{ rows: { id: string }[]; next: string | null }>('GET', '/backup?part=entries');
    const n = await count('entries');
    if (n > BACKUP_ENTRIES_PAGE) expect(first.body.next).toBe(first.body.rows.at(-1)!.id);
    else expect(first.body.next).toBeNull();
    const after = await api<{ rows: unknown[]; next: string | null }>('GET', '/backup?part=entries&after=~');
    expect(after.body).toEqual({ rows: [], next: null });
  });

  it('has a schema version and timestamp, validates, and records last_backup_at (FR-SET-10)', async () => {
    const before = await version();
    const backup = await downloadBackup();
    expect(backup).toMatchObject({ app: 'track', schemaVersion: BACKUP_SCHEMA_VERSION });
    expect(Date.parse(backup.exportedAt)).not.toBeNaN();
    expect(BACKUP_TABLES.every((t) => Array.isArray(backup.tables[t]))).toBe(true);
    expect(backup.tables).not.toHaveProperty('sync_state');
    expect(backup.tables).not.toHaveProperty('import_staging');
    const parsed = parseBackup(backup, ALEX);
    expect(parsed.ok ? null : parsed.error).toBeNull();
    expect(await version()).toBe(before + 1);
    const boot = await api<Bootstrap>('GET', '/bootstrap', undefined, READER);
    expect(boot.body.appSettings.last_backup_at).toBe(backup.exportedAt);
  });
});

describe('GET /api/storage (A)', () => {
  it('reports the database size against the limit', async () => {
    const r = await api<StorageInfo>('GET', '/storage');
    expect(r.status).toBe(200);
    expect(r.body.bytes).toBeGreaterThan(0);
    expect(r.body.limitBytes).toBe(500 * 1024 * 1024);
    expect(r.body.warningRatio).toBe(0.8);
  });

  it('is Admin only', async () => {
    expect((await api('GET', '/storage', undefined, JAMIE)).status).toBe(403);
  });
});

describe('import (A)', () => {
  it('is Admin only', async () => {
    expect((await api('POST', '/import/start', undefined, JAMIE)).status).toBe(403);
    expect((await rawPut(`/import/${newId()}/users/0`, '[]', JAMIE)).status).toBe(403);
    expect((await api('POST', '/import', {}, JAMIE)).status).toBe(403);
  });

  it('round-trips a backup: everything replaced, version bumped (FR-SET-11)', async () => {
    await addEntries(2);
    const backup = await downloadBackup();
    // Changes after the backup disappear on import.
    const later = await addEntries(1);
    await api('POST', '/children', { firstName: 'Later' });
    const before = await version();

    const r = await importBackup(backup);
    expect(r.status).toBe(200);
    expect(await version()).toBeGreaterThan(before);
    expect(await count('import_staging')).toBe(0);

    const again = await downloadBackup();
    for (const t of BACKUP_TABLES) {
      if (t === 'app_settings') continue; // last_backup_at moves on
      const sort = (rows: unknown[]) => [...rows].map((x) => JSON.stringify(x)).sort();
      expect(sort(again.tables[t]), t).toEqual(sort(backup.tables[t]));
    }
    expect(again.tables.entries.some((e) => e.id === later[0])).toBe(false);
    expect(again.tables.children.some((c) => c.first_name === 'Later')).toBe(false);
  });

  it('requires typing REPLACE', async () => {
    const r = await api('POST', '/import', {
      importId: newId(),
      confirm: 'replace',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, 0])),
    });
    expect(r.status).toBe(400);
  });

  it("refuses an import that would remove the importer's Admin role, changing nothing (AC5)", async () => {
    const backup = await downloadBackup();
    const tables = {
      ...backup.tables,
      users: backup.tables.users.map((u) => (u.email === ALEX ? { ...u, role: 'writer' as const } : u)),
    };
    const entriesBefore = await count('entries');
    const r = await importBackup({ ...backup, tables });
    expect(r.status).toBe(400);
    expect(r.body.error?.message).toMatch(/locked out/);
    expect(await count('entries')).toBe(entriesBefore);
  });

  it('refuses when a chunk is missing, changing nothing (AC4)', async () => {
    const backup = await downloadBackup();
    const r = await importBackup(backup, { entries: backup.tables.entries.length + 1 });
    expect(r.status).toBe(400);
    expect(r.body.error?.message).toMatch(/didn't upload/);
  });

  it('rolls everything back when the data breaks a constraint (AC3, AC4)', async () => {
    const backup = await downloadBackup();
    const entriesBefore = await count('entries');
    const childrenBefore = await count('children');
    const broken = {
      ...backup,
      tables: {
        ...backup.tables,
        children: [], // entries now point at a missing child
        child_activity_settings: [],
        schedule_items: [],
        schedule_overrides: [],
        medicines: [],
      },
    };
    const r = await importBackup(broken);
    expect(r.status).toBe(400);
    expect(r.body.error?.message).toMatch(/doesn't fit together|didn't import/);
    expect(await count('entries')).toBe(entriesBefore);
    expect(await count('children')).toBe(childrenBefore);
  });

  it('refuses a chunk that is not a JSON array', async () => {
    const start = await api<{ importId: string }>('POST', '/import/start');
    const id = start.body.importId;
    expect((await rawPut(`/import/${id}/users/0`, '{"a":1}')).status).toBe(400);
    expect((await rawPut(`/import/${id}/users/0`, 'not json')).status).toBe(400);
    expect((await rawPut(`/import/${id}/sync_state/0`, '[]')).status).toBe(400);
    expect((await rawPut(`/import/nope/users/0`, '[]')).status).toBe(400);
    expect((await rawPut(`/import/${id}/users/0`, `[${'"é",'.repeat(700_000)}"x"]`)).status).toBe(413);
  });

  it('refuses a newer schema version', async () => {
    const r = await api('POST', '/import', {
      importId: newId(),
      confirm: 'REPLACE',
      schemaVersion: BACKUP_SCHEMA_VERSION + 1,
      counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, 0])),
    });
    expect(r.status).toBe(400);
  });
});
