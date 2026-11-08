# design-daas-e2e

End-to-end tests for the DESIGN DaaS stack, written with [Playwright](https://playwright.dev)
and TypeScript. They drive the real frontend in Chromium against the running stack:

| Part | Repository | Default address |
| --- | --- | --- |
| Frontend (React, nginx) | `design-daas-application-frontend` | `https://<host>:8443` |
| Auth service (Java) | `design-daas-backend-java` | `https://<host>:8443/auth` → `127.0.0.1:8080` |
| DaaS backend (Python) | `design-daas` | `https://<host>` → `127.0.0.1:5000` |

The tests only use the browser, so they test whatever is deployed. They do not start the stack.

## Setup

Requirements: Node.js 18 or newer, plus a running stack (`make install` in `design-daas/installer`).

```bash
npm install
npm run install:browsers     # downloads Playwright's Chromium into node_modules (once)
cp .env.example .env         # then edit .env
```

`.env` settings (see `.env.example`):

- `E2E_BASE_URL`: frontend URL. Use the host name the frontend was built for
  (`FRONTEND_PUBLIC_URL` in `installer/daas.env`), e.g. `https://front0.cluster.local:8443`.
  The auth service only allows that origin (CORS). From `localhost`, every login fails.
- `E2E_IGNORE_HTTPS_ERRORS`: `true` for the self-signed certificate of the local nginx.
- `E2E_USER_USERNAME` / `E2E_USER_PASSWORD`: an existing account with the role *user*.
- `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD`: an admin, e.g. the bootstrap admin
  (`ADMIN_EMAIL` / `ADMIN_PASSWORD` from `daas.env`).
- `E2E_ALLOW_START_STOP`, `E2E_OBJECT_ID`, `E2E_START_TIMEOUT`: opt-in test that really
  starts and stops an object (VM/container) of the test user.

Chromium is kept inside `node_modules` (`PLAYWRIGHT_BROWSERS_PATH=0`, also set in
`playwright.config.ts`), so the tests work for any system user. Run them as the user that
owns this folder, though: a run as root leaves root-owned `test-results/` and
`playwright-report/` behind, which the next normal run cannot overwrite.

Tests that need a login are **skipped** (not failed) while their account is empty.
`.env` is git-ignored, so passwords never end up in the repository.

## Running

```bash
npm test                  # everything
npm run test:public       # login page, route guards, 404 (no accounts needed)
npm run test:user         # user dashboard and monitoring
npm run test:admin        # admin dashboard, settings pages, monitoring
npm run test:session      # login + logout for user and admin
npm run test:headed       # watch the browser
npm run test:ui           # Playwright UI mode
npm run report            # open the HTML report of the last run
npm run typecheck
```

On failure, Playwright keeps a screenshot and a trace under `test-results/`.
Open a trace with `npx playwright show-trace <file>`.

## What is covered

| Project | File | Flows |
| --- | --- | --- |
| `setup` | `tests/auth.setup.ts` | Logs in the user and the admin through the UI once and saves their session (`.auth/`). |
| `public` | `tests/public/login.spec.ts` | Login form, user/admin tabs, submit validation, wrong credentials (both tabs), registration link, language switch EN/DE. |
| `public` | `tests/public/guards.spec.ts` | Protected pages redirect to login, header without login, 404 page. |
| `user` | `tests/user/dashboard.spec.ts` | Usage (VM/container/object counts), objects/environments/applications sections, app search, object and environment selection enables start/stop, files dialog (own/shared), create dialog (shared apps), info and request-app dialogs, refresh, open connections menu, no access to admin pages. Opt-in: start an object, open its viewer, stop it. |
| `user` | `tests/user/monitoring.spec.ts` | Monitoring from the toolbar, tabs and data loading. |
| `admin` | `tests/admin/admin.spec.ts` | Link from the dashboard to the admin dashboard, admin/user lists, settings overview, every admin settings page loads, every quick link works, admin monitoring tabs. |
| `session` | `tests/session/logout.spec.ts` | Fresh login per role, logged-in user is forwarded from the login page, logout calls the auth service, clears the session and protects the dashboard again. |

The `session` project runs last because logging out ends sessions on the server.
All tests run one at a time (`workers: 1`), since they share one stack and its VMs.

## Layout

```
playwright.config.ts     projects, base URL, HTTPS, reporters
tests/support/env.ts     reads .env
tests/support/app.ts     routes and login helpers
tests/support/texts.ts   English UI texts used as locators (from the frontend's src/i18n.js)
```

When the frontend changes its texts or routes, update `texts.ts` / `app.ts`.
