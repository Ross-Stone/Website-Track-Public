import { describe, expect, it } from 'vitest';
import { buildCsv, csvCell, csvFileName } from '../../src/shared/csv';
import { entry, field, medicine, type } from './fixtures';

const types = [
  type({ id: 'T_formula', name: 'Formula', sortOrder: 3 }),
  type({ id: 'T_cereal', name: 'Cereal', sortOrder: 2 }),
  type({ id: 'T_nap', name: 'Nap', kind: 'duration', sortOrder: 1 }),
  type({ id: 'T_med', name: 'Medication', systemKey: 'medication', sortOrder: 13 }),
  type({ id: 'T_bath', name: 'Bath', sortOrder: 6 }),
];
const fields = [
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
    sortOrder: 0,
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
    activityTypeId: 'T_bath',
    key: 'bubbles',
    label: 'Bubbles',
    fieldType: 'boolean',
    archivedAt: '2026-01-01T00:00:00Z',
  }),
  field({
    id: 'F5',
    activityTypeId: 'T_formula',
    key: 'brand',
    label: 'Brand',
    fieldType: 'text',
    sortOrder: 1,
  }),
];
const children = [
  { id: 'sam', firstName: 'Sam', sortOrder: 0, archivedAt: null },
  { id: 'zoë', firstName: 'Zoë', sortOrder: 1, archivedAt: null },
];
const users = [
  { id: 'alex', displayName: 'Alex' },
  { id: 'jamie', displayName: 'María' },
];
const medicines = [medicine({ id: 'medA', name: 'Medicine A' })];

function rows(csv: string): string[] {
  expect(csv.startsWith('﻿')).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(1, -2).split('\r\n');
}

