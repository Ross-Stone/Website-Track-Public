// Settings › Backup and import (FR-SET-10, FR-SET-11) and Storage (FR-SET-12), laid out as in the design.
import { Download, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StorageInfo } from '../../../shared/api';
import { backupFileName, lastBackupLabel, parseBackup, type ParseResult } from '../../../shared/backup';
import { formatShortDayYear, localDateOf } from '../../../shared/time';
import { Button, FormError, InfoBox, Section, Sheet, TextField } from '../../components/ui';
import { apiJson, errorMessage } from '../../lib/api';
import { fetchBackup, importBackup } from '../../lib/backup';
import { download } from '../../lib/download';
import { useSheets } from '../../sheets/host';
import { useCanEdit, useRole } from '../../state/hooks';
import { check, reloadAll, today, tz, useStore } from '../../state/store';

export function BackupSection() {
  const boot = useStore((s) => s.boot)!;
  const role = useRole();
  const canEdit = useCanEdit();
  const { snack } = useSheets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Extract<ParseResult, { ok: true }> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function backup() {
    setBusy(true);
    setError(null);
    try {
      const b = await fetchBackup();
      const name = backupFileName(localDateOf(b.exportedAt, tz()));
      download(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), name);
      snack({ message: `Saved ${name}` }, 5000);
      void check(true); // "Last backup" moves to today
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = ''; // so the same file can be picked again
    if (!file) return;
    setError(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return setError("That file isn't a Track backup (it isn't JSON).");
    }
    const r = parseBackup(raw, boot.me.email);
    if (!r.ok) return setError(r.error);
    setPicked(r);
  }

  return (
    <>
      <Section title="Backup and import">
        <span style={{ fontSize: 15, fontWeight: 600 }}>
          {lastBackupLabel(boot.appSettings.last_backup_at, today(), tz())}
        </span>
        <div className="stack" style={{ gap: 8 }}>
          <div className="btn-pair">
            {role === 'admin' && (
              <Button
                icon={<Upload size={18} aria-hidden="true" />}
                // Sized to its label so "Download backup" fits on one line at phone widths.
                style={{ flex: 'none' }}
                disabled={!canEdit || busy}
                onClick={() => fileRef.current?.click()}
              >
                Import
              </Button>
            )}
            <Button
              variant="primary"
              icon={<Download size={18} aria-hidden="true" />}
              disabled={!canEdit || busy}
              onClick={() => void backup()}
            >
              {busy ? 'Preparing…' : 'Download backup'}
            </Button>
          </div>
          {role === 'admin' && (
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Backup file to import"
              data-testid="import-file"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          )}
          <FormError message={error} />
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {role === 'admin'
            ? 'Import replaces all data. Admin only.'
            : 'A copy of everything: entries, schedule and settings.'}
        </span>
      </Section>
      {picked && (
        <ImportSheet
          picked={picked}
          onClose={() => setPicked(null)}
          onDone={() => {
            setPicked(null);
            snack({ message: 'Backup imported' }, 5000);
          }}
        />
      )}
    </>
  );
}

function ImportSheet({
  picked,
  onClose,
  onDone,
}: {
  picked: Extract<ParseResult, { ok: true }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = useCanEdit();
  const { counts, backup } = picked;
  const busy = progress !== null;
  const kids = backup.tables.children.map((c) => c.first_name).join(', ') || 'no children';

  async function run() {
    setError(null);
    setProgress('Uploading…');
    try {
      await importBackup(backup, counts, (done, total) =>
        setProgress(done < total ? `Uploading ${done + 1} of ${total}…` : 'Replacing data…'),
      );
      await reloadAll();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setProgress(null);
    }
  }

  return (
    <Sheet
      open
      onClose={() => !busy && onClose()}
      title="Import backup"
      sub={`Saved ${formatShortDayYear(localDateOf(backup.exportedAt, tz()))}`}
      tile={
        <span
          className="tile tile-44"
          style={{ background: 'var(--warn-bg)', color: 'var(--warn-text)' }}
          aria-hidden="true"
        >
          <TriangleAlert size={24} />
        </span>
      }
    >
      <InfoBox warn>
        This replaces all data on every phone with the backup: {counts.entries}{' '}
        {counts.entries === 1 ? 'entry' : 'entries'} for {kids}, {counts.users} users, the schedule and
        settings. Anything logged since the backup was saved is lost. It can’t be undone.
      </InfoBox>
      <TextField
        label="Type REPLACE to confirm"
        value={confirm}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={busy}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {progress && (
        <span role="status" className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
          {progress}
        </span>
      )}
      <FormError message={error} />
      <div className="btn-pair">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={confirm !== 'REPLACE' || busy || !canEdit}
          onClick={() => void run()}
        >
          Replace all data
        </Button>
      </div>
    </Sheet>
  );
}

const MB = 1024 * 1024;
const formatMb = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

export function StorageSection() {
  const online = useStore((s) => s.online);
  const version = useStore((s) => s.boot?.version);
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    let live = true;
    apiJson<StorageInfo>('GET', '/storage')
      .then((r) => live && (setInfo(r), setError(null)))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [online, version]);

  const ratio = info ? info.bytes / info.limitBytes : 0;
  const pct = Math.min(100, ratio * 100);
  const pctText = `${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%`;
  const warn = info ? ratio >= info.warningRatio : false;

  return (
    <Section title="Storage">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>Database</span>
          <span className="muted">
            {info
              ? `${formatMb(info.bytes)} of ${formatMb(info.limitBytes)} · ${pctText}`
              : online
                ? '…'
                : ''}
          </span>
        </div>
        <div
          className={warn ? 'meter-bar warn' : 'meter-bar'}
          role="meter"
          aria-label="Database storage used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-valuetext={info ? `${pctText} of the free plan limit` : undefined}
        >
          <div style={{ width: `${pct}%` }} />
        </div>
        {warn && info && (
          <InfoBox warn>
            The database is over {Math.round(info.warningRatio * 100)}% full. Time to plan for more space.
          </InfoBox>
        )}
        {!online && !info && (
          <span className="muted" style={{ fontSize: 13 }}>
            Connect to see storage.
          </span>
        )}
        <FormError message={error} />
        <span className="muted" style={{ fontSize: 13 }}>
          Free plan limit · warning shows at {Math.round((info?.warningRatio ?? 0.8) * 100)}%
        </span>
      </div>
    </Section>
  );
}
