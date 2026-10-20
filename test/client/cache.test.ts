import { describe, expect, it } from 'vitest';
import { deserialize, MAX_DAYS, serialize, type Cached } from '../../src/client/state/cache';
import type { Bootstrap } from '../../src/shared/api';

const boot = {
  version: 3,
  me: { id: 'alex', email: 'r', displayName: 'Alex', role: 'admin' },
} as unknown as Bootstrap;

describe('offline cache (FR-SYNC-03 AC2)', () => {
  it('round-trips what the app needs to open offline', () => {
    const c: Cached = {
      boot,
      childId: 'sam',
      recent: { sam: [] },
      days: { 'sam|2026-10-17': [] },
      overrides: { sam: [] },
      lastUpdated: new Date('2026-10-18T08:48:00.000Z'),
    };
    const back = deserialize(serialize(c))!;
    expect(back).toEqual(c);
    expect(back.lastUpdated).toBeInstanceOf(Date);
  });

  it(`keeps only the newest ${MAX_DAYS} History days`, () => {
    const days = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`sam|d${String(i).padStart(2, '0')}`, []]),
    );
    const back = deserialize(
      serialize({ boot, childId: null, recent: {}, days, overrides: {}, lastUpdated: null }),
    )!;
    expect(Object.keys(back.days)).toHaveLength(MAX_DAYS);
    expect(Object.keys(back.days)[0]).toBe('sam|d10');
  });

  it('ignores missing, corrupt or old-format data', () => {
    expect(deserialize(null)).toBeNull();
    expect(deserialize('{not json')).toBeNull();
    expect(deserialize(JSON.stringify({ v: 0, boot }))).toBeNull();
    expect(deserialize(JSON.stringify({ v: 1 }))).toBeNull();
  });
});
