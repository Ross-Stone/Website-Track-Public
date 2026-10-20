// On-device copy of what the app has loaded, so it opens and can be viewed offline (FR-SYNC-03 AC2):
// settings (bootstrap), the last 7 days of entries per child, History days that were opened (newest 30)
// and day overrides. Saved to localStorage; small (tens of KB) and per device.
import type { Bootstrap } from '../../shared/api';
import type { Entry, ScheduleOverride } from '../../shared/domain';

const KEY = 'track.cache.v1';
export const MAX_DAYS = 30;

export interface Cached {
  boot: Bootstrap;
  childId: string | null;
  recent: Record<string, Entry[]>;
  days: Record<string, Entry[]>;
  overrides: Record<string, ScheduleOverride[]>;
  lastUpdated: Date | null;
}

interface Stored extends Omit<Cached, 'lastUpdated'> {
  v: 1;
  lastUpdated: string | null;
}

export function serialize(c: Cached): string {
  // Keep only the newest History days (insertion order: newest set last).
  const keys = Object.keys(c.days);
  const days = Object.fromEntries(keys.slice(-MAX_DAYS).map((k) => [k, c.days[k]!]));
  const stored: Stored = {
    v: 1,
    ...c,
    days,
    lastUpdated: c.lastUpdated ? c.lastUpdated.toISOString() : null,
  };
  return JSON.stringify(stored);
}

export function deserialize(text: string | null): Cached | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Partial<Stored>;
    if (s.v !== 1 || !s.boot || !s.boot.me) return null;
    return {
      boot: s.boot,
      childId: s.childId ?? null,
      recent: s.recent ?? {},
      days: s.days ?? {},
      overrides: s.overrides ?? {},
      lastUpdated: s.lastUpdated ? new Date(s.lastUpdated) : null,
    };
  } catch {
    return null;
  }
}

export function loadCache(): Cached | null {
  try {
    return deserialize(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveCache(c: Cached) {
  try {
    localStorage.setItem(KEY, serialize(c));
  } catch {
    // Storage full or blocked (private mode): the app still works online.
  }
}
