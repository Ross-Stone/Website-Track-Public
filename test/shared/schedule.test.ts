import { describe, expect, it } from 'vitest';
import { MONDAY_TO_FRIDAY, occurrencesOn, occursOn, plannedRowsFor } from '../../src/shared/schedule';
import { item, LONDON, MADRID, override } from './fixtures';

const cereal = item({ id: 'cereal', activityTypeId: 'T_cereal', startTime: '06:40' });
const nap = item({ id: 'nap', activityTypeId: 'T_nap', startTime: '09:30', endTime: '11:00' });
const overnight = item({ id: 'night', activityTypeId: 'T_overnight', startTime: '20:30', endTime: '06:30' });

describe('occursOn', () => {
  it('honours the day picker', () => {
    const weekdays = item({ id: 'n', activityTypeId: 'T', startTime: '08:00', daysMask: MONDAY_TO_FRIDAY });
    expect(occursOn(weekdays, '2026-10-19')).toBe(true); // Mon
    expect(occursOn(weekdays, '2026-10-23')).toBe(true); // Fri
    expect(occursOn(weekdays, '2026-10-24')).toBe(false); // Sat
    expect(occursOn(weekdays, '2026-10-25')).toBe(false); // Sun
    const sundays = item({ id: 's', activityTypeId: 'T', startTime: '10:00', daysMask: 1 << 6 });
    expect(occursOn(sundays, '2026-10-25')).toBe(true);
    expect(occursOn(sundays, '2026-10-24')).toBe(false);
  });

  it('honours start and end dates, inclusive (term times)', () => {
    const term = item({
      id: 't',
      activityTypeId: 'T',
      startTime: '08:00',
      validFrom: '2026-09-01',
      validUntil: '2026-12-19',
    });
    expect(occursOn(term, '2026-08-31')).toBe(false);
    expect(occursOn(term, '2026-09-01')).toBe(true);
    expect(occursOn(term, '2026-12-19')).toBe(true);
    expect(occursOn(term, '2026-12-20')).toBe(false);
  });

  it('repeats every 2 weeks from the anchor week', () => {
    const club = item({
      id: 'c',
      activityTypeId: 'T',
      startTime: '17:00',
      daysMask: 1 << 2, // Wednesday
      repeat: 'fortnightly',
      anchorDate: '2026-10-14', // a Wednesday
    });
    expect(occursOn(club, '2026-10-14')).toBe(true);
    expect(occursOn(club, '2026-10-21')).toBe(false);
    expect(occursOn(club, '2026-10-28')).toBe(true); // across the clock change
    expect(occursOn(club, '2026-10-07')).toBe(false);
    expect(occursOn(club, '2026-09-30')).toBe(true); // before the anchor too
  });

  it('anchors on any day of the anchor week', () => {
    const club = item({
      id: 'c',
      activityTypeId: 'T',
      startTime: '17:00',
      daysMask: 1 << 2,
      repeat: 'fortnightly',
      anchorDate: '2026-10-12',
    });
    expect(occursOn(club, '2026-10-14')).toBe(true);
    expect(occursOn(club, '2026-10-21')).toBe(false);
  });

  it('never shows archived items', () => {
    expect(occursOn({ ...cereal, archivedAt: '2026-10-01T00:00:00Z' }, '2026-10-18')).toBe(false);
  });
});

