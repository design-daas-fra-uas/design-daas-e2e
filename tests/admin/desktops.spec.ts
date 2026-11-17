import { expect, test, type Page } from '@playwright/test';

import { BackendApi, uniqueName } from '../support/api';
import { ROUTES, expectNoRenderError, labelFor, pageTitle } from '../support/app';
import { hasAccount, missingAccountMessage } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('admin'), missingAccountMessage('admin'));

// Desktops (Java backend): a desktop is created together with a new desktop group.
// Every name starts with PREFIX and is removed again in afterAll.
const PREFIX = 'e2e-desk-';
const t = en.desktops;

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const submit = (page: Page) => page.getByRole('button', { name: en.submit, exact: true });
const item = (page: Page, name: string) => page.locator('.entity-list li').filter({ hasText: name });

async function openCreate(page: Page) {
  await page.goto(ROUTES.admin.desktops);
  await page.getByRole('button', { name: t.newDesktop }).click();
  return dialog(page, t.createDesktop);
}

test.afterAll(async ({ browser }) => {
  const api = await BackendApi.open(browser);
  await api.deleteByPrefix(PREFIX);
  await api.close();
});

test.describe('desktops page', () => {
  test('is linked from the admin dashboard and counts its desktops', async ({ page }) => {
    await page.goto(ROUTES.admin.root);
    await page.locator('#dashboardAdmin').getByRole('link', { name: t.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.desktops}$`));
    await expect(pageTitle(page)).toHaveText(t.title);
    const heading = page.getByRole('heading', { name: new RegExp(`^${t.title} \\d+$`) });
    await expect(heading).toBeVisible();
    const count = Number((await heading.innerText()).match(/\d+$/)![0]);
    await expect(page.locator('.entity-list li')).toHaveCount(count);
    await expectNoRenderError(page);
  });

  test('the create form needs a name and a new group name', async ({ page }) => {
    const modal = await openCreate(page);
    await expect(modal.getByText(/must not be in use yet/)).toBeVisible();
    const name = modal.getByLabel(t.name, { exact: true });
    await name.fill(' ');
    await modal.getByLabel(t.newGroup, { exact: true }).fill(' ');
    await submit(page).click();
    // Spaces only count as empty.
    await expect(modal.getByText(t.errorName)).toBeVisible();
    await expect(modal.getByText(t.errorNewGroup)).toBeVisible();
    await expect(modal).toBeVisible();
  });

  test('an unknown desktop shows "not found"', async ({ page }) => {
    await page.goto(ROUTES.admin.desktopDetail(999_999_999));
    await expect(page.getByRole('alert')).toHaveText(t.notFound);
    await expect(page.getByRole('button', { name: t.deleteDesktop })).toHaveCount(0);
  });
});

test.describe('desktop lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  const desktop = uniqueName(PREFIX);
  const group = `${desktop}-group`;

  test('creates a desktop with its new desktop group', async ({ page }) => {
    const modal = await openCreate(page);
    // Surrounding spaces are trimmed before saving.
    await modal.getByLabel(t.name, { exact: true }).fill(`  ${desktop}  `);
    await modal.getByLabel(t.newGroup, { exact: true }).fill(group);
    await submit(page).click();
    await expect(modal).toBeHidden();

    await expect(item(page, desktop).locator('.entity-name')).toHaveText(desktop);
    await expect(item(page, desktop)).toContainText(`Desktop groups: ${group}`);

    // The new group is listed on the desktop groups page, with this desktop in it.
    await page.goto(ROUTES.admin.desktopGroups);
    await expect(item(page, group)).toContainText(`Desktops: ${desktop}`);
  });

  test('a desktop whose new group name is taken is refused, with the reason', async ({ page }) => {
    const modal = await openCreate(page);
    await modal.getByLabel(t.name, { exact: true }).fill(`${desktop}-second`);
    await modal.getByLabel(t.newGroup, { exact: true }).fill(group);
    await submit(page).click();
    await expect(modal.getByRole('alert')).toContainText(`A desktop group '${group}' already exists`);
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(item(page, `${desktop}-second`)).toHaveCount(0);
  });

  test('the details page shows name, ID and groups', async ({ page }) => {
    await page.goto(ROUTES.admin.desktops);
    await page.getByRole('link', { name: labelFor(t.details, desktop) }).click();
    await expect(page).toHaveURL(/\/settings\/desktops\/\d+$/);
    await expect(pageTitle(page)).toHaveText(t.detailsTitle);
    const id = page.url().match(/(\d+)$/)![1];
    const details = page.locator('dl.detail-list');
    await expect(details.locator('dt')).toHaveText([t.name, 'ID', t.groupsTitle]);
    await expect(details.locator('dd')).toHaveText([desktop, id, group]);

    // Back leads to the list.
    await page.getByRole('link', { name: en.back, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.desktops}$`));
  });

  test('deletes the desktop after asking; its group is kept', async ({ page }) => {
    await page.goto(ROUTES.admin.desktops);
    await page.getByRole('link', { name: labelFor(t.details, desktop) }).click();
    await page.getByRole('button', { name: t.deleteDesktop }).click();
    const confirm = dialog(page, t.deleteDesktop);
    await expect(confirm).toContainText(`Delete the desktop "${desktop}"? Its desktop groups are kept.`);
    await confirm.getByRole('button', { name: en.delete, exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.desktops}$`));
    await expect(item(page, desktop)).toHaveCount(0);
    await page.goto(ROUTES.admin.desktopGroups);
    await expect(item(page, group)).toContainText(t.noDesktops);
  });
});
