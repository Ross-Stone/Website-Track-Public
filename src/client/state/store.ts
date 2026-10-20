// App data store and sync loop (FR-SYNC-01, FR-SYNC-02, TECH-09).
//
// Holds bootstrap configuration, the selected child's recent entries (7 days + running timers),
// History days that have been opened, and day overrides for yesterday and today. Checks for changes
// only while the app is visible: on open, on return to the foreground, every 10 minutes and on demand.
import { useSyncExternalStore } from 'react';
import type { Bootstrap, EntryInput, OverrideInput } from '../../shared/api';
import type { Entry, ScheduleOverride } from '../../shared/domain';
import { addDays, deviceTimeZone, localDateOf } from '../../shared/time';
import { apiJson, AuthExpiredError, NetworkError, NotAllowedError, onAuthProblem } from '../lib/api';
import { checkForUpdate } from '../lib/update';
import { loadCache, saveCache } from './cache';

const DAY = 86_400_000;
const RECENT_DAYS = 7;
const CHECK_EVERY_MS = 10 * 60_000;
/** While offline, try again this often (only while visible) so the app catches up when back (AC5). */
const OFFLINE_RETRY_MS = 60_000;
const CHILD_KEY = 'track.child';

export interface State {
  status: 'loading' | 'ready' | 'not_allowed' | 'error';
  message: string;
  boot: Bootstrap | null;
  childId: string | null;
  /** Selected-or-visited child → entries from the last 7 days plus running timers. */
  recent: Record<string, Entry[]>;
  /** `${childId}|${date}` → entries whose local date is that day (History). */
  days: Record<string, Entry[]>;
  /** childId → overrides for yesterday and today. */
  overrides: Record<string, ScheduleOverride[]>;
  lastUpdated: Date | null;
  authExpired: boolean;
  online: boolean;
  refreshing: boolean;
}

let state: State = {
  status: 'loading',
  message: '',
  boot: null,
  childId: null,
  recent: {},
  days: {},
  overrides: {},
  lastUpdated: null,
  authExpired: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  refreshing: false,
};
const listeners = new Set<() => void>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const { boot, childId, recent, days, overrides, lastUpdated } = state;
  if (boot) saveCache({ boot, childId, recent, days, overrides, lastUpdated });
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  if (
    'boot' in patch ||
    'recent' in patch ||
    'days' in patch ||
    'overrides' in patch ||
    'lastUpdated' in patch
  ) {
    // Persist for offline viewing, at most every 300 ms (and straight away when the page is hidden).
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 300);
  }
}

/** A failed request with no response means we're offline, whatever navigator.onLine says. */
function noteError(e: unknown) {
  if (e instanceof NetworkError) set({ online: false });
}

/** apiJson, noting when the network is unreachable (the banner and disabled controls follow). */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await apiJson<T>(method, path, body);
  } catch (e) {
    noteError(e);
    throw e;
  }
}

export const getState = () => state;

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export const tz = () => deviceTimeZone();
export const today = () => localDateOf(new Date(), tz());

// ---------- loading ----------

function pickChild(boot: Bootstrap): string | null {
  const active = boot.children.filter((c) => !c.archivedAt);
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(CHILD_KEY);
  } catch {
    /* ignore */
  }
  if (saved && active.some((c) => c.id === saved)) return saved;
  return active[0]?.id ?? null;
}

async function loadBootstrap(): Promise<Bootstrap> {
  const boot = await request<Bootstrap>('GET', '/bootstrap');
  if (state.boot && state.boot.me.id !== boot.me.id) {
    // A different person on this phone: don't show the previous user's cached data.
    set({ recent: {}, days: {}, overrides: {} });
  }
  const childId =
    state.childId && boot.children.some((c) => c.id === state.childId && !c.archivedAt)
      ? state.childId
      : pickChild(boot);
  set({ boot, childId });
  return boot;
}

const canWrite = () => state.boot?.me.role === 'writer' || state.boot?.me.role === 'admin';

