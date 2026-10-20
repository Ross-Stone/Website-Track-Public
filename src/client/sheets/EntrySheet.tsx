// Entry details, edit and delete with undo (FR-LOG-05, FR-LOG-06, FR-LOG-07).
import { Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatShortDay, localDateOf, localTimeOf } from '../../shared/time';
import { ActivityTile, Button, FormError, Sheet } from '../components/ui';
import { errorMessage } from '../lib/api';
import { Lookup, formatFieldValue } from '../lib/format';
import { deleteEntry, restoreEntry, useStore } from '../state/store';
import { useSheets, type SheetRequest } from './host';
import { useCanEdit } from '../state/hooks';

export function EntrySheet({ req }: { req: Extract<SheetRequest, { kind: 'entry' }> }) {
  const { close, open, snack } = useSheets();
  const boot = useStore((s) => s.boot)!;
  const canEdit = useCanEdit();
  const lookup = useMemo(() => new Lookup(boot), [boot]);
  const e = req.entry;
  const type = lookup.type(e.activityTypeId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = lookup.title(e);
  const when = `${formatShortDay(e.localDate)} · ${localTimeOf(e.startUtc, e.tz)}${e.endUtc ? ` – ${localTimeOf(e.endUtc, e.tz)}${localDateOf(e.endUtc, e.tz) !== e.localDate ? ` (${formatShortDay(localDateOf(e.endUtc, e.tz))})` : ''}` : e.endUtc === null && type?.kind === 'duration' ? ' · running' : ''}`;
  const edited = e.updatedAt !== e.createdAt || e.updatedBy !== e.createdBy;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteEntry(e.id);
      close();
      // FR-LOG-06 AC1: an Undo option for at least 5 seconds.
      snack({
        message: `${title} at ${localTimeOf(e.startUtc, e.tz)} deleted`,
        actionLabel: 'Undo',
        onAction: () => void restoreEntry(e.id),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const fieldLines = (lookup.fieldsByType.get(e.activityTypeId) ?? [])
    .filter((f) => e.values[f.key] !== undefined && e.values[f.key] !== '')
    .map((f) =>
      f.fieldType === 'boolean'
        ? formatFieldValue(f, e.values[f.key]!)
        : `${f.label}: ${formatFieldValue(f, e.values[f.key]!)}`,
    );

  return (
    <Sheet
      open
      onClose={close}
      title={title}
      sub={when}
      tile={type ? <ActivityTile icon={type.icon} colour={type.colour} size={44} /> : undefined}
    >
      <div className="stack" style={{ gap: 4 }}>
        {e.dose !== null && (
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            Dose: {`${e.dose} ${e.doseUnit ?? ''}`.trim()}
          </span>
        )}
        {fieldLines.map((l) => (
          <span key={l} style={{ fontSize: 16, fontWeight: 600 }}>
            {l}
          </span>
        ))}
        {e.note && <span className="muted">Note: {e.note}</span>}
        {e.autoConfirmed && <span className="muted">Logged automatically from the schedule</span>}
      </div>
      <div className="stack muted" style={{ gap: 4, fontSize: 13, fontWeight: 500 }}>
        <span>
          Logged by {lookup.user(e.createdBy)} at {localTimeOf(e.createdAt, e.tz)}
          {localDateOf(e.createdAt, e.tz) !== e.localDate
            ? ` on ${formatShortDay(localDateOf(e.createdAt, e.tz))}`
            : ''}
        </span>
        {edited && (
          <span>
            Edited by {lookup.user(e.updatedBy)} at {localTimeOf(e.updatedAt, e.tz)}
            {localDateOf(e.updatedAt, e.tz) !== localDateOf(e.createdAt, e.tz)
              ? ` on ${formatShortDay(localDateOf(e.updatedAt, e.tz))}`
              : ''}
          </span>
        )}
      </div>
      <FormError message={error} />
      {canEdit &&
        (confirming ? (
          <div className="stack" style={{ gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Delete this entry?</span>
            <div className="btn-pair">
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              <Button
                variant="danger"
                icon={<Trash2 size={18} aria-hidden="true" />}
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="btn-pair">
            <Button
              variant="danger"
              icon={<Trash2 size={18} aria-hidden="true" />}
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
            <Button
              variant="primary"
              icon={<Pencil size={18} aria-hidden="true" />}
              onClick={() => open({ kind: 'log', childId: e.childId, typeId: e.activityTypeId, entry: e })}
            >
              Edit
            </Button>
          </div>
        ))}
    </Sheet>
  );
}
