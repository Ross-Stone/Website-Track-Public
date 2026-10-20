// Builds the SQL that empties track-preview before a refresh from production.
// Input: the JSON written by `wrangler d1 execute --json --command "SELECT name FROM sqlite_master ..."`.
// Output (stdout): DROP TABLE statements, child tables first, with foreign key checks deferred.
import { readFileSync } from 'node:fs';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/preview-reset-sql.mjs <tables.json>');
  process.exit(2);
}
const parsed = JSON.parse(readFileSync(file, 'utf8'));
const results = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((r) => r.results ?? []);
const names = results.map((r) => String(r.name)).filter((n) => /^[A-Za-z0-9_]+$/.test(n));

// Tables that reference others go first; everything else (users, children, activity_types...) after.
const childFirst = [
  'entries',
  'schedule_overrides',
  'child_activity_settings',
  'activity_fields',
  'schedule_items',
  'medicines',
];
const rank = (n) => (childFirst.includes(n) ? childFirst.indexOf(n) : childFirst.length);
names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

console.log('PRAGMA defer_foreign_keys = on;');
for (const n of names) console.log(`DROP TABLE IF EXISTS "${n}";`);
