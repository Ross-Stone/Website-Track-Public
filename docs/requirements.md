# Track: Family Activity Tracker — Requirements

|||
|-|-|
|Product|Track|
|Address|Your own domain, for example https://track.example.com|
|Owner|The family's Admin|
|Status|Phase 1, built|
|Builder|Claude Code, from this document|

\---

## 1\. Overview

Track is a private Progressive Web App (PWA) that the parents use on their Android phones to log their child's day (sleep, feeds, food, medication, nappies, nursery and so on), see what is expected next from a weekly schedule, and know when the next dose of a medicine is allowed, using the gaps and limits they enter themselves.

Each family runs its own copy, on its own domain and Cloudflare account. The examples in this document use the parents Alex and Jamie and their child Sam, at track.example.com.

The app must keep working as the child grows from a baby to about 16 years old: the schedule, activity types and fields are all configurable so the family can stop tracking some things (for example poo), keep others (meals), and add new ones (school, clubs) over time. It supports more than one child.

Everything in this document is **Phase 1**. There is no later phase planned.

Visual design (colours, layout, components, icons beyond the rules in section 6) is defined separately in a design system. This document only fixes the functional behaviour, accessibility level and theme options.

\---

## 2\. Scope

### 2.1 In scope

* Three screens: Home (today), History (past days) and Settings.
* Logging entries now or retrospectively, editing and deleting them.
* Configurable activity types with configurable fields, icons and colours.
* Per-child weekly schedule with day pickers, date ranges and fortnightly repeats.
* Planned-versus-logged matching, missed items and auto-confirmed items.
* Medication timing with minimum gaps and rolling 24-hour maximums.
* Weight and height tracking, with the latest values shown next to the child's name.
* Multiple children, archived children.
* Users with Admin, Writer and Read only roles, authenticated by Cloudflare Access.
* CSV export, JSON backup and JSON import (replace all).
* Offline viewing of recently loaded data.
* Light, dark and system themes.
* Installable PWA on Android (Pixel 7 and Pixel 6a).

### 2.2 Out of scope

* iOS support and testing.
* Logging or editing entries while offline.
* Push notifications and reminders.
* One-off events such as parties or GP appointments (the family uses their calendar for these). Recurring events and clubs are in scope.
* Keeping a history of schedule changes. The schedule is only used to work out what is expected on a given day.
* Edit history (revisions) of entries. Entries record who created and who last edited them, nothing more.
* Milestones (first steps and so on).
* Purging old data. A storage meter is provided instead (FR-SET-12).
* Medical advice of any kind. The app records what the family enters and does simple time arithmetic on it.
* Languages other than UK English.

\---

## 3\. Definitions

|Term|Meaning|
|-|-|
|Activity type|A kind of thing that can be logged, such as Formula or Nap. Shared across all children.|
|Point activity|An activity type logged at a single moment (for example Bath, Poo).|
|Duration activity|An activity type with a start and an end (for example Nap, Nursery, Overnight sleep).|
|Entry|One logged occurrence of an activity type for one child.|
|Field|A configurable piece of data on an activity type, such as "Amount (ml)".|
|Schedule item|A recurring planned activity for one child, such as "Nursery 08:00–18:00, Monday to Friday".|
|Planned item|A schedule item as it applies to one specific day.|
|Day override|A change to one planned item on one day only: skip it or move its time.|
|Detection window|How long before and after a planned time a logged entry still counts as that planned item.|
|Auto-confirm|A schedule item setting that logs the entry automatically once its planned start has passed.|
|Local date|The calendar date in the phone's time zone when the entry started.|

\---

## 4\. Users and roles

|Role|Can do|
|-|-|
|**Admin**|Everything a Writer can, plus: manage users and roles, manage children, import a backup, view the storage meter. Usually one Admin, set when the app is first deployed.|
|**Writer**|View everything; create, edit and delete entries; edit the schedule, day overrides, activity types, fields, medicines and child activity settings; export CSV; download a JSON backup.|
|**Read only**|View Home and History, export CSV. Cannot log, edit or change any setting. All logging and editing controls are hidden.|

Initial users: the first Admin is created from the deploy-time `ADMIN_EMAIL` setting (see section 8). The Admin then adds everyone else in Settings › Users. For example, Alex (Admin) adds Jamie as a Writer and a grandparent as Read only.

\---

## 5\. Functional requirements

Each requirement has an ID and acceptance criteria (AC). "User" means a signed-in user with a role that allows the action.

### 5.1 Authentication and access (AUTH)

**FR-AUTH-01 Cloudflare Access sign-in.** All app pages and all API routes sit behind a Cloudflare Access application. Sign-in methods are Google and one-time email PIN. The Access session length is one month.

