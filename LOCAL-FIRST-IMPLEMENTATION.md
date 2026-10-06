# Local-first / offline-first: what exists, what was changed, what is not done

Short, honest map. The code is the deliverable; this file says where to look.

## Discovery (what the system already was)

AUZslab was already local-first in two of its five apps. Nothing here was rewritten.

| App | Local store | Sync | Offline today |
|---|---|---|---|
| AUZsPOS (`app/public/pos/`) | IndexedDB `pos3` (`rec`, `out`, `meta`) | outbox -> `push_record` RPC (optimistic concurrency, record id is the idempotency key), pull by `updated_at` cursor, 30 s timer + online event | sell, KOT, tables, orders, payments, history, receipts; local invoice/KOT numbers (`~`, `L`) when the server is unreachable |
| AUZsMob (`app/public/mob/`) | IndexedDB `mob1` + `outbox` | outbox -> real `mob_*` RPCs (client generated `p_id`, idempotent), `mob_sync_pull` | sell, purchase, repairs, customers, stock, reports from the local copy |
| AUZsLedger (`accounts/`) | none (server authoritative on purpose) | n/a | shows "You are offline. Accounting needs a connection to save and post." |
| AUZsPay (`payroll/`) | server authoritative; **staff clock-in/out is queued on the phone** (`localStorage pay.punchq`, last day cached in `pay.me`) | queue -> `pay_me_punch_offline` (db/120), 60 s timer + online event | clock in/out with the real time; everything else needs a connection |
| Admin console (`console/`) | IndexedDB `dash2` + outbox through `push_record` | same engine as the POS | works from the local copy |

Printing is the browser/OS print dialog (`pos/print.js`); it never calls the cloud.

## What was changed

1. **AUZsMob data-loss bug fixed** (`mob/sync.js`). The outbox only kept a queued write when the session was dead or
   `navigator.onLine === false`. A server error (502/503 while the API restarts), a timeout, or a phone that "has wifi"
   but no route to the server fell into the *business refusal* branch: the sale was rolled back off the phone as if the
   server had refused it. Now `isTransient()` (no answer, 5xx, 408, 429) keeps the write and everything behind it,
   retries with exponential back-off (5 s ... 5 min), and a refusal (4xx) is still rolled back and reported.
2. **Server: AUZsMob business-rule errors are 400, not 500** (`server/src/index.js`). `MBxxx` codes (not enough stock,
   day closed, ...) used to come back as 500, which the old client treated as "refused" only by accident and which the
   new transient rule would otherwise retry forever. They now map to 400 with their message, like `AC`/`PY`.
3. **Status + manual retry.** AUZsMob's sync pill shows "Not synced (n) - tap to retry" while the server is failing and
   is tappable; the POS `#net` status is tappable and runs a sync now. (`syncProblemRetry` string, EN + HI.)
4. **POS back-off** (`pos/core.js`): after a failed sync, no new attempts for 5 s, doubling to 5 min, reset by a manual
   retry, the browser `online` event or a successful sync; a timer retries by itself.
5. **POS billing never waits for a dead server**: invoice and KOT numbering give up after 2.5 s and use the local
   number (`withTimeout`).
6. **AUZsMob installs the service worker** (`mob/shell.js`). Before, only the POS registered `sw.js`, so a phone that
   had never opened the POS could not start AUZsMob with no internet.
7. **New suite `tests/suites/local/offline.mjs`** (10 checks, `node tests/run-local.mjs offline`). With the real apps and API:
   server 503, connection refused, a lost reply, restart while the API is unreachable, a genuine refusal, the retry pill,
   and the POS equivalents (503, lost reply, restart, numbering timeout). The database must hold exactly one copy.
   Verified to fail against the old behaviour (5 of 6 AUZsMob checks failed with the old drop-on-error logic).

8. **AUZsPay offline clock-in (db/120, `payroll/p-me.js`).** With no connection (or no answer), the big clock button saves
   `{op, at, lat, lng}` on the phone and shows the last saved day with an offline banner. `pay_me_punch_offline` stores the
   punch at the phone's time (refused if in the future by over 2 min or older than 3 days), decides in/out from the previous
   punch, and is idempotent on `op` (`pay_punches.client_op`, unique per business). Geofence rules are the same as online.
   Test: payroll suite ("Offline clock-in"). The browser queue itself was not driven in a real browser test.

## Conflict strategy (unchanged, documented)

- Sales, orders, payments, purchases: append-only, client generated unique id; replay is a no-op / same-state overwrite.
- Stock (AUZsMob): `sum(stock_movements)`, never a counter; the server refuses an oversell and the phone rolls the sale back.
- POS records: optimistic concurrency on `updated_at`; paid and void bills are frozen by `records_order_guard`.
- Settings/menu: last write wins, owner/manager only.

## Security (unchanged, re-checked)

`company_id`/`user_id` are never taken from the client: RLS and the `SECURITY DEFINER` functions resolve tenant, role
and permissions from the session. Offline does not add a new door: the queue only replays through the same
authenticated RPCs, and a dead session stops the queue (`401`) until sign-in.

## NOT done (decisions, not omissions)

- **AUZsLedger and AUZsPay stay server-authoritative** (except Pay's clock-in above). Gapless document numbers, period locks, double-entry balancing,
  approval limits and frozen payroll are enforced in one database transaction; an offline copy would have to *propose*
  entries that the server may refuse. A safe design (offline drafts that are posted on reconnect, never silently
  overwritten) is possible but is a separate feature with its own rules; not started.
- **Direct thermal printing (ESC/POS over Bluetooth/USB/LAN)** does not exist today (print dialog only). It needs
  WebUSB/WebBluetooth in the browser or a native plugin in the Android wrapper, plus real printers to test on.
- **Object storage (Spaces/S3)** for images and attachments: not started; uploads still live on the server volume.
- **Performance numbers** (10k/50k product search, load): not measured in this pass; there is a `load` and `loadmob`
  suite for scale; run them before claiming figures.
- **A single `POST /sync` batch endpoint**: not added. The existing per-record idempotent RPCs already give batching
  by looping; a batch endpoint would add a second path to secure without fixing a failure found in testing.
