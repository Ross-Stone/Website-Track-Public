import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Entry, ScheduleItem, ScheduleOverride } from '../../src/shared/domain';
import { api, ensureReader, JAMIE, newId, READER, seedIds, version } from './api';

let ids: Awaited<ReturnType<typeof seedIds>>;
beforeAll(async () => {
  await ensureReader();
  ids = await seedIds();
});

const MON_FRI = 0b0011111;
const nurseryItem = (over: Record<string, unknown> = {}) => ({
  childId: ids.sam,
  activityTypeId: ids.type.Nursery,
  startTime: '08:00',
  endTime: '18:00',
  daysMask: MON_FRI,
  autoConfirm: true,
  ...over,
});
const createItem = async (over: Record<string, unknown> = {}) =>
  (await api<{ scheduleItem: ScheduleItem }>('POST', '/schedule-items', nurseryItem(over))).body.scheduleItem;
const autoConfirm = (date: string, now: string, as?: string) =>
  api<{ created: Entry[] }>(
    'POST',
    `/children/${ids.sam}/auto-confirm`,
    { date, tz: 'Europe/London', now },
    as,
  );
const autoCount = async (itemId: string) =>
  (await env.DB.prepare('SELECT count(*) AS n FROM entries WHERE schedule_item_id = ? AND auto_confirmed = 1')
    .bind(itemId)
    .first<{ n: number }>())!.n;

