import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { AutoConfirmInput, EntriesQuery, EntryInput, Ulid } from '../../shared/api';
import type { Entry, FieldValues } from '../../shared/domain';
import { occurrencesOn } from '../../shared/schedule';
import { addDays, localDateOf } from '../../shared/time';
import { compactValues, validateValues } from '../../shared/values';
import { requireRole } from '../auth/middleware';
import { getDb } from '../db/client';
import { toEntry, toField, toOverride, toScheduleItem, toSetting } from '../db/mappers';
import {
  activityFields,
  activityTypes,
  childActivitySettings,
  children,
  entries,
  medicines,
  scheduleItems,
  scheduleOverrides,
} from '../db/schema';
import type { AppEnv } from '../env';
import { ApiException } from '../errors';
import { invalid, notFound, nowIso, parseBody, parseQuery } from '../lib/http';
import { bumpVersion } from '../lib/version';

const MINUTE = 60_000;
const MAX_RANGE_MS = 35 * 86_400_000;

/** Normalises any accepted ISO instant to `toISOString()` form, so string comparison in SQL is correct. */
const norm = (iso: string) => new Date(iso).toISOString();

function entryId(raw: string): string {
  const r = Ulid.safeParse(raw);
  if (!r.success) invalid('Entry id must be a ULID created on the phone.');
  return r.data;
}

