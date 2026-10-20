import { and, between, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { ExportQuery, MAX_SERVER_EXPORT_DAYS } from '../../shared/api';
import { buildCsv, csvFileName } from '../../shared/csv';
import { daysBetween } from '../../shared/time';
import { requireRole } from '../auth/middleware';
import { getDb } from '../db/client';
import { toActivityType, toChild, toEntry, toField, toMedicine } from '../db/mappers';
import { activityFields, activityTypes, children, entries, medicines, users } from '../db/schema';
import type { AppEnv } from '../env';
import { invalid, parseQuery } from '../lib/http';

// GET /api/export.csv?from=&to=&child= (R): dates are local dates, inclusive (FR-HIST-04).
// Ranges longer than MAX_SERVER_EXPORT_DAYS are built in the app to stay within the Worker CPU limit (agreed Q9).
export const exportRoutes = new Hono<AppEnv>().get('/export.csv', requireRole('reader'), async (c) => {
  const q = parseQuery(c, ExportQuery);
  if (daysBetween(q.from, q.to) + 1 > MAX_SERVER_EXPORT_DAYS) {
    invalid(`The server exports up to ${MAX_SERVER_EXPORT_DAYS} days at a time.`);
  }
  const db = getDb(c.env.DB);
  const range = and(isNull(entries.deletedAt), between(entries.localDate, q.from, q.to));
  const [entryRows, childRows, typeRows, fieldRows, medicineRows, userRows] = await db.batch([
    db
      .select()
      .from(entries)
      .where(q.child === 'all' ? range : and(range, eq(entries.childId, q.child))),
    db.select().from(children),
    db.select().from(activityTypes),
    db.select().from(activityFields),
    db.select().from(medicines),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
  ]);
  const csv = buildCsv({
    entries: entryRows.map(toEntry),
    children: childRows.map(toChild),
    activityTypes: typeRows.map(toActivityType),
    fields: fieldRows.map(toField),
    medicines: medicineRows.map(toMedicine),
    users: userRows,
  });
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${csvFileName(q.from, q.to)}"`,
  });
});
