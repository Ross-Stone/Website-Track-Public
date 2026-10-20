import { describe, expect, it } from 'vitest';
import {
  BACKUP_SCHEMA_VERSION,
  backupFileName,
  chunkRows,
  lastBackupLabel,
  parseBackup,
} from '../../src/shared/backup';

const ts = { created_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-01T09:00:00.000Z' };
const ME = 'alex@example.com';

function sample() {
  return {
    app: 'track',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-10-18T10:00:00.000Z',
    tables: {
      users: [
        { id: 'U1', email: ME, display_name: 'Alex', role: 'admin', active: 1, ...ts },
        { id: 'U2', email: 'jamie@example.com', display_name: 'Jamie', role: 'writer', active: 1, ...ts },
      ],
      children: [{ id: 'C1', first_name: 'Sam', sort_order: 0, archived_at: null, ...ts }],
      activity_types: [
        {
          id: 'T1',
          system_key: null,
          name: 'Formula',
          kind: 'point',
          icon: 'milk',
          colour: 'blue',
          sort_order: 0,
          archived_at: null,
          ...ts,
        },
      ],
      activity_fields: [
        {
          id: 'F1',
          activity_type_id: 'T1',
          key: 'amount',
          label: 'Amount',
          field_type: 'number',
          unit: 'ml',
          decimals: 0,
          min: 0,
          max: 500,
          max_length: null,
          options: null,
          picker_set: null,
          show_when: null,
          required: 0,
          sort_order: 0,
          archived_at: null,
          ...ts,
        },
      ],
      child_activity_settings: [
        {
          child_id: 'C1',
          activity_type_id: 'T1',
          enabled: 1,
          quick_log: 1,
          defaults: '{"amount":230}',
          window_before_min: 120,
          window_after_min: 120,
          ...ts,
        },
      ],
      schedule_items: [
        {
          id: 'S1',
          child_id: 'C1',
          activity_type_id: 'T1',
          label: null,
          start_time: '07:00',
          end_time: null,
          days_mask: 127,
          repeat: 'weekly',
          anchor_date: null,
          valid_from: null,
          valid_until: null,
          auto_confirm: 0,
          note: null,
          archived_at: null,
          ...ts,
        },
      ],
      schedule_overrides: [
        {
          id: 'O1',
          child_id: 'C1',
          schedule_item_id: 'S1',
          local_date: '2026-10-18',
          action: 'skip',
          new_start_time: null,
          new_end_time: null,
          created_by: 'U2',
          ...ts,
        },
      ],
      medicines: [],
      entries: [
        {
          id: 'E1',
          child_id: 'C1',
          activity_type_id: 'T1',
          start_utc: '2026-10-18T06:58:00.000Z',
          end_utc: null,
          tz: 'Europe/London',
          local_date: '2026-10-18',
          values: '{"amount":230}',
          medicine_id: null,
          dose: null,
          dose_unit: null,
          note: 'Ñandú',
          schedule_item_id: 'S1',
          auto_confirmed: 0,
          created_by: 'U1',
          updated_by: 'U2',
          deleted_at: null,
          deleted_by: null,
          ...ts,
        },
      ],
      app_settings: [{ key: 'last_backup_at', value: '2026-10-18T10:00:00.000Z', ...ts }],
    },
  };
}

const errorOf = (raw: unknown, email = ME) => {
  const r = parseBackup(raw, email);
  return r.ok ? null : r.error;
};

describe('parseBackup (FR-SET-11)', () => {
  it('accepts a valid backup and counts rows per table', () => {
    const r = parseBackup(sample(), 'Alex@Example.com');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts).toMatchObject({ users: 2, entries: 1, medicines: 0 });
    expect(r.backup.tables.entries[0]!.note).toBe('Ñandú');
  });

  it('normalises booleans and JSON objects given as values', () => {
    const b = sample();
    (b.tables.users[0] as Record<string, unknown>).active = true;
    (b.tables.entries[0] as Record<string, unknown>).values = { amount: 230 };
    const r = parseBackup(b, ME);
    expect(r.ok && r.backup.tables.users[0]!.active).toBe(1);
    expect(r.ok && r.backup.tables.entries[0]!.values).toBe('{"amount":230}');
  });

  it('rejects files that are not Track backups (AC3)', () => {
    expect(errorOf(null)).toMatch(/isn't a Track backup/);
    expect(errorOf({ hello: 1 })).toMatch(/isn't a Track backup/);
    expect(errorOf({ ...sample(), exportedAt: 'soon' })).toMatch(/damaged/);
  });

  it('rejects a newer schema version (AC2)', () => {
    expect(errorOf({ ...sample(), schemaVersion: BACKUP_SCHEMA_VERSION + 1 })).toMatch(/newer version/);
  });

  it('upgrades an older version step by step (AC2)', () => {
    const old = { ...sample(), schemaVersion: 1 };
    const r = parseBackup(
      old,
      ME,
      {
        1: (t) => ({
          ...t,
          children: (t.children as object[]).map((c) => ({ ...c, first_name: 'Renamed' })),
        }),
      },
      2,
    );
    expect(r.ok && r.backup.schemaVersion).toBe(2);
    expect(r.ok && r.backup.tables.children[0]!.first_name).toBe('Renamed');
    expect(errorOf({ ...sample(), schemaVersion: 0 })).toMatch(/damaged/);
    const missing = parseBackup(old, ME, {}, 3);
    expect(missing.ok ? null : missing.error).toMatch(/can't be upgraded/);
  });

  it('reports the table, row and field of a bad value', () => {
    const b = sample();
    (b.tables.entries[0] as Record<string, unknown>).tz = 'Mars/Olympus';
    expect(errorOf(b)).toBe('Entries, row 1: tz must be a time zone.');
    const c = sample();
    (c.tables.child_activity_settings[0] as Record<string, unknown>).defaults = '[1]';
    expect(errorOf(c)).toMatch(/Child activity settings, row 1: defaults must be a JSON object/);
    const d = sample();
    (d.tables.activity_types[0] as Record<string, unknown>).colour = '#ff0000';
    expect(errorOf(d)).toMatch(/^Activity types, row 1: colour/);
  });

  it('rejects a missing table', () => {
    const b = sample() as { tables: Record<string, unknown> };
    delete b.tables.medicines;
    expect(errorOf(b)).toMatch(/missing the medicines table/);
  });

  it('rejects references to rows that are not in the backup', () => {
    const b = sample();
    (b.tables.entries[0] as Record<string, unknown>).schedule_item_id = 'S9';
    expect(errorOf(b)).toBe("Entries, row 1: schedule_item_id doesn't match any schedule items.");
    const c = sample();
    (c.tables.schedule_overrides[0] as Record<string, unknown>).created_by = 'U9';
    expect(errorOf(c)).toMatch(/created_by doesn't match any users/);
  });

  it('rejects duplicate keys', () => {
    const b = sample();
    b.tables.users.push({ ...b.tables.users[1]!, id: 'U3' });
    expect(errorOf(b)).toBe('Users, row 3: email appears more than once.');
    const c = sample();
    c.tables.entries.push({ ...c.tables.entries[0]! });
    expect(errorOf(c)).toMatch(/Entries, row 2: id appears more than once/);
  });

  it('only checks the auto-confirm key for auto-confirmed entries', () => {
    const b = sample();
    b.tables.entries.push({ ...b.tables.entries[0]!, id: 'E2' }); // same item and day, not auto
    expect(errorOf(b)).toBeNull();
    b.tables.entries.forEach((e) => (e.auto_confirmed = 1));
    expect(errorOf(b)).toMatch(/schedule_item_id and local_date appears more than once/);
  });

  it('refuses a backup that would lock the importer out (AC5)', () => {
    expect(errorOf(sample(), 'jamie@example.com')).toMatch(/jamie@example.com as an active Admin/);
    const b = sample();
    b.tables.users[0]!.active = 0;
    expect(errorOf(b)).toMatch(/lock you out/);
  });
});

describe('chunkRows', () => {
  it('splits rows into JSON arrays under the byte limit, counting UTF-8 bytes', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ i, s: 'é'.repeat(20) }));
    const chunks = chunkRows(rows, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(new TextEncoder().encode(c).length).toBeLessThanOrEqual(120);
    expect(chunks.flatMap((c) => JSON.parse(c) as unknown[])).toEqual(rows);
  });

  it('keeps an oversized row in a chunk of its own, and gives nothing for no rows', () => {
    expect(chunkRows([{ s: 'x'.repeat(50) }, { a: 1 }], 20)).toHaveLength(2);
    expect(chunkRows([])).toEqual([]);
  });
});

describe('backup labels (FR-SET-10)', () => {
  it('names the file by local date', () => {
    expect(backupFileName('2026-10-19')).toBe('track-backup-2026-10-19.json');
  });

  it('says how long ago the last backup was, by local date', () => {
    expect(lastBackupLabel(undefined, '2026-10-19', 'Europe/London')).toBe('Last backup: Never');
    expect(lastBackupLabel('2026-10-19T07:00:00Z', '2026-10-19', 'Europe/London')).toBe('Last backup: today');
    expect(lastBackupLabel('2026-10-18T22:30:00Z', '2026-10-19', 'Europe/London')).toBe(
      'Last backup: 1 day ago',
    );
    // 22:30 UTC is already the next day in Madrid.
    expect(lastBackupLabel('2026-10-18T22:30:00Z', '2026-10-19', 'Europe/Madrid')).toBe('Last backup: today');
    expect(lastBackupLabel('2026-10-07T12:00:00Z', '2026-10-19', 'Europe/London')).toBe(
      'Last backup: 12 days ago',
    );
  });
});
