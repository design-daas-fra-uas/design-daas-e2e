import { expect, test } from '@playwright/test';

import { ROUTES, login } from '../support/app';
import { env, hasAccount, missingAccountMessage, type Role } from '../support/env';
import { en } from '../support/texts';

// Fresh logins (no saved session), so logging out does not affect other tests.
for (const role of ['user', 'admin'] as Role[]) {
  test.describe(`${role} session`, () => {
    test.skip(!hasAccount(role), missingAccountMessage(role));

    test('login stores a session and logout ends it', async ({ page }) => {
      await login(page, role, env.accounts[role]);
      expect(await page.evaluate(() => localStorage.getItem('role'))).toBe(role);

      // A logged-in user opening the login page is sent to the dashboard.
      await page.goto(ROUTES.login);
      await expect(page).toHaveURL(/\/dashboard$/);

      const logoutCall = page.waitForResponse((response) => response.url().includes('/oauth2/user/logout'));
      await page.getByRole('button', { name: en.logout }).click();
      expect((await logoutCall).ok()).toBeTruthy();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: en.login, exact: true })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('userToken'))).toBeNull();

      // The dashboard is protected again.
      await page.goto(ROUTES.dashboard);
      await expect(page).toHaveURL(/\/$/);
    });
  });
}
