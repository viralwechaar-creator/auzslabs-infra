// Storefront owner hub: Customers and Discounts pages in a real browser against the real API.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront customers and discounts', 'Owner hub pages save through the real API; checkout applies the code.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
  const tok = await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const r = await c.auth.signInWithPassword({ email: e, password: p }); return r.error ? { error: r.error.message } : { ok: true }; }, [USERS.cafeOwner, PASSWORD]);
  assert(tok.ok, 'login failed: ' + JSON.stringify(tok));
  await page.goto('about:blank');
  await s.check('Discounts page: create a code, it appears in the list', async () => {
    await page.goto(stack.url('testcafe', '/storefront.html#/discounts'), { waitUntil: 'load' }); await page.waitForTimeout(1500);
    assert(await page.locator('[data-action="discount-new"]').count() > 0, 'page did not render: ' + (await page.locator('body').innerText()).slice(0, 300) + ' | ' + JSON.stringify(tok).slice(0, 120));
    await page.locator('[data-action="discount-new"]').first().click();
    await page.fill('#dialog input[name=code]', 'welcome15'); await page.fill('#dialog input[name=value]', '15'); await page.fill('#dialog input[name=minOrder]', '100');
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1200);
    const t = await page.locator('main, body').first().innerText(); assert(/WELCOME15/.test(t) && /15% off/.test(t), t.slice(0, 300));
    const r = await q("select code, value::float v, min_order::float m from sfx_discounts where upper(code)='WELCOME15'"); assert(r.length === 1 && r[0].v === 15 && r[0].m === 100, JSON.stringify(r));
  }, 'critical');
  await s.check('A bad code is refused with a message and nothing is saved', async () => {
    await page.locator('[data-action="discount-new"]').first().click();
    await page.fill('#dialog input[name=code]', 'half'); await page.fill('#dialog input[name=value]', '150');
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1000);
    assert(/exceed 100/.test(await page.locator('#toast').innerText()), 'no refusal message');
    assert((await q("select count(*)::int n from sfx_discounts where upper(code)='HALF'"))[0].n === 0, 'saved anyway');
    await page.keyboard.press('Escape');
  });
  await s.check('Archive then re-activate a code', async () => {
    await page.locator('[data-action^="discount-toggle:"]').first().click(); await page.waitForTimeout(900);
    assert((await q("select status from sfx_discounts where upper(code)='WELCOME15'"))[0].status === 'archived', 'not archived');
    await page.locator('[data-action^="discount-toggle:"]').first().click(); await page.waitForTimeout(900);
    assert((await q("select status from sfx_discounts where upper(code)='WELCOME15'"))[0].status === 'active', 'not active');
  });
  await s.check('Customers page: add a customer, edit, orders appear automatically', async () => {
    await page.goto(stack.url('testcafe', '/storefront.html#/customers'), { waitUntil: 'load' }); await page.waitForTimeout(1200);
    await page.locator('[data-action="customer-new"]').first().click();
    await page.fill('#dialog input[name=name]', 'Meera Shah'); await page.fill('#dialog input[name=phone]', '9811100001');
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1200);
    assert(/Meera Shah/.test(await page.locator('body').innerText()), 'customer not listed');
    await page.locator('[data-action^="customer-edit:"]').first().click(); await page.fill('#dialog input[name=email]', 'meera@example.com');
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1000);
    assert((await q("select email from sfx_customers where phone='9811100001'"))[0].email === 'meera@example.com', 'edit not saved');
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    await q("insert into sfx_orders (tenant_id, number, token, customer, lines, subtotal, total, payment_method) values ($1,'SF-T1','tok1',$2::jsonb,'[]',250,250,'cod')", [tid, JSON.stringify({ name: 'Walk Buyer', phone: '9822200002' })]);
    await page.goto(stack.url('testcafe', '/storefront.html#/orders'), { waitUntil: 'load' }); await page.goto(stack.url('testcafe', '/storefront.html#/customers'), { waitUntil: 'load' }); await page.waitForTimeout(1500);
    assert(/Walk Buyer/.test(await page.locator('body').innerText()), 'order customer not derived');
  }, 'critical');
  await s.check('Inventory: adjust stock from the page and see it in the ledger', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    const pr = (await q("insert into sfx_products (tenant_id, name, status, price, category) values ($1,'Mug','active',199,'Home') returning id", [tid]))[0].id;
    await q("insert into sfx_variants (tenant_id, product_id, label, price, stock) values ($1,$2,'Default',199,4)", [tid, pr]);
    await page.goto(stack.url('testcafe', '/storefront.html#/inventory'), { waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.locator('[data-action^="stock-adjust:"]').first().click();
    await page.fill('#dialog input[name=amount]', '6'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1200);
    assert((await q("select stock from sfx_variants where product_id=$1", [pr]))[0].stock === 10, 'stock not 10');
    assert(/Added 6/.test(await page.locator('body').innerText()), 'ledger line missing');
  }, 'critical');
  await s.check('Transfers: add a location and move stock out of online', async () => {
    await page.goto(stack.url('testcafe', '/storefront.html#/transfers'), { waitUntil: 'load' }); await page.waitForTimeout(1200);
    await page.locator('[data-action="location-new"]').first().click(); await page.fill('#dialog input[name=name]', 'Warehouse'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1000);
    await page.locator('[data-action="transfer-new"]').first().click();
    await page.selectOption('#dialog select[name=variant]', { index: 0 }); await page.selectOption('#dialog select[name=from]', 'online');
    await page.selectOption('#dialog select[name=to]', { index: 1 }); await page.fill('#dialog input[name=qty]', '3'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1200);
    const r = await q("select sum(qty)::int n from sfx_location_stock"); assert(r[0].n === 3, JSON.stringify(r));
    assert(/Moved 3/.test(await page.locator('body').innerText()), 'transfer not shown');
  }, 'critical');
  await s.check('Categories: rename a category and edit tags', async () => {
    await page.goto(stack.url('testcafe', '/storefront.html#/categories'), { waitUntil: 'load' }); await page.waitForTimeout(1200);
    await page.locator('[data-action^="category-rename:"]').first().click(); await page.fill('#dialog input[name=name]', 'Kitchen'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1000);
    assert((await q("select count(*)::int n from sfx_products where category='Kitchen'"))[0].n >= 1, 'not renamed');
    await page.locator('[data-action^="tags-edit:"]').first().click(); await page.fill('#dialog input[name=tags]', 'Gift, New'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1000);
    assert((await q("select count(*)::int n from sfx_products where 'gift' = any(tags)"))[0].n >= 1, 'tags not saved');
  });
  await s.check('Shipping, drafts and abandoned-checkout capture work from the hub', async () => {
    await page.goto(stack.url('testcafe', '/storefront.html#/shipping'), { waitUntil: 'load' }); await page.waitForTimeout(1200);
    await page.fill('input[name=fee]', '45'); await page.fill('input[name=freeOver]', '900'); await page.locator('form[data-key="checkout-settings"] button.primary').click(); await page.waitForTimeout(900);
    assert((await q("select config->'shipping'->>'fee' f from sfx_stores s join tenants t on t.id=s.tenant_id where t.slug='testcafe'"))[0].f === '45', 'shipping not saved');
    await page.goto(stack.url('testcafe', '/storefront.html#/abandoned-checkouts'), { waitUntil: 'load' }); await page.waitForTimeout(1000);
    await page.locator('[data-action="abandon-toggle"]').click(); await page.waitForTimeout(900);
    assert((await q("select config->>'abandonCapture' c from sfx_stores s join tenants t on t.id=s.tenant_id where t.slug='testcafe'"))[0].c === 'true', 'capture not on');
    await page.goto(stack.url('testcafe', '/storefront.html#/drafts'), { waitUntil: 'load' }); await page.waitForTimeout(1200);
    await page.locator('[data-action="draft-new"]').click(); await page.waitForTimeout(600);
    await page.fill('#dialog input[name=name]', 'Phone Buyer'); await page.selectOption('#dialog select[name=v0]', { index: 1 }); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1000);
    assert(/Phone Buyer/.test(await page.locator('body').innerText()), 'draft not listed');
    await page.locator('[data-action^="draft-convert:"]').first().click(); await page.waitForTimeout(1200);
    assert((await q("select count(*)::int n from sfx_orders where customer->>'name'='Phone Buyer'"))[0].n === 1, 'order not created');
  }, 'critical');
  await s.check('Returns: start from a fulfilled order and walk it to refunded', async () => {
    const o = (await q("select id from sfx_orders where customer->>'name'='Phone Buyer'"))[0].id;
    await q("update sfx_orders set status='fulfilled' where id=$1", [o]);
    await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + o), { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.locator('[data-action^="return-new:"]').click(); await page.fill('#dialog input[name=rq0]', '1'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1200);
    for (const st of ['approved', 'received']) { await page.locator('[data-action$=":' + st + '"]').first().click(); await page.waitForTimeout(900); }
    await page.locator('[data-action$=":refunded"]').first().click(); await page.waitForTimeout(500); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1000);
    assert((await q("select status from sfx_returns"))[0].status === 'refunded', 'not refunded');
  }, 'critical');
  await s.check('Segments, companies and growth pages save', async () => {
    await page.goto(stack.url('testcafe', '/storefront.html#/segments'), { waitUntil: 'load' }); await page.waitForTimeout(1000);
    await page.locator('[data-action="segment-new"]').click(); await page.fill('#dialog input[name=name]', 'Loyal'); await page.fill('#dialog input[name=minOrders]', '1'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(900);
    assert((await q("select count(*)::int n from sfx_segments"))[0].n === 1, 'segment');
    await page.goto(stack.url('testcafe', '/storefront.html#/companies'), { waitUntil: 'load' }); await page.waitForTimeout(1000);
    await page.locator('[data-action="company-new"]').click(); await page.fill('#dialog input[name=name]', 'Acme Ltd'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(900);
    assert((await q("select count(*)::int n from sfx_companies"))[0].n === 1, 'company');
    await page.goto(stack.url('testcafe', '/storefront.html#/growth'), { waitUntil: 'load' }); await page.waitForTimeout(1000);
    await page.locator('[data-action="campaign-new"]').click(); await page.fill('#dialog input[name=name]', 'Reel'); await page.fill('#dialog input[name=spend]', '300'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(900);
    assert((await q("select count(*)::int n from sfx_campaigns"))[0].n === 1, 'campaign');
  });
  await s.check('Custom domain: certificate check, host check, tenant script and CORS follow a verified live store', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    await q("insert into sfx_domains (tenant_id, hostname, token, status) values ($1,'shop.example.in','tok','verified') on conflict (hostname) do update set status='verified'", [tid]);
    await q("insert into sfx_domains (tenant_id, hostname, token, status) values ($1,'pending.example.in','tok2','pending') on conflict (hostname) do nothing", [tid]);
    const get = (p, h = {}) => fetch(stack.apiBase + p, { headers: h });
    assert((await get('/site/ask-tls?domain=shop.example.in')).status === 200, 'verified domain not allowed a certificate');
    assert((await get('/site/ask-tls?domain=pending.example.in')).status === 403, 'unverified domain got a certificate');
    assert((await get('/site/ask-tls?domain=evil.example.org')).status === 403, 'unknown domain got a certificate');
    assert((await get('/site/custom-check', { 'x-forwarded-host': 'shop.example.in' })).headers.get('x-site-slug') === 'testcafe', 'host check');
    assert((await get('/site/custom-check', { 'x-forwarded-host': 'pending.example.in' })).status === 404, 'pending host served');
    assert((await get('/site/custom-check', { 'x-forwarded-host': 'testcafe.auzslab.in' })).status === 404, 'our own address answered as custom');
    const js = await (await get('/site/custom-tenant.js', { 'x-forwarded-host': 'shop.example.in' })).text(); assert(js === 'window.TENANT_SLUG="testcafe";', js);
    await new Promise((r) => setTimeout(r, 3500));
    const pre = await fetch(stack.apiBase + '/rpc/public_sfx_store', { method: 'OPTIONS', headers: { origin: 'https://shop.example.in', 'access-control-request-method': 'POST' } });
    const allow = pre.headers.get('access-control-allow-origin');
    const bad = await fetch(stack.apiBase + '/rpc/public_sfx_store', { method: 'OPTIONS', headers: { origin: 'https://evil.example.org', 'access-control-request-method': 'POST' } });
    assert(allow === 'https://shop.example.in', 'CORS not allowed for the verified store domain: ' + allow);
    assert(!bad.headers.get('access-control-allow-origin'), 'CORS allowed for a stranger');
  }, 'critical');
  await s.check('No script errors on either page', async () => { assert(!errs.filter((e) => !/sentry|fonts|sfx_discount_save/i.test(e)).length, errs.slice(0, 3).join(' | ')); });
}
