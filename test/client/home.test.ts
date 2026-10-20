import { describe, expect, it } from 'vitest';
import type { Bootstrap } from '../../src/shared/api';
import type { Entry } from '../../src/shared/domain';
import { buildHome } from '../../src/client/state/home';
import { entry, field, item, medicine, override, type } from '../shared/fixtures';

const T = {
  overnight: type({
    id: 'T_over',
    name: 'Overnight sleep',
    kind: 'duration',
    systemKey: 'overnight_sleep',
    colour: 'indigo',
    icon: 'bed-double',
    sortOrder: 0,
  }),
  nap: type({ id: 'T_nap', name: 'Nap', kind: 'duration', colour: 'violet', icon: 'moon', sortOrder: 1 }),
  cereal: type({ id: 'T_cereal', name: 'Cereal', colour: 'orange', icon: 'soup', sortOrder: 2 }),
  formula: type({ id: 'T_formula', name: 'Formula', colour: 'blue', icon: 'milk', sortOrder: 3 }),
  med: type({
    id: 'T_med',
    name: 'Medication',
    systemKey: 'medication',
    colour: 'red',
    icon: 'pill',
    sortOrder: 13,
  }),
  weight: type({
    id: 'T_weight',
    name: 'Weight',
    systemKey: 'weight',
    colour: 'slate',
    icon: 'weight',
    sortOrder: 14,
  }),
  height: type({
    id: 'T_height',
    name: 'Height',
    systemKey: 'height',
    colour: 'slate',
    icon: 'ruler',
    sortOrder: 15,
  }),
};
const setting = (activityTypeId: string, quickLog = false, defaults = {}) => ({
  childId: 'sam',
  activityTypeId,
  enabled: true,
  quickLog,
  defaults,
  windowBeforeMin: 120,
  windowAfterMin: 120,
});

function boot(over: Partial<Bootstrap> = {}): Bootstrap {
  return {
    version: 1,
    me: { id: 'alex', email: 'r', displayName: 'Alex', role: 'admin' },
    users: [
      { id: 'alex', displayName: 'Alex' },
      { id: 'jamie', displayName: 'Jamie' },
    ],
    children: [{ id: 'sam', firstName: 'Sam', sortOrder: 0, archivedAt: null }],
    activityTypes: Object.values(T),
    fields: [
      field({
        id: 'F1',
        activityTypeId: 'T_formula',
        key: 'amount',
        label: 'Amount',
        fieldType: 'number',
        unit: 'ml',
        decimals: 0,
      }),
      field({
        id: 'F2',
        activityTypeId: 'T_cereal',
        key: 'variety',
        label: 'Variety',
        fieldType: 'list',
        options: ['Berry'],
      }),
      field({
        id: 'F3',
        activityTypeId: 'T_cereal',
        key: 'amount',
        label: 'Amount',
        fieldType: 'number',
        unit: 'scoops',
        decimals: 0,
        sortOrder: 1,
      }),
      field({
        id: 'F4',
        activityTypeId: 'T_weight',
        key: 'weight',
        label: 'Weight',
        fieldType: 'number',
        unit: 'kg',
        decimals: 2,
      }),
      field({
        id: 'F5',
        activityTypeId: 'T_height',
        key: 'height',
        label: 'Height',
        fieldType: 'number',
        unit: 'cm',
        decimals: 1,
      }),
    ],
    childActivitySettings: [
      setting('T_formula', true, { amount: 230 }),
      setting('T_cereal', true),
      setting('T_nap', true),
      setting('T_med', true),
      setting('T_over'),
      setting('T_weight'),
      setting('T_height'),
    ],
    scheduleItems: [
      item({ id: 'S_cereal', activityTypeId: 'T_cereal', startTime: '06:40' }),
      item({ id: 'S_nap', activityTypeId: 'T_nap', startTime: '09:30', endTime: '11:00' }),
      item({ id: 'S_formula', activityTypeId: 'T_formula', startTime: '11:30' }),
      item({ id: 'S_night', activityTypeId: 'T_over', startTime: '20:30', endTime: '06:30' }),
    ],
    medicines: [
      medicine({ id: 'medA', name: 'Medicine A' }),
      medicine({ id: 'medB', name: 'Medicine B', minGapMin: 360, maxPer24h: 3, sortOrder: 1 }),
    ],
    appSettings: {},
    latestMeasurements: [],
    ...over,
  };
}

const run = (entries: Entry[], nowIso: string, b = boot(), overrides = [] as ReturnType<typeof override>[]) =>
  buildHome({ boot: b, childId: 'sam', entries, overrides, now: new Date(nowIso), tz: 'Europe/London' });

// Design "Nap in progress + Medicine A wait", Sunday 18 October 2026 at 09:52 BST.
const napDay = [
  entry({
    id: 'night',
    activityTypeId: 'T_over',
    startUtc: '2026-10-17T19:34:00.000Z',
    endUtc: '2026-10-18T05:28:00.000Z',
    createdBy: 'alex',
  }),
  entry({
    id: 'cereal',
    activityTypeId: 'T_cereal',
    startUtc: '2026-10-18T05:44:00.000Z',
    values: { variety: 'Berry', amount: 12 },
  }),
  entry({
    id: 'medA',
    activityTypeId: 'T_med',
    startUtc: '2026-10-18T07:10:00.000Z',
    medicineId: 'medA',
    dose: 5,
    doseUnit: 'ml',
    createdBy: 'jamie',
  }),
  entry({ id: 'nap', activityTypeId: 'T_nap', startUtc: '2026-10-18T08:34:00.000Z', createdBy: 'jamie' }),
];

