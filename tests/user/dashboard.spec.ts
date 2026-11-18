import { expect, test, type Page } from '@playwright/test';

import { describeWithPermission, loginUser } from '../support/access';
import { BackendApi } from '../support/api';
import { ROUTES, expectNoRenderError } from '../support/app';
import { env, hasAccount, missingAccountMessage } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('user'), missingAccountMessage('user'));

const panel = (page: Page, title: string) =>
  page.locator('section.panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

// The dashboard only renders its sections once /monitoring/dashboard_info answered.
async function openDashboard(page: Page) {
  await page.goto(ROUTES.dashboard);
  await expect(page.getByRole('heading', { name: en.overview })).toBeVisible();
  await expect(page.locator('#dashboard_info_details')).toBeVisible({ timeout: 30_000 });
}

describeWithPermission(
  {
    name: 'user dashboard',
    endpoints: ['dashboard_info'],
    path: ROUTES.dashboard,
    allowed: (page) => page.locator('#dashboard_info_details'),
  },
  (userPage) => {
    test('shows the usage of VMs, containers and objects', async () => {
      const page = userPage();
      await openDashboard(page);
      const stats = page.locator('.usage-stat');
      await expect(stats).toHaveCount(en.usage.length);
      for (const [i, label] of en.usage.entries()) {
        await expect(stats.nth(i).locator('.usage-stat-label')).toHaveText(label);
        // "used/max (Max)" or "used (No limit)"
        await expect(stats.nth(i).locator('.usage-stat-value')).toHaveText(/^\d+(\/\d+ \(Max\)| \(.+\))$/);
      }
      await expectNoRenderError(page);
    });

    test('shows the object, environment and application sections', async () => {
      const page = userPage();
      await openDashboard(page);
      for (const title of [en.availableObjects, en.availableEnvironments, en.availableApplications]) {
        await expect(panel(page, title)).toBeVisible();
      }
      // A user is not offered the admin dashboard.
      await expect(page.getByRole('button', { name: en.goToAdminDashboard })).toHaveCount(0);
    });

    test('own applications can be searched', async () => {
      const page = userPage();
      await openDashboard(page);
      const apps = panel(page, en.availableApplications);
      const search = apps.getByRole('searchbox');
      await expect(search).toBeVisible();
      await search.fill('zz-e2e-no-app-has-this-name');
      await expect(apps.getByText(en.noData)).toBeVisible();
      await expect(apps.locator('.app-card')).toHaveCount(0);
    });

    test('selecting an object enables its start button', async () => {
      const page = userPage();
      await openDashboard(page);
      const objects = panel(page, en.availableObjects);
      const select = objects.locator('#available-object');
      test.skip((await select.count()) === 0, 'The test user has no objects');

      const startButton = objects.getByRole('button', { name: en.start, exact: true });
      const stopButton = objects.getByRole('button', { name: en.stop, exact: true });
      await expect(select).toHaveValue('');
      await expect(startButton).toBeDisabled();
      await expect(stopButton).toBeDisabled();

      await select.selectOption({ index: 1 });
      await expect(startButton).toBeEnabled();

      await select.selectOption('');
      await expect(startButton).toBeDisabled();
    });

    test('selecting an environment enables its buttons', async () => {
      const page = userPage();
      // A new test account owns no environment, and creating one would build a real
      // VM or container. Without one, add a sample environment of the first available
      // object to the real dashboard answer; the buttons only depend on the selection.
      await page.route('**/monitoring/dashboard_info', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const info = body?.response_data?.dashboardinfo;
        if (info && (info.available_environments ?? []).length === 0 && (info.available_objects ?? []).length > 0) {
          const object = info.available_objects[0];
          info.available_environments = [
            { id_env: 'e2e-sample', id_object: object.id_object, id_owner: object.id_owner, name: 'e2e-sample' },
          ];
        }
        await route.fulfill({ response, json: body });
      });
      await openDashboard(page);

      const environments = panel(page, en.availableEnvironments);
      const select = environments.locator('#available-environments');
      test.skip((await select.count()) === 0, 'The test user has neither environments nor objects');

      const startButton = environments.getByRole('button', { name: en.start, exact: true });
      const stopButton = environments.getByRole('button', { name: en.stop, exact: true });
      await expect(startButton).toBeDisabled();
      await expect(stopButton).toBeDisabled();

      await select.selectOption({ index: 1 });
      await expect(startButton).toBeEnabled();
      await expect(stopButton).toBeEnabled();
    });

    test('the files dialog lists own and shared files', async () => {
      const page = userPage();
      await openDashboard(page);
      await page.getByRole('button', { name: en.toolbar.files, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: en.toolbar.files });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('tab', { name: en.ownFiles })).toHaveAttribute('aria-selected', 'true');
      await dialog.getByRole('tab', { name: en.sharedFiles }).click();
      await expect(dialog.getByRole('tab', { name: en.sharedFiles })).toHaveAttribute('aria-selected', 'true');
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toBeHidden();
    });

    test('the create dialog shows the shared applications first', async () => {
      const page = userPage();
      await openDashboard(page);
      await page.getByRole('button', { name: en.toolbar.create, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: en.toolbar.create });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('tab', { name: en.sharedApps })).toHaveAttribute('aria-selected', 'true');
      await expect(dialog.getByRole('searchbox')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('the info and request-app dialogs open and close', async () => {
      const page = userPage();
      await openDashboard(page);
      for (const name of [en.toolbar.info, en.toolbar.requestApp]) {
        await page.getByRole('button', { name, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
    });

    test('refresh reloads the dashboard data', async () => {
      const page = userPage();
      await openDashboard(page);
      const reload = page.waitForResponse((response) => response.url().includes('/monitoring/dashboard_info'));
      await page.getByRole('button', { name: en.toolbar.refresh, exact: true }).click();
      expect((await reload).ok()).toBeTruthy();
      await expect(page.locator('#dashboard_info_details')).toBeVisible();
    });

    test('the header lists the open connections', async () => {
      const page = userPage();
      await openDashboard(page);
      await page.getByRole('button', { name: en.availableConnections }).click();
      await expect(page.locator('.dropdown-menu.show .dropdown-item').first()).toBeVisible();
    });
  },
);

test.describe('route guard', () => {
  test('a user cannot open admin pages', async ({ browser }) => {
    const context = await loginUser(browser);
    const page = await context.newPage();
    await page.goto(ROUTES.admin.root);
    // The route guard sends the user to the login page, which forwards a
    // logged-in user to the dashboard.
    await expect(page).toHaveURL(/\/dashboard$/);
    await context.close();
  });
});

// Really starts the selected object (VM/container), opens its viewer and stops
// it again. Off by default: set E2E_ALLOW_START_STOP=true in .env.
test.describe('start and stop an object', () => {
  test.skip(!env.allowStartStop, 'Set E2E_ALLOW_START_STOP=true to start and stop a real object');

  describeWithPermission(
    {
      name: 'starting an object',
      endpoints: ['dashboard_info', 'baseimage_start', 'baseimage_stop', 'baseimage_object_status', 'viewer_connect', 'vmstatus'],
      path: ROUTES.dashboard,
      allowed: (page) => page.locator('#dashboard_info_details'),
    },
    (userPage) => {
      test('start, viewer, stop', async ({ browser }) => {
        const page = userPage();
        test.setTimeout(env.startTimeoutMs + 120_000);

        // design-daas names a container after its object (daas.<object id>) and kills a
        // running one of that name on start. So never start an object someone else runs.
        if (env.objectId) {
          const api = await BackendApi.open(browser);
          const running = await api.daas<{ name: string }[]>('/container/container_list', {});
          await api.close();
          const name = `daas.${env.objectId.toLowerCase()}`;
          expect(
            running.map((container) => container.name),
            `${name} is already running; starting it again would kill it (choose another E2E_OBJECT_ID)`,
          ).not.toContain(name);
        }
        await openDashboard(page);

        const objects = panel(page, en.availableObjects);
        const select = objects.locator('#available-object');
        test.skip((await select.count()) === 0, 'The test user has no objects');
        if (env.objectId) {
          await select.selectOption(env.objectId);
        } else {
          await select.selectOption({ index: 1 });
        }
        const objectId = await select.inputValue();

        await objects.getByRole('button', { name: en.start, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${ROUTES.user.connectionRun}$`), { timeout: env.startTimeoutMs });
        await expectNoRenderError(page);

        await openDashboard(page);
        await select.selectOption(objectId);
        const stopButton = objects.getByRole('button', { name: en.stop, exact: true });
        await expect(stopButton).toBeEnabled();
        const stopped = page.waitForResponse((response) => response.request().method() === 'POST' && /stop/i.test(response.url()), {
          timeout: env.startTimeoutMs,
        });
        await stopButton.click();
        expect((await stopped).ok()).toBeTruthy();
        await expect(stopButton).toBeDisabled({ timeout: 60_000 });
      });
    },
  );
});
