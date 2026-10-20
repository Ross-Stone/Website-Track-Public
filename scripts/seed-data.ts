// Initial setup data (requirements section 8 and FR-ACT-01): the built-in activity types and fields.
// This is the single source for the seed migration (migrations/0001_seed.sql), which
// `npm run seed:generate` writes. Nothing here is imported by the app at runtime.
//
// No users, children, schedule or medicines are seeded. The first Admin comes from ADMIN_EMAIL at deploy
// time (scripts/admin-sql.mjs), and the Admin adds children in Settings.
import type { ActivityIcon, PaletteColour, PickerSet } from '../src/shared/constants';

export interface SeedField {
  key: string;
  label: string;
  fieldType: 'number' | 'text' | 'list' | 'boolean' | 'image_picker';
  unit?: string;
  decimals?: number;
  min?: number;
  maxLength?: number;
  options?: string[];
  pickerSet?: PickerSet;
  showWhen?: { field: string; in: string[] };
  required?: boolean;
}

export interface SeedActivityType {
  /** Stable reference used inside this file only. */
  ref: string;
  systemKey?: 'overnight_sleep' | 'medication' | 'weight' | 'height' | 'poo' | 'accident';
  name: string;
  kind: 'point' | 'duration';
  icon: ActivityIcon;
  colour: PaletteColour;
  fields: SeedField[];
}

export const SEED_AT = '2026-10-18T00:00:00.000Z';

const stoolPickers = (showWhen?: SeedField['showWhen']): SeedField[] => [
  { key: 'colour', label: 'Colour', fieldType: 'image_picker', pickerSet: 'stool_colour', showWhen },
  {
    key: 'consistency',
    label: 'Consistency',
    fieldType: 'image_picker',
    pickerSet: 'stool_consistency',
    showWhen,
  },
];
const what: SeedField = { key: 'what', label: 'What', fieldType: 'text', maxLength: 100 };

/**
 * Exactly the built-in types and fields of FR-ACT-01, in that order.
 * "Note" on every type is the built-in `entries.note` column, and Medicine/Dose are the built-in
 * `entries.medicine_id/dose/dose_unit` columns. None of these are activity_fields rows (agreed Q2).
 */
export const seedActivityTypes: SeedActivityType[] = [
  {
    ref: 'overnight',
    systemKey: 'overnight_sleep',
    name: 'Overnight sleep',
    kind: 'duration',
    icon: 'bed-double',
    colour: 'indigo',
    fields: [],
  },
  { ref: 'nap', name: 'Nap', kind: 'duration', icon: 'moon', colour: 'violet', fields: [] },
  {
    ref: 'cereal',
    name: 'Cereal',
    kind: 'point',
    icon: 'soup',
    colour: 'orange',
    fields: [
      {
        key: 'variety',
        label: 'Variety',
        fieldType: 'list',
        options: ['Berry', 'Creamed', 'Banana', 'Multi'],
      },
      { key: 'amount', label: 'Amount', fieldType: 'number', unit: 'scoops', decimals: 0, min: 0 },
    ],
  },
  {
    ref: 'formula',
    name: 'Formula',
    kind: 'point',
    icon: 'milk',
    colour: 'blue',
    fields: [{ key: 'amount', label: 'Amount', fieldType: 'number', unit: 'ml', decimals: 0, min: 0 }],
  },
  { ref: 'food', name: 'Food', kind: 'point', icon: 'apple', colour: 'green', fields: [what] },
  { ref: 'puree', name: 'Purée', kind: 'point', icon: 'carrot', colour: 'green', fields: [what] },
  { ref: 'bath', name: 'Bath', kind: 'point', icon: 'bath', colour: 'teal', fields: [] },
  { ref: 'nursery', name: 'Nursery', kind: 'duration', icon: 'school', colour: 'slate', fields: [] },
  { ref: 'school', name: 'School', kind: 'duration', icon: 'backpack', colour: 'amber', fields: [] },
  { ref: 'club', name: 'Club', kind: 'duration', icon: 'trophy', colour: 'pink', fields: [what] },
  { ref: 'event', name: 'Event', kind: 'duration', icon: 'ticket', colour: 'teal', fields: [what] },
  {
    ref: 'poo',
    systemKey: 'poo',
    name: 'Poo',
    kind: 'point',
    icon: 'droplet',
    colour: 'brown',
    fields: stoolPickers(),
  },
  {
    ref: 'accident',
    systemKey: 'accident',
    name: 'Accident',
    kind: 'point',
    icon: 'shirt',
    colour: 'brown',
    fields: [
      { key: 'kind', label: 'Kind', fieldType: 'list', options: ['Wet', 'Dirty', 'Both'] },
      ...stoolPickers({ field: 'kind', in: ['Dirty', 'Both'] }),
    ],
  },
  {
    ref: 'medication',
    systemKey: 'medication',
    name: 'Medication',
    kind: 'point',
    icon: 'pill',
    colour: 'red',
    fields: [],
  },
  {
    ref: 'weight',
    systemKey: 'weight',
    name: 'Weight',
    kind: 'point',
    icon: 'weight',
    colour: 'slate',
    fields: [
      {
        key: 'weight',
        label: 'Weight',
        fieldType: 'number',
        unit: 'kg',
        decimals: 2,
        min: 0,
        required: true,
      },
    ],
  },
  {
    ref: 'height',
    systemKey: 'height',
    name: 'Height',
    kind: 'point',
    icon: 'ruler',
    colour: 'slate',
    fields: [
      {
        key: 'height',
        label: 'Height',
        fieldType: 'number',
        unit: 'cm',
        decimals: 1,
        min: 0,
        required: true,
      },
    ],
  },
];
