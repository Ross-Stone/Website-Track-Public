import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatAgo,
  formatDateUK,
  formatDuration,
  formatLongDay,
  formatShortDay,
  formatShortDayYear,
  localDateOf,
  localTimeOf,
  mondayOf,
  tzOffsetMs,
  weekdayMon0,
  zonedTimeToUtc,
} from '../../src/shared/time';
import { LONDON, MADRID } from './fixtures';

const iso = (d: Date) => d.toISOString();

describe('zonedTimeToUtc', () => {
  it('applies BST and GMT either side of the autumn clock change', () => {
    expect(iso(zonedTimeToUtc('2026-10-24', '06:40', LONDON))).toBe('2026-10-24T05:40:00.000Z');
    expect(iso(zonedTimeToUtc('2026-10-25', '06:40', LONDON))).toBe('2026-10-25T06:40:00.000Z');
  });

  it('applies GMT and BST either side of the spring clock change', () => {
    expect(iso(zonedTimeToUtc('2026-03-28', '06:30', LONDON))).toBe('2026-03-28T06:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-03-29', '06:30', LONDON))).toBe('2026-03-29T05:30:00.000Z');
  });

  it('moves a time in the spring-forward gap forward by the gap (01:30 → 02:30 BST)', () => {
    expect(iso(zonedTimeToUtc('2026-03-29', '01:30', LONDON))).toBe('2026-03-29T01:30:00.000Z');
    expect(localTimeOf('2026-03-29T01:30:00.000Z', LONDON)).toBe('02:30');
  });

  it('resolves a repeated autumn time to the earlier (BST) one', () => {
    expect(iso(zonedTimeToUtc('2026-10-25', '01:30', LONDON))).toBe('2026-10-25T00:30:00.000Z');
  });

  it('uses the given zone, e.g. abroad (FR-SCHED-04)', () => {
    expect(iso(zonedTimeToUtc('2026-10-18', '06:30', MADRID))).toBe('2026-10-18T04:30:00.000Z');
    expect(localTimeOf(zonedTimeToUtc('2026-10-18', '06:30', MADRID), MADRID)).toBe('06:30');
  });

  it('handles a zone with a non-hour offset', () => {
    expect(iso(zonedTimeToUtc('2026-10-18', '09:00', 'Asia/Kolkata'))).toBe('2026-10-18T03:30:00.000Z');
  });
});

describe('local date and time', () => {
  it('gives the local date in the entry zone, not UTC', () => {
    expect(localDateOf('2026-10-18T23:30:00Z', LONDON)).toBe('2026-10-19'); // 00:30 BST
    expect(localDateOf('2026-10-18T22:30:00Z', MADRID)).toBe('2026-10-19'); // 00:30 CEST
    expect(localDateOf('2026-10-18T22:30:00Z', LONDON)).toBe('2026-10-18');
  });

  it('formats midnight as 00:00, not 24:00', () => {
    expect(localTimeOf('2026-12-01T00:00:00Z', LONDON)).toBe('00:00');
  });

  it('reports offsets across the change', () => {
    expect(tzOffsetMs('2026-10-25T00:59:00Z', LONDON)).toBe(3_600_000);
    expect(tzOffsetMs('2026-10-25T01:00:00Z', LONDON)).toBe(0);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across month, year and clock changes', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
  });

  it('numbers weekdays from Monday', () => {
    expect(weekdayMon0('2026-10-19')).toBe(0); // Monday
    expect(weekdayMon0('2026-10-18')).toBe(6); // Sunday
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
  });
});

describe('UK formats (FR-FMT-01)', () => {
  it('formats dates', () => {
    expect(formatDateUK('2026-10-08')).toBe('08/10/2026');
    expect(formatShortDay('2026-10-17')).toBe('Sat 17 Oct');
    expect(formatShortDayYear('2026-10-17')).toBe('Sat 17 Oct 2026');
    expect(formatLongDay('2026-10-18')).toBe('Sunday 18 October');
  });

  it('formats durations', () => {
    expect(formatDuration(18 * 60_000)).toBe('0 h 18 m');
    expect(formatDuration((9 * 60 + 54) * 60_000)).toBe('9 h 54 m');
    expect(formatAgo(42 * 60_000)).toBe('42 m');
    expect(formatAgo(7 * 3_600_000)).toBe('7 h');
    expect(formatAgo((60 + 42) * 60_000)).toBe('1 h 42 m');
  });
});
