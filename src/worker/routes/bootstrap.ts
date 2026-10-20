import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Bootstrap } from '../../shared/api';
import { requireRole } from '../auth/middleware';
import { getDb } from '../db/client';
import {
  toActivityType,
  toChild,
  toEntry,
  toField,
  toMedicine,
  toScheduleItem,
  toSetting,
} from '../db/mappers';
import {
  activityFields,
  activityTypes,
  appSettings,
  childActivitySettings,
  children,
  entries,
  medicines,
  scheduleItems,
  syncState,
  users,
} from '../db/schema';
import type { AppEnv } from '../env';

// GET /api/bootstrap (R): all configuration in one D1 batch (TECH-14: one round trip, not one query per table).
// Archived rows are included so History and exports can still name them; the app filters them where needed.
export const bootstrapRoutes = new Hono<AppEnv>().get('/bootstrap', requireRole('reader'), async (c) => {
  const db = getDb(c.env.DB);
  const [
    version,
    userRows,
    childRows,
    typeRows,
    fieldRows,
    settingRows,
    itemRows,
    medicineRows,
    settingsKv,
    latest,
  ] = await db.batch([
    db.select({ version: syncState.version }).from(syncState).where(eq(syncState.id, 1)),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
    db.select().from(children).orderBy(children.sortOrder, children.firstName),
    db.select().from(activityTypes).orderBy(activityTypes.sortOrder, activityTypes.name),
    db.select().from(activityFields).orderBy(activityFields.activityTypeId, activityFields.sortOrder),
    db.select().from(childActivitySettings),
    db.select().from(scheduleItems).orderBy(scheduleItems.startTime),
    db.select().from(medicines).orderBy(medicines.sortOrder, medicines.name),
    db.select().from(appSettings),
    // FR-CHILD-03: each child's latest Weight and Height entry, however old (Home only loads recent days).
    db
      .select()
      .from(entries)
      .where(
        and(
          isNull(entries.deletedAt),
          inArray(
            entries.activityTypeId,
            db
              .select({ id: activityTypes.id })
              .from(activityTypes)
              .where(inArray(activityTypes.systemKey, ['weight', 'height'])),
          ),
          sql`${entries.startUtc} = (select max(e2.start_utc) from entries e2 where e2.child_id = ${entries.childId}
              and e2.activity_type_id = ${entries.activityTypeId} and e2.deleted_at is null)`,
        ),
      ),
  ]);
  const me = c.get('user');
  const body: Bootstrap = {
    version: version[0]?.version ?? 0,
    me: { id: me.id, email: me.email, displayName: me.displayName, role: me.role },
    users: userRows,
    children: childRows.map(toChild),
    activityTypes: typeRows.map(toActivityType),
    fields: fieldRows.map(toField),
    childActivitySettings: settingRows.map(toSetting),
    scheduleItems: itemRows.map(toScheduleItem),
    medicines: medicineRows.map(toMedicine),
    appSettings: Object.fromEntries(settingsKv.map((s) => [s.key, s.value])),
    latestMeasurements: latest.map(toEntry),
  };
  return c.json(body);
});
