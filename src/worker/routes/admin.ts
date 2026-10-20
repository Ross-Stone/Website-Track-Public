import { eq, max } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { ChildCreate, ChildUpdate, UserCreate, UserUpdate } from '../../shared/api';
import { DEFAULT_WINDOW_MIN } from '../../shared/constants';
import { clearUserCache, requireRole } from '../auth/middleware';
import { getDb } from '../db/client';
import { toChild, toUser } from '../db/mappers';
import { activityTypes, childActivitySettings, children, users } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiException } from '../errors';
import { invalid, notFound, nowIso, parseBody } from '../lib/http';
import { bumpVersion } from '../lib/version';

export const adminRoutes = new Hono<AppEnv>()
  // POST /api/children (A): every activity type starts enabled for the new child.
  .post('/children', requireRole('admin'), async (c) => {
    const input = await parseBody(c, ChildCreate);
    const db = getDb(c.env.DB);
    const [[top], types] = await db.batch([
      db.select({ n: max(children.sortOrder) }).from(children),
      db.select({ id: activityTypes.id }).from(activityTypes),
    ]);
    const now = nowIso();
    const row = {
      id: ulid(),
      firstName: input.firstName,
      sortOrder: input.sortOrder ?? (top?.n ?? -1) + 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.batch([
      db.insert(children).values(row),
      ...types.map((t) =>
        db.insert(childActivitySettings).values({
          childId: row.id,
          activityTypeId: t.id,
          enabled: true,
          quickLog: false,
          defaults: '{}',
          windowBeforeMin: DEFAULT_WINDOW_MIN,
          windowAfterMin: DEFAULT_WINDOW_MIN,
          createdAt: now,
          updatedAt: now,
        }),
      ),
      bumpVersion(db),
    ]);
    return c.json({ child: toChild(row) }, 201);
  })

  // PUT /api/children/:id (A): rename, reorder, archive or restore (FR-CHILD-01).
  .put('/children/:id', requireRole('admin'), async (c) => {
    const input = await parseBody(c, ChildUpdate);
    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(children)
      .where(eq(children.id, c.req.param('id')))
      .get();
    if (!existing) notFound('Child');
    const now = nowIso();
    const { archived, ...rest } = input;
    const change = {
      ...rest,
      ...(archived === undefined ? {} : { archivedAt: archived ? (existing.archivedAt ?? now) : null }),
      updatedAt: now,
    };
    await db.batch([db.update(children).set(change).where(eq(children.id, existing.id)), bumpVersion(db)]);
    return c.json({ child: toChild({ ...existing, ...change }) });
  })

  // GET /api/users (A)
  .get('/users', requireRole('admin'), async (c) => {
    const rows = await getDb(c.env.DB).select().from(users).orderBy(users.displayName).all();
    return c.json({ users: rows.map(toUser) });
  })

  // POST /api/users (A). The email must also be added to the Access policy (FR-SET-02 AC2).
  .post('/users', requireRole('admin'), async (c) => {
    const input = await parseBody(c, UserCreate);
    const db = getDb(c.env.DB);
    const clash = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get();
    if (clash) throw new ApiException(409, 'conflict', 'A user with that email already exists.');
    const now = nowIso();
    const row = { id: ulid(), ...input, active: true, createdAt: now, updatedAt: now };
    await db.batch([db.insert(users).values(row), bumpVersion(db)]);
    clearUserCache();
    return c.json({ user: toUser(row) }, 201);
  })

  // PUT /api/users/:id (A): name, role, deactivate. Admin can't lock themselves out (FR-SET-02 AC1).
  .put('/users/:id', requireRole('admin'), async (c) => {
    const input = await parseBody(c, UserUpdate);
    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, c.req.param('id')))
      .get();
    if (!existing) notFound('User');
    if (existing.id === c.get('user').id) {
      if (input.role && input.role !== 'admin') invalid("You can't remove your own Admin role.");
      if (input.active === false) invalid("You can't deactivate yourself.");
    }
    const change = { ...input, updatedAt: nowIso() };
    await db.batch([db.update(users).set(change).where(eq(users.id, existing.id)), bumpVersion(db)]);
    clearUserCache();
    return c.json({ user: toUser({ ...existing, ...change }) });
  });
