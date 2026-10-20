import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { orderExport, splitStatements } from '../../scripts/order-d1-export.mjs';

const split = splitStatements as (sql: string) => string[];
const order = orderExport as (sql: string) => string;

describe('order-d1-export', () => {
  it('splits only on semicolons outside quotes and comments', () => {
    const sql = `PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO "e" VALUES('a; b -- c\nd', 'it''s');\n-- comment; here\nCREATE TABLE \`x\` (id text);`;
    expect(split(sql)).toEqual([
      'PRAGMA defer_foreign_keys=TRUE;',
      `INSERT INTO "e" VALUES('a; b -- c\nd', 'it''s');`,
      'CREATE TABLE `x` (id text);',
    ]);
  });

  it('puts parent tables and their rows before children, indexes last', () => {
    const sql = [
      'PRAGMA defer_foreign_keys=TRUE;',
      'CREATE TABLE `entries` (id text, user_id text REFERENCES `users`(`id`));',
      `INSERT INTO "entries" VALUES('e1','u1');`,
      'CREATE INDEX `entries_idx` ON `entries` (`user_id`);',
      'CREATE TABLE `users` (id text);',
      `INSERT INTO "users" VALUES('u1');`,
      `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',2);`,
    ].join('\n');
    expect(order(sql).trim().split('\n')).toEqual([
      'PRAGMA defer_foreign_keys=TRUE;',
      'CREATE TABLE `users` (id text);',
      `INSERT INTO "users" VALUES('u1');`,
      'CREATE TABLE `entries` (id text, user_id text REFERENCES `users`(`id`));',
      `INSERT INTO "entries" VALUES('e1','u1');`,
      `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',2);`,
      'CREATE INDEX `entries_idx` ON `entries` (`user_id`);',
    ]);
  });
});
