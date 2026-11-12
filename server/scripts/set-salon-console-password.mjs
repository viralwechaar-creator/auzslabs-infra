// Run once: `docker compose exec api node scripts/set-salon-console-password.mjs <slug> <password>`
// Sets a salon tenant's own console password (the one checked by /admin/login's `a.passwordHash` branch in
// server/src/salon/router.js) directly, without touching anything else -- not the tenant's is_demo flag,
// not its subdomain, not its real content. Written for showoffsalon becoming the public "AUZslab Salon" demo
// (owner request: same shared demo password as every other product demo, Auzslab@Demo, but the salon console
// is password-only so there is no login *email* to unify the way account.html's single demo@auzslab.in does).
//
// Uses salon_tenant() (db/170), the same SECURITY DEFINER lookup the real app already uses, rather than a bare
// query against `tenants` -- that table has its own RLS and a plain `app`-role connection would see nothing.
import { pool } from '../src/db.js';
import { hashPassword } from '../src/salon/session.js';
import { readKey, writeKey } from '../src/salon/storage.js';

const [, , slug, password] = process.argv;
if (!slug || !password) { console.error('usage: node scripts/set-salon-console-password.mjs <slug> <password>'); process.exit(1); }

const { rows } = await pool.query('select * from salon_tenant($1)', [slug]);
if (!rows[0]) { console.error(`no salon tenant with slug "${slug}"`); process.exit(1); }
const tenant = rows[0];

const client = await pool.connect();
try {
  await client.query('begin');
  const admin = (await readKey(client, tenant.id, 'admin', true)) || {};
  admin.passwordHash = hashPassword(password);
  admin.failCount = 0; admin.lockedUntil = 0; // a fresh password should never start out locked
  await writeKey(client, tenant.id, 'admin', admin);
  await client.query('commit');
  console.log(`Console password set for "${slug}" (tenant ${tenant.id}).`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
