import { expect, test, type Browser, type Page } from '@playwright/test';

import { BackendApi, type Account, type Limit } from '../support/api';
import { ROUTES, expectNoRenderError, pageTitle } from '../support/app';
import { env, hasAccount, missingAccountMessage, storageStatePath } from '../support/env';
import { en } from '../support/texts';

test.skip(!hasAccount('admin'), missingAccountMessage('admin'));

// Per-user resource limits of the DaaS backend. The tests change the limit of the e2e user
// only, and put back exactly what it had before (its own limit, or none) in afterAll.
const t = en.limits;
const GIB = 1024 ** 3;

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const submit = (page: Page) => page.getByRole('button', { name: en.submit, exact: true });
const card = (page: Page, title: string) => page.locator('.panel').filter({ has: page.getByRole('heading', { name: title }) });

// Opens "My resources" as the e2e user and returns the text of every card.
async function userQuota(browser: Browser) {
  const context = await browser.newContext({
    baseURL: env.baseUrl,
    ignoreHTTPSErrors: env.ignoreHttpsErrors,
    storageState: storageStatePath('user'),
  });
  const page = await context.newPage();
  await page.goto(ROUTES.user.quota);
  await expect(page.locator('.stat-card')).toHaveCount(6, { timeout: 30_000 });
  const result = {
    source: await page.locator('.page-intro').innerText(),
    cards: await page.locator('.stat-card').allInnerTexts(),
  };
  await context.close();
  return result;
}

