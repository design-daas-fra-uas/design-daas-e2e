import { expect, type Page } from '@playwright/test';

import { type Account, type Role } from './env';
import { en } from './texts';

// Page paths of the frontend (mirrors src/routes.js).
export const ROUTES = {
  login: '/',
  registration: '/registration',
  dashboard: '/dashboard',
  user: {
    monitoring: '/dashboard/monitoring',
    connectionRun: '/dashboard/connectionRun',
  },
  admin: {
    root: '/dashboard/admin',
    settings: '/dashboard/admin/settings',
    monitoring: '/dashboard/admin/monitoring',
    limitation: '/dashboard/admin/limitation',
    tasks: '/dashboard/admin/tasks',
    users: '/dashboard/admin/settings/users',
    admins: '/dashboard/admin/settings/admins',
    desktops: '/dashboard/admin/settings/desktops',
    desktopGroups: '/dashboard/admin/settings/desktop-groups',
    vmEnvironment: '/dashboard/admin/settings/vm-environment',
    nodeConfiguration: '/dashboard/admin/settings/node-configuration',
    connections: '/dashboard/admin/settings/connections',
    instances: '/dashboard/admin/settings/instances',
    docker: '/dashboard/admin/settings/docker',
    phases: '/dashboard/admin/settings/phases',
    adminAssign: '/dashboard/admin/settings/admin-assign',
    apps: '/dashboard/admin/settings/apps',
    files: '/dashboard/admin/settings/files',
  },
};

const tabName = (role: Role) => (role === 'admin' ? en.adminTab : en.userTab);

// Fills the login form of the given tab and submits it (does not wait for the result).
export async function submitLogin(page: Page, role: Role, { username, password }: Account) {
  await page.goto(ROUTES.login);
  await page.getByRole('tab', { name: tabName(role), exact: true }).click();
  await page.locator(`#${role}-username`).fill(username);
  await page.locator(`#${role}-password`).fill(password);
  await page.getByRole('button', { name: en.submit }).click();
}

// Logs in through the UI and waits for the user dashboard.
export async function login(page: Page, role: Role, account: Account) {
  await submitLogin(page, role, account);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: en.overview })).toBeVisible();
}

// Asserts the page rendered without hitting the app's error boundary.
export async function expectNoRenderError(page: Page) {
  await expect(page.getByText(en.renderError)).toHaveCount(0);
}

// The page heading of every view uses the "page-title" class.
export const pageTitle = (page: Page) => page.locator('h2.page-title');
