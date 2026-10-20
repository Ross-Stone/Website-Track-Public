// JSON backup format, validation and upgrades (FR-SET-10, FR-SET-11, NFR-07).
//
// A backup holds every table's rows as stored, with snake_case column names, booleans as 0/1 and JSON
// columns as JSON text. The browser validates and upgrades a file before uploading it (agreed Q9);
// the Worker's import then relies on the database's own constraints as a backstop.
import { z } from 'zod';
import { ACTIVITY_ICONS, PALETTE, PICKER_SETS } from './constants';
import { daysBetween, isValidTimeZone, localDateOf } from './time';

/** Bump when the backup's shape changes, and add an upgrade step to UPGRADES. */
export const BACKUP_SCHEMA_VERSION = 1;

/** Tables in a backup, parents before children (the order an import inserts them). */
export const BACKUP_TABLES = [
  'users',
  'children',
  'activity_types',
  'activity_fields',
  'child_activity_settings',
  'schedule_items',
  'schedule_overrides',
  'medicines',
  'entries',
  'app_settings',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Entries per page of GET /api/backup?part=entries. Kept well under D1's 2 MB value limit. */
export const BACKUP_ENTRIES_PAGE = 500;

/** Largest import chunk the client sends, in bytes of JSON (D1 values are limited to 2 MB). */
export const IMPORT_CHUNK_BYTES = 1_000_000;
/** The Worker refuses chunks larger than this. */
export const IMPORT_CHUNK_MAX_BYTES = 1_800_000;

// ---------- row schemas ----------

const id = z.string().min(1).max(64);
const text = z.string();
const timestamp = z.string().min(1).max(40);
const nullableText = z.string().nullable();
const bool = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));
const int = z.number().int();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time (HH:MM)');
const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be a date and time');

