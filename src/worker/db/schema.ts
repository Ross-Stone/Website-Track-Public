// Drizzle schema for D1 (requirements section 7.10, TECH-10).
// Timestamps are UTC ISO strings. IDs are ULIDs (text). Booleans are stored as 0/1 integers.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

const bool = (name: string) => integer(name, { mode: 'boolean' });

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['admin', 'writer', 'reader'] }).notNull(),
    active: bool('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_role_valid', sql`${t.role} in ('admin', 'writer', 'reader')`),
  ],
);

export const children = sqliteTable('children', {
  id: text('id').primaryKey(),
  firstName: text('first_name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: text('archived_at'),
  ...timestamps,
});

export const activityTypes = sqliteTable(
  'activity_types',
  {
    id: text('id').primaryKey(),
    systemKey: text('system_key', {
      enum: ['overnight_sleep', 'medication', 'weight', 'height', 'poo', 'accident'],
    }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['point', 'duration'] }).notNull(),
    icon: text('icon').notNull(),
    colour: text('colour').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: text('archived_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('activity_types_system_key_unique').on(t.systemKey),
    check('activity_types_kind_valid', sql`${t.kind} in ('point', 'duration')`),
  ],
);

export const activityFields = sqliteTable(
  'activity_fields',
  {
    id: text('id').primaryKey(),
    activityTypeId: text('activity_type_id')
      .notNull()
      .references(() => activityTypes.id),
    key: text('key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type', {
      enum: ['number', 'text', 'list', 'boolean', 'image_picker'],
    }).notNull(),
    unit: text('unit'),
    decimals: integer('decimals'),
    min: real('min'),
    max: real('max'),
    maxLength: integer('max_length'),
    /** JSON array of strings, for list fields. */
    options: text('options'),
    pickerSet: text('picker_set', { enum: ['stool_colour', 'stool_consistency'] }),
    /** JSON, e.g. {"field":"kind","in":["Dirty","Both"]}. */
    showWhen: text('show_when'),
    required: bool('required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: text('archived_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('activity_fields_type_key_unique').on(t.activityTypeId, t.key)],
);

export const childActivitySettings = sqliteTable(
  'child_activity_settings',
  {
    childId: text('child_id')
      .notNull()
      .references(() => children.id),
    activityTypeId: text('activity_type_id')
      .notNull()
      .references(() => activityTypes.id),
    enabled: bool('enabled').notNull().default(true),
    quickLog: bool('quick_log').notNull().default(false),
    /** JSON object keyed by field key. */
    defaults: text('defaults').notNull().default('{}'),
    windowBeforeMin: integer('window_before_min').notNull().default(120),
    windowAfterMin: integer('window_after_min').notNull().default(120),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.childId, t.activityTypeId] })],
);

export const scheduleItems = sqliteTable(
  'schedule_items',
  {
    id: text('id').primaryKey(),
    childId: text('child_id')
      .notNull()
      .references(() => children.id),
    activityTypeId: text('activity_type_id')
      .notNull()
      .references(() => activityTypes.id),
    label: text('label'),
    startTime: text('start_time').notNull(),
    endTime: text('end_time'),
    /** Bit 0 = Monday … bit 6 = Sunday. */
    daysMask: integer('days_mask').notNull(),
    repeat: text('repeat', { enum: ['weekly', 'fortnightly'] })
      .notNull()
      .default('weekly'),
    anchorDate: text('anchor_date'),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    autoConfirm: bool('auto_confirm').notNull().default(false),
    note: text('note'),
    archivedAt: text('archived_at'),
    ...timestamps,
  },
  (t) => [
    index('schedule_items_child_idx').on(t.childId),
    check('schedule_items_days_mask_valid', sql`${t.daysMask} between 1 and 127`),
  ],
);

export const scheduleOverrides = sqliteTable(
  'schedule_overrides',
  {
    id: text('id').primaryKey(),
    childId: text('child_id')
      .notNull()
      .references(() => children.id),
    scheduleItemId: text('schedule_item_id')
      .notNull()
      .references(() => scheduleItems.id),
    localDate: text('local_date').notNull(),
    action: text('action', { enum: ['skip', 'move'] }).notNull(),
    newStartTime: text('new_start_time'),
    newEndTime: text('new_end_time'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('schedule_overrides_item_date_unique').on(t.scheduleItemId, t.localDate),
    index('schedule_overrides_child_date_idx').on(t.childId, t.localDate),
  ],
);

export const medicines = sqliteTable('medicines', {
  id: text('id').primaryKey(),
  childId: text('child_id')
    .notNull()
    .references(() => children.id),
  name: text('name').notNull(),
  dose: real('dose').notNull(),
  doseUnit: text('dose_unit').notNull().default('ml'),
  minGapMin: integer('min_gap_min').notNull(),
  maxPer24h: integer('max_per_24h').notNull(),
  countsTowardsAlternating: bool('counts_towards_alternating').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: text('archived_at'),
  ...timestamps,
});

export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    childId: text('child_id')
      .notNull()
      .references(() => children.id),
    activityTypeId: text('activity_type_id')
      .notNull()
      .references(() => activityTypes.id),
    startUtc: text('start_utc').notNull(),
    /** Null = running (duration types only). */
    endUtc: text('end_utc'),
    tz: text('tz').notNull(),
    localDate: text('local_date').notNull(),
    /** JSON object keyed by field key. */
    values: text('values').notNull().default('{}'),
    medicineId: text('medicine_id').references(() => medicines.id),
    dose: real('dose'),
    doseUnit: text('dose_unit'),
    note: text('note'),
    scheduleItemId: text('schedule_item_id').references(() => scheduleItems.id),
    autoConfirmed: bool('auto_confirmed').notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: text('deleted_at'),
    deletedBy: text('deleted_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('entries_child_date_idx').on(t.childId, t.localDate),
    index('entries_child_type_start_idx').on(t.childId, t.activityTypeId, t.startUtc),
    index('entries_child_end_idx').on(t.childId, t.endUtc),
    uniqueIndex('entries_auto_confirm_unique')
      .on(t.scheduleItemId, t.localDate)
      .where(sql`auto_confirmed = 1`),
  ],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  ...timestamps,
});

/** Single row (id = 1). `version` is bumped in the same batch as every write (TECH-09). */
export const syncState = sqliteTable(
  'sync_state',
  {
    id: integer('id').primaryKey(),
    version: integer('version').notNull().default(0),
  },
  (t) => [check('sync_state_single_row', sql`${t.id} = 1`)],
);

/**
 * Holding area for an import in progress (FR-SET-11, agreed Q9). Each row is one uploaded chunk: a JSON
 * array of backup rows for one table. POST /api/import swaps them in atomically, then clears them.
 * One row per chunk rather than per backup row keeps an import's extra rows written small (TECH-14).
 */
export const importStaging = sqliteTable(
  'import_staging',
  {
    importId: text('import_id').notNull(),
    tbl: text('tbl').notNull(),
    seq: integer('seq').notNull(),
    data: text('data').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.importId, t.tbl, t.seq] }),
    check('import_staging_data_array', sql`json_type(${t.data}) = 'array'`),
  ],
);
