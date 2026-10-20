import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { ImportCommit } from '../../shared/api';
import {
  BACKUP_ENTRIES_PAGE,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  IMPORT_CHUNK_MAX_BYTES,
  type BackupTable,
} from '../../shared/backup';
import { STORAGE_LIMIT_BYTES, STORAGE_WARNING_RATIO } from '../../shared/constants';
import { clearUserCache, requireRole } from '../auth/middleware';
import {
  activityFields,
  activityTypes,
  appSettings,
  childActivitySettings,
  children,
  entries,
  medicines,
  scheduleItems,
  scheduleOverrides,
  users,
} from '../db/schema';
import type { AppEnv } from '../env';
import { ApiException } from '../errors';
import { invalid, nowIso, parseBody, parseQuery } from '../lib/http';
import { bumpVersionStatement } from '../lib/version';

// Backup, import and storage (FR-SET-10..12). These use raw SQL because D1 itself builds the backup
// JSON and unpacks the import (agreed Q9): the Worker only passes text through, so its CPU time stays
// small however much data there is (TECH-14).

const TABLES: Record<BackupTable, SQLiteTable> = {
  users,
  children,
  activity_types: activityTypes,
  activity_fields: activityFields,
  child_activity_settings: childActivitySettings,
  schedule_items: scheduleItems,
  schedule_overrides: scheduleOverrides,
  medicines,
  entries,
  app_settings: appSettings,
};

const columns = (t: BackupTable) => getTableConfig(TABLES[t]).columns.map((c) => c.name);
const q = (name: string) => `"${name}"`;
/** json_object('col', "col", …) for every column of a table. */
const rowJson = (t: BackupTable) =>
  `json_object(${columns(t)
    .map((c) => `'${c}', ${q(c)}`)
    .join(', ')})`;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const BackupQuery = z.object({
  part: z.enum(['config', 'entries']).default('config'),
  after: z.string().max(64).default(''),
});

