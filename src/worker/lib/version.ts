import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { syncState } from '../db/schema';

/**
 * The sync version bump that goes in the same batch as every write (TECH-09).
 * `onlyIf` makes it conditional, e.g. only when an INSERT … ON CONFLICT DO NOTHING actually inserted.
 */
export function bumpVersion(db: Db, onlyIf?: SQL) {
  return db
    .update(syncState)
    .set({ version: sql`${syncState.version} + 1` })
    .where(onlyIf ? and(eq(syncState.id, 1), onlyIf) : eq(syncState.id, 1));
}

/** The same bump as a raw D1 statement, for routes that batch raw SQL (backup and import). */
export function bumpVersionStatement(d1: D1Database) {
  return d1.prepare('UPDATE sync_state SET version = version + 1 WHERE id = 1');
}
