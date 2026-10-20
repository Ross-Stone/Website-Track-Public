import { describe, expect, it } from 'vitest';
import type { Entry, ScheduleItem, ScheduleOverride } from '../../src/shared/domain';
import {
  matchPlannedRows,
  nextExpected,
  windowsFromSettings,
  type WindowLookup,
} from '../../src/shared/matching';
import { at, entry, item, LONDON, override } from './fixtures';

const DAY = '2026-10-18'; // BST: local = UTC + 1
const formula1 = item({ id: 'f1', activityTypeId: 'T_formula', startTime: '11:30' });
const formula2 = item({ id: 'f2', activityTypeId: 'T_formula', startTime: '20:20' });
const nap = item({ id: 'nap', activityTypeId: 'T_nap', startTime: '09:30', endTime: '11:00' });
const overnight = item({ id: 'night', activityTypeId: 'T_overnight', startTime: '20:30', endTime: '06:30' });
const std: WindowLookup = () => ({ beforeMin: 120, afterMin: 120 });

function run(
  items: ScheduleItem[],
  entries: Entry[],
  nowIso: string,
  opts: { overrides?: ScheduleOverride[]; windows?: WindowLookup; date?: string } = {},
) {
  return matchPlannedRows({
    items,
    overrides: opts.overrides ?? [],
    entries,
    date: opts.date ?? DAY,
    tz: LONDON,
    now: at(nowIso),
    windows: opts.windows ?? std,
  });
}
const summary = (rows: ReturnType<typeof run>) =>
  rows.map((r) => `${r.key.split(':')[0]}:${r.part}=${r.status}${r.entryId ? `(${r.entryId})` : ''}`);

describe('matching (FR-HOME-03)', () => {
  it('marks a planned item done when an entry of the same type starts within the window', () => {
    const e = entry({ id: 'A', activityTypeId: 'T_formula', startUtc: '2026-10-18T10:34:00Z' }); // 11:34
    expect(summary(run([formula1], [e], '2026-10-18T12:00:00Z'))).toEqual(['f1:start=done(A)']);
  });

  it('treats the window edges as inclusive and anything beyond as unmatched', () => {
    const early = entry({ id: 'E', activityTypeId: 'T_formula', startUtc: '2026-10-18T08:30:00Z' }); // exactly 120 m before
    expect(run([formula1], [early], '2026-10-18T09:00:00Z')[0]!.status).toBe('done');
    const tooEarly = entry({ id: 'X', activityTypeId: 'T_formula', startUtc: '2026-10-18T08:29:00Z' });
    expect(run([formula1], [tooEarly], '2026-10-18T09:00:00Z')[0]!.status).toBe('upcoming');
  });

  it('uses each type’s own window from child settings', () => {
    const windows = windowsFromSettings([
      {
        childId: 'sam',
        activityTypeId: 'T_formula',
        enabled: true,
        quickLog: true,
        defaults: {},
        windowBeforeMin: 15,
        windowAfterMin: 30,
      },
    ]);
    const e = entry({ id: 'A', activityTypeId: 'T_formula', startUtc: '2026-10-18T10:10:00Z' }); // 20 m early
    expect(run([formula1], [e], '2026-10-18T10:20:00Z', { windows })[0]!.status).toBe('upcoming');
    expect(windows('T_other')).toEqual({ beforeMin: 120, afterMin: 120 });
  });

  it('ignores other activity types and deleted entries (FR-LOG-06 AC2)', () => {
    const wrongType = entry({ id: 'A', activityTypeId: 'T_cereal', startUtc: '2026-10-18T10:30:00Z' });
    const deleted = entry({
      id: 'B',
      activityTypeId: 'T_formula',
      startUtc: '2026-10-18T10:30:00Z',
      deletedAt: '2026-10-18T10:40:00Z',
    });
    expect(run([formula1], [wrongType, deleted], '2026-10-18T11:00:00Z')[0]!.status).toBe('upcoming');
  });

  it('lets each entry satisfy only one planned item, nearest first (AC1)', () => {
    const twoClose = [
      item({ id: 'p1', activityTypeId: 'T_formula', startTime: '10:00' }),
      item({ id: 'p2', activityTypeId: 'T_formula', startTime: '11:00' }),
    ];
    const e = entry({ id: 'A', activityTypeId: 'T_formula', startUtc: '2026-10-18T09:50:00Z' }); // 10:50, nearer p2
    expect(summary(run(twoClose, [e], '2026-10-18T10:00:00Z'))).toEqual([
      'p1:start=upcoming',
      'p2:start=done(A)',
    ]);
  });

  it('gives two entries to two planned items rather than both to one', () => {
    const twoClose = [
      item({ id: 'p1', activityTypeId: 'T_formula', startTime: '10:00' }),
      item({ id: 'p2', activityTypeId: 'T_formula', startTime: '11:00' }),
    ];
    const a = entry({ id: 'A', activityTypeId: 'T_formula', startUtc: '2026-10-18T09:05:00Z' }); // 10:05
    const b = entry({ id: 'B', activityTypeId: 'T_formula', startUtc: '2026-10-18T09:20:00Z' }); // 10:20
    expect(summary(run(twoClose, [a, b], '2026-10-18T10:30:00Z'))).toEqual([
      'p1:start=done(A)',
      'p2:start=done(B)',
    ]);
  });

  it("lets neighbouring days' items claim entries near midnight", () => {
    const late = item({ id: 'late', activityTypeId: 'T_formula', startTime: '23:30' });
    const early = item({ id: 'early', activityTypeId: 'T_formula', startTime: '01:30' });
    const e = entry({ id: 'A', activityTypeId: 'T_formula', startUtc: '2026-10-17T23:40:00Z' }); // 00:40 on the 18th
    // 00:40 is 70 m after yesterday's 23:30 and 50 m before today's 01:30, so today's item wins.
    expect(summary(run([late, early], [e], '2026-10-18T01:00:00Z'))).toEqual([
      'early:start=done(A)',
      'late:start=upcoming',
    ]);
    const e2 = entry({ id: 'B', activityTypeId: 'T_formula', startUtc: '2026-10-17T22:50:00Z' }); // 23:50 on the 17th
    expect(summary(run([late, early], [e2], '2026-10-18T01:00:00Z'))).toEqual([
      'early:start=upcoming',
      'late:start=upcoming',
    ]);
  });

  it('links auto-confirmed entries to their own occurrence first (TECH-07)', () => {
    const nursery = item({
      id: 'nur',
      activityTypeId: 'T_nursery',
      startTime: '08:00',
      endTime: '18:00',
      autoConfirm: true,
    });
    const auto = entry({
      id: 'AUTO',
      activityTypeId: 'T_nursery',
      startUtc: '2026-10-18T07:00:00Z',
      endUtc: '2026-10-18T17:00:00Z',
      scheduleItemId: 'nur',
      localDate: DAY,
      autoConfirmed: true,
    });
    expect(summary(run([nursery], [auto], '2026-10-18T12:00:00Z'))).toEqual(['nur:start=done(AUTO)']);
  });
});

