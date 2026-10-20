import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;

// The Worker tests' database also has the fictional test family (test/fixtures/test-family.sql).
describe('seed migration (section 8)', () => {
  it('creates exactly the FR-ACT-01 activity types in order', async () => {
    const rows = await all<{ name: string; kind: string }>(
      'SELECT name, kind FROM activity_types ORDER BY sort_order',
    );
    expect(rows.map((r) => `${r.name}:${r.kind}`)).toEqual([
      'Overnight sleep:duration',
      'Nap:duration',
      'Cereal:point',
      'Formula:point',
      'Food:point',
      'Purée:point',
      'Bath:point',
      'Nursery:duration',
      'School:duration',
      'Club:duration',
      'Event:duration',
      'Poo:point',
      'Accident:point',
      'Medication:point',
      'Weight:point',
      'Height:point',
    ]);
  });

  it('marks the system types', async () => {
    const rows = await all<{ system_key: string }>(
      'SELECT system_key FROM activity_types WHERE system_key IS NOT NULL ORDER BY system_key',
    );
    expect(rows.map((r) => r.system_key)).toEqual([
      'accident',
      'height',
      'medication',
      'overnight_sleep',
      'poo',
      'weight',
    ]);
  });

  it('creates the seed fields', async () => {
    const rows = await all<{ t: string; key: string; field_type: string }>(
      `SELECT t.name AS t, f.key, f.field_type FROM activity_fields f JOIN activity_types t ON t.id = f.activity_type_id
       ORDER BY t.sort_order, f.sort_order`,
    );
    expect(rows.map((r) => `${r.t}.${r.key}:${r.field_type}`)).toEqual([
      'Cereal.variety:list',
      'Cereal.amount:number',
      'Formula.amount:number',
      'Food.what:text',
      'Purée.what:text',
      'Club.what:text',
      'Event.what:text',
      'Poo.colour:image_picker',
      'Poo.consistency:image_picker',
      'Accident.kind:list',
      'Accident.colour:image_picker',
      'Accident.consistency:image_picker',
      'Weight.weight:number',
      'Height.height:number',
    ]);
  });

  it('enforces one auto-confirmed entry per schedule item and day (TECH-07)', async () => {
    const ids = await all<{ child: string; type: string; item: string; user: string }>(
      `SELECT c.id AS child, i.activity_type_id AS type, i.id AS item, (SELECT id FROM users LIMIT 1) AS user
       FROM schedule_items i JOIN children c ON c.id = i.child_id LIMIT 1`,
    );
    const { child, type, item, user } = ids[0]!;
    const ins = (id: string) =>
      env.DB.prepare(
        `INSERT INTO entries (id, child_id, activity_type_id, start_utc, tz, local_date, schedule_item_id, auto_confirmed,
           created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, '2026-10-19T05:40:00Z', 'Europe/London', '2026-10-19', ?, 1, ?, ?, 'x', 'x')
         ON CONFLICT DO NOTHING`,
      ).bind(id, child, type, item, user, user);
    await env.DB.batch([ins('E1'), ins('E2')]);
    const count = await all<{ n: number }>(
      `SELECT count(*) AS n FROM entries WHERE schedule_item_id = '${item}'`,
    );
    expect(count[0]!.n).toBe(1);
  });
});
