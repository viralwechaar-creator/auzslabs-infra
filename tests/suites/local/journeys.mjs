// Buying journey on auzslab.in: account, cart, signup request, platform-admin login.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { PASSWORD, USERS, q } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Buying journey: sign up, choose products, request account, admin review', 'Real browser flow through signup.html, cart.html and the platform admin dashboard.');
  const ctx = await newCtx(browser, stack); const page = await ctx.newPage(); const errs = watch(page);
  const email = 'newclient-' + Date.now() + '@test.local';
  await s.check('Sign up tab is Google-only (no email or password boxes)', async () => {
    await page.goto(stack.url('', '/signup.html')); await page.waitForTimeout(900);
    assert(!(await page.locator('#email').isVisible()), 'email box is shown on the Sign up tab');
    assert(!(await page.locator('#password').isVisible()), 'password box is shown on the Sign up tab');
    assert(await page.locator('#googleBtnHost *').count() > 0, 'no Continue with Google button');
  }, 'critical');
  await s.check('Direct email sign-up is refused while sign-up is Google-only', async () => {
    await q("update platform_flags set value = 'off' where key = 'password_signup'");
    try {
      const r = await fetch(stack.apiBase + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'direct-' + Date.now() + '@test.local', password: PASSWORD }) });
      assert(r.status >= 400, 'direct sign-up was accepted, status ' + r.status);
    } finally { await q("update platform_flags set value = 'on' where key = 'password_signup'"); }
  }, 'major');
  await s.check('Existing account can sign in again (login mode)', async () => {
    const c2 = await newCtx(browser, stack); const p = await c2.newPage();
    await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500); await p.click('#modeLogin'); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#submitBtn'); await p.waitForTimeout(2000);
    assert(!/invalid|incorrect/i.test(await p.locator('#authErr').innerText().catch(() => '')), 'login rejected'); await c2.close();
  }, 'critical');
  await s.check('Profile: a new customer can save and read back their details; admin sees them; bad phone is refused', async () => {
    const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
    const call = async (fn, args, tok) => (await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(args) }));
    const tok = await login(USERS.plain), adm = await login(USERS.admin);
    const bad = await call('save_my_profile', { p: { name: 'QA Person', phone: 'abc' } }, tok); assert(bad.status >= 400, 'bad phone accepted');
    const ok = await call('save_my_profile', { p: { name: 'QA Person', phone: '9876543210', business_name: 'QA Cafe', business_type: 'Cafe / restaurant / bar', niche: 'bakery', city: 'Jodhpur', outlets: '2', staff_count: '8', products: ['pos', 'payroll'], start_when: 'month' } }, tok);
    assert(ok.status === 200, 'save failed ' + ok.status);
    const me = await (await call('my_profile', {}, tok)).json(); const P = (me.data || me).profile || {};
    assert(P.name === 'QA Person' && P.outlets === 2 && (P.products || []).length === 2, 'read back wrong: ' + JSON.stringify(me).slice(0, 200));
    const list = await (await call('admin_list_profiles', {}, adm)).json(); const arr = list.data || list;
    assert(Array.isArray(arr) && arr.some((x) => x.business_name === 'QA Cafe'), 'admin cannot see the profile');
    const denied = await call('admin_list_profiles', {}, tok); assert(denied.status >= 400, 'non-admin could list profiles');
  }, 'critical');
  await s.check('Account page for a customer without a business shows the profile form and a cart link', async () => {
    const c9 = await newCtx(browser, stack); const p = await c9.newPage();
    await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500); await p.click('#modeLogin'); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#submitBtn'); await p.waitForTimeout(2500);
    await p.goto(stack.url('', '/account.html')); await p.waitForTimeout(2500);
    assert(await p.locator('#pfName').isVisible(), 'profile form not shown; url ' + p.url());
    assert((await p.locator('#pfName').inputValue()) === 'QA Person', 'saved name not loaded');
    await p.click('#acBack'); assert(await p.locator('#acHome a[href="cart.html"]').isVisible(), 'cart link missing'); await c9.close();
  }, 'critical');
  await s.check('Admin panel is light: signing in makes few requests, each section loads when opened', async () => {
    const ca = await newCtx(browser, stack); const p = await ca.newPage(); const calls = [];
    p.on('request', (r) => { const u = r.url(); if (/\/(rpc|db)\//.test(u) && r.method() !== 'OPTIONS') calls.push(u.split('/').slice(-2).join('/')); });
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(3500);
    const atLogin = calls.length; assert(atLogin <= 9, 'sign-in made ' + atLogin + ' requests: ' + calls.join(', '));
    const before = calls.length; await p.click('.a-side-btn[data-section=users]'); await p.waitForTimeout(1500);
    assert(calls.length > before, 'opening Users loaded nothing');
    assert(await p.locator('.a-side-btn[data-section=pricing]').count() === 0 && await p.locator('#pricingSection').count() === 0, 'the Pricing section is still in the admin panel');
    await ca.close();
  }, 'major');
  await s.check('There is no price list: the price, bundle, plan-tier and add-on-price functions and tables are gone', async () => {
    const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
    const call = async (fn, args, tok) => (await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(args) })).status;
    const adm = await login(USERS.admin);
    for (const fn of ['public_product_prices', 'public_bundles', 'public_plan_tiers', 'public_niche_addons', 'public_addon_price_overrides']) assert((await call(fn, { p_niche: 'cafe' })) >= 400, fn + ' still answers');
    for (const fn of ['admin_set_product_price', 'admin_save_bundle', 'admin_list_bundles', 'admin_save_salon_tier', 'admin_set_product_yearly', 'admin_set_addon_price']) assert((await call(fn, {}, adm)) >= 400, fn + ' still answers for the admin');
    const t = await q("select count(*)::int n from pg_tables where schemaname='public' and tablename in ('product_prices','bundles','salon_plan_tiers','niche_addons','addon_price_overrides')");
    assert(t[0].n === 0, 'a price table is still there');
  }, 'critical');
  await s.check('Platform admin signing in lands on the admin dashboard', async () => {
    const c3 = await newCtx(browser, stack); const p = await c3.newPage(); const e3 = watch(p);
    await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500); await p.click('#modeLogin'); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#submitBtn');
    await p.waitForURL(/admin\.html/, { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(1500);
    assert(/admin\.html/.test(p.url()), 'stayed on ' + p.url());
    const t = await p.locator('body').innerText(); assert(/lead|client|request/i.test(t), 'dashboard shows no admin sections');
    await s.shot(p, 'platform-admin-dashboard'); assert(!e3.length, e3.slice(0, 3).join(' | ')); await c3.close();
  }, 'critical');
  await s.check('Normal customer is NOT sent to (or shown) the admin dashboard', async () => {
    const c4 = await newCtx(browser, stack); const p = await c4.newPage();
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2000);
    const vis = await p.locator('#clientsList').isVisible().catch(() => false); const txt = await p.locator('#clientsList').innerText().catch(() => '');
    assert(!vis || !/testcafe|Test Cafe/i.test(txt), 'a normal customer can see the client list'); await c4.close();
  }, 'critical');
  await s.check('Request page: choose services (a yearly-plan notice for anything but the restaurant POS), tell us about the business, send; no prices except the onboarding fee', async () => {
    const c5 = await newCtx(browser, stack); const p = await c5.newPage(); const e5 = watch(p);
    await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500); await p.click('#modeLogin'); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#submitBtn'); await p.waitForTimeout(1500);
    await p.goto(stack.url('', '/cart.html')); await p.waitForSelector('#reqForm', { state: 'visible', timeout: 15000 });
    const txt = await p.locator('main').innerText();
    assert(!/Total due|Continue to payment|per month|\/month|monthly price/i.test(txt), 'the request page shows prices: ' + txt.slice(0, 300));
    assert(/1,360/.test(txt) && /Hardware integration/.test(txt) && /Website/.test(txt) && /WhatsApp automation/.test(txt), 'onboarding fee or add-ons missing');
    await p.check('#pick input[data-k=pos]', { force: true }); assert(!(await p.locator('#yearNote').isVisible()), 'yearly notice shown for the restaurant POS');
    await p.check('#pick input[data-k=mobile]', { force: true }); await p.waitForTimeout(200);
    assert(/yearly plan/i.test(await p.locator('#yearNote').innerText()) && /AUZsMob/.test(await p.locator('#yearNote').innerText()), 'no yearly-plan notice for AUZsMob');
    await p.check('#pickAdd input[data-k=addon_website]', { force: true });
    await p.fill('#rqName', 'QA Owner'); await p.fill('#rqPhone', '9811100011'); await p.fill('#rqBiz', 'QA Business ' + (Date.now() % 10000)); await p.fill('#rqReq', 'Billing and stock for two outlets');
    await p.click('#rqSend'); await p.waitForSelector('#sent', { state: 'visible', timeout: 10000 });
    const r = await q("select count(*)::int n, min(status) st, (select products from client_orders where business_name like 'QA Business%' order by created_at desc limit 1) pr from client_orders where business_name like 'QA Business%'");
    assert(r[0].n >= 1 && r[0].st === 'requested' && r[0].pr && ['pos', 'mobile', 'addon_website'].every((k) => r[0].pr.includes(k)), 'no request stored: ' + JSON.stringify(r[0]));
    assert(/pay\.html\?t=[a-f0-9]{32}/.test(await p.locator('#trackLink').getAttribute('href')), 'no track link');
    await s.shot(p, 'cart-request-sent'); assert(!e5.some((x) => /JS error/.test(x)), e5.join(' | ')); await c5.close();
  }, 'critical');
  await s.check('Submitted request is visible to the platform admin under Client requests, and can be put under verification', async () => {
    const c6 = await newCtx(browser, stack); const p = await c6.newPage();
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2500);
    await p.click('.a-side-btn[data-section=orders]'); await p.waitForSelector('#ordersList tr[data-oid]', { timeout: 10000 });
    assert(/QA Business/.test(await p.locator('#ordersList').innerText()), 'request not listed');
    await p.locator('#ordersList [data-oopen]').first().click(); await p.waitForSelector('#ordBody [data-ost=verifying]', { timeout: 10000 });
    await p.click('#ordBody [data-ost=verifying]'); await p.waitForFunction(() => /under verification/i.test(document.querySelector('#ordBody')?.innerText || ''), null, { timeout: 8000 });
    assert((await q("select status from client_orders where business_name like 'QA Business%' limit 1"))[0].status === 'verifying', 'status not saved'); await c6.close();
  }, 'critical');
  await s.check('Onboarding has two kinds: Standard (pick products) and Custom-built (no standard products); the choice is stored and shown', async () => {
    const login = async (email) => { const d = await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json(); return (d.data || d).access_token; };
    const call = async (fn, args, tok) => fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(args) });
    const adm = await login(USERS.admin), plain = await login(USERS.plain);
    assert((await call('provision_custom_tenant', { p_name: 'Nope', p_slug: 'nope-custom', p_brief: 'x' }, plain)).status >= 400, 'a non-admin created a custom client');
    const r1 = await call('provision_custom_tenant', { p_name: 'Bespoke Co', p_slug: 'bespokeco', p_brief: 'Design a booking system with our own look' }, adm); assert(r1.status === 200, 'custom create ' + r1.status);
    const t = (await q("select t.build_type, t.niche, t.notes, ts.features from tenants t join tenant_settings ts on ts.tenant_id=t.id where t.slug='bespokeco'"))[0];
    assert(t.build_type === 'custom' && t.niche === 'custom' && /booking system/.test(t.notes) && Object.values(t.features).every((v) => v !== true), JSON.stringify(t));
    const r2 = await call('provision_tenant', { p_name: 'Std Co', p_slug: 'stdco', p_niche: 'cafe' }, adm); assert(r2.status === 200, 'standard create ' + r2.status);
    assert((await q("select build_type from tenants where slug='stdco'"))[0].build_type === 'standard', 'standard not stored');
    const lc = await (await call('list_clients', {}, adm)).json(); const rows = lc.data || lc.result || lc;
    assert(Array.isArray(rows) && rows.find((x) => x.slug === 'bespokeco')?.build_type === 'custom', 'list_clients lacks build_type');
    const c = await newCtx(browser, stack); const p = await c.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2500);
    await p.evaluate(() => openSection('onboard')); await p.waitForTimeout(500);
    assert(await p.locator('#stdFields').isVisible() && !(await p.locator('#customFields').isVisible()), 'standard fields not shown by default');
    assert((await p.locator('#onbProducts [data-prod]').count()) >= 5, 'product list missing');
    await p.check('input[name=buildType][value=custom]');
    assert(!(await p.locator('#stdFields').isVisible()) && await p.locator('#customFields').isVisible(), 'custom fields not shown');
    const agentsHref = await p.locator('#agentsLinkSide').getAttribute('href'); const agentsTarget = await p.locator('#agentsLinkSide').getAttribute('target');
    assert(agentsHref === 'https://agents.auzslab.in' && !agentsTarget, 'Agents Office link missing in the admin sidebar: ' + agentsHref);
    assert((await p.locator('#agentsLinkMore').count()) === 1, 'Agents Office link missing in the admin More list');
    await s.shot(p, 'admin-onboard-custom');
    assert(!errs.length, errs.join(' | ')); await c.close();
  }, 'critical');
  await s.check('Admin: client payments need a unique UTR and show up', async () => {
    const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json());
    const call = async (fn, args, tok) => { const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(args) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d && d.data !== undefined ? d.data : d }; };
    const tk = async (email) => { const d = await login(email); return (d.data || d).access_token; };
    const adm = await tk(USERS.admin), plain = await tk(USERS.plain);
    const t = (await q("select id from tenants where niche='retail' limit 1"))[0].id;
    const sm = (await q("select id from auth_users where email=$1", [USERS.cafeOwner]))[0].id;
    await q("insert into platform_salesmen(id, name) values ($1, 'QA Salesman') on conflict do nothing", [sm]);
    await q("update tenants set created_by_salesman=$1, is_trial=true where id=$2", [sm, t]);
    const pay = { p_tenant_id: t, p_amount: 5000, p_mode: 'upi', p_utr: '412345678901', p_purpose: 'First month' };
    assert((await call('admin_add_client_payment', pay, plain)).status >= 400, 'non-admin recorded a payment');
    assert((await call('admin_add_client_payment', { ...pay, p_utr: null }, adm)).status >= 400, 'UPI without a UTR accepted');
    assert((await call('admin_add_client_payment', pay, adm)).status === 200, 'admin could not record a payment');
    assert((await call('admin_add_client_payment', pay, adm)).status >= 400, 'the same UTR was accepted twice');
    const list = (await call('admin_list_client_payments', { p_tenant_id: t }, adm)).data;
    assert(list.length === 1 && list[0].utr === '412345678901' && Number(list[0].amount) === 5000, 'payment not listed');
    assert((await call('admin_list_client_payments', {}, plain)).status >= 400, 'non-admin read payments');
    // the screens
    const c = await newCtx(browser, stack, { w: 1300, h: 900 }); const p = await c.newPage(); const errs = watch(p);
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin');
    await p.waitForSelector('.a-side-btn[data-section=clientPay]', { timeout: 15000 });
    await p.click('.a-side-btn[data-section=clientPay]'); await p.waitForSelector('#clientPayList code', { timeout: 10000 });
    await c.close();
  }, 'critical');
  await s.check('Admin permanent delete: leads, requests, accounts and a whole client (every app\'s data); guarded against owners, self and non-admins', async () => {
    const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json());
    const call = async (fn, args, tok) => fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(args) });
    const tk = async (email) => { const d = await login(email); return (d.data || d).access_token; };
    const adm = await tk(USERS.admin), plain = await tk(USERS.plain);
    // lead
    await q("insert into leads(name, contact) values ('Del Lead', 'del@x.test')");
    const lid = (await q("select id from leads where name='Del Lead'"))[0].id;
    assert((await call('admin_delete_lead', { p_kind: 'lead', p_id: lid }, plain)).status >= 400, 'non-admin deleted a lead');
    assert((await call('admin_delete_lead', { p_kind: 'lead', p_id: lid }, adm)).status === 200, 'admin could not delete a lead');
    assert((await q("select count(*)::int n from leads where id=$1", [lid]))[0].n === 0, 'lead still there');
    assert((await call('admin_delete_lead', { p_kind: 'bogus', p_id: lid }, adm)).status >= 400, 'unknown kind accepted');
    // signup request (the one created earlier in this suite)
    const sr = (await q("select id from signup_requests where business_name='QA Business' limit 1"))[0];
    if (sr) { assert((await call('admin_delete_lead', { p_kind: 'signup_request', p_id: sr.id }, adm)).status === 200, 'signup request not deleted'); }
    // account: refused for self, platform admin, owner; works for a plain account (needs the typed email).
    // Uses its own disposable login (created here), never the shared USERS.plain fixture -- mobile.mjs, security.mjs,
    // dpdp.mjs and others run later in the same continuous process and assume that account still exists.
    const adminId = (await q("select id from auth_users where email=$1", [USERS.admin]))[0].id;
    assert((await call('admin_delete_user', { p_user_id: adminId, p_confirm_email: USERS.admin }, adm)).status >= 400, 'admin deleted themselves');
    const ownerId = (await q("select id from auth_users where email=$1", [USERS.payOwner || USERS.mobOwner]))[0].id;
    assert((await call('admin_delete_user', { p_user_id: ownerId, p_confirm_email: USERS.payOwner || USERS.mobOwner }, adm)).status >= 400, 'a business owner was deleted as a bare account');
    const disposableEmail = 'delete-me-user-' + Date.now() + '@test.local';
    const disposableHash = (await q("select password_hash from auth_users where email=$1", [USERS.plain]))[0].password_hash;
    const disposableId = (await q("insert into auth_users(email, password_hash) values ($1, $2) returning id", [disposableEmail, disposableHash]))[0].id;
    assert((await call('admin_delete_user', { p_user_id: disposableId, p_confirm_email: 'wrong@x.test' }, adm)).status >= 400, 'wrong typed email accepted');
    assert((await call('admin_delete_user', { p_user_id: disposableId, p_confirm_email: disposableEmail }, adm)).status === 200, 'disposable account not deleted');
    assert((await q("select count(*)::int n from auth_users where id=$1", [disposableId]))[0].n === 0, 'account still there');
    // a whole client with Payroll + AUZsMob data: tenant, logins and every tenant table are empty afterwards.
    // Its own disposable tenant (created here), never the shared `testmob` fixture -- mobile.mjs, offline.mjs and
    // the design suite run later in the same process and assume that tenant still exists.
    const tid = (await q("insert into tenants(slug, name, niche, plan, status) values ($1, 'Delete Me Co', 'general', 'pro', 'active') returning id", ['delete-me-' + Date.now()]))[0].id;
    await q("insert into tenant_settings(tenant_id, features, labels, business_rules) select $1, p.default_features, p.default_labels, p.default_business_rules from niche_presets p where p.niche='general'", [tid]);
    const owner = (await q("select id from auth_users where email=$1", [USERS.mobOwner]))[0].id;
    // A real owner profile row for THIS disposable tenant (never the shared testmob fixture's own profile), so the
    // "profiles left behind" assertion below actually exercises delete_client's profile-purging code path instead of
    // trivially passing against a tenant that never had a profiles row to purge in the first place.
    const delOwnerEmail = 'delete-me-owner-' + Date.now() + '@test.local';
    const delOwnerId = (await q("insert into auth_users(email, password_hash) values ($1, $2) returning id", [delOwnerEmail, disposableHash]))[0].id;
    await q("insert into profiles(id, tenant_id, role) values ($1, $2, 'owner')", [delOwnerId, tid]);
    await q("insert into mob_items(id, tenant_id, name, created_by) values (gen_random_uuid(), $1, 'Delete me', $2)", [tid, owner]);
    await q("insert into pay_org(tenant_id) values ($1) on conflict do nothing", [tid]);
    await q("insert into records(tenant_id, id, kind, data) values ($1, 'del1', 'item', '{}'::jsonb)", [tid]);
    assert((await call('delete_client', { p_tenant_id: tid }, plain)).status >= 400, 'non-admin deleted a client');
    const r = await call('delete_client', { p_tenant_id: tid }, adm); assert(r.status === 200, 'delete_client failed: ' + (await r.text()).slice(0, 200));
    assert((await q("select count(*)::int n from tenants where id=$1", [tid]))[0].n === 0, 'tenant row still there');
    assert((await q("select count(*)::int n from mob_items where tenant_id=$1", [tid]))[0].n === 0 && (await q("select count(*)::int n from pay_org where tenant_id=$1", [tid]))[0].n === 0 && (await q("select count(*)::int n from records where tenant_id=$1", [tid]))[0].n === 0, 'app data left behind');
    assert((await q("select count(*)::int n from profiles where tenant_id=$1", [tid]))[0].n === 0, 'profiles left behind');
    assert((await q("select count(*)::int n from admin_audit where action in ('delete_client','delete_user','delete_lead')"))[0].n >= 3, 'deletes were not audit-logged');
  }, 'critical');
  await ctx.close(); s.done();
}
