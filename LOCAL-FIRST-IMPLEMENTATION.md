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

9. **Batch `POST /sync`** (server/src/index.js). Runs a list of existing RPCs in order, each in its own transaction, same login and
   allow-list as `/rpc/` (no new privileges, size capped). A refusal fails only that op; after a temporary failure the rest
   come back `{skipped:true}` so the phone keeps them queued in order. AUZsMob's outbox (`mob/sync.js`) sends its queue this way;
   POS and the other apps still use per-record calls.
10. **Local search numbers.** The offline suite measures POS search/browse/repaint at 1k, 5k, 10k and 50k local items
    (it prints them; asserts a loose ceiling up to 10k). Run `node tests/run-local.mjs offline` to see this machine's figures;
    they are headless-Chromium numbers, not a phone.
11. **Direct receipt printing (`ds/escpos.js`, POS Staff & settings -> Receipt printer).** ESC/POS over WebUSB, Web Serial or
    Web Bluetooth, with the print window as fallback if the printer fails. Works only in Chrome/Edge (desktop) and Android
    Chrome; NOT in the Android wrapper's WebView, Safari or iPhone. Tested with a fake device, never on real hardware.
12. **AUZsLedger offline drafts (db/123, `accounts/offline.js`).** Accounting starts with no connection from a saved copy of
    setup, people and products (service worker is precaching its files), and a bill, expense, invoice or note can be written
    and kept on the device. On reconnect it is sent through `acc_save_draft_offline` (idempotent on `op`, stored as a DRAFT
    with `client_op`, never posted, no document number). Posting and editing need a connection. A draft the books refuse is
    kept with the reason (Retry / Discard). Test: `accoffline` suite.
13. **Object storage (`server/src/s3.js`).** Private files (employee documents, accounting attachments) go to any S3-compatible
    bucket when `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_ENDPOINT`/`S3_REGION` for R2/B2/MinIO) are set;
    otherwise disk as before, and old files on disk keep working. SigV4 checked against AWS's published example and a fake
    server; not run against a real provider. Public site images stay on disk (Caddy serves them).

## NOT done (decisions, not omissions)

- **AUZsLedger posting, and AUZsPay beyond clock-in, stay server-authoritative**: gapless numbers, period locks and balancing
  need the database. Only drafts are offline.
- **Direct printing on iPhone / Android wrapper**, and on real printers: see item 11.
- **Public site images in object storage**, moving existing disk files into a bucket, and signed download links.
- **Phone-measured performance** and a real-provider object-storage run.
