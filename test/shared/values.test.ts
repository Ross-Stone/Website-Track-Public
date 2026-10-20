import { describe, expect, it } from 'vitest';
import { compactValues, isFieldVisible, validateValues } from '../../src/shared/values';
import { field } from './fixtures';

const kind = field({
  id: 'k',
  activityTypeId: 'A',
  key: 'kind',
  label: 'Kind',
  fieldType: 'list',
  options: ['Wet', 'Dirty', 'Both'],
});
const colour = field({
  id: 'c',
  activityTypeId: 'A',
  key: 'colour',
  label: 'Colour',
  fieldType: 'image_picker',
  pickerSet: 'stool_colour',
  showWhen: { field: 'kind', in: ['Dirty', 'Both'] },
  required: true,
});
const amount = field({
  id: 'a',
  activityTypeId: 'A',
  key: 'amount',
  label: 'Amount',
  fieldType: 'number',
  decimals: 1,
  min: 0,
  max: 500,
});
const name = field({
  id: 'n',
  activityTypeId: 'A',
  key: 'name',
  label: 'Name',
  fieldType: 'text',
  maxLength: 5,
});
const flag = field({ id: 'f', activityTypeId: 'A', key: 'flag', label: 'Flag', fieldType: 'boolean' });
const old = field({
  id: 'o',
  activityTypeId: 'A',
  key: 'old',
  label: 'Old',
  fieldType: 'text',
  required: true,
  archivedAt: '2026-01-01',
});
const all = [kind, colour, amount, name, flag, old];
const msgs = (values: Record<string, string | number | boolean>, requireRequired = true) =>
  validateValues(all, values, { requireRequired }).map((p) => p.message);

describe('validateValues (FR-ACT-04)', () => {
  it('accepts valid values and empty optional fields', () => {
    expect(msgs({ kind: 'Wet', amount: 12.5, name: 'abc', flag: true })).toEqual([]);
    expect(msgs({})).toEqual([]);
  });

  it('checks numbers: type, range and decimals', () => {
    expect(msgs({ amount: 'x' })).toEqual(['Amount must be a number']);
    expect(msgs({ amount: -1 })).toEqual(['Amount must be at least 0']);
    expect(msgs({ amount: 501 })).toEqual(['Amount must be at most 500']);
    expect(msgs({ amount: 1.25 })).toEqual(['Amount must have at most 1 decimal places']);
    expect(msgs({ amount: 0.1 + 0.2 })).toEqual([]); // floating point noise is fine
  });

  it('checks text length, list options, yes/no and picker options', () => {
    expect(msgs({ name: 'abcdef' })).toEqual(['Name must be at most 5 characters']);
    expect(msgs({ kind: 'Damp' })).toEqual(['Kind must be one of the listed options']);
    expect(msgs({ flag: 'yes' })).toEqual(['Flag must be yes or no']);
    expect(msgs({ kind: 'Dirty', colour: 'Purple' })).toEqual(['Colour must be one of the picker options']);
  });

  it('only requires a field when it is shown (show_when) and not archived', () => {
    expect(msgs({ kind: 'Wet' })).toEqual([]);
    expect(msgs({ kind: 'Dirty' })).toEqual(['Colour is required']);
    expect(msgs({ kind: 'Dirty', colour: 'Mustard' })).toEqual([]);
    expect(msgs({ kind: 'Dirty' }, false)).toEqual([]);
  });

  it('rejects unknown keys but allows values on archived fields', () => {
    expect(msgs({ mystery: 1 })).toEqual(['is not a field of this activity']);
    expect(msgs({ old: 'kept' })).toEqual([]);
  });

  it('shows dependent fields only for matching values', () => {
    expect(isFieldVisible(colour, { kind: 'Both' })).toBe(true);
    expect(isFieldVisible(colour, {})).toBe(false);
    expect(compactValues({ a: '', b: 0, c: false })).toEqual({ b: 0, c: false });
  });
});
