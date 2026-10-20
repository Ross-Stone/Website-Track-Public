// Schedule items per child (FR-SCHED-01, FR-SCHED-02).
import { Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ScheduleItemInput } from '../../../shared/api';
import type { ScheduleItem } from '../../../shared/domain';
import { EVERY_DAY, MONDAY_TO_FRIDAY } from '../../../shared/schedule';
import { clockMinutes, formatDateUK } from '../../../shared/time';
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
} from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { useIsWriter } from '../../state/hooks';
import { useStore, writeConfig } from '../../state/store';
import { describeDays, NotForRole, Page, SettingsHeader } from './common';

export function ScheduleList() {
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId);
  const { navigate } = useRouter();
  const writer = useIsWriter();
  if (!writer) return <NotForRole />;
  const child = boot.children.find((c) => c.id === childId);
  const types = new Map(boot.activityTypes.map((t) => [t.id, t]));
  const items = boot.scheduleItems
    .filter((i) => i.childId === childId && !i.archivedAt)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <>
      <SettingsHeader
        title="Schedule"
        sub={child?.firstName}
        back="/settings"
        action={{ label: 'Add', onClick: () => navigate('/settings/schedule/new') }}
      />
      <Page>
        {items.length === 0 ? (
          <p className="empty">No planned items yet.</p>
        ) : (
          <Section>
            {items.map((i) => {
              const t = types.get(i.activityTypeId);
              const overnight = i.endTime !== null && clockMinutes(i.endTime) <= clockMinutes(i.startTime);
              const badges = [
                i.autoConfirm ? 'Auto' : null,
                i.repeat === 'fortnightly' ? 'Every 2 weeks' : null,
                i.validFrom || i.validUntil
                  ? `${i.validFrom ? formatDateUK(i.validFrom).slice(0, 5) : '…'} – ${i.validUntil ? formatDateUK(i.validUntil).slice(0, 5) : '…'}`
                  : null,
              ].filter((b): b is string => !!b);
              return (
                <NavRow
                  key={i.id}
                  to={`/settings/schedule/${i.id}`}
                  lead={i.endTime ? `${i.startTime}\n${i.endTime}` : i.startTime}
                  tile={t && <ActivityTile icon={t.icon} colour={t.colour} />}
                  title={i.label ?? t?.name ?? 'Activity'}
                  sub={`${describeDays(i.daysMask)}${overnight ? ' · ends next morning' : ''}`}
                  badges={badges}
                />
              );
            })}
          </Section>
        )}
      </Page>
    </>
  );
}

const DAYS = [
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
  ['S', 'Sunday'],
] as const;

