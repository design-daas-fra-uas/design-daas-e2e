import { expect, test } from '@playwright/test';

import { ROUTES, expectNoRenderError } from '../support/app';
import { hasAccount, missingAccountMessage } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('user'), missingAccountMessage('user'));

test.describe('user monitoring', () => {
  test('is reachable from the dashboard toolbar', async ({ page }) => {
    await page.goto(ROUTES.dashboard);
    await page.getByRole('button', { name: en.toolbar.monitoring, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.user.monitoring}$`));
    await expect(page.getByRole('heading', { name: en.monitoringOverview })).toBeVisible();
    await expectNoRenderError(page);
  });

  test('shows the monitoring tabs and loads data', async ({ page }) => {
    const loaded = page.waitForResponse((response) => response.url().includes('/monitoring/'));
    await page.goto(ROUTES.user.monitoring);
    expect((await loaded).ok()).toBeTruthy();
    await expect(page.locator('#user-monitoring-types')).toBeVisible();
    await expect(page.locator('#user-monitoring-types [role="tab"]').first()).toBeVisible();
    await expectNoRenderError(page);
  });
});
