import { and, eq, max } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import {
  ActivityTypeCreate,
  ActivityTypeUpdate,
  ChildActivitySettingInput,
  FieldCreate,
  FieldUpdate,
  MedicineCreate,
  MedicineUpdate,
} from '../../shared/api';
import { compactValues, validateValues } from '../../shared/values';
import { requireRole } from '../auth/middleware';
import { getDb } from '../db/client';
import { toActivityType, toField, toMedicine, toSetting } from '../db/mappers';
import { activityFields, activityTypes, childActivitySettings, children, medicines } from '../db/schema';
import type { AppEnv } from '../env';
import { invalid, notFound, nowIso, parseBody } from '../lib/http';
import { requireChild } from '../lib/lookups';
import { bumpVersion } from '../lib/version';
import { DEFAULT_WINDOW_MIN } from '../../shared/constants';

/** Stable field key from a label: "Amount (ml)" → "amount_ml", unique within the type. */
export function fieldKey(label: string, taken: Set<string>): string {
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'field';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

type FieldShape = {
  fieldType: string;
  options: string[] | null;
  pickerSet: string | null;
  min: number | null;
  max: number | null;
  showWhen: { field: string; in: string[] } | null;
};

function checkFieldShape(
  f: FieldShape,
  siblings: { key: string; fieldType: string; options: string | null }[],
  ownKey?: string,
) {
  if (f.fieldType === 'list' && (!f.options || f.options.length === 0))
    invalid('A list field needs at least one option.');
  if (f.fieldType === 'image_picker' && !f.pickerSet) invalid('Choose which picker to show.');
  if (f.min !== null && f.max !== null && f.min > f.max) invalid('Minimum must not be more than maximum.');
  if (f.showWhen) {
    const target = siblings.find((s) => s.key === f.showWhen!.field && s.key !== ownKey);
    if (!target || target.fieldType !== 'list')
      invalid('"Show when" must refer to a list field of this activity.');
  }
}

export const activityRoutes = new Hono<AppEnv>()
  // POST /api/activity-types (W): custom type, enabled for every child straight away (FR-ACT-02 AC1).
  .post('/activity-types', requireRole('writer'), async (c) => {
    const input = await parseBody(c, ActivityTypeCreate);
    const db = getDb(c.env.DB);
    const [[top], kids] = await db.batch([
      db.select({ n: max(activityTypes.sortOrder) }).from(activityTypes),
      db.select({ id: children.id }).from(children),
    ]);
    const now = nowIso();
    const row = {
      id: ulid(),
      systemKey: null,
      ...input,
      sortOrder: (top?.n ?? -1) + 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const settings = kids.map((k) => ({
      childId: k.id,
      activityTypeId: row.id,
      enabled: true,
      quickLog: false,
      defaults: '{}',
      windowBeforeMin: DEFAULT_WINDOW_MIN,
      windowAfterMin: DEFAULT_WINDOW_MIN,
      createdAt: now,
      updatedAt: now,
    }));
    await db.batch([
      db.insert(activityTypes).values(row),
      ...settings.map((s) => db.insert(childActivitySettings).values(s)),
      bumpVersion(db),
    ]);
    return c.json({ activityType: toActivityType(row) }, 201);
  })

  // PUT /api/activity-types/:id (W): rename, icon, colour, order, archive/restore (FR-ACT-05).
  // System types can be renamed and archived, never have their kind changed (FR-ACT-01 AC2).
  .put('/activity-types/:id', requireRole('writer'), async (c) => {
    const input = await parseBody(c, ActivityTypeUpdate);
    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(activityTypes)
      .where(eq(activityTypes.id, c.req.param('id')))
      .get();
    if (!existing) notFound('Activity type');
    if (existing.systemKey && input.kind && input.kind !== existing.kind) {
      invalid(`${existing.name} is a built-in activity; its kind can't be changed.`);
    }
    const now = nowIso();
    const { archived, ...rest } = input;
    const change = {
      ...rest,
      ...(archived === undefined ? {} : { archivedAt: archived ? (existing.archivedAt ?? now) : null }),
      updatedAt: now,
    };
    await db.batch([
      db.update(activityTypes).set(change).where(eq(activityTypes.id, existing.id)),
      bumpVersion(db),
    ]);
    return c.json({ activityType: toActivityType({ ...existing, ...change }) });
  })

  // POST /api/activity-types/:id/fields (W)
  .post('/activity-types/:id/fields', requireRole('writer'), async (c) => {
    const input = await parseBody(c, FieldCreate);
    const db = getDb(c.env.DB);
    const typeId = c.req.param('id');
    const [types, siblings] = await db.batch([
      db.select().from(activityTypes).where(eq(activityTypes.id, typeId)),
      db.select().from(activityFields).where(eq(activityFields.activityTypeId, typeId)),
    ]);
    if (!types[0]) notFound('Activity type');
    checkFieldShape(input, siblings);
    const now = nowIso();
    const row = {
      id: ulid(),
      activityTypeId: typeId,
      key: fieldKey(input.label, new Set(siblings.map((s) => s.key))),
      ...input,
      decimals: input.fieldType === 'number' ? (input.decimals ?? 0) : null,
      options: input.fieldType === 'list' ? JSON.stringify(input.options) : null,
      pickerSet: input.fieldType === 'image_picker' ? input.pickerSet : null,
      showWhen: input.showWhen ? JSON.stringify(input.showWhen) : null,
      sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.batch([db.insert(activityFields).values(row), bumpVersion(db)]);
    return c.json({ field: toField(row) }, 201);
  })

  // PUT /api/activity-types/:id/fields/:fieldId (W): rename, reorder, archive (FR-ACT-04 AC1). Key and type are fixed.
  .put('/activity-types/:id/fields/:fieldId', requireRole('writer'), async (c) => {
    const input = await parseBody(c, FieldUpdate);
    const db = getDb(c.env.DB);
    const typeId = c.req.param('id');
    const siblings = await db
      .select()
      .from(activityFields)
      .where(eq(activityFields.activityTypeId, typeId))
      .all();
    const existing = siblings.find((f) => f.id === c.req.param('fieldId'));
    if (!existing) notFound('Field');
    const current = toField(existing);
    const merged = { ...current, ...input };
    checkFieldShape(merged, siblings, existing.key);
    const now = nowIso();
    const { archived, options, showWhen, ...rest } = input;
    const change = {
      ...rest,
      ...(options === undefined ? {} : { options: options === null ? null : JSON.stringify(options) }),
      ...(showWhen === undefined ? {} : { showWhen: showWhen === null ? null : JSON.stringify(showWhen) }),
      ...(archived === undefined ? {} : { archivedAt: archived ? (existing.archivedAt ?? now) : null }),
      updatedAt: now,
    };
    await db.batch([
      db.update(activityFields).set(change).where(eq(activityFields.id, existing.id)),
      bumpVersion(db),
    ]);
    return c.json({ field: toField({ ...existing, ...change }) });
  })

  // PUT /api/children/:id/activity-settings/:typeId (W): enabled, favourite, defaults, detection window (FR-ACT-06).
  .put('/children/:id/activity-settings/:typeId', requireRole('writer'), async (c) => {
    const input = await parseBody(c, ChildActivitySettingInput);
    const db = getDb(c.env.DB);
    const childId = c.req.param('id');
    const typeId = c.req.param('typeId');
    const [kids, types, fieldRows] = await db.batch([
      db.select({ id: children.id }).from(children).where(eq(children.id, childId)),
      db.select({ id: activityTypes.id }).from(activityTypes).where(eq(activityTypes.id, typeId)),
      db.select().from(activityFields).where(eq(activityFields.activityTypeId, typeId)),
    ]);
    if (!kids[0]) notFound('Child');
    if (!types[0]) notFound('Activity type');
    const problems = validateValues(fieldRows.map(toField), input.defaults, { requireRequired: false });
    if (problems.length) invalid(problems.map((p) => p.message).join('; '));
    const now = nowIso();
    const change = { ...input, defaults: JSON.stringify(compactValues(input.defaults)), updatedAt: now };
    const row = { childId, activityTypeId: typeId, ...change, createdAt: now };
    await db.batch([
      db
        .insert(childActivitySettings)
        .values(row)
        .onConflictDoUpdate({
          target: [childActivitySettings.childId, childActivitySettings.activityTypeId],
          set: change,
        }),
      bumpVersion(db),
    ]);
    return c.json({ setting: toSetting(row) });
  })

  // POST /api/medicines (W). Values come from the family; the app gives no advice (FR-MED-05).
  .post('/medicines', requireRole('writer'), async (c) => {
    const input = await parseBody(c, MedicineCreate);
    const db = getDb(c.env.DB);
    await requireChild(db, input.childId);
    const now = nowIso();
    const row = { id: ulid(), ...input, archivedAt: null, createdAt: now, updatedAt: now };
    await db.batch([db.insert(medicines).values(row), bumpVersion(db)]);
    return c.json({ medicine: toMedicine(row) }, 201);
  })

  // PUT /api/medicines/:id (W). Past entries keep the dose actually given (FR-MED-02 AC1).
  .put('/medicines/:id', requireRole('writer'), async (c) => {
    const input = await parseBody(c, MedicineUpdate);
    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(medicines)
      .where(eq(medicines.id, c.req.param('id')))
      .get();
    if (!existing) notFound('Medicine');
    const now = nowIso();
    const { archived, ...rest } = input;
    const change = {
      ...rest,
      ...(archived === undefined ? {} : { archivedAt: archived ? (existing.archivedAt ?? now) : null }),
      updatedAt: now,
    };
    await db.batch([
      db
        .update(medicines)
        .set(change)
        .where(and(eq(medicines.id, existing.id))),
      bumpVersion(db),
    ]);
    return c.json({ medicine: toMedicine({ ...existing, ...change }) });
  });
