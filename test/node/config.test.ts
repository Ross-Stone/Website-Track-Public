import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { buildTestFamilySql, TEST_FAMILY_PATH } from '../../scripts/fixtures';
import { buildSeedSql, SEED_MIGRATION_PATH } from '../../scripts/seed';

// Read the config exactly as Wrangler resolves it for each environment.
const read = (env?: string) => unstable_readConfig({ config: 'wrangler.jsonc', env }, { hideWarnings: true });

// Checks the shape, not the values: each deployment fills in its own domain, Access team, AUD and D1 id.
describe('wrangler.jsonc', () => {
  it.each([
    ['production', 'track', 'track-prod'],
    ['preview', 'track-preview', 'track-preview'],
  ])('%s is locked down', (envName, worker, dbName) => {
    const e = read(envName);
    expect(e.name).toBe(worker);
    expect(e.workers_dev).toBe(false);
    expect(e.preview_urls).toBe(false);
    expect(e.routes).toEqual([{ pattern: expect.any(String), custom_domain: true }]);
    expect(Object.keys(e.vars).sort()).toEqual(['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'ENVIRONMENT']);
    expect(e.vars.ENVIRONMENT).toBe(envName);
    // Both Access vars must always be set, so the dev auth stub can never run here.
    expect(e.vars.ACCESS_AUD).toEqual(expect.stringMatching(/\S/));
    expect(e.vars.ACCESS_TEAM_DOMAIN).toEqual(expect.stringMatching(/\.cloudflareaccess\.com$/));
    expect(e.vars).not.toHaveProperty('DEV_AUTH_STUB');
    expect(e.d1_databases).toEqual([
      expect.objectContaining({
        binding: 'DB',
        database_name: dbName,
        database_id: expect.stringMatching(/\S/),
      }),
    ]);
  });

  it('production and preview use different hosts, databases and AUDs', () => {
    const [p, v] = [read('production'), read('preview')];
    expect((p.routes![0] as { pattern: string }).pattern).not.toBe(
      (v.routes![0] as { pattern: string }).pattern,
    );
    expect(p.d1_databases[0]!.database_id).not.toBe(v.d1_databases[0]!.database_id);
    expect(p.vars.ACCESS_AUD).not.toBe(v.vars.ACCESS_AUD);
  });

  it('local top level has no routes, no Access vars and no stub flag', () => {
    const local = read();
    expect(local.routes ?? []).toEqual([]);
    expect(local.workers_dev).toBe(false);
    expect(local.vars).toEqual({ ENVIRONMENT: 'development' });
  });
});

describe('generated SQL', () => {
  it('the seed migration is up to date with scripts/seed-data.ts', () => {
    expect(readFileSync(SEED_MIGRATION_PATH, 'utf8')).toBe(buildSeedSql());
  });

  it('the seed migration adds no people, children, schedule or medicines', () => {
    const tables = [...readFileSync(SEED_MIGRATION_PATH, 'utf8').matchAll(/^INSERT INTO `(\w+)`/gm)].map(
      (m) => m[1],
    );
    expect(new Set(tables)).toEqual(new Set(['sync_state', 'activity_types', 'activity_fields']));
  });

  it('the test fixture is up to date with scripts/fixtures.ts', () => {
    expect(readFileSync(TEST_FAMILY_PATH, 'utf8')).toBe(buildTestFamilySql());
  });
});
