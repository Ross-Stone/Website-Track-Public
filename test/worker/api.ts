import { env } from 'cloudflare:workers';
import { ulid } from 'ulid';
import { createApp } from '../../src/worker/app';
import { clearUserCache } from '../../src/worker/auth/middleware';
import { devEnv } from './helpers';

export const ALEX = 'alex@example.com';
export const JAMIE = 'jamie@example.com';
export const READER = 'reader@example.com';

const app = createApp();

export interface Res<T = Record<string, unknown>> {
  status: number;
  body: T & { error?: { code: string; message: string } };
  text: string;
  headers: Headers;
}

/** Calls the API through the real app with the dev auth stub, as the given user. */
export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  as: string = ALEX,
): Promise<Res<T>> {
  const res = await app.request(
    `http://localhost/api${path}`,
    {
      method,
      headers: {
        'x-dev-user-email': as,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    devEnv(),
  );
  // Decode without stripping a UTF-8 BOM, so CSV tests can see it.
  const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(await res.arrayBuffer());
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* CSV and other non-JSON bodies */
  }
  return { status: res.status, body: parsed as Res<T>['body'], text, headers: res.headers };
}

export async function version(): Promise<number> {
  return (await env.DB.prepare('SELECT version FROM sync_state WHERE id = 1').first<{ version: number }>())!
    .version;
}

export async function ensureReader() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, display_name, role, active, created_at, updated_at)
     VALUES ('U_READER', 'reader@example.com', 'Reader', 'reader', 1, 'x', 'x')`,
  ).run();
  clearUserCache();
}

/** Seed ids by name. */
export async function seedIds() {
  const q = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;
  const types = await q<{ id: string; name: string }>('SELECT id, name FROM activity_types');
  const meds = await q<{ id: string; name: string }>('SELECT id, name FROM medicines');
  const users = await q<{ id: string; email: string }>('SELECT id, email FROM users');
  const sam = (await q<{ id: string }>("SELECT id FROM children WHERE first_name = 'Sam'"))[0]!.id;
  const type = Object.fromEntries(types.map((t) => [t.name, t.id])) as Record<string, string>;
  const medicine = Object.fromEntries(meds.map((m) => [m.name, m.id])) as Record<string, string>;
  const user = Object.fromEntries(users.map((u) => [u.email, u.id])) as Record<string, string>;
  return { sam, type, medicine, user };
}

export const newId = () => ulid();
