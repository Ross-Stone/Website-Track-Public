import { readFileSync } from 'node:fs';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/shared/**/*.test.ts', 'test/node/**/*.test.ts', 'test/client/**/*.test.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                // Every migration, then the fictional test family (users, a child, schedule, medicines).
                TEST_MIGRATIONS: [
                  ...(await readD1Migrations('./migrations')),
                  {
                    name: 'test-family.sql',
                    queries: readFileSync('./test/fixtures/test-family.sql', 'utf8')
                      .split('\n')
                      .filter((l) => l && !l.startsWith('--')),
                  },
                ],
              },
            },
          })),
        ],
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.ts'],
          setupFiles: ['./test/worker/apply-migrations.ts'],
        },
      },
    ],
  },
});
