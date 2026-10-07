# Tech stack (INTERNAL, never put this in client-facing or public text)

For engineering and operations agents only. Public rule from [[CLAUDE]] still applies: no hosting or technical details in anything a client or visitor reads.

## Shape of the system
- One server (VPS) runs everything for all clients. Each client is one row in a tenants table; there is no per-client deployment.
- Database: plain PostgreSQL 16. Row-level security keeps each client's data separate. Almost all business data is one generic table (records) with a kind column; some modules (Accounting, Payroll, AUZsMob) have their own real tables, written only through SECURITY DEFINER functions that check permissions first.
- API: a hand-written Node.js server (no framework, no ORM). Every callable database function must also be registered in the API's RPC allow-list, or it answers "unknown function".
- Front ends: plain static HTML, CSS and JavaScript, no build step, no bundler. Files are served straight from the repo by Caddy (reverse proxy, automatic HTTPS, wildcard certificate for the client addresses).
- Docker Compose runs Caddy, the API, Postgres, backups and the uptime monitor.
- Apps: AUZsPOS, AUZsMob (offline-first: IndexedDB plus an outbox that syncs later), AUZsPay, AUZsLedger (server-authoritative), the admin console, Website Builder, the salon app.
- Staff sign in with username and PIN; owners with Google or email and password; 2FA optional for owners and managers.

## Conventions
- Database changes are numbered files in db/, applied by hand in order. Any new table needs its own grant for the app role. Trigger functions touching module tables must be SECURITY DEFINER.
- Marketing site and apps never mention hosting, "tenant" or "database" to visitors.
- Design: ink and wine palette, system font, no emoji in the product, 44px tap targets, phone first.
- Tests: a local suite runs the real API and a real browser. Suites are run one at a time (shared test database).

## TODO
- TODO: owner to add server size, typical CPU/memory/disk figures and the backup schedule so monitoring agents have normal values to compare against.