test.describe('limitation page', () => {
  test('shows the default limit, the system maximum and the limits per user', async ({ page }) => {
    await page.goto(ROUTES.admin.root);
    await page.getByRole('link', { name: t.title }).first().click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.admin.limitation}$`));
    await expect(pageTitle(page)).toHaveText(t.title);

    for (const title of [t.defaultTitle, t.systemTitle]) {
      const terms = card(page, title).locator('dt');
      await expect(terms).toHaveText(t.fields);
      // A number, a size or "Unlimited" for every field.
      for (const value of await card(page, title).locator('dd').allInnerTexts()) {
        expect(value).toMatch(/^(\d+|\d+(\.\d)? (B|KiB|MiB|GiB|TiB)|Unlimited)$/);
      }
    }
    const table = card(page, t.perUserTitle).getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([t.account, ...t.fields, '']);
    await expectNoRenderError(page);
  });

  test('the form needs an account and checks every value', async ({ page }) => {
    await page.goto(ROUTES.admin.limitation);
    await page.getByRole('button', { name: t.create }).click();
    const modal = dialog(page, t.create);
    // A new limit starts with the default limit's values.
    await submit(page).click();
    await expect(modal.getByText(t.errorAccount)).toBeVisible();

    const vms = modal.getByLabel(t.fields[0], { exact: true });
    await vms.fill('');
    await vms.blur();
    await expect(modal.getByText(t.errorRequired)).toBeVisible();
    await vms.fill('-1');
    await vms.blur();
    await expect(modal.getByText(t.errorNumber)).toBeVisible();

    // "No limit" turns the input off and removes its error.
    await modal.locator('#limit-vm_max-unlimited').check();
    await expect(vms).toBeDisabled();
    await expect(vms).toHaveAttribute('placeholder', t.unlimited);
    await expect(modal.getByText(t.errorNumber)).toHaveCount(0);
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toBeHidden();
  });
});

// Changes the e2e user's limit through the page and checks that the user sees it
// on "My resources", then removes it so the default limit applies.
test.describe('limit of the e2e user', () => {
  test.skip(!hasAccount('user'), missingAccountMessage('user'));
  test.describe.configure({ mode: 'serial' });

  let user: Account;
  let original: Limit | undefined;
  let fallback: Limit;

  test.beforeAll(async ({ browser }) => {
    const api = await BackendApi.open(browser);
    user = await api.userByEmail(env.accounts.user.username);
    const overview = await api.limitOverview();
    original = overview.limits.find((limit) => limit.id_owner === user.id);
    fallback = overview.fallback;
    await api.close();
  });

  test.afterAll(async ({ browser }) => {
    const api = await BackendApi.open(browser);
    if (original) {
      await api.putLimit(original);
    } else if ((await api.limitOverview()).limits.some((limit) => limit.id_owner === user.id)) {
      await api.removeLimit(user.id);
    }
    await api.close();
  });

  const row = (page: Page) => page.getByRole('row').filter({ hasText: env.accounts.user.username });

  test('sets an own limit, shown in the table and on the user\'s "My resources"', async ({ page, browser }) => {
    await page.goto(ROUTES.admin.limitation);
    if (original) {
      await page.getByRole('button', { name: `${t.edit} ${user.name}` }).click();
    } else {
      await page.getByRole('button', { name: t.create }).click();
    }
    const modal = dialog(page, original ? t.edit : t.create);
    const account = modal.getByLabel(t.account, { exact: true });
    if (original) {
      // The account of an existing limit cannot be changed.
      await expect(account).toBeDisabled();
      await expect(account).toHaveValue(String(user.id));
    } else {
      await account.selectOption(String(user.id));
    }

    const values = ['1', '2', '3', '5', '1.5'];
    for (const [index, value] of values.entries()) {
      const input = modal.getByLabel(t.fields[index], { exact: true });
      const unlimited = modal.locator('.limit-field').nth(index).getByRole('checkbox');
      await unlimited.uncheck();
      await input.fill(value);
    }
    // Disk without a limit.
    await modal.locator('#limit-dsk_max-unlimited').check();
    await submit(page).click();
    await expect(modal).toBeHidden();

    await expect(row(page).getByRole('cell')).toHaveText([
      new RegExp(user.name),
      '1',
      '2',
      '3',
      '5',
      '1.5 GiB',
      t.unlimited,
      '',
    ]);

    const quota = await userQuota(browser);
    expect(quota.source).toBe(en.quota.sourceUser);
    expect(quota.cards[0]).toMatch(/\/ 1\b/);
    expect(quota.cards[1]).toMatch(/\/ 2\b/);
    expect(quota.cards[2]).toMatch(/\/ 3\b/);
    expect(quota.cards[3]).toMatch(/\/ 5\b/);
    expect(quota.cards[4]).toMatch(/\/ 1\.5 GiB/);
    expect(quota.cards[5]).toMatch(/\/ No limit/);
  });

  test('the edit form shows the stored values again', async ({ page }) => {
    await page.goto(ROUTES.admin.limitation);
    await page.getByRole('button', { name: `${t.edit} ${user.name}` }).click();
    const modal = dialog(page, t.edit);
    for (const [index, value] of ['1', '2', '3', '5', '1.5'].entries()) {
      await expect(modal.getByLabel(t.fields[index], { exact: true })).toHaveValue(value);
    }
    await expect(modal.getByLabel('Disk', { exact: true })).toBeDisabled();
    await expect(modal.locator('#limit-dsk_max-unlimited')).toBeChecked();
  });

  test('removing the limit gives the user the default limit', async ({ page, browser }) => {
    await page.goto(ROUTES.admin.limitation);
    await page.getByRole('button', { name: `${t.remove} ${user.name}` }).click();
    const confirm = dialog(page, t.remove);
    await expect(confirm).toContainText(`Remove the limit of "${user.name}"?`);
    await confirm.getByRole('button', { name: en.delete, exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(row(page)).toHaveCount(0);

    const quota = await userQuota(browser);
    expect(quota.source).toBe(en.quota.sourceFallback);
    const vms = fallback.vm_max < 0 ? 'No limit' : String(fallback.vm_max);
    expect(quota.cards[0]).toContain(`/ ${vms}`);
    if (fallback.mem_max >= GIB && fallback.mem_max < 1024 * GIB) {
      expect(quota.cards[4]).toContain(`/ ${(fallback.mem_max / GIB).toFixed(1)} GiB`);
    }
  });
});