/** A JSON column: JSON text, or (leniently) the value itself, stored as text. */
function jsonText(kind: 'object' | 'array' | 'any') {
  return z
    .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .transform((v, ctx) => {
      let value: unknown = v;
      if (typeof v === 'string') {
        try {
          value = JSON.parse(v);
        } catch {
          ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
          return z.NEVER;
        }
      }
      const isArray = Array.isArray(value);
      const isObject = typeof value === 'object' && value !== null && !isArray;
      if ((kind === 'object' && !isObject) || (kind === 'array' && !isArray)) {
        ctx.addIssue({ code: 'custom', message: `must be a JSON ${kind}` });
        return z.NEVER;
      }
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
}

const timestamps = { created_at: timestamp, updated_at: timestamp };

export const BackupRows = {
  users: z.object({
    id,
    email: z
      .string()
      .min(3)
      .max(254)
      .refine((e) => e === e.toLowerCase() && e.includes('@'), 'must be a lowercase email address'),
    display_name: z.string().min(1).max(60),
    role: z.enum(['admin', 'writer', 'reader']),
    active: bool,
    ...timestamps,
  }),
  children: z.object({
    id,
    first_name: z.string().min(1).max(60),
    sort_order: int,
    archived_at: nullableText,
    ...timestamps,
  }),
  activity_types: z.object({
    id,
    system_key: z.enum(['overnight_sleep', 'medication', 'weight', 'height', 'poo', 'accident']).nullable(),
    name: z.string().min(1).max(60),
    kind: z.enum(['point', 'duration']),
    icon: z.enum(ACTIVITY_ICONS),
    colour: z.enum(PALETTE),
    sort_order: int,
    archived_at: nullableText,
    ...timestamps,
  }),
  activity_fields: z.object({
    id,
    activity_type_id: id,
    key: z.string().min(1).max(60),
    label: z.string().min(1).max(60),
    field_type: z.enum(['number', 'text', 'list', 'boolean', 'image_picker']),
    unit: nullableText,
    decimals: int.nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    max_length: int.nullable(),
    options: jsonText('array').nullable(),
    picker_set: z.enum(Object.keys(PICKER_SETS) as [keyof typeof PICKER_SETS]).nullable(),
    show_when: jsonText('object').nullable(),
    required: bool,
    sort_order: int,
    archived_at: nullableText,
    ...timestamps,
  }),
  child_activity_settings: z.object({
    child_id: id,
    activity_type_id: id,
    enabled: bool,
    quick_log: bool,
    defaults: jsonText('object'),
    window_before_min: int.min(0),
    window_after_min: int.min(0),
    ...timestamps,
  }),
  schedule_items: z.object({
    id,
    child_id: id,
    activity_type_id: id,
    label: nullableText,
    start_time: hhmm,
    end_time: hhmm.nullable(),
    days_mask: int.min(1).max(127),
    repeat: z.enum(['weekly', 'fortnightly']),
    anchor_date: date.nullable(),
    valid_from: date.nullable(),
    valid_until: date.nullable(),
    auto_confirm: bool,
    note: nullableText,
    archived_at: nullableText,
    ...timestamps,
  }),
  schedule_overrides: z.object({
    id,
    child_id: id,
    schedule_item_id: id,
    local_date: date,
    action: z.enum(['skip', 'move']),
    new_start_time: hhmm.nullable(),
    new_end_time: hhmm.nullable(),
    created_by: id,
    ...timestamps,
  }),
  medicines: z.object({
    id,
    child_id: id,
    name: z.string().min(1).max(60),
    dose: z.number(),
    dose_unit: z.string().min(1).max(20),
    min_gap_min: int.min(0),
    max_per_24h: int.min(0),
    counts_towards_alternating: bool,
    sort_order: int,
    archived_at: nullableText,
    ...timestamps,
  }),
  entries: z.object({
    id,
    child_id: id,
    activity_type_id: id,
    start_utc: iso,
    end_utc: iso.nullable(),
    tz: z.string().refine(isValidTimeZone, 'must be a time zone'),
    local_date: date,
    values: jsonText('object'),
    medicine_id: id.nullable(),
    dose: z.number().nullable(),
    dose_unit: nullableText,
    note: nullableText,
    schedule_item_id: id.nullable(),
    auto_confirmed: bool,
    created_by: id,
    updated_by: id,
    deleted_at: nullableText,
    deleted_by: id.nullable(),
    ...timestamps,
  }),
  app_settings: z.object({ key: z.string().min(1).max(100), value: text, ...timestamps }),
} satisfies Record<BackupTable, z.ZodType>;

export type BackupRow<T extends BackupTable> = z.output<(typeof BackupRows)[T]>;
export type BackupTables = { [T in BackupTable]: BackupRow<T>[] };

export interface Backup {
  app: 'track';
  schemaVersion: number;
  exportedAt: string;
  tables: BackupTables;
}

// ---------- integrity rules ----------

type Ref = [table: BackupTable, column: string, parent: BackupTable, parentColumn?: string];
const REFERENCES: Ref[] = [
  ['activity_fields', 'activity_type_id', 'activity_types'],
  ['child_activity_settings', 'child_id', 'children'],
  ['child_activity_settings', 'activity_type_id', 'activity_types'],
  ['schedule_items', 'child_id', 'children'],
  ['schedule_items', 'activity_type_id', 'activity_types'],
  ['schedule_overrides', 'child_id', 'children'],
  ['schedule_overrides', 'schedule_item_id', 'schedule_items'],
  ['schedule_overrides', 'created_by', 'users'],
  ['medicines', 'child_id', 'children'],
  ['entries', 'child_id', 'children'],
  ['entries', 'activity_type_id', 'activity_types'],
  ['entries', 'medicine_id', 'medicines'],
  ['entries', 'schedule_item_id', 'schedule_items'],
  ['entries', 'created_by', 'users'],
  ['entries', 'updated_by', 'users'],
  ['entries', 'deleted_by', 'users'],
];

/** Column sets that must be unique, mirroring the database's keys and unique indexes. */
const UNIQUE: [BackupTable, string[], ((row: Record<string, unknown>) => boolean)?][] = [
  ['users', ['id']],
  ['users', ['email']],
  ['children', ['id']],
  ['activity_types', ['id']],
  ['activity_types', ['system_key'], (r) => r.system_key !== null],
  ['activity_fields', ['id']],
  ['activity_fields', ['activity_type_id', 'key']],
  ['child_activity_settings', ['child_id', 'activity_type_id']],
  ['schedule_items', ['id']],
  ['schedule_overrides', ['id']],
  ['schedule_overrides', ['schedule_item_id', 'local_date']],
  ['medicines', ['id']],
  ['entries', ['id']],
  ['entries', ['schedule_item_id', 'local_date'], (r) => r.auto_confirmed === 1],
  ['app_settings', ['key']],
];

// ---------- upgrades ----------

/**
 * Upgrade steps: UPGRADES[n] turns a version n backup's tables into version n + 1 (FR-SET-11 AC2).
 * Empty while the format is at version 1.
 */
export const UPGRADES: Record<number, (tables: Record<string, unknown>) => Record<string, unknown>> = {};

const Envelope = z.object({
  app: z.literal('track', { message: "This isn't a Track backup." }),
  schemaVersion: z.number().int().min(1),
  exportedAt: iso,
  tables: z.record(z.string(), z.unknown()),
});

export type ParseResult =
  { ok: true; backup: Backup; counts: Record<BackupTable, number> } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

/**
 * Validates a parsed backup file for import by `importerEmail` (FR-SET-11). Upgrades older versions,
 * refuses newer ones, checks every row, references and unique keys, and that the importer stays an
 * active Admin (AC5). Pure: no I/O.
 */
export function parseBackup(
  raw: unknown,
  importerEmail: string,
  upgrades: typeof UPGRADES = UPGRADES,
  current: number = BACKUP_SCHEMA_VERSION,
): ParseResult {
  const env = Envelope.safeParse(raw);
  if (!env.success) {
    const app = (raw as { app?: unknown } | null)?.app;
    return fail(
      app !== 'track'
        ? "This file isn't a Track backup."
        : `This backup file is damaged (${env.error.issues[0]?.path.join('.') || 'format'}).`,
    );
  }
  const { schemaVersion, exportedAt } = env.data;
  if (schemaVersion > current) {
    return fail('This backup is from a newer version of Track. Update the app, then try again.');
  }
  let tables = env.data.tables;
  for (let v = schemaVersion; v < current; v++) {
    const step = upgrades[v];
    if (!step) return fail(`Backups from version ${v} can't be upgraded.`);
    tables = step(tables);
  }

  const out = {} as BackupTables;
  for (const table of BACKUP_TABLES) {
    const rows = tables[table];
    if (!Array.isArray(rows)) return fail(`This backup is missing the ${label(table)} table.`);
    const schema = BackupRows[table];
    const parsed: unknown[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = schema.safeParse(rows[i]);
      if (!r.success) {
        const issue = r.error.issues[0]!;
        return fail(`${cap(label(table))}, row ${i + 1}: ${issue.path.join('.') || 'row'} ${issue.message}.`);
      }
      parsed.push(r.data);
    }
    (out as Record<string, unknown[]>)[table] = parsed;
  }

  for (const [table, cols, when] of UNIQUE) {
    const seen = new Set<string>();
    const rows = out[table] as Record<string, unknown>[];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (when && !when(row)) continue;
      const key = JSON.stringify(cols.map((c) => row[c]));
      if (seen.has(key)) {
        return fail(`${cap(label(table))}, row ${i + 1}: ${cols.join(' and ')} appears more than once.`);
      }
      seen.add(key);
    }
  }

  for (const [table, col, parent, parentCol = 'id'] of REFERENCES) {
    const ids = new Set((out[parent] as Record<string, unknown>[]).map((r) => r[parentCol]));
    const rows = out[table] as Record<string, unknown>[];
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i]![col];
      if (v !== null && !ids.has(v)) {
        return fail(`${cap(label(table))}, row ${i + 1}: ${col} doesn't match any ${label(parent)}.`);
      }
    }
  }

  const me = importerEmail.toLowerCase();
  if (!out.users.some((u) => u.email === me && u.role === 'admin' && u.active === 1)) {
    return fail(
      `This backup doesn't include ${me} as an active Admin, so importing it would lock you out. Nothing was changed.`,
    );
  }

  const counts = Object.fromEntries(BACKUP_TABLES.map((t) => [t, out[t].length])) as Record<
    BackupTable,
    number
  >;
  return { ok: true, backup: { app: 'track', schemaVersion: current, exportedAt, tables: out }, counts };
}

