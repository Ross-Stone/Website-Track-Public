import type {
  ActivityField,
  ActivityType,
  Entry,
  Medicine,
  ScheduleItem,
  ScheduleOverride,
} from '../../src/shared/domain';
import { EVERY_DAY } from '../../src/shared/schedule';

export const LONDON = 'Europe/London';
export const MADRID = 'Europe/Madrid';

export function item(
  over: Partial<ScheduleItem> & Pick<ScheduleItem, 'id' | 'activityTypeId' | 'startTime'>,
): ScheduleItem {
  return {
    childId: 'sam',
    label: null,
    endTime: null,
    daysMask: EVERY_DAY,
    repeat: 'weekly',
    anchorDate: null,
    validFrom: null,
    validUntil: null,
    autoConfirm: false,
    note: null,
    archivedAt: null,
    ...over,
  };
}

export function override(
  over: Partial<ScheduleOverride> & Pick<ScheduleOverride, 'scheduleItemId' | 'localDate' | 'action'>,
): ScheduleOverride {
  return {
    id: `o-${over.scheduleItemId}-${over.localDate}`,
    childId: 'sam',
    newStartTime: null,
    newEndTime: null,
    createdBy: 'alex',
    ...over,
  };
}

let seq = 0;
export function entry(over: Partial<Entry> & Pick<Entry, 'activityTypeId' | 'startUtc'>): Entry {
  seq += 1;
  return {
    id: `e${String(seq).padStart(4, '0')}`,
    childId: 'sam',
    endUtc: null,
    tz: LONDON,
    localDate: over.startUtc.slice(0, 10),
    values: {},
    medicineId: null,
    dose: null,
    doseUnit: null,
    note: null,
    scheduleItemId: null,
    autoConfirmed: false,
    createdBy: 'alex',
    updatedBy: 'alex',
    createdAt: over.startUtc,
    updatedAt: over.startUtc,
    deletedAt: null,
    deletedBy: null,
    ...over,
  };
}

export function medicine(over: Partial<Medicine> & Pick<Medicine, 'id' | 'name'>): Medicine {
  return {
    childId: 'sam',
    dose: 5,
    doseUnit: 'ml',
    minGapMin: 240,
    maxPer24h: 4,
    countsTowardsAlternating: true,
    sortOrder: 0,
    archivedAt: null,
    ...over,
  };
}

export function type(over: Partial<ActivityType> & Pick<ActivityType, 'id' | 'name'>): ActivityType {
  return {
    systemKey: null,
    kind: 'point',
    icon: 'milk',
    colour: 'blue',
    sortOrder: 0,
    archivedAt: null,
    ...over,
  };
}

export function field(
  over: Partial<ActivityField> & Pick<ActivityField, 'id' | 'activityTypeId' | 'key' | 'label'>,
): ActivityField {
  return {
    fieldType: 'text',
    unit: null,
    decimals: null,
    min: null,
    max: null,
    maxLength: null,
    options: null,
    pickerSet: null,
    showWhen: null,
    required: false,
    sortOrder: 0,
    archivedAt: null,
    ...over,
  };
}

export const at = (iso: string) => new Date(iso);
