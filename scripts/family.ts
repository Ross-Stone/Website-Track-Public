// Builds SQL that adds users, children and their settings (and, optionally, entries) on top of the seed
// migration. Used for the Worker and end-to-end test fixture (scripts/fixtures.ts) and the demo data
// (scripts/seed-demo.ts). Never used for a deployed database: there, the Admin sets everything up in the app.
//
// Activity types are looked up by name, so this works on any database that has the seed migration.
import { ulid } from 'ulid';
import type { Role } from '../src/shared/constants';
import { DEFAULT_WINDOW_MIN } from '../src/shared/constants';
import { localDateOf } from '../src/shared/time';
import { insert, lit, prng, RawSql } from './sql';

export interface FamilyChild {
  ref: string;
  firstName: string;
  /** Activity type names shown as quick log favourites. */
  favourites?: string[];
  /** Default field values, by activity type name. */
  defaults?: Record<string, Record<string, unknown>>;
  schedule?: { ref?: string; type: string; start: string; end?: string; daysMask: number }[];
  medicines?: {
    name: string;
    dose: number;
    doseUnit: string;
    minGapMin: number;
    maxPer24h: number;
    alternating: boolean;
  }[];
}

export interface FamilyEntry {
  child: string;
  type: string;
  start: Date;
  /** Omit for a point activity; null for a running duration entry. */
  end?: Date | null;
  values?: Record<string, unknown>;
  medicine?: string;
  note?: string;
  /** Ref of the schedule item it confirms. */
  scheduleItem?: string;
  by: string;
}

export interface Family {
  /** Seeds the ID generator, so the same family always gets the same IDs. */
  seed: number;
  at: string;
  tz?: string;
  users: { ref: string; email: string; displayName: string; role: Role }[];
  children: FamilyChild[];
  entries?: FamilyEntry[];
}

const typeId = (name: string) => new RawSql(`(SELECT id FROM activity_types WHERE name = ${lit(name)})`);

/** One SQL statement per element. */
export function buildFamilyStatements(family: Family): string[] {
  const rand = prng(family.seed);
  const time = Date.parse(family.at);
  const id = () => ulid(time, rand);
  const ts = { created_at: family.at, updated_at: family.at };
  const tz = family.tz ?? 'Europe/London';
  const out: string[] = [];

  const userIds = new Map<string, string>();
  for (const u of family.users) {
    const uid = id();
    userIds.set(u.ref, uid);
    out.push(
      insert('users', {
        id: uid,
        email: u.email.toLowerCase(),
        display_name: u.displayName,
        role: u.role,
        active: true,
        ...ts,
      }),
    );
  }

  const childIds = new Map<string, string>();
  const scheduleIds = new Map<string, string>();
  const medicineIds = new Map<string, string>();
  family.children.forEach((c, i) => {
    const cid = id();
    childIds.set(c.ref, cid);
    out.push(
      insert('children', { id: cid, first_name: c.firstName, sort_order: i, archived_at: null, ...ts }),
    );

    const favs = (c.favourites ?? []).map(lit).join(', ') || 'NULL';
    const defaults = Object.entries(c.defaults ?? {})
      .map(([type, d]) => ` WHEN ${lit(type)} THEN ${lit(JSON.stringify(d))}`)
      .join('');
    out.push(
      'INSERT INTO `child_activity_settings` (`child_id`, `activity_type_id`, `enabled`, `quick_log`, `defaults`, ' +
        '`window_before_min`, `window_after_min`, `created_at`, `updated_at`) ' +
        `SELECT ${lit(cid)}, id, 1, CASE WHEN name IN (${favs}) THEN 1 ELSE 0 END, ` +
        `${defaults ? `CASE name${defaults} ELSE '{}' END` : "'{}'"}, ` +
        `${DEFAULT_WINDOW_MIN}, ${DEFAULT_WINDOW_MIN}, ${lit(family.at)}, ${lit(family.at)} FROM activity_types;`,
    );

    for (const s of c.schedule ?? []) {
      const sid = id();
      if (s.ref) scheduleIds.set(s.ref, sid);
      out.push(
        insert('schedule_items', {
          id: sid,
          child_id: cid,
          activity_type_id: typeId(s.type),
          label: null,
          start_time: s.start,
          end_time: s.end ?? null,
          days_mask: s.daysMask,
          repeat: 'weekly',
          anchor_date: null,
          valid_from: null,
          valid_until: null,
          auto_confirm: false,
          note: null,
          archived_at: null,
          ...ts,
        }),
      );
    }

    (c.medicines ?? []).forEach((m, j) => {
      const mid = id();
      medicineIds.set(m.name, mid);
      out.push(
        insert('medicines', {
          id: mid,
          child_id: cid,
          name: m.name,
          dose: m.dose,
          dose_unit: m.doseUnit,
          min_gap_min: m.minGapMin,
          max_per_24h: m.maxPer24h,
          counts_towards_alternating: m.alternating,
          sort_order: j,
          archived_at: null,
          ...ts,
        }),
      );
    });
  });

  for (const e of family.entries ?? []) {
    const child = family.children.find((c) => c.ref === e.child)!;
    const med = e.medicine ? child.medicines?.find((m) => m.name === e.medicine) : undefined;
    const by = userIds.get(e.by)!;
    const at = e.start.toISOString();
    out.push(
      insert('entries', {
        id: ulid(e.start.getTime(), rand),
        child_id: childIds.get(e.child)!,
        activity_type_id: typeId(e.type),
        start_utc: at,
        end_utc: e.end === undefined || e.end === null ? null : e.end.toISOString(),
        tz,
        local_date: localDateOf(e.start, tz),
        values: JSON.stringify(e.values ?? {}),
        medicine_id: med ? medicineIds.get(med.name)! : null,
        dose: med?.dose ?? null,
        dose_unit: med?.doseUnit ?? null,
        note: e.note ?? null,
        schedule_item_id: e.scheduleItem ? scheduleIds.get(e.scheduleItem)! : null,
        auto_confirmed: false,
        created_by: by,
        updated_by: by,
        deleted_at: null,
        deleted_by: null,
        created_at: at,
        updated_at: at,
      }),
    );
  }

  out.push('UPDATE `sync_state` SET `version` = `version` + 1 WHERE `id` = 1;');
  return out;
}

export function buildFamilySql(family: Family): string {
  return buildFamilyStatements(family).join('\n') + '\n';
}
