// JSON backup download and import (FR-SET-10, FR-SET-11). The server sends the backup in parts and
// takes an import in chunks, so each request stays within the Worker's CPU limit (agreed Q9).
import type { BackupEntriesPage, ImportCommit } from '../../shared/api';
import {
  BACKUP_TABLES,
  chunkRows,
  type Backup,
  type BackupTable,
  type BackupTables,
} from '../../shared/backup';
import { apiJson, apiSend, JsonText } from './api';

/** Fetches every entry page, then the rest (which records the backup), and joins them into one backup. */
export async function fetchBackup(): Promise<Backup> {
  const entries: unknown[] = [];
  let after = '';
  for (;;) {
    const page = await apiJson<BackupEntriesPage>(
      'GET',
      `/backup?part=entries&after=${encodeURIComponent(after)}`,
    );
    entries.push(...page.rows);
    if (!page.next) break;
    after = page.next;
  }
  const config = await apiJson<Backup>('GET', '/backup?part=config');
  const all: Record<string, unknown> = { ...config.tables, entries };
  // Tables in a fixed order, parents first, so files read the same every time.
  const tables = Object.fromEntries(BACKUP_TABLES.map((t) => [t, all[t] ?? []])) as BackupTables;
  return { ...config, tables };
}

/** Uploads a validated backup in chunks, then asks the server to swap it in (all or nothing). */
export async function importBackup(
  backup: Backup,
  counts: Record<BackupTable, number>,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const chunks = BACKUP_TABLES.flatMap((t) =>
    chunkRows(backup.tables[t]).map((text, seq) => ({ t, seq, text })),
  );
  onProgress(0, chunks.length);
  const { importId } = await apiJson<{ importId: string }>('POST', '/import/start');
  let done = 0;
  for (const c of chunks) {
    await apiSend('PUT', `/import/${importId}/${c.t}/${c.seq}`, new JsonText(c.text));
    onProgress(++done, chunks.length);
  }
  const commit: ImportCommit = { importId, confirm: 'REPLACE', schemaVersion: backup.schemaVersion, counts };
  await apiJson('POST', '/import', commit);
}
