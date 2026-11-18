import { expect, test, type Page } from '@playwright/test';

import { ROUTES, expectNoRenderError } from '../support/app';
import { env, hasAccount, missingAccountMessage, storageStatePath } from '../support/env';

test.skip(!hasAccount('admin'), missingAccountMessage('admin'));

// Admin Docker page: three read-only tabs (daemon, images, running containers)
// and two tabs of DaaS actions on container objects.

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
// Visible input of the open form by its label (text, number or dropdown alike).
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true }).filter({ visible: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Submit', exact: true });
const successAlert = (page: Page) => page.locator('.request-success-alert');
const failAlert = (page: Page) => page.locator('.request-fail-alert');
const result = (page: Page) => page.locator('.action-result');

// Types an object ID; leaving the field closes the object list, which would cover the form below.
async function enterObjectId(page: Page, value: string) {
  const input = field(page, 'Object ID');
  await input.fill(value);
  await input.blur();
}

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
    // The list reloads and redraws the switch, so click once instead of check().
    await page.getByRole('checkbox', { name: 'Show CPU and memory usage' }).click();
    await expect(table.getByRole('columnheader', { name: 'CPU' })).toBeVisible({ timeout: 30_000 });
    await expect(table.getByRole('columnheader', { name: 'Memory' })).toBeVisible();
    // Docker is asked for all containers at once: about one stats call (~2 s), not one per container.
    expect(Date.now() - started).toBeLessThan(10_000);
    await expect(table.locator('tbody tr').first()).toContainText(/\d+(\.\d+)? %/);
    await expect(table.locator('tbody tr').first()).toContainText(/\d+(\.\d+)? \w?i?B \/ /);
  });

  test('lists every container the system status page reports as running', async ({ page }) => {
    await page.goto(ROUTES.admin.status);
    const statusRows = page.locator('tbody tr').filter({ has: page.getByRole('cell', { name: 'container', exact: true }) });
    await expect(statusRows.first()).toBeVisible({ timeout: 30_000 });
    const running = await statusRows.filter({ has: page.getByRole('cell', { name: 'up', exact: true }) }).locator('td:nth-child(1)').allInnerTexts();
    expect(running.length).toBeGreaterThan(0);

    await openTab(page, 'Running containers');
    const panel = page.getByRole('tabpanel', { name: 'Running containers' });
    await expect(panel.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
    for (const name of running) {
      await expect(panel.locator('tbody tr').filter({ hasText: name }).first()).toBeVisible();
    }
    // The tab title counts the rows.
    const rows = await panel.locator('tbody tr').count();
    await expect(panel.getByText(`${rows} running`, { exact: true })).toBeVisible();
  });

  test('is linked from the admin dashboard', async ({ page }) => {
    await page.goto(ROUTES.admin.root);
    await page.locator('#dashboardAdmin').getByRole('link', { name: 'Docker', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.docker}$`));
    await expect(tab(page, 'Images')).toBeVisible();
    await expectNoRenderError(page);
  });
});

test.describe('docker image actions', () => {
  test('inspecting an unknown object reports that it does not exist', async ({ page }) => {
    await openAction(page, 'Manage images', 'Image inspect');
    await enterObjectId(page, 'zz-e2e-no-such-object');
    await submit(page).click();
    await expect(failAlert(page)).toContainText('not found');
    await expect(result(page)).toHaveCount(0);
  });

  test('inspects a container object', async ({ page }) => {
    test.skip(!env.containerId, 'E2E_CONTAINER_ID is not set');
    await openAction(page, 'Manage images', 'Image inspect');
    await enterObjectId(page, env.containerId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible();
    await expect(result(page)).toContainText('Architecture');
  });

  test('both create forms ask for the hardware the backend requires', async ({ page }) => {
    for (const action of ['Image create', 'Root Image create']) {
      await openAction(page, 'Manage images', action);
      // Whole numbers, memory and disk in GiB, with sensible defaults.
      await expect(field(page, 'Cores')).toHaveValue('2');
      await expect(field(page, 'Memory (GiB)')).toHaveValue('4');
      await expect(field(page, 'Hard disk (GiB)')).toHaveValue('8');
      // The resolution is picked from the sizes the viewer offers.
      await expect(field(page, 'Resolution')).toHaveValue('max');
      await expect(field(page, 'Resolution').locator('option')).toContainText(['Maximize (fit the viewer window)', '1920x1080']);
      // Containers are reached through their own VNC server by default.
      await expect(page.getByRole('combobox').filter({ hasText: 'Instance VNC' })).toHaveValue('instvnc');
    }
  });

  test('rejects hardware values that are not whole numbers from 1', async ({ page }) => {
    await openAction(page, 'Manage images', 'Root Image create');
    await enterObjectId(page, 'zz-e2e-never-created');
    await field(page, 'Display name').fill('never created');
    const memory = field(page, 'Memory (GiB)');
    for (const bad of ['0', '-2', '2.5']) {
      await memory.fill(bad);
      await memory.blur();
      await expect(page.getByText('Enter a whole number from 1 up.')).toBeVisible();
      await expect(submit(page)).toBeDisabled();
    }
    await memory.fill('6');
    await expect(page.getByText('Enter a whole number from 1 up.')).toHaveCount(0);
    await expect(submit(page)).toBeEnabled();
  });

  test('offers the existing container objects in a searchable list', async ({ page }) => {
    test.skip(!env.containerId, 'E2E_CONTAINER_ID is not set');
    await openAction(page, 'Manage images', 'Image inspect');
    const input = page.getByRole('combobox', { name: 'Object ID' });
    await input.click();
    const list = page.getByRole('listbox').filter({ visible: true });
    const options = list.getByRole('option');
    await expect(options.first()).toBeVisible();

    // Only DaaS container objects: no VMs, no plain images ("sha256:...").
    const ids = await list.locator('.combobox-option-value').allInnerTexts();
    expect(ids).toContain(env.containerId);
    expect(ids.every((value) => !value.startsWith('sha256:'))).toBe(true);
    expect(ids).not.toContain('templateDeb12');

    // Searching narrows the list; Enter picks the highlighted object.
    await input.fill(env.containerId.slice(0, -1));
    await expect(options.filter({ hasText: env.containerId })).toHaveCount(1);
    await expect(list.locator('mark').first()).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(input).toHaveValue(env.containerId);
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await submit(page).click();
    await expect(result(page)).toContainText('Architecture');

    // An ID that is not listed is still allowed.
    await input.fill('zz-not-listed');
    await expect(page.getByRole('status').filter({ hasText: 'The ID is used as typed' })).toBeVisible();
  });

  test('explains object ID and display name, and checks the format of a new ID', async ({ page }) => {
    await openAction(page, 'Manage images', 'Image clone');
    await expect(field(page, 'Object ID')).toHaveAccessibleDescription(/unique key of the DaaS object/i);
    await expect(field(page, 'New object ID')).toHaveAccessibleDescription(/daas\.<object ID> in lower case/);
    await expect(field(page, 'Display name')).toHaveAccessibleDescription(/does not have to be unique/);

    await enterObjectId(page, 'contx11');
    await field(page, 'Display name').fill('any name, with spaces');
    const newId = field(page, 'New object ID');
    for (const bad of ['has space', 'ends-', 'a..b', 'ümlaut']) {
      await newId.fill(bad);
      await newId.blur();
      await expect(page.getByText(/Use letters and digits/)).toBeVisible();
      await expect(submit(page)).toBeDisabled();
    }
    await newId.fill('e2e-valid.id_1');
    await expect(page.getByText(/Use letters and digits/)).toHaveCount(0);
    await expect(submit(page)).toBeEnabled();
  });

  test('the container logs of an unknown object report that it does not exist', async ({ page }) => {
    await openAction(page, 'Manage containers', 'Container logs');
    await enterObjectId(page, 'zz-e2e-no-such-object');
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
    await enterObjectId(page, env.containerId);
    await field(page, 'New object ID').fill(cloneId);
    await field(page, 'Display name').fill('e2e docker test');
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 120_000 });

    // Cloning the same id again is refused.
    await submit(page).click();
    await expect(failAlert(page)).toContainText('object already exists');
  });

  test('builds the image and shows the build log', async ({ page }) => {
    await openAction(page, 'Manage images', 'Image build');
    await enterObjectId(page, cloneId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 300_000 });
    await expect(result(page)).toContainText(`Successfully tagged daas.${cloneId}:latest`);
  });

  test('starts the container without a viewer and shows its instance id', async ({ page }) => {
    await openAction(page, 'Manage containers', 'Container start');
    await enterObjectId(page, cloneId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: env.startTimeoutMs });
    const instance = result(page).locator('.result-instance code');
    await expect(instance).not.toBeEmpty();
    instanceId = (await instance.textContent())!.trim();
    await expect(result(page).locator('.result-url')).toHaveCount(0);
  });

  test('shows the container logs as readable text', async ({ page }) => {
    await openAction(page, 'Manage containers', 'Container logs');
    await enterObjectId(page, cloneId);
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
    await enterObjectId(page, cloneId);
    await submit(page).click();
    await expect(failAlert(page)).toContainText('No container with specified name');
  });

  test('creates an object from a root image', async ({ page }) => {
    await openAction(page, 'Manage images', 'Root Image create');
    await enterObjectId(page, rootId);
    await field(page, 'Display name').fill('e2e docker root test');
    await field(page, 'Cores').fill('2');
    await field(page, 'Memory (GiB)').fill('4');
    await field(page, 'Hard disk (GiB)').fill('8');
    await field(page, 'Resolution').selectOption('1280x800');
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 300_000 });

    await openAction(page, 'Manage images', 'Image inspect');
    await enterObjectId(page, rootId);
    await submit(page).click();
    await expect(result(page)).toContainText('Architecture');
  });

  test('deletes the image, and a second delete reports that it is gone', async ({ page }) => {
    await openAction(page, 'Manage images', 'Image delete');
    await enterObjectId(page, cloneId);
    await submit(page).click();
    await expect(successAlert(page)).toBeVisible({ timeout: 120_000 });

    await submit(page).click();
    await expect(failAlert(page)).toContainText('Image not found');
  });
});