describe('Home model (FR-HOME-02)', () => {
  const m = run(napDay, '2026-10-18T08:52:00.000Z');

  it('shows the date and a running nap with a live elapsed time and End button', () => {
    expect(m.dateLabel).toBe('Sunday 18 October');
    expect(m.running).toHaveLength(1);
    expect(m.running[0]).toMatchObject({
      title: 'Nap · running',
      elapsed: '0 h 18 m',
      sub: 'Started 09:34',
      endLabel: 'End',
    });
  });

  it('shows the Medicine A wait and the alternating line', () => {
    expect(m.meds.map((x) => [x.title, x.detail])).toEqual([
      ['Next Medicine A from 12:10', 'Last dose 08:10 · 1 h 42 m ago'],
    ]);
    expect(m.alternating).toBe('Last alternating dose: Medicine A at 08:10 (1 h 42 m ago)');
  });

  it('offers the next planned item with the child defaults', () => {
    expect(m.next).toMatchObject({
      when: 'Next · 11:30 · in 1 h 38 m',
      title: 'Formula · 230 ml',
      tomorrow: false,
    });
  });

  it('builds the timeline: done entries replace their planned items, then now, then what is still planned', () => {
    const lines = m.rows.map((r) =>
      r.kind === 'now' ? `${r.time} NOW` : `${r.time} ${r.title} [${r.state}] ${r.detail}`,
    );
    expect(lines).toEqual([
      '06:28 Woke up [done] Slept 20:34 – 06:28 · 9 h 54 m',
      '06:44 Cereal [done] Berry · 12 scoops · Alex',
      '08:10 Medicine A [done] 5 ml · Jamie',
      '09:34 Nap [running] Started 09:34 · Jamie',
      '09:52 NOW',
      '11:30 Formula [planned] 230 ml',
      '20:30 Bedtime [planned] Until 06:30',
    ]);
  });

  it('lists quick log favourites in activity order', () => {
    expect(m.quick.map((t) => t.name)).toEqual(['Nap', 'Cereal', 'Formula', 'Medication']);
  });

  it('shows no stats without weight or height entries (FR-CHILD-03 AC2)', () => {
    expect(m.stats).toBeNull();
  });
});

describe('header stats (FR-CHILD-03)', () => {
  it('uses the latest weight and height, from bootstrap or newer local entries', () => {
    const b = boot({
      latestMeasurements: [
        entry({
          id: 'w1',
          activityTypeId: 'T_weight',
          startUtc: '2026-03-01T09:00:00.000Z',
          values: { weight: 8.9 },
        }),
        entry({
          id: 'h1',
          activityTypeId: 'T_height',
          startUtc: '2026-03-01T09:00:00.000Z',
          values: { height: 72.5 },
        }),
      ],
    });
    expect(run([], '2026-10-18T08:52:00.000Z', b).stats).toBe('8.90 kg · 72.5 cm');
    const newer = entry({
      id: 'w2',
      activityTypeId: 'T_weight',
      startUtc: '2026-10-18T07:30:00.000Z',
      values: { weight: 9.12 },
    });
    expect(run([newer], '2026-10-18T08:52:00.000Z', b).stats).toBe('9.12 kg · 72.5 cm');
  });
});

describe('overnight sleep on Home (FR-LOG-04 AC3, AC4)', () => {
  it('keeps last night’s running sleep on today’s Home with a Woke up button', () => {
    const running = entry({
      id: 'n',
      activityTypeId: 'T_over',
      startUtc: '2026-10-17T19:34:00.000Z',
      createdBy: 'jamie',
    });
    const m = run([running], '2026-10-18T05:12:00.000Z');
    expect(m.running[0]).toMatchObject({
      elapsed: '9 h 38 m',
      sub: 'Bedtime 20:34 yesterday',
      endLabel: 'Woke up',
    });
    expect(m.rows[0]).toMatchObject({
      kind: 'entry',
      title: 'Overnight sleep',
      state: 'running',
      detail: 'Bedtime yesterday · Jamie',
    });
    expect(m.next).toMatchObject({ title: 'Cereal', when: 'Next · 06:40 · in 28 m' }); // design: home-overnight
  });
});

describe('missed, skipped and moved (FR-HOME-04, FR-SCHED-03)', () => {
  it('shows each state with its own wording, and next says (moved)', () => {
    const overrides = [
      override({ scheduleItemId: 'S_nap', localDate: '2026-10-18', action: 'skip' }),
      override({
        scheduleItemId: 'S_night',
        localDate: '2026-10-18',
        action: 'move',
        newStartTime: '21:00',
        newEndTime: '06:30',
      }),
    ];
    const m = run([], '2026-10-18T14:10:00.000Z', boot(), overrides);
    const planned = m.rows
      .filter((r) => r.kind === 'planned')
      .map((r) => `${r.time} ${r.title} [${r.state}] ${r.detail}`);
    expect(planned).toEqual([
      '06:30 Woke up [missed] No matching entry',
      '06:40 Cereal [missed] No matching entry',
      '09:30 Nap [skipped] Skipped for today',
      '11:30 Formula [missed] No matching entry',
      '21:00 Bedtime [planned] Moved from 20:30',
    ]);
    expect(m.next?.when).toBe('Next · 21:00 (moved) · in 5 h 50 m');
  });

  it('points to tomorrow when nothing is left today', () => {
    const b = boot({
      scheduleItems: [item({ id: 'S_cereal', activityTypeId: 'T_cereal', startTime: '06:40' })],
    });
    const m = run([], '2026-10-18T20:00:00.000Z', b);
    expect(m.next).toMatchObject({ when: 'Next · 06:40 tomorrow', tomorrow: true, row: null });
  });
});
