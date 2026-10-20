import { beforeAll, describe, expect, it } from 'vitest';
import type { Entry } from '../../src/shared/domain';
import { api, ensureReader, JAMIE, newId, READER, seedIds, version } from './api';

let ids: Awaited<ReturnType<typeof seedIds>>;
beforeAll(async () => {
  await ensureReader();
  ids = await seedIds();
});

const formula = (over: Record<string, unknown> = {}) => ({
  childId: ids.sam,
  activityTypeId: ids.type.Formula,
  startUtc: '2026-10-18T10:34:00Z',
  tz: 'Europe/London',
  values: { amount: 230 },
  ...over,
});

type EntryRes = { entry: Entry };

describe('PUT /api/entries/:id (TECH-06)', () => {
  it('creates an entry, derives the local date and records who logged it', async () => {
    const id = newId();
    const before = await version();
    const r = await api<EntryRes>('PUT', `/entries/${id}`, formula({ note: '  first bottle  ' }));
    expect(r.status).toBe(201);
    expect(r.body.entry).toMatchObject({
      id,
      startUtc: '2026-10-18T10:34:00.000Z',
      localDate: '2026-10-18',
      values: { amount: 230 },
      note: 'first bottle',
      createdBy: ids.user['alex@example.com'],
      autoConfirmed: false,
    });
    expect(await version()).toBe(before + 1);
  });

  it('is idempotent: repeating the same request creates nothing and does not bump the version', async () => {
    const id = newId();
    await api('PUT', `/entries/${id}`, formula());
    const v = await version();
    const again = await api<EntryRes>('PUT', `/entries/${id}`, formula());
    expect(again.status).toBe(200);
    expect(await version()).toBe(v);
    const list = await api<{ entries: Entry[] }>(
      'GET',
      `/children/${ids.sam}/entries?from=2026-10-18T00:00:00Z&to=2026-10-19T00:00:00Z`,
    );
    expect(list.body.entries.filter((e) => e.id === id)).toHaveLength(1);
  });

  it('updates an entry and records who last edited it (FR-LOG-05, FR-LOG-07)', async () => {
    const id = newId();
    await api('PUT', `/entries/${id}`, formula());
    const r = await api<EntryRes>('PUT', `/entries/${id}`, formula({ values: { amount: 210 } }), JAMIE);
    expect(r.status).toBe(200);
    expect(r.body.entry.values).toEqual({ amount: 210 });
    expect(r.body.entry.createdBy).toBe(ids.user['alex@example.com']);
    expect(r.body.entry.updatedBy).toBe(ids.user['jamie@example.com']);
  });

  it('uses the entry time zone for the local date (an evening in abroad)', async () => {
    const r = await api<EntryRes>(
      'PUT',
      `/entries/${newId()}`,
      formula({ startUtc: '2026-10-18T22:30:00Z', tz: 'Europe/Madrid' }),
    );
    expect(r.body.entry.localDate).toBe('2026-10-19');
  });

  it('rejects writes from a Read only user and changes nothing (FR-AUTH-03 AC1)', async () => {
    const v = await version();
    const r = await api('PUT', `/entries/${newId()}`, formula(), READER);
    expect(r.status).toBe(403);
    expect(await version()).toBe(v);
  });

  it.each([
    ['a non-ULID id', 'not-a-ulid', {}],
    ['an unknown time zone', 'ok', { tz: 'Mars/Olympus' }],
    ['an end before the start', 'ok', { endUtc: '2026-10-18T09:00:00Z' }],
    ['an end on a point activity', 'ok', { endUtc: '2026-10-18T11:00:00Z' }],
    ['an unknown field', 'ok', { values: { amount: 230, colour: 'Red' } }],
    ['a decimal where whole numbers are expected', 'ok', { values: { amount: 230.5 } }],
    ['a medicine on a non-medication entry', 'ok', { dose: 5 }],
  ])('rejects %s with 400', async (_name, idKind, over) => {
    const r = await api('PUT', `/entries/${idKind === 'ok' ? newId() : idKind}`, formula(over));
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('validation');
  });

  it('checks list options and required fields', async () => {
    const cereal = await api(
      'PUT',
      `/entries/${newId()}`,
      formula({ activityTypeId: ids.type.Cereal, values: { variety: 'Chocolate' } }),
    );
    expect(cereal.status).toBe(400);
    const weight = await api(
      'PUT',
      `/entries/${newId()}`,
      formula({ activityTypeId: ids.type.Weight, values: {} }),
    );
    expect(weight.status).toBe(400);
    expect(weight.body.error?.message).toContain('Weight is required');
    const ok = await api(
      'PUT',
      `/entries/${newId()}`,
      formula({ activityTypeId: ids.type.Weight, values: { weight: 9.12 } }),
    );
    expect(ok.status).toBe(201);
  });

  it('cannot move an entry to another child', async () => {
    const id = newId();
    await api('PUT', `/entries/${id}`, formula());
    const kid = await api<{ child: { id: string } }>('POST', '/children', { firstName: 'Testchild' });
    const r = await api('PUT', `/entries/${id}`, formula({ childId: kid.body.child.id }));
    expect(r.status).toBe(400);
  });
});

