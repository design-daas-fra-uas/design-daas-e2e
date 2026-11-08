import fs from 'node:fs';
import path from 'node:path';
import { test as setup } from '@playwright/test';

import { login } from './support/app';
import { env, hasAccount, storageStatePath, type Role } from './support/env';

const EMPTY_STATE = JSON.stringify({ cookies: [], origins: [] });

// Logs in once per role and saves localStorage (the tokens) for the user and
// admin projects. Without an account an empty state is written, so those
// projects still start and their tests skip themselves.
for (const role of ['user', 'admin'] as Role[]) {
  setup(`log in as ${role}`, async ({ page }) => {
    const file = storageStatePath(role);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!hasAccount(role)) {
      fs.writeFileSync(file, EMPTY_STATE);
      setup.skip(true, `No ${role} account configured in .env`);
    }
    await login(page, role, env.accounts[role]);
    await page.context().storageState({ path: file });
  });
}
