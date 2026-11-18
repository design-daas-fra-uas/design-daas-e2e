import { defineConfig, devices } from '@playwright/test';

import { env, storageStatePath } from './tests/support/env';

// Use the Chromium inside node_modules (installed by `npm run install:browsers`),
// so the tests run the same for every system user (e.g. also with sudo/root).
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';

// Projects:
//   setup   - logs in the test user and admin once and saves their sessions
//   public  - pages without login (login form, registration, 404, route guards)
//   user    - user functions, each tested without and with its permission (fresh logins)
//   admin   - admin dashboard, settings and monitoring, with the saved admin session
//   session - login/logout flows with fresh logins; runs last because logging
//             out ends sessions on the server
export default defineConfig({
  testDir: './tests',
  // One stack with real VMs behind it: run one test at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: env.baseUrl,
    ignoreHTTPSErrors: env.ignoreHttpsErrors,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'public', testDir: './tests/public' },
    {
      // No saved session: user tests log in fresh (see tests/support/access.ts).
      name: 'user',
      testDir: './tests/user',
      dependencies: ['setup'],
    },
    {
      name: 'admin',
      testDir: './tests/admin',
      dependencies: ['setup'],
      use: { storageState: storageStatePath('admin') },
    },
    { name: 'session', testDir: './tests/session', dependencies: ['public', 'user', 'admin'] },
  ],
});
