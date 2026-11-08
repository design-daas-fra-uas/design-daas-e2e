import { expect, test } from '@playwright/test';

import { ROUTES, expectNoRenderError, submitLogin } from '../support/app';
import { de, en } from '../support/texts';

test.describe('login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ROUTES.login);
  });

  test('shows the login form with user and admin tabs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: en.login, exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: en.userTab, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: en.adminTab, exact: true })).toBeVisible();
    await expect(page.locator('#user-username')).toBeVisible();
    await expect(page.locator('#user-password')).toHaveAttribute('type', 'password');
    await expectNoRenderError(page);
  });

  test('switching to the admin tab shows the admin form and hides the registration link', async ({ page }) => {
    await expect(page.getByRole('link', { name: en.registrationLink })).toBeVisible();
    await page.getByRole('tab', { name: en.adminTab, exact: true }).click();
    await expect(page.locator('#admin-username')).toBeVisible();
    await expect(page.locator('#user-username')).toHaveCount(0);
    await expect(page.getByRole('link', { name: en.registrationLink })).toHaveCount(0);
  });

  test('submit stays disabled until username and password are filled', async ({ page }) => {
    const submit = page.getByRole('button', { name: en.submit });
    await expect(submit).toBeDisabled();
    await page.locator('#user-username').fill('someone');
    await page.locator('#user-password').fill('x');
    await expect(submit).toBeEnabled();
    await page.locator('#user-password').fill('');
    await page.locator('#user-password').blur();
    await expect(submit).toBeDisabled();
  });

  for (const role of ['user', 'admin'] as const) {
    test(`wrong ${role} credentials show an error and keep the user on the login page`, async ({ page }) => {
      // Needs the auth service; the account does not exist.
      await submitLogin(page, role, { username: 'e2e-no-such-account', password: 'e2e-wrong-password' });
      await expect(page.getByRole('alert')).toHaveText(en.loginErrorCredentials);
      await expect(page).toHaveURL(/\/$/);
    });
  }

  test('the registration link opens the registration page', async ({ page }) => {
    await page.getByRole('link', { name: en.registrationLink }).click();
    await expect(page).toHaveURL(/\/registration$/);
    await expect(page.locator('#registration')).toBeVisible();
    await expectNoRenderError(page);
  });

  test('the language menu switches the UI to German and back', async ({ page }) => {
    await page.getByRole('button', { name: en.language }).click();
    await page.getByRole('button', { name: 'DE', exact: true }).click();
    await expect(page.getByRole('heading', { name: de.login, exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: de.userTab, exact: true })).toBeVisible();

    // The choice is remembered across reloads.
    await page.reload();
    await expect(page.getByRole('heading', { name: de.login, exact: true })).toBeVisible();

    await page.getByRole('button', { name: de.language }).click();
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByRole('heading', { name: en.login, exact: true })).toBeVisible();
  });
});
