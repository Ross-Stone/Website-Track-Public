// Child activity settings, medicines (Writer) and children, users (Admin).
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Medicine, User } from '../../../shared/domain';
import {
  ActivityTile,
  Button,
  FieldGrid,
  FormError,
  InfoBox,
  NavRow,
  Section,
  SelectField,
  SwitchRow,
  TextField,
} from '../../components/ui';
import { apiJson, errorMessage } from '../../lib/api';
import { useIsWriter, useRole } from '../../state/hooks';
import { useStore, writeConfig } from '../../state/store';
import { NotForRole, Page, SettingsHeader } from './common';

export function ChildActivities() {
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId);
  const writer = useIsWriter();
  if (!writer) return <NotForRole />;
  const child = boot.children.find((c) => c.id === childId);
  const types = boot.activityTypes.filter((t) => !t.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <>
      <SettingsHeader title="Child activity settings" sub={child?.firstName} back="/settings" />
      <Page>
        <Section>
          {types.map((t) => {
            const s = boot.childActivitySettings.find(
              (x) => x.childId === childId && x.activityTypeId === t.id,
            );
            const parts = [
              s?.enabled === false ? 'Turned off' : null,
              s?.quickLog ? 'Favourite' : null,
              s && Object.keys(s.defaults).length ? 'Defaults set' : null,
              s ? `Window ${s.windowBeforeMin}/${s.windowAfterMin} min` : null,
            ].filter(Boolean);
            return (
              <NavRow
                key={t.id}
                to={`/settings/types/${t.id}`}
                tile={<ActivityTile icon={t.icon} colour={t.colour} />}
                title={t.name}
                sub={parts.join(' · ')}
              />
            );
          })}
        </Section>
      </Page>
    </>
  );
}

function MedicineCard({
  med,
  childId,
  onDone,
}: {
  med: Medicine | null;
  childId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(med?.name ?? '');
  const [dose, setDose] = useState(med ? String(med.dose) : '');
  const [unit, setUnit] = useState(med?.doseUnit ?? 'ml');
  const [gapH, setGapH] = useState(med ? String(Math.floor(med.minGapMin / 60)) : '4');
  const [gapM, setGapM] = useState(med ? String(med.minGapMin % 60) : '0');
  const [max, setMax] = useState(med ? String(med.maxPer24h) : '4');
  const [alt, setAlt] = useState(med?.countsTowardsAlternating ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const body = {
      name: name.trim(),
      dose: Number(dose.replace(',', '.')),
      doseUnit: unit.trim() || 'ml',
      minGapMin: (Number(gapH) || 0) * 60 + (Number(gapM) || 0),
      maxPer24h: Number(max) || 0,
      countsTowardsAlternating: alt,
    };
    if (!body.name || !(body.dose > 0) || body.minGapMin < 1 || body.maxPer24h < 1) {
      return setError('Enter a name, a dose, a minimum gap and a maximum.');
    }
    setBusy(true);
    try {
      if (med) await writeConfig('PUT', `/medicines/${med.id}`, body);
      else await writeConfig('POST', '/medicines', { childId, ...body });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={med ? med.name : 'New medicine'}>
      <TextField label="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <FieldGrid cols={2}>
        <TextField label="Dose" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
        <TextField label="Unit" value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} />
      </FieldGrid>
      <FieldGrid cols={3}>
        <TextField
          label="Gap hours"
          inputMode="numeric"
          value={gapH}
          suffix="h"
          onChange={(e) => setGapH(e.target.value)}
        />
        <TextField
          label="Gap minutes"
          inputMode="numeric"
          value={gapM}
          suffix="m"
          onChange={(e) => setGapM(e.target.value)}
        />
        <TextField
          label="Max in 24 h"
          inputMode="numeric"
          value={max}
          suffix="doses"
          onChange={(e) => setMax(e.target.value)}
        />
      </FieldGrid>
      <SwitchRow label="Counts towards alternating" checked={alt} onChange={setAlt} />
      <div className="stack" style={{ gap: 8 }}>
        <FormError message={error} />
        <div className="btn-pair">
          {med ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                writeConfig('PUT', `/medicines/${med.id}`, { archived: !med.archivedAt })
                  .catch((e: unknown) => setError(errorMessage(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {med.archivedAt ? 'Restore' : 'Archive'}
            </Button>
          ) : (
            <Button onClick={onDone}>Cancel</Button>
          )}
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </Section>
  );
}

export function Medicines() {
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId);
  const writer = useIsWriter();
  const [adding, setAdding] = useState(false);
  if (!writer) return <NotForRole />;
  if (!childId) return <p className="empty">Add a child first.</p>;
  const child = boot.children.find((c) => c.id === childId);
  const meds = boot.medicines
    .filter((m) => m.childId === childId)
    .sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || a.sortOrder - b.sortOrder);
  return (
    <>
      <SettingsHeader
        title="Medicines"
        sub={child?.firstName}
        back="/settings"
        action={adding ? undefined : { label: 'Add', onClick: () => setAdding(true) }}
      />
      <Page>
        <InfoBox warn>
          These values are entered by you. Confirm them against the packaging or with your GP.
        </InfoBox>
        {adding && <MedicineCard med={null} childId={childId} onDone={() => setAdding(false)} />}
        {meds.map((m) => (
          <MedicineCard key={`${m.id}:${m.archivedAt ?? ''}`} med={m} childId={childId} onDone={() => {}} />
        ))}
      </Page>
    </>
  );
}

export function Children() {
  const boot = useStore((s) => s.boot)!;
  const role = useRole();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (role !== 'admin') return <NotForRole />;
  const kids = [...boot.children].sort((a, b) => a.sortOrder - b.sortOrder);
  const active = kids.filter((c) => !c.archivedAt);

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    fn()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  const move = (i: number, dir: -1 | 1) =>
    run(async () => {
      const a = active[i]!;
      const b = active[i + dir]!;
      await writeConfig('PUT', `/children/${a.id}`, { sortOrder: b.sortOrder });
      await writeConfig('PUT', `/children/${b.id}`, {
        sortOrder: a.sortOrder === b.sortOrder ? a.sortOrder + dir : a.sortOrder,
      });
    });

  return (
    <>
      <SettingsHeader title="Children" sub="Admin" back="/settings" />
      <Page>
        <Section>
          {active.map((c, i) => (
            <div key={c.id} className="row" style={{ gap: 4 }}>
              <ChildName id={c.id} name={c.firstName} onError={setError} />
              <Button
                size="sm"
                aria-label={`Move ${c.firstName} up`}
                disabled={busy || i === 0}
                onClick={() => move(i, -1)}
                style={{ padding: 0, width: 44 }}
              >
                <ArrowUp size={18} aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                aria-label={`Move ${c.firstName} down`}
                disabled={busy || i === active.length - 1}
                onClick={() => move(i, 1)}
                style={{ padding: 0, width: 44 }}
              >
                <ArrowDown size={18} aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => run(() => writeConfig('PUT', `/children/${c.id}`, { archived: true }))}
              >
                Archive
              </Button>
            </div>
          ))}
        </Section>
        {kids.some((c) => c.archivedAt) && (
          <Section title="Archived">
            {kids
              .filter((c) => c.archivedAt)
              .map((c) => (
                <div key={c.id} className="row" style={{ gap: 8 }}>
                  <span className="grow" style={{ fontWeight: 600 }}>
                    {c.firstName}
                  </span>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => writeConfig('PUT', `/children/${c.id}`, { archived: false }))}
                  >
                    Restore
                  </Button>
                </div>
              ))}
          </Section>
        )}
        <Section title="Add a child">
          <TextField
            label="First name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
          <div>
            <Button
              variant="primary"
              block
              icon={<Plus size={18} aria-hidden="true" />}
              disabled={busy || !name.trim()}
              onClick={() =>
                run(async () => {
                  await writeConfig('POST', '/children', { firstName: name.trim() });
                  setName('');
                })
              }
            >
              Add child
            </Button>
          </div>
        </Section>
        <FormError message={error} />
      </Page>
    </>
  );
}

