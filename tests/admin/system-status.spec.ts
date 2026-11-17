import { expect, test } from '@playwright/test';

import { ROUTES, expectNoRenderError, pageTitle } from '../support/app';
import { hasAccount, missingAccountMessage } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('admin'), missingAccountMessage('admin'));

// Health of the whole stack (the same parts as `make status`), read-only.
const t = en.status;
const states = new RegExp(`^(${t.states.join('|')})$`);

test.describe('system status', () => {
  test('is linked from the admin dashboard', async ({ page }) => {
    await page.goto(ROUTES.admin.root);
    await page.locator('#dashboardAdmin').getByRole('link', { name: t.title }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.status}$`));
    await expect(pageTitle(page)).toHaveText(t.title);
    await expectNoRenderError(page);
  });

  test('lists every part of the stack with a state', async ({ page }) => {
    await page.goto(ROUTES.admin.status);
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText(t.columns);
    const rows = table.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });

    // The backend, the auth service and the frontend container are always checked.
    const names = await rows.locator('td:nth-child(1)').allInnerTexts();
    expect(names).toEqual(expect.arrayContaining(['daas', 'auth', 'daas-frontend']));
    for (const state of await rows.locator('td:nth-child(3)').allInnerTexts()) {
      expect(state).toMatch(states);
    }
    const daas = rows.filter({ has: page.getByRole('cell', { name: 'daas', exact: true }) });
    await expect(daas.locator('td').nth(1)).toHaveText('service');
    // design-daas answers this page itself, so it is up.
    await expect(daas.locator('td').nth(2)).toHaveText('up');
    await expect(daas.locator('td').nth(3)).toHaveText(/^version \d+\.\d+\.\d+/);
  });

  test('the overall state is "down" exactly when a part is down', async ({ page }) => {
    await page.goto(ROUTES.admin.status);
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const parts = await rows.locator('td:nth-child(3)').allInnerTexts();
    const overall = page.locator('p', { hasText: t.overall }).locator('.badge');
    await expect(overall).toHaveText(parts.includes('down') ? 'down' : 'up');
  });

  test('refresh asks the backend again', async ({ page }) => {
    await page.goto(ROUTES.admin.status);
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
    const request = page.waitForRequest((r) => r.url().includes('/monitoring/get_system_status'));
    await page.getByRole('button', { name: en.toolbar.refresh }).click();
    await request;
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  });
});
