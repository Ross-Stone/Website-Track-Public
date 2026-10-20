// The log form (FR-LOG-01, FR-LOG-03, FR-LOG-05, FR-MED-02). Used for quick log, retrospective logging,
// confirming planned items and editing. The entry id is made once when the form opens, so a retry after
// a failed save can never create a duplicate (TECH-06, FR-SYNC-04).
import { useMemo, useState } from 'react';
import { ulid } from 'ulid';
import type { EntryInput } from '../../shared/api';
import type { ActivityField, FieldValue, FieldValues } from '../../shared/domain';
import { describeStatus, medicationStatus } from '../../shared/medication';
import { formatShortDay, localDateOf, localTimeOf, zonedTimeToUtc } from '../../shared/time';
import { isFieldVisible, validateValues } from '../../shared/values';
import { ImagePicker } from '../components/ImagePicker';
import {
  ActivityTile,
  Button,
  FieldGrid,
  FormError,
  Segmented,
  SelectField,
  Sheet,
  SwitchRow,
  TextField,
} from '../components/ui';
import { errorMessage } from '../lib/api';
import { Lookup } from '../lib/format';
import { saveEntry, tz as deviceTz, useStore } from '../state/store';
import { useSheets } from './host';
import type { SheetRequest } from './host';

type FormValue = string | boolean | undefined;

function toForm(fields: ActivityField[], values: FieldValues): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined) continue;
    out[f.key] = typeof v === 'boolean' ? v : String(v);
  }
  return out;
}

/** Form strings → typed values. Numbers accept a comma as the decimal point. */
function fromForm(
  fields: ActivityField[],
  form: Record<string, FormValue>,
): { values: FieldValues; bad: string[] } {
  const values: FieldValues = {};
  const bad: string[] = [];
  for (const f of fields) {
    const raw = form[f.key];
    if (raw === undefined || raw === '') continue;
    if (f.fieldType === 'number') {
      const n = Number(String(raw).replace(',', '.').trim());
      if (Number.isFinite(n)) values[f.key] = n;
      else bad.push(f.key);
    } else values[f.key] = raw as FieldValue;
  }
  return { values, bad };
}

