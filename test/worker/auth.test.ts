import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/worker/app';
import { authenticate, clearUserCache, requireRole } from '../../src/worker/auth/middleware';
import { resolveAuthMode } from '../../src/worker/auth/mode';
import type { AppEnv } from '../../src/worker/env';
import { accessEnv, AUD, devEnv, makeKeys, TEAM } from './helpers';

const PROD_URL = 'https://track.example.com/api/me';
const LOCAL_URL = 'http://localhost:8787/api/me';

let keys: Awaited<ReturnType<typeof makeKeys>>;
beforeAll(async () => {
  keys = await makeKeys();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, display_name, role, active, created_at, updated_at)
       VALUES ('U_READER', 'reader@example.com', 'Reader', 'reader', 1, '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z'),
              ('U_GONE', 'gone@example.com', 'Gone', 'writer', 0, '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z')`,
    ),
  ]);
  clearUserCache();
});

async function call(url: string, bindings: AppEnv['Bindings'], headers: Record<string, string> = {}) {
  const app = createApp({ getKey: keys.getKey });
  const res = await app.request(url, { headers }, bindings);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown> & { error?: { code: string } },
  };
}

describe('Cloudflare Access JWT (TECH-05)', () => {
  it('accepts a valid token and returns the user', async () => {
    const token = await keys.sign({ email: 'alex@example.com' });
    const r = await call(PROD_URL, accessEnv(), { 'cf-access-jwt-assertion': token });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ email: 'alex@example.com', displayName: 'Alex', role: 'admin' });
  });

  it('matches email case-insensitively (FR-AUTH-02 AC2)', async () => {
    const token = await keys.sign({ email: 'Jamie@Example.COM' });
    const r = await call(PROD_URL, accessEnv(), { 'cf-access-jwt-assertion': token });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('writer');
  });

  it('rejects a missing token', async () => {
    const r = await call(PROD_URL, accessEnv());
    expect(r.status).toBe(401);
    expect(r.body.error?.code).toBe('unauthenticated');
  });

  it('never trusts the email header on its own', async () => {
    const r = await call(PROD_URL, accessEnv(), {
      'cf-access-authenticated-user-email': 'alex@example.com',
    });
    expect(r.status).toBe(401);
  });

  it.each([
    ['wrong audience', { audience: 'some-other-app' }],
    ['wrong issuer', { issuer: 'https://evil.cloudflareaccess.com' }],
    ['expired', { expiresIn: Math.floor(Date.now() / 1000) - 60 }],
  ])('rejects a token with %s', async (_name, opts) => {
    const token = await keys.sign({ email: 'alex@example.com' }, opts);
    const r = await call(PROD_URL, accessEnv(), { 'cf-access-jwt-assertion': token });
    expect(r.status).toBe(401);
  });

  it('rejects a token signed by a different key', async () => {
    const other = await makeKeys();
    const token = await other.sign({ email: 'alex@example.com' });
    const r = await call(PROD_URL, accessEnv(), { 'cf-access-jwt-assertion': token });
    expect(r.status).toBe(401);
  });

  it('rejects a token without an email (service token)', async () => {
    const token = await keys.sign({ common_name: 'svc' });
    const r = await call(PROD_URL, accessEnv(), { 'cf-access-jwt-assertion': token });
    expect(r.status).toBe(401);
  });

  it('answers not_allowed for a signed-in email not in the user list', async () => {
    const token = await keys.sign({ email: 'stranger@example.com' });
    const r = await call(PROD_URL, accessEnv(), { 'cf-access-jwt-assertion': token });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('not_allowed');
  });

  it('answers not_allowed for an inactive user', async () => {
    const token = await keys.sign({ email: 'gone@example.com' });
    const r = await call(PROD_URL, accessEnv(), { 'cf-access-jwt-assertion': token });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('not_allowed');
  });

  it('fails closed when Access is only half configured', async () => {
    const token = await keys.sign({ email: 'alex@example.com' });
    const r = await call(PROD_URL, accessEnv({ ACCESS_AUD: undefined }), {
      'cf-access-jwt-assertion': token,
    });
    expect(r.status).toBe(500);
    expect(r.body.error?.code).toBe('server_misconfigured');
  });
});

describe('dev auth stub', () => {
  it('works locally with no Access config', async () => {
    const r = await call(LOCAL_URL, devEnv());
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('admin');
  });

  it('lets local tests pick a user with the dev header', async () => {
    const r = await call(LOCAL_URL, devEnv(), { 'x-dev-user-email': 'reader@example.com' });
    expect(r.body.role).toBe('reader');
  });

  it.each([
    ['Access team domain is set', devEnv({ ACCESS_TEAM_DOMAIN: TEAM }), LOCAL_URL],
    ['Access AUD is set', devEnv({ ACCESS_AUD: AUD }), LOCAL_URL],
    ['ENVIRONMENT is production', devEnv({ ENVIRONMENT: 'production' }), LOCAL_URL],
    ['ENVIRONMENT is preview', devEnv({ ENVIRONMENT: 'preview' }), LOCAL_URL],
    ['the host is not local', devEnv(), PROD_URL],
    ['the flag is not exactly "1"', devEnv({ DEV_AUTH_STUB: 'true' }), LOCAL_URL],
    ['deployed config plus the flag', accessEnv({ DEV_AUTH_STUB: '1' }), PROD_URL],
  ])('is refused with 500 when %s', async (_name, bindings, url) => {
    const r = await call(url, bindings, { 'x-dev-user-email': 'alex@example.com' });
    expect(r.status).toBe(500);
    expect(r.body.error?.code).toBe('server_misconfigured');
  });

  it('ignores the dev header when Access is in use', async () => {
    const r = await call(PROD_URL, accessEnv(), { 'x-dev-user-email': 'alex@example.com' });
    expect(r.status).toBe(401);
  });

  it('is never enabled with no config at all', () => {
    expect(resolveAuthMode({ ...devEnv(), DEV_AUTH_STUB: undefined }, LOCAL_URL).kind).toBe('misconfigured');
  });
});

describe('role middleware (FR-AUTH-03)', () => {
  const app = new Hono<AppEnv>()
    .use('*', authenticate())
    .get('/r', requireRole('reader'), (c) => c.text('ok'))
    .get('/w', requireRole('writer'), (c) => c.text('ok'))
    .get('/a', requireRole('admin'), (c) => c.text('ok'));

  const status = async (path: string, email: string) =>
    (await app.request(`http://localhost${path}`, { headers: { 'x-dev-user-email': email } }, devEnv()))
      .status;

  it.each([
    ['reader@example.com', 200, 403, 403],
    ['jamie@example.com', 200, 200, 403],
    ['alex@example.com', 200, 200, 200],
  ])('%s gets R=%i W=%i A=%i', async (email, r, w, a) => {
    expect(await status('/r', email)).toBe(r);
    expect(await status('/w', email)).toBe(w);
    expect(await status('/a', email)).toBe(a);
  });
});

describe('session routes', () => {
  it('GET /api/version returns the sync version', async () => {
    const r = await call('http://localhost/api/version', devEnv());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ version: 2 }); // 1 from the seed migration, 2 after the test fixture
  });

  it('unknown /api routes return the error envelope', async () => {
    const r = await call('http://localhost/api/nope', devEnv());
    expect(r.status).toBe(404);
    expect(r.body.error?.code).toBe('not_found');
  });
});