export const backupRoutes = new Hono<AppEnv>()
  // GET /api/backup (W). The app fetches entries page by page (part=entries&after=<last id>), then the
  // rest (part=config), which also records last_backup_at. Config comes last so it covers everything the
  // entries refer to. The app joins the parts into one file (FR-SET-10).
  .get('/backup', requireRole('writer'), async (c) => {
    const { part, after } = parseQuery(c, BackupQuery);
    const d1 = c.env.DB;
    const json = (body: string) => c.body(body, 200, { 'Content-Type': 'application/json; charset=utf-8' });

    if (part === 'entries') {
      const page = await d1
        .prepare(
          `SELECT json_group_array(json(j)) AS rows, max(id) AS last, count(*) AS n
           FROM (SELECT id, ${rowJson('entries')} AS j FROM entries WHERE id > ?1 ORDER BY id LIMIT ?2)`,
        )
        .bind(after, BACKUP_ENTRIES_PAGE)
        .first<{ rows: string; last: string | null; n: number }>();
      const next = page && page.n === BACKUP_ENTRIES_PAGE ? JSON.stringify(page.last) : 'null';
      return json(`{"rows":${page?.rows ?? '[]'},"next":${next}}`);
    }

    const now = nowIso();
    const config = BACKUP_TABLES.filter((t) => t !== 'entries');
    const results = await d1.batch([
      d1
        .prepare(
          `INSERT INTO app_settings (key, value, created_at, updated_at) VALUES ('last_backup_at', ?1, ?1, ?1)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(now),
      bumpVersionStatement(d1),
      ...config.map((t) => d1.prepare(`SELECT json_group_array(${rowJson(t)}) AS rows FROM ${q(t)}`)),
    ]);
    const tables = config
      .map((t, i) => `"${t}":${(results[i + 2]!.results[0] as { rows: string }).rows}`)
      .join(',');
    return json(
      `{"app":"track","schemaVersion":${BACKUP_SCHEMA_VERSION},"exportedAt":"${now}","tables":{${tables}}}`,
    );
  })

  // GET /api/storage (A): this database's size against the free-plan limit (FR-SET-12).
  .get('/storage', requireRole('admin'), async (c) => {
    const r = await c.env.DB.prepare('SELECT 1').run();
    return c.json({
      bytes: r.meta.size_after ?? 0,
      limitBytes: STORAGE_LIMIT_BYTES,
      warningRatio: STORAGE_WARNING_RATIO,
    });
  })

  // POST /api/import/start (A): begins an import, clearing any abandoned one (FR-SET-11, agreed Q9).
  .post('/import/start', requireRole('admin'), async (c) => {
    const d1 = c.env.DB;
    await d1.batch([d1.prepare('DELETE FROM import_staging'), bumpVersionStatement(d1)]);
    return c.json({ importId: ulid() }, 201);
  })

  // PUT /api/import/:id/:table/:seq (A): one chunk of one table's rows, as a JSON array (agreed Q9).
  // The body is stored as it is; D1 checks it's a JSON array. Repeating a chunk replaces it.
  .put('/import/:id/:table/:seq', requireRole('admin'), async (c) => {
    const { id, table, seq } = c.req.param();
    if (!ULID.test(id)) invalid('Unknown import.');
    if (!(BACKUP_TABLES as readonly string[]).includes(table)) invalid('Unknown table.');
    const n = Number(seq);
    if (!Number.isInteger(n) || n < 0 || n > 100_000) invalid('Bad chunk number.');
    // Content-Length counts bytes (D1's limit); the text length catches a missing header.
    if (Number(c.req.header('content-length') ?? 0) > IMPORT_CHUNK_MAX_BYTES) {
      throw new ApiException(413, 'validation', 'That chunk is too large.');
    }
    const body = await c.req.text();
    if (body.length > IMPORT_CHUNK_MAX_BYTES)
      throw new ApiException(413, 'validation', 'That chunk is too large.');
    const d1 = c.env.DB;
    try {
      await d1.batch([
        d1
          .prepare(
            `INSERT INTO import_staging (import_id, tbl, seq, data, created_at) VALUES (?1, ?2, ?3, json(?4), ?5)
             ON CONFLICT (import_id, tbl, seq) DO UPDATE SET data = excluded.data`,
          )
          .bind(id, table, n, body, nowIso()),
        bumpVersionStatement(d1),
      ]);
    } catch (e) {
      if (/malformed JSON|CHECK constraint/i.test(String((e as Error)?.message ?? e))) {
        invalid('That part of the backup must be a JSON array.');
      }
      throw e;
    }
    return c.body(null, 204);
  })

  // POST /api/import (A): replaces all data with the staged import in one batch, so it's all or nothing
  // (FR-SET-11 AC4). The importing Admin must still be an active Admin afterwards (AC5).
  .post('/import', requireRole('admin'), async (c) => {
    const input = await parseBody(c, ImportCommit);
    if (input.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      invalid('This backup needs upgrading first. Reload the app and try again.');
    }
    const me = c.get('user').email;
    const d1 = c.env.DB;
    const id = input.importId;

    // Friendly checks first. The guard statement in the batch below repeats them atomically.
    const [staged, admins] = await d1.batch([
      d1
        .prepare(
          'SELECT tbl, sum(json_array_length(data)) AS n FROM import_staging WHERE import_id = ?1 GROUP BY tbl',
        )
        .bind(id),
      d1
        .prepare(
          `SELECT count(*) AS n FROM import_staging s, json_each(s.data) j
           WHERE s.import_id = ?1 AND s.tbl = 'users' AND json_extract(j.value, '$.email') = ?2
             AND json_extract(j.value, '$.role') = 'admin' AND json_extract(j.value, '$.active') = 1`,
        )
        .bind(id, me),
    ]);
    const counts = new Map((staged!.results as { tbl: string; n: number }[]).map((r) => [r.tbl, r.n]));
    if (counts.size === 0) invalid("That import wasn't found. Start again.");
    if (BACKUP_TABLES.some((t) => (counts.get(t) ?? 0) !== input.counts[t])) {
      invalid("Part of the backup didn't upload. Nothing was changed. Try again.");
    }
    if ((admins!.results[0] as { n: number }).n === 0) {
      invalid(
        `The backup must include ${me} as an active Admin, or you'd be locked out. Nothing was changed.`,
      );
    }

    const insert = (t: BackupTable) => {
      const cols = columns(t);
      return d1
        .prepare(
          `INSERT INTO ${q(t)} (${cols.map(q).join(', ')})
           SELECT ${cols.map((col) => `json_extract(j.value, '$.${col}')`).join(', ')}
           FROM import_staging s, json_each(s.data) j WHERE s.import_id = ?1 AND s.tbl = ?2`,
        )
        .bind(id, t);
    };
    // Fails the whole batch unless the result is exactly what was uploaded and keeps the importer an
    // Admin: inserting id 0 into sync_state breaks its single-row CHECK, which rolls everything back.
    const guard = d1
      .prepare(
        `INSERT INTO sync_state (id, version) SELECT 0, 0 WHERE NOT (
           ${BACKUP_TABLES.map((t, i) => `(SELECT count(*) FROM ${q(t)}) = ?${i + 1}`).join(' AND ')}
           AND EXISTS (SELECT 1 FROM users WHERE email = ?${BACKUP_TABLES.length + 1} AND role = 'admin' AND active = 1)
           AND NOT EXISTS (SELECT 1 FROM entries WHERE json_type("values") IS NOT 'object')
         )`,
      )
      .bind(...BACKUP_TABLES.map((t) => input.counts[t]), me);

    try {
      await d1.batch([
        ...[...BACKUP_TABLES].reverse().map((t) => d1.prepare(`DELETE FROM ${q(t)}`)),
        ...BACKUP_TABLES.map(insert),
        guard,
        d1.prepare('DELETE FROM import_staging'),
        bumpVersionStatement(d1),
      ]);
    } catch (e) {
      const text =
        String((e as Error)?.message ?? e) + String((e as { cause?: Error })?.cause?.message ?? '');
      if (/sync_state_single_row/.test(text)) {
        invalid("The backup didn't import as expected. Nothing was changed.");
      }
      const detail = /(UNIQUE|FOREIGN KEY|CHECK|NOT NULL) constraint failed[^|]*/i.exec(text)?.[0];
      if (detail)
        invalid(`The backup has data that doesn't fit together (${detail.trim()}). Nothing was changed.`);
      throw e;
    }
    clearUserCache();
    return c.json({ counts: input.counts });
  });
