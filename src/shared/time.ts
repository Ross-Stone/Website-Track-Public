// Time zone and calendar helpers (TECH-08, NFR-08). Intl only, never hard-coded offsets.
//
// Conventions:
//   - instants are `Date` or UTC ISO strings
//   - local dates are 'YYYY-MM-DD', clock times 'HH:MM', both meaning "in time zone tz"
//   - calendar arithmetic on local dates uses UTC midnight so it is free of DST effects

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instantMs: number, tz: string): WallClock {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The phone's current IANA time zone. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const toMs = (instant: Date | string | number) =>
  typeof instant === 'number'
    ? instant
    : typeof instant === 'string'
      ? Date.parse(instant)
      : instant.getTime();

/** UTC offset of `tz` at `instant`, in milliseconds (e.g. +3_600_000 for BST). */
export function tzOffsetMs(instant: Date | string | number, tz: string): number {
  const ms = Math.floor(toMs(instant) / 1000) * 1000;
  const w = wallClock(ms, tz);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - ms;
}

/** Local calendar date ('YYYY-MM-DD') of `instant` in `tz`. */
export function localDateOf(instant: Date | string | number, tz: string): string {
  const w = wallClock(toMs(instant), tz);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Local clock time ('HH:MM') of `instant` in `tz`. */
export function localTimeOf(instant: Date | string | number, tz: string): string {
  const w = wallClock(toMs(instant), tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

function parseDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y!, m!, d!];
}

function parseTime(time: string): [number, number] {
  const [h, m] = time.split(':').map(Number);
  return [h!, m!];
}

/**
 * The instant at which the wall clock in `tz` reads `date time`.
 * Clock changes follow Temporal's "compatible" rule:
 *   - a time that doesn't exist (spring forward gap) moves forward by the gap (01:30 → 02:30 BST)
 *   - a time that happens twice (autumn fall back) resolves to the earlier one
 */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = parseDate(date);
  const [h, mi] = parseTime(time);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const before = tzOffsetMs(asUtc - DAY, tz);
  const after = tzOffsetMs(asUtc + DAY, tz);
  const matches = [...new Set([before, after])]
    .map((o) => asUtc - o)
    .filter((t) => {
      const w = wallClock(t, tz);
      return w.year === y && w.month === mo && w.day === d && w.hour === h && w.minute === mi;
    })
    .sort((a, b) => a - b);
  if (matches.length > 0) return new Date(matches[0]!);
  // In a gap: interpret with the offset in force before the change, which lands after the gap.
  return new Date(asUtc - before);
}

/** Adds whole calendar days to a local date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parseDate(a);
  const [yb, mb, db] = parseDate(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY);
}

/** 0 = Monday … 6 = Sunday (FR-FMT-01: weeks start on Monday). */
export function weekdayMon0(date: string): number {
  const [y, m, d] = parseDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  return addDays(date, -weekdayMon0(date));
}

/** Minutes between two instants, rounded down. */
export function minutesBetween(from: Date | string, to: Date | string): number {
  return Math.floor((toMs(to) - toMs(from)) / MINUTE);
}

/** "1 h 42 m" style duration (design: "0 h 18 m", "9 h 54 m"). Negative values clamp to 0. */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / MINUTE));
  return `${Math.floor(totalMin / 60)} h ${totalMin % 60} m`;
}

/** Shorter form for "… ago" text: "42 m", "1 h 42 m", "7 h". */
export function formatAgo(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / MINUTE));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** dd/mm/yyyy (FR-FMT-01). */
export function formatDateUK(date: string): string {
  const [y, m, d] = parseDate(date);
  return `${pad(d)}/${pad(m)}/${pad(y, 4)}`;
}

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Sat 18 Oct" (FR-FMT-01 short form). */
export function formatShortDay(date: string): string {
  const [, m, d] = parseDate(date);
  return `${WEEKDAYS_SHORT[weekdayMon0(date)]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "Sat 17 Oct 2026" (History date button). */
export function formatShortDayYear(date: string): string {
  return `${formatShortDay(date)} ${parseDate(date)[0]}`;
}

/** "Sunday 18 October" (Home header). */
export function formatLongDay(date: string): string {
  const [, m, d] = parseDate(date);
  return `${WEEKDAYS_LONG[weekdayMon0(date)]} ${d} ${MONTHS_LONG[m - 1]}`;
}

/** Minutes since midnight for 'HH:MM'. */
export function clockMinutes(time: string): number {
  const [h, m] = parseTime(time);
  return h * 60 + m;
}
