import { beforeAll, describe, expect, it } from 'vitest';
import type { Bootstrap } from '../../src/shared/api';
import type {
  ActivityField,
  ActivityType,
  Child,
  ChildActivitySetting,
  Medicine,
  User,
} from '../../src/shared/domain';
import { classifyError } from '../../src/worker/errors';
import { fieldKey } from '../../src/worker/routes/activities';
import { api, ensureReader, JAMIE, newId, READER, ALEX, seedIds, version } from './api';

let ids: Awaited<ReturnType<typeof seedIds>>;
beforeAll(async () => {
  await ensureReader();
  ids = await seedIds();
});

describe('GET /api/bootstrap (R)', () => {
  it('returns all configuration in one call, with names only for users', async () => {
    const r = await api<Bootstrap>('GET', '/bootstrap', undefined, READER);
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.me).toMatchObject({ email: 'reader@example.com', role: 'reader' });
    expect(b.version).toBeGreaterThan(0);
    expect(b.children.map((c) => c.firstName)).toContain('Sam');
    expect(b.activityTypes).toHaveLength(16);
    expect(b.fields.find((f) => f.key === 'variety')?.options).toEqual([
      'Berry',
      'Creamed',
      'Banana',
      'Multi',
    ]);
    expect(
      b.fields.find((f) => f.activityTypeId === ids.type.Accident && f.key === 'colour')?.showWhen,
    ).toEqual({
      field: 'kind',
      in: ['Dirty', 'Both'],
    });
    expect(b.childActivitySettings.find((s) => s.activityTypeId === ids.type.Formula)).toMatchObject({
      quickLog: true,
      defaults: { amount: 210 },
    });
    expect(b.medicines.map((m) => m.name)).toEqual(['Medicine A', 'Medicine B']);
    expect(b.users.every((u) => Object.keys(u).sort().join() === 'displayName,id')).toBe(true);
  });

  it('includes the latest weight and height per child, however old (FR-CHILD-03)', async () => {
    const put = (typeName: string, startUtc: string, values: Record<string, number>) =>
      api('PUT', `/entries/${newId()}`, {
        childId: ids.sam,
        activityTypeId: ids.type[typeName],
        startUtc,
        tz: 'Europe/London',
        values,
      });
    await put('Weight', '2026-01-10T09:00:00Z', { weight: 8.4 });
    await put('Weight', '2026-03-10T09:00:00Z', { weight: 9.12 });
    await put('Height', '2026-02-10T09:00:00Z', { height: 72.5 });
    const b = (await api<Bootstrap>('GET', '/bootstrap')).body;
    const mine = b.latestMeasurements.filter((e) => e.childId === ids.sam);
    expect(
      mine.map((e) => e.values).sort((a, z) => Object.keys(a)[0]!.localeCompare(Object.keys(z)[0]!)),
    ).toEqual([{ height: 72.5 }, { weight: 9.12 }]);
  });
});