export function LogSheet({ req }: { req: Extract<SheetRequest, { kind: 'log' }> }) {
  const { close } = useSheets();
  const boot = useStore((s) => s.boot)!;
  const recent = useStore((s) => s.recent[req.childId] ?? []);
  const online = useStore((s) => s.online);
  const lookup = useMemo(() => new Lookup(boot), [boot]);
  const editing = req.entry;
  const child = boot.children.find((c) => c.id === req.childId);

  const [id] = useState(() => editing?.id ?? ulid());
  const [typeId, setTypeId] = useState(req.typeId);
  const type = lookup.type(typeId)!;
  const isDuration = type.kind === 'duration';
  const isMed = type.systemKey === 'medication';
  const zone = editing?.tz ?? deviceTz();
  const fields = (lookup.fieldsByType.get(typeId) ?? []).filter(
    (f) => !f.archivedAt || editing?.values[f.key] !== undefined,
  );
  const setting = boot.childActivitySettings.find(
    (s) => s.childId === req.childId && s.activityTypeId === typeId,
  );

  // ---- times
  const planned = req.planned;
  const initialStart = editing
    ? new Date(editing.startUtc)
    : planned?.at === 'planned'
      ? planned.row.occurrence.startUtc
      : req.date
        ? zonedTimeToUtc(req.date, localTimeOf(new Date(), zone), zone)
        : new Date();
  const initialEnd = editing?.endUtc
    ? new Date(editing.endUtc)
    : planned?.at === 'planned'
      ? planned.row.occurrence.endUtc
      : null;
  const [when, setWhen] = useState<'now' | 'pick'>(
    editing || req.date || planned?.at === 'planned' ? 'pick' : 'now',
  );
  const [durMode, setDurMode] = useState<'start' | 'range'>(
    editing || req.date || (planned?.at === 'planned' && initialEnd) ? 'range' : 'start',
  );
  const [startDate, setStartDate] = useState(localDateOf(initialStart, zone));
  const [startTime, setStartTime] = useState(localTimeOf(initialStart, zone));
  const [endDate, setEndDate] = useState(
    initialEnd ? localDateOf(initialEnd, zone) : localDateOf(initialStart, zone),
  );
  const [endTime, setEndTime] = useState(initialEnd ? localTimeOf(initialEnd, zone) : '');

  // ---- values
  const [form, setForm] = useState<Record<string, FormValue>>(() =>
    toForm(fields, editing ? editing.values : (setting?.defaults ?? {})),
  );
  const [note, setNote] = useState(editing?.note ?? '');
  const meds = boot.medicines.filter(
    (m) => m.childId === req.childId && (!m.archivedAt || m.id === editing?.medicineId),
  );
  const [medicineId, setMedicineId] = useState<string | null>(editing?.medicineId ?? null);
  const [dose, setDose] = useState(
    editing?.dose !== null && editing?.dose !== undefined ? String(editing.dose) : '',
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const { values: typed } = fromForm(fields, form);

  async function submit() {
    setFormError(null);
    const { values, bad } = fromForm(fields, form);
    const errs: Record<string, string> = {};
    for (const k of bad) errs[k] = 'Enter a number';
    for (const p of validateValues(fields, values, { requireRequired: true })) errs[p.key] ??= p.message;
    if (isMed && !medicineId) errs.medicine = 'Choose a medicine';
    let doseNum: number | null = null;
    if (isMed && dose.trim()) {
      doseNum = Number(dose.replace(',', '.'));
      if (!Number.isFinite(doseNum) || doseNum <= 0) errs.dose = 'Enter a dose';
    }

    let startUtc: string;
    let endUtc: string | null = null;
    const usePick = editing || (isDuration ? durMode === 'range' : when === 'pick');
    try {
      startUtc = usePick
        ? zonedTimeToUtc(startDate, startTime, zone).toISOString()
        : new Date().toISOString();
      if (isDuration && usePick && endTime) endUtc = zonedTimeToUtc(endDate, endTime, zone).toISOString();
    } catch {
      errs.time = 'Enter a date and time';
      startUtc = '';
    }
    if (isDuration && usePick && !editing && !endTime) errs.end = 'Enter an end time, or choose Start now';
    if (endUtc && startUtc && endUtc < startUtc) errs.end = 'End must be after the start';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const med = meds.find((m) => m.id === medicineId);
    const input: EntryInput = {
      childId: req.childId,
      activityTypeId: typeId,
      startUtc,
      endUtc,
      tz: zone,
      values,
      medicineId: isMed ? medicineId : null,
      dose: isMed ? (doseNum ?? med?.dose ?? null) : null,
      doseUnit: isMed ? (med?.doseUnit ?? null) : null,
      note: note.trim() || null,
      scheduleItemId: planned ? planned.row.occurrence.scheduleItemId : (editing?.scheduleItemId ?? null),
    };
    setSaving(true);
    try {
      await saveEntry(id, input);
      close();
    } catch (e) {
      // Keep the form open with what was typed; retrying uses the same id (FR-SYNC-04).
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const title = editing ? `Edit ${lookup.title(editing)}` : isMed ? 'Log medication' : `Log ${type.name}`;
  const typeChoices = boot.activityTypes.filter(
    (t) =>
      t.id === typeId ||
      (!t.archivedAt &&
        t.kind === type.kind &&
        boot.childActivitySettings.some(
          (s) => s.childId === req.childId && s.activityTypeId === t.id && s.enabled,
        )),
  );

  return (
    <Sheet
      open
      onClose={close}
      title={title}
      sub={child?.firstName}
      tile={<ActivityTile icon={type.icon} colour={type.colour} size={44} />}
    >
      {editing && !isMed && typeChoices.length > 1 && (
        <SelectField
          label="Activity"
          value={typeId}
          onChange={(v) => {
            setTypeId(v);
            setForm({});
          }}
          options={typeChoices.map((t) => ({ value: t.id, label: t.name }))}
        />
      )}

      {isMed && (
        <div className="stack" role="radiogroup" aria-label="Medicine" style={{ gap: 8 }}>
          {meds.length === 0 && <p className="muted">Add a medicine in Settings › Medicines first.</p>}
          {meds.map((m) => {
            const st = medicationStatus(m, recent, now);
            const text = st ? describeStatus(st, now, deviceTz()) : null;
            // Design: "5 ml · next from 12:10", "2.5 ml · OK now · none in last 24 h".
            const lastIn24h = recent
              .filter(
                (e) =>
                  !e.deletedAt &&
                  e.medicineId === m.id &&
                  Date.parse(e.startUtc) > now.getTime() - 86_400_000,
              )
              .sort((a, b) => b.startUtc.localeCompare(a.startUtc))[0];
            const state = !st
              ? lastIn24h
                ? `OK now · last ${localTimeOf(lastIn24h.startUtc, deviceTz())}`
                : 'OK now · none in last 24 h'
              : st.state === 'ok'
                ? 'OK now'
                : text!.title.replace(`Next ${m.name} from`, 'next from');
            const sub = `${m.dose} ${m.doseUnit} · ${state}`;
            const on = medicineId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                className="radio-card"
                onClick={() => {
                  setMedicineId(m.id);
                  setDose(String(m.dose));
                }}
              >
                <ActivityTile icon={type.icon} colour={type.colour} />
                <span className="grow stack">
                  <span className="title">{m.name}</span>
                  <span className={st?.state === 'wait' ? 'sub warn' : 'sub'}>{sub}</span>
                </span>
                <span className="radio-dot" aria-hidden="true" />
              </button>
            );
          })}
          {errors.medicine && <span className="field-error">{errors.medicine}</span>}
          {medicineId && (
            <TextField
              label="Dose"
              inputMode="decimal"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              suffix={meds.find((m) => m.id === medicineId)?.doseUnit}
              error={errors.dose}
            />
          )}
        </div>
      )}

      {/* When (FR-LOG-01 AC2, AC3) */}
      {!editing && !isDuration && (
        <Segmented
          label="When"
          value={when}
          onChange={setWhen}
          options={[
            { value: 'now', label: 'Now' },
            { value: 'pick', label: 'Pick a time' },
          ]}
        />
      )}
      {!editing && isDuration && (
        <Segmented
          label="When"
          value={durMode}
          onChange={setDurMode}
          options={[
            { value: 'start', label: type.systemKey === 'overnight_sleep' ? 'Bedtime now' : 'Start now' },
            { value: 'range', label: 'Start and end' },
          ]}
        />
      )}
      {(editing || (isDuration ? durMode === 'range' : when === 'pick')) && (
        <>
          <FieldGrid cols={2}>
            <TextField
              label={isDuration ? 'Start date' : 'Date'}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
            <TextField
              label={isDuration ? 'Start time' : 'Time'}
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              error={errors.time}
            />
          </FieldGrid>
          {isDuration && (
            <FieldGrid cols={2}>
              <TextField
                label="End date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <TextField
                label="End time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                error={errors.end}
                hint={editing ? 'Leave empty while it is still running' : undefined}
              />
            </FieldGrid>
          )}
          {startDate !== localDateOf(now, zone) && <span className="muted">{formatShortDay(startDate)}</span>}
        </>
      )}

      {/* Fields (FR-ACT-04) */}
      {fields
        .filter((f) => isFieldVisible(f, typed))
        .map((f) => (
          <FieldInput
            key={f.id}
            field={f}
            value={form[f.key]}
            error={errors[f.key]}
            onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}
          />
        ))}

      <TextField
        label="Note (optional)"
        placeholder="Add a note"
        value={note}
        maxLength={2000}
        onChange={(e) => setNote(e.target.value)}
      />

      <FormError message={formError} />
      <div className="btn-pair">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving || !online}>
          {saving ? 'Saving…' : formError ? 'Try again' : 'Save'}
        </Button>
      </div>
    </Sheet>
  );
}

function FieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: ActivityField;
  value: FormValue;
  error?: string;
  onChange: (v: FormValue) => void;
}) {
  const label = `${field.label}${field.required ? '' : ' (optional)'}`;
  switch (field.fieldType) {
    case 'number':
      return (
        <TextField
          label={label}
          inputMode="decimal"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          suffix={field.unit ?? undefined}
          error={error}
        />
      );
    case 'text':
      return (
        <TextField
          label={label}
          value={(value as string) ?? ''}
          maxLength={field.maxLength ?? undefined}
          onChange={(e) => onChange(e.target.value)}
          error={error}
        />
      );
    case 'boolean':
      return <SwitchRow label={field.label} checked={value === true} onChange={onChange} />;
    case 'image_picker':
      return (
        <div className="stack" style={{ gap: 4 }}>
          <ImagePicker
            set={field.pickerSet!}
            label={label}
            value={value as string | undefined}
            onChange={onChange}
          />
          {error && <span className="field-error">{error}</span>}
        </div>
      );
    case 'list': {
      const options = field.options ?? [];
      if (options.length <= 4) {
        return (
          <div className="stack" style={{ gap: 4 }}>
            <Segmented
              label={label}
              value={(value as string) ?? ''}
              onChange={(v) => onChange(value === v ? undefined : v)}
              options={options.map((o) => ({ value: o, label: o }))}
            />
            {error && <span className="field-error">{error}</span>}
          </div>
        );
      }
      return (
        <SelectField
          label={label}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v || undefined)}
          options={[{ value: '', label: 'Not set' }, ...options.map((o) => ({ value: o, label: o }))]}
        />
      );
    }
  }
}