export function ScheduleEditor({ id }: { id: string }) {
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId)!;
  const { navigate } = useRouter();
  const writer = useIsWriter();
  const existing = boot.scheduleItems.find((i) => i.id === id);
  const creating = id === 'new';
  const enabledTypes = boot.activityTypes.filter(
    (t) =>
      (!t.archivedAt &&
        boot.childActivitySettings.some(
          (s) => s.childId === childId && s.activityTypeId === t.id && s.enabled,
        )) ||
      t.id === existing?.activityTypeId,
  );
  const [f, setF] = useState<ScheduleItemInput & { activityTypeId: string }>(() =>
    existing
      ? { ...existing }
      : {
          childId,
          activityTypeId: enabledTypes[0]?.id ?? '',
          label: null,
          startTime: '09:00',
          endTime: null,
          daysMask: EVERY_DAY,
          repeat: 'weekly',
          anchorDate: null,
          validFrom: null,
          validUntil: null,
          autoConfirm: false,
          note: null,
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!writer) return <NotForRole />;
  if (!creating && !existing) return <p className="empty">This planned item no longer exists.</p>;

  const type = boot.activityTypes.find((t) => t.id === f.activityTypeId);
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const toggleDay = (i: number) => set({ daysMask: (f.daysMask ?? 0) ^ (1 << i) });

  async function act(fn: () => Promise<unknown>, then = '/settings/schedule') {
    setBusy(true);
    setError(null);
    try {
      await fn();
      navigate(then);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () => {
    if (!f.daysMask) return setError('Choose at least one day.');
    const body: ScheduleItemInput = {
      ...f,
      label: f.label?.trim() || null,
      note: f.note?.trim() || null,
      endTime: f.endTime || null,
      anchorDate: f.repeat === 'fortnightly' ? f.anchorDate || f.validFrom || null : null,
      validFrom: f.validFrom || null,
      validUntil: f.validUntil || null,
    };
    void act(() =>
      creating
        ? writeConfig('POST', '/schedule-items', body)
        : writeConfig('PUT', `/schedule-items/${id}`, body),
    );
  };

  return (
    <>
      <SettingsHeader
        title={creating ? 'New planned item' : (existing?.label ?? type?.name ?? 'Planned item')}
        sub={`Schedule item · ${boot.children.find((c) => c.id === childId)?.firstName ?? ''}`}
        back="/settings/schedule"
        action={{ label: 'Save', onClick: save, disabled: busy }}
      />
      <Page>
        <Section title="Activity">
          <SelectField
            label="Activity type"
            value={f.activityTypeId}
            onChange={(v) => set({ activityTypeId: v })}
            options={enabledTypes.map((t) => ({ value: t.id, label: t.name }))}
          />
          <TextField
            label="Label (optional)"
            value={f.label ?? ''}
            maxLength={60}
            placeholder={type?.name}
            onChange={(e) => set({ label: e.target.value })}
          />
        </Section>
        <Section title="Time">
          <FieldGrid cols={2}>
            <TextField
              label="Start"
              type="time"
              value={f.startTime}
              onChange={(e) => set({ startTime: e.target.value })}
            />
            <TextField
              label="End (optional)"
              type="time"
              value={f.endTime ?? ''}
              onChange={(e) => set({ endTime: e.target.value || null })}
            />
          </FieldGrid>
        </Section>
        <Section title="Days">
          <div className="stack" style={{ gap: 12 }}>
            <div className="seg multi" role="group" aria-label="Days of the week">
              {DAYS.map(([short, long], i) => (
                <button
                  key={long}
                  type="button"
                  aria-pressed={!!((f.daysMask ?? 0) & (1 << i))}
                  aria-label={long}
                  onClick={() => toggleDay(i)}
                >
                  {short}
                </button>
              ))}
            </div>
            <div className="btn-pair">
              <Button size="sm" onClick={() => set({ daysMask: EVERY_DAY })}>
                Every day
              </Button>
              <Button size="sm" onClick={() => set({ daysMask: MONDAY_TO_FRIDAY })}>
                Monday to Friday
              </Button>
            </div>
          </div>
        </Section>
        <Section title="Repeat">
          <div className="stack" style={{ gap: 12 }}>
            <Segmented
              value={f.repeat ?? 'weekly'}
              onChange={(v) => set({ repeat: v })}
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'fortnightly', label: 'Every 2 weeks' },
              ]}
            />
            {f.repeat === 'fortnightly' && (
              <TextField
                label="A date in a week it happens"
                type="date"
                value={f.anchorDate ?? ''}
                onChange={(e) => set({ anchorDate: e.target.value || null })}
              />
            )}
            <FieldGrid cols={2}>
              <TextField
                label="From (optional)"
                type="date"
                value={f.validFrom ?? ''}
                onChange={(e) => set({ validFrom: e.target.value || null })}
              />
              <TextField
                label="Until (optional)"
                type="date"
                value={f.validUntil ?? ''}
                onChange={(e) => set({ validUntil: e.target.value || null })}
              />
            </FieldGrid>
          </div>
        </Section>
        <Section title="Logging">
          <SwitchRow
            label="Auto-confirm"
            help={`Logged for you once ${f.startTime} has passed`}
            checked={!!f.autoConfirm}
            onChange={(v) => set({ autoConfirm: v })}
          />
        </Section>
        <Section title="Note">
          <TextField
            label="Note (optional)"
            value={f.note ?? ''}
            maxLength={500}
            onChange={(e) => set({ note: e.target.value })}
          />
        </Section>
        <FormError message={error} />
        {!creating && existing && (
          <div className="btn-pair">
            <Button
              variant="danger"
              icon={<Trash2 size={18} aria-hidden="true" />}
              disabled={busy}
              onClick={() => void act(() => writeConfig('DELETE', `/schedule-items/${id}`))}
            >
              Archive
            </Button>
            <Button
              icon={<Copy size={18} aria-hidden="true" />}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                writeConfig<{ scheduleItem: ScheduleItem }>('POST', `/schedule-items/${id}/duplicate`)
                  .then((r) => navigate(`/settings/schedule/${r.scheduleItem.id}`))
                  .catch((e: unknown) => setError(errorMessage(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Duplicate
            </Button>
          </div>
        )}
      </Page>
    </>
  );
}