describe('occurrencesOn', () => {
  it('applies clock times in the phone time zone (FR-SCHED-04)', () => {
    const [o] = occurrencesOn([cereal], [], '2026-10-18', MADRID);
    expect(o!.startUtc.toISOString()).toBe('2026-10-18T04:40:00.000Z');
  });

  it('keeps 06:40 at 06:40 on the day the clocks go back', () => {
    const [before] = occurrencesOn([cereal], [], '2026-10-24', LONDON);
    const [after] = occurrencesOn([cereal], [], '2026-10-25', LONDON);
    expect(before!.startUtc.toISOString()).toBe('2026-10-24T05:40:00.000Z');
    expect(after!.startUtc.toISOString()).toBe('2026-10-25T06:40:00.000Z');
  });

  it('ends an overnight item the next morning, including across the clock change (11 h night)', () => {
    const [o] = occurrencesOn([overnight], [], '2026-10-24', LONDON);
    expect(o!.crossesMidnight).toBe(true);
    expect(o!.startUtc.toISOString()).toBe('2026-10-24T19:30:00.000Z');
    expect(o!.endUtc!.toISOString()).toBe('2026-10-25T06:30:00.000Z');
  });

  it('gives a same-day duration item an end on the same day', () => {
    const [o] = occurrencesOn([nap], [], '2026-10-18', LONDON);
    expect(o!.crossesMidnight).toBe(false);
    expect(o!.endUtc!.toISOString()).toBe('2026-10-18T10:00:00.000Z');
  });

  it('sorts by start time', () => {
    const list = occurrencesOn([overnight, nap, cereal], [], '2026-10-18', LONDON);
    expect(list.map((o) => o.scheduleItemId)).toEqual(['cereal', 'nap', 'night']);
  });

  it('marks a skipped item for that day only', () => {
    const skip = override({ scheduleItemId: 'nap', localDate: '2026-10-19', action: 'skip' });
    expect(occurrencesOn([nap], [skip], '2026-10-19', LONDON)[0]!.skipped).toBe(true);
    expect(occurrencesOn([nap], [skip], '2026-10-20', LONDON)[0]!.skipped).toBe(false);
  });

  it('uses moved times for that day only and keeps the originals', () => {
    const move = override({
      scheduleItemId: 'nap',
      localDate: '2026-10-19',
      action: 'move',
      newStartTime: '13:45',
      newEndTime: '15:00',
    });
    const [o] = occurrencesOn([nap], [move], '2026-10-19', LONDON);
    expect(o).toMatchObject({
      moved: true,
      startTime: '13:45',
      endTime: '15:00',
      originalStartTime: '09:30',
      originalEndTime: '11:00',
    });
    expect(o!.startUtc.toISOString()).toBe('2026-10-19T12:45:00.000Z');
    expect(occurrencesOn([nap], [move], '2026-10-20', LONDON)[0]!.moved).toBe(false);
  });
});

describe('plannedRowsFor (Home timeline)', () => {
  it("shows last night's Woke up row, today's items and tonight's Bedtime (agreed Q1)", () => {
    const rows = plannedRowsFor([overnight, cereal, nap], [], '2026-10-18', LONDON);
    expect(
      rows.map((r) => `${r.occurrence.scheduleItemId}:${r.part}@${r.at.toISOString().slice(11, 16)}`),
    ).toEqual(['night:end@05:30', 'cereal:start@05:40', 'nap:start@08:30', 'night:start@19:30']);
    expect(rows[0]!.occurrence.date).toBe('2026-10-17');
  });

  it("carries a skip of last night's sleep to its Woke up row", () => {
    const skip = override({ scheduleItemId: 'night', localDate: '2026-10-17', action: 'skip' });
    const rows = plannedRowsFor([overnight], [skip], '2026-10-18', LONDON);
    expect(rows.map((r) => [r.part, r.occurrence.skipped])).toEqual([
      ['end', true],
      ['start', false],
    ]);
  });

  it('has no Woke up row when the item did not apply last night', () => {
    const weekend = { ...overnight, daysMask: 0b1100000 }; // Sat, Sun
    const monday = plannedRowsFor([weekend], [], '2026-10-19', LONDON); // Sunday night → Monday morning
    expect(monday.map((r) => r.part)).toEqual(['end']);
    const saturday = plannedRowsFor([weekend], [], '2026-10-24', LONDON); // Friday night not scheduled
    expect(saturday.map((r) => r.part)).toEqual(['start']);
  });
});
