// All settings of the e2e tests, read from .env (see .env.example).
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const value = (name: string, fallback = '') => (process.env[name] ?? '').trim() || fallback;
const flag = (name: string, fallback: boolean) => {
  const raw = value(name).toLowerCase();
  return raw ? raw === 'true' || raw === '1' || raw === 'yes' : fallback;
};

export type Role = 'user' | 'admin';

export interface Account {
  username: string;
  password: string;
}

export const env = {
  baseUrl: value('E2E_BASE_URL', 'https://localhost:8443').replace(/\/+$/, ''),
  ignoreHttpsErrors: flag('E2E_IGNORE_HTTPS_ERRORS', true),
  accounts: {
    user: { username: value('E2E_USER_USERNAME'), password: value('E2E_USER_PASSWORD') },
    admin: { username: value('E2E_ADMIN_USERNAME'), password: value('E2E_ADMIN_PASSWORD') },
  } as Record<Role, Account>,
  allowStartStop: flag('E2E_ALLOW_START_STOP', false),
  objectId: value('E2E_OBJECT_ID'),
  startTimeoutMs: Number(value('E2E_START_TIMEOUT', '600')) * 1000,
  containerId: value('E2E_CONTAINER_ID'),
};

export const hasAccount = (role: Role) => Boolean(env.accounts[role].username && env.accounts[role].password);

// Saved login (localStorage tokens) per role, written by auth.setup.ts.
export const storageStatePath = (role: Role) => path.resolve(__dirname, `../../.auth/${role}.json`);

export const missingAccountMessage = (role: Role) =>
  `No ${role} account: set E2E_${role.toUpperCase()}_USERNAME and E2E_${role.toUpperCase()}_PASSWORD in .env`;
