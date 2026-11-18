# design-daas-e2e

End-to-end tests for the DESIGN DaaS stack, written with [Playwright](https://playwright.dev)
and TypeScript. They drive the real frontend in Chromium against the running stack:

| Part | Repository | Default address |
| --- | --- | --- |
| Frontend (React, nginx) | `design-daas-application-frontend` | `https://<host>:8443` |
| Auth service (Java) | `design-daas-backend-java` | `https://<host>:8443/auth` → `127.0.0.1:8080` |
| DaaS backend (Python) | `design-daas` | `https://<host>` → `127.0.0.1:5000` |

The tests only use the browser, so they test whatever is deployed. They do not start the stack.
The repositories of the three parts are [design-daas](https://github.com/design-daas-fra-uas/design-daas)
(also the installer of the complete system),
[design-daas-application-frontend](https://github.com/design-daas-fra-uas/design-daas-application-frontend)
and [design-daas-backend-java](https://github.com/design-daas-fra-uas/design-daas-backend-java).

## Before you start: the system must already be deployed

These tests **install and start nothing**. They test a DESIGN DaaS system that is **already
installed and running**, and they only work against it. If it is not running yet, install it
first with the installer in the `design-daas` repository: clone `design-daas`,
`design-daas-application-frontend` and `design-daas-backend-java` next to each other, set the
values in `design-daas/installer/daas.env` and run the installer, as described step by step in
the **[design-daas README → Installation: from a blank machine to a running system](https://github.com/design-daas-fra-uas/design-daas)**.

Check that it runs: `make -C <folder>/design-daas/installer status` on the DaaS host shows every
part as `active` / `running`, and you can log in at `https://<host>:8443/` in a browser.

From its `daas.env` the tests need:

- the frontend address, `FRONTEND_PUBLIC_URL` (by default `https://<HOST_NAME>.<HOST_DOMAIN>:8443`),
- the admin account, `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Install

The tests run on any computer that reaches the DaaS system: the DaaS host itself or another
one in the same network. The steps are for Debian 12; commands marked *as root* need `su -`
(with the dash) or `sudo`.

### 1. Node.js 26 (as root)

Debian's own `nodejs` package is too old, so install the official build from nodejs.org (skip
this if `node -v` already prints v26, e.g. on the DaaS host):

```bash
apt-get update
apt-get install -y git curl ca-certificates xz-utils libatomic1
cd /tmp
curl -fsSLO https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz
mkdir -p /usr/local/lib/nodejs
tar -xJf node-v26.13.0-linux-x64.tar.xz -C /usr/local/lib/nodejs
for b in node npm npx; do ln -sf /usr/local/lib/nodejs/node-v26.13.0-linux-x64/bin/$b /usr/local/bin/$b; done
node -v           # must print v26.13.0
```

### 2. The tests, their packages and Chromium (as your normal user)

```bash
cd ~
git clone https://github.com/design-daas-fra-uas/design-daas-e2e.git
cd design-daas-e2e
npm ci
npm run install:browsers
```

`install:browsers` downloads Playwright's Chromium into `node_modules` (once).

### 3. System libraries for Chromium (as root, once)

A fresh Debian lacks some libraries Chromium needs. In the repository folder:

```bash
cd /home/<your-user>/design-daas-e2e
npx playwright install-deps chromium
```

## Configure

### 4. Make the host names resolve (as root)

The tests must open the frontend under exactly the name it was built for (the auth service
accepts logins only from that origin), and the frontend then calls the DaaS backend under its
own name. On the DaaS host, print the hosts file line that covers all of them:

```bash
make -C <folder>/design-daas/installer client-hosts
```

e.g. `192.168.0.158  pve1.daas-design.de`. Unless your DNS already resolves these names, add
that line on the test computer:

```bash
echo "<the line from make client-hosts>" >> /etc/hosts
```

Check it: `curl -k <FRONTEND_PUBLIC_URL>/` (e.g. `curl -k https://pve1.daas-design.de:8443/`)
must return HTML. On the DaaS host itself the names usually resolve already; the same `curl`
tells you.

### 5. Create the test accounts

The admin tests use the admin from `daas.env`. The user tests need **a separate account with
the role *user***, which you create once in the browser:

1. Open the frontend (`https://<host>:8443/`), *Admin* tab, log in with `ADMIN_EMAIL` /
   `ADMIN_PASSWORD`, then go to the *Administration* page (`https://<host>:8443/dashboard/admin`).
2. *Create/Update a group*: create a user group, e.g. *Group description* `e2e`.
3. *Create an account*, tab *User*: a name, an e-mail (e.g. `e2e-user@design.local`), a password
   (8–72 characters with an upper-case letter, a lower-case letter and a digit) and the group
   you just created (e.g. `e2e`).

Give this account **no** permission rules of its own: the user tests add and remove the rules
they need themselves (see [User functions and their permissions](#user-functions-and-their-permissions)).

### 6. Write the settings file

In the repository folder, as your normal user:

```bash
cp .env.example .env
nano .env
```

Set at least:

| Key | Value |
| --- | --- |
| `E2E_BASE_URL` | the frontend address, e.g. `https://pve1.daas-design.de:8443` (not `localhost`, not the IP) |
| `E2E_IGNORE_HTTPS_ERRORS` | `true` (the installer's own certificate is not trusted by Playwright's Chromium) |
| `E2E_USER_USERNAME` / `E2E_USER_PASSWORD` | e-mail and password of the account from step 5 |
| `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD` | `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `daas.env` |

The other keys are optional and explained in `.env.example`:

- `E2E_ALLOW_START_STOP`, `E2E_OBJECT_ID`, `E2E_START_TIMEOUT`: opt-in test that really
  starts and stops an object (VM/container) of the test user.
- `E2E_CONTAINER_ID`: a DaaS container object (e.g. `contx11`) for the admin Docker page.
- `E2E_AUTH_API_URL`, `E2E_PERMISSION_CACHE`: only needed if the auth service is not behind the
  installer's nginx or the permission cache was changed.

Tests that need a login are **skipped** (not failed) while their account is empty.
`.env` is git-ignored, so passwords never end up in the repository.

## Run the tests

In the repository folder, as your normal user. Start with the public tests: they need no
accounts and show that the frontend is reachable. Then run everything:

```bash
npm run test:public
npm test
```

Other ways to run them:

```bash
npm run test:user         # user dashboard, monitoring, My resources
npm run test:admin        # admin dashboard, settings pages, monitoring
npm run test:session      # login + logout for user and admin
npm run test:headed       # same as npm test, but you watch the browser (needs a desktop)
npm run test:ui           # Playwright UI mode: pick tests, run them, step through (needs a desktop)
npm run typecheck         # TypeScript check of the tests
```

All tests run one after another (one worker), since they share one system and its VMs.
Run them as the user that owns this folder: a run as root leaves root-owned `test-results/`
and `playwright-report/` behind, which the next normal run cannot overwrite. (Chromium is kept
inside `node_modules`, `PLAYWRIGHT_BROWSERS_PATH=0`, so any user can run them.)

## See the results

**In the terminal.** Every test prints one line while it runs, and a summary at the end, e.g.
for `npm run test:public`:

```
Running 14 tests using 1 worker

  ✓   1 [public] › tests/public/guards.spec.ts:16:5 › without a login › /dashboard redirects to the login page (326ms)
  ...
  ✓  14 [public] › tests/public/login.spec.ts:60:3 › login page › the language menu switches the UI to German and back (404ms)

  14 passed (4.8s)
```

`✓` passed, `✘` failed, `-` skipped (an opt-in test or a missing account). For `npm test` all
tests must be passed or skipped; the command exits with a non-zero code if one failed.

**As an HTML report.** Every run writes a report to `playwright-report/`, with every test, its
steps and, for failures, the screenshot and the error. Open the report of the last run:

```bash
npm run report
```

This serves it on <http://localhost:9323> and opens it in the browser. On a computer without a
desktop (e.g. the DaaS host over SSH), serve it to the network instead and open
`http://<test-computer-ip>:9323` from another computer:

```bash
npx playwright show-report --host 0.0.0.0
```

Stop it with `Ctrl+C`.

**For a failed test.** Playwright keeps a screenshot (`test-failed-1.png`) and a trace
(`trace.zip`) in a folder per test under `test-results/`. The trace replays the test step by
step, with the page, the network requests and the console at each step:

```bash
npx playwright show-trace test-results/<folder of the test>/trace.zip
```

To watch a failing test live, run only its file in the browser, e.g.
`npm run test:headed -- tests/admin/docker.spec.ts`.

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
| `admin` | `tests/admin/permissions.spec.ts` | Tabs and counts, synced endpoints incl. typed permissions (`baseimage_create_vm`), search, rule form validation, endpoint group create / duplicate / edit / delete. **Effect:** the e2e user is denied *My resources*; an allow rule created on this page opens it, deleting the rule closes it again (each step waits for the 30 s permission cache). |
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

### User functions and their permissions

design-daas checks endpoint rules (`enable_auth_endpoint = true`), and without a matching rule
a user is denied everything. So every user function is tested in four steps
(`describeWithPermission` in `tests/support/access.ts`):

1. without a rule the page shows "No permission"
2. the admin allows the endpoints it needs to the e2e user (account → endpoint rules)
3. the function's own tests run
4. the rules are deleted, and the page is denied again

| Function | Endpoints |
| --- | --- |
| Dashboard | `dashboard_info` |
| Monitoring | `get_monitor_info_{tasks,files,apps,websockets,host,objects,utilization,limits}` |
| My resources | `get_quota` |
| Start/stop (opt-in) | `dashboard_info`, `baseimage_start`, `baseimage_stop`, `baseimage_object_status`, `viewer_connect`, `vmstatus` |

The e2e user must therefore have **no** rules of its own for these endpoints (the tests skip
themselves otherwise) and no group rule that allows them. A changed rule takes up to 30 s to
reach design-daas, so these tests wait for it (`E2E_PERMISSION_CACHE`).

User tests log in fresh (one login per function) instead of using the saved session in
`.auth/user.json`: design-daas answers a denied endpoint with 401, the frontend then refreshes
the session, and the refresh token in the saved file is spent for every later test.

### Test data

Tests that create data name it `e2e-…` with a per-run suffix (desktops, desktop groups,
endpoint groups, rules) and delete everything with that prefix in `afterAll`, also after a
failure. Tests that change the e2e user (its limit, a `get_quota` rule) put back the state
they found. Existing data of other accounts is never changed. The permission test is skipped
if the e2e user already has an own `get_quota` rule.

`E2E_AUTH_API_URL` (default `<E2E_BASE_URL>/auth`) is where these calls reach the auth
service; the DaaS URL is taken from the frontend's own requests.