function ChildName({ id, name, onError }: { id: string; name: string; onError: (m: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <TextField
      className="grow"
      label="First name"
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() && value.trim() !== name)
          writeConfig('PUT', `/children/${id}`, { firstName: value.trim() }).catch((e: unknown) =>
            onError(errorMessage(e)),
          );
      }}
    />
  );
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'writer', label: 'Writer' },
  { value: 'reader', label: 'Read only' },
];

export function Users() {
  const role = useRole();
  const me = useStore((s) => s.boot?.me);
  const [users, setUsers] = useState<User[] | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [newRole, setNewRole] = useState('writer');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    apiJson<{ users: User[] }>('GET', '/users')
      .then((r) => setUsers(r.users))
      .catch((e: unknown) => setError(errorMessage(e)));
  useEffect(() => {
    if (role === 'admin') void load();
  }, [role]);
  if (role !== 'admin') return <NotForRole />;

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    fn()
      .then(load)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <SettingsHeader title="Users" sub="Admin" back="/settings" />
      <Page>
        <InfoBox>Also add each email to the Cloudflare Access policy, or they can't sign in.</InfoBox>
        <Section>
          {users === null && <span className="muted">Loading…</span>}
          {users?.map((u) => {
            const self = u.id === me?.id;
            return (
              <div key={u.id} className="stack" style={{ gap: 8 }}>
                <div className="stack">
                  <span style={{ fontWeight: 700 }}>
                    {u.displayName}
                    {self ? ' (you)' : ''}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {u.email}
                  </span>
                </div>
                <SelectField
                  label="Role"
                  value={u.role}
                  disabled={busy || self}
                  onChange={(v) => run(() => writeConfig('PUT', `/users/${u.id}`, { role: v }))}
                  options={ROLE_OPTIONS}
                />
                <SwitchRow
                  label="Active"
                  help={self ? "You can't deactivate yourself" : undefined}
                  checked={u.active}
                  disabled={busy || self}
                  onChange={(v) => run(() => writeConfig('PUT', `/users/${u.id}`, { active: v }))}
                />
              </div>
            );
          })}
        </Section>
        <Section title="Add a user">
          <TextField
            label="Email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField label="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <SelectField label="Role" value={newRole} onChange={setNewRole} options={ROLE_OPTIONS} />
          <div>
            <Button
              variant="primary"
              block
              disabled={busy || !email.trim() || !name.trim()}
              onClick={() =>
                run(async () => {
                  await writeConfig('POST', '/users', {
                    email: email.trim(),
                    displayName: name.trim(),
                    role: newRole,
                  });
                  setEmail('');
                  setName('');
                })
              }
            >
              Add user
            </Button>
          </div>
        </Section>
        <FormError message={error} />
      </Page>
    </>
  );
}
