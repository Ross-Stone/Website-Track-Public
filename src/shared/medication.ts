// Medication timing (FR-MED-03, FR-MED-04, D13). Simple time arithmetic on values the family entered;
// no advice, no blocking (agreed Q6).
import type { Entry, Medicine } from './domain';
import { formatAgo, localDateOf, localTimeOf } from './time';

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface MedicationStatus {
  medicine: Medicine;
  /** 'wait' = before the next allowed time; 'ok' = allowed, until double the minimum gap after the last dose. */
  state: 'wait' | 'ok';
  lastDoseAt: Date;
  nextAllowedAt: Date;
  /** Doses in the rolling 24 hours ending now. */
  dosesIn24h: number;
  /** True when the rolling 24-hour maximum, not the minimum gap, sets the next allowed time. */
  limitedByMax: boolean;
}

/** Start instants of a medicine's non-deleted doses at or before `now`, oldest first. */
function doseTimes(medicine: Medicine, entries: Entry[], now: Date): number[] {
  return entries
    .filter((e) => !e.deletedAt && e.medicineId === medicine.id)
    .map((e) => Date.parse(e.startUtc))
    .filter((t) => t <= now.getTime())
    .sort((a, b) => a - b);
}

/**
 * Status for one medicine, or null when nothing should show.
 *
 * - Only medicines with a dose in the rolling 24 hours (not the calendar day) are considered.
 * - Next allowed = the later of (last dose + minimum gap) and, if the 24-hour maximum has been reached,
 *   the moment the oldest counted dose leaves the 24-hour window.
 * - Before then: 'wait'. From then until last dose + 2 × gap: 'ok'. After that: hidden, unless the
 *   maximum still blocks.
 */
export function medicationStatus(medicine: Medicine, entries: Entry[], now: Date): MedicationStatus | null {
  const nowMs = now.getTime();
  const all = doseTimes(medicine, entries, now);
  const in24h = all.filter((t) => t > nowMs - DAY);
  if (in24h.length === 0) return null;

  const last = in24h[in24h.length - 1]!;
  const gapMs = medicine.minGapMin * MINUTE;
  const gapEnd = last + gapMs;

  // If at or over the maximum, the next dose is allowed once enough doses have aged out of the window
  // that the count would drop below the maximum.
  let maxEnd = -Infinity;
  if (in24h.length >= medicine.maxPer24h) {
    maxEnd = in24h[in24h.length - medicine.maxPer24h]! + DAY;
  }
  const nextAllowed = Math.max(gapEnd, maxEnd);
  const base = {
    medicine,
    lastDoseAt: new Date(last),
    nextAllowedAt: new Date(nextAllowed),
    dosesIn24h: in24h.length,
    limitedByMax: maxEnd > gapEnd,
  };

  if (nowMs < nextAllowed) return { ...base, state: 'wait' };
  if (nowMs < last + 2 * gapMs) return { ...base, state: 'ok' };
  return null;
}

/** Statuses for all of a child's medicines that have one, in medicine order. Archived medicines still count. */
export function medicationStatuses(medicines: Medicine[], entries: Entry[], now: Date): MedicationStatus[] {
  return [...medicines]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((m) => medicationStatus(m, entries, now))
    .filter((s): s is MedicationStatus => s !== null);
}

/**
 * FR-MED-04: when any "counts towards alternating" medicine has a status showing, the most recent dose of
 * any alternating medicine.
 */
export function lastAlternatingDose(
  medicines: Medicine[],
  statuses: MedicationStatus[],
  entries: Entry[],
  now: Date,
): { medicine: Medicine; at: Date } | null {
  if (!statuses.some((s) => s.medicine.countsTowardsAlternating)) return null;
  let best: { medicine: Medicine; at: Date } | null = null;
  for (const m of medicines.filter((x) => x.countsTowardsAlternating)) {
    const times = doseTimes(m, entries, now);
    const last = times[times.length - 1];
    if (last !== undefined && (!best || last > best.at.getTime())) best = { medicine: m, at: new Date(last) };
  }
  return best;
}

/** Display text for a status, in the phone's time zone (design: "Next Medicine A from 12:10", "Medicine A OK now"). */
export function describeStatus(
  s: MedicationStatus,
  now: Date,
  tz: string,
): { title: string; detail: string } {
  const name = s.medicine.name;
  const last = `Last dose ${localTimeOf(s.lastDoseAt, tz)} · ${formatAgo(now.getTime() - s.lastDoseAt.getTime())} ago`;
  if (s.state === 'ok') return { title: `${name} OK now`, detail: last };
  const tomorrow = localDateOf(s.nextAllowedAt, tz) > localDateOf(now, tz) ? ' tomorrow' : '';
  const detail = s.limitedByMax
    ? `24-hour maximum (${s.medicine.maxPer24h}) reached · last ${localTimeOf(s.lastDoseAt, tz)}`
    : last;
  return { title: `Next ${name} from ${localTimeOf(s.nextAllowedAt, tz)}${tomorrow}`, detail };
}

/** "Last alternating dose: Medicine A at 08:10 (1 h 42 m ago)". */
export function describeAlternating(d: { medicine: Medicine; at: Date }, now: Date, tz: string): string {
  return `Last alternating dose: ${d.medicine.name} at ${localTimeOf(d.at, tz)} (${formatAgo(now.getTime() - d.at.getTime())} ago)`;
}