describe('buildCsv (FR-HIST-04)', () => {
  const formula = entry({
    id: 'a',
    activityTypeId: 'T_formula',
    startUtc: '2026-10-18T10:34:00.000Z',
    values: { amount: 230 },
    createdBy: 'jamie',
    createdAt: '2026-10-18T10:35:00.000Z',
    updatedAt: '2026-10-18T10:35:00.000Z',
    updatedBy: 'jamie',
  });
  const cereal = entry({
    id: 'b',
    activityTypeId: 'T_cereal',
    startUtc: '2026-10-18T05:42:00.000Z',
    values: { variety: 'Berry', amount: 12 },
    note: 'Ate it all, "messy"\nagain',
    updatedBy: 'jamie',
    updatedAt: '2026-10-18T08:30:00.000Z',
  });
  const nap = entry({
    id: 'c',
    activityTypeId: 'T_nap',
    startUtc: '2026-10-18T08:28:00.000Z',
    endUtc: '2026-10-18T09:51:00.000Z',
  });
  const dose = entry({
    id: 'd',
    activityTypeId: 'T_med',
    startUtc: '2026-10-18T07:10:00.000Z',
    medicineId: 'medA',
    dose: 5,
    doseUnit: 'ml',
  });
  const deleted = entry({
    id: 'x',
    activityTypeId: 'T_formula',
    startUtc: '2026-10-18T11:00:00.000Z',
    values: { amount: 99 },
    deletedAt: '2026-10-18T11:01:00Z',
  });
  const overnight = entry({
    id: 'e',
    activityTypeId: 'T_nap',
    startUtc: '2026-10-18T19:34:00.000Z',
    endUtc: '2026-10-19T05:28:00.000Z',
    autoConfirmed: true,
  });

  const csv = buildCsv({
    entries: [formula, cereal, nap, dose, deleted, overnight],
    children,
    activityTypes: types,
    fields,
    medicines,
    users,
  });
  const lines = rows(csv);

  it('has the AC2 columns, with field columns only for fields present, in type then field order', () => {
    expect(lines[0]).toBe(
      'Child,Date,Start time,End time,Duration (minutes),Time zone,Activity,Medicine,Dose,Dose unit,' +
        'Cereal – Variety,Cereal – Amount (scoops),Formula – Amount (ml),' +
        'Note,Logged by,Logged at,Last edited by,Last edited at,Auto',
    );
  });

  it('writes one row per non-deleted entry, in time order', () => {
    expect(lines).toHaveLength(6); // header + 5
    expect(csv).not.toContain(',99,');
  });

  it('formats a point entry with its field values', () => {
    expect(lines[4]).toBe(
      'Sam,18/10/2026,11:34,,,Europe/London,Formula,,,,,,230,,María,18/10/2026 11:35,,,No',
    );
  });

  it('quotes notes with commas, quotes and newlines, and shows who last edited', () => {
    expect(lines[1]).toBe(
      'Sam,18/10/2026,06:42,,,Europe/London,Cereal,,,,Berry,12,,"Ate it all, ""messy""\nagain",Alex,18/10/2026 06:42,María,18/10/2026 09:30,No',
    );
  });

  it('writes medicine, dose and unit for medication', () => {
    expect(lines[2]).toBe(
      'Sam,18/10/2026,08:10,,,Europe/London,Medication,Medicine A,5,ml,,,,,Alex,18/10/2026 08:10,,,No',
    );
  });

  it('writes end time and duration for duration entries, including across midnight (FR-HIST-03)', () => {
    expect(lines[3]).toContain('Sam,18/10/2026,09:28,10:51,83,Europe/London,Nap');
    expect(lines[5]).toMatch(/^Sam,18\/10\/2026,20:34,06:28,594,Europe\/London,Nap,.*,Yes$/);
  });

  it('shows times in the zone each entry was logged in', () => {
    const abroad = entry({
      id: 's',
      activityTypeId: 'T_bath',
      startUtc: '2026-10-18T17:30:00.000Z',
      tz: 'Europe/Madrid',
      localDate: '2026-10-18',
    });
    const out = rows(
      buildCsv({ entries: [abroad], children, activityTypes: types, fields, medicines, users }),
    );
    expect(out[1]).toMatch(/^Sam,18\/10\/2026,19:30,,,Europe\/Madrid,Bath,/);
  });

  it('keeps archived fields that still have values, and formats yes/no', () => {
    const bath = entry({
      id: 'h',
      activityTypeId: 'T_bath',
      startUtc: '2026-10-18T18:30:00.000Z',
      values: { bubbles: true },
    });
    const out = rows(buildCsv({ entries: [bath], children, activityTypes: types, fields, medicines, users }));
    expect(out[0]).toContain('Bath – Bubbles,Note');
    expect(out[1]).toContain(',Bath,,,,Yes,');
  });

  it('orders children by their sort order and keeps accents', () => {
    const z = entry({
      id: 'z',
      childId: 'zoë',
      activityTypeId: 'T_bath',
      startUtc: '2026-10-17T18:00:00.000Z',
    });
    const h = entry({
      id: 'h',
      childId: 'sam',
      activityTypeId: 'T_bath',
      startUtc: '2026-10-18T18:00:00.000Z',
    });
    const out = rows(buildCsv({ entries: [z, h], children, activityTypes: types, fields, medicines, users }));
    expect(out.slice(1).map((l) => l.split(',')[0])).toEqual(['Sam', 'Zoë']);
  });

  it('writes only the header when there is nothing to export', () => {
    expect(
      rows(buildCsv({ entries: [], children, activityTypes: types, fields, medicines, users })),
    ).toHaveLength(1);
  });
});

describe('csvCell', () => {
  it('quotes only when needed', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(null)).toBe('');
  });

  it('neutralises text that a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+44 7700')).toBe("'+44 7700");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('-ish')).toBe('-ish');
  });
});

it('names the file per AC3', () => {
  expect(csvFileName('2026-10-11', '2026-10-17')).toBe('track-export-2026-10-11-to-2026-10-17.csv');
});
