// Fictional demo data for trying Track locally and for the README screenshots: one child (Sam), an Admin
// (Alex) and a Writer (Jamie), with a realistic day so far, a running nap, a missed planned item, a
// medicine with a status showing, and a weight and height. Everything is made up.
//
//   npm run seed:demo                              load into the LOCAL database (after db:migrate:local)
//   npm run seed:demo -- --persist-to <dir>        load into a local database kept in <dir>
//   npm run seed:demo -- --now 2026-10-20T14:10:00Z --print   print the SQL for a given "now"
//
// Load it into a fresh local database: it adds users, so it fails if alex@ or jamie@example.com exist.
// Local only: it always passes --local to Wrangler.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EVERY_DAY } from '../src/shared/schedule';
import { addDays, localDateOf, zonedTimeToUtc } from '../src/shared/time';
import { buildFamilySql, type Family, type FamilyEntry } from './family';

const TZ = 'Europe/London';

/** The demo family, with entries placed around `now` (shown as about 15:10 in the screenshots). */
export function demoFamily(now: Date): Family {
  const today = localDateOf(now, TZ);
  const yesterday = addDays(today, -1);
  const at = (date: string, time: string) => zonedTimeToUtc(date, time, TZ);
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  const day = (date: string, by: 'alex' | 'jamie'): FamilyEntry[] => [
    { child: 'sam', type: 'Cereal', start: at(date, '07:10'), values: { variety: 'Banana', amount: 6 }, by },
    {
      child: 'sam',
      type: 'Poo',
      start: at(date, '08:05'),
      values: { colour: 'Mustard', consistency: 'Soft' },
      by,
    },
    { child: 'sam', type: 'Nap', start: at(date, '09:35'), end: at(date, '10:50'), by },
    { child: 'sam', type: 'Formula', start: at(date, '11:50'), values: { amount: 210 }, by: 'jamie' },
    {
      child: 'sam',
      type: 'Food',
      start: at(date, '12:30'),
      values: { what: 'Pasta and peas' },
      note: 'Ate most of it',
      by: 'jamie',
    },
  ];

  return {
    seed: 2024,
    at: at(addDays(today, -30), '09:00').toISOString(),
    tz: TZ,
    users: [
      { ref: 'alex', email: 'alex@example.com', displayName: 'Alex', role: 'admin' },
      { ref: 'jamie', email: 'jamie@example.com', displayName: 'Jamie', role: 'writer' },
    ],
    children: [
      {
        ref: 'sam',
        firstName: 'Sam',
        favourites: ['Formula', 'Cereal', 'Food', 'Nap', 'Poo', 'Medication', 'Bath'],
        defaults: { Formula: { amount: 210 }, Cereal: { variety: 'Banana', amount: 6 } },
        schedule: [
          { type: 'Cereal', start: '07:15', daysMask: EVERY_DAY },
          { type: 'Formula', start: '08:30', daysMask: EVERY_DAY },
          { type: 'Nap', start: '09:30', end: '10:45', daysMask: EVERY_DAY },
          { type: 'Formula', start: '12:00', daysMask: EVERY_DAY },
          { type: 'Nap', start: '14:30', end: '16:00', daysMask: EVERY_DAY },
          { type: 'Purée', start: '16:30', daysMask: EVERY_DAY },
          { type: 'Bath', start: '18:30', daysMask: EVERY_DAY },
          { type: 'Formula', start: '19:00', daysMask: EVERY_DAY },
          { type: 'Overnight sleep', start: '19:15', end: '07:00', daysMask: EVERY_DAY },
        ],
        medicines: [
          {
            name: 'Paracetamol (example)',
            dose: 2.5,
            doseUnit: 'ml',
            minGapMin: 240,
            maxPer24h: 4,
            alternating: false,
          },
        ],
      },
    ],
    entries: [
      // Earlier measurements, shown next to Sam's name.
      {
        child: 'sam',
        type: 'Weight',
        start: at(addDays(today, -6), '09:00'),
        values: { weight: 9.42 },
        by: 'alex',
      },
      {
        child: 'sam',
        type: 'Height',
        start: at(addDays(today, -6), '09:02'),
        values: { height: 74.5 },
        by: 'alex',
      },
      // Yesterday, a full day (for History).
      {
        child: 'sam',
        type: 'Overnight sleep',
        start: at(addDays(today, -2), '19:20'),
        end: at(yesterday, '06:55'),
        by: 'alex',
      },
      ...day(yesterday, 'alex'),
      { child: 'sam', type: 'Formula', start: at(yesterday, '08:40'), values: { amount: 150 }, by: 'alex' },
      { child: 'sam', type: 'Nap', start: at(yesterday, '14:25'), end: at(yesterday, '15:55'), by: 'jamie' },
      {
        child: 'sam',
        type: 'Purée',
        start: at(yesterday, '16:35'),
        values: { what: 'Carrot and sweet potato' },
        by: 'jamie',
      },
      { child: 'sam', type: 'Bath', start: at(yesterday, '18:35'), by: 'alex' },
      { child: 'sam', type: 'Formula', start: at(yesterday, '19:00'), values: { amount: 210 }, by: 'alex' },
      // Last night and today so far. The 08:30 Formula is left unlogged, so it shows as missed.
      {
        child: 'sam',
        type: 'Overnight sleep',
        start: at(yesterday, '19:18'),
        end: at(today, '06:50'),
        by: 'jamie',
      },
      ...day(today, 'alex'),
      {
        child: 'sam',
        type: 'Medication',
        start: minsAgo(150),
        medicine: 'Paracetamol (example)',
        note: 'Teething',
        by: 'alex',
      },
      // A nap that is still running.
      { child: 'sam', type: 'Nap', start: minsAgo(38), end: null, by: 'jamie' },
    ],
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const nowArg = arg('--now');
  const now = nowArg ? new Date(nowArg) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`Not a date: ${nowArg}`);
  const sql =
    '-- Fictional demo data from scripts/seed-demo.ts. Local only.\n' + buildFamilySql(demoFamily(now));
  if (process.argv.includes('--print')) {
    process.stdout.write(sql);
  } else {
    mkdirSync('.wrangler', { recursive: true });
    writeFileSync('.wrangler/demo.sql', sql);
    const persist = arg('--persist-to');
    execFileSync(
      'npx',
      [
        'wrangler',
        'd1',
        'execute',
        'track-local',
        '--local',
        ...(persist ? ['--persist-to', persist] : []),
        '--file',
        '.wrangler/demo.sql',
      ],
      { stdio: 'inherit' },
    );
    console.log(
      'Demo data loaded. Sign in locally as alex@example.com (Admin) or jamie@example.com (Writer).',
    );
  }
}
