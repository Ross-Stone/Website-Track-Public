// Activity types, fields and per-child settings (FR-ACT-01..07).
import { Hash, List, Plus, ToggleLeft, Type, Image } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { ACTIVITY_ICONS, PALETTE, type ActivityIcon, type PaletteColour } from '../../../shared/constants';
import type { ActivityField, ActivityType, ChildActivitySetting, FieldValues } from '../../../shared/domain';
import { validateValues } from '../../../shared/values';
import {
  ActivityTile,
  Button,
  FieldGrid,
  FormError,
  NavRow,
  Section,
  Segmented,
  SelectField,
  SwitchRow,
  TextField,
  paletteVars,
} from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { ACTIVITY_ICON_COMPONENTS, iconLabel } from '../../lib/icons';
import { useRouter } from '../../lib/router';
import { useIsWriter } from '../../state/hooks';
import { useStore, writeConfig } from '../../state/store';
import { NotForRole, Page, SettingsHeader } from './common';

const FIELD_TYPE_LABEL = {
  number: 'Number',
  text: 'Short text',
  list: 'List',
  boolean: 'Yes/no',
  image_picker: 'Image picker',
} as const;
const FIELD_ICON = {
  number: Hash,
  text: Type,
  list: List,
  boolean: ToggleLeft,
  image_picker: Image,
} as const;

function fieldSummary(f: ActivityField): string {
  const parts: string[] = [FIELD_TYPE_LABEL[f.fieldType]];
  if (f.unit) parts.push(f.unit);
  if (f.fieldType === 'number' && f.decimals !== null) parts.push(`${f.decimals} decimals`);
  if (f.fieldType === 'list' && f.options) parts.push(f.options.join(', '));
  if (f.fieldType === 'image_picker')
    parts.push(f.pickerSet === 'stool_colour' ? 'Stool colour' : 'Stool consistency');
  parts.push(f.required ? 'required' : 'optional');
  return parts.join(' · ');
}

export function ActivityTypes() {
  const boot = useStore((s) => s.boot)!;
  const { navigate } = useRouter();
  const writer = useIsWriter();
  const [showArchived, setShowArchived] = useState(false);
  if (!writer) return <NotForRole />;
  const types = [...boot.activityTypes].sort((a, b) => a.sortOrder - b.sortOrder);
  const visible = types.filter((t) => showArchived || !t.archivedAt);
  const count = (t: ActivityType) =>
    boot.fields.filter((f) => f.activityTypeId === t.id && !f.archivedAt).length;
  return (
    <>
      <SettingsHeader
        title="Activity types"
        sub="Shared by all children"
        back="/settings"
        action={{ label: 'Add', onClick: () => navigate('/settings/types/new') }}
      />
      <Page>
        <Section>
          {visible.map((t) => (
            <NavRow
              key={t.id}
              to={`/settings/types/${t.id}`}
              tile={<ActivityTile icon={t.icon} colour={t.colour} />}
              title={t.name}
              sub={`${t.kind === 'duration' ? 'Duration' : 'Point'} · ${count(t)} ${count(t) === 1 ? 'field' : 'fields'}`}
              badges={[t.systemKey ? 'Built in' : null, t.archivedAt ? 'Archived' : null].filter(
                (b): b is string => !!b,
              )}
            />
          ))}
        </Section>
        <SwitchRow label="Show archived types" checked={showArchived} onChange={setShowArchived} />
      </Page>
    </>
  );
}

