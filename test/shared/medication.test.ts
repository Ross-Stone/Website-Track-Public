import { describe, expect, it } from 'vitest';
import {
  describeAlternating,
  describeStatus,
  lastAlternatingDose,
  medicationStatus,
  medicationStatuses,
} from '../../src/shared/medication';
import { at, entry, LONDON, medicine } from './fixtures';

// 18 Oct 2026 is BST: local = UTC + 1.
const medA = medicine({ id: 'medA', name: 'Medicine A', minGapMin: 240, maxPer24h: 4, sortOrder: 0 });
const medB = medicine({
  id: 'medB',
  name: 'Medicine B',
  dose: 2.5,
  minGapMin: 360,
  maxPer24h: 3,
  sortOrder: 1,
});
const dose = (med: string, startUtc: string, extra: { deletedAt?: string } = {}) =>
  entry({ activityTypeId: 'T_med', medicineId: med, startUtc, dose: 5, doseUnit: 'ml', ...extra });

describe('medication status (FR-MED-03)', () => {
  const doses = [dose('medA', '2026-10-18T07:10:00Z')]; // 08:10 local

  it('AC1: shows "Next Medicine A from 12:10" until 12:10', () => {
    const now = at('2026-10-18T08:52:00Z'); // 09:52
    const s = medicationStatus(medA, doses, now)!;
    expect(s.state).toBe('wait');
    expect(describeStatus(s, now, LONDON)).toEqual({
      title: 'Next Medicine A from 12:10',
      detail: 'Last dose 08:10 · 1 h 42 m ago',
    });
    expect(medicationStatus(medA, doses, at('2026-10-18T11:09:59Z'))!.state).toBe('wait');
  });

  it('AC1: shows "Medicine A OK now" from 12:10 until 16:10', () => {
    const s = medicationStatus(medA, doses, at('2026-10-18T11:10:00Z'))!;
    expect(s.state).toBe('ok');
    expect(describeStatus(s, at('2026-10-18T14:10:00Z'), LONDON).title).toBe('Medicine A OK now');
    expect(medicationStatus(medA, doses, at('2026-10-18T15:09:59Z'))!.state).toBe('ok');
  });

  it('AC1: shows nothing from 16:10 (double the gap, D13)', () => {
    expect(medicationStatus(medA, doses, at('2026-10-18T15:10:00Z'))).toBeNull();
  });

  it('shows nothing with no dose in the last 24 hours', () => {
    expect(medicationStatus(medA, [], at('2026-10-18T12:00:00Z'))).toBeNull();
  });

  it('ignores deleted doses and future-dated doses', () => {
    const list = [
      dose('medA', '2026-10-18T07:10:00Z', { deletedAt: '2026-10-18T07:20:00Z' }),
      dose('medA', '2026-10-18T20:00:00Z'),
    ];
    expect(medicationStatus(medA, list, at('2026-10-18T09:00:00Z'))).toBeNull();
  });

  it('AC2: uses a rolling 24 hours, so a 23:00 dose still counts after midnight', () => {
    const late = [dose('medA', '2026-10-17T22:00:00Z')]; // 23:00 on the 17th
    const now = at('2026-10-17T23:30:00Z'); // 00:30 on the 18th
    const s = medicationStatus(medA, late, now)!;
    expect(s.state).toBe('wait');
    expect(describeStatus(s, now, LONDON).title).toBe('Next Medicine A from 03:00');
  });

  it('says "tomorrow" when the next allowed time is on a later day', () => {
    const late = [dose('medA', '2026-10-18T21:30:00Z')]; // 22:30
    const now = at('2026-10-18T22:00:00Z'); // 23:00
    expect(describeStatus(medicationStatus(medA, late, now)!, now, LONDON).title).toBe(
      'Next Medicine A from 02:30 tomorrow',
    );
  });

  it('AC3: when the 24-hour maximum is reached, waits for the oldest dose to leave the window', () => {
    // 4 doses: 06:45, 10:50, 14:55, 18:30 local. Gap passed at 22:30, but max reached until 06:45 tomorrow.
    const four = ['05:45', '09:50', '13:55', '17:30'].map((t) => dose('medA', `2026-10-18T${t}:00Z`));
    const now = at('2026-10-18T20:15:00Z'); // 21:15 local
    const s = medicationStatus(medA, four, now)!;
    expect(s).toMatchObject({ state: 'wait', limitedByMax: true, dosesIn24h: 4 });
    expect(s.nextAllowedAt.toISOString()).toBe('2026-10-19T05:45:00.000Z');
    expect(describeStatus(s, now, LONDON)).toEqual({
      title: 'Next Medicine A from 06:45 tomorrow',
      detail: '24-hour maximum (4) reached · last 18:30',
    });
    expect(medicationStatus(medA, four, at('2026-10-18T22:00:00Z'))!.state).toBe('wait'); // gap passed, still blocked
  });

  it('AC3: once the maximum lifts after double the gap, clears immediately', () => {
    const four = ['05:45', '09:50', '13:55', '17:30'].map((t) => dose('medA', `2026-10-18T${t}:00Z`));
    expect(medicationStatus(medA, four, at('2026-10-19T05:45:00Z'))).toBeNull();
  });

  it('copes with more doses than the maximum (counts down to below the maximum)', () => {
    const five = ['01:00', '02:00', '03:00', '04:00', '05:00'].map((t) =>
      dose('medA', `2026-10-18T${t}:00Z`),
    );
    const s = medicationStatus(medA, five, at('2026-10-18T06:00:00Z'))!;
    expect(s.nextAllowedAt.toISOString()).toBe('2026-10-19T02:00:00.000Z'); // the 2nd oldest leaves at +24 h
  });

  it('does not count a dose exactly 24 hours old', () => {
    const list = [
      '2026-10-17T10:00:00Z',
      '2026-10-18T02:00:00Z',
      '2026-10-18T06:00:00Z',
      '2026-10-18T09:00:00Z',
    ].map((t) => dose('medA', t));
    const s = medicationStatus(medA, list, at('2026-10-18T10:00:00Z'))!;
    expect(s.dosesIn24h).toBe(3);
    expect(s.limitedByMax).toBe(false);
  });

  it('works through the autumn clock change by elapsed time, not wall time', () => {
    const night = [dose('medA', '2026-10-24T23:30:00Z')]; // 00:30 BST on Sun 25
    const now = at('2026-10-25T01:30:00Z'); // 01:30 GMT
    const s = medicationStatus(medA, night, now)!;
    expect(s.nextAllowedAt.toISOString()).toBe('2026-10-25T03:30:00.000Z');
    expect(describeStatus(s, now, LONDON).title).toBe('Next Medicine A from 03:30'); // 4 elapsed hours, wall clock shows 3 h later
  });
});