describe('activity types and fields (FR-ACT-01..05)', () => {
  it('creates a custom type that is immediately enabled for every child', async () => {
    const r = await api<{ activityType: ActivityType }>(
      'POST',
      '/activity-types',
      { name: 'Football', kind: 'duration', icon: 'trophy', colour: 'pink' },
      JAMIE,
    );
    expect(r.status).toBe(201);
    const boot = await api<Bootstrap>('GET', '/bootstrap');
    expect(
      boot.body.childActivitySettings.find(
        (s) => s.activityTypeId === r.body.activityType.id && s.childId === ids.sam,
      ),
    ).toMatchObject({
      enabled: true,
      quickLog: false,
      windowBeforeMin: 120,
    });
  });

  it('rejects icons and colours outside the built-in sets (FR-ACT-03 AC1)', async () => {
    expect(
      (await api('POST', '/activity-types', { name: 'X', kind: 'point', icon: 'rocket', colour: 'blue' }))
        .status,
    ).toBe(400);
    expect(
      (await api('POST', '/activity-types', { name: 'X', kind: 'point', icon: 'moon', colour: '#ff0000' }))
        .status,
    ).toBe(400);
  });

  it('lets system types be renamed and archived but never change kind (FR-ACT-01 AC2)', async () => {
    const id = ids.type['Overnight sleep'];
    expect((await api('PUT', `/activity-types/${id}`, { kind: 'point' })).status).toBe(400);
    const renamed = await api<{ activityType: ActivityType }>('PUT', `/activity-types/${id}`, {
      name: 'Night sleep',
    });
    expect(renamed.body.activityType).toMatchObject({
      name: 'Night sleep',
      kind: 'duration',
      systemKey: 'overnight_sleep',
    });
    await api('PUT', `/activity-types/${id}`, { name: 'Overnight sleep' });
  });

  it('archives and restores a type (FR-ACT-05)', async () => {
    const t = await api<{ activityType: ActivityType }>('POST', '/activity-types', {
      name: 'Music',
      kind: 'point',
      icon: 'music',
      colour: 'violet',
    });
    const archived = await api<{ activityType: ActivityType }>(
      'PUT',
      `/activity-types/${t.body.activityType.id}`,
      { archived: true },
    );
    expect(archived.body.activityType.archivedAt).not.toBeNull();
    const restored = await api<{ activityType: ActivityType }>(
      'PUT',
      `/activity-types/${t.body.activityType.id}`,
      { archived: false },
    );
    expect(restored.body.activityType.archivedAt).toBeNull();
  });

  it('adds fields with stable, unique keys, and validates their shape (FR-ACT-04)', async () => {
    const path = `/activity-types/${ids.type.Formula}/fields`;
    const brand = await api<{ field: ActivityField }>('POST', path, {
      label: 'Brand name',
      fieldType: 'text',
      maxLength: 40,
    });
    expect(brand.status).toBe(201);
    expect(brand.body.field).toMatchObject({ key: 'brand_name', sortOrder: 1 });
    const again = await api<{ field: ActivityField }>('POST', path, {
      label: 'Amount',
      fieldType: 'number',
      unit: 'ml',
    });
    expect(again.body.field.key).toBe('amount_2');
    expect(again.body.field.decimals).toBe(0);
    expect((await api('POST', path, { label: 'Kind', fieldType: 'list' })).status).toBe(400);
    expect((await api('POST', path, { label: 'Pic', fieldType: 'image_picker' })).status).toBe(400);
    expect(
      (
        await api('POST', path, {
          label: 'Colour',
          fieldType: 'boolean',
          showWhen: { field: 'nope', in: ['x'] },
        })
      ).status,
    ).toBe(400);
  });

  it('renames, reorders and archives fields; archived fields keep existing values', async () => {
    const path = `/activity-types/${ids.type.Food}/fields`;
    const f = await api<{ field: ActivityField }>('POST', path, {
      label: 'Portion',
      fieldType: 'list',
      options: ['Small', 'Big'],
    });
    const entryId = newId();
    const base = {
      childId: ids.sam,
      activityTypeId: ids.type.Food,
      startUtc: '2026-10-15T11:00:00Z',
      tz: 'Europe/London',
    };
    await api('PUT', `/entries/${entryId}`, { ...base, values: { portion: 'Big' } });
    const upd = await api<{ field: ActivityField }>('PUT', `${path}/${f.body.field.id}`, {
      label: 'Portion size',
      sortOrder: 5,
      archived: true,
    });
    expect(upd.body.field).toMatchObject({ label: 'Portion size', sortOrder: 5, key: 'portion' });
    expect(upd.body.field.archivedAt).not.toBeNull();
    // Editing the old entry with its archived value still works.
    expect(
      (await api('PUT', `/entries/${entryId}`, { ...base, values: { portion: 'Big' }, note: 'x' })).status,
    ).toBe(200);
  });

  it('is Writer-only', async () => {
    expect(
      (
        await api(
          'POST',
          '/activity-types',
          { name: 'X', kind: 'point', icon: 'moon', colour: 'blue' },
          READER,
        )
      ).status,
    ).toBe(403);
  });
});

