// Planned-versus-logged matching and missed items (FR-HOME-03, FR-HOME-04, agreed Q1).
import type { ChildActivitySetting, Entry, ScheduleItem, ScheduleOverride } from './domain';
import { DEFAULT_WINDOW_MIN } from './constants';
import { occurrencesOn, plannedRowsFor, type Occurrence, type PlannedRow } from './schedule';
import { addDays } from './time';

const MINUTE = 60_000;

export type RowStatus = 'done' | 'skipped' | 'missed' | 'upcoming';

export interface MatchedRow extends PlannedRow {
  status: RowStatus;
  /** The entry that satisfies this row, when done. */
  entryId: string | null;
}

export interface Window {
  beforeMin: number;
  afterMin: number;
}

export type WindowLookup = (activityTypeId: string) => Window;

/** Detection window per activity type, from the child's settings (default 120/120). */
export function windowsFromSettings(settings: ChildActivitySetting[]): WindowLookup {
  const map = new Map(
    settings.map((s) => [s.activityTypeId, { beforeMin: s.windowBeforeMin, afterMin: s.windowAfterMin }]),
  );
  return (typeId) => map.get(typeId) ?? { beforeMin: DEFAULT_WINDOW_MIN, afterMin: DEFAULT_WINDOW_MIN };
}

interface Candidate {
  row: PlannedRow;
  entry: Entry;
  distance: number;
}

/**
 * Works out which planned rows on `date` are done, skipped, missed or upcoming.
 *
 * - A "start" row is satisfied by a non-deleted entry of the same type whose start is within the
 *   type's detection window around the planned start. An "end" row (e.g. Woke up) is satisfied by an
 *   entry whose end is within the window around the planned end.
 * - Each entry satisfies at most one planned item (occurrence), matched nearest first. The same
 *   overnight entry may satisfy both the Bedtime and the Woke up rows of one occurrence.
 * - Auto-confirmed entries (and any entry carrying schedule_item_id + local_date) claim their own
 *   occurrence first.
 * - Neighbouring days' occurrences take part in matching but are not returned, so an entry at 00:30
 *   can be claimed by yesterday's 23:00 item rather than today's.
 * - Missed: planned time + "after" window has passed, with no match and no skip.
 */
export function matchPlannedRows(args: {
  items: ScheduleItem[];
  overrides: ScheduleOverride[];
  entries: Entry[];
  date: string;
  tz: string;
  now: Date;
  windows: WindowLookup;
}): MatchedRow[] {
  const { items, overrides, entries, date, tz, now, windows } = args;
  const visible = plannedRowsFor(items, overrides, date, tz);
  const visibleKeys = new Set(visible.map((r) => r.key));

  // Hidden neighbours: starts of yesterday's and tomorrow's occurrences, and ends of today's overnight items.
  const neighbours: PlannedRow[] = [];
  const startRow = (o: Occurrence): PlannedRow => ({
    key: `${o.key}:start`,
    part: 'start',
    occurrence: o,
    at: o.startUtc,
  });
  for (const d of [addDays(date, -1), addDays(date, 1)]) {
    for (const o of occurrencesOn(items, overrides, d, tz)) neighbours.push(startRow(o));
  }
  for (const o of occurrencesOn(items, overrides, date, tz)) {
    if (o.crossesMidnight && o.endUtc)
      neighbours.push({ key: `${o.key}:end`, part: 'end', occurrence: o, at: o.endUtc });
  }
  const allRows = [...visible, ...neighbours.filter((r) => !visibleKeys.has(r.key))].filter(
    (r) => !r.occurrence.skipped,
  );

  const live = entries.filter((e) => !e.deletedAt);
  const candidates: Candidate[] = [];
  for (const row of allRows) {
    const w = windows(row.occurrence.activityTypeId);
    const lo = row.at.getTime() - w.beforeMin * MINUTE;
    const hi = row.at.getTime() + w.afterMin * MINUTE;
    for (const entry of live) {
      if (entry.activityTypeId !== row.occurrence.activityTypeId) continue;
      const linked =
        entry.scheduleItemId === row.occurrence.scheduleItemId && entry.localDate === row.occurrence.date;
      const t =
        row.part === 'start' ? Date.parse(entry.startUtc) : entry.endUtc ? Date.parse(entry.endUtc) : NaN;
      if (Number.isNaN(t)) continue;
      if (linked) candidates.push({ row, entry, distance: -1 });
      else if (t >= lo && t <= hi) candidates.push({ row, entry, distance: Math.abs(t - row.at.getTime()) });
    }
  }
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.row.at.getTime() - b.row.at.getTime() ||
      a.entry.startUtc.localeCompare(b.entry.startUtc) ||
      a.entry.id.localeCompare(b.entry.id),
  );

  const rowMatch = new Map<string, string>(); // row key -> entry id
  const entryOccurrence = new Map<string, string>(); // entry id -> occurrence key
  for (const c of candidates) {
    if (rowMatch.has(c.row.key)) continue;
    const claimed = entryOccurrence.get(c.entry.id);
    if (claimed !== undefined && claimed !== c.row.occurrence.key) continue;
    rowMatch.set(c.row.key, c.entry.id);
    entryOccurrence.set(c.entry.id, c.row.occurrence.key);
  }

  const nowMs = now.getTime();
  return visible.map((row) => {
    const entryId = rowMatch.get(row.key) ?? null;
    let status: RowStatus;
    if (row.occurrence.skipped) status = 'skipped';
    else if (entryId) status = 'done';
    else if (row.at.getTime() + windows(row.occurrence.activityTypeId).afterMin * MINUTE < nowMs)
      status = 'missed';
    else status = 'upcoming';
    return { ...row, status, entryId };
  });
}

/** The next expected planned row (FR-LOG-02): the earliest upcoming row at or after now, else the earliest upcoming. */
export function nextExpected(rows: MatchedRow[], now: Date): MatchedRow | null {
  const upcoming = rows.filter((r) => r.status === 'upcoming');
  return upcoming.find((r) => r.at.getTime() >= now.getTime()) ?? upcoming[0] ?? null;
}