describe('several medicines and alternating (FR-MED-04)', () => {
  const doses = [dose('medA', '2026-10-18T07:10:00Z'), dose('medB', '2026-10-18T10:05:00Z')];
  const now = at('2026-10-18T14:10:00Z'); // 15:10 local (design: nursery day)

  it('lists each medicine with a status, in order', () => {
    const list = medicationStatuses([medB, medA], doses, now);
    expect(list.map((s) => describeStatus(s, now, LONDON).title)).toEqual([
      'Medicine A OK now',
      'Next Medicine B from 17:05',
    ]);
  });

  it('shows the last alternating dose when an alternating medicine is showing', () => {
    const statuses = medicationStatuses([medA, medB], doses, now);
    const alt = lastAlternatingDose([medA, medB], statuses, doses, now)!;
    expect(describeAlternating(alt, now, LONDON)).toBe(
      'Last alternating dose: Medicine B at 11:05 (4 h 5 m ago)',
    );
  });

  it('shows no alternating line when no alternating medicine has a status', () => {
    const plain = { ...medA, countsTowardsAlternating: false };
    const statuses = medicationStatuses([plain], doses, now);
    expect(
      lastAlternatingDose(
        [plain, medB],
        statuses.filter((s) => s.medicine.id === 'medA'),
        doses,
        now,
      ),
    ).toBeNull();
  });

  it('hides the whole section when nothing has a status (AC4)', () => {
    expect(medicationStatuses([medA, medB], [], now)).toEqual([]);
  });
});
