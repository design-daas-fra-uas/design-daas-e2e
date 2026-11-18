import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { expectFeatureAllowed, loginUser } from '../support/access';
import { BackendApi, uniqueName, type Account } from '../support/api';
import { ROUTES, expectNoRenderError, pageTitle } from '../support/app';
import { env, hasAccount, missingAccountMessage } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('admin'), missingAccountMessage('admin'));

// Admin page of the Java permission rules (Rules / Endpoint groups / Endpoints).
// Every name the tests create starts with PREFIX and is removed again in afterAll.
const PREFIX = 'e2e-perm-';
const t = en.permissions;

const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}\\s*\\d+$`) });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const submit = (page: Page) => page.getByRole('button', { name: en.submit, exact: true });

async function openTab(page: Page, name: string) {
  await page.goto(ROUTES.admin.permissions);
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
}

// Opens a search select by its label, types into it and picks the option with that label.
async function pick(page: Page, label: string, option: string) {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.click();
  await input.fill(option);
  await page.getByRole('listbox').filter({ visible: true }).getByRole('option', { name: new RegExp(`^${option}\\b`) }).first().click();
}

test.afterAll(async ({ browser }) => {
  const api = await BackendApi.open(browser);
  await api.deleteByPrefix(PREFIX);
  await api.close();
});

test.describe('permissions page', () => {
  test('is linked from the admin dashboard and shows three tabs with counts', async ({ page }) => {
    await page.goto(ROUTES.admin.root);
    await page.getByRole('link', { name: t.title }).first().click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.permissions}$`));
    await expect(pageTitle(page)).toHaveText(t.title);
    for (const name of [t.rulesTab, t.groupsTab, t.endpointsTab]) {
      await expect(tab(page, name)).toBeVisible();
    }
    await expect(tab(page, t.rulesTab)).toHaveAttribute('aria-selected', 'true');
    await expectNoRenderError(page);
  });

  test('the endpoints are the synced routes of design-daas, with typed permissions, read-only', async ({ page }) => {
    await openTab(page, t.endpointsTab);
    const panel = page.getByRole('tabpanel', { name: new RegExp(t.endpointsTab) });
    await expect(panel.getByText(t.endpointsHint)).toBeVisible();
    // Only rules and groups can be created; the endpoint list comes from design-daas.
    await expect(panel.getByRole('button', { name: /create/i })).toHaveCount(0);

    const names = panel.locator('code.endpoint-name');
    await expect(names.first()).toBeVisible();
    const all = await names.allInnerTexts();
    expect(all).toContain('get_quota');
    // Routes that create a VM or a container also have one permission per type.
    expect(all).toEqual(expect.arrayContaining(['baseimage_create', 'baseimage_create_vm', 'baseimage_create_container']));
    expect([...all].sort((a, b) => a.localeCompare(b))).toEqual(all);

    const search = panel.getByRole('searchbox');
    await search.fill('baseimage_create_');
    await expect(names).not.toHaveCount(all.length);
    for (const name of await names.allInnerTexts()) expect(name).toContain('baseimage_create_');
    await expect(panel.getByText(new RegExp(`^\\d+ of ${all.length}$`))).toBeVisible();
    await search.fill('zz-e2e-no-endpoint-has-this-name');
    await expect(panel.getByText(t.noMatches)).toBeVisible();
  });

  test('the rule form requires who and what, and changing the kind clears them', async ({ page }) => {
    const api = await BackendApi.open(page.context().browser()!);
    const users = await api.users();
    await api.close();
    test.skip(users.length === 0, 'No user account to pick');

    await page.goto(ROUTES.admin.permissions);
    await page.getByRole('button', { name: t.createRule }).click();
    const modal = dialog(page, t.createRule);
    await expect(modal.getByLabel(t.kind)).toHaveValue('USER_ENDPOINT');
    await submit(page).click();
    await expect(modal.getByRole('alert').filter({ hasText: en.required })).toHaveCount(2);

    await pick(page, t.account, users[0].name);
    await pick(page, t.endpoint, 'get_quota');
    await expect(modal.getByRole('alert').filter({ hasText: en.required })).toHaveCount(0);

    // Kind 4 asks for a user group and an endpoint group instead; the picks are gone.
    await modal.getByLabel(t.kind).selectOption({ label: t.kindGroupEndpointGroup });
    await expect(modal.getByRole('combobox', { name: 'Group', exact: true })).toHaveValue('');
    await expect(modal.getByRole('combobox', { name: t.endpointGroup, exact: true })).toHaveValue('');
    await expect(modal.getByRole('combobox', { name: t.account, exact: true })).toHaveCount(0);
  });
});

