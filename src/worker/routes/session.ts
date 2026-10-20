import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Me, Version } from '../../shared/api';
import { requireRole } from '../auth/middleware';
import { getDb } from '../db/client';
import { syncState } from '../db/schema';
import type { AppEnv } from '../env';

export const sessionRoutes = new Hono<AppEnv>()
  // GET /api/me (R): current user and role.
  .get('/me', requireRole('reader'), (c) => {
    const u = c.get('user');
    const me: Me = { id: u.id, email: u.email, displayName: u.displayName, role: u.role };
    return c.json(me);
  })
  // GET /api/version (R): one-row read for the cheap change check (FR-SYNC-02, TECH-09).
  .get('/version', requireRole('reader'), async (c) => {
    const row = await getDb(c.env.DB)
      .select({ version: syncState.version })
      .from(syncState)
      .where(eq(syncState.id, 1))
      .get();
    const body: Version = { version: row?.version ?? 0 };
    return c.json(body);
  });
