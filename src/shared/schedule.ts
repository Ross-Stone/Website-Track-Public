// Planned-item generation (FR-SCHED-01..04, TECH-08).
// Schedule items hold plain clock times; they are applied in the phone's current time zone.
import type { ScheduleItem, ScheduleOverride } from './domain';
import { addDays, clockMinutes, daysBetween, mondayOf, weekdayMon0, zonedTimeToUtc } from './time';

export const EVERY_DAY = 0b1111111;
export const MONDAY_TO_FRIDAY = 0b0011111;

/** One schedule item on one specific day (the day it starts). */
export interface Occurrence {
  /** `${scheduleItemId}:${date}`. */
  key: string;
  scheduleItemId: string;
  activityTypeId: string;
  label: string | null;
  autoConfirm: boolean;
  /** Local date the occurrence starts on. Overrides and auto-confirm are keyed by this. */
  date: string;
  /** Effective clock times (after a move). */
  startTime: string;
  endTime: string | null;
  startUtc: Date;
  endUtc: Date | null;
  /** True when the (effective) end is on the next day, e.g. overnight sleep 20:30–06:30. */
  crossesMidnight: boolean;
  skipped: boolean;
  moved: boolean;
  /** Original times, present when moved. */
  originalStartTime: string;
  originalEndTime: string | null;
}

/** Does the item apply on this local date? (days, repeat, date range, archived) */
export function occursOn(item: ScheduleItem, date: string): boolean {
  if (item.archivedAt) return false;
  if (item.validFrom && date < item.validFrom) return false;
  if (item.validUntil && date > item.validUntil) return false;
  if ((item.daysMask & (1 << weekdayMon0(date))) === 0) return false;
  if (item.repeat === 'fortnightly') {
    const anchor = item.anchorDate ?? item.validFrom;
    if (anchor) {
      const weeks = daysBetween(mondayOf(anchor), mondayOf(date)) / 7;
      if (weeks % 2 !== 0) return false;
    }
  }
  return true;
}

/** Builds the occurrence of `item` on `date` in `tz`, applying that day's override if any. */
export function buildOccurrence(
  item: ScheduleItem,
  date: string,
  tz: string,
  override: ScheduleOverride | undefined,
): Occurrence {
  const moved = override?.action === 'move' && !!override.newStartTime;
  const startTime = moved ? override!.newStartTime! : item.startTime;
  const endTime = moved ? (override!.newEndTime ?? null) : item.endTime;
  const crossesMidnight = endTime !== null && clockMinutes(endTime) <= clockMinutes(startTime);
  return {
    key: `${item.id}:${date}`,
    scheduleItemId: item.id,
    activityTypeId: item.activityTypeId,
    label: item.label,
    autoConfirm: item.autoConfirm,
    date,
    startTime,
    endTime,
    startUtc: zonedTimeToUtc(date, startTime, tz),
    endUtc: endTime === null ? null : zonedTimeToUtc(crossesMidnight ? addDays(date, 1) : date, endTime, tz),
    crossesMidnight,
    skipped: override?.action === 'skip',
    moved,
    originalStartTime: item.startTime,
    originalEndTime: item.endTime,
  };
}

/** All occurrences that start on `date`, sorted by start. */
export function occurrencesOn(
  items: ScheduleItem[],
  overrides: ScheduleOverride[],
  date: string,
  tz: string,
): Occurrence[] {
  const byKey = new Map(overrides.map((o) => [`${o.scheduleItemId}:${o.localDate}`, o]));
  return items
    .filter((i) => occursOn(i, date))
    .map((i) => buildOccurrence(i, date, tz, byKey.get(`${i.id}:${date}`)))
    .sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime() || a.key.localeCompare(b.key));
}

/**
 * A row on Home's timeline for a planned item. Most occurrences give one "start" row. An occurrence
 * that crosses midnight also gives an "end" row on the next day: overnight sleep 20:30–06:30 shows
 * "Bedtime" at 20:30 and, the next morning, "Woke up" at 06:30 (agreed Q1).
 */
export interface PlannedRow {
  /** `${occurrence.key}:start|end`. */
  key: string;
  part: 'start' | 'end';
  occurrence: Occurrence;
  /** Planned instant of this row. */
  at: Date;
}

/** Planned rows to show on `date` (today on Home): starts on that day, plus ends of last night's items. */
export function plannedRowsFor(
  items: ScheduleItem[],
  overrides: ScheduleOverride[],
  date: string,
  tz: string,
): PlannedRow[] {
  const rows: PlannedRow[] = [];
  for (const o of occurrencesOn(items, overrides, addDays(date, -1), tz)) {
    if (o.crossesMidnight && o.endUtc)
      rows.push({ key: `${o.key}:end`, part: 'end', occurrence: o, at: o.endUtc });
  }
  for (const o of occurrencesOn(items, overrides, date, tz)) {
    rows.push({ key: `${o.key}:start`, part: 'start', occurrence: o, at: o.startUtc });
  }
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
}
