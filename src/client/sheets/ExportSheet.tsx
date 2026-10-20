// CSV export (FR-HIST-04). Up to 31 days the server builds the file; longer ranges are built here from
// the entries API in chunks, with the same shared flattening (agreed Q9).
import { Download } from 'lucide-react';
import { useState } from 'react';
import { MAX_SERVER_EXPORT_DAYS, type Bootstrap } from '../../shared/api';
import { buildCsv, csvFileName } from '../../shared/csv';
import type { Entry } from '../../shared/domain';
import { addDays, daysBetween } from '../../shared/time';
import { Button, FieldGrid, FormError, Segmented, Sheet, TextField } from '../components/ui';
import { apiBlob, apiJson, errorMessage } from '../lib/api';
import { download } from '../lib/download';
import { useStore } from '../state/store';
import { useSheets, type SheetRequest } from './host';

const CHUNK_DAYS = 30;

async function buildLocally(childIds: string[], from: string, to: string, boot: Bootstrap) {
  const entries: Entry[] = [];
  for (const childId of childIds) {
    // Widen by a day each side, then keep entries whose own local date is in range.
    for (let d = addDays(from, -1); d <= addDays(to, 1); d = addDays(d, CHUNK_DAYS)) {
      const end = addDays(d, CHUNK_DAYS);
      const r = await apiJson<{ entries: Entry[] }>(
        'GET',
        `/children/${childId}/entries?from=${d}T00:00:00Z&to=${end}T00:00:00Z`,
      );
      entries.push(...r.entries);
    }
  }
  const unique = [
    ...new Map(
      entries.filter((e) => e.localDate >= from && e.localDate <= to).map((e) => [e.id, e]),
    ).values(),
  ];
  return buildCsv({
    entries: unique,
    children: boot.children,
    activityTypes: boot.activityTypes,
    fields: boot.fields,
    medicines: boot.medicines,
    users: boot.users,
  });
}

export function ExportSheet({ req }: { req: Extract<SheetRequest, { kind: 'export' }> }) {
  const { close } = useSheets();
  const boot = useStore((s) => s.boot)!;
  const [from, setFrom] = useState(addDays(req.date, -6));
  const [to, setTo] = useState(req.date);
  const [who, setWho] = useState<string>(req.childId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const child = boot.children.find((c) => c.id === req.childId);
  const valid = from && to && from <= to;

  async function run() {
    if (!valid) return setError('From must be on or before To.');
    setBusy(true);
    setError(null);
    try {
      const name = csvFileName(from, to);
      if (daysBetween(from, to) + 1 <= MAX_SERVER_EXPORT_DAYS) {
        download(await apiBlob(`/export.csv?from=${from}&to=${to}&child=${encodeURIComponent(who)}`), name);
      } else {
        const ids = who === 'all' ? boot.children.map((c) => c.id) : [who];
        const csv = await buildLocally(ids, from, to, boot);
        download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
      }
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={close}
      title="Export CSV"
      sub="Entries between two dates"
      tile={
        <span
          className="tile tile-44"
          style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
          aria-hidden="true"
        >
          <Download size={24} />
        </span>
      }
    >
      <FieldGrid cols={2}>
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </FieldGrid>
      <Segmented
        label="Child"
        value={who}
        onChange={setWho}
        options={[
          { value: req.childId, label: child?.firstName ?? 'This child' },
          { value: 'all', label: 'All children' },
        ]}
      />
      <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
        {valid ? csvFileName(from, to) : 'Choose a valid range'}
      </span>
      <FormError message={error} />
      <div className="btn-pair">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          icon={<Download size={18} aria-hidden="true" />}
          disabled={busy || !valid}
          onClick={() => void run()}
        >
          {busy ? 'Preparing…' : 'Download CSV'}
        </Button>
      </div>
    </Sheet>
  );
}
