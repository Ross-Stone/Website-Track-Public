import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { JWTVerifyGetKey } from 'jose';
import { roleAtLeast, type Role } from '../../shared/constants';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import type { AppEnv } from '../env';
import { errorResponse } from '../errors';
import { verifyAccessJwt } from './access';
import { resolveAuthMode } from './mode';

export const DEV_EMAIL_HEADER = 'x-dev-user-email';

/**
 * Short per-isolate cache of the user lookup, so the 10-minute version check usually reads just the one
 * sync_state row (FR-SYNC-02 AC1). A role change or deactivation takes effect within USER_CACHE_MS
 * (immediately in the isolate that made it). The Access JWT is still verified on every request.
 */
const USER_CACHE_MS = 60_000;
type CachedUser = {
  user: { id: string; email: string; displayName: string; role: Role; active: boolean } | null;
  at: number;
};
const userCache = new Map<string, CachedUser>();

export function clearUserCache() {
  userCache.clear();
}

/**
 * Authenticates every /api request, then loads the app user (FR-AUTH-02).
 * `getKey` is injectable for tests only.
 */
export function authenticate(getKey?: JWTVerifyGetKey) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const mode = resolveAuthMode(c.env, c.req.url);
    let email: string | null = null;

    if (mode.kind === 'misconfigured') {
      console.error(`auth misconfigured: ${mode.reason}`);
      return errorResponse(c, 500, 'server_misconfigured', 'Authentication is not configured correctly.');
    }
    if (mode.kind === 'access') {
      const token = c.req.header('cf-access-jwt-assertion');
      if (token) email = await verifyAccessJwt(token, mode, getKey);
    } else {
      email = (c.req.header(DEV_EMAIL_HEADER) ?? mode.defaultEmail ?? '').trim().toLowerCase() || null;
    }

    if (!email) return errorResponse(c, 401, 'unauthenticated', 'Sign in again.');

    let cached = userCache.get(email);
    if (!cached || Date.now() - cached.at > USER_CACHE_MS) {
      const row = await getDb(c.env.DB)
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          active: users.active,
        })
        .from(users)
        .where(eq(users.email, email))
        .get();
      cached = { user: row ?? null, at: Date.now() };
      userCache.set(email, cached);
    }
    const user = cached.user;
    if (!user || !user.active) {
      return errorResponse(
        c,
        403,
        'not_allowed',
        "You don't have access to Track. Ask your admin to add you.",
      );
    }

    c.set('authEmail', email);
    c.set('user', { id: user.id, email: user.email, displayName: user.displayName, role: user.role });
    await next();
  });
}

/** Route-level role check (FR-AUTH-03). reader < writer < admin. */
export function requireRole(required: Role) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!roleAtLeast(c.get('user').role, required)) {
      return errorResponse(c, 403, 'forbidden', 'Your role does not allow this.');
    }
    await next();
  });
}