describe('auto-confirm (FR-LOG-08, TECH-07)', () => {
  // Week of Monday 5 Oct 2026 (BST, UTC+1; before today, so the server clock allows it). Nursery 08:00–18:00 Mon–Fri.
  it('does nothing before the planned start, then creates the entry with the planned times', async () => {
    const item = await createItem({ label: 'Nursery A' });
    expect((await autoConfirm('2026-10-05', '2026-10-05T06:59:00Z')).body.created).toEqual([]);
    const v = await version();
    const r = await autoConfirm('2026-10-05', '2026-10-05T07:05:00Z');
    expect(r.status).toBe(200);
    const mine = r.body.created.filter((e) => e.scheduleItemId === item.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      startUtc: '2026-10-05T07:00:00.000Z',
      endUtc: '2026-10-05T17:00:00.000Z',
      localDate: '2026-10-05',
      autoConfirmed: true,
      tz: 'Europe/London',
    });
    expect(await version()).toBe(v + 1);
    await api('DELETE', `/schedule-items/${item.id}`);
  });

  it('never creates it twice, even when both phones sync at the same moment', async () => {
    const item = await createItem({ label: 'Nursery B', daysMask: 0b0000110 }); // Tue, Wed
    const results = await Promise.all([
      autoConfirm('2026-10-07', '2026-10-07T08:00:00Z'),
      autoConfirm('2026-10-07', '2026-10-07T08:00:00Z', JAMIE),
      autoConfirm('2026-10-07', '2026-10-07T08:00:01Z'),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await autoCount(item.id)).toBe(2); // Tuesday 6th (yesterday) and Wednesday 7th, once each, once each
    const v = await version();
    await autoConfirm('2026-10-07', '2026-10-07T09:00:00Z');
    expect(await version()).toBe(v); // nothing new, no bump
    await api('DELETE', `/schedule-items/${item.id}`);
  });

  it('is not created when the item is skipped that day, and uses moved times', async () => {
    const item = await createItem({ label: 'Nursery C' });
    await api('PUT', `/schedule-overrides/${newId()}`, {
      childId: ids.sam,
      scheduleItemId: item.id,
      localDate: '2026-10-07',
      action: 'skip',
    });
    await api('PUT', `/schedule-overrides/${newId()}`, {
      childId: ids.sam,
      scheduleItemId: item.id,
      localDate: '2026-10-08',
      action: 'move',
      newStartTime: '09:30',
      newEndTime: '15:00',
    });
    expect(
      (await autoConfirm('2026-10-07', '2026-10-07T11:00:00Z')).body.created.filter(
        (e) => e.scheduleItemId === item.id && e.localDate === '2026-10-07',
      ),
    ).toEqual([]);
    const early = (await autoConfirm('2026-10-08', '2026-10-08T08:00:00Z')).body.created;
    expect(early.filter((e) => e.scheduleItemId === item.id && e.localDate === '2026-10-08')).toEqual([]); // moved to 09:30
    const r = await autoConfirm('2026-10-08', '2026-10-08T08:31:00Z');
    expect(
      r.body.created.find((e) => e.scheduleItemId === item.id && e.localDate === '2026-10-08'),
    ).toMatchObject({
      startUtc: '2026-10-08T08:30:00.000Z',
      endUtc: '2026-10-08T14:00:00.000Z',
    });
    await api('DELETE', `/schedule-items/${item.id}`);
  });

  it('is not re-created after the family deletes it, and can be edited like any entry (AC5)', async () => {
    const item = await createItem({ label: 'Nursery D', daysMask: 1 << 4 }); // Fridays
    const [made] = (await autoConfirm('2026-10-09', '2026-10-09T07:30:00Z')).body.created.filter(
      (e) => e.scheduleItemId === item.id,
    );
    const edit = await api<{ entry: Entry }>('PUT', `/entries/${made!.id}`, {
      childId: ids.sam,
      activityTypeId: ids.type.Nursery,
      startUtc: made!.startUtc,
      endUtc: '2026-10-09T15:00:00Z',
      tz: 'Europe/London',
      note: 'Picked up early',
    });
    expect(edit.body.entry).toMatchObject({
      autoConfirmed: true,
      scheduleItemId: item.id,
      note: 'Picked up early',
    });
    await api('DELETE', `/entries/${made!.id}`);
    expect(
      (await autoConfirm('2026-10-09', '2026-10-09T16:00:00Z')).body.created.filter(
        (e) => e.scheduleItemId === item.id,
      ),
    ).toEqual([]);
    await api('DELETE', `/schedule-items/${item.id}`);
  });

  it('does not duplicate an entry logged by hand for the same planned item', async () => {
    const item = await createItem({ label: 'Nursery E', daysMask: 1 << 0 }); // Mondays
    await api('PUT', `/entries/${newId()}`, {
      childId: ids.sam,
      activityTypeId: ids.type.Nursery,
      startUtc: '2026-10-12T07:10:00Z',
      endUtc: null,
      tz: 'Europe/London',
    });
    const r = await autoConfirm('2026-10-12', '2026-10-12T08:00:00Z');
    expect(r.body.created.filter((e) => e.scheduleItemId === item.id)).toEqual([]);
    await api('DELETE', `/schedule-items/${item.id}`);
  });

  it('ignores a phone clock that runs ahead of the server', async () => {
    const item = await createItem({ label: 'Far future', daysMask: 0b1111111, startTime: '08:00' });
    const r = await autoConfirm('2099-01-01', '2099-01-01T12:00:00Z');
    expect(r.body.created.filter((e) => e.scheduleItemId === item.id)).toEqual([]);
    await api('DELETE', `/schedule-items/${item.id}`);
  });

  it('is Writer-only', async () => {
    expect((await autoConfirm('2026-10-05', '2026-10-05T08:00:00Z', READER)).status).toBe(403);
  });
});

