import { expect, test } from '@playwright/test';

import { describeWithPermission } from '../support/access';
import { ROUTES, expectNoRenderError } from '../support/app';
import { en } from '../support/texts';

// The user's monitoring page loads one endpoint per category.
const CATEGORIES = ['tasks', 'files', 'apps', 'websockets', 'host', 'objects', 'utilization', 'limits'];

describeWithPermission(
  {
    name: 'user monitoring',
    endpoints: CATEGORIES.map((category) => `get_monitor_info_${category}`),
    path: ROUTES.user.monitoring,
    allowed: (page) => page.locator('#user-monitoring-types'),
  },
  (userPage) => {
    test('is reachable from the dashboard toolbar', async () => {
      const page = userPage();
      await page.goto(ROUTES.dashboard);
      await page.getByRole('button', { name: en.toolbar.monitoring, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${ROUTES.user.monitoring}$`));
      await expect(page.getByRole('heading', { name: en.monitoringOverview })).toBeVisible();
      await expectNoRenderError(page);
    });

    test('loads every category and shows its tabs', async () => {
      const page = userPage();
      const answers = CATEGORIES.map((category) =>
        page.waitForResponse((response) => response.url().endsWith(`/monitoring/get_monitor_info_${category}`)),
      );
      await page.goto(ROUTES.user.monitoring);
      for (const answer of answers) expect((await answer).status()).toBe(200);
      await expect(page.locator('#user-monitoring-types [role="tab"]').first()).toBeVisible();
      // No category is reported as denied.
      await expect(page.getByText(en.permissionDeniedHint)).toHaveCount(0);
      await expectNoRenderError(page);
    });
  },
);
