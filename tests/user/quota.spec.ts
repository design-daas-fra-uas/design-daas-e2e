import { expect, test } from '@playwright/test';

import { ROUTES, escapeRegExp, expectNoRenderError, pageTitle } from '../support/app';
import { hasAccount, missingAccountMessage } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('user'), missingAccountMessage('user'));

// "My resources": the user's limits next to what they use now. How a changed limit shows
// up here is tested from the admin side (admin/limitation.spec.ts, admin/permissions.spec.ts).
const t = en.quota;
const sources = [t.sourceUser, t.sourceFallback, t.sourceNone];

test.describe('my resources', () => {
  test('is reachable from the dashboard toolbar', async ({ page }) => {
    await page.goto(ROUTES.dashboard);
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.user.quota}$`));
    await expect(pageTitle(page)).toHaveText(t.title);
    await expectNoRenderError(page);
  });

  test('shows six resources with use, limit and a bar', async ({ page }) => {
    await page.goto(ROUTES.user.quota);
    // The e2e user must be allowed get_quota (a rule on the admin's Permissions page).
    await expect(page.getByText(t.denied), 'the e2e user is denied get_quota').toHaveCount(0);
    const cards = page.locator('.stat-card');
    await expect(cards).toHaveCount(6, { timeout: 30_000 });
    await expect(cards.locator('.stat-card-head')).toHaveText(t.cards);
    await expect(page.locator('.page-intro')).toHaveText(new RegExp(`^(${sources.map(escapeRegExp).join('|')})$`));

    for (const [index, label] of t.cards.entries()) {
      const card = cards.nth(index);
      const unit = index >= 4 ? ' (B|KiB|MiB|GiB|TiB)' : '';
      await expect(card.locator('.stat-card-value')).toHaveText(new RegExp(`^\\d+(\\.\\d)?${unit} / (\\d+(\\.\\d)?${unit}|${t.noLimit})$`));
      if ((await card.locator('.stat-card-limit').innerText()).includes(t.noLimit)) {
        await expect(card.getByText('No limit is set for this resource.')).toBeVisible();
        await expect(card.getByRole('progressbar')).toHaveCount(0);
      } else {
        // The bar is labelled with the resource and its share in percent (0 to 100).
        await expect(card.getByRole('progressbar', { name: new RegExp(`^${escapeRegExp(label)} (\\d|[1-9]\\d|100) %$`) })).toBeVisible();
      }
    }
  });

  test('refresh asks the backend again', async ({ page }) => {
    await page.goto(ROUTES.user.quota);
    await expect(page.locator('.stat-card')).toHaveCount(6, { timeout: 30_000 });
    const request = page.waitForRequest((r) => r.url().includes('/monitoring/get_quota'));
    await page.getByRole('button', { name: en.toolbar.refresh }).click();
    await request;
    await expect(page.locator('.stat-card')).toHaveCount(6);
  });
});

test.describe('admin pages stay closed to a user', () => {
  const pages: [string, string][] = [
    ['system status', ROUTES.admin.status],
    ['limitation', ROUTES.admin.limitation],
    ['permissions', ROUTES.admin.permissions],
    ['desktops', ROUTES.admin.desktops],
    ['desktop groups', ROUTES.admin.desktopGroups],
    ['docker', ROUTES.admin.docker],
  ];
  for (const [name, path] of pages) {
    test(`${name}`, async ({ page }) => {
      await page.goto(path);
      // The route guard sends the user to the login page, which forwards to the dashboard.
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  }
});

