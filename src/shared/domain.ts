// Domain entities as the API returns them (camelCase, booleans as booleans, JSON columns parsed).
// Shared by the client, the Worker and the pure logic modules.
import { z } from 'zod';
import { PALETTE, PICKER_SETS, ROLES } from './constants';

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export const UtcInstant = z.iso.datetime({ offset: false });

export const User = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  active: z.boolean(),
});
export type User = z.infer<typeof User>;

export const Child = z.object({
  id: z.string(),
  firstName: z.string(),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type Child = z.infer<typeof Child>;

export const SystemKey = z.enum(['overnight_sleep', 'medication', 'weight', 'height', 'poo', 'accident']);
export type SystemKey = z.infer<typeof SystemKey>;

export const ActivityType = z.object({
  id: z.string(),
  systemKey: SystemKey.nullable(),
  name: z.string(),
  kind: z.enum(['point', 'duration']),
  icon: z.string(),
  colour: z.enum(PALETTE),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type ActivityType = z.infer<typeof ActivityType>;

export const FieldType = z.enum(['number', 'text', 'list', 'boolean', 'image_picker']);
export type FieldType = z.infer<typeof FieldType>;

export const ShowWhen = z.object({ field: z.string(), in: z.array(z.string()) });
export type ShowWhen = z.infer<typeof ShowWhen>;

export const ActivityField = z.object({
  id: z.string(),
  activityTypeId: z.string(),
  key: z.string(),
  label: z.string(),
  fieldType: FieldType,
  unit: z.string().nullable(),
  decimals: z.number().int().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  maxLength: z.number().int().nullable(),
  options: z.array(z.string()).nullable(),
  pickerSet: z.enum(Object.keys(PICKER_SETS) as [keyof typeof PICKER_SETS]).nullable(),
  showWhen: ShowWhen.nullable(),
  required: z.boolean(),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type ActivityField = z.infer<typeof ActivityField>;

export const FieldValue = z.union([z.string(), z.number(), z.boolean()]);
export type FieldValue = z.infer<typeof FieldValue>;
export const FieldValues = z.record(z.string(), FieldValue);
export type FieldValues = z.infer<typeof FieldValues>;

export const ChildActivitySetting = z.object({
  childId: z.string(),
  activityTypeId: z.string(),
  enabled: z.boolean(),
  quickLog: z.boolean(),
  defaults: FieldValues,
  windowBeforeMin: z.number().int().min(0),
  windowAfterMin: z.number().int().min(0),
});
export type ChildActivitySetting = z.infer<typeof ChildActivitySetting>;

export const ScheduleItem = z.object({
  id: z.string(),
  childId: z.string(),
  activityTypeId: z.string(),
  label: z.string().nullable(),
  startTime: ClockTime,
  endTime: ClockTime.nullable(),
  /** Bit 0 = Monday … bit 6 = Sunday. */
  daysMask: z.number().int().min(1).max(127),
  repeat: z.enum(['weekly', 'fortnightly']),
  anchorDate: IsoDate.nullable(),
  validFrom: IsoDate.nullable(),
  validUntil: IsoDate.nullable(),
  autoConfirm: z.boolean(),
  note: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
export type ScheduleItem = z.infer<typeof ScheduleItem>;

export const ScheduleOverride = z.object({
  id: z.string(),
  childId: z.string(),
  scheduleItemId: z.string(),
  localDate: IsoDate,
  action: z.enum(['skip', 'move']),
  newStartTime: ClockTime.nullable(),
  newEndTime: ClockTime.nullable(),
  createdBy: z.string(),
});
export type ScheduleOverride = z.infer<typeof ScheduleOverride>;

export const Medicine = z.object({
  id: z.string(),
  childId: z.string(),
  name: z.string(),
  dose: z.number(),
  doseUnit: z.string(),
  minGapMin: z.number().int().min(1),
  maxPer24h: z.number().int().min(1),
  countsTowardsAlternating: z.boolean(),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type Medicine = z.infer<typeof Medicine>;

export const Entry = z.object({
  id: z.string(),
  childId: z.string(),
  activityTypeId: z.string(),
  startUtc: UtcInstant,
  endUtc: UtcInstant.nullable(),
  tz: z.string(),
  localDate: IsoDate,
  values: FieldValues,
  medicineId: z.string().nullable(),
  dose: z.number().nullable(),
  doseUnit: z.string().nullable(),
  note: z.string().nullable(),
  scheduleItemId: z.string().nullable(),
  autoConfirmed: z.boolean(),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  deletedBy: z.string().nullable(),
});
export type Entry = z.infer<typeof Entry>;
