// Builds an isolated TEST copy of the database (never touches live data): runs every migration in
// order, then seeds known tenants and logins. Needs a Postgres server you can connect to as a superuser.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const req = createRequire(path.join(root, 'server', 'package.json'));
const pg = req('pg');
const bcrypt = req('bcryptjs');

export const PG = {
  host: process.env.TEST_PG_HOST || 'localhost',
  port: Number(process.env.TEST_PG_PORT || 5432),
  user: process.env.TEST_PG_USER || 'postgres',
  password: process.env.TEST_PG_PASSWORD || 'postgres',
  db: process.env.TEST_PG_DB || 'auzslab_test',
  appPassword: process.env.TEST_PG_APP_PASSWORD || 'apppw_test',
};
export const PASSWORD = 'Test!pass123';
export const USERS = {
  admin: 'admin@test.local',
  cafeOwner: 'owner-cafe@test.local',
  salonOwner: 'owner-salon@test.local',
  retailOwner: 'owner-retail@test.local',
  plain: 'plain@test.local',
  acctOwner: 'owner-acct@test.local',
  acctManager: 'manager-acct@test.local',
  acctCashier: 'cashier-acct@test.local',
  payOwner: 'owner-pay@test.local',
  payManager: 'manager-pay@test.local',
  payStaff: 'staff-pay@test.local',
  payStaff2: 'staff2-pay@test.local',
  mobOwner: 'owner-mob@test.local',
  mobManager: 'manager-mob@test.local',
  mobStaff: 'staff-mob@test.local',
  mobStaff2: 'staff2-mob@test.local',
};
export const TENANTS = { cafe: 'testcafe', salon: 'testsalon', retail: 'testretail', acct: 'testacct', pay: 'testpay', mob: 'testmob' };

export async function connect(database) {
  const c = new pg.Client({ host: PG.host, port: PG.port, user: PG.user, password: PG.password, database });
  await c.connect();
  return c;
}

// Migrations that only make sense for one real client's data, or that assume live state.
const SKIP = /mannat/i;

export async function build(log = () => {}) {
  const admin = await connect('postgres');
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [PG.db]);
  await admin.query(`drop database if exists ${PG.db}`);
  await admin.query(`create database ${PG.db}`);
  await admin.query(`do $$ begin if not exists (select from pg_roles where rolname = 'app') then create role app login password '${PG.appPassword}'; else alter role app password '${PG.appPassword}'; end if; end $$`);
  await admin.end();

  const c = await connect(PG.db);
  const files = fs.readdirSync(path.join(root, 'db')).filter((f) => f.endsWith('.sql')).sort();
  const first = files.filter((f) => f.startsWith('000_')), last = files.filter((f) => f.startsWith('999_'));
  const middle = files.filter((f) => !first.includes(f) && !last.includes(f) && !SKIP.test(f));
  const warn = [];
  for (const f of [...first, ...middle, ...last]) {
    try { await c.query(fs.readFileSync(path.join(root, 'db', f), 'utf8')); }
    catch (e) { warn.push(f + ': ' + e.message.split('\n')[0]); }
  }
  // Production ran 999_app_grants.sql long before the pay_/mob_/acc_ tables existed, so `app` has NO rights on them
  // there (they are only reachable through SECURITY DEFINER functions). In a fresh build 999 runs last and would grant
  // everything, hiding any non-definer trigger/helper that touches those tables. Mirror production.
  await c.query(`do $$ declare t text; begin for t in select tablename from pg_tables where schemaname = 'public' and (tablename like 'pay\\_%' or tablename like 'mob\\_%' or tablename like 'acc\\_%') loop execute format('revoke all on %I from app', t); end loop; end $$`);
  log('migrations applied' + (warn.length ? ' with ' + warn.length + ' warning(s): ' + warn.join(' | ') : ''));
  if (warn.length) throw new Error('Migration failures: ' + warn.join(' | '));
  await seed(c);
  await c.end();
  return warn;
}

async function user(c, email, meta = {}) {
  const hash = bcrypt.hashSync(PASSWORD, 4);
  const { rows } = await c.query('insert into auth_users (email, password_hash, app_metadata) values ($1, $2, $3) on conflict (email) where deleted_at is null do update set password_hash = excluded.password_hash returning id', [email, hash, meta]);
  return rows[0].id;
}

async function tenant(c, slug, name, niche, extraFeatures = {}) {
  const { rows } = await c.query(`insert into tenants (slug, name, niche, plan, status) values ($1, $2, $3, 'pro', 'active') returning id`, [slug, name, niche]);
  const id = rows[0].id;
  await c.query(`insert into tenant_settings (tenant_id, features, labels, business_rules)
    select $1, p.default_features || $3::jsonb, p.default_labels, p.default_business_rules from niche_presets p where p.niche = $2`, [id, niche, JSON.stringify(extraFeatures)]);
  return id;
}

