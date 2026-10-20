// Home's view model (FR-HOME-02): pure, derived from loaded data, `now` and the phone's zone.
import type { Bootstrap } from '../../shared/api';
import type { ActivityType, Entry, ScheduleItem } from '../../shared/domain';
import { matchPlannedRows, nextExpected, windowsFromSettings, type MatchedRow } from '../../shared/matching';
import {
  describeAlternating,
  describeStatus,
  lastAlternatingDose,
  medicationStatuses,
  type MedicationStatus,
} from '../../shared/medication';
import { plannedRowsFor } from '../../shared/schedule';
import {
  addDays,
  formatAgo,
  formatDuration,
  formatLongDay,
  localDateOf,
  localTimeOf,
} from '../../shared/time';
import { EN_DASH, Lookup } from '../lib/format';
import type { ScheduleOverride } from '../../shared/domain';

export interface RunningItem {
  entry: Entry;
  type: ActivityType;
  title: string;
  elapsed: string;
  sub: string;
  endLabel: string;
}

export interface MedLine {
  status: MedicationStatus;
  title: string;
  detail: string;
}

export type TimelineRow =
  | { kind: 'now'; key: 'now'; at: number; time: string }
  | {
      kind: 'entry';
      key: string;
      at: number;
      time: string;
      entry: Entry;
      type: ActivityType;
      title: string;
      detail: string;
      state: 'done' | 'running';
      auto: boolean;
    }
  | {
      kind: 'planned';
      key: string;
      at: number;
      time: string;
      row: MatchedRow;
      type: ActivityType;
      title: string;
      detail: string;
      state: 'missed' | 'skipped' | 'planned';
      moved: boolean;
    };

export interface NextItem {
  row: MatchedRow | null;
  type: ActivityType;
  when: string;
  title: string;
  /** The planned row, for confirming. Null when the next item is tomorrow. */
  tomorrow: boolean;
}

export interface HomeModel {
  dateLabel: string;
  stats: string | null;
  running: RunningItem[];
  meds: MedLine[];
  alternating: string | null;
  next: NextItem | null;
  quick: ActivityType[];
  rows: TimelineRow[];
  planned: MatchedRow[];
}

const isOvernight = (t: ActivityType | undefined) => t?.systemKey === 'overnight_sleep';

/** "Bedtime", "Woke up", or the item label / activity name. */
export function plannedTitle(row: MatchedRow, type: ActivityType): string {
  if (isOvernight(type)) return row.part === 'end' ? 'Woke up' : 'Bedtime';
  if (row.part === 'end') return `${row.occurrence.label ?? type.name} ends`;
  return row.occurrence.label ?? type.name;
}

/** "230 ml" or "Berry · 12 scoops" from the child's defaults for a type. */
function defaultsSummary(lookup: Lookup, boot: Bootstrap, childId: string, typeId: string): string {
  const s = boot.childActivitySettings.find((x) => x.childId === childId && x.activityTypeId === typeId);
  if (!s) return '';
  const fake = { values: s.defaults, dose: null, doseUnit: null, activityTypeId: typeId } as unknown as Entry;
  return lookup.values(fake).join(' · ');
}