* AC1: An unauthenticated visitor to the app's address (for example track.example.com) is sent to the Cloudflare Access login.
* AC2: After signing in, the user is not asked to sign in again for one month on that device.
* AC3: Only the manifest and app icons are reachable without Access (see TECH-04), so the PWA can be installed.

**FR-AUTH-02 App allow-list.** Passing Cloudflare Access is not enough. The user's email must also exist, active, in the app's user list.

* AC1: A user who passes Access but whose email is not in the user list sees a "You don't have access to Track. Ask your admin to add you." screen and no data.
* AC2: Email matching is case-insensitive.

**FR-AUTH-03 Role enforcement.** Each API call is checked against the role in section 4, on the server.

* AC1: A Read only user calling any write endpoint gets HTTP 403 and nothing changes.
* AC2: A Writer calling an Admin-only endpoint gets HTTP 403.
* AC3: Controls a user's role can't use are hidden in the UI.

**FR-AUTH-04 Expired session.** When the Access session expires while the PWA is open or launched from its cached shell, the app detects that API calls are no longer authenticated.

* AC1: The app shows a "Sign in again" message with a button that reloads the page through Access.
* AC2: Cached data stays visible behind the message.

### 5.2 Children (CHILD)

**FR-CHILD-01 Child profile.** A child has a first name only. Admin can add, rename, reorder and archive children.

* AC1: An archived child no longer appears in the child switcher, but their entries remain in exports and backups.
* AC2: An archived child can be restored by Admin.

**FR-CHILD-02 Child switcher.** Home and History show one child at a time. A switcher icon appears beside the child's name only when there is more than one active child.

* AC1: With one active child, no switcher is shown.
* AC2: The last selected child is remembered on the device.

**FR-CHILD-03 Header stats.** Next to the child's name, Home shows the latest weight and height, taken from the most recent Weight and Height entries.

* AC1: Logging a new Weight entry updates the header immediately.
* AC2: If there is no Weight or Height entry, that value is not shown.
* AC3: Weight shows in kg to 2 decimal places, height in cm to 1 decimal place.

### 5.3 Activity types and fields (ACT)

**FR-ACT-01 Built-in activity types.** The app is seeded with these activity types, all editable and archivable unless marked "system":

|Activity|Kind|Seed fields|Notes|
|-|-|-|-|
|Overnight sleep|Duration|Note|System. Start is "Bedtime", end is "Woke up". Replaces separate Wake and Bed events.|
|Nap|Duration|Note|Tap to start, tap to end (FR-LOG-04).|
|Cereal|Point|Variety (list), Amount (number, scoops), Note||
|Formula|Point|Amount (number, ml), Note||
|Food|Point|What (text), Note||
|Purée|Point|What (text), Note||
|Bath|Point|Note||
|Nursery|Duration|Note|Usually auto-confirmed.|
|School|Duration|Note|Usually auto-confirmed.|
|Club|Duration|What (text), Note||
|Event|Duration|What (text), Note|Recurring events only.|
|Poo|Point|Colour (image picker), Consistency (image picker), Note|Pickers optional.|
|Accident|Point|Kind (list: Wet, Dirty, Both), Colour, Consistency (image pickers, shown when Dirty or Both), Note||
|Medication|Point|Medicine, Dose (from medicine settings), Note|System. See 5.7.|
|Weight|Point|Weight (number, kg)|System. Logged from "Other".|
|Height|Point|Height (number, cm)|System. Logged from "Other".|

* AC1: A fresh install contains exactly these types and fields.
* AC2: System types cannot be deleted or have their kind changed; they can be renamed and archived.

**FR-ACT-02 Custom activity types.** A Writer can create a new activity type with a name, kind (point or duration), icon, colour and fields.

* AC1: A new type is immediately available to log for every child it is enabled for.

**FR-ACT-03 Icons and colours.** Each activity type has one icon chosen from the built-in outline icon set (TECH-01) and one colour chosen from a fixed palette of about 10 colours.

* AC1: Users cannot upload icons or enter arbitrary colours.
* AC2: Every palette colour meets WCAG 2.2 AA contrast in both light and dark themes (NFR-02).

**FR-ACT-04 Field types.** Fields can be one of:

|Type|Options|
|-|-|
|Number|Unit label (for example ml, scoops, kg), decimal places, optional min and max|
|Short text|Max length|
|List|Options defined by the user (for example cereal varieties)|
|Yes/no||
|Image picker|Chooses from a built-in option set (stool colour, stool consistency)|

* AC1: A Writer can add, rename, reorder and archive fields on any type.
* AC2: Archiving a field hides it when logging but keeps existing values in History, exports and backups.
* AC3: All fields are optional unless marked required.

**FR-ACT-05 Archiving activity types.** Archiving a type stops it being logged or scheduled.

* AC1: An archived type disappears from quick log, "Other" and schedule pickers.
* AC2: Existing entries of an archived type still show in History and in exports.
* AC3: An archived type can be restored.