describe('overnight sleep rows (agreed Q1)', () => {
  const bed = (id: string, start: string, end: string | null) =>
    entry({ id, activityTypeId: 'T_overnight', startUtc: start, endUtc: end, localDate: start.slice(0, 10) });

  it('marks Woke up done when the overnight entry ends within the window of 06:30', () => {
    const night = bed('N', '2026-10-17T19:34:00Z', '2026-10-18T05:28:00Z'); // 20:34 – 06:28
    expect(summary(run([overnight], [night], '2026-10-18T08:00:00Z'))).toEqual([
      'night:end=done(N)',
      'night:start=upcoming',
    ]);
  });

  it('keeps Woke up open while the overnight entry is still running', () => {
    const running = bed('N', '2026-10-17T19:34:00Z', null);
    expect(summary(run([overnight], [running], '2026-10-18T05:12:00Z'))).toEqual([
      'night:end=upcoming',
      'night:start=upcoming',
    ]);
  });

  it("does not let last night's entry satisfy tonight's Bedtime", () => {
    const night = bed('N', '2026-10-17T19:34:00Z', '2026-10-18T05:28:00Z');
    const rows = run([overnight], [night], '2026-10-18T20:00:00Z');
    expect(rows.find((r) => r.part === 'start')!.status).toBe('upcoming');
  });

  it("marks tonight's Bedtime done by tonight's entry", () => {
    const tonight = bed('T', '2026-10-18T19:31:00Z', null);
    expect(summary(run([overnight], [tonight], '2026-10-18T20:00:00Z'))).toEqual([
      'night:end=missed',
      'night:start=done(T)',
    ]);
  });

  it('matches across the autumn clock change', () => {
    // Night of Sat 24 → Sun 25 Oct: 20:30 BST (19:30Z) to 06:30 GMT (06:30Z).
    const night = bed('N', '2026-10-24T19:40:00Z', '2026-10-25T06:20:00Z');
    const rows = run([overnight], [night], '2026-10-25T09:00:00Z', { date: '2026-10-25' });
    expect(rows[0]).toMatchObject({ part: 'end', status: 'done', entryId: 'N' });
  });
});

describe('missed and skipped (FR-HOME-04, FR-SCHED-03)', () => {
  it('is missed once planned time + after window has passed with no match', () => {
    expect(run([formula1], [], '2026-10-18T12:30:00Z')[0]!.status).toBe('upcoming'); // 13:30 local, exactly at the edge
    expect(run([formula1], [], '2026-10-18T12:31:00Z')[0]!.status).toBe('missed');
  });

  it('still allows a late entry to make a missed item done', () => {
    const late = entry({ id: 'L', activityTypeId: 'T_formula', startUtc: '2026-10-18T12:20:00Z' });
    expect(run([formula1], [late], '2026-10-18T15:00:00Z')[0]!.status).toBe('done');
  });

  it('is never missed when skipped, and a skipped item takes no entry', () => {
    const skip = override({ scheduleItemId: 'f1', localDate: DAY, action: 'skip' });
    const e = entry({ id: 'A', activityTypeId: 'T_formula', startUtc: '2026-10-18T10:30:00Z' });
    expect(summary(run([formula1], [e], '2026-10-18T18:00:00Z', { overrides: [skip] }))).toEqual([
      'f1:start=skipped',
    ]);
  });

  it('judges a moved item against its moved time', () => {
    const move = override({ scheduleItemId: 'f1', localDate: DAY, action: 'move', newStartTime: '16:30' });
    const rows = run([formula1], [], '2026-10-18T14:10:00Z', { overrides: [move] }); // 15:10 local
    expect(rows[0]).toMatchObject({ status: 'upcoming' });
    expect(rows[0]!.occurrence.moved).toBe(true);
  });
});

describe('nextExpected', () => {
  it('returns the earliest upcoming row from now', () => {
    const rows = run([nap, formula1, formula2], [], '2026-10-18T09:00:00Z'); // 10:00 local: nap still upcoming
    expect(nextExpected(rows, at('2026-10-18T09:00:00Z'))!.occurrence.scheduleItemId).toBe('f1');
  });

  it('falls back to an upcoming row whose time has just passed', () => {
    const rows = run([formula1], [], '2026-10-18T10:45:00Z');
    expect(nextExpected(rows, at('2026-10-18T10:45:00Z'))!.occurrence.scheduleItemId).toBe('f1');
  });
});
