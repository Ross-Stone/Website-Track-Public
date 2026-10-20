import { describe, expect, it } from 'vitest';

// A fresh module per test, since the update state is module-level.
async function load() {
  const { vi } = await import('vitest');
  vi.resetModules();
  return import('../../src/client/lib/update');
}

function container(controlled: boolean) {
  const target = new EventTarget() as EventTarget & { controller: object | null };
  target.controller = controlled ? {} : null;
  return target;
}

describe('app update detection (TECH-04)', () => {
  it('offers a refresh when a new version takes over an open app', async () => {
    const m = await load();
    const c = container(true);
    m.watchForUpdates(c);
    expect(m.isUpdateReady()).toBe(false);
    c.dispatchEvent(new Event('controllerchange'));
    expect(m.isUpdateReady()).toBe(true);
  });

  it('ignores the first install, but not a later update of the same page', async () => {
    const m = await load();
    const c = container(false);
    m.watchForUpdates(c);
    c.dispatchEvent(new Event('controllerchange')); // first install claims the page
    expect(m.isUpdateReady()).toBe(false);
    c.dispatchEvent(new Event('controllerchange')); // then a real update
    expect(m.isUpdateReady()).toBe(true);
  });
});