**FR-ACT-06 Per-child activity settings.** Activity types are shared across children. For each child and type, a Writer sets:

* Enabled for this child (yes/no).
* Quick log favourite (yes/no).
* Default field values (for example Formula 210 ml).
* Detection window: minutes before and minutes after (default 120 and 120).
* AC1: A type disabled for a child does not appear anywhere in that child's logging or schedule options.
* AC2: When logging, fields are pre-filled with that child's defaults and can be changed.

**FR-ACT-07 Stool option sets.** The built-in image pickers are:

* Colour: Yellow, Mustard, Orange, Green, Brown, Black, Red or red streaks, White or pale grey.
* Consistency: Watery, Runny, Soft, Formed, Hard pellets.
* AC1: Each option shows a simple illustration and a text label (the label is needed for accessibility).
* AC2: The app gives no interpretation or advice about any option.

### 5.4 Logging (LOG)

**FR-LOG-01 Log an entry.** From Home (quick log, "Other" or a planned item) or History, a Writer can log an entry for the selected child.

* AC1: The log form shows the activity's fields with that child's defaults filled in.
* AC2: The time defaults to "Now". The user can instead pick a date and time, to log retrospectively.
* AC3: For duration activities, the user can choose "Start now" (creates a running entry, FR-LOG-04) or enter both a start and an end.
* AC4: Every entry has an optional free-text note.
* AC5: The entry appears on Home (if today) straight away, without waiting for the next sync.

**FR-LOG-02 Quick log.** Home shows quick log buttons for: the child's favourites, the next expected planned item, and an "Other" button that opens the full list of enabled, non-archived activity types.

* AC1: Tapping a quick log button for an activity with no fields, or only optional fields with defaults, opens the form with "Now" selected so it can be saved in one more tap.
* AC2: Weight and Height are only in "Other" unless made a favourite.

**FR-LOG-03 Confirm a planned item.** On an upcoming or missed planned item, a Writer can choose "Done now" or "Done at planned time".

* AC1: "Done now" logs the entry with the current time.
* AC2: "Done at planned time" logs it with the planned start (and planned end for duration items).
* AC3: Either option opens the form first if the activity has required fields without defaults.

**FR-LOG-04 Running timers.** A duration entry started with "Start now" has no end time until ended.

* AC1: Home shows each running entry with a live elapsed timer (for example "Nap · 0 h 42 m") and an "End" button.
* AC2: "End" sets the end time to now. The user can adjust it afterwards.
* AC3: Overnight sleep is started with "Bedtime" and ended with "Woke up".
* AC4: A running entry that started yesterday (overnight sleep) still shows on today's Home until ended.

**FR-LOG-05 Edit an entry.** A Writer can edit any field, time, note or the activity type of any entry, from Home or History.

* AC1: The entry records who last edited it and when.
* AC2: Changes are visible on the other phone after its next sync.

**FR-LOG-06 Delete an entry.** A Writer can delete an entry.

* AC1: Deleting asks for confirmation, then shows an "Undo" option for at least 5 seconds.
* AC2: Deleted entries are excluded from Home, History, matching, medication calculations and exports.
* AC3: Deleted entries are kept in the database as soft-deleted, and included in the JSON backup with their deleted flag.

**FR-LOG-07 Who logged it.** Every entry records the user who created it and the user who last edited it.

* AC1: Entry details show "Logged by Jamie at 08:12" and, if edited, "Edited by Alex at 09:30".

**FR-LOG-08 Auto-confirm.** Schedule items with auto-confirm on are logged automatically.

* AC1: When the app loads or syncs after an auto-confirmed item's planned start on a given day, it creates an entry with the planned start and end, marked "Auto".
* AC2: It is never created twice, even if both phones sync at the same time (TECH-07).
* AC3: It is not created if the item was skipped for that day.
* AC4: If the item was moved for that day, the moved times are used.
* AC5: An auto entry can be edited or deleted like any other.

### 5.5 Schedule (SCHED)

**FR-SCHED-01 Schedule items.** In Settings, a Writer can create schedule items for each child. Each item has:

* Activity type.
* Planned start time, and planned end time for duration activities or where a range is useful (for example Nap 09:45–11:15).
* Days of the week (day picker, Monday to Sunday, any combination; "Every day" and "Monday to Friday" shortcuts).
* Repeat: weekly or every 2 weeks (with a starting week).
* Optional start date and end date (for example term dates).
* Auto-confirm (yes/no).
* Optional label (for example "Football club") and note.
* AC1: An item only appears on days that match its days, repeat and date range.
* AC2: An overnight item can end after midnight (for example Overnight sleep 19:15–07:00).
* AC3: Changing the schedule only affects how planned items are worked out from then on. No history of the schedule is kept.