describe('day overrides (FR-SCHED-03)', () => {
  it('skips, then moves the same item that day (replacing the skip), then undoes', async () => {
    const [nap] = (
      await api<{ scheduleItems: ScheduleItem[] }>('GET', `/schedule-items?child=${ids.sam}`)
    ).body.scheduleItems.filter((i) => i.activityTypeId === ids.type.Nap);
    const firstId = newId();
    const skip = await api<{ override: ScheduleOverride }>('PUT', `/schedule-overrides/${firstId}`, {
      childId: ids.sam,
      scheduleItemId: nap!.id,
      localDate: '2026-10-19',
      action: 'skip',
    });
    expect(skip.body.override).toMatchObject({ id: firstId, action: 'skip', newStartTime: null });

    const move = await api<{ override: ScheduleOverride }>(
      'PUT',
      `/schedule-overrides/${newId()}`,
      {
        childId: ids.sam,
        scheduleItemId: nap!.id,
        localDate: '2026-10-19',
        action: 'move',
        newStartTime: '13:45',
        newEndTime: '15:00',
      },
      JAMIE,
    );
    expect(move.body.override).toMatchObject({
      id: firstId,
      action: 'move',
      newStartTime: '13:45',
      createdBy: ids.user['jamie@example.com'],
    });

    const list = await api<{ overrides: ScheduleOverride[] }>(
      'GET',
      `/children/${ids.sam}/overrides?date=2026-10-18&date=2026-10-19`,
    );
    expect(list.body.overrides.map((o) => o.id)).toEqual([firstId]);

    expect((await api('DELETE', `/schedule-overrides/${firstId}`)).body).toEqual({ deleted: true });
    expect((await api('DELETE', `/schedule-overrides/${firstId}`)).body).toEqual({ deleted: false });
  });

  it('validates moves and dates', async () => {
    const [item] = (await api<{ scheduleItems: ScheduleItem[] }>('GET', `/schedule-items?child=${ids.sam}`))
      .body.scheduleItems;
    expect(
      (
        await api('PUT', `/schedule-overrides/${newId()}`, {
          childId: ids.sam,
          scheduleItemId: item!.id,
          localDate: '2026-10-19',
          action: 'move',
        })
      ).status,
    ).toBe(400);
    expect((await api('GET', `/children/${ids.sam}/overrides`)).status).toBe(400);
    expect(
      (
        await api(
          'PUT',
          `/schedule-overrides/${newId()}`,
          { childId: ids.sam, scheduleItemId: item!.id, localDate: '2026-10-19', action: 'skip' },
          READER,
        )
      ).status,
    ).toBe(403);
  });
});

describe('schedule items (FR-SCHED-01, FR-SCHED-02)', () => {
  it('needs a starting week for every-2-weeks items, taking it from the start date if given', async () => {
    expect(
      (await api('POST', '/schedule-items', nurseryItem({ repeat: 'fortnightly', autoConfirm: false })))
        .status,
    ).toBe(400);
    const item = await createItem({ repeat: 'fortnightly', validFrom: '2026-09-01', autoConfirm: false });
    expect(item.anchorDate).toBe('2026-09-01');
    await api('DELETE', `/schedule-items/${item.id}`);
  });

  it('rejects an end date before the start date', async () => {
    expect(
      (
        await api(
          'POST',
          '/schedule-items',
          nurseryItem({ validFrom: '2026-12-19', validUntil: '2026-09-01' }),
        )
      ).status,
    ).toBe(400);
  });

  it('duplicates an item for a new term, then edits the copy (FR-SCHED-02 AC1)', async () => {
    const autumn = await createItem({
      label: 'Autumn term',
      validFrom: '2026-09-01',
      validUntil: '2026-12-19',
      autoConfirm: false,
    });
    const dup = await api<{ scheduleItem: ScheduleItem }>('POST', `/schedule-items/${autumn.id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.scheduleItem.id).not.toBe(autumn.id);
    const spring = await api<{ scheduleItem: ScheduleItem }>(
      'PUT',
      `/schedule-items/${dup.body.scheduleItem.id}`,
      nurseryItem({
        label: 'Spring term',
        validFrom: '2027-01-05',
        validUntil: '2027-03-27',
        autoConfirm: false,
      }),
    );
    expect(spring.body.scheduleItem).toMatchObject({ label: 'Spring term', validFrom: '2027-01-05' });
    for (const id of [autumn.id, dup.body.scheduleItem.id]) await api('DELETE', `/schedule-items/${id}`);
  });

  it('archives on delete', async () => {
    const item = await createItem({ autoConfirm: false });
    const r = await api<{ scheduleItem: ScheduleItem }>('DELETE', `/schedule-items/${item.id}`);
    expect(r.body.scheduleItem.archivedAt).not.toBeNull();
  });

  it('is managed by Writers; Read only users see the schedule through bootstrap', async () => {
    expect((await api('GET', '/schedule-items', undefined, READER)).status).toBe(403);
    expect((await api('POST', '/schedule-items', nurseryItem(), READER)).status).toBe(403);
    const boot = await api<{ scheduleItems: ScheduleItem[] }>('GET', '/bootstrap', undefined, READER);
    expect(boot.body.scheduleItems.length).toBeGreaterThan(0);
  });
});
