# AUZslab automated tests

Two ways to run, both produce `tests/report/index.html` (open it in any browser: a big READY / NOT READY verdict, every failure explained, screenshots per device).

## A. Full test on an isolated copy (safe: never touches live data)

Builds a throwaway database `auzslab_test`, starts the real API on a spare port, serves the real site files, then drives a real Chromium browser through everything:
every page and link, the buying journey, the salon product (customer booking, owner, staff permissions, invoices), cafe QR ordering, all four staff apps, 8 screen sizes, access rules, and a light load burst.

Needs Node 20+ and a Postgres you can log into as superuser (defaults: `postgres` / `postgres` on localhost:5432; override with `TEST_PG_HOST`, `TEST_PG_PORT`, `TEST_PG_USER`, `TEST_PG_PASSWORD`).

```bash
cd tests
npm install            # once; installs Playwright
npx playwright install chromium   # once (skip if CHROMIUM_PATH is set)
npm run test:local     # whole thing, ~8 minutes
node run-local.mjs salon   # only one suite: marketing responsive journeys salon cafe apps security load
```

Exit code is 0 when there are no critical/major failures, so it can gate a deploy.

## B. Read-only smoke test of the live site

Opens public pages, checks links, screen sizes, buttons that open things, the demo salon/cafe/retail sites, HTTPS certificate, headers, response time. A guard aborts any request that could change data.

```bash
cd tests
npm install && npx playwright install chromium
BASE_URL=https://auzslab.in npm run test:live
```

Safe to run any time, even during business hours. It logs in nowhere and submits nothing.

## Reading the report

- **critical**: customers or money affected, do not launch with it.
- **major**: fix before launch.
- **minor**: polish.

Re-run after every fix; the report is regenerated each time.
