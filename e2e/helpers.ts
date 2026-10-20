import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const ALEX = 'alex@example.com';

/** Calls the API as a user via the dev auth stub (local only). */
export async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
  as = ALEX,
): Promise<T> {
  const res = await request.fetch(`/api${path}`, { method, data, headers: { 'x-dev-user-email': as } });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

interface Boot {
  children: { id: string; firstName: string }[];
  activityTypes: { id: string; name: string; kind: string }[];
}

export async function seedIds(request: APIRequestContext) {
  const boot = await api<Boot>(request, 'GET', '/bootstrap');
  const type = Object.fromEntries(boot.activityTypes.map((t) => [t.name, t.id])) as Record<string, string>;
  return { sam: boot.children.find((c) => c.firstName === 'Sam')!.id, type };
}

/** Ends any running timers for a child, so tests start from a known state. */
export async function endRunning(request: APIRequestContext, childId: string) {
  const boot = await api<Boot>(request, 'GET', '/bootstrap');
  const duration = new Set(boot.activityTypes.filter((t) => t.kind === 'duration').map((t) => t.id));
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const r = await api<{ entries: Record<string, unknown>[] }>(
    request,
    'GET',
    `/children/${childId}/entries?from=${from}&to=${now.toISOString()}&running=1`,
  );
  for (const e of r.entries.filter((x) => x.endUtc === null && duration.has(x.activityTypeId as string))) {
    await api(request, 'PUT', `/entries/${e.id as string}`, { ...e, endUtc: now.toISOString() });
  }
}

/** Deletes entries linked to a schedule item (test clean-up). */
export async function deleteEntriesFor(request: APIRequestContext, childId: string, scheduleItemId: string) {
  const now = Date.now();
  const r = await api<{ entries: { id: string; scheduleItemId: string | null }[] }>(
    request,
    'GET',
    `/children/${childId}/entries?from=${new Date(now - 2 * 86_400_000).toISOString()}&to=${new Date(now + 2 * 86_400_000).toISOString()}`,
  );
  for (const e of r.entries.filter((x) => x.scheduleItemId === scheduleItemId)) {
    await api(request, 'DELETE', `/entries/${e.id}`);
  }
}

/** WCAG 2.2 AA checks with axe (TECH-12). `name` labels any violations and, with SHOTS_DIR set, a screenshot. */
export async function axe(page: Page, name = 'page') {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    r.violations.map((v) => `${name} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` });
}