async function seed(c) {
  const cafe = await tenant(c, TENANTS.cafe, 'Test Cafe', 'cafe', { payroll: true, website_builder: true, self_order: true });
  const salon = await tenant(c, TENANTS.salon, 'Test Salon', 'salon');
  const retail = await tenant(c, TENANTS.retail, 'Test Retail', 'retail');
  // Real provisioning (provision_tenant) also creates the settings record from the niche preset; do the same for the salon.
  await c.query(`insert into records (id, tenant_id, kind, data) select 'settings', $1, 'settings', p.default_business_rules || '{"name":"Test Salon"}'::jsonb from niche_presets p where p.niche = 'salon'`, [salon]);
  await user(c, USERS.cafeOwner, { tenant_id: cafe, role: 'owner' });
  await user(c, USERS.salonOwner, { tenant_id: salon, role: 'owner' });
  await user(c, USERS.retailOwner, { tenant_id: retail, role: 'owner' });
  // Accounting: one tenant entitled to it (owner, manager, cashier logins) and the cafe, which is not.
  const acct = await tenant(c, TENANTS.acct, 'Test Accounts', 'general', { accounting: true });
  await user(c, USERS.acctOwner, { tenant_id: acct, role: 'owner' });
  await user(c, USERS.acctManager, { tenant_id: acct, role: 'manager' });
  await user(c, USERS.acctCashier, { tenant_id: acct, role: 'cashier' });
  // Payroll v2: its own business (with Accounting, so payroll posts to the books), an owner, a manager and two staff logins
  const pay = await tenant(c, TENANTS.pay, 'Test Payroll', 'general', { payroll: true, accounting: true });
  await user(c, USERS.payOwner, { tenant_id: pay, role: 'owner' });
  await user(c, USERS.payManager, { tenant_id: pay, role: 'manager' });
  await user(c, USERS.payStaff, { tenant_id: pay, role: 'cashier' });
  await user(c, USERS.payStaff2, { tenant_id: pay, role: 'cashier' });
  // AUZsMob: its own mobile-retail-and-repair business, an owner, a manager and two plain staff logins
  const mob = await tenant(c, TENANTS.mob, 'Test Mobile Shop', 'mobile');
  await user(c, USERS.mobOwner, { tenant_id: mob, role: 'owner' });
  await user(c, USERS.mobManager, { tenant_id: mob, role: 'manager' });
  await user(c, USERS.mobStaff, { tenant_id: mob, role: 'cashier' });
  await user(c, USERS.mobStaff2, { tenant_id: mob, role: 'cashier' });
  await user(c, USERS.plain);
  const adminId = await user(c, USERS.admin);
  await c.query('insert into platform_admins (id) values ($1) on conflict do nothing', [adminId]);

  // A small, realistic café menu + tables so the QR page and POS have something to show.
  const rec = (tid, id, kind, data) => c.query('insert into records (id, tenant_id, kind, data) values ($1,$2,$3,$4) on conflict do nothing', [id, tid, kind, JSON.stringify({ id, ...data })]);
  await rec(cafe, 'settings', 'settings', { name: 'Test Cafe', bizType: 'restaurant', tax: 5, prefix: 'TC', phone: '9876543210', addr: '1 Test Street', siteTag: 'Good food.\nSlow evenings.', siteHours: 'Daily 10am to 10pm', col: '#1f3d2e' });
  await rec(cafe, 'cat-start', 'cat', { name: 'Starters', n: 1 });
  await rec(cafe, 'cat-drink', 'cat', { name: 'Beverages', n: 2 });
  await rec(cafe, 'it-1', 'item', { name: 'Paneer Tikka', cat: 'cat-start', price: 280, veg: 'veg', desc: 'Charred paneer', sizes: [] });
  await rec(cafe, 'it-2', 'item', { name: 'Chicken 65', cat: 'cat-start', price: 300, veg: 'nonveg', sizes: [] });
  await rec(cafe, 'it-3', 'item', { name: 'Masala Tea', cat: 'cat-drink', price: 40, veg: 'veg', sizes: [{ l: 'Half', p: 25 }, { l: 'Full', p: 40 }] });
  await rec(cafe, 'tbl-1', 'table', { name: 'T1', sec: 'Main' });
  await rec(retail, 'settings', 'settings', { name: 'Test Retail', bizType: 'retail', tax: 18, prefix: 'TR' });
  await rec(retail, 'cat-1', 'cat', { name: 'T-Shirts', n: 1 });
  await rec(retail, 'it-r1', 'item', { name: 'Classic Tee', cat: 'cat-1', price: 499, sizes: [], variants: [{ size: 'M', color: 'Black', qty: 10 }] });
}

export async function q(sql, params = []) {
  const c = await connect(PG.db);
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}

// Load test only: n extra mobile shops (slug ls01..), each with one owner and `staffPer` plain staff logins.
// Returns [{ slug, tid, owner, staff: [email...] }].
export async function seedShops(n, staffPer = 4) {
  const c = await connect(PG.db);
  const out = [];
  try {
    for (let i = 1; i <= n; i++) {
      const slug = 'ls' + String(i).padStart(2, '0');
      const tid = await tenant(c, slug, 'Load Shop ' + i, 'mobile');
      const owner = `owner-${slug}@load.local`;
      await user(c, owner, { tenant_id: tid, role: 'owner' });
      const staff = [];
      for (let k = 1; k <= staffPer; k++) { const e = `staff${k}-${slug}@load.local`; await user(c, e, { tenant_id: tid, role: 'cashier' }); staff.push(e); }
      out.push({ slug, tid, owner, staff });
    }
  } finally { await c.end(); }
  return out;
}
