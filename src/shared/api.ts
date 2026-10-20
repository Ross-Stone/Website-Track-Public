// Zod schemas for API payloads shared by the client and the Worker (TECH-01, TECH-11).
import { z } from 'zod';
import { BACKUP_TABLES, type BackupTable } from './backup';
import { ACTIVITY_ICONS, PALETTE, ROLES } from './constants';
import {
  ActivityField,
  ActivityType,
  Child,
  ChildActivitySetting,
  ClockTime,
  Entry,
  FieldType,
  FieldValues,
  IsoDate,
  Medicine,
  ScheduleItem,
  ScheduleOverride,
  ShowWhen,
  User,
  UtcInstant,
} from './domain';
import { isValidTimeZone } from './time';

export const ErrorCode = z.enum([
  'unauthenticated',
  'not_allowed',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'unavailable',
  'server_misconfigured',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Expected a ULID');
export const TimeZone = z.string().refine(isValidTimeZone, 'Unknown time zone');

// ---------- session ----------

export const Me = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
});
export type Me = z.infer<typeof Me>;

export const Version = z.object({ version: z.number().int() });
export type Version = z.infer<typeof Version>;

/** Names only: every role needs them for "Logged by Jamie". The full list is Admin-only (/api/users). */
export const UserName = z.object({ id: z.string(), displayName: z.string() });
export type UserName = z.infer<typeof UserName>;

export const Bootstrap = z.object({
  version: z.number().int(),
  me: Me,
  users: z.array(UserName),
  children: z.array(Child),
  activityTypes: z.array(ActivityType),
  fields: z.array(ActivityField),
  childActivitySettings: z.array(ChildActivitySetting),
  scheduleItems: z.array(ScheduleItem),
  medicines: z.array(Medicine),
  appSettings: z.record(z.string(), z.string()),
  /** Latest Weight and Height entry per child (FR-CHILD-03). */
  latestMeasurements: z.array(Entry),
});
export type Bootstrap = z.infer<typeof Bootstrap>;

// ---------- entries ----------

export const EntriesQuery = z.object({
  from: UtcInstant,
  to: UtcInstant,
  /** "1": also return running duration entries, whenever they started (FR-LOG-04 AC4). */
  running: z.enum(['0', '1']).optional(),
});

export const EntriesResponse = z.object({ entries: z.array(Entry) });
export type EntriesResponse = z.infer<typeof EntriesResponse>;

/** Body of PUT /api/entries/:id. The server derives local_date, who and when. */
export const EntryInput = z
  .object({
    childId: z.string().min(1),
    activityTypeId: z.string().min(1),
    startUtc: UtcInstant,
    endUtc: UtcInstant.nullable().default(null),
    tz: TimeZone,
    values: FieldValues.default({}),
    medicineId: z.string().nullable().default(null),
    dose: z.number().positive().nullable().default(null),
    doseUnit: z.string().trim().min(1).max(20).nullable().default(null),
    note: z.string().max(2000).nullable().default(null),
    scheduleItemId: z.string().nullable().default(null),
  })
  .refine((e) => e.endUtc === null || Date.parse(e.endUtc) >= Date.parse(e.startUtc), {
    message: 'End must not be before start',
    path: ['endUtc'],
  });
export type EntryInput = z.input<typeof EntryInput>;

export const EntryResponse = z.object({ entry: Entry });

export const AutoConfirmInput = z.object({
  /** The phone's local date (today). */
  date: IsoDate,
  tz: TimeZone,
  now: UtcInstant,
});
export type AutoConfirmInput = z.infer<typeof AutoConfirmInput>;
export const AutoConfirmResponse = z.object({ created: z.array(Entry) });

// ---------- schedule ----------

export const OverridesResponse = z.object({ overrides: z.array(ScheduleOverride) });

export const OverrideInput = z
  .object({
    childId: z.string().min(1),
    scheduleItemId: z.string().min(1),
    localDate: IsoDate,
    action: z.enum(['skip', 'move']),
    newStartTime: ClockTime.nullable().default(null),
    newEndTime: ClockTime.nullable().default(null),
  })
  .refine((o) => o.action === 'skip' || o.newStartTime !== null, {
    message: 'A move needs a new start time',
    path: ['newStartTime'],
  });
export type OverrideInput = z.input<typeof OverrideInput>;

