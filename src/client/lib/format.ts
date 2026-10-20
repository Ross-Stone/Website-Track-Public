// Display text for entries (design: "Berry · 12 scoops · Alex", "13:48 – 15:02 · 1 h 14 m").
import type { Bootstrap } from '../../shared/api';
import type { ActivityField, ActivityType, Entry, FieldValue } from '../../shared/domain';
import { formatDuration, localTimeOf } from '../../shared/time';

export const EN_DASH = '–';

export function formatFieldValue(field: ActivityField, value: FieldValue): string {
  if (field.fieldType === 'boolean') return `${field.label}: ${value ? 'Yes' : 'No'}`;
  if (field.fieldType === 'number' && typeof value === 'number') {
    const n = field.decimals !== null ? value.toFixed(field.decimals) : String(value);
    return field.unit ? `${n} ${field.unit}` : n;
  }
  return String(value);
}

export class Lookup {
  readonly types: Map<string, ActivityType>;
  readonly fieldsByType: Map<string, ActivityField[]>;
  readonly users: Map<string, string>;
  readonly medicines: Map<string, { name: string }>;

  constructor(readonly boot: Bootstrap) {
    this.types = new Map(boot.activityTypes.map((t) => [t.id, t]));
    this.users = new Map(boot.users.map((u) => [u.id, u.displayName]));
    this.medicines = new Map(boot.medicines.map((m) => [m.id, m]));
    this.fieldsByType = new Map();
    for (const f of [...boot.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = this.fieldsByType.get(f.activityTypeId) ?? [];
      list.push(f);
      this.fieldsByType.set(f.activityTypeId, list);
    }
  }

  type(id: string): ActivityType | undefined {
    return this.types.get(id);
  }

  user(id: string): string {
    return this.users.get(id) ?? 'Someone';
  }

  /** Title: the medicine name for medication, otherwise the activity name. */
  title(e: Entry): string {
    if (e.medicineId) return this.medicines.get(e.medicineId)?.name ?? 'Medication';
    return this.type(e.activityTypeId)?.name ?? 'Activity';
  }

  /** Field values and dose, e.g. "Berry · 12 scoops" or "5 ml". */
  values(e: Entry): string[] {
    const parts: string[] = [];
    if (e.dose !== null) parts.push(`${e.dose} ${e.doseUnit ?? ''}`.trim());
    for (const f of this.fieldsByType.get(e.activityTypeId) ?? []) {
      const v = e.values[f.key];
      if (v !== undefined && v !== '') parts.push(formatFieldValue(f, v));
    }
    return parts;
  }

  /** Time span for duration entries: "13:48 – 15:02 · 1 h 14 m", shown in the entry's own zone. */
  span(e: Entry): string | null {
    if (!e.endUtc) return null;
    const ms = Date.parse(e.endUtc) - Date.parse(e.startUtc);
    return `${localTimeOf(e.startUtc, e.tz)} ${EN_DASH} ${localTimeOf(e.endUtc, e.tz)} · ${formatDuration(ms)}`;
  }
}
