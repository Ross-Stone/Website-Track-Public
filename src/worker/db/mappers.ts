// Row → API shape. JSON text columns are parsed here; everything else Drizzle already maps.
import type {
  ActivityField,
  ActivityType,
  Child,
  ChildActivitySetting,
  Entry,
  FieldValues,
  Medicine,
  ScheduleItem,
  ScheduleOverride,
  User,
} from '../../shared/domain';
import type * as s from './schema';

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

const json = <T>(text: string | null, fallback: T): T => {
  if (text === null || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

export const toUser = (r: Row<typeof s.users>): User => ({
  id: r.id,
  email: r.email,
  displayName: r.displayName,
  role: r.role,
  active: r.active,
});

export const toChild = (r: Row<typeof s.children>): Child => ({
  id: r.id,
  firstName: r.firstName,
  sortOrder: r.sortOrder,
  archivedAt: r.archivedAt,
});

export const toActivityType = (r: Row<typeof s.activityTypes>): ActivityType => ({
  id: r.id,
  systemKey: r.systemKey,
  name: r.name,
  kind: r.kind,
  icon: r.icon,
  colour: r.colour as ActivityType['colour'],
  sortOrder: r.sortOrder,
  archivedAt: r.archivedAt,
});

export const toField = (r: Row<typeof s.activityFields>): ActivityField => ({
  id: r.id,
  activityTypeId: r.activityTypeId,
  key: r.key,
  label: r.label,
  fieldType: r.fieldType,
  unit: r.unit,
  decimals: r.decimals,
  min: r.min,
  max: r.max,
  maxLength: r.maxLength,
  options: json<string[] | null>(r.options, null),
  pickerSet: r.pickerSet,
  showWhen: json<ActivityField['showWhen']>(r.showWhen, null),
  required: r.required,
  sortOrder: r.sortOrder,
  archivedAt: r.archivedAt,
});

export const toSetting = (r: Row<typeof s.childActivitySettings>): ChildActivitySetting => ({
  childId: r.childId,
  activityTypeId: r.activityTypeId,
  enabled: r.enabled,
  quickLog: r.quickLog,
  defaults: json<FieldValues>(r.defaults, {}),
  windowBeforeMin: r.windowBeforeMin,
  windowAfterMin: r.windowAfterMin,
});

export const toScheduleItem = (r: Row<typeof s.scheduleItems>): ScheduleItem => ({
  id: r.id,
  childId: r.childId,
  activityTypeId: r.activityTypeId,
  label: r.label,
  startTime: r.startTime,
  endTime: r.endTime,
  daysMask: r.daysMask,
  repeat: r.repeat,
  anchorDate: r.anchorDate,
  validFrom: r.validFrom,
  validUntil: r.validUntil,
  autoConfirm: r.autoConfirm,
  note: r.note,
  archivedAt: r.archivedAt,
});

export const toOverride = (r: Row<typeof s.scheduleOverrides>): ScheduleOverride => ({
  id: r.id,
  childId: r.childId,
  scheduleItemId: r.scheduleItemId,
  localDate: r.localDate,
  action: r.action,
  newStartTime: r.newStartTime,
  newEndTime: r.newEndTime,
  createdBy: r.createdBy,
});

export const toMedicine = (r: Row<typeof s.medicines>): Medicine => ({
  id: r.id,
  childId: r.childId,
  name: r.name,
  dose: r.dose,
  doseUnit: r.doseUnit,
  minGapMin: r.minGapMin,
  maxPer24h: r.maxPer24h,
  countsTowardsAlternating: r.countsTowardsAlternating,
  sortOrder: r.sortOrder,
  archivedAt: r.archivedAt,
});

export const toEntry = (r: Row<typeof s.entries>): Entry => ({
  id: r.id,
  childId: r.childId,
  activityTypeId: r.activityTypeId,
  startUtc: r.startUtc,
  endUtc: r.endUtc,
  tz: r.tz,
  localDate: r.localDate,
  values: json<FieldValues>(r.values, {}),
  medicineId: r.medicineId,
  dose: r.dose,
  doseUnit: r.doseUnit,
  note: r.note,
  scheduleItemId: r.scheduleItemId,
  autoConfirmed: r.autoConfirmed,
  createdBy: r.createdBy,
  updatedBy: r.updatedBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  deletedAt: r.deletedAt,
  deletedBy: r.deletedBy,
});
