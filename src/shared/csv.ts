// CSV export flattening (FR-HIST-04, TECH-12). Pure: the caller supplies entries and lookups.
import type { ActivityField, ActivityType, Child, Entry, FieldValue, Medicine, User } from './domain';
import { formatDateUK, localDateOf, localTimeOf, minutesBetween } from './time';

export interface CsvInput {
  entries: Entry[];
  children: Child[];
  activityTypes: ActivityType[];
  fields: ActivityField[];
  medicines: Medicine[];
  users: Pick<User, 'id' | 'displayName'>[];
}

const BOM = '﻿';
const EN_DASH = '–';

const FIXED_HEAD = [
  'Child',
  'Date',
  'Start time',
  'End time',
  'Duration (minutes)',
  'Time zone',
  'Activity',
  'Medicine',
  'Dose',
  'Dose unit',
];
const FIXED_TAIL = ['Note', 'Logged by', 'Logged at', 'Last edited by', 'Last edited at', 'Auto'];

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection for text cells. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Column header for a field: "Activity – Field (unit)". */
export function fieldHeader(type: ActivityType, field: ActivityField): string {
  return `${type.name} ${EN_DASH} ${field.label}${field.unit ? ` (${field.unit})` : ''}`;
}

function formatFieldValue(field: ActivityField, value: FieldValue | undefined): string {
  if (value === undefined || value === '') return '';
  if (field.fieldType === 'boolean') return value === true ? 'Yes' : value === false ? 'No' : String(value);
  if (field.fieldType === 'number' && typeof value === 'number' && field.decimals !== null) {
    return value.toFixed(field.decimals);
  }
  return String(value);
}

function stamp(iso: string, tz: string): string {
  return `${formatDateUK(localDateOf(iso, tz))} ${localTimeOf(iso, tz)}`;
}

/**
 * One row per non-deleted entry, sorted by child, local date and start. Field columns appear only for
 * fields that have a value in at least one exported entry (archived fields included), ordered by
 * activity type then field. Times show in each entry's own time zone. UTF-8 with BOM and CRLF, so it
 * opens correctly in Excel and Google Sheets.
 */
export function buildCsv(input: CsvInput): string {
  const types = new Map(input.activityTypes.map((t) => [t.id, t]));
  const children = new Map(input.children.map((c) => [c.id, c]));
  const medicines = new Map(input.medicines.map((m) => [m.id, m]));
  const users = new Map(input.users.map((u) => [u.id, u.displayName]));

  const entries = input.entries
    .filter((e) => !e.deletedAt)
    .sort((a, b) => {
      const ca = children.get(a.childId);
      const cb = children.get(b.childId);
      return (
        (ca?.sortOrder ?? 0) - (cb?.sortOrder ?? 0) ||
        a.childId.localeCompare(b.childId) ||
        a.localDate.localeCompare(b.localDate) ||
        a.startUtc.localeCompare(b.startUtc) ||
        a.id.localeCompare(b.id)
      );
    });

  const present = input.fields
    .filter((f) =>
      entries.some(
        (e) =>
          e.activityTypeId === f.activityTypeId && e.values[f.key] !== undefined && e.values[f.key] !== '',
      ),
    )
    .sort((a, b) => {
      const ta = types.get(a.activityTypeId);
      const tb = types.get(b.activityTypeId);
      return (
        (ta?.sortOrder ?? 0) - (tb?.sortOrder ?? 0) ||
        a.activityTypeId.localeCompare(b.activityTypeId) ||
        a.sortOrder - b.sortOrder
      );
    });

  const header = [
    ...FIXED_HEAD,
    ...present.map((f) => {
      const t = types.get(f.activityTypeId);
      return t ? fieldHeader(t, f) : f.label;
    }),
    ...FIXED_TAIL,
  ];

  const rows = entries.map((e) => {
    const type = types.get(e.activityTypeId);
    const med = e.medicineId ? medicines.get(e.medicineId) : undefined;
    const edited = e.updatedAt !== e.createdAt || e.updatedBy !== e.createdBy;
    return [
      children.get(e.childId)?.firstName ?? '',
      formatDateUK(e.localDate),
      localTimeOf(e.startUtc, e.tz),
      e.endUtc ? localTimeOf(e.endUtc, e.tz) : '',
      e.endUtc ? minutesBetween(e.startUtc, e.endUtc) : '',
      e.tz,
      type?.name ?? '',
      med?.name ?? '',
      e.dose ?? '',
      e.doseUnit ?? '',
      ...present.map((f) =>
        f.activityTypeId === e.activityTypeId ? formatFieldValue(f, e.values[f.key]) : '',
      ),
      e.note ?? '',
      users.get(e.createdBy) ?? '',
      stamp(e.createdAt, e.tz),
      edited ? (users.get(e.updatedBy) ?? '') : '',
      edited ? stamp(e.updatedAt, e.tz) : '',
      e.autoConfirmed ? 'Yes' : 'No',
    ];
  });

  return BOM + [header, ...rows].map((r) => r.map((c) => csvCell(c)).join(',')).join('\r\n') + '\r\n';
}

/** `track-export-YYYY-MM-DD-to-YYYY-MM-DD.csv` (FR-HIST-04 AC3). */
export function csvFileName(from: string, to: string): string {
  return `track-export-${from}-to-${to}.csv`;
}
