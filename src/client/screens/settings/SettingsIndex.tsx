import { Baby, CalendarDays, LayoutGrid, Pill, Star, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { roleAtLeast } from '../../../shared/constants';
import { NavRow, Section, Segmented, paletteVars } from '../../components/ui';
import { useTheme, type ThemeChoice } from '../../lib/theme';
import { useStore } from '../../state/store';
import { BackupSection, StorageSection } from './Backup';
import { Page, SettingsHeader } from './common';

const ROLE_NAME = { admin: 'Admin', writer: 'Writer', reader: 'Read only' } as const;

function Tile({ colour, children }: { colour: Parameters<typeof paletteVars>[0]; children: ReactNode }) {
  return (
    <span className="tile tile-36" style={paletteVars(colour)} aria-hidden="true">
      {children}
    </span>
  );
}

export function SettingsIndex() {
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId);
  const [theme, setTheme] = useTheme();
  const role = boot.me.role;
  const child = boot.children.find((c) => c.id === childId);
  const activeKids = boot.children.filter((c) => !c.archivedAt);
  const items = boot.scheduleItems.filter((i) => i.childId === childId && !i.archivedAt);
  const archivedTypes = boot.activityTypes.filter((t) => t.archivedAt).length;
  const meds = boot.medicines.filter((m) => m.childId === childId && !m.archivedAt);

  return (
    <>
      <SettingsHeader title="Settings" sub={`Signed in as ${boot.me.displayName} · ${ROLE_NAME[role]}`} />
      <Page>
        {role === 'admin' && (
          <Section title="Family">
            <NavRow
              to="/settings/children"
              title="Children"
              sub={activeKids.map((c) => c.firstName).join(', ') || 'None yet'}
              badges={['Admin']}
              tile={
                <Tile colour="neutral">
                  <Baby size={20} />
                </Tile>
              }
            />
            <NavRow
              to="/settings/users"
              title="Users"
              sub={boot.users.map((u) => u.displayName).join(' · ')}
              badges={['Admin']}
              tile={
                <Tile colour="neutral">
                  <Users size={20} />
                </Tile>
              }
            />
          </Section>
        )}
        {roleAtLeast(role, 'writer') && (
          <Section title="Tracking">
            <NavRow
              to="/settings/schedule"
              title="Schedule"
              sub={
                child
                  ? `${child.firstName} · ${items.length} ${items.length === 1 ? 'item' : 'items'}`
                  : undefined
              }
              tile={
                <Tile colour="blue">
                  <CalendarDays size={20} />
                </Tile>
              }
            />
            <NavRow
              to="/settings/types"
              title="Activity types and fields"
              sub={`${boot.activityTypes.length} types${archivedTypes ? `, ${archivedTypes} archived` : ''}`}
              tile={
                <Tile colour="violet">
                  <LayoutGrid size={20} />
                </Tile>
              }
            />
            <NavRow
              to="/settings/child-activities"
              title="Child activity settings"
              sub="Favourites, defaults, detection windows"
              tile={
                <Tile colour="amber">
                  <Star size={20} />
                </Tile>
              }
            />
            <NavRow
              to="/settings/medicines"
              title="Medicines"
              sub={meds.map((m) => m.name).join(', ') || 'None yet'}
              tile={
                <Tile colour="red">
                  <Pill size={20} />
                </Tile>
              }
            />
          </Section>
        )}
        <Section title="Theme">
          <div className="stack" style={{ gap: 8 }}>
            <Segmented<ThemeChoice>
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
            <span className="muted" style={{ fontSize: 13 }}>
              Saved on this phone only
            </span>
          </div>
        </Section>
        {roleAtLeast(role, 'writer') && <BackupSection />}
        {role === 'admin' && <StorageSection />}
        <Section title="About">
          <div className="stack" style={{ gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Track {__APP_VERSION__}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {window.location.hostname}
            </span>
          </div>
        </Section>
      </Page>
    </>
  );
}
