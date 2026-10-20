// Small helpers for the generated SQL files (seed migration, test fixture, demo data).

/** Mulberry32: tiny deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A SQL expression written into the output as is (for example a subquery). */
export class RawSql {
  constructor(readonly sql: string) {}
}

export type SqlValue = string | number | boolean | null | undefined | RawSql;

export function lit(v: SqlValue): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof RawSql) return v.sql;
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  return `'${v.replaceAll("'", "''")}'`;
}

export function insert(table: string, row: Record<string, SqlValue>): string {
  const cols = Object.keys(row);
  return `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols
    .map((c) => lit(row[c]))
    .join(', ')});`;
}
