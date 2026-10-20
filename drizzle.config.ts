import { defineConfig } from 'drizzle-kit';

// Used only to generate SQL migrations. Wrangler applies them (`wrangler d1 migrations apply`).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/worker/db/schema.ts',
  out: './migrations',
});
