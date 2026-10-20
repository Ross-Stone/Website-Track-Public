// Validation of entry field values and per-child defaults against an activity type's fields (FR-ACT-04).
// Shared so the log form and the API apply exactly the same rules.
import { PICKER_SETS } from './constants';
import type { ActivityField, FieldValue, FieldValues } from './domain';

export interface ValueProblem {
  key: string;
  message: string;
}

/** Is the field shown, given the other values (show_when, e.g. stool colour only when Kind is Dirty or Both)? */
export function isFieldVisible(field: ActivityField, values: FieldValues): boolean {
  if (!field.showWhen) return true;
  const v = values[field.showWhen.field];
  return typeof v === 'string' && field.showWhen.in.includes(v);
}

function checkOne(field: ActivityField, value: FieldValue): string | null {
  switch (field.fieldType) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (field.min !== null && value < field.min) return `must be at least ${field.min}`;
      if (field.max !== null && value > field.max) return `must be at most ${field.max}`;
      if (field.decimals !== null) {
        const scaled = value * 10 ** field.decimals;
        if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
          return field.decimals === 0
            ? 'must be a whole number'
            : `must have at most ${field.decimals} decimal places`;
        }
      }
      return null;
    }
    case 'text':
      if (typeof value !== 'string') return 'must be text';
      if (field.maxLength !== null && value.length > field.maxLength)
        return `must be at most ${field.maxLength} characters`;
      return null;
    case 'list':
      if (typeof value !== 'string' || !(field.options ?? []).includes(value))
        return 'must be one of the listed options';
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be yes or no';
    case 'image_picker': {
      const options: readonly string[] = field.pickerSet ? PICKER_SETS[field.pickerSet] : [];
      return typeof value === 'string' && options.includes(value)
        ? null
        : 'must be one of the picker options';
    }
  }
}

/**
 * Checks values for an entry (or defaults when `requireRequired` is false).
 *
 * - Unknown keys are rejected. Archived fields may keep existing values (FR-ACT-04 AC2).
 * - Empty strings are treated as "no value".
 * - Required, non-archived, visible fields must have a value when `requireRequired` is true.
 */
export function validateValues(
  fields: ActivityField[],
  values: FieldValues,
  opts: { requireRequired: boolean },
): ValueProblem[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const problems: ValueProblem[] = [];
  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) {
      problems.push({ key, message: 'is not a field of this activity' });
      continue;
    }
    if (value === '') continue;
    const msg = checkOne(field, value);
    if (msg) problems.push({ key, message: `${field.label} ${msg}` });
  }
  if (opts.requireRequired) {
    for (const f of fields) {
      if (!f.required || f.archivedAt || !isFieldVisible(f, values)) continue;
      const v = values[f.key];
      if (v === undefined || v === '') problems.push({ key: f.key, message: `${f.label} is required` });
    }
  }
  return problems;
}

/** Drops empty-string values so they aren't stored. */
export function compactValues(values: FieldValues): FieldValues {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
}
