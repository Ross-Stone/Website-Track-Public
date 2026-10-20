// "Other" (every enabled, non-archived activity, FR-LOG-02) and the child switcher (FR-CHILD-02).
import { ActivityTile, Sheet } from '../components/ui';
import { selectChild, useStore } from '../state/store';
import { useSheets, type SheetRequest } from './host';
import { LayoutGrid, Users } from 'lucide-react';

export function OtherSheet({ req }: { req: Extract<SheetRequest, { kind: 'other' }> }) {
  const { close, open } = useSheets();
  const boot = useStore((s) => s.boot)!;
  const enabled = new Set(
    boot.childActivitySettings
      .filter((s) => s.childId === req.childId && s.enabled)
      .map((s) => s.activityTypeId),
  );
  const types = boot.activityTypes
    .filter((t) => !t.archivedAt && enabled.has(t.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return (
    <Sheet
      open
      onClose={close}
      title={req.date ? 'Add an entry' : 'Log something else'}
      tile={
        <span
          className="tile tile-44"
          style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
          aria-hidden="true"
        >
          <LayoutGrid size={24} />
        </span>
      }
    >
      <div className="card" style={{ background: 'transparent' }}>
        {types.map((t) => (
          <button
            key={t.id}
            type="button"
            className="nav-row"
            onClick={() => open({ kind: 'log', childId: req.childId, typeId: t.id, date: req.date })}
          >
            <ActivityTile icon={t.icon} colour={t.colour} />
            <span className="grow title">{t.name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function ChildSheet() {
  const { close } = useSheets();
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId);
  const kids = boot.children.filter((c) => !c.archivedAt);
  return (
    <Sheet
      open
      onClose={close}
      title="Switch child"
      tile={
        <span
          className="tile tile-44"
          style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
          aria-hidden="true"
        >
          <Users size={24} />
        </span>
      }
    >
      <div className="stack" role="radiogroup" aria-label="Child" style={{ gap: 8 }}>
        {kids.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={c.id === childId}
            className="radio-card"
            onClick={() => {
              void selectChild(c.id);
              close();
            }}
          >
            <span className="grow title">{c.firstName}</span>
            <span className="radio-dot" aria-hidden="true" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