**FR-SCHED-02 Term times.** Term times are entered as schedule items with a start and end date and Monday to Friday.

* AC1: A Writer can duplicate a schedule item, so a new term can be added by duplicating last term's item and changing the dates.
* AC2: Several items for the same activity with different date ranges can exist side by side.

**FR-SCHED-03 Day overrides.** From Home (today) a Writer can, for one planned item on that day only:

* Skip it, or
* Move it to a different start (and end) time.
* AC1: The override applies only to that child, that item and that date.
* AC2: A skipped item is no longer shown as upcoming or missed.
* AC3: An override can be undone the same day.
* AC4: Overrides appear on the other phone after its next sync.

**FR-SCHED-04 Time zones.** Planned times are clock times applied in the phone's current time zone.

* AC1: A 07:00 wake planned item shows at 07:00 abroad when the phone is set to the local time there (for example Europe/Madrid).

### 5.6 Home screen (HOME)

**FR-HOME-01 Today only.** Home shows the selected child's today, where today is the phone's current local date.

**FR-HOME-02 Contents.** Home shows, in an order set by the design:

1. Header: child name, switcher (FR-CHILD-02), latest weight and height (FR-CHILD-03).
2. Sync status: "Last updated HH:MM", and an offline banner when offline (FR-SYNC-03).
3. Running timers (FR-LOG-04).
4. Medication status, when any applies (FR-MED-03).
5. Upcoming planned items.
6. Today's logged entries (past activities).
7. Quick log buttons (FR-LOG-02).

**FR-HOME-03 Matching planned items to entries.** A planned item counts as done when a non-deleted entry of the same activity type for the same child starts within that type's detection window around the planned start.

* AC1: Each entry can satisfy at most one planned item; it is matched to the nearest planned item in time.
* AC2: A done planned item is not shown in upcoming; the entry shows in today's logged entries.

**FR-HOME-04 Missed items.** A planned item whose planned start plus the "after" detection window has passed, with no matching entry and no skip, is shown as missed.

* AC1: Missed items are shown subtly (greyed, not alarming) and can still be confirmed (FR-LOG-03).

**FR-HOME-05 Refresh.** Pulling down on Home refreshes it (FR-SYNC-01).

### 5.7 Medication (MED)

**FR-MED-01 Medicines per child.** In Settings, a Writer manages medicines for each child. Each medicine has: name, dose, dose unit (default ml), minimum gap between doses (hours and minutes), maximum doses in any rolling 24 hours, "counts towards alternating" (yes/no), and archived (yes/no).

* AC1: Archived medicines can't be chosen when logging but stay in History and exports.

**FR-MED-02 Logging a dose.** Logging Medication means choosing a medicine. The dose is filled in from the medicine's settings and can be changed for that entry.

* AC1: The entry stores the dose and unit actually given, so later changes to the medicine's settings don't change past entries.

**FR-MED-03 Medication status on Home.** For each medicine with a dose in the last 24 hours:

* Next allowed time = the later of (last dose + minimum gap) and, if the rolling 24-hour maximum has been reached, (oldest dose in that 24 hours + 24 hours).
* Before the next allowed time, show "Next \[medicine] from HH:MM" and time since last dose.
* From the next allowed time until double the minimum gap after the last dose, show "\[medicine] OK now".
* After double the minimum gap (and not blocked by the 24-hour maximum), stop showing that medicine.
* AC1: Medicine A given at 08:10 with a 4-hour gap shows "Next Medicine A from 12:10" until 12:10, "Medicine A OK now" from 12:10 to 16:10, and nothing after 16:10.
* AC2: The calculation uses a rolling 24 hours, not the calendar day, so a 23:00 dose still counts after midnight.
* AC3: If the 24-hour maximum is reached, the next allowed time reflects it even if the minimum gap has passed.
* AC4: The medication section is hidden when no medicine has a status to show.

**FR-MED-04 Alternating medicines.** If any medicine marked "counts towards alternating" has a status showing, Home also shows "Last alternating dose: \[medicine] at HH:MM (\[time] ago)".

**FR-MED-05 No advice.** The app does not suggest doses, gaps or limits. All values come from Settings, entered by the family.

### 5.8 History (HIST)

**FR-HIST-01 Day view.** History shows the selected child's logged entries for one day, in time order. It does not show the schedule.

* AC1: Previous and Next buttons move one day at a time.
* AC2: A calendar picker jumps to any date.
* AC3: A "Today" button returns to today.

**FR-HIST-02 Edit from History.** A Writer can add, edit and delete entries on any day from History (FR-LOG-01, -05, -06).

* AC1: "Add" on a past day defaults the date to that day.

**FR-HIST-03 Entries across midnight.** Duration entries show on the day they started, with their end time (for example Overnight sleep 19:18–06:50).

