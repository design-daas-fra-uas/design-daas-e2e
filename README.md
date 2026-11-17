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
| `user` | `tests/user/quota.spec.ts` | *My resources*: toolbar link, six resources with use / limit / bar, refresh. Admin pages (status, limitation, permissions, desktops, desktop groups, docker) stay closed to a user. |
| `admin` | `tests/admin/permissions.spec.ts` | Tabs and counts, synced endpoints incl. typed permissions (`baseimage_create_vm`), search, rule form validation, endpoint group create / duplicate / edit / delete. **Effect:** an own rule for the e2e user on `get_quota` flips its *My resources* page, deleting it restores it (waits for the 30 s permission cache). |
| `admin` | `tests/admin/limitation.spec.ts` | Default limit, system maximum, table. Form validation and "No limit". **Effect:** sets an own limit for the e2e user, checks it in the table and on the user's *My resources*, removes it (default limit applies). The e2e user's original limit is restored afterwards. |
| `admin` | `tests/admin/desktops.spec.ts` | List and count, form validation, create with a new desktop group, taken group name is refused, details page, unknown id, delete (group is kept). |
| `admin` | `tests/admin/desktop-groups.spec.ts` | List and count, create, duplicate name refused, add a user group (twice is refused), delete after confirm. |
| `admin` | `tests/admin/system-status.spec.ts` | Link, every component has a state, `daas` is up with its version, overall state matches the parts, refresh. |
| `admin` | `tests/admin/docker.spec.ts` | Daemon summary, images and search, running containers and usage, image/container actions; also: every container the status page reports as up is listed, dashboard link. Opt-in lifecycle with `E2E_CONTAINER_ID`. |
| `session` | `tests/session/logout.spec.ts` | Fresh login per role, logged-in user is forwarded from the login page, logout calls the auth service, clears the session and protects the dashboard again. |

The `session` project runs last because logging out ends sessions on the server.
All tests run one at a time (`workers: 1`), since they share one stack and its VMs.

## Layout

```
playwright.config.ts     projects, base URL, HTTPS, reporters
tests/support/env.ts     reads .env
tests/support/app.ts     routes and login helpers
tests/support/api.ts     direct backend calls for test data setup and cleanup (never for the checks)
tests/support/texts.ts   English UI texts used as locators (from the frontend's src/i18n.js)
```

When the frontend changes its texts or routes, update `texts.ts` / `app.ts`.

### Test data

Tests that create data name it `e2e-…` with a per-run suffix (desktops, desktop groups,
endpoint groups, rules) and delete everything with that prefix in `afterAll`, also after a
failure. Tests that change the e2e user (its limit, a `get_quota` rule) put back the state
they found. Existing data of other accounts is never changed. The permission test is skipped
if the e2e user already has an own `get_quota` rule.

`E2E_AUTH_API_URL` (default `<E2E_BASE_URL>/auth`) is where these calls reach the auth
service; the DaaS URL is taken from the frontend's own requests.
