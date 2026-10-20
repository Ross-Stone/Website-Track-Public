import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { activityTypes, childActivitySettings, children } from '../db/schema';
import { invalid, notFound } from './http';

/** Loads a child or 404s. */
export async function requireChild(db: Db, id: string) {
  const child = await db.select().from(children).where(eq(children.id, id)).get();
  if (!child) notFound('Child');
  return child;
}

/** Checks that a type can be planned or logged for a child: exists, not archived, enabled (FR-ACT-05, FR-ACT-06). */
export async function requireUsableType(db: Db, childId: string, typeId: string) {
  const [types, settings] = await db.batch([
    db.select().from(activityTypes).where(eq(activityTypes.id, typeId)),
    db
      .select()
      .from(childActivitySettings)
      .where(
        and(eq(childActivitySettings.childId, childId), eq(childActivitySettings.activityTypeId, typeId)),
      ),
  ]);
  const type = types[0];
  if (!type) notFound('Activity type');
  if (type.archivedAt) invalid(`${type.name} is archived.`);
  if (settings[0] && !settings[0].enabled) invalid(`${type.name} is turned off for this child.`);
  return type;
}