**FR-HIST-04 CSV export.** History has an Export button. The user picks a start date and end date (and child, defaulting to the selected child, with an "All children" option) and downloads a CSV.

* AC1: One row per non-deleted entry. Deleted entries are left out.
* AC2: Columns: Child, Date (dd/mm/yyyy), Start time, End time, Duration (minutes), Time zone, Activity, Medicine, Dose, Dose unit, then one column per field present in the exported entries (header "Activity – Field (unit)"), Note, Logged by, Logged at, Last edited by, Last edited at, Auto.
* AC3: The file name is `track-export-YYYY-MM-DD-to-YYYY-MM-DD.csv`.
* AC4: The CSV opens correctly in Excel and Google Sheets, including names with accents (UTF-8 with BOM).

### 5.9 Settings (SET)

**FR-SET-01 Sections.** Settings contains: Children (Admin), Users (Admin), Schedule, Activity types and fields, Child activity settings, Medicines, Theme, Backup and import, Storage (Admin), About (app version).

**FR-SET-02 Users.** Admin can add a user by typing their email and choosing a role, change a role, and deactivate a user.

* AC1: Admin cannot remove or downgrade their own Admin role (prevents lock-out).
* AC2: The Users screen reminds Admin that the email must also be added to the Cloudflare Access policy.

**FR-SET-03 Theme.** A theme setting with three options: System (default), Light, Dark.

* AC1: System follows the phone's dark mode setting and changes when it changes.
* AC2: The choice is stored on the device only; each phone has its own setting.

**FR-SET-10 JSON backup.** A Writer or Admin can download a full JSON backup of all data: users, children, activity types, fields, child activity settings, schedule items, day overrides, medicines, entries (including soft-deleted), app settings.

* AC1: The file includes a schema version and export timestamp.
* AC2: The file name is `track-backup-YYYY-MM-DD.json`.
* AC3: Settings shows "Last backup: N days ago" (or "Never").

**FR-SET-11 Import.** Admin can import a JSON backup, which replaces all data.

* AC1: Import shows a warning and requires typing "REPLACE" to confirm.
* AC2: A file with a newer schema version than the app supports is rejected. An older one is upgraded.
* AC3: Invalid files are rejected with a clear message and nothing is changed.
* AC4: Import is all or nothing.
* AC5: After import, the importing Admin must still exist as Admin; otherwise the import is rejected.

**FR-SET-12 Storage meter.** Admin sees the production database size against the free-plan maximum database size (500 MB), as a bar and a percentage.

* AC1: A warning shows at 80% of the limit (400 MB).
* AC2: The limit is a configuration constant, so it can be changed if Cloudflare's limit changes or the account moves to the paid plan.
* AC3: The meter measures this database only. The 5 GB shown in the Cloudflare dashboard is the account total, shared with other databases (TECH-14).

### 5.10 Sync and offline (SYNC)

**FR-SYNC-01 When the app checks for changes.** The app checks for changes only while it is open and visible:

* once when it opens,
* when it returns to the foreground,
* every 10 minutes while visible,
* when the user pulls down to refresh on Home.
* AC1: No checks happen while the app is in the background or closed.

**FR-SYNC-02 Cheap change check.** Each check first asks the server for the current change version (one-row read). Data is only fetched when the version differs from the one the phone has.

* AC1: An unchanged check reads one database row.

**FR-SYNC-03 Offline viewing.** The installed PWA works offline for viewing.

* AC1: The app shell is cached so the app opens offline.
* AC2: The last 7 days of entries, plus any days opened in History, plus settings, are cached on the device.
* AC3: Offline, a banner shows "Offline · last updated HH:MM".
* AC4: Offline, all log, edit, delete and settings controls are greyed out and not usable.
* AC5: Back online, the app checks for changes automatically.

**FR-SYNC-04 Write failures.** If a save fails (for example connection lost mid-save), the app keeps the form open, shows an error, and lets the user retry without creating a duplicate (TECH-06).

### 5.11 Formats (FMT)

**FR-FMT-01 UK formats.** UK English throughout; 24-hour clock (HH:MM); dates as dd/mm/yyyy (or "Sat 18 Oct" where space is short); Monday as the first day of the week; metric units (ml, kg, cm).

\---

## 6\. Non-functional requirements

**NFR-01 Devices.** The app is designed for, and must display well on, a Pixel 7 and a Pixel 6a in portrait, in Chrome on Android, installed as a PWA. It must remain usable at larger system font sizes. Desktop browsers should work but are not a design target. iOS is not supported.

**NFR-02 Accessibility.** The app meets WCAG 2.2 level AA, in both light and dark themes. In particular: colour contrast, touch targets of at least 24×24 CSS px (aim for 44×44), meaning never conveyed by colour or icon alone (activity types always have a text label), visible focus, labelled form controls, and image picker options with text labels.