describe('child activity settings (FR-ACT-06)', () => {
  const put = (over: Partial<ChildActivitySetting> = {}, as = JAMIE) =>
    api<{ setting: ChildActivitySetting }>(
      'PUT',
      `/children/${ids.sam}/activity-settings/${ids.type.Cereal}`,
      {
        enabled: true,
        quickLog: true,
        defaults: { variety: 'Berry', amount: 12 },
        windowBeforeMin: 60,
        windowAfterMin: 90,
        ...over,
      },
      as,
    );

  it('saves favourites, defaults and windows', async () => {
    const r = await put();
    expect(r.status).toBe(200);
    expect(r.body.setting).toMatchObject({
      quickLog: true,
      defaults: { variety: 'Berry', amount: 12 },
      windowBeforeMin: 60,
    });
  });

  it('validates defaults against the fields', async () => {
    expect((await put({ defaults: { variety: 'Chocolate' } })).status).toBe(400);
    expect((await put({ defaults: { amount: -1 } })).status).toBe(400);
  });

  it('is Writer-only', async () => {
    expect((await put({}, READER)).status).toBe(403);
  });
});

describe('medicines (FR-MED-01)', () => {
  it('creates, updates and archives a medicine', async () => {
    const r = await api<{ medicine: Medicine }>(
      'POST',
      '/medicines',
      { childId: ids.sam, name: 'Piriton', dose: 2.5, minGapMin: 480, maxPer24h: 2 },
      JAMIE,
    );
    expect(r.status).toBe(201);
    expect(r.body.medicine).toMatchObject({ doseUnit: 'ml', countsTowardsAlternating: false });
    const upd = await api<{ medicine: Medicine }>('PUT', `/medicines/${r.body.medicine.id}`, {
      dose: 5,
      archived: true,
    });
    expect(upd.body.medicine.dose).toBe(5);
    expect(upd.body.medicine.archivedAt).not.toBeNull();
  });

  it('keeps the dose given on past entries when the medicine changes (FR-MED-02 AC1)', async () => {
    const entryId = newId();
    await api('PUT', `/entries/${entryId}`, {
      childId: ids.sam,
      activityTypeId: ids.type.Medication,
      startUtc: '2026-10-14T08:00:00Z',
      tz: 'Europe/London',
      medicineId: ids.medicine['Medicine B'],
    });
    await api('PUT', `/medicines/${ids.medicine['Medicine B']}`, { dose: 5 });
    const list = await api<{ entries: { id: string; dose: number }[] }>(
      'GET',
      `/children/${ids.sam}/entries?from=2026-10-14T00:00:00Z&to=2026-10-15T00:00:00Z`,
    );
    expect(list.body.entries.find((e) => e.id === entryId)?.dose).toBe(3);
    await api('PUT', `/medicines/${ids.medicine['Medicine B']}`, { dose: 3 });
  });

  it('rejects nonsense values', async () => {
    expect(
      (
        await api('POST', '/medicines', {
          childId: ids.sam,
          name: 'X',
          dose: 0,
          minGapMin: 60,
          maxPer24h: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(
          'POST',
          '/medicines',
          { childId: ids.sam, name: 'X', dose: 1, minGapMin: 60, maxPer24h: 1 },
          READER,
        )
      ).status,
    ).toBe(403);
  });
});

describe('children and users (Admin, FR-CHILD-01, FR-SET-02)', () => {
  it('lets only Admin manage children; new children get settings for every type', async () => {
    expect((await api('POST', '/children', { firstName: 'Ada' }, JAMIE)).status).toBe(403);
    const r = await api<{ child: Child }>('POST', '/children', { firstName: 'Ada' });
    expect(r.status).toBe(201);
    const boot = await api<Bootstrap>('GET', '/bootstrap');
    expect(boot.body.childActivitySettings.filter((s) => s.childId === r.body.child.id)).toHaveLength(
      boot.body.activityTypes.length,
    );
    const archived = await api<{ child: Child }>('PUT', `/children/${r.body.child.id}`, { archived: true });
    expect(archived.body.child.archivedAt).not.toBeNull();
    const restored = await api<{ child: Child }>('PUT', `/children/${r.body.child.id}`, {
      archived: false,
      firstName: 'Ada Lou',
    });
    expect(restored.body.child).toMatchObject({ archivedAt: null, firstName: 'Ada Lou' });
  });

  it('lets only Admin list and add users; emails are unique and lowercased', async () => {
    expect((await api('GET', '/users', undefined, JAMIE)).status).toBe(403);
    const r = await api<{ user: User }>('POST', '/users', {
      email: 'Granny@Example.com',
      displayName: 'Granny',
      role: 'reader',
    });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: 'granny@example.com', active: true });
    expect(
      (await api('POST', '/users', { email: 'granny@example.com', displayName: 'Again', role: 'reader' }))
        .status,
    ).toBe(409);
    const list = await api<{ users: User[] }>('GET', '/users');
    expect(list.body.users.map((u) => u.email)).toContain('granny@example.com');
  });

  it('stops Admin removing their own Admin role or deactivating themselves (AC1)', async () => {
    const me = ids.user[ALEX]!;
    expect((await api('PUT', `/users/${me}`, { role: 'writer' })).status).toBe(400);
    expect((await api('PUT', `/users/${me}`, { active: false })).status).toBe(400);
    expect((await api('PUT', `/users/${me}`, { displayName: 'Alex S' })).status).toBe(200);
  });

  it('deactivates a user, who then gets the not-allowed response (FR-AUTH-02)', async () => {
    const r = await api<{ user: User }>('POST', '/users', {
      email: 'temp@example.com',
      displayName: 'Temp',
      role: 'writer',
    });
    expect((await api('GET', '/me', undefined, 'temp@example.com')).status).toBe(200);
    await api('PUT', `/users/${r.body.user.id}`, { active: false });
    const me = await api('GET', '/me', undefined, 'temp@example.com');
    expect(me.status).toBe(403);
    expect(me.body.error?.code).toBe('not_allowed');
  });
});

