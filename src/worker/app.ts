import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { JWTVerifyGetKey } from 'jose';
import { authenticate } from './auth/middleware';
import type { AppEnv } from './env';
import { classifyError, errorResponse } from './errors';
import { activityRoutes } from './routes/activities';
import { adminRoutes } from './routes/admin';
import { backupRoutes } from './routes/backup';
import { bootstrapRoutes } from './routes/bootstrap';
import { entryRoutes } from './routes/entries';
import { exportRoutes } from './routes/export';
import { scheduleRoutes } from './routes/schedule';
import { sessionRoutes } from './routes/session';

/** Builds the Worker app. `getKey` overrides Access key lookup in tests only. */
export function createApp(opts: { getKey?: JWTVerifyGetKey } = {}) {
  const app = new Hono<AppEnv>();

  const api = new Hono<AppEnv>();
  api.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: 'same-origin',
      referrerPolicy: 'same-origin',
    }),
  );
  api.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  api.use('*', authenticate(opts.getKey));
  api.route('/', sessionRoutes);
  api.route('/', bootstrapRoutes);
  api.route('/', entryRoutes);
  api.route('/', scheduleRoutes);
  api.route('/', activityRoutes);
  api.route('/', adminRoutes);
  api.route('/', exportRoutes);
  api.route('/', backupRoutes);
  // Catch-all inside the sub-app so unknown /api paths get JSON (after auth), never the SPA's HTML.
  api.all('*', (c) => errorResponse(c, 404, 'not_found', 'No such API route.'));

  app.route('/api', api);

  // Only /api/* runs the Worker first (wrangler.jsonc). Anything else that reaches here goes to assets.
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  app.onError((err, c) => {
    const known = classifyError(err);
    if (known) {
      if (known.status >= 500) console.error(err);
      return errorResponse(c, known.status, known.code, known.message);
    }
    console.error(err);
    return errorResponse(c, 500, 'internal', 'Something went wrong. Please try again.');
  });

  return app;
}
