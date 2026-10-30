# Security audit, 30 Oct 2026 (secrets, database access rules, ID tampering)

Method: repository and git-history scans, a fresh database built from every migration and inspected as the `app` role, and a new test suite (`node tests/run-local.mjs idor`) that calls the real API as two separate businesses and as a logged-out caller. No production data was used. This is NOT a security certification; see "Needs a person" at the end.

The app does not use Supabase: it is a plain Postgres with its own API (`server/`). The Supabase questions were applied to the equivalent: row security on tables, the `/db/:table` whitelist, SECURITY DEFINER functions, the RPC allow-list, file storage routes.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | `server/src/whatsapp.js` fell back to a fixed word when `JWT_SECRET` was missing, which is also the key that encrypts shops' WhatsApp tokens. The server refuses to start without `JWT_SECRET` elsewhere, so this was only reachable by a future change, but it is removed (now refuses to start). | Fixed |
| 2 | Medium | The data API accepted `PATCH /db/<table>` with no filter, i.e. one request updating every row the caller could see (inside their own business only; row security still applied). Now refused with 400. | Fixed |
| 3 | Medium | Logged-out visitors could send JSON bodies up to 5 MB to public functions (orders, bookings, reviews). Now 200 KB for visitors (5 MB stays for signed-in people). | Fixed |
| 4 | Medium | Public write functions (place order, booking, reservation, review, cart, return request, payment note, ...) shared one generous per-address cap with read-only ones. They now also have 120 writes per 10 minutes per address. | Fixed |
| 5 | Low | `acc_gst2b_import` could never be called: the `/rpc/<name>` route did not accept digits in a function name (a bug, not a leak). | Fixed |
| 6 | Low | `demo_context` was a public function nothing used any more. Removed from the allow-list. | Fixed |
| 7 | Low | Leftover test pages `app/public/icon-test/`. Deleted. | Fixed |
| 8 | Low (accepted) | An owner can set a staff member's `role` to any non-empty text (the profile `role` column has no list of allowed values). It stays inside their own business; it cannot move anyone to another business (`tenant_id` is not writable and row security checks it). | Open, low |
| 9 | Info | A shared Android TEST signing key was committed in history (native apps, since removed). It was only for test APKs. Nothing to rotate unless that key was ever used for a store release. | Note |

## Checked and fine (with evidence)
- **Secrets in code:** pattern scan of tracked files for OpenAI/Anthropic/Stripe/AWS/Google/Razorpay/WhatsApp/GitHub/Slack keys and private-key blocks found only fake keys in test files and minified vendor libraries. `window.CFG` holds only public values (API address, Google client id, Sentry DSN). `.env` is not tracked; `.env.example` holds placeholders. History scan: the only `JWT_SECRET=` ever committed is a placeholder. No `VITE_*` / `NEXT_PUBLIC_*` (no such build).
- **Third-party calls go through the server:** Razorpay, Cashfree, WhatsApp, GST lookup, Resend, Firebase are all server-side with keys from `.env`; the browser never receives a secret (the Razorpay key id and webhook-signed flow are by design).
- **Row security:** every table the data API can reach (`records, profiles, guest_orders, push_subs, fcm_tokens, leads, signup_requests, addon_requests, roles, notifications, bookings, pos_audit`) has row security with per-command policies tied to the login's business (and user for tokens). Tables without row security (auth, payments, subscriptions, WhatsApp, salon store, ...) are NOT in the whitelist, so only server code reaches them; this was checked by comparing the two lists. All SECURITY DEFINER functions set a fixed `search_path`.
- **Authorization on files:** `/storage/acc`, `/storage/fin`, `/storage/doc` check the caller's business and permission; client payment screenshots are platform-admin only; file names cannot walk out of their folder.
- **Share links** (`/b/<code>`, invoice, bill, receipt, order pages) work only with an unguessable token; guessed tokens return nothing (tested).

## Tests added (`tests/suites/local/idor.mjs`, 7 checks, all pass)
1. Every one of the 517 functions that needs a login answers 401 to a logged-out caller.
2. A business without AUZsPay / AUZsMob / AUZsStyle / AUZsFinance, and no business at all, cannot use those or platform-admin functions.
3. Changing an id in the URL or body cannot read, change, delete or move another business's rows.
4. A profile cannot be moved to another business; another business's staff cannot be edited; an update with no filter is refused.
5. Another business's private files are refused (403), logged-out gets 401.
6. Wrong or guessed share tokens return nothing.
7. A huge anonymous request is refused.
Proved to fail without the controls: with the filter check removed, checks 4 fails. Regression suites run after the changes: security 16/16, cafe 7/7, pos 33/33, orders 13/13.

## Needs a person (not verified here)
- **Rotate if ever exposed.** Nothing exposed was found in the repository, but I cannot see your server `.env`, chat history or old backups. If any key (Razorpay, WhatsApp token, Resend, Anthropic in `agents-office`, GST lookup, Firebase service account, `JWT_SECRET`) was ever pasted in a chat, screenshot or email, revoke and re-issue it: deleting it from the text does not stop it working. The WhatsApp verify token was visible in a screenshot earlier (noted in CLAUDE.md): rotate it.
- Look at the live server: `.env` file permissions, that backups are not publicly served, that Caddy on the live server really is the version in the repo (`docker compose restart caddy` after pulling).
- `public_invoice` returns the whole business settings record to anyone holding an order link. Check that no private setting is stored in that record (it was designed for receipts).
- Payroll documents: any person who passes the payroll document check can read an employee file; the rule lives in the database function `pay_doc_check`, which has no automated cross-employee test yet.
- Sessions are 7-day tokens kept in the browser (a script injected into a page could steal one). The codebase avoids `innerHTML`; a strict script policy needs the inline scripts moved out first (not done).
- Platform-admin accounts deliberately have no two-step sign-in: keep their passwords long and unique.
- A professional penetration test before storing sensitive client data at scale.
