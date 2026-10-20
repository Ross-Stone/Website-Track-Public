import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { OverrideInput, ScheduleItemInput, Ulid } from '../../shared/api';
import { IsoDate } from '../../shared/domain';
import { requireRole } from '../auth/middleware';
import { getDb } from '../db/client';
import { toOverride, toScheduleItem } from '../db/mappers';
import { scheduleItems, scheduleOverrides } from '../db/schema';
import type { AppEnv } from '../env';
import { invalid, notFound, nowIso, parseBody } from '../lib/http';
import { requireChild, requireUsableType } from '../lib/lookups';
import { bumpVersion } from '../lib/version';

export const scheduleRoutes = new Hono<AppEnv>()
  // GET /api/children/:id/overrides?date=YYYY-MM-DD[&date=…] (R): day overrides (Home asks for yesterday and today).
  .get('/children/:id/overrides', requireRole('reader'), async (c) => {
    const dates = c.req.queries('date') ?? [];
    if (dates.length === 0 || dates.length > 7 || !dates.every((d) => IsoDate.safeParse(d).success)) {
      invalid('Give 1 to 7 date=YYYY-MM-DD parameters.');
    }
    const rows = await getDb(c.env.DB)
      .select()
      .from(scheduleOverrides)
      .where(
        and(eq(scheduleOverrides.childId, c.req.param('id')), inArray(scheduleOverrides.localDate, dates)),
      )
      .all();
    return c.json({ overrides: rows.map(toOverride) });
  })

  // PUT /api/schedule-overrides/:id (W): skip or move one planned item on one day (FR-SCHED-03).
  // Unique on (item, date): a second override for the same day replaces the first and keeps its id.
  .put('/schedule-overrides/:id', requireRole('writer'), async (c) => {
    if (!Ulid.safeParse(c.req.param('id')).success)
      invalid('Override id must be a ULID created on the phone.');
    const input = await parseBody(c, OverrideInput);
    const db = getDb(c.env.DB);
    const item = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, input.scheduleItemId))
      .get();
    if (!item || item.childId !== input.childId) notFound('Planned item');
    const now = nowIso();
    const user = c.get('user');
    const change = {
      action: input.action,
      newStartTime: input.action === 'move' ? input.newStartTime : null,
      newEndTime: input.action === 'move' ? input.newEndTime : null,
      createdBy: user.id,
      updatedAt: now,
    };
    const [, , rows] = await db.batch([
      db
        .insert(scheduleOverrides)
        .values({
          id: c.req.param('id'),
          childId: input.childId,
          scheduleItemId: input.scheduleItemId,
          localDate: input.localDate,
          ...change,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [scheduleOverrides.scheduleItemId, scheduleOverrides.localDate],
          set: change,
        }),
      bumpVersion(db),
      db
        .select()
        .from(scheduleOverrides)
        .where(
          and(
            eq(scheduleOverrides.scheduleItemId, input.scheduleItemId),
            eq(scheduleOverrides.localDate, input.localDate),
          ),
        ),
    ]);
    return c.json({ override: toOverride(rows[0]!) });
  })

  // DELETE /api/schedule-overrides/:id (W): undo a skip or move. Repeating it is harmless.
  .delete('/schedule-overrides/:id', requireRole('writer'), async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.select().from(scheduleOverrides).where(eq(scheduleOverrides.id, id)).get();
    if (!existing) return c.json({ deleted: false });
    await db.batch([db.delete(scheduleOverrides).where(eq(scheduleOverrides.id, id)), bumpVersion(db)]);
    return c.json({ deleted: true });
  })

  // GET /api/schedule-items[?child=] (W)
  .get('/schedule-items', requireRole('writer'), async (c) => {
    const child = c.req.query('child');
    const db = getDb(c.env.DB);
    const rows = await (
      child
        ? db.select().from(scheduleItems).where(eq(scheduleItems.childId, child))
        : db.select().from(scheduleItems)
    )
      .orderBy(scheduleItems.startTime)
      .all();
    return c.json({ scheduleItems: rows.map(toScheduleItem) });
  })

  // POST /api/schedule-items (W)
  .post('/schedule-items', requireRole('writer'), async (c) => {
    const input = await parseBody(c, ScheduleItemInput);
    const db = getDb(c.env.DB);
    await requireChild(db, input.childId);
    await requireUsableType(db, input.childId, input.activityTypeId);
    const now = nowIso();
    const row = {
      id: ulid(),
      ...input,
      anchorDate: input.repeat === 'fortnightly' ? (input.anchorDate ?? input.validFrom) : null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.batch([db.insert(scheduleItems).values(row), bumpVersion(db)]);
    return c.json({ scheduleItem: toScheduleItem(row) }, 201);
  })

  // PUT /api/schedule-items/:id (W): replace the item's settings. Only affects planning from now on (FR-SCHED-01 AC3).
  .put('/schedule-items/:id', requireRole('writer'), async (c) => {
    const input = await parseBody(c, ScheduleItemInput);
    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, c.req.param('id')))
      .get();
    if (!existing) notFound('Schedule item');
    if (existing.childId !== input.childId) invalid('A schedule item cannot move to another child.');
    if (existing.activityTypeId !== input.activityTypeId)
      await requireUsableType(db, input.childId, input.activityTypeId);
    const change = {
      ...input,
      anchorDate: input.repeat === 'fortnightly' ? (input.anchorDate ?? input.validFrom) : null,
      updatedAt: nowIso(),
    };
    await db.batch([
      db.update(scheduleItems).set(change).where(eq(scheduleItems.id, existing.id)),
      bumpVersion(db),
    ]);
    return c.json({ scheduleItem: toScheduleItem({ ...existing, ...change }) });
  })

  // DELETE /api/schedule-items/:id (W): archives (keeps links from past auto entries intact).
  .delete('/schedule-items/:id', requireRole('writer'), async (c) => {
    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, c.req.param('id')))
      .get();
    if (!existing) notFound('Schedule item');
    if (existing.archivedAt) return c.json({ scheduleItem: toScheduleItem(existing) });
    const now = nowIso();
    await db.batch([
      db
        .update(scheduleItems)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(scheduleItems.id, existing.id)),
      bumpVersion(db),
    ]);
    return c.json({ scheduleItem: toScheduleItem({ ...existing, archivedAt: now, updatedAt: now }) });
  })

  // POST /api/schedule-items/:id/duplicate (W): copy, e.g. last term's item for a new term (FR-SCHED-02).
  .post('/schedule-items/:id/duplicate', requireRole('writer'), async (c) => {
    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, c.req.param('id')))
      .get();
    if (!existing) notFound('Schedule item');
    const now = nowIso();
    const row = { ...existing, id: ulid(), archivedAt: null, createdAt: now, updatedAt: now };
    await db.batch([db.insert(scheduleItems).values(row), bumpVersion(db)]);
    return c.json({ scheduleItem: toScheduleItem(row) }, 201);
  });