/** Loads (or reloads) Home's data for a child: auto-confirm first, then recent entries and overrides. */
export async function loadChild(childId: string) {
  const now = new Date();
  const date = today();
  if (canWrite()) {
    try {
      await request('POST', `/children/${childId}/auto-confirm`, { date, tz: tz(), now: now.toISOString() });
    } catch (e) {
      if (e instanceof AuthExpiredError || e instanceof NotAllowedError) throw e;
      // Auto-confirm is best effort; the next sync tries again.
    }
  }
  const from = new Date(now.getTime() - RECENT_DAYS * DAY).toISOString();
  const to = new Date(now.getTime() + DAY).toISOString();
  const [entries, overrides] = await Promise.all([
    request<{ entries: Entry[] }>('GET', `/children/${childId}/entries?from=${from}&to=${to}&running=1`),
    request<{ overrides: ScheduleOverride[] }>(
      'GET',
      `/children/${childId}/overrides?date=${addDays(date, -1)}&date=${date}`,
    ),
  ]);
  set({
    recent: { ...state.recent, [childId]: entries.entries },
    overrides: { ...state.overrides, [childId]: overrides.overrides },
  });
}

/** Loads one History day: entries whose own local date is `date` (FR-HIST-01, FR-HIST-03). */
export async function loadDay(childId: string, date: string) {
  // Ask for the day widened by 14 h either side so entries logged in other zones are included,
  // then keep those whose local date (in their own zone) is the day.
  const start = Date.parse(`${date}T00:00:00Z`);
  const from = new Date(start - 14 * 3_600_000).toISOString();
  const to = new Date(start + DAY + 14 * 3_600_000).toISOString();
  const r = await request<{ entries: Entry[] }>('GET', `/children/${childId}/entries?from=${from}&to=${to}`);
  set({ days: { ...state.days, [`${childId}|${date}`]: r.entries.filter((e) => e.localDate === date) } });
}

let started = false;
let historyKey: string | null = null;

/** Remembers which History day is on screen so a sync refreshes it too. */
export function setVisibleDay(childId: string | null, date: string | null) {
  historyKey = childId && date ? `${childId}|${date}` : null;
}

