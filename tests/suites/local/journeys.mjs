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
    assert(await p.locator('#cartNavLink').isVisible(), 'cart link missing'); await c9.close();
  }, 'critical');
  await s.check('Admin panel is light: signing in makes few requests, each section loads when opened', async () => {
    const ca = await newCtx(browser, stack); const p = await ca.newPage(); const calls = [];
    p.on('request', (r) => { const u = r.url(); if (/\/(rpc|db)\//.test(u) && r.method() !== 'OPTIONS') calls.push(u.split('/').slice(-2).join('/')); });
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(3500);
    const atLogin = calls.length; assert(atLogin <= 9, 'sign-in made ' + atLogin + ' requests: ' + calls.join(', '));
    const before = calls.length; await p.click('.a-side-btn[data-section=pricing]'); await p.waitForTimeout(1500);
    assert(calls.length > before, 'opening Pricing loaded nothing');
    assert(await p.locator('#pricingSection tr[data-key]').count() > 0 || /Pricing/i.test(await p.locator('#pageTitle').innerText()), 'pricing not shown');
    await ca.close();
  }, 'major');
  await s.check('Admin bundles + yearly prices: create, shown live on the pricing page, refused for non-admins, deleted', async () => {
    const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
    const call = async (fn, args, tok) => { const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(args) }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const adm = await login(USERS.admin), plain = await login(USERS.plain);
    const args = { p_key: null, p_label: 'QA Duo', p_feature_keys: ['pos', 'accounting'], p_monthly_price: 2222, p_list_price: 2598, p_yearly_price: 22000, p_badge: 'QA badge', p_blurb: 'QA blurb', p_active: true };
    assert((await call('admin_save_bundle', args, plain)).status >= 400, 'non-admin created a bundle');
    const made = await call('admin_save_bundle', args, adm); assert(made.status === 200, 'create failed ' + JSON.stringify(made.body));
    const key = made.body.data || made.body;
    assert((await call('admin_save_bundle', { ...args, p_label: 'Dup' }, adm)).status >= 400, 'duplicate product set accepted');
    assert((await call('admin_save_bundle', { ...args, p_key: 'x1', p_feature_keys: ['pos'] }, adm)).status >= 400, 'single-product bundle accepted');
    const pub = await call('public_bundles', {}); const list = pub.body.data || pub.body;
    const b = list.find((x) => x.key === key); assert(b && Number(b.yearly_price) === 22000 && Number(b.list_price) === 2598, 'public bundle missing fields');
    assert((await call('admin_set_product_yearly', { p_key: 'payroll', p_yearly_price: 9000, p_renewal_yearly_price: 8000 }, adm)).status === 200, 'yearly set failed');
    await call('admin_set_product_price', { p_key: 'payroll', p_monthly_price: 1234 }, adm);
    const c5 = await newCtx(browser, stack); const p = await c5.newPage();
    await p.goto(stack.url('', '/pricing.html')); await p.waitForTimeout(2500);
    const txt = await p.locator('body').innerText();
    assert(txt.includes('QA Duo') && txt.includes('2,222') && txt.includes('22,000'), 'new bundle not on pricing page');
    assert(txt.includes('1,234'), 'edited AUZsPay price not on pricing page'); await c5.close();
    const au = await call('admin_save_bundle', { ...args, p_key: key, p_auto: true, p_discount_pct: 10 }, adm); assert(au.status === 200, 'auto save failed ' + JSON.stringify(au.body));
    const eff = async () => ((await call('public_bundles', {})).body.data || []).find((x) => x.key === key);
    const pp = Number(((await call('public_product_prices', {})).body.data || []).find((x) => x.key === 'pos').monthly_price), pa = Number(((await call('public_product_prices', {})).body.data || []).find((x) => x.key === 'accounting').monthly_price);
    assert(Number((await eff()).monthly_price) === Math.round((pp + pa) * 0.9), 'auto bundle price wrong: ' + JSON.stringify(await eff()));
    await call('admin_set_product_price', { p_key: 'pos', p_monthly_price: pp + 1000 }, adm);
    assert(Number((await eff()).monthly_price) === Math.round((pp + 1000 + pa) * 0.9), 'bundle did not follow the product price change');
    await call('admin_set_product_price', { p_key: 'pos', p_monthly_price: pp }, adm);
    assert((await call('admin_delete_bundle', { p_key: key }, plain)).status >= 400, 'non-admin deleted a bundle');
    assert((await call('admin_delete_bundle', { p_key: key }, adm)).status === 200, 'delete failed');
    await call('admin_set_product_price', { p_key: 'payroll', p_monthly_price: 999 }, adm);
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
  await s.check('Cart page lets a signed-in visitor pick products and submit a request', async () => {
    const c5 = await newCtx(browser, stack); const p = await c5.newPage(); const e5 = watch(p);
    await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500); await p.click('#modeLogin'); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#submitBtn'); await p.waitForTimeout(1500);
    await p.goto(stack.url('', '/products.html')); await p.waitForTimeout(800);
    const adds = p.locator('[data-cart-btn]'); assert((await adds.count()) >= 3, 'products page has too few Add to cart buttons');
    await adds.first().click(); await p.waitForTimeout(400);
    await p.goto(stack.url('', '/cart.html')); await p.waitForTimeout(1200);
    assert(/\S/.test(await p.locator('#cartItems').innerText()), 'cart is empty after adding a product');
    await p.fill('#contactName', 'QA Owner'); await p.fill('#contactPhone', '9811100011'); await p.fill('#bizName', 'QA Business'); await p.fill('#bizSlug', 'qabusiness' + (Date.now() % 10000));
    await p.selectOption('#bizNiche', { index: 1 }).catch(() => {}); await p.fill('#bizAddress', '1 Test Road').catch(() => {});
    await p.click('#submitBtn'); await p.waitForTimeout(2000);
    const r = await q("select count(*)::int n from signup_requests where business_name = 'QA Business'").catch(async () => q("select count(*)::int n from signup_requests"));
    assert(r[0].n >= 1, 'no signup request stored; page says: ' + (await p.locator('#submitErr').innerText().catch(() => '')));
    await s.shot(p, 'cart-submitted'); assert(!e5.some((x) => /JS error/.test(x)), e5.join(' | ')); await c5.close();
  }, 'critical');
  await s.check('Submitted request is visible to the platform admin', async () => {
    const c6 = await newCtx(browser, stack); const p = await c6.newPage();
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2500);
    await p.click('.a-side-btn[data-section=signupRequests]'); await p.waitForTimeout(1500); // sections load when opened
    assert(/QA Business/.test(await p.locator('#signupRequestsList').innerText()), 'request not listed'); await c6.close();
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
    // account: refused for self, platform admin, owner; works for a plain account (needs the typed email)
    const adminId = (await q("select id from auth_users where email=$1", [USERS.admin]))[0].id;
    assert((await call('admin_delete_user', { p_user_id: adminId, p_confirm_email: USERS.admin }, adm)).status >= 400, 'admin deleted themselves');
    const ownerId = (await q("select id from auth_users where email=$1", [USERS.payOwner || USERS.mobOwner]))[0].id;
    assert((await call('admin_delete_user', { p_user_id: ownerId, p_confirm_email: USERS.payOwner || USERS.mobOwner }, adm)).status >= 400, 'a business owner was deleted as a bare account');
    const plainId = (await q("select id from auth_users where email=$1", [USERS.plain]))[0].id;
    assert((await call('admin_delete_user', { p_user_id: plainId, p_confirm_email: 'wrong@x.test' }, adm)).status >= 400, 'wrong typed email accepted');
    assert((await call('admin_delete_user', { p_user_id: plainId, p_confirm_email: USERS.plain }, adm)).status === 200, 'plain account not deleted');
    assert((await q("select count(*)::int n from auth_users where id=$1", [plainId]))[0].n === 0, 'account still there');
    // a whole client with Payroll + AUZsMob data: tenant, logins and every tenant table are empty afterwards
    const tid = (await q("select id from tenants where slug='testmob'"))[0].id;
    const owner = (await q("select id from auth_users where email=$1", [USERS.mobOwner]))[0].id;
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