export const entryRoutes = new Hono<AppEnv>()
  // GET /api/children/:id/entries?from=&to=&running=1 (R)
  // Non-deleted entries starting in [from, to). With running=1, also running duration entries however old.
  .get('/children/:id/entries', requireRole('reader'), async (c) => {
    const q = parseQuery(c, EntriesQuery);
    const from = norm(q.from);
    const to = norm(q.to);
    if (to <= from) invalid('to must be after from.');
    if (Date.parse(to) - Date.parse(from) > MAX_RANGE_MS) invalid('Ask for at most 35 days at a time.');
    const childId = c.req.param('id');
    const db = getDb(c.env.DB);
    const inRange = and(gte(entries.startUtc, from), lt(entries.startUtc, to));
    // A null end only means "running" for duration types; point entries always have a null end.
    const running = and(
      isNull(entries.endUtc),
      inArray(
        entries.activityTypeId,
        db.select({ id: activityTypes.id }).from(activityTypes).where(eq(activityTypes.kind, 'duration')),
      ),
    );
    const result = await db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.childId, childId),
          isNull(entries.deletedAt),
          q.running === '1' ? or(inRange, running) : inRange,
        ),
      )
      .orderBy(entries.startUtc)
      .all();
    return c.json({ entries: result.map(toEntry) });
  })

  // PUT /api/entries/:id (W): create or update, idempotent (TECH-06).
  .put('/entries/:id', requireRole('writer'), async (c) => {
    const id = entryId(c.req.param('id'));
    const input = await parseBody(c, EntryInput);
    const user = c.get('user');
    const db = getDb(c.env.DB);

    const [existingRows, typeRows, childRows, fieldRows, settingRows, medicineRows, itemRows] =
      await db.batch([
        db.select().from(entries).where(eq(entries.id, id)),
        db.select().from(activityTypes).where(eq(activityTypes.id, input.activityTypeId)),
        db.select().from(children).where(eq(children.id, input.childId)),
        db.select().from(activityFields).where(eq(activityFields.activityTypeId, input.activityTypeId)),
        db
          .select()
          .from(childActivitySettings)
          .where(
            and(
              eq(childActivitySettings.childId, input.childId),
              eq(childActivitySettings.activityTypeId, input.activityTypeId),
            ),
          ),
        db
          .select()
          .from(medicines)
          .where(eq(medicines.id, input.medicineId ?? '')),
        db
          .select()
          .from(scheduleItems)
          .where(eq(scheduleItems.id, input.scheduleItemId ?? '')),
      ]);
    const existing = existingRows[0];
    const type = typeRows[0];
    const child = childRows[0];
    const creating = !existing;

    if (!child) notFound('Child');
    if (!type) notFound('Activity type');
    if (existing && existing.childId !== input.childId) invalid('An entry cannot move to another child.');
    if (existing?.deletedAt) throw new ApiException(409, 'conflict', 'This entry has been deleted.');
    if (creating) {
      if (child.archivedAt) invalid(`${child.firstName} is archived.`);
      if (type.archivedAt) invalid(`${type.name} is archived and can't be logged.`);
      if (settingRows[0] && !settingRows[0].enabled)
        invalid(`${type.name} is turned off for ${child.firstName}.`);
    }

    const startUtc = norm(input.startUtc);
    let endUtc = input.endUtc === null ? null : norm(input.endUtc);
    if (type.kind === 'point') {
      if (endUtc !== null && endUtc !== startUtc)
        invalid(`${type.name} is logged at a single time, without an end.`);
      endUtc = null;
    }

    // Medication: medicine, dose and unit are columns, not fields (agreed Q2). The dose actually given is stored.
    let medicineId: string | null = null;
    let dose: number | null = null;
    let doseUnit: string | null = null;
    if (type.systemKey === 'medication') {
      const med = medicineRows[0];
      if (!input.medicineId || !med || med.childId !== input.childId) invalid('Choose a medicine.');
      if (med.archivedAt && (creating || existing.medicineId !== med.id)) invalid(`${med.name} is archived.`);
      medicineId = med.id;
      dose = input.dose ?? med.dose;
      doseUnit = input.doseUnit ?? med.doseUnit;
    } else if (input.medicineId || input.dose !== null || input.doseUnit) {
      invalid('Only Medication entries have a medicine and dose.');
    }

    const fields = fieldRows.map(toField);
    const problems = validateValues(fields, input.values, { requireRequired: true });
    if (problems.length) invalid(problems.map((p) => p.message).join('; '));
    const values: FieldValues = compactValues(input.values);

    let scheduleItemId: string | null = existing?.autoConfirmed ? existing.scheduleItemId : null;
    if (input.scheduleItemId) {
      const item = itemRows[0];
      if (!item || item.childId !== input.childId || item.activityTypeId !== input.activityTypeId) {
        invalid('That planned item does not match this entry.');
      }
      scheduleItemId = item.id;
    }

    const localDate = localDateOf(startUtc, input.tz);
    const note = input.note?.trim() ? input.note.trim() : null;
    const fields_ = {
      activityTypeId: input.activityTypeId,
      startUtc,
      endUtc,
      tz: input.tz,
      localDate,
      values: JSON.stringify(values),
      medicineId,
      dose,
      doseUnit,
      note,
      scheduleItemId,
    };

    // Idempotent retry or no-op edit: nothing to write, no version bump.
    if (existing && Object.entries(fields_).every(([k, v]) => existing[k as keyof typeof existing] === v)) {
      return c.json({ entry: toEntry(existing) }, 200);
    }

    const now = nowIso();
    const row = {
      id,
      childId: input.childId,
      ...fields_,
      autoConfirmed: existing?.autoConfirmed ?? false,
      createdBy: existing?.createdBy ?? user.id,
      createdAt: existing?.createdAt ?? now,
      updatedBy: user.id,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    };
    await db.batch([
      db
        .insert(entries)
        .values(row)
        .onConflictDoUpdate({ target: entries.id, set: { ...fields_, updatedBy: user.id, updatedAt: now } }),
      bumpVersion(db),
    ]);
    return c.json({ entry: toEntry(row) }, creating ? 201 : 200);
  })

  // DELETE /api/entries/:id (W): soft delete (FR-LOG-06). Repeating it is harmless.
  .delete('/entries/:id', requireRole('writer'), async (c) => {
    const id = entryId(c.req.param('id'));
    const db = getDb(c.env.DB);
    const existing = await db.select().from(entries).where(eq(entries.id, id)).get();
    if (!existing) notFound('Entry');
    if (existing.deletedAt) return c.json({ entry: toEntry(existing) });
    const now = nowIso();
    const user = c.get('user');
    await db.batch([
      db.update(entries).set({ deletedAt: now, deletedBy: user.id }).where(eq(entries.id, id)),
      bumpVersion(db),
    ]);
    return c.json({ entry: toEntry({ ...existing, deletedAt: now, deletedBy: user.id }) });
  })

  // POST /api/entries/:id/restore (W): undo a delete.
  .post('/entries/:id/restore', requireRole('writer'), async (c) => {
    const id = entryId(c.req.param('id'));
    const db = getDb(c.env.DB);
    const existing = await db.select().from(entries).where(eq(entries.id, id)).get();
    if (!existing) notFound('Entry');
    if (!existing.deletedAt) return c.json({ entry: toEntry(existing) });
    await db.batch([
      db.update(entries).set({ deletedAt: null, deletedBy: null }).where(eq(entries.id, id)),
      bumpVersion(db),
    ]);
    return c.json({ entry: toEntry({ ...existing, deletedAt: null, deletedBy: null }) });
  })

  // POST /api/children/:id/auto-confirm (W): create due auto-confirmed entries (FR-LOG-08, TECH-07).
  .post('/children/:id/auto-confirm', requireRole('writer'), async (c) => {
    const input = await parseBody(c, AutoConfirmInput);
    const childId = c.req.param('id');
    const user = c.get('user');
    const db = getDb(c.env.DB);
    // Trust the phone's clock only as far as the server's (plus a little skew).
    const nowMs = Math.min(Date.parse(input.now), Date.now() + 5 * MINUTE);
    // Today and yesterday, so an item isn't lost if the app wasn't opened after it started.
    const dates = [addDays(input.date, -1), input.date];

    const [childRows, itemRows, overrideRows, settingRows, typeRows] = await db.batch([
      db.select().from(children).where(eq(children.id, childId)),
      db
        .select()
        .from(scheduleItems)
        .where(
          and(
            eq(scheduleItems.childId, childId),
            eq(scheduleItems.autoConfirm, true),
            isNull(scheduleItems.archivedAt),
          ),
        ),
      db
        .select()
        .from(scheduleOverrides)
        .where(and(eq(scheduleOverrides.childId, childId), inArray(scheduleOverrides.localDate, dates))),
      db.select().from(childActivitySettings).where(eq(childActivitySettings.childId, childId)),
      db.select({ id: activityTypes.id, archivedAt: activityTypes.archivedAt }).from(activityTypes),
    ]);
    const child = childRows[0];
    if (!child) notFound('Child');
    if (child.archivedAt || itemRows.length === 0) return c.json({ created: [] });

    const settings = new Map(settingRows.map((s) => [s.activityTypeId, toSetting(s)]));
    const archivedTypes = new Set(typeRows.filter((t) => t.archivedAt).map((t) => t.id));
    const items = itemRows
      .map(toScheduleItem)
      .filter(
        (i) => !archivedTypes.has(i.activityTypeId) && settings.get(i.activityTypeId)?.enabled !== false,
      );
    const overrides = overrideRows.map(toOverride);
    const due = dates
      .flatMap((d) => occurrencesOn(items, overrides, d, input.tz))
      .filter((o) => o.autoConfirm && !o.skipped && o.startUtc.getTime() <= nowMs);
    if (due.length === 0) return c.json({ created: [] });

    // Don't duplicate an entry the family logged by hand for the same planned item.
    const earliest = Math.min(...due.map((o) => o.startUtc.getTime())) - 12 * 60 * MINUTE;
    const manual = await db
      .select({ activityTypeId: entries.activityTypeId, startUtc: entries.startUtc })
      .from(entries)
      .where(
        and(
          eq(entries.childId, childId),
          isNull(entries.deletedAt),
          gte(entries.startUtc, new Date(earliest).toISOString()),
          inArray(entries.activityTypeId, [...new Set(due.map((o) => o.activityTypeId))]),
        ),
      )
      .all();
    const now = new Date().toISOString();
    const rows = due
      .filter((o) => {
        const s = settings.get(o.activityTypeId);
        const lo = o.startUtc.getTime() - (s?.windowBeforeMin ?? 120) * MINUTE;
        const hi = o.startUtc.getTime() + (s?.windowAfterMin ?? 120) * MINUTE;
        return !manual.some(
          (m) =>
            m.activityTypeId === o.activityTypeId &&
            Date.parse(m.startUtc) >= lo &&
            Date.parse(m.startUtc) <= hi,
        );
      })
      .map((o) => ({
        id: ulid(),
        childId,
        activityTypeId: o.activityTypeId,
        startUtc: o.startUtc.toISOString(),
        endUtc: o.endUtc?.toISOString() ?? null,
        tz: input.tz,
        localDate: o.date,
        values: JSON.stringify(settings.get(o.activityTypeId)?.defaults ?? {}),
        medicineId: null,
        dose: null,
        doseUnit: null,
        note: null,
        scheduleItemId: o.scheduleItemId,
        autoConfirmed: true,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedBy: null,
      }));
    if (rows.length === 0) return c.json({ created: [] });

    const ids = rows.map((r) => r.id);
    // ON CONFLICT DO NOTHING against the partial unique index: never created twice, even if both phones
    // sync at once, and never re-created after the family deletes one. The version bumps only if a row landed.
    const [first, ...rest] = rows as [(typeof rows)[number], ...typeof rows];
    const results = await db.batch([
      db.insert(entries).values(first).onConflictDoNothing(),
      ...rest.map((r) => db.insert(entries).values(r).onConflictDoNothing()),
      bumpVersion(db, sql`exists (select 1 from ${entries} where ${inArray(entries.id, ids)})`),
      db.select().from(entries).where(inArray(entries.id, ids)),
    ]);
    const created = results[results.length - 1] as (typeof entries.$inferSelect)[];
    return c.json({ created: created.map(toEntry) satisfies Entry[] });
  });