export async function start() {
  if (started) return;
  started = true;
  onAuthProblem((e) => {
    if (e instanceof NotAllowedError) set({ status: 'not_allowed', message: e.message });
    else set({ authExpired: true });
  });
  window.addEventListener('online', () => {
    set({ online: true });
    void check();
  });
  window.addEventListener('offline', () => set({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
    else if (saveTimer) persistNow(); // the app may be closed while hidden
  });
  window.addEventListener('pagehide', () => {
    if (saveTimer) persistNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void check();
  }, CHECK_EVERY_MS);
  setInterval(() => {
    if (!state.online && document.visibilityState === 'visible') void check();
  }, OFFLINE_RETRY_MS);

  // Show what this phone already has straight away; then refresh from the network.
  const cached = loadCache();
  if (cached) set({ ...cached, status: 'ready' });

  try {
    const boot = await loadBootstrap();
    const childId = state.childId;
    if (childId) await loadChild(childId);
    set({ status: 'ready', lastUpdated: new Date(), boot });
  } catch (e) {
    if (e instanceof NotAllowedError) set({ status: 'not_allowed', message: e.message });
    else if (e instanceof AuthExpiredError)
      set({ authExpired: true, status: state.boot ? 'ready' : 'error', message: e.message });
    else if (e instanceof NetworkError && state.boot) set({ online: false, status: 'ready' });
    else if (e instanceof NetworkError)
      set({
        online: false,
        status: 'error',
        message: "You're offline and nothing has been saved on this phone yet.",
      });
    else set({ status: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

let checking: Promise<void> | null = null;

/**
 * Cheap change check (FR-SYNC-02): one-row version read; refetch only when it moved.
 * Pass force to refetch regardless (pull to refresh, after a local write).
 */
export function check(force = false): Promise<void> {
  if (checking) return force ? checking.then(() => check(true)) : checking;
  checking = (async () => {
    if (!state.boot) return;
    set({ refreshing: true });
    try {
      const { version } = await request<{ version: number }>('GET', '/version');
      checkForUpdate(); // online and signed in, so a good moment to look for a new app version
      if (force || version !== state.boot.version) {
        await loadBootstrap();
        const childId = state.childId;
        if (childId) await loadChild(childId);
        if (historyKey) {
          const [c, d] = historyKey.split('|') as [string, string];
          await loadDay(c, d);
        }
      } else if (state.childId) {
        // Auto-confirm still needs to run when nothing changed (FR-LOG-08 AC1: "when the app loads or syncs").
        if (canWrite()) await loadChildIfAutoDue(state.childId);
      }
      set({ lastUpdated: new Date(), online: true });
    } catch (e) {
      noteError(e); // auth problems are handled by the listener in start()
    } finally {
      set({ refreshing: false });
      checking = null;
    }
  })();
  return checking;
}

/** Runs auto-confirm; only refetches if it created something (it bumps the version). */
async function loadChildIfAutoDue(childId: string) {
  const r = await request<{ created: Entry[] }>('POST', `/children/${childId}/auto-confirm`, {
    date: today(),
    tz: tz(),
    now: new Date().toISOString(),
  });
  if (r.created.length) {
    await loadBootstrap();
    await loadChild(childId);
  }
}

export async function selectChild(childId: string) {
  try {
    localStorage.setItem(CHILD_KEY, childId);
  } catch {
    /* ignore */
  }
  set({ childId });
  if (!state.recent[childId]) await loadChild(childId).catch(noteError);
}

// ---------- local updates after writes ----------

function upsertLocal(entry: Entry) {
  const recent = { ...state.recent };
  const list = (recent[entry.childId] ?? []).filter((e) => e.id !== entry.id);
  const cutoff = Date.now() - RECENT_DAYS * DAY;
  if (!entry.deletedAt && (Date.parse(entry.startUtc) >= cutoff || entry.endUtc === null)) list.push(entry);
  recent[entry.childId] = list.sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  const days = { ...state.days };
  for (const key of Object.keys(days)) {
    if (!key.startsWith(`${entry.childId}|`)) continue;
    const date = key.split('|')[1];
    const filtered = days[key]!.filter((e) => e.id !== entry.id);
    if (!entry.deletedAt && entry.localDate === date) filtered.push(entry);
    days[key] = filtered.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  }

  let boot = state.boot;
  if (boot && !entry.deletedAt) {
    const type = boot.activityTypes.find((t) => t.id === entry.activityTypeId);
    if (type?.systemKey === 'weight' || type?.systemKey === 'height') {
      const others = boot.latestMeasurements.filter(
        (m) => !(m.childId === entry.childId && m.activityTypeId === entry.activityTypeId),
      );
      const current = boot.latestMeasurements.find(
        (m) => m.childId === entry.childId && m.activityTypeId === entry.activityTypeId,
      );
      const latest =
        !current || current.id === entry.id || entry.startUtc >= current.startUtc ? entry : current;
      boot = { ...boot, latestMeasurements: [...others, latest] };
    }
  }
  set({ recent, days, boot });
}

// ---------- writes ----------

export async function saveEntry(id: string, input: EntryInput): Promise<Entry> {
  const r = await request<{ entry: Entry }>('PUT', `/entries/${id}`, input);
  upsertLocal(r.entry); // FR-LOG-01 AC5: shows straight away
  void check(true);
  return r.entry;
}

export async function deleteEntry(id: string): Promise<Entry> {
  const r = await request<{ entry: Entry }>('DELETE', `/entries/${id}`);
  upsertLocal(r.entry);
  void check(true);
  return r.entry;
}

export async function restoreEntry(id: string): Promise<Entry> {
  const r = await request<{ entry: Entry }>('POST', `/entries/${id}/restore`);
  upsertLocal(r.entry);
  void check(true);
  return r.entry;
}

export async function putOverride(id: string, input: OverrideInput) {
  const r = await request<{ override: ScheduleOverride }>('PUT', `/schedule-overrides/${id}`, input);
  const list = (state.overrides[input.childId] ?? []).filter(
    (o) => !(o.scheduleItemId === input.scheduleItemId && o.localDate === input.localDate),
  );
  set({ overrides: { ...state.overrides, [input.childId]: [...list, r.override] } });
  void check(true);
}

export async function deleteOverride(childId: string, id: string) {
  await request('DELETE', `/schedule-overrides/${id}`);
  set({
    overrides: { ...state.overrides, [childId]: (state.overrides[childId] ?? []).filter((o) => o.id !== id) },
  });
  void check(true);
}

/** For settings screens: write, then reload configuration. */
export async function writeConfig<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await request<T>(method, path, body);
  await check(true);
  return r;
}

/** After an import replaced everything: drop this phone's copies and load afresh (FR-SET-11). */
export async function reloadAll() {
  set({ recent: {}, days: {}, overrides: {} });
  await check(true);
}
