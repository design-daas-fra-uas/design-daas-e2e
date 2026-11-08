import { expect, test } from '@playwright/test';

import { ROUTES } from '../support/app';
import { en } from '../support/texts';

test.describe('without a login', () => {
  const protectedPages = [
    ROUTES.dashboard,
    ROUTES.user.monitoring,
    ROUTES.admin.root,
    ROUTES.admin.settings,
    ROUTES.admin.monitoring,
  ];

  for (const path of protectedPages) {
    test(`${path} redirects to the login page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: en.login, exact: true })).toBeVisible();
    });
  }

  test('the header shows no logout or home link', async ({ page }) => {
    await page.goto(ROUTES.login);
    await expect(page.getByRole('button', { name: en.language })).toBeVisible();
    await expect(page.getByRole('button', { name: en.logout })).toHaveCount(0);
    await expect(page.getByRole('link', { name: en.home })).toHaveCount(0);
  });

  test('an unknown page shows the 404 page', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');
    await expect(page.getByRole('heading', { name: 'Error - 404' })).toBeVisible();
    await expect(page.getByRole('heading', { name: en.notFound })).toBeVisible();
  });
});
