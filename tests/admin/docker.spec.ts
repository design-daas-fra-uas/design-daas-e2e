import { expect, test, type Page } from '@playwright/test';

import { ROUTES, expectNoRenderError } from '../support/app';
import { env, hasAccount, missingAccountMessage, storageStatePath } from '../support/env';

test.skip(!hasAccount('admin'), missingAccountMessage('admin'));

// Admin Docker page: three read-only tabs (daemon, images, running containers)
// and two tabs of DaaS actions on container objects.

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Submit', exact: true });
const successAlert = (page: Page) => page.locator('.request-success-alert');
const failAlert = (page: Page) => page.locator('.request-fail-alert');
const result = (page: Page) => page.locator('.action-result');

async function openTab(page: Page, name: string) {
  await page.goto(ROUTES.admin.docker);
  await tab(page, name).click();
}

// Opens one action of a "Manage ..." tab, e.g. ('Manage images', 'Image inspect').
async function openAction(page: Page, tabName: string, action: string) {
  await openTab(page, tabName);
  await page.getByRole('button', { name: action, exact: true }).click();
}

test.describe('docker overview', () => {
  test('shows the daemon summary and all details', async ({ page }) => {
    await page.goto(ROUTES.admin.docker);
    for (const card of ['Docker version', 'Containers', 'Images', 'CPUs', 'Memory']) {
      await expect(page.getByText(card, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.getByText(/\d+ running · \d+ paused · \d+ stopped/)).toBeVisible();

    await page.getByRole('button', { name: 'Show all details' }).click();
    await expect(page.getByText('ServerVersion', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Hide details' }).click();
    await expect(page.getByText('ServerVersion', { exact: true })).toBeHidden();
    await expectNoRenderError(page);
  });
});

test.describe('docker images', () => {
  test('lists the images and filters them by name', async ({ page }) => {
    await openTab(page, 'Images');
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const total = await rows.count();
    expect(total).toBeGreaterThan(0);

    const search = page.getByRole('searchbox', { name: 'Search images by name or tag' });
    await search.fill('zz-e2e-no-image-has-this-name');
    await expect(page.getByText(new RegExp(`^0 of ${total}$`))).toBeVisible();

    test.skip(!env.containerId, 'E2E_CONTAINER_ID is not set');
    await search.fill(`daas.${env.containerId.toLowerCase()}`);
    await expect(page.getByText(new RegExp(`^\\d+ of ${total}$`))).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`Information daas\\.${env.containerId}`, 'i') }).first().click();
    await expect(page.getByText('Full ID', { exact: true })).toBeVisible();
    await expect(page.getByText(/^sha256:[0-9a-f]{64}$/)).toBeVisible();
  });
});

test.describe('docker running containers', () => {
  test('lists the containers and shows their usage on demand', async ({ page }) => {
    await openTab(page, 'Running containers');
    const table = page.getByRole('tabpanel', { name: 'Running containers' }).locator('table');
    await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
    await expect(table.getByRole('columnheader', { name: 'CPU' })).toHaveCount(0);

    const started = Date.now();
    await page.getByRole('checkbox', { name: 'Show CPU and memory usage' }).check();
    await expect(table.getByRole('columnheader', { name: 'CPU' })).toBeVisible({ timeout: 30_000 });
    await expect(table.getByRole('columnheader', { name: 'Memory' })).toBeVisible();
    // Docker is asked for all containers at once: about one stats call (~2 s), not one per container.
    expect(Date.now() - started).toBeLessThan(10_000);
    await expect(table.locator('tbody tr').first()).toContainText(/\d+(\.\d+)? %/);
    await expect(table.locator('tbody tr').first()).toContainText(/\d+(\.\d+)? \w?i?B \/ /);
  });
});

test.describe('docker image actions', () => {
  test('inspecting an unknown object reports that it does not exist', async ({ page }) => {
    await openAction(page, 'Manage images', 'Image inspect');
    await field(page, 'ID').fill('zz-e2e-no-such-object');
    await submit(page).click();
    await expect(failAlert(page)).toContainText('not found');
    await expect(result(page)).toHaveCount(0);
  });

  test('inspects a container object', async ({ page }) => {
    test.skip(!env.containerId, 'E2E_CONTAINER_ID is not set');
    await openAction(page, 'Manage images', 'Image inspect');
    await field(page, 'ID').fill(env.containerId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible();
    await expect(result(page)).toContainText('Architecture');
  });

  test('both create forms ask for the hardware the backend requires', async ({ page }) => {
    for (const action of ['Image create', 'Root Image create']) {
      await openAction(page, 'Manage images', action);
      for (const name of ['Cores', 'Memory Size', 'Hard Disk Size']) {
        await expect(field(page, name)).toBeVisible();
      }
      // Containers are reached through their own VNC server by default.
      await expect(page.getByRole('combobox').filter({ hasText: 'Instance VNC' })).toHaveValue('instvnc');
    }
  });

  test('the container logs of an unknown object report that it does not exist', async ({ page }) => {
    await openAction(page, 'Manage containers', 'Container logs');
    await field(page, 'ID').fill('zz-e2e-no-such-object');
    await submit(page).click();
    await expect(failAlert(page)).toContainText('not found');
  });
});

// Opt-in: clones E2E_CONTAINER_ID into a temporary object and runs every action on it:
// build, start, logs, stop, image delete. The object is removed again at the end.
test.describe('docker object lifecycle', () => {
  test.skip(!env.allowStartStop, 'E2E_ALLOW_START_STOP is off');
  test.skip(!env.containerId, 'E2E_CONTAINER_ID is not set');
  test.describe.configure({ mode: 'serial', timeout: env.startTimeoutMs });

  const cloneId = `e2edocker${Date.now()}`;
  const rootId = `${cloneId}root`;
  let instanceId = '';
  let daasUrl = '';

  // Remembers where the DaaS backend lives (the frontend has its URL baked in).
  test.beforeEach(async ({ page }) => {
    page.on('request', (request) => {
      const match = request.url().match(/^(https?:\/\/[^/]+)\/container\//);
      if (match) daasUrl = match[1];
    });
  });

  // Stops a forgotten instance and removes the temporary object through the API,
  // also when a test above failed half-way.
  test.afterAll(async ({ browser }) => {
    if (!daasUrl) return;
    const context = await browser.newContext({
      baseURL: env.baseUrl,
      ignoreHTTPSErrors: env.ignoreHttpsErrors,
      storageState: storageStatePath('admin'),
    });
    const page = await context.newPage();
    await page.goto(ROUTES.dashboard);
    await page.evaluate(
      async ({ url, ids, instance }) => {
        const token = Object.values(localStorage).find((v) => /^Bearer /i.test(v ?? ''));
        const post = (path: string, body: Record<string, string>) => {
          const form = new FormData();
          Object.entries(body).forEach(([k, v]) => form.append(k, v));
          return fetch(url + path, { method: 'POST', headers: { Authorization: token!, Accept: 'application/json' }, body: form });
        };
        if (instance) await post('/container/container_stop', { id_instance: instance, kill: 'on' });
        for (const objectId of ids) {
          await post('/container/image_delete', { id: objectId });
          await post('/phases/baseimage_delete', { id: objectId });
        }
      },
      { url: daasUrl, ids: [cloneId, rootId], instance: instanceId },
    );
    await context.close();
  });

  test('clones the container object', async ({ page }) => {
    await openAction(page, 'Manage images', 'Image clone');
    await field(page, 'ID').fill(env.containerId);
    await field(page, 'New ID').fill(cloneId);
    await field(page, 'Name').fill('e2e docker test');
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 120_000 });

    // Cloning the same id again is refused.
    await submit(page).click();
    await expect(failAlert(page)).toContainText('object already exists');
  });

  test('builds the image and shows the build log', async ({ page }) => {
    await openAction(page, 'Manage images', 'Image build');
    await field(page, 'ID').fill(cloneId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 300_000 });
    await expect(result(page)).toContainText(`Successfully tagged daas.${cloneId}:latest`);
  });

  test('starts the container without a viewer and shows its instance id', async ({ page }) => {
    await openAction(page, 'Manage containers', 'Container start');
    await field(page, 'ID').fill(cloneId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: env.startTimeoutMs });
    const instance = result(page).locator('.result-instance code');
    await expect(instance).not.toBeEmpty();
    instanceId = (await instance.textContent())!.trim();
    await expect(result(page).locator('.result-url')).toHaveCount(0);
  });

  test('shows the container logs as readable text', async ({ page }) => {
    await openAction(page, 'Manage containers', 'Container logs');
    await field(page, 'ID').fill(cloneId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible();
    const text = (await result(page).innerText()).trim();
    expect(text.length).toBeGreaterThan(0);
    // Decoded text, not a Python bytes literal with escaped line breaks.
    expect(text.startsWith("b'")).toBe(false);
    expect(text).not.toContain('\\n');
  });

  test('stops the container by its instance id', async ({ page }) => {
    expect(instanceId).not.toBe('');
    await openAction(page, 'Manage containers', 'Container stop');
    await field(page, 'ID instance').fill(instanceId);
    await page.getByRole('checkbox', { name: 'Kill process' }).check();
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 120_000 });
    instanceId = '';

    // Afterwards there is no container to read logs from.
    await openAction(page, 'Manage containers', 'Container logs');
    await field(page, 'ID').fill(cloneId);
    await submit(page).click();
    await expect(failAlert(page)).toContainText('No container with specified name');
  });

  test('creates an object from a root image', async ({ page }) => {
    await openAction(page, 'Manage images', 'Root Image create');
    await field(page, 'ID').fill(rootId);
    await field(page, 'Name').fill('e2e docker root test');
    await field(page, 'Cores').fill('2');
    await field(page, 'Memory Size').fill(String(4 * 1024 ** 2)); // KiB
    await field(page, 'Hard Disk Size').fill(String(8 * 1024 ** 2));
    await field(page, 'Resolution').fill('1280x800');
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 300_000 });

    await openAction(page, 'Manage images', 'Image inspect');
    await field(page, 'ID').fill(rootId);
    await submit(page).click();
    await expect(result(page)).toContainText('Architecture');
  });

  test('deletes the image, and a second delete reports that it is gone', async ({ page }) => {
    await openAction(page, 'Manage images', 'Image delete');
    await field(page, 'ID').fill(cloneId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 120_000 });

    await submit(page).click();
    await expect(failAlert(page)).toContainText('Image not found');
  });
});