export function buildHome(args: {
  boot: Bootstrap;
  childId: string;
  entries: Entry[];
  overrides: ScheduleOverride[];
  now: Date;
  tz: string;
}): HomeModel {
  const { boot, childId, now, tz } = args;
  const lookup = new Lookup(boot);
  const nowMs = now.getTime();
  const date = localDateOf(now, tz);
  const entries = args.entries.filter((e) => e.childId === childId && !e.deletedAt);
  const items: ScheduleItem[] = boot.scheduleItems.filter((i) => i.childId === childId);
  const settings = boot.childActivitySettings.filter((s) => s.childId === childId);
  const windows = windowsFromSettings(settings);

  // ---- header stats (FR-CHILD-03): latest weight (2 dp) and height (1 dp)
  const latestOf = (key: 'weight' | 'height') => {
    const type = boot.activityTypes.find((t) => t.systemKey === key);
    if (!type) return null;
    const pool = [...boot.latestMeasurements, ...entries].filter(
      (e) =>
        e.childId === childId &&
        e.activityTypeId === type.id &&
        !e.deletedAt &&
        typeof e.values[key] === 'number',
    );
    pool.sort((a, b) => b.startUtc.localeCompare(a.startUtc));
    return (pool[0]?.values[key] as number | undefined) ?? null;
  };
  const w = latestOf('weight');
  const h = latestOf('height');
  const stats =
    [w !== null ? `${w.toFixed(2)} kg` : null, h !== null ? `${h.toFixed(1)} cm` : null]
      .filter(Boolean)
      .join(' · ') || null;

  // ---- running timers (FR-LOG-04)
  const running: RunningItem[] = entries
    .filter((e) => e.endUtc === null && lookup.type(e.activityTypeId)?.kind === 'duration')
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    .map((e) => {
      const type = lookup.type(e.activityTypeId)!;
      const started = localTimeOf(e.startUtc, tz);
      const yesterday = localDateOf(e.startUtc, tz) < date ? ' yesterday' : '';
      return {
        entry: e,
        type,
        title: `${type.name} · running`,
        elapsed: formatDuration(nowMs - Date.parse(e.startUtc)),
        sub: isOvernight(type) ? `Bedtime ${started}${yesterday}` : `Started ${started}${yesterday}`,
        endLabel: isOvernight(type) ? 'Woke up' : 'End',
      };
    });

  // ---- medication (FR-MED-03, FR-MED-04)
  const medicines = boot.medicines.filter((m) => m.childId === childId);
  const statuses = medicationStatuses(medicines, entries, now);
  const meds = statuses.map((s) => ({ status: s, ...describeStatus(s, now, tz) }));
  const alt = lastAlternatingDose(medicines, statuses, entries, now);

  // ---- planned items (FR-HOME-03, FR-HOME-04)
  const planned = matchPlannedRows({ items, overrides: args.overrides, entries, date, tz, now, windows });

  // ---- timeline
  const rows: TimelineRow[] = [];
  for (const e of entries) {
    const type = lookup.type(e.activityTypeId);
    if (!type) continue;
    const startDate = localDateOf(e.startUtc, tz);
    const isRunning = e.endUtc === null && type.kind === 'duration';
    const who = lookup.user(e.createdBy);
    const values = lookup.values(e);
    if (startDate === date || (isRunning && startDate < date)) {
      let detail: string;
      if (isRunning)
        detail = [
          isOvernight(type)
            ? `Bedtime${startDate < date ? ' yesterday' : ''}`
            : `Started ${localTimeOf(e.startUtc, tz)}`,
          ...values,
          who,
        ].join(' · ');
      else if (e.endUtc)
        detail = [lookup.span(e), ...values, e.autoConfirmed ? null : who].filter(Boolean).join(' · ');
      else detail = [...values, who].join(' · ');
      rows.push({
        kind: 'entry',
        key: e.id,
        at: Date.parse(e.startUtc),
        time: localTimeOf(e.startUtc, tz),
        entry: e,
        type,
        title: lookup.title(e),
        detail,
        state: isRunning ? 'running' : 'done',
        auto: e.autoConfirmed,
      });
    } else if (e.endUtc && startDate < date && localDateOf(e.endUtc, tz) === date) {
      // Started yesterday, ended today: show the end, e.g. "Woke up · Slept 20:34 – 06:28 · 9 h 54 m".
      const span = `${localTimeOf(e.startUtc, tz)} ${EN_DASH} ${localTimeOf(e.endUtc, tz)} · ${formatDuration(Date.parse(e.endUtc) - Date.parse(e.startUtc))}`;
      rows.push({
        kind: 'entry',
        key: `${e.id}:end`,
        at: Date.parse(e.endUtc),
        time: localTimeOf(e.endUtc, tz),
        entry: e,
        type,
        title: isOvernight(type) ? 'Woke up' : `${lookup.title(e)} ended`,
        detail: isOvernight(type) ? `Slept ${span}` : span,
        state: 'done',
        auto: e.autoConfirmed,
      });
    }
  }
  for (const r of planned) {
    if (r.status === 'done') continue; // the entry shows instead (AC2)
    const type = lookup.type(r.occurrence.activityTypeId);
    if (!type) continue;
    let detail: string;
    if (r.status === 'skipped') detail = 'Skipped for today';
    else if (r.status === 'missed') detail = 'No matching entry';
    else if (r.occurrence.moved && r.part === 'start')
      detail = `Moved from ${r.occurrence.originalStartTime}`;
    else if (r.part === 'end' && isOvernight(type)) detail = 'Planned end of overnight sleep';
    else if (r.part === 'start' && r.occurrence.endTime) detail = `Until ${r.occurrence.endTime}`;
    else detail = defaultsSummary(lookup, boot, childId, type.id);
    rows.push({
      kind: 'planned',
      key: r.key,
      at: r.at.getTime(),
      time: localTimeOf(r.at, tz),
      row: r,
      type,
      title: plannedTitle(r, type),
      detail,
      state: r.status === 'upcoming' ? 'planned' : r.status,
      moved: r.occurrence.moved,
    });
  }
  rows.push({ kind: 'now', key: 'now', at: nowMs, time: localTimeOf(now, tz) });
  rows.sort((a, b) => a.at - b.at || (a.kind === 'now' ? 1 : b.kind === 'now' ? -1 : 0));

  // ---- next expected item
  let next: NextItem | null = null;
  // "Woke up" rows are left out: the running card's Woke up button covers them (as in the design).
  const n = nextExpected(
    planned.filter((r) => r.part === 'start'),
    now,
  );
  if (n) {
    const type = lookup.type(n.occurrence.activityTypeId)!;
    const diff = n.at.getTime() - nowMs;
    const moved = n.occurrence.moved && n.part === 'start' ? ' (moved)' : '';
    const when = diff > 0 ? `in ${formatAgo(diff)}` : 'due now';
    const extra =
      n.part === 'start' && !isOvernight(type) ? defaultsSummary(lookup, boot, childId, type.id) : '';
    next = {
      row: n,
      type,
      tomorrow: false,
      when: `Next · ${localTimeOf(n.at, tz)}${moved} · ${when}`,
      title: [plannedTitle(n, type), extra].filter(Boolean).join(' · '),
    };
  } else {
    const t = plannedRowsFor(items, args.overrides, addDays(date, 1), tz).find(
      (r) => !r.occurrence.skipped && r.at.getTime() > nowMs,
    );
    if (t) {
      const type = lookup.type(t.occurrence.activityTypeId)!;
      next = {
        row: null,
        type,
        tomorrow: true,
        when: `Next · ${localTimeOf(t.at, tz)} tomorrow`,
        title: plannedTitle({ ...t, status: 'upcoming', entryId: null }, type),
      };
    }
  }

  // ---- quick log favourites (FR-LOG-02)
  const typesById = new Map(boot.activityTypes.map((t) => [t.id, t]));
  const quick = settings
    .filter((s) => s.quickLog && s.enabled)
    .map((s) => typesById.get(s.activityTypeId))
    .filter((t): t is ActivityType => !!t && !t.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    dateLabel: formatLongDay(date),
    stats,
    running,
    meds,
    alternating: alt ? describeAlternating(alt, now, tz) : null,
    next,
    quick,
    rows,
    planned,
  };
}
