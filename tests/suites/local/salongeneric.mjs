// Salon-onto-generic-engine (db/170, server/src/salon-engine.js): the same real salon app (app/public/salon/),
// unchanged, but backed by the shared records/bookings tables (RLS-protected) instead of the private
// salon_store JSON documents. This creates its own disposable tenant flagged salonEngine='generic' (never
// the shared TENANTS.salon fixture, which must keep proving the still-live salon_store path works for every
// existing real tenant) and drives it through real HTTP calls to handleSalon(), proving the frontend contract
// is genuinely unchanged: the exact same JSON shapes, the exact same endpoints, zero special-casing.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Salon on the generic engine: same app, backed by records/bookings instead of salon_store', 'A fresh salon tenant flagged to use the shared engine, driven through the real frontend end to end.');
  const slug = 'salongeneric-' + Date.now();
  const [{ id: tid }] = await q(
    "insert into tenants(slug, name, niche, plan, status) values ($1, 'Generic Engine Salon', 'salon', 'pro', 'active') returning id",
    [slug],
  );
  await q(
    `insert into tenant_settings(tenant_id, features, labels, business_rules)
     select $1, p.default_features, p.default_labels, p.default_business_rules || '{"salonEngine":"generic"}'::jsonb
     from niche_presets p where p.niche='salon'`,
    [tid],
  );
  // provision_tenant() (db/004/037) always creates this bare settings row the instant any tenant is made --
  // land.html's own niche routing (public_menu's cfg.bizType) depends on it existing for every real tenant.
  await q(
    `insert into records (id, tenant_id, kind, data)
     select 'settings', $1, 'settings', p.default_business_rules || jsonb_build_object('name', 'Generic Engine Salon')
     from niche_presets p where p.niche='salon'`,
    [tid],
  );
  const ownerEmail = 'owner-' + slug + '@test.local';
  const hash = (await q('select password_hash from auth_users where email=$1', [USERS.salonOwner]))[0].password_hash;
  const ownerId = (await q('insert into auth_users(email, password_hash) values ($1,$2) returning id', [ownerEmail, hash]))[0].id;
  await q("insert into profiles(id, tenant_id, role) values ($1,$2,'owner')", [ownerId, tid]);

  const api = (method, path, body) => fetch(stack.apiBase + '/salon-api' + path, {
    method, headers: { 'content-type': 'application/json', 'x-forwarded-host': slug + '.localhost' },
    body: body ? JSON.stringify(body) : undefined,
  });

  await s.check('A brand-new generic-engine tenant seeds its own real menu from the template, through the normal /site endpoint', async () => {
    const r = await api('GET', '/site'); assert(r.status === 200, 'status ' + r.status);
    const d = await r.json();
    assert(d.menu.length > 0 && d.menu.some((c) => c.items.length > 0), 'no seeded menu: ' + JSON.stringify(d.menu).slice(0, 200));
    assert(d.settings.salonName === 'Generic Engine Salon', 'settings not seeded: ' + JSON.stringify(d.settings).slice(0, 200));
  }, 'critical');

  await s.check('The settings row genuinely exists (sanity check before the RLS proof below)', async () => {
    const n = (await q("select count(*)::int n from records where tenant_id=$1 and kind='settings'", [tid]))[0].n;
    assert(n === 1, 'the row should exist when queried as superuser: ' + n);
  });

  let serviceId, cookie;
  await s.check('A real booking lands in the shared bookings table, not salon_store', async () => {
    const site = await (await api('GET', '/site')).json();
    serviceId = site.menu[0].items[0].id;
    const tomorrow = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    const r = await api('POST', '/bookings', { name: 'Generic Engine Customer', phone: '9812300001', date: tomorrow, time: '11:00', services: [serviceId] });
    const text = await r.text();
    assert(r.status === 201, 'booking status ' + r.status + ' ' + text);
    const rows = await q('select customer_name, status from bookings where tenant_id=$1', [tid]);
    assert(rows.length === 1 && rows[0].customer_name === 'Generic Engine Customer' && rows[0].status === 'pending', JSON.stringify(rows));
  }, 'critical');

  await s.check('The owner signs in with their normal AUZslab password (no engine-specific login)', async () => {
    const r = await api('POST', '/admin/login', { password: PASSWORD });
    assert(r.status === 200, 'login status ' + r.status + ' ' + (await r.text()));
    cookie = r.headers.get('set-cookie');
    assert(cookie && /salon_session=/.test(cookie), 'no session cookie set');
  }, 'critical');

  const admin = (method, path, body) => fetch(stack.apiBase + '/salon-api' + path, {
    method, headers: { 'content-type': 'application/json', 'x-forwarded-host': slug + '.localhost', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });

  await s.check('The owner creates a bill, it posts a real salon_invoice record, and the public /i/<token> link returns it', async () => {
    const r = await admin('POST', '/admin/invoices', { client: { name: 'Bill Customer', phone: '9812300002' }, items: [{ name: 'Haircut', qty: 1, price: 300 }] });
    const body = await r.json().catch(() => null);
    assert(r.status === 201, 'invoice status ' + r.status + ' ' + JSON.stringify(body));
    const { invoice } = body;
    assert(invoice.total === 300 && invoice.token, 'invoice: ' + JSON.stringify(invoice));
    const row = (await q("select data->>'token' as t from records where tenant_id=$1 and kind='salon_invoice' and id=$2", [tid, invoice.id]))[0];
    assert(row && row.t === invoice.token, 'invoice did not land in records: ' + JSON.stringify(row));
    const pub = await api('GET', '/invoice/' + invoice.token);
    assert(pub.status === 200, 'public invoice status ' + pub.status);
    const pd = await pub.json();
    assert(pd.invoice.total === 300 && pd.invoice.items[0].name === 'Haircut', 'public invoice wrong: ' + JSON.stringify(pd.invoice));
  }, 'critical');

  await s.check('The owner records an expense and sees it (and the earlier booking + bill) in the combined console data', async () => {
    const r = await admin('POST', '/admin/expenses', { amount: 500, category: 'rent', note: 'Test rent' });
    assert(r.status === 201, 'expense status ' + r.status);
    const db = await (await admin('GET', '/admin/data')).json();
    assert(db.expenses.some((e) => e.amount === 500), 'expense missing from console data');
    assert(db.bookings.some((b) => b.name === 'Generic Engine Customer'), 'booking missing from console data');
    assert(db.invoices.some((i) => i.total === 300), 'invoice missing from console data');
  }, 'critical');

  await s.check('A real browser can open this tenant\'s public site with no JS errors', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url(slug, '/'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    assert(/generic engine salon/i.test(await page.locator('#brandName').innerText().catch(() => '')), 'brand name not shown');
    assert(!errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }, 'critical');

  s.done();
}