describe('medication entries (FR-MED-02)', () => {
  const med = (over: Record<string, unknown> = {}) =>
    formula({
      activityTypeId: ids.type.Medication,
      values: {},
      medicineId: ids.medicine['Medicine A'],
      ...over,
    });

  it('fills the dose and unit from the medicine', async () => {
    const r = await api<EntryRes>('PUT', `/entries/${newId()}`, med());
    expect(r.status).toBe(201);
    expect(r.body.entry).toMatchObject({ medicineId: ids.medicine['Medicine A'], dose: 4, doseUnit: 'ml' });
  });

  it('stores the dose actually given when it is changed', async () => {
    const r = await api<EntryRes>('PUT', `/entries/${newId()}`, med({ dose: 2.5 }));
    expect(r.body.entry.dose).toBe(2.5);
  });

  it('requires a medicine', async () => {
    expect((await api('PUT', `/entries/${newId()}`, med({ medicineId: null }))).status).toBe(400);
  });
});

describe('duration entries and running timers (FR-LOG-04)', () => {
  it('returns running entries with running=1 even when they started before the range', async () => {
    const id = newId();
    await api(
      'PUT',
      `/entries/${id}`,
      formula({ activityTypeId: ids.type['Overnight sleep'], values: {}, startUtc: '2026-10-10T19:34:00Z' }),
    );
    const pointWithoutEnd = newId();
    await api('PUT', `/entries/${pointWithoutEnd}`, formula({ startUtc: '2026-10-10T08:00:00Z' }));
    const q = `/children/${ids.sam}/entries?from=2026-10-17T00:00:00Z&to=2026-10-19T00:00:00Z`;
    const without = await api<{ entries: Entry[] }>('GET', q);
    expect(without.body.entries.some((e) => e.id === id)).toBe(false);
    const withRunning = await api<{ entries: Entry[] }>('GET', `${q}&running=1`);
    expect(withRunning.body.entries.some((e) => e.id === id)).toBe(true);
    expect(withRunning.body.entries.some((e) => e.id === pointWithoutEnd)).toBe(false);
  });

  it('ends a running entry by updating its end', async () => {
    const id = newId();
    const nap = formula({ activityTypeId: ids.type.Nap, values: {}, startUtc: '2026-10-18T08:34:00Z' });
    await api('PUT', `/entries/${id}`, nap);
    const r = await api<EntryRes>('PUT', `/entries/${id}`, { ...nap, endUtc: '2026-10-18T09:52:00Z' });
    expect(r.body.entry.endUtc).toBe('2026-10-18T09:52:00.000Z');
  });

  it('limits range queries', async () => {
    const r = await api(
      'GET',
      `/children/${ids.sam}/entries?from=2026-01-01T00:00:00Z&to=2026-10-01T00:00:00Z`,
    );
    expect(r.status).toBe(400);
  });
});

describe('logging rules for archived and disabled types (FR-ACT-05, FR-ACT-06)', () => {
  it('blocks new entries of an archived type but still allows editing old ones', async () => {
    const t = await api<{ activityType: { id: string } }>('POST', '/activity-types', {
      name: 'Swim',
      kind: 'point',
      icon: 'waves',
      colour: 'teal',
    });
    const typeId = t.body.activityType.id;
    const id = newId();
    expect((await api('PUT', `/entries/${id}`, formula({ activityTypeId: typeId, values: {} }))).status).toBe(
      201,
    );
    await api('PUT', `/activity-types/${typeId}`, { archived: true });
    expect(
      (await api('PUT', `/entries/${newId()}`, formula({ activityTypeId: typeId, values: {} }))).status,
    ).toBe(400);
    expect(
      (await api('PUT', `/entries/${id}`, formula({ activityTypeId: typeId, values: {}, note: 'edited' })))
        .status,
    ).toBe(200);
  });

  it('blocks new entries of a type turned off for the child', async () => {
    await api('PUT', `/children/${ids.sam}/activity-settings/${ids.type.School}`, {
      enabled: false,
      quickLog: false,
      defaults: {},
      windowBeforeMin: 120,
      windowAfterMin: 120,
    });
    const r = await api(
      'PUT',
      `/entries/${newId()}`,
      formula({ activityTypeId: ids.type.School, values: {}, endUtc: null }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error?.message).toContain('turned off');
  });
});

describe('delete and restore (FR-LOG-06)', () => {
  it('soft-deletes, hides from lists, restores, and treats repeats as harmless', async () => {
    const id = newId();
    await api('PUT', `/entries/${id}`, formula({ startUtc: '2026-10-16T10:00:00Z' }));
    const list = () =>
      api<{ entries: Entry[] }>(
        'GET',
        `/children/${ids.sam}/entries?from=2026-10-16T00:00:00Z&to=2026-10-17T00:00:00Z`,
      ).then((r) => r.body.entries.map((e) => e.id));

    const v = await version();
    const del = await api<EntryRes>('DELETE', `/entries/${id}`);
    expect(del.body.entry.deletedAt).not.toBeNull();
    expect(await version()).toBe(v + 1);
    expect(await list()).not.toContain(id);

    expect((await api('DELETE', `/entries/${id}`)).status).toBe(200);
    expect(await version()).toBe(v + 1);
    expect((await api('PUT', `/entries/${id}`, formula())).status).toBe(409);

    const restored = await api<EntryRes>('POST', `/entries/${id}/restore`);
    expect(restored.body.entry.deletedAt).toBeNull();
    expect(await list()).toContain(id);
  });

  it('404s for an unknown entry and blocks Read only users', async () => {
    expect((await api('DELETE', `/entries/${newId()}`)).status).toBe(404);
    expect((await api('DELETE', `/entries/${newId()}`, undefined, READER)).status).toBe(403);
  });
});
