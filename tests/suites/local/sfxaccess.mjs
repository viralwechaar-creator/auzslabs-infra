// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const bcrypt = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'server', 'package.json'))('bcryptjs');
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront access and security', 'Permission keys, activity log, staff security, message log, billing history.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Access tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const err = async (fn, args, tok) => JSON.stringify((await rpc(stack, fn, args, tok)).data).toLowerCase();
  const mk = async (email, role, perms) => {
    const hash = bcrypt.hashSync(PASSWORD, 4);
    const u = (await q("insert into auth_users (email, password_hash, app_metadata) values ($1,$2,'{}'::jsonb) on conflict (email) where deleted_at is null do update set password_hash=excluded.password_hash returning id", [email, hash]))[0].id;
    let rid = null;
    if (perms) rid = (await q("insert into roles (tenant_id, name, permissions) values ($1,$2,$3::jsonb) on conflict (tenant_id, name) do update set permissions=excluded.permissions returning id", [tid, 'R ' + email, JSON.stringify(perms)]))[0].id;
    await q('insert into profiles (id, tenant_id, email, role, role_id, name) values ($1,$2,$3,$4,$5,$6) on conflict (id) do update set role=excluded.role, role_id=excluded.role_id, tenant_id=excluded.tenant_id', [u, tid, email, role, rid, email.split('@')[0]]);
    return login(email);
  };
  const mgr = await mk('mgr-access@test.local', 'manager', null);
  const viewer = await mk('view-access@test.local', 'cashier', null);
  const custom = await mk('custom-access@test.local', 'manager', { sfx_view: true, sfx_manage: true, sfx_refunds: false });
  const orderId = async () => {
    await q('update sfx_variants set stock = 50 where id = any($1)', [[vs, vm]]);
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Acc Buyer', phone: '98' + Math.floor(10000000 + Math.random() * 89999999), address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 1 }] } });
    const id = (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
    await q("update sfx_orders set payment_status='paid' where id=$1", [id]);
    return id;
  };

  await s.check('The owner and a plain manager can do everything; the permission list says so', async () => {
    const p = unwrap(await rpc(stack, 'sfx_context', {}, mgr).then((r) => r.data)).perms;
    assert(p.sfx_refunds === true && p.sfx_settings === true && p.sfx_staff === false, JSON.stringify(p));
    const po = unwrap(await rpc(stack, 'sfx_context', {}, owner).then((r) => r.data)).perms;
    assert(po.sfx_staff === true && po.sfx_refunds === true, JSON.stringify(po));
  }, 'critical');
  await s.check('A custom role can have one permission taken away while the rest still works', async () => {
    const o = await orderId();
    assert(/does not allow this \(sfx_refunds\)/.test(await err('sfx_refund_record', { p_order: o, p: { amount: 10, method: 'manual' } }, custom)), 'refund allowed without permission');
    assert(!/does not allow/.test(await err('sfx_checkout_rules_save', { p: { fields: { email: 'optional' } } }, custom)), 'settings blocked although the role allows it');
    const ok = await err('sfx_refund_record', { p_order: o, p: { amount: 10, method: 'manual' } }, mgr);
    assert(!/does not allow|error/.test(ok), ok.slice(0, 200));
  }, 'critical');
  await s.check('A view-only user cannot change money, settings or discounts', async () => {
    const o = await orderId();
    for (const [fn, args] of [['sfx_refund_record', { p_order: o, p: { amount: 5, method: 'manual' } }], ['sfx_tax_settings_save', { p: { rate: 5 } }], ['sfx_discount_save', { p_id: null, p: { code: 'NOPE', kind: 'flat', value: 5 } }], ['sfx_credit_adjust', { p_customer: '00000000-0000-0000-0000-000000000000', p_delta: 5, p_note: 'x' }]]) {
      assert(/does not allow|error/.test(await err(fn, args, viewer)), fn + ' allowed for a view-only user');
    }
  }, 'critical');
  await s.check('Sensitive actions are logged with who did them, and only settings-level roles can read the log', async () => {
    await rpc(stack, 'sfx_tax_settings_save', { p: { rate: 0, inclusive: true, gstin: '', label: 'GST' } }, owner);
    const log = unwrap(await rpc(stack, 'sfx_audit_list', { p_limit: 50 }, owner).then((r) => r.data));
    const acts = log.map((x) => x.action);
    assert(acts.includes('Recorded a refund') && acts.includes('Changed tax settings') && acts.includes('Changed checkout rules'), JSON.stringify(acts));
    assert(log.find((x) => x.action === 'Recorded a refund').who.includes('mgr-access'), 'who not recorded');
    assert(/does not allow/.test(await err('sfx_audit_list', {}, viewer)), 'view-only user read the log');
  }, 'critical');
  await s.check('Staff security list shows role, two-step sign-in and recent sessions', async () => {
    const list = unwrap(await rpc(stack, 'sfx_staff_security', {}, owner).then((r) => r.data));
    const me = list.find((x) => /mgr-access/.test(x.name));
    assert(me && me.role === 'manager' && me.twoFactor === false, JSON.stringify(list).slice(0, 300));
    assert(list.some((x) => x.role === 'owner'), 'owner missing');
    assert(/does not allow/.test(await err('sfx_staff_security', {}, viewer)), 'view-only user saw staff security');
  });
  await s.check('Message log masks phone numbers and billing history is for owners and managers only', async () => {
    await q("insert into wa_outbox (tenant_id, to_phone, template, params, status) values ($1,'919812345678','invoice_link','[]'::jsonb,'sent')", [tid]);
    const m = unwrap(await rpc(stack, 'sfx_message_log', {}, owner).then((r) => r.data));
    assert(m.length >= 1 && m[0].to.endsWith('5678') && !m[0].to.includes('9812') && m[0].status === 'sent', JSON.stringify(m[0]));
    const b = await rpc(stack, 'sfx_billing_history', {}, owner);
    assert(Array.isArray(unwrap(b.data)), JSON.stringify(b.data).slice(0, 200));
    assert(/does not allow/.test(await err('sfx_billing_history', {}, viewer)), 'view-only user read billing');
  });
  await s.check('Another business cannot read this log or these staff', async () => {
    const other = await login(USERS.salonOwner);
    assert(/error/.test(await err('sfx_audit_list', {}, other)), 'other business read the log');
    assert(/error/.test(await err('sfx_staff_security', {}, other)), 'other business saw staff');
  });
  await s.check('Settings pages: activity log, staff security and customer messages open for the owner', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    for (const [route, text] of [['activity', /Recorded a refund/], ['staff-security', /People with access/], ['messages', /invoice_link/]]) {
      await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/' + route), { waitUntil: 'load' }); await page.waitForTimeout(4000);
      const t = await page.locator('body').innerText();
      assert(text.test(t), route + ': ' + t.slice(0, 300));
    }
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Admin polish: unsaved-changes warning, inline form error, filtered-empty state, selection scope', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/redirects'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await page.locator('[data-action="redirect-new"]').click(); await page.waitForTimeout(400);
    // 1. server error shows inside the form
    await page.fill('#dialog input[name=from]', 'no-slash'); await page.fill('#dialog input[name=to]', '/x'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1200);
    assert(/must start with/i.test(await page.locator('#dialog .form-error').innerText()), 'no inline error');
    // 2. closing a changed dialog asks first
    let asked = 0; page.on('dialog', async (d) => { asked++; await d.dismiss(); });
    await page.locator('#dialog [data-action="close-dialog"]').first().click(); await page.waitForTimeout(400);
    assert(asked === 1 && await page.locator('#dialog').evaluate((el) => el.open), 'closed without asking (asked ' + asked + ')');
    page.removeAllListeners('dialog'); page.on('dialog', async (d) => { await d.accept(); });
    await page.locator('#dialog [data-action="close-dialog"]').first().click(); await page.waitForTimeout(400);
    assert(!(await page.locator('#dialog').evaluate((el) => el.open)), 'did not close after confirming');
    // 3. filtered-empty on products, and the selection line
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/products'), { waitUntil: 'load' }); await page.waitForTimeout(4000);
    await page.fill('#table-query', 'zzzz-nothing-matches'); await page.waitForTimeout(500);
    assert(/No results match your filters/.test(await page.locator('#table-results').innerText()), 'no filtered-empty message');
    await page.evaluate(() => document.querySelector('[data-action="clear-filters"]').click()); await page.waitForTimeout(500);
    assert(await page.locator('input[data-bulk]').count() >= 1, 'clear filters did not restore the list: ' + (await page.evaluate(() => document.querySelector('#table-results').innerHTML.slice(380, 1100))) + ' | q=' + (await page.inputValue('#table-query')) + ' | act=' + (await page.evaluate(() => document.querySelector('[data-action="clear-filters"]')?.outerHTML)) + ' | errs=' + JSON.stringify(errs).slice(0, 300));
    await page.locator('input[data-bulk]').first().check(); await page.waitForTimeout(300);
    assert(/selected|Select all/.test(await page.locator('#bulk-scope').innerText()), 'no selection line');
    assert(!errs.filter((e) => !/sfx_redirect_save/.test(e)).length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Roles screen: finer store permissions are saved, a refund-less role is listed correctly', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await q("delete from roles where tenant_id=$1 and name='Packer'", [tid]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/roles'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await page.fill('input[name=name]', 'Packer');
    await page.evaluate(() => { const f = document.querySelector('input[name=name]').form; f.elements.sfx_manage.checked = true; f.elements.sfx_refunds.checked = false; f.elements.sfx_marketing.checked = false; });
    await page.evaluate(() => document.querySelector('input[name=name]').form.querySelector('button.primary, button[type=submit]').click()); await page.waitForTimeout(2000);
    const r = (await q("select permissions from roles where tenant_id=$1 and name='Packer'", [tid]))[0];
    assert(r && r.permissions.sfx_manage === true && r.permissions.sfx_refunds === false && r.permissions.sfx_marketing === false && r.permissions.sfx_orders === true && r.permissions.sfx_staff === false, JSON.stringify(r));
    const t = await page.locator('main, body').first().innerText();
    assert(/Packer/.test(t) && /Orders and shipments/.test(t), t.slice(0, 400));
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  s.done();
}
