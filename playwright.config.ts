import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the real Worker (wrangler dev) with a fresh local D1 and the dev auth stub,
// switched on with --var for this process only (never in wrangler.jsonc).
// PW_CHROMIUM_PATH lets a machine with a pre-installed Chromium use it instead of a Playwright download.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8787',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  webServer: {
    command: 'npm run e2e:server',
    url: 'http://localhost:8787/api/version',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    {
      name: 'pixel-6a',
      use: {
        ...devices['Pixel 7'],
        // Pixel 6a: 1080 × 2400 at ~2.625 device pixels per CSS pixel.
        screen: { width: 411, height: 914 },
        viewport: { width: 411, height: 842 },
        userAgent: devices['Pixel 7'].userAgent.replace('Pixel 7', 'Pixel 6a'),
      },
    },
  ],
});
