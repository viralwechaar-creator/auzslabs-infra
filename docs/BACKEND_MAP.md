# Backend map (`server/src/`)

The API used to be one 1,567-line `index.js`. It is now split by job. Nothing about how it behaves changed: same
addresses, same checks, same replies. Only where the code lives.

## Where to look

| I want to change... | File |
|---|---|
| Port, domain, site URL, which links are allowed in emails, demo-login list | `config.js` |
| An error reply, rate limit, CORS rule, how bodies are read | `lib/http.js` |
| "confirm your email first" rule, the live profile lookup | `lib/guards.js` |
| Which tables/columns the generic `/db/<table>` API may touch | `data/tables.js` |
| **Add or change a database function the apps may call** | `data/rpc-registry.js` (the `RPC` list) |
| How a `/db` read/write or an RPC call is turned into SQL | `data/queries.js` |
| `/health`, home-screen icon and manifest | `routes/system.js` |
| Every `/auth/...` address (login, signup, Google/Apple/phone, reset, 2FA, sessions) | `routes/auth.js` |
| Razorpay and Cashfree addresses | `routes/payments.js` |
| `/db/<table>`, `/sync`, `/rpc/<fn>` | `routes/data.js` |
| File uploads (`/storage/...`) | `routes/storage.js` |
| `/admin/...`, salesman/team session hand-over, staff invite mail, uploads usage | `routes/admin.js` |
| The request loop and the final "not found" / error reply | `index.js` |

Business logic that already had its own file stays where it was: `auth.js`, `payments.js`, `cashfree.js`, `storage.js`,
`mail.js`, `push.js`, `realtime.js`, `salon.js`, `appicon.js`, ...

## How a request flows

1. `index.js` answers the browser's preflight, finds out who is calling (`verifyToken`) and builds one `ctx`
   (`req, res, url, user, ip, meta, reply, origin`).
2. It offers the request to each route module in turn: `system`, `auth`, `payments`, `data`, `storage`, `admin`.
3. A module either handles it (any return except `false`) or returns `false` ("not mine"), and the next one is tried.
4. If nobody handles it: 404. Any thrown error is turned into a reply by `httpFromError` (an unexpected 500 never shows
   its internal text to the caller; it goes to the server log and error tracking).

## Adding things

- **New database function for the apps:** write the SQL, then add it to `data/rpc-registry.js` or every call answers
  "unknown function".
- **New plain address (not a database function):** add an `if (url.pathname === '...' && req.method === '...')` block
  to the route module that matches its job, using `reply(status, body)` or `throw new HttpError(status, message)`.
  A brand-new area: make `routes/<area>.js` exporting `handle(ctx)` that ends with `return false;` and add it to
  `ROUTE_MODULES` in `index.js`.
- A route module must `return false` only when none of its addresses matched.

## Not done (on purpose)

- No behaviour changes, no renamed addresses, no new libraries.
- `auth.js` (805 lines) is still one big file; splitting it is a separate piece of work.
- `salon.js` is now a one-line entry; the code is in `server/src/salon/`: `util.js` (constants, small helpers, body
  reading), `storage.js` (tenant lookup, salon_store reads/writes, caches, `mutate`), `session.js` (password hashing,
  session cookie), `rules.js` (slots, bookings, clients, invoices, expenses), `brand.js` (uploads, per-salon icon and
  share image), `router.js` (`handleSalon`, the address list). A new salon address goes in `router.js`.
- Check for mistakes after any edit here: `eslint` with the `no-undef` rule over `server/src` (a missing import only
  shows up when that address is called).
