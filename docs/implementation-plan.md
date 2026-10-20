# Track: implementation notes

This file is short by design. The detail lives in `requirements.md` (what to build) and the code (how it looks). This file records how Track was built and the decisions that aren't obvious from those two.

## Approach

- **One Worker per environment, set up in one `wrangler.jsonc`.**
  - The top level is local development only: no routes, `workers_dev: false`, and no Access vars, which is what lets the dev stub work.
  - `env.production` is the Worker `track` on your custom domain (for example `track.example.com`), bound to D1 `track-prod`.
  - `env.preview` is the Worker `track-preview` on your preview domain (for example `track-preview.example.com`), bound to D1 `track-preview`.
  - Each environment sets `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ENVIRONMENT`, and turns off `workers_dev` and `preview_urls`.
- **Static assets.** Vite builds to `dist/client` and Wrangler serves it as assets, with SPA fallback (`not_found_handling: "single-page-application"`). `run_worker_first` covers `/api/*` only. Security headers for static files (strict CSP and so on) come from `public/_headers`. API responses set their own headers in Hono.
- **Auth.** `jose` `createRemoteJWKSet` checks the Access certs (cached per isolate), with issuer `https://<team>` and audience `ACCESS_AUD`. Middleware order: verify JWT, then load the user (lowercased email, active), then route-level `requireRole('reader' | 'writer' | 'admin')`. Error codes are `unauthenticated` (401), `not_allowed` (403, the FR-AUTH-02 screen) and `forbidden` (403).
- **Shared logic** goes in `src/shared` as pure functions that take `now: Date` and `tz: string`. The Worker uses the same planned-item generator for auto-confirm.
- **Client data.** A small store backed by IndexedDB holds the bootstrap data, the last 7 days of entries and the History days opened. The sync loop follows FR-SYNC-01/02: check `GET /api/version`, then refetch only if it changed. Writes are optimistic and use client-generated ULIDs, so retries are idempotent.
- **Seed (section 8).** `scripts/seed.ts` deterministically generates `migrations/0001_seed.sql` (the built-in activity types and fields only) with fixed ULIDs. The deploy workflows apply it once per database like any other migration. Nothing is hard-coded in the app.
- **First Admin.** `scripts/admin-sql.mjs` writes SQL that adds the `ADMIN_EMAIL` repository variable as an active Admin, only if the database has no active Admin, and bumps `sync_state.version` in the same file. The deploy workflows run it after the migrations, so it is safe on every deploy.
- **Test and demo data.** `scripts/fixtures.ts` (a fictional family: Alex, Jamie and Sam) generates `test/fixtures/test-family.sql`, which the Worker tests and the end-to-end server load on top of the migrations. `scripts/seed-demo.ts` loads demo data into a local database, and `scripts/screenshots.ts` uses it for `docs/screenshots/`.
- **History by local date.** The entries API takes UTC instants (section 7.11). History asks for the chosen day widened by ±14 h, then filters to entries whose `local_date` is that day. That way an entry logged abroad still shows on the day it started there (FR-HIST-03).
- **Running entries.** `GET /api/children/:id/entries` also returns running duration entries (`end_utc IS NULL`) when `running=1`, using the `(child_id, end_utc)` index. Home always shows them (FR-LOG-04 AC4).
- **Workflows.** Deploys only happen when the repository variable `DEPLOY_ENABLED` is `true` and the Cloudflare secrets exist. Every workflow defaults to `permissions: contents: read`.
  - `ci.yml` runs on every push and pull request: type-check, lint, formatting, unit and Worker tests, build, and the Playwright tests. No secrets.
  - `deploy-production.yml` runs on push to `main`: the Playwright tests, then `npm ci`, the checks, a check that `wrangler.jsonc` has no placeholders left, `wrangler d1 migrations apply track-prod --remote --env production`, the first-Admin SQL, then `wrangler deploy --env production`.
  - `deploy-preview.yml` runs on `pull_request` (opened, synchronize, reopened) from branches in the same repository: the same steps against `track-preview` and `--env preview`, then it creates or updates one sticky PR comment with the preview address from the `PREVIEW_URL` variable. Concurrency group `preview`.
  - `refresh-preview.yml` runs on `workflow_dispatch` with a typed confirmation. It runs `wrangler d1 export track-prod --remote` to a file (read-only on prod), drops every user table in `track-preview` (the table list comes from preview's own `sqlite_master`), reorders the export parents-first (`scripts/order-d1-export.mjs`), loads it with `wrangler d1 execute track-preview --remote --file`, then `wrangler d1 migrations apply track-preview --remote --env preview`. The only database names it writes to are hard-coded preview ones, and a guard step fails the job if the workflow mentions production anywhere other than the export.

## Build order

Track was built in seven steps, each one a pull request that deployed to preview:

1. **Scaffold.** Vite + React + TS, Hono Worker with assets, `wrangler.jsonc` (local, production, preview), Drizzle schema covering every table in section 7.10 with its indexes (including the partial unique index), the initial migration, the seed generator and seed migration, the Access JWT middleware, the dev stub with fail-closed tests, role middleware, `GET /api/me` and `GET /api/version`, the workflows, README, ESLint, Prettier and Vitest.
2. **Shared logic and tests.** Planned-item generation (days mask, fortnightly anchors, valid date ranges, overnight items, overrides), matching (nearest-first, one entry per item) and missed items, medication status (gap, rolling 24 h maximum, clearing at double the gap, doses before midnight), time zone and clock-change helpers, CSV flattening.
3. **API (TECH-11).** All routes, Zod validation, sync version bumps, idempotent `PUT /api/entries/:id`, auto-confirm with `ON CONFLICT DO NOTHING`, and the error envelope. Worker integration tests use `@cloudflare/vitest-plugin` against local D1.
4. **UI.** Tokens and the component library, then Home, History and Settings (every section in FR-SET-01), the log, planned, medication, entry and export sheets, theme handling, and the not-allowed screen.
5. **PWA.** Manifest and icons, the service worker (shell cache and the offline data store), the offline banner with disabled controls, the expired-session sheet, and pull-to-refresh.
6. **Export, backup, import, storage meter.**
7. **Playwright e2e** at Pixel 7 (Playwright's built-in profile) and Pixel 6a (a custom profile of about 411×914 CSS px, since Playwright has none), covering the TECH-12 list, plus axe on all three screens in both themes.

## Decisions

- **Q1 Overnight sleep.** One schedule item, for example 19:15–07:00. Home shows two rows from it: "Woke up" at the planned end (from yesterday's occurrence) and "Bedtime" at the planned start. "Woke up" is done when an overnight entry _ends_ within the detection window of its planned end (this extends FR-HOME-03, which only covers start times). Confirming "Woke up" ends the running overnight entry.
- **Q2 Note, Medicine, Dose** are the built-in `entries.note`, `medicine_id`, `dose` and `dose_unit` columns, not `activity_fields` rows. The type editor shows Note as a fixed row that can't be removed.
- **Q3 Icons.** Lucide icons are used for every activity (see `ACTIVITY_ICONS` in `src/shared/constants.ts`).
- **Q4 Accessibility deviations from the design.** All targets are at least 44px (Confirm, segmented controls, Undo, switch rows). The switch's off-track and text-field borders are darkened to at least 3:1. Text colours and the activity palette are unchanged, since they already pass AA in both themes.
- **Q5 Colours for undesigned types.** School amber, Club pink, Event teal, Accident brown, Height slate.
- **Q6** A dose can be logged before the next allowed time. The medication sheet shows a warning only.
- **Q7 Undesigned screens** are built from the design's components. Every timeline row is tappable. The quick-log row scrolls sideways. Dates and times use the phone's native pickers.
- **Q9 CPU limit.** The backup JSON is assembled by D1 in chunks. CSV is generated in the browser, with `/api/export.csv` kept for short ranges. Import is validated in the browser, uploaded in chunks to holding tables, then swapped in atomically by `POST /api/import`. This adds two import endpoints that section 7.11 doesn't list.
- **Q10** The first deploy creates the DNS records for both hostnames through Workers custom domains.
- **Q11** The API token needs the Edit Cloudflare Workers template, plus D1 Edit, Workers Routes Edit and DNS Edit. It needs no Access or Zero Trust permissions.

## Known limits

- **Free-plan CPU (10 ms per request)** is fine for every normal route. Building a multi-year JSON backup, parsing a large import, or a CSV covering a long date range in the Worker could exceed it. Mitigation in Q9 (above).
- **Table order in D1 exports.** D1 exports tables in creation order, and loading a child table before its parent fails even with foreign keys deferred. `0000_init.sql` creates tables in dependency order, and the refresh workflow also reorders each export to protect against future table rebuilds.
- **One preview environment.** All open PRs deploy to the same preview Worker and database, so whichever PR deployed last is the one live. A migration from a PR that is later abandoned stays in preview. Running _Refresh preview from production_ resets it.

## API details (build step 3)

- **Entries.** `PUT /api/entries/:id` checks values against the type's fields (`src/shared/values.ts`, also used by the log form), works out `local_date` from `start_utc` and `tz`, and fills the medicine dose and unit when they aren't given. Repeating an identical request writes nothing and doesn't bump the version. A deleted entry can't be overwritten (409); use restore instead. New entries of an archived type, or a type turned off for the child, are refused, but old ones stay editable.
- **Entry lists.** `GET …/entries?from&to` returns at most 35 days at a time. `running=1` also returns running _duration_ entries however old they are (FR-LOG-04 AC4).
- **Overrides.** `GET …/overrides` takes repeated `date=` parameters, because Home needs yesterday's as well as today's (yesterday's overnight sleep gives today's Woke up row). There is one override per item per day, so a move replaces a skip and keeps the first id.
- **Auto-confirm** covers today and yesterday. It uses the phone's `now` only up to the server clock plus 5 minutes. It never adds an auto entry when the family already logged that activity within the detection window. The insert uses `ON CONFLICT DO NOTHING` against the partial unique index, and the version only bumps if a row was actually inserted.
- **Database errors.** Constraint failures return 409. Any other D1 failure, such as a daily limit or an outage, returns 503 "Nothing was saved" (TECH-14).
- **FR-SYNC-02 AC1 (one row).** The auth user lookup is cached per isolate for 60 seconds and cleared on user changes. That keeps the 10-minute version check at one row read. A deactivation reaches other isolates within a minute.
- **CSV.** `GET /api/export.csv` handles up to 31 days. Step 6 builds longer ranges in the browser (Q9). Backup, import and storage endpoints arrive with their screens in step 6.

## UI details (build step 4)

- The client is React with a small router (`/`, `/history/:date?`, `/settings/*`) and a store with the sync loop (`src/client/state/store.ts`). Home's view model is a pure function (`src/client/state/home.ts`) and is unit-tested against the design's scenarios.
- Sheets use native `<dialog>`, so focus is trapped and Escape closes them. Timeline rows are real buttons; each one holds the time as visually hidden text so its accessible name matches what's visible (WCAG 2.5.3).
- The Next card only offers planned _starts_. During last night's running sleep, the running card's "Woke up" button covers waking, as in the design.
- Bootstrap also returns each child's latest Weight and Height (`latestMeasurements`), because Home only loads recent days (FR-CHILD-03).
- CSV export: up to 31 days comes from the server; longer ranges are built in the browser from the entries API with the same shared code (Q9).
- Read only users see Theme and About in Settings. Backup, import and the storage meter arrive in step 6. The offline banner, pull to refresh and the service worker arrive in step 5. Controls are already disabled while the browser reports being offline.
- Native date and time pickers follow the phone's language: 24-hour and dd/mm/yyyy on a UK phone (Q7).

## PWA details (build step 5)

- **Service worker.** A hand-written service worker (`src/client/sw/sw.js`) is generated at build time by a small Vite plugin that fills in the exact precache list. It precaches the shell (as `/`, because the assets server redirects `/index.html` to `/`), the hashed assets, fonts, the manifest and icons.
- **Navigations** get the cached shell, so the installed app opens offline and also when the Access session has expired. "Sign in again" adds `?signin=…`, which the worker always sends to the network so Access can show its login. The app removes the parameter when it comes back.
- **`/api`** is never cached by the worker. The app keeps its own copy in `localStorage` (`src/client/state/cache.ts`): settings, the last 7 days per child, the newest 30 opened History days and overrides. It is written 300 ms after changes, and straight away when the page is hidden or closed.
- **Offline detection.** The app counts as offline when the browser says so, or when a request gets no response. While offline it shows the banner and disables log, edit and settings controls, retries every minute while visible, and checks again on the `online` event.
- **Pull to refresh** on Home. The sync status ("Updated 09:52") is also a button that refreshes, so there is a single-tap alternative to the gesture (WCAG 2.5.1).
- **App updates .** A new service worker takes over straight away, but an app that is already open keeps running the old code, and the browser only looks for a new version when a page opens, which an installed app resumed from the background may not do for days. So the app asks the browser to check for a new version on every sync (at most once a minute): on opening, on returning to the foreground, every 10 minutes and on pull to refresh. When a new version takes over an open app, a banner says "A new version of Track is ready" with a **Refresh** button (`src/client/lib/update.ts`). The first install is not shown as an update.
- **Icons.** `scripts/icons.mjs` (`npm run icons:generate`) writes the mark to `public/icons/icon.svg` and renders the PNGs (192, 512, a maskable 512 and a 32 favicon) from it. The mark is a timeline on the dark theme's navy `#1E2A47`, with the middle row in the dark theme's "now" orange. Only `/manifest.webmanifest` and `/icons/*` are reachable without Access.
- **Manifest colours.** The manifest has no `theme_color`, and its `background_color` is the dark theme's navigation colour `#141821`. In the installed app on Android, Chrome paints the system navigation bar with the manifest colour (`theme_color`, or `background_color` without it) whatever the theme, while Android picks the button colour from the phone's dark mode setting. No single colour suits both: a light bar hid the buttons in dark mode, and the accent blue hid them in light mode (both found on a Pixel). The bar is dark, matching the app's dark bottom navigation; on a phone in light mode the bar's buttons are hard to see. The same colour is the launch-screen background. The status bar still follows the app's own theme through the live `theme-color` meta tags.

## Backup, import and storage details (build step 6)

- **Backup format.** `src/shared/backup.ts` defines it: `{ app: "track", schemaVersion, exportedAt, tables }`, where `tables` holds every row of every table as stored (snake_case columns, booleans as 0/1, JSON columns as JSON text), including soft-deleted entries. `sync_state` and the import staging table are left out. A Worker test checks the backup's columns match the database's, so a schema change can't silently drop data from backups.
- **Download (Q9).** D1 builds the JSON itself (`json_group_array(json_object(…))`), so the Worker only passes text through. `GET /api/backup?part=entries&after=<id>` returns 500 entries a page; `GET /api/backup?part=config` returns everything else and records `last_backup_at`. The app fetches the entry pages first and the rest last, so the configuration covers everything the entries refer to, then joins them into `track-backup-YYYY-MM-DD.json`. Writers and Admin only.
- **Import (Q9).** The app reads the file and validates it with the same shared code: it upgrades older schema versions step by step (`UPGRADES`, empty while the format is at version 1), refuses newer ones, and checks every row, every reference, every unique key, and that the person importing stays an active Admin (AC5). It then uploads each table in chunks of up to 1 MB: `POST /api/import/start`, then `PUT /api/import/:id/:table/:seq` for each chunk. `POST /api/import` (with `confirm: "REPLACE"` and the expected row counts) deletes and re-inserts every table in **one D1 batch**, so a failure anywhere changes nothing (AC4). D1 unpacks the chunks with `json_each`, and the database's own constraints (foreign keys, checks, unique keys) are the backstop. A guard statement in the batch rolls everything back unless the row counts match and the importer is still an active Admin. Staging holds one row per chunk rather than per backup row, to keep the rows written low.
- **After an import** the app drops its offline copies and reloads everything. Other phones pick up the change at their next version check.
- **Storage.** `GET /api/storage` (Admin) reads the database size from D1's query metadata (`size_after`) and compares it with `STORAGE_LIMIT_BYTES` (500 MB) in `src/shared/constants.ts`, warning at 80%. Each environment measures its own database, so preview shows the preview database.
- **Known limit: rows written by an import (TECH-14).** An import deletes every existing row and writes every backup row, and each entry also writes its index rows. That comes to roughly 10 rows written per entry when importing over similar data, or about 5 into an empty database. The free plan allows 100,000 rows written a day, so an import stops fitting in one day at around 10,000 entries (about 18 months at 20 entries a day), or about 20,000 into an empty database. Past that, the import fails safely and nothing changes. Ways round it, if it's ever needed: Workers Paid (50 million rows written a month), or D1 Time Travel for recent restores.

## End-to-end tests (build step 7)

Playwright runs at Pixel 7 (Playwright's built-in profile) and Pixel 6a (411 × 842 CSS px viewport on a 411 × 914 screen), one project after the other, against `wrangler dev` with a fresh local D1 and the dev auth stub. It runs in GitHub Actions on every push and PR (`ci.yml`), and before every production deploy, which waits for it to pass. The e2e job has no Cloudflare secrets.

| TECH-12 item                            | Test                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Quick log                               | `smoke.spec.ts` › Home loads … a quick log appears straight away                                      |
| Retrospective log                       | `flows.spec.ts` › retrospective log: pick an earlier time today; History "Add" on a past day          |
| Nap timer start and end                 | `flows.spec.ts` › start and end a nap, delete it and undo                                             |
| Confirm a planned item                  | `flows.spec.ts` › confirm, skip and undo planned items                                                |
| Skip an item                            | `flows.spec.ts` › confirm, skip and undo planned items                                                |
| History navigation and export           | `flows.spec.ts` › history: add on a past day, navigate, export                                        |
| Offline banner with greyed controls     | `pwa.spec.ts` › offline: opens from the cached shell …                                                |
| Read only user sees no edit controls    | `smoke.spec.ts` › a Read only user sees no logging controls; `backup.spec.ts` › a Writer can't import |
| axe on all three screens in both themes | `smoke.spec.ts` › all three screens pass axe in the light / dark theme                                |

axe also runs on every Settings page, both themes; on Home with a running timer, both themes; and on the log, planned, medication, entry, export and import sheets. The server loads the fictional test family (`test/fixtures/test-family.sql`) after the migrations. Tests create and clean up their own data, and the import test puts back exactly what it backed up, so the two device projects can share one database.