**NFR-03 PWA.** Installable from Chrome on Android with a name, icons, theme colour and standalone display. Opens to Home.

**NFR-04 Performance.** On a 4G connection, Home is usable within 2 seconds of opening from the home screen, and a save completes within 1 second in normal conditions.

**NFR-05 Free tier.** The app runs within Cloudflare's free plan for Workers and D1 under normal family use, with headroom. The sync design (FR-SYNC-01, -02) and database indexes are chosen to keep rows read low.

**NFR-06 Security and privacy.** All data and all API routes are behind Cloudflare Access and the app's own role check. No third-party scripts, analytics, trackers or fonts loaded from other domains. A strict Content Security Policy is set. Data stays in Cloudflare.

**NFR-07 Longevity.** The data model must support about 15 years of use without structural change: custom activity types and fields, multiple children, and schema-versioned backups.

**NFR-08 Time zones.** All times are correct across UK clock changes and when travelling (for example abroad on holiday).

\---

## 7\. Technical design

This section records the agreed technical decisions. Claude Code should follow them unless something proves unworkable, in which case it should raise it rather than silently change approach.

### 7.1 Stack (TECH-01)

|Area|Choice|
|-|-|
|Language|TypeScript throughout|
|Frontend|React with Vite, built as a PWA (service worker and web manifest)|
|Hosting|Cloudflare Workers with static assets (one Worker serves the app and the API)|
|API framework|Hono|
|Validation|Zod schemas shared between frontend and API|
|Database|Cloudflare D1|
|Database access|Drizzle ORM, with migrations applied through Wrangler|
|Icons|Lucide (outline icons, open source)|
|Unit tests|Vitest|
|End-to-end tests|Playwright, at Pixel 7 and Pixel 6a viewports|
|Source control|A private GitHub repository per family|
|Deployment|GitHub Actions deploys `main` to production with Wrangler|

### 7.2 Architecture (TECH-02)

* One Worker on the family's own domain (for example `track.example.com`) serves the built frontend as static assets and the API under `/api`.
* The frontend is a single-page app with three routes: `/` (Home), `/history/:date?`, `/settings/\*`.
* Medication status, planned-item matching and missed-item logic run in the frontend from data the API returns, using shared, unit-tested functions.

### 7.3 Environments (TECH-03)

* **Production**: the family's address (for example `track.example.com`), its own D1 database.
* **Preview**: a separate Worker and separate D1 database, behind its own Access application, for testing. Never touches production data.

### 7.4 Cloudflare Access and PWA install (TECH-04)

* An Access application covers the production address (for example `track.example.com/\*`), allowing the users' emails, with Google and one-time PIN login methods and a one-month session duration.
* A bypass policy covers only `/manifest.webmanifest` and `/icons/\*`, so Chrome can fetch them for installation. Everything else, including the HTML, JavaScript and the service worker script, stays behind Access.
* The service worker caches the shell after the first signed-in load, so the installed app opens offline.
* When an API call returns an Access redirect or 401/403 from Access instead of JSON, the app shows the "Sign in again" state (FR-AUTH-04).

### 7.5 Authentication in the Worker (TECH-05)

* Every `/api` request verifies the `Cf-Access-Jwt-Assertion` JWT against the Access team's public keys and the application's audience tag. The email header alone is never trusted.
* The verified email is looked up (lowercased) in `users`. Missing or inactive users get 403 with a code the frontend uses for the FR-AUTH-02 screen.
* Role checks are middleware on each route.

### 7.6 IDs and idempotency (TECH-06)

* Entry IDs are ULIDs created on the phone before saving.
* Creating an entry is `PUT /api/entries/:id`. Repeating the same request (a retry or double-tap) does not create a second entry.

### 7.7 Auto-confirm without duplicates (TECH-07)

* Auto-confirmed entries carry `schedule\_item\_id` and `local\_date`, with a unique index on (`schedule\_item\_id`, `local\_date`) where `auto\_confirmed = 1`.
* The phone calls `POST /api/children/:id/auto-confirm` with its local date, time zone and current time on load and sync. The server inserts any due auto entries with `INSERT … ON CONFLICT DO NOTHING`.

### 7.8 Time handling (TECH-08)

* Each entry stores `start\_utc`, `end\_utc` (nullable), `tz` (IANA name, for example `Europe/Madrid`) and `local\_date` (YYYY-MM-DD in `tz` at the start).
* Entries display in the time zone they were logged in. Today on Home is the phone's current local date.
* Schedule items store plain clock times (`HH:MM`), applied in the phone's current time zone.
* Use the browser's `Intl` APIs for time zones; no hard-coded offsets.

### 7.9 Sync (TECH-09)

* A single-row `sync\_state` table holds a `version` integer, incremented in the same batch as every write.
* `GET /api/version` returns it. The phone compares it with its stored version and only then refetches.

### 7.10 Data model (TECH-10)