export function ActivityTypeEditor({ id }: { id: string }) {
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId);
  const { navigate } = useRouter();
  const writer = useIsWriter();
  const creating = id === 'new';
  const existing = boot.activityTypes.find((t) => t.id === id);
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<'point' | 'duration'>(existing?.kind ?? 'point');
  const [icon, setIcon] = useState<string>(existing?.icon ?? 'star');
  const [colour, setColour] = useState<PaletteColour>(existing?.colour ?? 'blue');
  const child = boot.children.find((c) => c.id === childId);
  const setting = boot.childActivitySettings.find((s) => s.childId === childId && s.activityTypeId === id);
  const fields = boot.fields.filter((f) => f.activityTypeId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  const [cs, setCs] = useState<ChildActivitySetting | null>(setting ?? null);
  const [defaults, setDefaults] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(setting?.defaults ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!writer) return <NotForRole />;
  if (!creating && !existing) return <p className="empty">This activity type no longer exists.</p>;

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Enter a name.');
    setBusy(true);
    try {
      if (creating) {
        const r = await writeConfig<{ activityType: ActivityType }>('POST', '/activity-types', {
          name,
          kind,
          icon,
          colour,
        });
        navigate(`/settings/types/${r.activityType.id}`, { replace: true });
        return;
      }
      await writeConfig('PUT', `/activity-types/${id}`, {
        name,
        icon,
        colour,
        ...(existing!.systemKey ? {} : { kind }),
      });
      if (cs && childId) {
        const editable = fields.filter((f) => !f.archivedAt && f.fieldType !== 'boolean');
        const parsed: FieldValues = {};
        for (const f of editable) {
          const raw = defaults[f.key]?.trim();
          if (!raw) continue;
          parsed[f.key] = f.fieldType === 'number' ? Number(raw.replace(',', '.')) : raw;
        }
        const problems = validateValues(editable, parsed, { requireRequired: false });
        if (problems.length) throw new Error(problems.map((p) => p.message).join('; '));
        await writeConfig('PUT', `/children/${childId}/activity-settings/${id}`, { ...cs, defaults: parsed });
      }
      navigate('/settings/types');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const toggleArchive = () => {
    setBusy(true);
    writeConfig('PUT', `/activity-types/${id}`, { archived: !existing!.archivedAt })
      .then(() => navigate('/settings/types'))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const sel = paletteVars(colour);
  return (
    <>
      <SettingsHeader
        title={creating ? 'New activity type' : existing!.name}
        sub="Activity type"
        back="/settings/types"
        action={{ label: 'Save', onClick: () => void save(), disabled: busy }}
      />
      <Page>
        <Section title="Details">
          <TextField label="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <Segmented
            label={existing?.systemKey ? 'Kind (built-in, fixed)' : 'Kind'}
            value={kind}
            onChange={setKind}
            disabled={!!existing?.systemKey}
            options={[
              { value: 'point', label: 'Point' },
              { value: 'duration', label: 'Duration' },
            ]}
          />
        </Section>
        <Section title="Icon">
          <div className="choice-grid" role="group" aria-label="Icon">
            {ACTIVITY_ICONS.map((n) => {
              const Icon = ACTIVITY_ICON_COMPONENTS[n as ActivityIcon];
              return (
                <button
                  key={n}
                  type="button"
                  className="icon-choice"
                  aria-label={`${iconLabel(n)} icon`}
                  aria-pressed={icon === n}
                  style={sel}
                  onClick={() => setIcon(n)}
                >
                  <Icon size={20} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="Colour">
          <div className="choice-grid" role="group" aria-label="Colour">
            {PALETTE.map((p) => (
              <button
                key={p}
                type="button"
                className="colour-choice"
                aria-label={p.charAt(0).toUpperCase() + p.slice(1)}
                aria-pressed={colour === p}
                style={paletteVars(p) as CSSProperties}
                onClick={() => setColour(p)}
              />
            ))}
          </div>
        </Section>
        {!creating && (
          <Section title="Fields">
            {fields.map((f) => {
              const Icon = FIELD_ICON[f.fieldType];
              return (
                <NavRow
                  key={f.id}
                  to={`/settings/types/${id}/fields/${f.id}`}
                  tile={
                    <span className="tile tile-36" style={paletteVars('neutral')} aria-hidden="true">
                      <Icon size={20} />
                    </span>
                  }
                  title={f.label}
                  sub={fieldSummary(f)}
                  badges={f.archivedAt ? ['Archived'] : undefined}
                />
              );
            })}
            <div>
              <Button
                block
                icon={<Plus size={18} aria-hidden="true" />}
                onClick={() => navigate(`/settings/types/${id}/fields/new`)}
              >
                Add field
              </Button>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Every entry also has a note.
            </div>
          </Section>
        )}
        {!creating && cs && child && (
          <Section title={`For ${child.firstName}`}>
            <SwitchRow label="Enabled" checked={cs.enabled} onChange={(v) => setCs({ ...cs, enabled: v })} />
            <SwitchRow
              label="Quick log favourite"
              checked={cs.quickLog}
              onChange={(v) => setCs({ ...cs, quickLog: v })}
            />
            {fields
              .filter(
                (f) =>
                  !f.archivedAt &&
                  (f.fieldType === 'number' || f.fieldType === 'text' || f.fieldType === 'list'),
              )
              .map((f) =>
                f.fieldType === 'list' ? (
                  <SelectField
                    key={f.id}
                    label={`Default ${f.label.toLowerCase()}`}
                    value={defaults[f.key] ?? ''}
                    onChange={(v) => setDefaults((d) => ({ ...d, [f.key]: v }))}
                    options={[
                      { value: '', label: 'None' },
                      ...(f.options ?? []).map((o) => ({ value: o, label: o })),
                    ]}
                  />
                ) : (
                  <TextField
                    key={f.id}
                    label={`Default ${f.label.toLowerCase()}`}
                    inputMode={f.fieldType === 'number' ? 'decimal' : undefined}
                    value={defaults[f.key] ?? ''}
                    suffix={f.unit ?? undefined}
                    onChange={(e) => setDefaults((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                ),
              )}
            <FieldGrid cols={2}>
              <TextField
                label="Window before"
                inputMode="numeric"
                value={String(cs.windowBeforeMin)}
                suffix="min"
                onChange={(e) => setCs({ ...cs, windowBeforeMin: Math.max(0, Number(e.target.value) || 0) })}
              />
              <TextField
                label="Window after"
                inputMode="numeric"
                value={String(cs.windowAfterMin)}
                suffix="min"
                onChange={(e) => setCs({ ...cs, windowAfterMin: Math.max(0, Number(e.target.value) || 0) })}
              />
            </FieldGrid>
          </Section>
        )}
        <FormError message={error} />
        {!creating && (
          <Button
            variant={existing!.archivedAt ? 'secondary' : 'danger'}
            block
            disabled={busy}
            onClick={toggleArchive}
          >
            {existing!.archivedAt ? 'Restore this type' : 'Archive this type'}
          </Button>
        )}
      </Page>
    </>
  );
}

export function FieldEditor({ typeId, fieldId }: { typeId: string; fieldId: string }) {
  const boot = useStore((s) => s.boot)!;
  const { navigate } = useRouter();
  const writer = useIsWriter();
  const creating = fieldId === 'new';
  const type = boot.activityTypes.find((t) => t.id === typeId);
  const existing = boot.fields.find((f) => f.id === fieldId);
  const siblings = boot.fields.filter(
    (f) => f.activityTypeId === typeId && f.id !== fieldId && f.fieldType === 'list',
  );
  const [label, setLabel] = useState(existing?.label ?? '');
  const [fieldType, setFieldType] = useState<ActivityField['fieldType']>(existing?.fieldType ?? 'number');
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [decimals, setDecimals] = useState(String(existing?.decimals ?? 0));
  const [min, setMin] = useState(existing?.min?.toString() ?? '');
  const [max, setMax] = useState(existing?.max?.toString() ?? '');
  const [maxLength, setMaxLength] = useState(existing?.maxLength?.toString() ?? '100');
  const [options, setOptions] = useState((existing?.options ?? []).join('\n'));
  const [pickerSet, setPickerSet] = useState<'stool_colour' | 'stool_consistency'>(
    existing?.pickerSet ?? 'stool_colour',
  );
  const [required, setRequired] = useState(existing?.required ?? false);
  const [showField, setShowField] = useState(existing?.showWhen?.field ?? '');
  const [showValues, setShowValues] = useState<string[]>(existing?.showWhen?.in ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!writer) return <NotForRole />;
  if (!type || (!creating && !existing)) return <p className="empty">This field no longer exists.</p>;

  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  async function save() {
    setError(null);
    const body = {
      label,
      unit: fieldType === 'number' ? unit.trim() || null : null,
      decimals: fieldType === 'number' ? Number(decimals) || 0 : null,
      min: fieldType === 'number' ? num(min) : null,
      max: fieldType === 'number' ? num(max) : null,
      maxLength: fieldType === 'text' ? Number(maxLength) || null : null,
      options:
        fieldType === 'list'
          ? options
              .split('\n')
              .map((o) => o.trim())
              .filter(Boolean)
          : null,
      showWhen: showField ? { field: showField, in: showValues } : null,
      required,
    };
    setBusy(true);
    try {
      if (creating) {
        await writeConfig('POST', `/activity-types/${typeId}/fields`, {
          ...body,
          fieldType,
          pickerSet: fieldType === 'image_picker' ? pickerSet : null,
        });
      } else {
        await writeConfig('PUT', `/activity-types/${typeId}/fields/${fieldId}`, body);
      }
      navigate(`/settings/types/${typeId}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const archive = () => {
    setBusy(true);
    writeConfig('PUT', `/activity-types/${typeId}/fields/${fieldId}`, { archived: !existing!.archivedAt })
      .then(() => navigate(`/settings/types/${typeId}`))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  const target = siblings.find((s) => s.key === showField);

  return (
    <>
      <SettingsHeader
        title={creating ? 'New field' : existing!.label}
        sub={type.name}
        back={`/settings/types/${typeId}`}
        action={{ label: 'Save', onClick: () => void save(), disabled: busy }}
      />
      <Page>
        <Section title="Field">
          <TextField label="Label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          {creating ? (
            <SelectField
              label="Type"
              value={fieldType}
              onChange={(v) => setFieldType(v as ActivityField['fieldType'])}
              options={Object.entries(FIELD_TYPE_LABEL).map(([value, l]) => ({ value, label: l }))}
            />
          ) : (
            <div className="stack">
              <span className="form-label">Type</span>
              <span>{FIELD_TYPE_LABEL[fieldType]} (can’t be changed)</span>
            </div>
          )}
          <SwitchRow label="Required" checked={required} onChange={setRequired} />
        </Section>
        {fieldType === 'number' && (
          <Section title="Number">
            <FieldGrid cols={2}>
              <TextField
                label="Unit (optional)"
                value={unit}
                maxLength={20}
                placeholder="ml"
                onChange={(e) => setUnit(e.target.value)}
              />
              <TextField
                label="Decimal places"
                inputMode="numeric"
                value={decimals}
                onChange={(e) => setDecimals(e.target.value)}
              />
            </FieldGrid>
            <FieldGrid cols={2}>
              <TextField
                label="Minimum (optional)"
                inputMode="decimal"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
              <TextField
                label="Maximum (optional)"
                inputMode="decimal"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            </FieldGrid>
          </Section>
        )}
        {fieldType === 'text' && (
          <Section title="Text">
            <TextField
              label="Maximum length"
              inputMode="numeric"
              value={maxLength}
              onChange={(e) => setMaxLength(e.target.value)}
            />
          </Section>
        )}
        {fieldType === 'list' && (
          <Section title="Options">
            <div className="field">
              <label htmlFor="opts">One option per line</label>
              <span className="field-box">
                <textarea id="opts" rows={5} value={options} onChange={(e) => setOptions(e.target.value)} />
              </span>
            </div>
          </Section>
        )}
        {fieldType === 'image_picker' && creating && (
          <Section title="Picker">
            <Segmented
              value={pickerSet}
              onChange={setPickerSet}
              options={[
                { value: 'stool_colour', label: 'Stool colour' },
                { value: 'stool_consistency', label: 'Stool consistency' },
              ]}
            />
          </Section>
        )}
        {siblings.length > 0 && (
          <Section title="Show only when (optional)">
            <SelectField
              label="Field"
              value={showField}
              onChange={(v) => {
                setShowField(v);
                setShowValues([]);
              }}
              options={[
                { value: '', label: 'Always show' },
                ...siblings.map((s) => ({ value: s.key, label: s.label })),
              ]}
            />
            {target && (
              <Segmented
                label={`${target.label} is`}
                multi
                value={showValues}
                onChange={(v) =>
                  setShowValues((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
                }
                options={(target.options ?? []).map((o) => ({ value: o, label: o }))}
              />
            )}
          </Section>
        )}
        <FormError message={error} />
        {!creating && (
          <Button
            variant={existing!.archivedAt ? 'secondary' : 'danger'}
            block
            disabled={busy}
            onClick={archive}
          >
            {existing!.archivedAt ? 'Restore this field' : 'Archive this field'}
          </Button>
        )}
        {!creating && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Archived fields are hidden when logging but keep their values in History and exports.
          </p>
        )}
      </Page>
    </>
  );
}