describe('GET /api/export.csv (FR-HIST-04)', () => {
  it('exports non-deleted entries for local dates, with the agreed file name', async () => {
    const keep = newId();
    const gone = newId();
    const base = {
      childId: ids.sam,
      activityTypeId: ids.type.Formula,
      tz: 'Europe/London',
      values: { amount: 199 },
    };
    await api('PUT', `/entries/${keep}`, { ...base, startUtc: '2026-09-10T10:00:00Z' });
    await api('PUT', `/entries/${gone}`, {
      ...base,
      startUtc: '2026-09-10T12:00:00Z',
      values: { amount: 77 },
    });
    await api('DELETE', `/entries/${gone}`);
    const r = await api(
      'GET',
      `/export.csv?from=2026-09-10&to=2026-09-10&child=${ids.sam}`,
      undefined,
      READER,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="track-export-2026-09-10-to-2026-09-10.csv"',
    );
    expect(r.text.startsWith('﻿Child,Date,')).toBe(true);
    expect(r.text).toContain('Sam,10/09/2026,11:00,,,Europe/London,Formula');
    expect(r.text).toContain(',199,');
    expect(r.text).not.toContain(',77,');
  });

  it('supports all children and limits the range', async () => {
    expect((await api('GET', '/export.csv?from=2026-09-01&to=2026-09-30&child=all')).status).toBe(200);
    expect((await api('GET', '/export.csv?from=2026-01-01&to=2026-09-30')).status).toBe(400);
    expect((await api('GET', '/export.csv?from=2026-09-30&to=2026-09-01')).status).toBe(400);
  });
});

describe('sync version (TECH-09)', () => {
  it('bumps once per write and not on reads', async () => {
    const v = await version();
    await api('GET', '/bootstrap');
    await api('GET', '/version');
    expect(await version()).toBe(v);
    await api('POST', '/medicines', {
      childId: ids.sam,
      name: 'Saline',
      dose: 1,
      minGapMin: 60,
      maxPer24h: 6,
    });
    expect((await api<{ version: number }>('GET', '/version')).body.version).toBe(v + 1);
  });
});

describe('error mapping', () => {
  it('maps constraint failures to 409 and other database failures to 503, never a fake success', () => {
    expect(classifyError(new Error('D1_ERROR: UNIQUE constraint failed: users.email'))?.status).toBe(409);
    expect(
      classifyError(new Error('Failed query', { cause: new Error('D1_ERROR: Exceeded maximum DB size') }))
        ?.status,
    ).toBe(503);
    expect(classifyError(new Error('something else'))).toBeNull();
  });

  it('derives field keys', () => {
    expect(fieldKey('Amount (ml)', new Set())).toBe('amount_ml');
    expect(fieldKey('Purée type', new Set())).toBe('puree_type');
    expect(fieldKey('Amount', new Set(['amount', 'amount_2']))).toBe('amount_3');
    expect(fieldKey('!!!', new Set())).toBe('field');
  });
});
