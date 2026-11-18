import { expect, test, type Page } from '@playwright/test';

import { BackendApi, uniqueName, type UserGroup } from '../support/api';
import { ROUTES, expectNoRenderError, labelFor, pageTitle } from '../support/app';
import { hasAccount, missingAccountMessage } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('admin'), missingAccountMessage('admin'));

// Desktop groups (Java backend): create, give a user group access, delete.
// Every name starts with PREFIX and is removed again in afterAll.
const PREFIX = 'e2e-dgroup-';
const t = en.desktops;

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const submit = (page: Page) => page.getByRole('button', { name: en.submit, exact: true });
const item = (page: Page, name: string) => page.locator('.entity-list li').filter({ hasText: name });

test.afterAll(async ({ browser }) => {
  const api = await BackendApi.open(browser);
  await api.deleteByPrefix(PREFIX);
  await api.close();
});

test.describe('desktop groups page', () => {
  test('is linked from the admin dashboard and counts its groups', async ({ page }) => {
    await page.goto(ROUTES.admin.root);
    await page.locator('#dashboardAdmin').getByRole('link', { name: t.groupsTitle, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.desktopGroups}$`));
    await expect(pageTitle(page)).toHaveText(t.groupsTitle);
    // The badge shows 0 while loading: wait for the list (or its empty state) first.
    await expect(page.locator('.entity-list li').or(page.locator('.empty-state')).first()).toBeVisible();
    const heading = page.getByRole('heading', { name: new RegExp(`^${t.groupsTitle} \\d+$`) });
    const count = Number((await heading.innerText()).match(/\d+$/)![0]);
    await expect(page.locator('.entity-list li')).toHaveCount(count);
    await expectNoRenderError(page);
  });

  test('the create form needs a name', async ({ page }) => {
    await page.goto(ROUTES.admin.desktopGroups);
    await page.getByRole('button', { name: t.newGroup }).click();
    const modal = dialog(page, t.createGroup);
    await modal.getByLabel(t.name, { exact: true }).fill('   ');
    await submit(page).click();
    await expect(modal.getByText(t.errorGroupName)).toBeVisible();
  });
});

test.describe('desktop group lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  const group = uniqueName(PREFIX);
  let userGroup: UserGroup | undefined;

  test.beforeAll(async ({ browser }) => {
    const api = await BackendApi.open(browser);
    userGroup = (await api.userGroups())[0];
    await api.close();
  });

  test('creates a group, and the same name again is refused', async ({ page }) => {
    await page.goto(ROUTES.admin.desktopGroups);
    await page.getByRole('button', { name: t.newGroup }).click();
    const modal = dialog(page, t.createGroup);
    await modal.getByLabel(t.name, { exact: true }).fill(group);
    await submit(page).click();
    await expect(modal).toBeHidden();
    await expect(item(page, group)).toContainText(t.noDesktops);

    await page.getByRole('button', { name: t.newGroup }).click();
    await modal.getByLabel(t.name, { exact: true }).fill(group);
    await submit(page).click();
    await expect(modal.getByRole('alert')).toContainText(`A desktop group '${group}' already exists`);
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(item(page, group)).toHaveCount(1);
  });

  test('gives a user group access, once', async ({ page }) => {
    test.skip(!userGroup, 'There is no user group to add');
    await page.goto(ROUTES.admin.desktopGroups);
    await page.getByRole('button', { name: labelFor(t.addUserGroup, group) }).click();
    const modal = dialog(page, `Add user group to the desktop group: ${group}`);
    // Nothing is preselected: adding must be a deliberate choice.
    const select = modal.getByLabel(t.selectUserGroup, { exact: true });
    await expect(select).toHaveValue('');
    await select.selectOption(String(userGroup!.id));
    await submit(page).click();
    await expect(modal).toBeHidden();
    await expect(page.getByRole('status')).toHaveText(t.userGroupAdded);

    // The same user group a second time is refused by the backend.
    await page.getByRole('button', { name: labelFor(t.addUserGroup, group) }).click();
    await modal.getByLabel(t.selectUserGroup, { exact: true }).selectOption(String(userGroup!.id));
    await submit(page).click();
    await expect(modal.getByRole('alert')).toContainText('is already associated');
  });

  test('deletes the group after asking', async ({ page }) => {
    await page.goto(ROUTES.admin.desktopGroups);
    await expect(item(page, group)).toHaveCount(1);
    const before = await page.locator('.entity-list li').count();
    await page.getByRole('button', { name: labelFor(en.delete, group) }).click();
    const confirm = dialog(page, t.deleteGroup);
    await expect(confirm).toContainText(group);
    await confirm.getByRole('button', { name: en.no, exact: true }).click();
    await expect(item(page, group)).toHaveCount(1);

    await page.getByRole('button', { name: labelFor(en.delete, group) }).click();
    await confirm.getByRole('button', { name: en.delete, exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(item(page, group)).toHaveCount(0);
    await expect(page.locator('.entity-list li')).toHaveCount(before - 1);
  });
});
