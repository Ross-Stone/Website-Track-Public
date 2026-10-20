// App updates (TECH-04). The service worker installs a new version in the background and takes over
// straight away, but an app that is already open keeps running the old code until it reloads. And the
// browser only looks for a new service worker when a page opens, which an installed app resumed from
// the background may not do for days. So the app asks for an update check whenever it syncs, and when a
// new version takes over it offers a refresh.
import { useSyncExternalStore } from 'react';

/** Don't ask the browser to re-check more often than this. */
const CHECK_EVERY_MS = 60_000;

/** The parts of the browser's service worker API used here (kept DOM-free so it can be unit-tested). */
interface Container {
  controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}
interface Registration {
  update(): Promise<unknown>;
}

let registration: Registration | null = null;
let ready = false;
let lastCheck = 0;
const listeners = new Set<() => void>();

function markReady() {
  if (ready) return;
  ready = true;
  listeners.forEach((l) => l());
}

/**
 * Watches for a new version taking over. The first takeover of a page that had no service worker is
 * the first install, not an update, so it's ignored.
 */
export function watchForUpdates(container: Container) {
  let controlled = !!container.controller;
  container.addEventListener('controllerchange', () => {
    if (controlled) markReady();
    controlled = true;
  });
}

/** Called once the service worker is registered, so update checks can use it. */
export function setRegistration(r: Registration) {
  registration = r;
}

/** Asks the browser to look for a new version (called by the sync loop). Failures are ignored. */
export function checkForUpdate(now = Date.now()) {
  if (!registration || now - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = now;
  registration.update().catch(() => {
    /* offline, or the Access session has expired: try again at the next sync */
  });
}

/** Whether a new version has taken over (for tests and the banner). */
export const isUpdateReady = () => ready;

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ready,
  );
}
