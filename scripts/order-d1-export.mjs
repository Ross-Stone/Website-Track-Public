// Reorders a `wrangler d1 export` SQL file so every table is created (and filled) after the tables
// its foreign keys reference. D1 exports tables in creation order, which can put a child table first
// (e.g. after a table rebuild), and loading a child before its parent exists fails even with
// `PRAGMA defer_foreign_keys`. Statement contents are never changed, only their order.
//
//   node scripts/order-d1-export.mjs <in.sql> > out.sql
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Splits SQL into statements on `;` outside quotes ('..', "..", `..`, [..]) and comments. */
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (quote) {
      cur += ch;
      if (ch === quote) {
        if ((quote === "'" || quote === '"') && next === quote) {
          cur += next;
          i++;
        } else quote = null;
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      cur += '\n';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[') quote = ']';
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim() + ';');
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().endsWith(';') ? cur.trim() : cur.trim() + ';');
  return out;
}

const ident = String.raw`[\x60"\[]?([A-Za-z0-9_]+)[\x60"\]]?`;
const createTableRe = new RegExp(String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${ident}`, 'i');
const insertRe = new RegExp(String.raw`^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+${ident}`, 'i');
const referencesRe = new RegExp(String.raw`REFERENCES\s+${ident}`, 'gi');

export function orderExport(sql) {
  const head = [];
  const tables = new Map(); // name -> { create, inserts, deps, index }
  const after = []; // sqlite_sequence inserts and anything unrecognised
  const tail = []; // indexes, triggers, views

  for (const stmt of splitStatements(sql)) {
    let m;
    if (/^PRAGMA\b/i.test(stmt)) head.push(stmt);
    else if ((m = createTableRe.exec(stmt))) {
      const name = m[1];
      const deps = new Set([...stmt.matchAll(referencesRe)].map((r) => r[1]).filter((d) => d !== name));
      const t = tables.get(name) ?? { inserts: [] };
      tables.set(name, { ...t, create: stmt, deps, index: tables.size });
    } else if ((m = insertRe.exec(stmt)) && m[1] !== 'sqlite_sequence' && tables.has(m[1])) {
      tables.get(m[1]).inserts.push(stmt);
    } else if (/^CREATE\s+(UNIQUE\s+)?INDEX|^CREATE\s+TRIGGER|^CREATE\s+VIEW/i.test(stmt)) tail.push(stmt);
    else after.push(stmt);
  }

  // Stable topological sort: parents before children, otherwise original order. Cycles keep original order.
  const ordered = [];
  const state = new Map();
  const visit = (name) => {
    if (state.get(name) === 'done' || state.get(name) === 'visiting') return;
    state.set(name, 'visiting');
    for (const d of tables.get(name).deps) if (tables.has(d)) visit(d);
    state.set(name, 'done');
    ordered.push(name);
  };
  [...tables.keys()].forEach(visit);

  const body = ordered.flatMap((n) => [tables.get(n).create, ...tables.get(n).inserts]);
  return [...head, ...body, ...after, ...tail].join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node scripts/order-d1-export.mjs <export.sql>');
    process.exit(2);
  }
  process.stdout.write(orderExport(readFileSync(file, 'utf8')));
}