All tables have `created\_at` and `updated\_at` (UTC ISO strings) unless noted. IDs are ULIDs (text).

**users**: `id`, `email` (unique, lowercase), `display\_name`, `role` (`admin` | `writer` | `reader`), `active` (bool).

**children**: `id`, `first\_name`, `sort\_order`, `archived\_at` (nullable).

**activity\_types**: `id`, `system\_key` (nullable; `overnight\_sleep`, `medication`, `weight`, `height`, `poo`, `accident` for built-ins with special behaviour), `name`, `kind` (`point` | `duration`), `icon` (Lucide icon name), `colour` (palette token), `sort\_order`, `archived\_at`.

**activity\_fields**: `id`, `activity\_type\_id`, `key` (stable, used in entry values), `label`, `field\_type` (`number` | `text` | `list` | `boolean` | `image\_picker`), `unit`, `decimals`, `min`, `max`, `max\_length`, `options` (JSON array for lists), `picker\_set` (`stool\_colour` | `stool\_consistency`), `show\_when` (JSON, nullable; for example show colour only when Kind is Dirty or Both), `required` (bool), `sort\_order`, `archived\_at`.

**child\_activity\_settings**: `child\_id`, `activity\_type\_id` (composite key), `enabled` (bool), `quick\_log` (bool), `defaults` (JSON keyed by field key), `window\_before\_min` (default 120), `window\_after\_min` (default 120).

**schedule\_items**: `id`, `child\_id`, `activity\_type\_id`, `label`, `start\_time` (`HH:MM`), `end\_time` (`HH:MM`, nullable), `days\_mask` (integer, bit 0 = Monday … bit 6 = Sunday), `repeat` (`weekly` | `fortnightly`), `anchor\_date` (for fortnightly), `valid\_from` (date, nullable), `valid\_until` (date, nullable), `auto\_confirm` (bool), `note`, `archived\_at`.

**schedule\_overrides**: `id`, `child\_id`, `schedule\_item\_id`, `local\_date`, `action` (`skip` | `move`), `new\_start\_time`, `new\_end\_time`, `created\_by`. Unique on (`schedule\_item\_id`, `local\_date`).

**medicines**: `id`, `child\_id`, `name`, `dose` (number), `dose\_unit`, `min\_gap\_min`, `max\_per\_24h`, `counts\_towards\_alternating` (bool), `sort\_order`, `archived\_at`.

**entries**: `id`, `child\_id`, `activity\_type\_id`, `start\_utc`, `end\_utc` (nullable; null = running for duration types), `tz`, `local\_date`, `values` (JSON keyed by field key), `medicine\_id` (nullable), `dose`, `dose\_unit`, `note`, `schedule\_item\_id` (nullable), `auto\_confirmed` (bool), `created\_by`, `updated\_by`, `deleted\_at` (nullable), `deleted\_by`.
Indexes: (`child\_id`, `local\_date`), (`child\_id`, `activity\_type\_id`, `start\_utc`), (`child\_id`, `end\_utc`) for running entries, unique partial (`schedule\_item\_id`, `local\_date`) where `auto\_confirmed = 1`.

**app\_settings**: `key`, `value` (for example `last\_backup\_at`).

**sync\_state**: `id` (always 1), `version` (integer).

### 7.11 API outline (TECH-11)

All routes are JSON under `/api`. Roles: R = Read only and above, W = Writer and above, A = Admin.

|Method and path|Role|Purpose|
|-|-|-|
|GET `/api/me`|R|Current user and role|
|GET `/api/version`|R|Current sync version|
|GET `/api/bootstrap`|R|All configuration in one call: children, activity types, fields, child activity settings, schedule items, medicines, app settings, version|
|GET `/api/children/:id/entries?from=\&to=`|R|Entries for a child between two UTC instants (Home loads the last 48 hours; History loads a day)|
|GET `/api/children/:id/overrides?date=`|R|Day overrides for a date|
|PUT `/api/entries/:id`|W|Create or update an entry (idempotent)|
|DELETE `/api/entries/:id`|W|Soft delete|
|POST `/api/entries/:id/restore`|W|Undo delete|
|POST `/api/children/:id/auto-confirm`|W|Create due auto-confirmed entries for a date and time zone|
|PUT / DELETE `/api/schedule-overrides/:id`|W|Skip or move a planned item for one day; undo|
|GET / POST / PUT / DELETE `/api/schedule-items\[/:id]`|W|Manage schedule items (DELETE archives)|
|POST `/api/schedule-items/:id/duplicate`|W|Duplicate (for new terms)|
|POST / PUT `/api/activity-types\[/:id]`|W|Manage activity types|
|POST / PUT `/api/activity-types/:id/fields\[/:fieldId]`|W|Manage fields|
|PUT `/api/children/:id/activity-settings/:typeId`|W|Per-child activity settings|
|POST / PUT `/api/medicines\[/:id]`|W|Manage medicines|
|POST / PUT `/api/children\[/:id]`|A|Manage children|
|GET / POST / PUT `/api/users\[/:id]`|A|Manage users|
|GET `/api/export.csv?from=\&to=\&child=`|R|CSV export (dates are local dates)|
|GET `/api/backup`|W|JSON backup; updates `last\_backup\_at`|
|POST `/api/import`|A|Replace all data from a JSON backup|
|GET `/api/storage`|A|Database size and limit (D1 reports size in query metadata)|