/**
 * Splits rows into JSON array texts of at most `maxBytes` (UTF-8) each, for upload. A single row larger
 * than the limit goes in a chunk of its own.
 */
export function chunkRows(rows: readonly unknown[], maxBytes: number = IMPORT_CHUNK_BYTES): string[] {
  const enc = new TextEncoder();
  const chunks: string[] = [];
  let parts: string[] = [];
  let size = 2; // the brackets
  for (const row of rows) {
    const json = JSON.stringify(row);
    const bytes = enc.encode(json).length + 1; // and a comma
    if (parts.length && size + bytes > maxBytes) {
      chunks.push(`[${parts.join(',')}]`);
      parts = [];
      size = 2;
    }
    parts.push(json);
    size += bytes;
  }
  if (parts.length) chunks.push(`[${parts.join(',')}]`);
  return chunks;
}

export function backupFileName(localDate: string): string {
  return `track-backup-${localDate}.json`;
}

/** "Last backup: …" text for Settings (FR-SET-10 AC3). Days are counted between local dates. */
export function lastBackupLabel(lastBackupAt: string | undefined, today: string, tz: string): string {
  if (!lastBackupAt || Number.isNaN(Date.parse(lastBackupAt))) return 'Last backup: Never';
  const days = daysBetween(localDateOf(new Date(lastBackupAt), tz), today);
  if (days <= 0) return 'Last backup: today';
  return `Last backup: ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function label(table: BackupTable): string {
  return table.replace(/_/g, ' ');
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
