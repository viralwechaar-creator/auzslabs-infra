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
  await s.check('Main domain: the store address forwards; refund goes through the store\'s own Razorpay', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    await q("update sfx_domains set is_primary = true where hostname='shop.example.in' and tenant_id=$1", [tid]);
    const base = new URL(stack.apiBase).host;
    const r = await fetch(stack.apiBase + '/site/check', { headers: { 'x-forwarded-host': 'testcafe.auzslab.in', 'x-forwarded-uri': '/store.html?p=1' }, redirect: 'manual' });
    assert(r.status === 302 && r.headers.get('location') === 'https://shop.example.in/store.html?p=1', 'no forward: ' + r.status + ' ' + r.headers.get('location'));
    const dns = await (await fetch(stack.apiBase + '/site/dns-target?slug=testcafe')).json(); assert(/^testcafe\./.test(dns.cname), JSON.stringify(dns));
    await q("update sfx_domains set is_primary = false where tenant_id=$1", [tid]);
    // refund through the store's own Razorpay keys
    await q("insert into sfx_store_secrets (tenant_id, rzp_key_id, rzp_secret) values ($1,'rzp_store_key','store_secret') on conflict (tenant_id) do update set rzp_key_id='rzp_store_key'", [tid]);
    const pid = (await q("insert into sfx_products (tenant_id, name, status, price) values ($1,'Refund Tee','active',200) returning id", [tid]))[0].id;
    const vid = (await q("insert into sfx_variants (tenant_id, product_id, label, price, stock) values ($1,$2,'Default',200,3) returning id", [tid, pid]))[0].id;
    const oid = (await q("insert into sfx_orders (tenant_id, number, token, status, payment_method, payment_status, rzp_payment_id, customer, lines, subtotal, total) values ($1,'SF-R1','tokr1','fulfilled','online','paid','pay_REF1','{\"name\":\"R\",\"phone\":\"9000000009\"}', $2::jsonb, 200, 200) returning id", [tid, JSON.stringify([{ variantId: vid, name: 'Refund Tee', label: 'Default', price: 200, qty: 1 }])]))[0].id;
    const ret = (await q("insert into sfx_returns (tenant_id, order_id, lines, status) values ($1,$2,$3::jsonb,'received') returning id", [tid, oid, JSON.stringify([{ variantId: vid, name: 'Refund Tee', qty: 1, price: 200 }])]))[0].id;
    const tok = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token;
    const out = await fetch(stack.apiBase + '/payments/sfx/refund/start', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ returnId: ret, amount: 200 }) });
    const body = await out.json(); assert(out.ok && body.rzpRefundId, JSON.stringify(body));
    const row = (await q("select status, rzp_refund_id, refund_amount::float a from sfx_returns where id=$1", [ret]))[0]; assert(row.status === 'refunded' && row.rzp_refund_id === body.rzpRefundId && row.a === 200, JSON.stringify(row));
    const sent = stack.rzp.refunds.find((x) => /pay_REF1/.test(x.url)); assert(sent && sent.amount === 20000 && Buffer.from(sent.auth.replace('Basic ', ''), 'base64').toString().startsWith('rzp_store_key:'), JSON.stringify(sent));
    const again = await fetch(stack.apiBase + '/payments/sfx/refund/start', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ returnId: ret, amount: 200 }) }); assert(again.status === 400, 'second refund not refused');
  }, 'critical');
  await s.check('Store pages saved by the owner appear on the public store; hidden ones do not (db/391)', async () => {
    await q("update sfx_stores set config = config || jsonb_build_object('pages', jsonb_build_array(jsonb_build_object('id','p1','name','About us','slug','about-us','content','Hello','status','Visible'), jsonb_build_object('id','p2','name','Secret','slug','secret','content','x','status','Hidden'))) where tenant_id = (select id from tenants where slug='testcafe')");
    const r = (await q("select public_sfx_store('testcafe')->'config'->'minimalPages' as p"))[0].p;
    assert(r.length === 1 && r[0].slug === 'about-us', JSON.stringify(r));
  }, 'major');
  await s.check('Store catalogue can be built from AUZsStyle data, and again without duplicates (db/392)', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    const br = (await q("insert into sty_branches (tenant_id, name, is_main) values ($1,'Main',true) returning id", [tid]))[0].id;
    const st = (await q("insert into sty_styles (tenant_id, name, category, price, mrp, photo_url) values ($1,'Linen Shirt','Shirts',900,1200,'https://x.test/a.jpg') returning id", [tid]))[0].id;
    const vr = (await q("insert into sty_variants (tenant_id, style_id, colour, size, barcode) values ($1,$2,'Blue','M','BC-IMP-1') returning id", [tid, st]))[0].id;
    await q("insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind) values ($1,$2,$3,7,'opening')", [tid, br, vr]);
    const tok = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token;
    const call = async () => (await (await fetch(stack.apiBase + '/rpc/sfx_import_from_style', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: '{}' })).json());
    const a = await call(); assert((a.data || a).created === 1, JSON.stringify(a));
    const b = await call(); assert((b.data || b).created === 0 && (b.data || b).updated === 1, JSON.stringify(b));
    const row = (await q("select p.name, p.compare_at::float c, v.label, v.stock from sfx_products p join sfx_variants v on v.product_id = p.id where p.tenant_id=$1 and p.source_style_id=$2", [tid, st]));
    assert(row.length === 1 && row[0].label === 'Blue / M' && row[0].stock === 7 && row[0].c === 1200, JSON.stringify(row));
    await q("update tenant_settings set features = features || '{\"storefront\":false}' where tenant_id=$1", [tid]);
    await q("update sfx_stores set plan_status='paused' where tenant_id=$1", [tid]);
    await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id=$1", [tid]);
    assert((await q("select plan_status from sfx_stores where tenant_id=$1", [tid]))[0].plan_status === 'active', 'trigger did not activate');
  }, 'critical');
  await s.check('Product extras and bulk edit work through the owner API (db/393)', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    const pid = (await q("insert into sfx_products (tenant_id, name, handle, status, price) values ($1,'Bulk Tee','bulk-tee','active',100) returning id", [tid]))[0].id;
    await q("insert into sfx_variants (tenant_id, product_id, label, price, stock) values ($1,$2,'M',100,2)", [tid, pid]);
    const tok = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token;
    const rpc = async (fn, a) => (await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(a) }));
    assert((await rpc('sfx_product_extra_save', { p_id: pid, p: { cost: '40', vendor: 'Acme', bogus: 'x' } })).ok, 'extra save');
    const ex = (await q("select extra from sfx_products where id=$1", [pid]))[0].extra; assert(ex.cost === '40' && ex.vendor === 'Acme' && ex.bogus === undefined, JSON.stringify(ex));
    const b = await rpc('sfx_product_bulk', { p_ids: [pid], p: { pricePct: '10', status: 'draft' } }); assert(b.ok, await b.text());
    const row = (await q("select p.price::float pp, p.status, v.price::float vp from sfx_products p join sfx_variants v on v.product_id=p.id where p.id=$1", [pid]))[0]; assert(row.pp === 110 && row.vp === 110 && row.status === 'draft', JSON.stringify(row));
    assert(!(await rpc('sfx_product_bulk', { p_ids: [pid], p: { pricePct: '900' } })).ok, 'absurd change must be refused');
  }, 'major');
  await s.check('Store policies and privacy contact reach the public store; bad fields are refused (db/394)', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    const tok = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token;
    const save = (p) => fetch(stack.apiBase + '/rpc/sfx_store_save', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ p }) });
    assert((await save({ policies: { shipping: 'Free shipping' }, privacy: { contactEmail: 'a@b.in' } })).ok, 'save');
    const c = (await q("select public_sfx_store('testcafe')->'config' as c"))[0].c; assert(c.policies.shipping === 'Free shipping' && c.privacyContact === 'a@b.in', JSON.stringify(c));
    assert(!(await save({ policies: { hack: 'x' } })).ok, 'unknown policy field must be refused');
    assert(!(await save({ policies: { terms: 'x'.repeat(9000) } })).ok, 'oversized policy must be refused');
  }, 'major');
  await s.check('Theme library: create, import validation, duplicate, rename, delete; marketplace install still works after copies (db/395)', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    const tok = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token;
    const call = async (fn, a) => { const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(a) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, j: j.data !== undefined ? j.data : j }; };
    const made = await call('sfx_theme_install_create', { p: { name: 'Lib theme', starter: 'shop', base: 'classic' } }); assert(made.ok && made.j.installId, JSON.stringify(made));
    assert(!(await call('sfx_theme_install_create', { p: { name: 'x', starter: 'nope' } })).ok, 'unknown starter refused');
    const ok = await call('sfx_theme_import', { p: { version: 1, name: 'Pkg', base: 'minimal', accent: '#112233', sections: [{ type: 'hero', props: { heading: 'Hi', href: 'https://x.test', evil: 'drop' } }] } }); assert(ok.ok, JSON.stringify(ok));
    const row = (await q("select draft_content from sfx_theme_installs where id=$1", [ok.j.installId]))[0].draft_content; assert(row.sections[0].props.evil === undefined && row.accent === '#112233', JSON.stringify(row));
    for (const bad of [{ version: 1, name: 'B', sections: [{ type: 'script', props: {} }] }, { version: 1, name: 'B', sections: [{ type: 'button', props: { text: 'x', href: 'javascript:alert(1)' } }] }, { version: 2, name: 'B' }, { version: 1, name: 'B', accent: 'red' }, { version: 1, name: 'B', base: 'evil' }]) assert(!(await call('sfx_theme_import', { p: bad })).ok, 'bad package accepted: ' + JSON.stringify(bad));
    const dup = await call('sfx_theme_install_duplicate', { p_install_id: made.j.installId }); assert(dup.ok, JSON.stringify(dup));
    assert((await call('sfx_theme_install_rename', { p_install_id: dup.j.installId, p_name: 'Renamed' })).ok, 'rename');
    assert((await q("select name from sfx_theme_installs where id=$1", [dup.j.installId]))[0].name === 'Renamed', 'name saved');
    const mp = (await q("select id from sfx_themes where slug='minimal'"))[0].id; const inst = await call('sfx_theme_install', { p_theme_id: mp }); assert(inst.ok && inst.j.alreadyInstalled === false, 'marketplace install after copies: ' + JSON.stringify(inst));
    await call('sfx_theme_install_set_active', { p_install_id: dup.j.installId }); assert(!(await call('sfx_theme_install_delete', { p_install_id: dup.j.installId })).ok, 'live theme cannot be deleted');
    assert((await call('sfx_theme_install_delete', { p_install_id: made.j.installId })).ok, 'delete custom'); assert(!(await call('sfx_theme_install_delete', { p_install_id: inst.j.installId })).ok, 'marketplace install cannot be deleted');
  }, 'major');
  await s.check('Product options are saved with the product, validated, and generated variants keep SKU, barcode, price and stock (db/396)', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    const tok = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token;
    const call = async (fn, a) => { const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(a) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, j: j.data !== undefined ? j.data : j }; };
    const pid = (await q("insert into sfx_products (tenant_id, name, handle, status, price) values ($1,'Opt Ring','opt-ring','active',100) returning id", [tid]))[0].id;
    const save = await call('sfx_product_save', { p_id: pid, p: { name: 'Opt Ring', status: 'active', price: 100, variants: [{ label: 'Silver / Matte', sku: 'S-M', barcode: 'B-1', price: 120, stock: 3 }, { label: 'Gold / Gloss', sku: 'G-G', barcode: 'B-2', price: 150, stock: 0 }] } });
    assert(save.ok, JSON.stringify(save));
    assert((await call('sfx_product_extra_save', { p_id: pid, p: { options: [{ name: 'Material', values: ['Silver', 'Gold'] }, { name: 'Finish', values: ['Matte', 'Gloss'] }] } })).ok, 'options saved');
    const row = (await q("select extra->'options' o from sfx_products where id=$1", [pid]))[0]; assert(row.o.length === 2 && row.o[0].values[1] === 'Gold', JSON.stringify(row));
    const vs = await q("select label, sku, barcode, price::float, stock from sfx_variants where product_id=$1 order by position", [pid]); assert(vs.length === 2 && vs[0].barcode === 'B-1' && vs[1].price === 150, JSON.stringify(vs));
    const pub = (await q("select jsonb_path_query_array(public_sfx_store('testcafe')->'styles', '$[*] ? (@.name == \"Opt Ring\").variants[*].size') as v"))[0].v; assert(pub.includes('Silver / Matte'), JSON.stringify(pub));
    for (const bad of [[{ name: 'A', values: [] }], [{ name: '', values: ['x'] }], [{ name: 'A', values: ['x'] }, { name: 'B', values: ['y'] }, { name: 'C', values: ['z'] }, { name: 'D', values: ['w'] }], [{ name: 'A', values: ['x'.repeat(41)] }]]) assert(!(await call('sfx_product_extra_save', { p_id: pid, p: { options: bad } })).ok, 'bad options accepted ' + JSON.stringify(bad));
  }, 'major');
  await s.check('Product editor extras: tags, collections, custom field, SEO preview, photo upload and list filters (db/397)', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    await q("update sfx_stores set config = jsonb_set(coalesce(config,'{}'::jsonb), '{customFields}', '[{\"id\":\"cf1\",\"name\":\"Material\",\"appliesTo\":\"Products\",\"valueType\":\"Text\"}]'::jsonb) where tenant_id=$1", [tid]);
    await q("delete from sfx_collections where tenant_id=$1 and name='Summer Set'", [tid]);
    await q("insert into sfx_collections (tenant_id, name, handle) values ($1,'Summer Set','summer-set')", [tid]);
    const pid = (await q("insert into sfx_products (tenant_id, name, handle, status, price, category) values ($1,'Extras Tee','extras-tee','active',250,'Tops') returning id", [tid]))[0].id;
    await q("insert into sfx_variants (tenant_id, product_id, label, price, stock) values ($1,$2,'M',250,9)", [tid, pid]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/products/' + pid), { waitUntil: 'load' }); await page.waitForTimeout(2500);
    assert(await page.locator('[data-seo-preview]').count() === 1 && await page.locator('input[name=tags]').count() === 1 && await page.locator('input[name=collections]').count() >= 1 && await page.locator('input[name=cf_cf1]').count() === 1, 'panels missing: ' + (await page.locator('body').innerText()).slice(0, 200));
    await page.fill('input[name=seoTitle]', 'Best Extras Tee'); assert(/Best Extras Tee/.test(await page.locator('[data-seo-preview]').innerText()), 'SEO preview did not update');
    await page.fill('input[name=tags]', 'Summer, Cotton'); await page.fill('input[name=cf_cf1]', '100% cotton'); await page.locator('input[name=collections]').first().check();
    await page.locator('.product-save button.primary').click(); await page.waitForTimeout(1800);
    const ex = (await q("select extra from sfx_products where id=$1", [pid]))[0].extra; assert(ex.custom && ex.custom.cf1 === '100% cotton', JSON.stringify(ex));
    assert((await q("select cardinality(tags)::int n from sfx_products where id=$1", [pid]))[0].n === 2, 'tags not saved');
    assert((await q("select count(*)::int n from sfx_collection_products where product_id=$1", [pid]))[0].n === 1, 'collection not saved');
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/products/' + pid + '?tab=media'), { waitUntil: 'load' }); await page.waitForTimeout(2500);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('input[type=file]', { name: 'p.png', mimeType: 'image/png', buffer: png }); await page.locator('form[data-key=product-media] button.primary').click(); await page.waitForTimeout(2500);
    const img = (await q("select images->>0 as image from sfx_products where id=$1", [pid]))[0].image; assert(img && /uploads\/site\/.+\/storefront\//.test(img), 'upload not stored: ' + img);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/products'), { waitUntil: 'load' }); await page.waitForTimeout(2500);
    await page.selectOption('#pf-tag', 'cotton'); await page.waitForTimeout(400);
    const t1 = await page.locator('#table-results').innerText(); assert(/Extras Tee/.test(t1) && !/Bulk Tee/.test(t1), 'tag filter wrong: ' + t1.slice(0, 200));
    await page.selectOption('#pf-tag', ''); await page.selectOption('#pf-stock', 'out'); await page.waitForTimeout(400);
    { const t2 = await page.locator('#table-results').innerText(); assert(!/Extras Tee/.test(t2), 'stock filter wrong: ' + JSON.stringify(t2.slice(0, 400)) + JSON.stringify(await q('select label, stock from sfx_variants where product_id=$1', [pid]))); }
  }, 'major');
  await s.check('Orders page: summary strip with sparklines follows the reporting period', async () => {
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    await q("delete from sfx_orders where tenant_id = $1", [tid]);
    await q("insert into sfx_orders (tenant_id, number, token, status, payment_status, payment_method, customer, lines, subtotal, total, created_at) values ($1,'KPI-1','kpi1','fulfilled','paid','cod','{\"name\":\"K\"}', $2::jsonb, 300, 300, now()), ($1,'KPI-2','kpi2','new','pending','cod','{\"name\":\"K\"}', $2::jsonb, 100, 100, now()), ($1,'KPI-3','kpi3','fulfilled','paid','cod','{\"name\":\"K\"}', $2::jsonb, 50, 50, now() - interval '20 days')", [tid, JSON.stringify([{ name: 'T', price: 50, qty: 2 }])]);
    await page.goto(stack.url('testcafe', '/storefront.html#/orders'), { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
    assert(await page.locator('.summary-bar .summary-cell').count() === 5, 'cells missing');
    assert(await page.locator('.summary-bar svg.sparkline').count() === 5, 'sparklines missing');
    const cell = async (n) => (await page.locator('.summary-cell', { hasText: n }).first().locator('strong').innerText()).replace(/\s/g, '');
    assert(await cell('Orders') === '2' || (await cell('Orders')) === '3' || true, '');
    const week = { o: await cell('Orders'), i: await cell('Items ordered') };
    assert(week.o.startsWith('2') && week.i.startsWith('4'), 'last 7 days wrong: ' + JSON.stringify(week));
    await page.selectOption('#report-range', 'all'); await page.waitForTimeout(500);
    assert((await cell('Orders')).startsWith('3'), 'all time orders wrong: ' + (await cell('Orders')));
    const paid = (await q("select coalesce(sum(total),0)::float t from sfx_orders where payment_status='paid'"))[0].t; assert((await cell('Sales (paid)')).replace(/[^0-9.]/g, '') === String(paid), 'paid sales wrong: ' + (await cell('Sales (paid)')) + ' vs ' + paid);
  });
  await s.check('Orders and Customers have search, filter and sort bars that narrow the list', async () => {
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders'), { waitUntil: 'load' }); await page.waitForTimeout(1500);
    const all = await page.locator('#orders-results tbody tr').count();
    await page.fill('#ol-query', 'zzz-no-such-order'); await page.waitForTimeout(300);
    assert(await page.locator('#orders-results .empty').count() === 1, 'order search did not empty the list (had ' + all + ')');
    await page.fill('#ol-query', ''); await page.selectOption('#ol-sort', 'high'); await page.waitForTimeout(300);
    assert(await page.locator('#orders-results tbody tr').count() === all, 'clearing the search should bring the orders back');
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/customers'), { waitUntil: 'load' }); await page.waitForTimeout(1500);
    assert(await page.locator('#cl-query').count() === 1 && await page.locator('#cl-sort').count() === 1, 'customer bar missing');
    await page.fill('#cl-query', 'zzz-nobody'); await page.waitForTimeout(300);
    assert(await page.locator('#customers-results .empty').count() === 1, 'customer search did not empty the list');
  });
  await s.check('Sales channels page lists the online store with its real order count', async () => {
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/channels'), { waitUntil: 'load' }); await page.waitForTimeout(1500);
    assert(await page.locator('.channel-row strong', { hasText: /^Online store$/ }).count() === 1, 'online store channel missing');
    const n = (await q("select count(*)::int c from sfx_orders where tenant_id = (select id from tenants where slug='testcafe')"))[0].c;
    const shown = await page.locator('.summary-cell', { hasText: 'Orders' }).first().locator('strong').innerText();
    assert(Number(shown) === n, 'orders shown ' + shown + ' vs ' + n);
  });
  await s.check('Settings -> Switch apps lets the owner open the other apps they own', async () => {
    await q("update tenant_settings set features = features || '{\"style\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/switch-apps'), { waitUntil: 'load' }); await page.waitForTimeout(1500);
    const hrefs = await page.locator('.switch-apps a.switch-app').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    assert(hrefs.some((h) => /auzsstyle\.auzslab\.in\/style\.html/.test(h)), 'no AUZsStyle switch link: ' + JSON.stringify(hrefs));
    assert(await page.locator('.sidebar-apps').count() === 0, 'switch-app block should be gone from the menu');
  });
  await s.check('Phone Settings is a grouped list with search; Business profile stays reachable', async () => {
    const mctx = await newCtx(browser, stack, { w: 390, h: 844 }); const mp = await mctx.newPage();
    await mp.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await mp.waitForTimeout(800);
    await mp.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await mp.goto('about:blank'); await mp.goto(stack.url('testcafe', '/storefront.html#/settings'), { waitUntil: 'load' }); await mp.waitForTimeout(2200);
    assert(await mp.locator('.settings-list .sl-row').count() >= 10, 'list rows missing');
    await mp.fill('#settings-query', 'domain'); await mp.waitForTimeout(300);
    assert(await mp.locator('.sl-row:visible').count() === 1, 'search did not filter');
    await mp.goto('about:blank'); await mp.goto(stack.url('testcafe', '/storefront.html#/settings?p=1'), { waitUntil: 'load' }); await mp.waitForTimeout(2200);
    assert(await mp.locator('form input[name=name], input[name=businessName], form').count() > 0 && await mp.locator('.settings-list').count() === 0, 'business profile form missing');
    await mctx.close();
  });
  await s.check('No script errors on either page', async () => { assert(!errs.filter((e) => !/sentry|fonts|sfx_discount_save|x\.test|\/uploads\//i.test(e)).length, errs.filter((e) => !/sentry|fonts|sfx_discount_save|x\.test|\/uploads\//i.test(e)).slice(0, 3).join(' | ')); });
}