test.describe('endpoint groups', () => {
  test.describe.configure({ mode: 'serial' });
  const name = uniqueName(PREFIX);

  test('creates a group of endpoints, and a second one with the same name is refused', async ({ page }) => {
    await openTab(page, t.groupsTab);
    const before = Number((await tab(page, t.groupsTab).innerText()).match(/\d+$/)![0]);
    await page.getByRole('button', { name: t.createGroup }).click();
    const modal = dialog(page, t.createGroup);
    // Submit stays disabled until something was typed (requireDirty).
    await expect(submit(page)).toBeDisabled();

    await modal.getByLabel('Name', { exact: true }).fill(name);
    await modal.getByLabel('Description', { exact: true }).fill('created by the e2e tests');
    for (const endpoint of ['get_quota', 'baseimage_create_vm']) {
      const input = modal.getByRole('combobox', { name: t.endpointsTab, exact: true });
      await input.click();
      await input.fill(endpoint);
      await page.getByRole('listbox').filter({ visible: true }).getByRole('option', { name: new RegExp(`^${endpoint}\\b`) }).click();
      await input.press('Escape');
    }
    await expect(modal.getByRole('list', { name: '2 selected' })).toBeVisible();
    await submit(page).click();
    await expect(modal).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('created by the e2e tests');
    await expect(row.locator('.count-badge')).toHaveText('2');
    await expect(row.locator('.tag-pill')).toHaveText(['baseimage_create_vm', 'get_quota']);
    await expect(tab(page, t.groupsTab)).toHaveText(new RegExp(`${before + 1}$`));

    await page.getByRole('button', { name: t.createGroup }).click();
    await modal.getByLabel('Name', { exact: true }).fill(name);
    await submit(page).click();
    await expect(modal.getByRole('alert')).toContainText(`An endpoint group '${name}' already exists`);
    await expect(modal).toBeVisible();
  });

  test('the endpoints tab names the groups an endpoint is in', async ({ page }) => {
    await openTab(page, t.endpointsTab);
    await page.getByRole('searchbox').fill('get_quota');
    await expect(page.getByRole('row').filter({ hasText: 'get_quota' }).locator('.tag-pill', { hasText: name })).toBeVisible();
  });

  test('edits the group: new description, one endpoint less', async ({ page }) => {
    await openTab(page, t.groupsTab);
    await page.getByRole('searchbox').fill(name);
    await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
    await page.getByRole('button', { name: `Edit: ${name}` }).click();
    const modal = dialog(page, t.editGroup);
    await expect(modal.getByLabel('Name', { exact: true })).toHaveValue(name);
    await modal.getByLabel('Description', { exact: true }).fill('edited by the e2e tests');
    await modal.getByRole('button', { name: 'Remove: baseimage_create_vm' }).click();
    await submit(page).click();
    await expect(modal).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('edited by the e2e tests');
    await expect(row.locator('.tag-pill')).toHaveText(['get_quota']);
  });

  test('deletes the group after asking', async ({ page }) => {
    await openTab(page, t.groupsTab);
    await page.getByRole('button', { name: `${en.delete} ${name}` }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete endpoint group' });
    await expect(confirm).toContainText(`Delete "${name}"? This cannot be undone.`);
    // "No" keeps it.
    await confirm.getByRole('button', { name: en.no, exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();

    await page.getByRole('button', { name: `${en.delete} ${name}` }).click();
    await confirm.getByRole('button', { name: en.delete, exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });
});

// The whole chain: a rule set on this page decides what design-daas lets the e2e user do.
// Kind 1 (account → endpoint) is checked first, so it wins over every group rule.
test.describe('a rule takes effect for the user', () => {
  test.skip(!hasAccount('user'), missingAccountMessage('user'));
  test.describe.configure({ mode: 'serial', timeout: 3 * env.permissionCacheMs + 60_000 });

  let user: Account;
  let createdRule: { kind: string; id: number } | undefined;

  const MY_RESOURCES = {
    name: 'my resources',
    endpoints: ['get_quota'],
    path: ROUTES.user.quota,
    allowed: (page: Page) => page.locator('.stat-card'),
  };
  // One fresh login of the e2e user for the whole test (see support/access.ts).
  let userContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    const api = await BackendApi.open(browser);
    user = await api.userByEmail(env.accounts.user.username);
    const endpoint = (await api.endpoints()).find((e) => e.functionName === 'get_quota')!;
    const existing = (await api.rules()).find(
      (rule) => rule.kind === 'USER_ENDPOINT' && rule.subjectId === user.id && rule.targetId === endpoint.id,
    );
    await api.close();
    test.skip(Boolean(existing), 'The e2e user already has an own get_quota rule; the test would change it');
    userContext = await loginUser(browser);
  });

  test.afterAll(async ({ browser }) => {
    await userContext?.close();
    if (!createdRule) return;
    const api = await BackendApi.open(browser);
    const rule = (await api.rules()).find((r) => r.kind === createdRule!.kind && r.id === createdRule!.id);
    if (rule) await api.auth('delete', `/permission_rule/${rule.kind}/${rule.id}`);
    await api.close();
  });

  test('an allow rule set on this page opens "My resources" for the user; deleting it closes it again', async ({ page, browser }) => {
    // Without a rule the user is denied. Waits for a cached answer of an earlier test to run out.
    await expectFeatureAllowed(userContext, MY_RESOURCES, false);
    const decision = t.allow;

    await page.goto(ROUTES.admin.permissions);
    await page.getByRole('button', { name: t.createRule }).click();
    const modal = dialog(page, t.createRule);
    await pick(page, t.account, user.name);
    await pick(page, t.endpoint, 'get_quota');
    // The radio itself is hidden behind its styled label.
    await modal.locator('label.segmented-option', { hasText: decision }).click();
    await expect(modal.getByRole('radio', { name: decision })).toBeChecked();
    await submit(page).click();
    await expect(modal).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: user.name }).filter({ hasText: 'get_quota' });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.decision-pill')).toHaveText(decision);
    await expect(row).toContainText('Account → endpoint');
    const api = await BackendApi.open(browser);
    const rule = (await api.rules()).find((r) => r.kind === 'USER_ENDPOINT' && r.subjectId === user.id && r.targetName === 'get_quota')!;
    await api.close();
    createdRule = { kind: rule.kind, id: rule.id };

    // The same rule twice is refused by the backend; the reason is shown.
    await page.getByRole('button', { name: t.createRule }).click();
    await pick(page, t.account, user.name);
    await pick(page, t.endpoint, 'get_quota');
    await submit(page).click();
    await expect(modal.getByRole('alert')).toContainText('already exists');
    await modal.getByRole('button', { name: 'Close' }).click();

    await expectFeatureAllowed(userContext, MY_RESOURCES, true);

    await page.getByRole('searchbox').fill('get_quota');
    await row.getByRole('button', { name: `${en.delete} Rule` }).click();
    await page.getByRole('dialog', { name: 'Delete rule' }).getByRole('button', { name: en.delete, exact: true }).click();
    await expect(row).toHaveCount(0);
    createdRule = undefined;

    await expectFeatureAllowed(userContext, MY_RESOURCES, false);
  });
});
