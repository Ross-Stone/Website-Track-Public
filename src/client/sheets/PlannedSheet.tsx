// Confirm, move or skip a planned item (FR-LOG-03, FR-SCHED-03). "Woke up" rows end last night's sleep.
import { Calendar, Check, Clock, RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ulid } from 'ulid';
import type { EntryInput } from '../../shared/api';
import type { Entry } from '../../shared/domain';
import { localTimeOf } from '../../shared/time';
import { validateValues } from '../../shared/values';
import { ActivityTile, Button, FieldGrid, FormError, Sheet, TextField } from '../components/ui';
import { errorMessage } from '../lib/api';
import { Lookup } from '../lib/format';
import { plannedTitle } from '../state/home';
import { deleteOverride, putOverride, saveEntry, today, tz, useStore } from '../state/store';
import { useSheets, type SheetRequest } from './host';

export function PlannedSheet({ req }: { req: Extract<SheetRequest, { kind: 'planned' }> }) {
  const { close, open } = useSheets();
  const boot = useStore((s) => s.boot)!;
  const online = useStore((s) => s.online);
  const recent = useStore((s) => s.recent[req.childId] ?? []);
  const overrides = useStore((s) => s.overrides[req.childId] ?? []);
  const lookup = useMemo(() => new Lookup(boot), [boot]);
  const { row } = req;
  const occ = row.occurrence;
  const type = lookup.type(occ.activityTypeId)!;
  const [moving, setMoving] = useState(false);
  const [start, setStart] = useState(occ.startTime);
  const [end, setEnd] = useState(occ.endTime ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const override = overrides.find((o) => o.scheduleItemId === occ.scheduleItemId && o.localDate === occ.date);
  const plannedAt = localTimeOf(row.at, tz());
  const status =
    row.status === 'missed'
      ? 'Missed'
      : row.status === 'skipped'
        ? 'Skipped'
        : occ.moved
          ? 'Moved'
          : 'Upcoming';
  const setting = boot.childActivitySettings.find(
    (s) => s.childId === req.childId && s.activityTypeId === type.id,
  );
  const fields = (lookup.fieldsByType.get(type.id) ?? []).filter((f) => !f.archivedAt);
  // AC3: open the form first when something must be filled in.
  const needsForm =
    type.systemKey === 'medication' ||
    validateValues(fields, setting?.defaults ?? {}, { requireRequired: true }).length > 0;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function confirm(at: 'now' | 'planned') {
    const nowIso = new Date().toISOString();
    if (row.part === 'end') {
      // Woke up: end the running sleep, or log the whole night if it wasn't started.
      const endUtc = at === 'now' ? nowIso : row.at.toISOString();
      const running = recent.find((e) => e.activityTypeId === type.id && e.endUtc === null && !e.deletedAt);
      if (running) {
        return run(() => saveEntry(running.id, { ...inputFrom(running), endUtc }));
      }
      return run(() =>
        saveEntry(ulid(), {
          childId: req.childId,
          activityTypeId: type.id,
          startUtc: occ.startUtc.toISOString(),
          endUtc,
          tz: tz(),
          values: setting?.defaults ?? {},
          scheduleItemId: occ.scheduleItemId,
        }),
      );
    }
    if (needsForm) return open({ kind: 'log', childId: req.childId, typeId: type.id, planned: { row, at } });
    const input: EntryInput = {
      childId: req.childId,
      activityTypeId: type.id,
      startUtc: at === 'now' ? nowIso : occ.startUtc.toISOString(),
      // Done now on a duration item starts it running; at the planned time it uses the planned end too.
      endUtc: type.kind === 'duration' && at === 'planned' ? (occ.endUtc?.toISOString() ?? null) : null,
      tz: tz(),
      values: setting?.defaults ?? {},
      scheduleItemId: occ.scheduleItemId,
    };
    return run(() => saveEntry(ulid(), input));
  }

  const plannedLabel = row.part === 'end' ? (occ.endTime ?? plannedAt) : occ.startTime;
  return (
    <Sheet
      open
      onClose={close}
      title={plannedTitle(row, type)}
      sub={`Planned ${plannedAt}${occ.date === today() || row.part === 'end' ? ' today' : ''} · ${status}`}
      tile={<ActivityTile icon={type.icon} colour={type.colour} size={44} />}
    >
      {override ? (
        <Button
          variant="primary"
          block
          icon={<RotateCcw size={18} aria-hidden="true" />}
          disabled={busy || !online}
          onClick={() => void run(() => deleteOverride(req.childId, override.id))}
        >
          {override.action === 'skip' ? 'Undo skip' : `Back to ${occ.originalStartTime}`}
        </Button>
      ) : null}
      {row.status !== 'skipped' && (
        <div className="stack" style={{ gap: 8 }}>
          <Button
            variant={override ? 'secondary' : 'primary'}
            block
            icon={<Check size={18} aria-hidden="true" />}
            disabled={busy || !online}
            onClick={() => void confirm('now')}
          >
            Done now
          </Button>
          <Button
            block
            icon={<Clock size={18} aria-hidden="true" />}
            disabled={busy || !online}
            onClick={() => void confirm('planned')}
          >
            Done at planned time · {plannedLabel}
          </Button>
          {row.part === 'start' && !moving && (
            <Button
              block
              icon={<Calendar size={18} aria-hidden="true" />}
              disabled={busy || !online}
              onClick={() => setMoving(true)}
            >
              Move today’s time
            </Button>
          )}
          {row.part === 'start' && moving && (
            <div className="stack" style={{ gap: 8 }}>
              <FieldGrid cols={occ.endTime ? 2 : 1}>
                <TextField
                  label="New start"
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
                {occ.endTime && (
                  <TextField
                    label="New end"
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                )}
              </FieldGrid>
              <Button
                variant="primary"
                block
                disabled={busy || !online || !start}
                onClick={() =>
                  void run(() =>
                    putOverride(override?.id ?? ulid(), {
                      childId: req.childId,
                      scheduleItemId: occ.scheduleItemId,
                      localDate: occ.date,
                      action: 'move',
                      newStartTime: start,
                      newEndTime: occ.endTime ? end || null : null,
                    }),
                  )
                }
              >
                Save new time
              </Button>
            </div>
          )}
          {row.part === 'start' && (
            <Button
              block
              icon={<X size={18} aria-hidden="true" />}
              disabled={busy || !online}
              onClick={() =>
                void run(() =>
                  putOverride(override?.id ?? ulid(), {
                    childId: req.childId,
                    scheduleItemId: occ.scheduleItemId,
                    localDate: occ.date,
                    action: 'skip',
                  }),
                )
              }
            >
              Skip today
            </Button>
          )}
        </div>
      )}
      <FormError message={error} />
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Move and Skip only change today. Undo is available until midnight.
      </p>
    </Sheet>
  );
}

function inputFrom(e: Entry): EntryInput {
  return {
    childId: e.childId,
    activityTypeId: e.activityTypeId,
    startUtc: e.startUtc,
    endUtc: e.endUtc,
    tz: e.tz,
    values: e.values,
    medicineId: e.medicineId,
    dose: e.dose,
    doseUnit: e.doseUnit,
    note: e.note,
    scheduleItemId: e.scheduleItemId,
  };
}

export { inputFrom };
