// Prints SQL that makes the first Admin, for a database that has none yet.
//   node scripts/admin-sql.mjs <email> [display name]
//
// The deploy workflows run it after the migrations with the ADMIN_EMAIL repository variable, and
// `npm run db:admin:local` runs it for the local database. It is safe to run on every deploy:
//   - if the database already has an active Admin, it changes nothing;
//   - otherwise it adds the email as an active Admin (or promotes and reactivates that user if the
//     email already exists), and bumps sync_state.version in the same file, so it runs as one batch.
import { ulid } from 'ulid';

const [email, name = 'Admin'] = process.argv.slice(2).map((s) => s?.trim());
if (!email || !/^[^\s@'"\\;]+@[^\s@'"\\;]+\.[^\s@'"\\;]+$/.test(email)) {
  console.error('Usage: node scripts/admin-sql.mjs <email> [display name]  (a valid email is required)');
  process.exit(1);
}
if (!name || name.length > 40) {
  console.error('The display name must be 1 to 40 characters.');
  process.exit(1);
}

const q = (s) => `'${s.replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const noAdmin = "NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND active = 1)";

process.stdout.write(
  [
    `-- First Admin. Does nothing once the database has an active Admin.`,
    `UPDATE sync_state SET version = version + 1 WHERE id = 1 AND ${noAdmin};`,
    `INSERT INTO users (id, email, display_name, role, active, created_at, updated_at) ` +
      `SELECT ${q(ulid())}, ${q(email.toLowerCase())}, ${q(name)}, 'admin', 1, ${q(now)}, ${q(now)} WHERE ${noAdmin} ` +
      `ON CONFLICT (email) DO UPDATE SET role = 'admin', active = 1, updated_at = excluded.updated_at;`,
    '',
  ].join('\n'),
);
