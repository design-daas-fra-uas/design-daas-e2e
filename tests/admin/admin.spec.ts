import { expect, test } from '@playwright/test';

import { ROUTES, expectNoRenderError, pageTitle } from '../support/app';
import { hasAccount, missingAccountMessage } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('admin'), missingAccountMessage('admin'));

test.describe('admin dashboard', () => {
  test('the user dashboard links to the admin dashboard', async ({ page }) => {
    await page.goto(ROUTES.dashboard);
    await page.getByRole('button', { name: en.goToAdminDashboard }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.root}$`));
    await expect(pageTitle(page)).toHaveText(en.administration);
  });

  test('lists admins and users and has the quick links', async ({ page }) => {
    await page.goto(ROUTES.admin.root);
    await expect(page.getByRole('status')).toHaveCount(0, { timeout: 30_000 });
    // The section headings carry a count badge, e.g. "Admins 2".
    await expect(page.getByRole('heading', { name: new RegExp(`^${en.admins}\\b`) })).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`^${en.users}\\b`) })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Could not load' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: en.back, exact: true })).toBeVisible();
    await expectNoRenderError(page);
  });

  test('the settings overview leads to the admin and user lists', async ({ page }) => {
    await page.goto(ROUTES.admin.settings);
    const choose = page.getByRole('button', { name: en.choose });
    await expect(choose).toHaveCount(2);
    await choose.nth(0).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.admins}$`));
    await page.goBack();
    await choose.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.users}$`));
  });
});

test.describe('admin pages', () => {
  // Every admin page must load for an admin, show its title and not crash.
  const pages: [string, string][] = [
    ['settings', ROUTES.admin.settings],
    ['users', ROUTES.admin.users],
    ['admins', ROUTES.admin.admins],
    ['desktops', ROUTES.admin.desktops],
    ['desktop groups', ROUTES.admin.desktopGroups],
    ['monitoring', ROUTES.admin.monitoring],
    ['limitation', ROUTES.admin.limitation],
    ['tasks', ROUTES.admin.tasks],
    ['VM environment', ROUTES.admin.vmEnvironment],
    ['node configuration', ROUTES.admin.nodeConfiguration],
    ['connections', ROUTES.admin.connections],
    ['instances', ROUTES.admin.instances],
    ['docker', ROUTES.admin.docker],
    ['phases', ROUTES.admin.phases],
    ['admin assign', ROUTES.admin.adminAssign],
    ['apps', ROUTES.admin.apps],
    ['files', ROUTES.admin.files],
  ];

  for (const [name, path] of pages) {
    test(`${name} page loads`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(pageTitle(page)).toBeVisible();
      await expect(pageTitle(page)).not.toBeEmpty();
      await expectNoRenderError(page);
    });
  }

  test('every quick link on the admin dashboard opens its page', async ({ page }) => {
    await page.goto(ROUTES.admin.root);
    // evaluateAll does not wait, so first wait for the (lazy-loaded) page's last link section.
    await expect(page.locator('#dashboardAdmin .link-section').last()).toBeVisible();
    const links = page.locator('#dashboardAdmin a[href^="/dashboard"]');
    const hrefs = await links.evaluateAll((elements) => elements.map((element) => element.getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      await page.goto(ROUTES.admin.root);
      await page.locator(`#dashboardAdmin a[href="${href}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expectNoRenderError(page);
    }
  });
});

test.describe('admin monitoring', () => {
  test('shows user, admin and owner tabs', async ({ page }) => {
    await page.goto(ROUTES.admin.monitoring);
    await expect(page.getByRole('heading', { name: en.monitoringOverview })).toBeVisible();
    const scopes = page.locator('#monitoring-scopes');
    await expect(scopes.getByRole('tab')).toHaveCount(3);
    await scopes.getByRole('tab', { name: en.adminTab, exact: true }).click();
    await expect(scopes.getByRole('tab', { name: en.adminTab, exact: true })).toHaveAttribute('aria-selected', 'true');
    await scopes.getByRole('tab').nth(2).click();
    // The owner search needs an id before it can be submitted.
    await expect(page.locator('#submit')).toBeDisabled();
    await expectNoRenderError(page);
  });
});