Errors return `{ "error": { "code": "...", "message": "..." } }` with the appropriate HTTP status. Every write increments the sync version.

### 7.12 Testing (TECH-12)

* Unit tests (Vitest) must cover: medication status (including rolling 24 hours, the maximum, double-gap clearing, doses before midnight), planned item generation (days, fortnightly, date ranges, overnight items, overrides), matching and missed logic, time zone and clock-change handling, CSV flattening.
* End-to-end tests (Playwright) at Pixel 7 and Pixel 6a viewports must cover: quick log, retrospective log, nap timer start and end, confirm a planned item, skip an item, History navigation and export, offline banner with greyed controls, Read only user sees no edit controls.
* Automated accessibility checks (axe) run on all three screens in both themes.

### 7.13 Repository (TECH-13)

* A GitHub repository per family. README covers setup, local development, Wrangler setup, D1 migrations, Access configuration and deployment.
* Seed data (section 8) is applied by a migration or seed script, not hard-coded in the app.

### 7.14 Cloudflare free-plan limits (TECH-14)

From the Cloudflare D1 documentation (October 2026). Check the current limits before relying on them:

|Limit|Free plan|What it means for Track|
|-|-|-|
|Databases per account|10|Production and Preview use 2.|
|Maximum size per database|500 MB|The real storage ceiling for Track; used by the storage meter (FR-SET-12).|
|Total storage per account|5 GB|Shared across all databases on the account.|
|Rows read per day|5 million|The version check (FR-SYNC-02) keeps normal use far below this.|
|Rows written per day|100,000|Normal use is a few hundred a day. An import writes every row, so a large import must stay under this.|
|Queries per Worker invocation|50|`/api/bootstrap`, `/api/backup` and `/api/import` must use D1 batches rather than one query per table or row.|
|Time Travel (point-in-time recovery)|7 days|A short safety net only; the JSON backup (FR-SET-10) is the long-term backup.|

Daily limits reset at 00:00 UTC. If a limit is hit, D1 queries fail until the reset, so the app must show a clear error rather than appear to save.

\---

## 8\. Initial setup data

Seeded by migration on first deploy:

* **Activity types and fields:** exactly those in FR-ACT-01.
* **No children, schedule, medicines, favourites or defaults.** The Admin adds children in Settings › Children. Each new child starts with every activity type enabled. The family then sets up the schedule, medicines, quick log favourites and default values in Settings.
* **First Admin:** the email in the deploy-time `ADMIN_EMAIL` setting becomes the Admin, but only if the database has no active Admin yet. Later deploys change nothing.

Medicine doses, gaps and limits are always entered by the family, from the packaging or their doctor or pharmacist (FR-MED-05).

\---

## 9\. Decisions log

|#|Decision|
|-|-|
|D1|Each family deploys to its own domain (for example track.example.com).|
|D2|Cloudflare Workers with static assets, not Pages (deliberate switch).|
|D3|Overnight sleep (with start and end) replaces separate Wake and Bed events.|
|D4|No poo counter on Home.|
|D5|One-off events are kept in the family calendar, not in the app.|
|D6|The schedule has no history; History shows only what was logged.|
|D7|No edit history (revisions). Entries record created by and last edited by.|
|D8|Sync checks only while the app is open: on open, on return to foreground, every 10 minutes and on pull to refresh, with a cheap version check first.|
|D9|No purge feature. Storage meter instead; revisit only if near the limit.|
|D10|Import replaces all data.|
|D11|Theme is stored per device.|
|D12|Everything in this document is Phase 1.|
|D13|Medication status clears at double the minimum gap; maximums use a rolling 24 hours.|
|D14|Activity types are shared across children; schedules, medicines, defaults, favourites and detection windows are per child.|

\---

## 10\. Assumptions to check

These were not explicitly decided. Change them here if they are wrong.

1. Writers can change the schedule, activity types and medicines; only Admin manages users, children and import (both parents can edit settings).
2. Read only users can export CSV but not download a JSON backup.
3. "Last backup" is shown in Settings only, not on Home.
4. Delete uses a confirmation and an Undo option, and keeps the entry soft-deleted in the database.
5. Day overrides allow both skipping and moving a planned item.
6. The cached offline window is the last 7 days.

