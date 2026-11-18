// Tests of a user function, framed by its permission:
//   1. without a rule the function is denied
//   2. the admin allows its endpoints to the e2e user, then it works
//   3. the function's own tests run
//   4. the rules are deleted, then it is denied again
// With enable_auth_endpoint = true, design-daas denies every endpoint that no rule allows.
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { BackendApi, type PermissionRule } from './api';
import { login } from './app';
import { env, hasAccount, missingAccountMessage } from './env';
import { en } from './texts';

export interface UserFeature {
  // Shown in the test titles, e.g. "my resources".
  name: string;
  // design-daas endpoint names the function needs (Permissions page → Endpoints).
  endpoints: string[];
  // Page that shows the function.
  path: string;
  // Visible once the function worked.
  allowed: (page: Page) => Locator;
}

// A fresh login of the e2e user in its own browser context. The saved session is not used:
// design-daas answers a denied endpoint with 401, the frontend then rotates the refresh
// token, and every other context with the saved token would be logged out.
export async function loginUser(browser: Browser): Promise<BrowserContext> {
  // An explicit empty state: otherwise the project's saved session would be used.
  const context = await browser.newContext({
    baseURL: env.baseUrl,
    ignoreHTTPSErrors: env.ignoreHttpsErrors,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await login(page, 'user', env.accounts.user);
  await closeSettled(page);
  return context;
}

// Closes a page of the e2e user once its requests are done. A denied request makes the
// frontend refresh the session; closing the page during that refresh loses the new tokens
// while the old refresh token is already revoked, and the user is logged out.
export async function closeSettled(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.close();
}

// Opens the feature's page and tells whether it worked or showed "No permission".
export async function featureAllowed(context: BrowserContext, feature: UserFeature): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(feature.path);
    const allowed = feature.allowed(page);
    const denied = page.getByRole('heading', { name: en.noPermission });
    await expect(allowed.or(denied).first()).toBeVisible({ timeout: 30_000 });
    return await allowed.first().isVisible();
  } finally {
    await closeSettled(page);
  }
}

// Waits until the answer changed: design-daas reuses an answer for up to 30 s.
export const expectFeatureAllowed = (context: BrowserContext, feature: UserFeature, allowed: boolean) =>
  expect
    .poll(() => featureAllowed(context, feature), {
      message: `${feature.name} should be ${allowed ? 'allowed' : 'denied'} for the e2e user`,
      timeout: env.permissionCacheMs,
      intervals: [5_000],
    })
    .toBe(allowed);

// Allow rules (account → endpoint) for the e2e user, created and removed through the API.
export class UserGrant {
  private rules: PermissionRule[] = [];

  constructor(private readonly browser: Browser, private readonly endpoints: string[]) {}

  // Endpoints that already have an own rule of the e2e user: the test would change them.
  async conflicts(): Promise<string[]> {
    const api = await BackendApi.open(this.browser);
    try {
      const user = await api.userByEmail(env.accounts.user.username);
      return (await api.rules())
        .filter((rule) => rule.kind === 'USER_ENDPOINT' && rule.subjectId === user.id)
        .map((rule) => rule.targetName)
        .filter((name) => this.endpoints.includes(name));
    } finally {
      await api.close();
    }
  }

  async grant() {
    const api = await BackendApi.open(this.browser);
    try {
      const user = await api.userByEmail(env.accounts.user.username);
      const endpoints = await api.endpoints();
      for (const name of this.endpoints) {
        const endpoint = endpoints.find((e) => e.functionName === name);
        expect(endpoint, `design-daas has no endpoint ${name}`).toBeDefined();
        await api.auth('post', '/permission_rule', {
          kind: 'USER_ENDPOINT',
          subjectId: user.id,
          targetId: endpoint!.id,
          allow: true,
        });
      }
      this.rules = (await api.rules()).filter(
        (rule) => rule.kind === 'USER_ENDPOINT' && rule.subjectId === user.id && this.endpoints.includes(rule.targetName),
      );
      expect(this.rules).toHaveLength(this.endpoints.length);
    } finally {
      await api.close();
    }
  }

  // Safe to call twice: only rules this grant created and that still exist are deleted.
  async revoke() {
    if (this.rules.length === 0) return;
    const api = await BackendApi.open(this.browser);
    try {
      const existing = await api.rules();
      for (const rule of this.rules) {
        if (existing.some((r) => r.kind === rule.kind && r.id === rule.id)) {
          await api.auth('delete', `/permission_rule/${rule.kind}/${rule.id}`);
        }
      }
      this.rules = [];
    } finally {
      await api.close();
    }
  }
}

// Registers the permission frame around `body`. The tests in `body` get a page of the
// logged-in e2e user through `userPage()`, while the endpoints are allowed.
export function describeWithPermission(feature: UserFeature, body: (userPage: () => Page) => void) {
  test.describe(`${feature.name} (needs ${feature.endpoints.join(', ')})`, () => {
    test.skip(!hasAccount('user'), missingAccountMessage('user'));
    test.skip(!hasAccount('admin'), missingAccountMessage('admin'));
    test.describe.configure({ mode: 'serial', timeout: 2 * env.permissionCacheMs + 60_000 });

    let context: BrowserContext;
    let grant: UserGrant;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      grant = new UserGrant(browser, feature.endpoints);
      const conflicts = await grant.conflicts();
      test.skip(conflicts.length > 0, `The e2e user already has own rules for ${conflicts.join(', ')}`);
      context = await loginUser(browser);
    });

    test.afterAll(async () => {
      await grant?.revoke();
      await context?.close();
    });

    test.beforeEach(async () => {
      page = await context.newPage();
    });

    test.afterEach(async () => {
      if (page) await closeSettled(page);
    });

    test('is denied without a permission rule', async () => {
      await expectFeatureAllowed(context, feature, false);
      await page.goto(feature.path);
      await expect(page.getByText(en.permissionDeniedHint)).toBeVisible({ timeout: 30_000 });
    });

    test('works once the admin allows its endpoints', async () => {
      await grant.grant();
      await expectFeatureAllowed(context, feature, true);
    });

    body(() => page);

    test('is denied again after the rules are deleted', async () => {
      await grant.revoke();
      await expectFeatureAllowed(context, feature, false);
    });
  });
}
