/* Track service worker (FR-SYNC-03, TECH-04).
 *
 * Built by the Vite plugin in vite.config.ts, which fills in the version and the precache list.
 * - App shell ("/", hashed assets, fonts, icons) is precached after the first signed-in load,
 *   so the installed app opens offline and when the Access session has expired (FR-AUTH-04).
 * - Navigations get the cached shell. A navigation with ?signin=… always goes to the network, so
 *   "Sign in again" reaches the Cloudflare Access login.
 * - /api is never cached here; the app keeps its own data cache.
 */
const VERSION = self.__TRACK_VERSION__;
const PRECACHE = self.__TRACK_PRECACHE__;
const CACHE = `track-shell-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `redirect: manual` with a check: never cache an Access login redirect as the shell.
      .then((cache) =>
        Promise.all(
          PRECACHE.map(async (url) => {
            const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
            if (!res.ok || res.redirected || res.type !== 'basic') throw new Error(`precache failed: ${url}`);
            await cache.put(url, res);
          }),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('track-shell-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // data is the app's business

  if (req.mode === 'navigate') {
    if (url.searchParams.has('signin')) return; // straight to the network and Access
    event.respondWith(caches.match('/', { cacheName: CACHE }).then((cached) => cached ?? fetch(req)));
    return;
  }

  event.respondWith(caches.match(url.pathname, { cacheName: CACHE }).then((cached) => cached ?? fetch(req)));
});