export const ScheduleItemInput = z
  .object({
    childId: z.string().min(1),
    activityTypeId: z.string().min(1),
    label: z.string().trim().max(60).nullable().default(null),
    startTime: ClockTime,
    endTime: ClockTime.nullable().default(null),
    daysMask: z.number().int().min(1).max(127),
    repeat: z.enum(['weekly', 'fortnightly']).default('weekly'),
    anchorDate: IsoDate.nullable().default(null),
    validFrom: IsoDate.nullable().default(null),
    validUntil: IsoDate.nullable().default(null),
    autoConfirm: z.boolean().default(false),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .refine((s) => !s.validFrom || !s.validUntil || s.validFrom <= s.validUntil, {
    message: 'Start date must be on or before end date',
    path: ['validUntil'],
  })
  .refine((s) => s.repeat === 'weekly' || s.anchorDate !== null || s.validFrom !== null, {
    message: 'Every 2 weeks needs a starting week',
    path: ['anchorDate'],
  });
export type ScheduleItemInput = z.input<typeof ScheduleItemInput>;

export const ScheduleItemsResponse = z.object({ scheduleItems: z.array(ScheduleItem) });
export const ScheduleItemResponse = z.object({ scheduleItem: ScheduleItem });

// ---------- activity types and fields ----------

const Name = z.string().trim().min(1).max(40);

export const ActivityTypeCreate = z.object({
  name: Name,
  kind: z.enum(['point', 'duration']),
  icon: z.enum(ACTIVITY_ICONS),
  colour: z.enum(PALETTE),
});
export const ActivityTypeUpdate = z
  .object({
    name: Name,
    kind: z.enum(['point', 'duration']),
    icon: z.enum(ACTIVITY_ICONS),
    colour: z.enum(PALETTE),
    sortOrder: z.number().int().min(0),
    archived: z.boolean(),
  })
  .partial();
export const ActivityTypeResponse = z.object({ activityType: ActivityType });

export const FieldCreate = z.object({
  label: z.string().trim().min(1).max(40),
  fieldType: FieldType,
  unit: z.string().trim().max(20).nullable().default(null),
  decimals: z.number().int().min(0).max(4).nullable().default(null),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  maxLength: z.number().int().min(1).max(500).nullable().default(null),
  options: z.array(z.string().trim().min(1).max(60)).max(50).nullable().default(null),
  pickerSet: z.enum(['stool_colour', 'stool_consistency']).nullable().default(null),
  showWhen: ShowWhen.nullable().default(null),
  required: z.boolean().default(false),
});
export const FieldUpdate = z
  .object({
    label: z.string().trim().min(1).max(40),
    unit: z.string().trim().max(20).nullable(),
    decimals: z.number().int().min(0).max(4).nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    maxLength: z.number().int().min(1).max(500).nullable(),
    options: z.array(z.string().trim().min(1).max(60)).max(50).nullable(),
    showWhen: ShowWhen.nullable(),
    required: z.boolean(),
    sortOrder: z.number().int().min(0),
    archived: z.boolean(),
  })
  .partial();
export const FieldResponse = z.object({ field: ActivityField });

export const ChildActivitySettingInput = z.object({
  enabled: z.boolean(),
  quickLog: z.boolean(),
  defaults: FieldValues.default({}),
  windowBeforeMin: z.number().int().min(0).max(720),
  windowAfterMin: z.number().int().min(0).max(720),
});
export const ChildActivitySettingResponse = z.object({ setting: ChildActivitySetting });

// ---------- medicines ----------

const MedicineFields = {
  name: z.string().trim().min(1).max(40),
  dose: z.number().positive(),
  doseUnit: z.string().trim().min(1).max(20),
  minGapMin: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60),
  maxPer24h: z.number().int().min(1).max(48),
  countsTowardsAlternating: z.boolean(),
  sortOrder: z.number().int().min(0),
};
export const MedicineCreate = z.object({
  childId: z.string().min(1),
  ...MedicineFields,
  doseUnit: MedicineFields.doseUnit.default('ml'),
  countsTowardsAlternating: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});
export const MedicineUpdate = z.object({ ...MedicineFields, archived: z.boolean() }).partial();
export const MedicineResponse = z.object({ medicine: Medicine });

// ---------- children and users (Admin) ----------

export const ChildCreate = z.object({ firstName: Name, sortOrder: z.number().int().min(0).optional() });
export const ChildUpdate = z
  .object({ firstName: Name, sortOrder: z.number().int().min(0), archived: z.boolean() })
  .partial();
export const ChildResponse = z.object({ child: Child });

export const UserCreate = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  displayName: z.string().trim().min(1).max(40),
  role: z.enum(ROLES),
});
export const UserUpdate = z
  .object({ displayName: z.string().trim().min(1).max(40), role: z.enum(ROLES), active: z.boolean() })
  .partial();
export const UsersResponse = z.object({ users: z.array(User) });
export const UserResponse = z.object({ user: User });

// ---------- export ----------

export const ExportQuery = z
  .object({ from: IsoDate, to: IsoDate, child: z.string().min(1).default('all') })
  .refine((q) => q.from <= q.to, { message: 'From must be on or before To', path: ['to'] });

/** The server builds CSVs for up to this many days; the app builds longer ranges itself (agreed Q9). */
export const MAX_SERVER_EXPORT_DAYS = 31;

// ---------- backup, import, storage ----------

export const BackupEntriesPage = z.object({ rows: z.array(z.unknown()), next: z.string().nullable() });
export type BackupEntriesPage = z.infer<typeof BackupEntriesPage>;

export const ImportStartResponse = z.object({ importId: z.string() });

/** POST /api/import: swap in a staged import. `counts` are rows per table, checked against what arrived. */
export const ImportCommit = z.object({
  importId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  confirm: z.literal('REPLACE', { message: 'Type REPLACE to confirm.' }),
  schemaVersion: z.number().int(),
  counts: z.object(
    Object.fromEntries(BACKUP_TABLES.map((t) => [t, z.number().int().min(0)])) as Record<
      BackupTable,
      z.ZodNumber
    >,
  ),
});
export type ImportCommit = z.input<typeof ImportCommit>;

export const StorageInfo = z.object({
  bytes: z.number(),
  limitBytes: z.number(),
  warningRatio: z.number(),
});
export type StorageInfo = z.infer<typeof StorageInfo>;
