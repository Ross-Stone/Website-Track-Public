// Makes DEV_AUTH_EMAIL from .dev.vars the Admin of the LOCAL database (npm run db:admin:local).
// Local only: it always passes --local, so it can never reach a deployed database.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const vars = readFileSync('.dev.vars', 'utf8');
const email = /^DEV_AUTH_EMAIL=(.+)$/m.exec(vars)?.[1]?.trim();
if (!email) {
  console.error('Set DEV_AUTH_EMAIL in .dev.vars first (cp .dev.vars.example .dev.vars).');
  process.exit(1);
}
const sql = execFileSync('node', ['scripts/admin-sql.mjs', email], { encoding: 'utf8' });
mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/local-admin.sql', sql);
execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'track-local', '--local', '--file', '.wrangler/local-admin.sql'],
  {
    stdio: 'inherit',
  },
);
console.log(`${email} is the local Admin (unless the local database already had one).`);
