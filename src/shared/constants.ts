// Values shared by the client, the Worker and the seed script.

export const ROLES = ['reader', 'writer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** True when `role` is at least `required` (reader < writer < admin). */
export function roleAtLeast(role: Role, required: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(required);
}

/** Fixed activity colour palette (FR-ACT-03). Token names map to CSS variables in tokens.css. */
export const PALETTE = [
  'amber',
  'orange',
  'blue',
  'green',
  'violet',
  'red',
  'brown',
  'teal',
  'indigo',
  'slate',
  'pink',
] as const;
export type PaletteColour = (typeof PALETTE)[number];

/** Built-in Lucide icon set users choose from (FR-ACT-03). Values are Lucide icon names. */
export const ACTIVITY_ICONS = [
  'bed-double',
  'moon',
  'sun',
  'soup',
  'milk',
  'apple',
  'carrot',
  'utensils',
  'cookie',
  'glass-water',
  'bath',
  'school',
  'backpack',
  'trophy',
  'ticket',
  'droplet',
  'shirt',
  'pill',
  'thermometer',
  'weight',
  'ruler',
  'baby',
  'music',
  'bike',
  'footprints',
  'book-open',
  'paintbrush',
  'waves',
  'puzzle',
  'heart',
  'star',
  'clock',
] as const;
export type ActivityIcon = (typeof ACTIVITY_ICONS)[number];

/** Built-in image picker option sets (FR-ACT-07). */
export const PICKER_SETS = {
  stool_colour: [
    'Yellow',
    'Mustard',
    'Orange',
    'Green',
    'Brown',
    'Black',
    'Red or red streaks',
    'White or pale grey',
  ],
  stool_consistency: ['Watery', 'Runny', 'Soft', 'Formed', 'Hard pellets'],
} as const;
export type PickerSet = keyof typeof PICKER_SETS;

/** Free-plan maximum D1 database size (FR-SET-12 AC2). Change here if the plan or limit changes. */
export const STORAGE_LIMIT_BYTES = 500 * 1024 * 1024;
export const STORAGE_WARNING_RATIO = 0.8;

export const DEFAULT_WINDOW_MIN = 120;
