// Direct calls to both backends with a saved login, for test data setup and cleanup.
// Tests still check everything through the UI; this only prepares and removes data,
// so a failed test never leaves e2e objects behind.
import { expect, type Browser, type BrowserContext } from '@playwright/test';

import { ROUTES } from './app';
import { env, storageStatePath, type Role } from './env';

type Method = 'get' | 'post' | 'patch' | 'delete';

export interface Account {
  id: number;
  name: string;
  email: string;
}

export interface Endpoint {
  id: number;
  functionName: string;
  description?: string;
}

export interface EndpointGroup {
  id: number;
  name: string;
  description?: string;
  endpointIds: number[];
}

export interface PermissionRule {
  id: number;
  kind: string;
  subjectId: number;
  targetId: number;
  targetName: string;
  allow: boolean;
}

export interface Desktop {
  id: number;
  description: string;
  groups: number[];
}

export interface DesktopGroup {
  id: number;
  description: string;
  desktopIds: number[];
}

export interface UserGroup {
  id: number;
  name: string;
  description?: string;
}

// One limit of the DaaS backend: counts, memory and disk in bytes, -1 = no limit.
export interface Limit {
  id_owner: number;
  vm_max: number;
  container_max: number;
  obj_max: number;
  cpu_max: number;
  mem_max: number;
  dsk_max: number;
}

export interface LimitOverview {
  limits: Limit[];
  syslimit: Limit;
  fallback: Limit;
}

export const LIMIT_KEYS = ['vm_max', 'container_max', 'obj_max', 'cpu_max', 'mem_max', 'dsk_max'] as const;

export class BackendApi {
  private constructor(
    private readonly context: BrowserContext,
    private readonly token: string,
    readonly daasUrl: string,
  ) {}

  // Logs in with the saved session of `role`. The DaaS URL is built into the frontend,
  // so it is taken from the request the "My resources" page sends.
  static async open(browser: Browser, role: Role = 'admin'): Promise<BackendApi> {
    const context = await browser.newContext({
      baseURL: env.baseUrl,
      ignoreHTTPSErrors: env.ignoreHttpsErrors,
      storageState: storageStatePath(role),
    });
    const page = await context.newPage();
    const quotaRequest = page.waitForRequest((request) => request.url().includes('/monitoring/get_quota'));
    await page.goto(ROUTES.user.quota);
    const daasUrl = (await quotaRequest).url().replace(/\/monitoring\/get_quota.*$/, '');
    const token = await page.evaluate(() => localStorage.getItem('userToken'));
    await page.close();
    expect(token, `no saved ${role} login`).toBeTruthy();
    return new BackendApi(context, token!, daasUrl);
  }

  async close() {
    await this.context.close();
  }

  // Java backend (REST + JSON).
  async auth<T>(method: Method, path: string, data?: unknown): Promise<T> {
    const response = await this.context.request.fetch(env.authApiUrl + path, {
      method,
      headers: { Authorization: this.token },
      data,
    });
    const text = await response.text();
    expect(response.ok(), `${method.toUpperCase()} ${path}: ${response.status()} ${text}`).toBe(true);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // DaaS backend (POST with form fields, { response_code, response_data }).
  async daas<T>(path: string, fields: Record<string, string | number>): Promise<T> {
    const multipart = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]));
    const response = await this.context.request.post(this.daasUrl + path, {
      headers: { Authorization: this.token, Accept: 'application/json' },
      multipart,
    });
    const body = await response.json();
    expect(body.response_code, `${path}: ${JSON.stringify(body)}`).toBe(200);
    return body.response_data as T;
  }

  users = () => this.auth<Account[]>('get', '/users');
  async userByEmail(email: string) {
    const user = (await this.users()).find((account) => account.email === email);
    expect(user, `no account ${email}`).toBeDefined();
    return user!;
  }

  endpoints = () => this.auth<Endpoint[]>('get', '/endpoints');
  endpointGroups = () => this.auth<EndpointGroup[]>('get', '/endpoint_groups');
  rules = () => this.auth<PermissionRule[]>('get', '/permission_rules');
  desktops = () => this.auth<Desktop[]>('get', '/desktops');
  desktopGroups = () => this.auth<DesktopGroup[]>('get', '/desktop_groups');
  userGroups = () => this.auth<UserGroup[]>('get', '/user_groups');

  limitOverview = () => this.daas<LimitOverview>('/admin/get_monitor_info_limits', { id_owner: '' });
  putLimit = (limit: Limit) => this.daas('/limits/put_limit', { ...limit });
  removeLimit = (idOwner: number) => this.daas('/limits/remove_limit', { id_owner: idOwner });

  // Cleanup: removes everything whose name starts with `prefix`. Never touches other data.
  async deleteByPrefix(prefix: string) {
    for (const desktop of await this.desktops()) {
      if (desktop.description.startsWith(prefix)) await this.auth('delete', `/desktop/${desktop.id}`);
    }
    for (const group of await this.desktopGroups()) {
      if (group.description.startsWith(prefix)) await this.auth('delete', `/desktop_group/${group.id}`);
    }
    const groups = (await this.endpointGroups()).filter((group) => group.name.startsWith(prefix));
    for (const rule of await this.rules()) {
      if (groups.some((group) => group.name === rule.targetName)) {
        await this.auth('delete', `/permission_rule/${rule.kind}/${rule.id}`);
      }
    }
    for (const group of groups) await this.auth('delete', `/endpoint_group/${group.id}`);
  }
}

// Unique per run, so reruns and leftovers of a crashed run never collide.
export const uniqueName = (prefix: string) => `${prefix}${Date.now().toString(36)}`;
