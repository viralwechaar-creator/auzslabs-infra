// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront orders', 'Per-shipment fulfilment, separate fulfilment and delivery states, channel tag, cancel rules.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Ship tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 20 }, { label: 'M', price: 100, stock: 20 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const get = async (id) => (await call('sfx_order_get', { p_id: id })).data ?? (await call('sfx_order_get', { p_id: id }));
  let oid;

  await s.check('A new order starts online, unfulfilled, no delivery, not oversold', async () => {
    oid = await place(); const o = await get(oid);
    assert(o.channel === 'online' && o.fulfilmentStatus === 'unfulfilled' && o.deliveryStatus === 'none' && o.oversold === false, JSON.stringify(o).slice(0, 300));
    assert(o.remaining.reduce((a, r) => a + r.qty, 0) === 3, 'remaining should be 3');
  }, 'critical');
  await s.check('Shipping part of the order makes it partial and keeps the rest to ship', async () => {
    await call('sfx_shipment_create', { p_order: oid, p: { items: [{ variantId: vs, qty: 1 }], carrier: 'BlueDart', tracking: 'BD1' } });
    const o = await get(oid);
    assert(o.fulfilmentStatus === 'partial' && o.status !== 'fulfilled' && o.shipments.length === 1, JSON.stringify([o.fulfilmentStatus, o.status]));
    assert(o.remaining.reduce((a, r) => a + r.qty, 0) === 2, 'remaining should be 2');
  }, 'critical');
  await s.check('Cannot ship more than is left, an unknown item, or nothing', async () => {
    const e = async (items) => JSON.stringify((await rpc(stack, 'sfx_shipment_create', { p_order: oid, p: { items } }, owner)).data).toLowerCase();
    assert(/only ship/.test(await e([{ variantId: vs, qty: 5 }])), 'over-ship allowed');
    assert(/not on this order/.test(await e([{ variantId: '00000000-0000-0000-0000-000000000000', qty: 1 }])), 'unknown item allowed');
    assert(/choose at least one/.test(await e([{ variantId: vs, qty: 0 }])), 'empty shipment allowed');
  }, 'critical');
  await s.check('Cancelling is refused once something has shipped', async () => {
    const r = JSON.stringify((await rpc(stack, 'sfx_order_set_status', { p_id: oid, p_status: 'cancelled' }, owner)).data).toLowerCase();
    assert(/cannot be cancelled/.test(r), r);
  }, 'critical');
  await s.check('Shipping the rest makes it fulfilled; delivery follows the shipments', async () => {
    await call('sfx_shipment_create', { p_order: oid, p: {} });
    let o = await get(oid); assert(o.fulfilmentStatus === 'fulfilled' && o.status === 'fulfilled' && o.deliveryStatus === 'in_transit', JSON.stringify([o.fulfilmentStatus, o.status, o.deliveryStatus]));
    await call('sfx_shipment_update', { p_id: o.shipments[0].id, p: { status: 'delivered' } });
    o = await get(oid); assert(o.deliveryStatus === 'partly_delivered', o.deliveryStatus);
    await call('sfx_shipment_update', { p_id: o.shipments[1].id, p: { status: 'in_transit' } });
    await call('sfx_shipment_update', { p_id: o.shipments[1].id, p: { status: 'delivered' } });
    o = await get(oid); assert(o.deliveryStatus === 'delivered' && o.shipments.every((x) => x.deliveredAt), o.deliveryStatus);
  }, 'critical');
  await s.check('A delivered shipment cannot go back; a bad tracking link is refused', async () => {
    const o = await get(oid);
    const r = JSON.stringify((await rpc(stack, 'sfx_shipment_update', { p_id: o.shipments[0].id, p: { status: 'in_transit' } }, owner)).data).toLowerCase();
    assert(/cannot become/.test(r), r);
    const r2 = JSON.stringify((await rpc(stack, 'sfx_shipment_update', { p_id: o.shipments[0].id, p: { trackingUrl: 'http://x.com/t' } }, owner)).data).toLowerCase();
    assert(/https/.test(r2), r2);
  });
  await s.check('The old one-step fulfil still works and cancelling an untouched order restores stock', async () => {
    const o2 = await place(); await call('sfx_order_set_status', { p_id: o2, p_status: 'fulfilled', p_tracking: 'T9' });
    const a = await get(o2); assert(a.fulfilmentStatus === 'fulfilled' && a.shipments.length === 1 && a.shipments[0].tracking === 'T9', JSON.stringify(a.shipments));
    const o3 = await place(); const before = Number((await q('select stock from sfx_variants where id=$1', [vs]))[0].stock);
    await call('sfx_order_set_status', { p_id: o3, p_status: 'cancelled' });
    assert(Number((await q('select stock from sfx_variants where id=$1', [vs]))[0].stock) === before + 2, 'stock not restored');
  }, 'critical');
  await s.check('The customer order page shows the three states and shipments without internal ids', async () => {
    const tok = (await q('select token from sfx_orders where id=$1', [oid]))[0].token;
    const p = (await rpc(stack, 'public_sfx_order', { p_token: tok })).data;
    const d = p.data ?? p;
    assert(d.fulfilmentStatus === 'fulfilled' && d.deliveryStatus === 'delivered' && d.shipments.length === 2 && !('id' in d.shipments[0]), JSON.stringify(d).slice(0, 300));
  });
  await s.check('Another business cannot read or change this order\'s shipments', async () => {
    const other = await login(USERS.salonOwner || USERS.cafeOwner);
    if (other === owner) return;
    const sid = (await q('select id from sfx_shipments where order_id=$1 limit 1', [oid]))[0].id;
    const r = JSON.stringify((await rpc(stack, 'sfx_shipment_update', { p_id: sid, p: { carrier: 'X' } }, other)).data).toLowerCase();
    assert(/not found|not enabled|denied|permission|storefront/.test(r), r);
  });
  await s.check('The order page shows fulfilment per shipment and the Fulfil items dialog creates one', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    const o4 = await place();
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + o4), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    let t = await page.locator('body').innerText();
    assert(/Nothing shipped yet/.test(t) && /Delivery/.test(t) && /Online store/.test(t), t.slice(0, 400));
    await page.getByRole('button', { name: 'Fulfil items' }).first().click(); await page.waitForTimeout(500);
    await page.locator('input[name^="q_"]').first().fill('1');
    await page.locator('input[name=tracking]').fill('UI123');
    await page.getByRole('button', { name: 'Create shipment' }).click(); await page.waitForTimeout(1500);
    t = await page.locator('body').innerText();
    assert(/Shipment 1/.test(t) && /UI123/.test(t) && /still to ship/.test(t) && /Partially fulfilled/.test(t), t.slice(0, 600));
    await s.shot(page, 'sfx-order-shipment');
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  }, 'critical');
  await s.check('Order page links to the customer (with their orders) and to the product', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    const o5 = await place();
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + o5), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    assert(await page.locator('aside a[data-action^="customer-detail:"]').count() === 1, 'no customer link');
    assert(await page.locator('main a[href*="#/products/"]').count() >= 1, 'no product link');
    await page.evaluate(() => document.querySelector('aside a[data-action^="customer-detail:"]').click()); await page.waitForTimeout(1500);
    const d = await page.locator('#dialog').innerText();
    assert(/Orders/.test(d) && /#\d+|#[A-Z0-9-]+/.test(d), d.slice(0, 300));
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Discount Used count opens the orders that used the code', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    const o6 = await place(); await place();
    await q("update sfx_orders set discount_code='LINK10' where id=$1", [o6]);
    await q("delete from sfx_discounts where tenant_id=(select id from tenants where slug='testcafe') and upper(code)='LINK10'");
    await q("insert into sfx_discounts (tenant_id, code, kind, value, used_count, status) select id, 'LINK10', 'percent', 10, 1, 'active' from tenants where slug='testcafe'");
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/discounts'), { waitUntil: 'load' }); await page.waitForTimeout(3000);
    await page.evaluate(() => document.querySelector('a[data-action="discount-orders:LINK10"]').click()); await page.waitForTimeout(1500);
    assert(/#\/orders/.test(page.url()), page.url());
    const hrefs = await page.locator('#orders-results a[href*="#/orders/"]').evaluateAll((a) => [...new Set(a.map((x) => x.getAttribute('href')))]);
    assert(hrefs.length === 1 && hrefs[0].endsWith(o6), 'orders not filtered to the code: ' + JSON.stringify(hrefs));
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Order page: internal comment on the timeline, tags, archive and the archived filter', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    const o7 = await place();
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + o7), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await page.fill('textarea[name=text]', 'Packed with a gift note');
    await page.evaluate(() => document.querySelector('textarea[name=text]').form.querySelector('button.primary, button[type=submit]').click()); await page.waitForTimeout(1500);
    let t = await page.locator('main, body').first().innerText();
    assert(/Packed with a gift note/.test(t), 'comment not on the timeline');
    const tl = (await q('select timeline from sfx_orders where id=$1', [o7]))[0].timeline; const c = tl.find((e) => e.kind === 'comment');
    assert(c && c.by && c.label === 'Packed with a gift note', JSON.stringify(tl).slice(0, 300));
    await page.evaluate(() => document.querySelector('[data-action^="order-tags:"]').click()); await page.waitForTimeout(500);
    await page.fill('#dialog input[name=tags]', 'Gift, wholesale, gift');
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1500);
    assert(JSON.stringify((await q('select tags from sfx_orders where id=$1', [o7]))[0].tags) === JSON.stringify(['gift', 'wholesale']), 'tags wrong');
    // only finished orders can be archived
    const bad = JSON.stringify((await rpc(stack, 'sfx_order_archive', { p_order: o7, p_on: true }, await (async () => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token)())).data).toLowerCase();
    assert(/only finished orders/.test(bad), 'archived an unfinished order: ' + bad);
    await q("update sfx_orders set status='fulfilled' where id=$1", [o7]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + o7), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await page.evaluate(() => document.querySelector('[data-action^="order-archive:"]').click()); await page.waitForTimeout(1500);
    assert((await q('select archived_at is not null a from sfx_orders where id=$1', [o7]))[0].a === true, 'not archived');
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    const hide = await page.locator('#orders-results a[href*="#/orders/' + o7 + '"]').count();
    assert(hide === 0, 'archived order still in the default list');
    await page.selectOption('#ol-arch', 'only'); await page.waitForTimeout(800);
    assert(await page.locator('#orders-results a[href*="#/orders/' + o7 + '"]').count() >= 1, 'archived order missing from the archived view');
    await page.fill('#ol-query', 'wholesale'); await page.waitForTimeout(500);
    assert(await page.locator('#orders-results a[href*="#/orders/' + o7 + '"]').count() >= 1, 'tag search failed');
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Order page: edit contact and address, optional profile update, shipped orders keep their address, remove customer', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    const o8 = await place();
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + o8), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await page.evaluate(() => document.querySelector('[data-action^="order-contact:"]').click()); await page.waitForTimeout(500);
    await page.fill('#dialog input[name=name]', 'Corrected Name'); await page.fill('#dialog input[name=email]', 'fixed@example.com');
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1500);
    let row = (await q('select customer, customer_id from sfx_orders where id=$1', [o8]))[0];
    assert(row.customer.name === 'Corrected Name' && row.customer.email === 'fixed@example.com', JSON.stringify(row.customer));
    const prof = (await q('select name from sfx_customers where id=$1', [row.customer_id]))[0].name;
    assert(prof !== 'Corrected Name', 'profile changed without being asked');
    await page.evaluate(() => document.querySelector('[data-action^="order-address:"]').click()); await page.waitForTimeout(500);
    await page.fill('#dialog textarea[name=address]', '99 New Street'); await page.fill('#dialog input[name=pin]', '342099');
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1500);
    row = (await q('select customer from sfx_orders where id=$1', [o8]))[0];
    assert(row.customer.address === '99 New Street' && row.customer.pin === '342099', JSON.stringify(row.customer));
    const tl = (await q('select timeline from sfx_orders where id=$1', [o8]))[0].timeline; assert(tl.some((e) => /Customer details changed/.test(e.label)), 'not on the timeline');
    // a bad email is refused, and shipped orders keep their address
    const tok = await (async () => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token)();
    assert(/valid email/.test(JSON.stringify((await rpc(stack, 'sfx_order_contact_set', { p_order: o8, p: { email: 'nope' } }, tok)).data).toLowerCase()), 'bad email accepted');
    await q("update sfx_orders set fulfilment_status='partial' where id=$1", [o8]);
    assert(/cannot change once items have shipped/.test(JSON.stringify((await rpc(stack, 'sfx_order_contact_set', { p_order: o8, p: { address: 'x' } }, tok)).data)), 'address changed after shipping');
    await q("update sfx_orders set fulfilment_status='unfulfilled' where id=$1", [o8]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + o8), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    page.once('dialog', (d) => d.accept());
    await page.evaluate(() => document.querySelector('[data-action^="order-unlink:"]').click()); await page.waitForTimeout(1500);
    row = (await q('select customer_id, customer from sfx_orders where id=$1', [o8]))[0];
    assert(row.customer_id === null && row.customer.name === 'Corrected Name', 'customer not unlinked: ' + JSON.stringify(row));
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Edit items: change quantity, add a product and a custom item, stock follows, total moves, refused when shipped or empty', async () => {
    const tok = await (async () => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token)();
    const call2 = async (fn, args) => { const d = (await rpc(stack, fn, args, tok)).data; return d && d.data !== undefined && !d.error ? d.data : d; };
    await q('update sfx_variants set stock = 50 where id = $1', [vs]);
    const o9 = await place();
    const before = (await q('select total::float t, lines from sfx_orders where id=$1', [o9]))[0]; const price = Number(before.lines[0].price);
    const stock0 = (await q('select stock from sfx_variants where id=$1', [vs]))[0].stock;
    const old0 = before.lines[0].qty;
    // raise line 1 by two: takes 2 more from stock, total goes up by 2 x price
    let r = await call2('sfx_order_edit', { p_order: o9, p: { lines: [{ index: 0, qty: old0 + 2 }], reason: 'Customer asked for more' } });
    assert(r.difference === price * 2, 'difference ' + r.difference + ' price ' + price);
    assert((await q('select stock from sfx_variants where id=$1', [vs]))[0].stock === stock0 - 2, 'stock not taken');
    // a custom item
    r = await call2('sfx_order_edit', { p_order: o9, p: { lines: [{ index: 0, qty: old0 + 2 }, { custom: { name: 'Gift wrap', price: 40 }, qty: 2 }] } });
    assert(r.difference === 80, 'custom item difference ' + r.difference);
    // reduce line 1 to one unit with restock
    r = await call2('sfx_order_edit', { p_order: o9, p: { lines: [{ index: 0, qty: 1 }], restock: true } });
    assert((await q('select stock from sfx_variants where id=$1', [vs]))[0].stock === stock0 + (old0 - 1), 'stock not restocked: ' + (await q('select stock from sfx_variants where id=$1', [vs]))[0].stock);
    const t = (await q('select lines from sfx_orders where id=$1', [o9]))[0];
    assert(t.lines.length === 3 && t.lines.some((l) => l.custom), JSON.stringify(t.lines.map((l) => l.name)));
    // too many for the shelf, and removing everything, are refused
    await q('update sfx_variants set stock = 1 where id=$1', [vs]);
    assert(/in stock|does not have/.test(JSON.stringify(await call2('sfx_order_edit', { p_order: o9, p: { lines: [{ index: 0, qty: 9 }] } }))), 'oversold by editing');
    assert(/at least one item/.test(JSON.stringify(await call2('sfx_order_edit', { p_order: o9, p: { lines: [{ index: 0, qty: 0 }, { index: 1, qty: 0 }, { index: 2, qty: 0 }] } }))), 'emptied the order');
    // paid orders note the money owed
    await q("update sfx_orders set payment_status='paid' where id=$1", [o9]);
    r = await call2('sfx_order_edit', { p_order: o9, p: { lines: [{ index: 2, qty: 0 }] } });
    const tl = (await q('select timeline from sfx_orders where id=$1', [o9]))[0].timeline; assert(tl.some((e) => /Refund due to the customer/.test(e.label)), 'refund due not noted');
    // shipped orders cannot be edited
    await q("update sfx_orders set fulfilment_status='partial' where id=$1", [o9]);
    assert(/has not shipped/.test(JSON.stringify(await call2('sfx_order_edit', { p_order: o9, p: { lines: [{ index: 0, qty: 1 }] } }))), 'edited a shipped order');
  });
  await s.check('Edit items dialog: quantities and a custom item save, and the new total shows live', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await q('update sfx_variants set stock = 50 where id = $1', [vs]);
    const o10 = await place();
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + o10), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await page.evaluate(() => document.querySelector('[data-action^="order-edit:"]').click()); await page.waitForTimeout(1500);
    await page.fill('#dialog input[name=q_0]', '2'); await page.fill('#dialog input[name=cname]', 'Engraving'); await page.fill('#dialog input[name=cprice]', '25'); await page.fill('#dialog input[name=cq]', '1'); await page.waitForTimeout(300);
    const pv = await page.locator('#edit-preview').innerText(); assert(/New total/.test(pv), pv);
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1800);
    const lines = (await q('select lines from sfx_orders where id=$1', [o10]))[0].lines;
    assert(lines[0].qty === 2 && lines.some((l) => l.name === 'Engraving' && l.custom === true), JSON.stringify(lines).slice(0, 300));
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Draft order: custom price, custom item, discount, shipping and pay-later become the real order', async () => {
    const tok = await (async () => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token)();
    const call3 = async (fn, args) => { const d = (await rpc(stack, fn, args, tok)).data; return d && d.data !== undefined && !d.error ? d.data : d; };
    await q('update sfx_variants set stock = 50 where id = $1', [vs]);
    await q("update sfx_stores set config = jsonb_set(coalesce(config,'{}'::jsonb), '{shipping}', '{\"fee\":99,\"freeOver\":0}'::jsonb) where tenant_id=$1", [tid]);
    let d = await call3('sfx_draft_save', { p_id: null, p: { name: 'Phone Customer', phone: '9876500099', lines: [{ variantId: vs, qty: 2, price: 80 }, { custom: { name: 'Fitting', price: 50 }, qty: 1 }],
      discount: { kind: 'percent', value: 10, note: 'Regular' }, shipping: { label: 'Local delivery', amount: 30 }, payLater: true } });
    // lines 2 x 80 + 50 = 210, 10% = 21, shipping 30 => 219
    assert(d.subtotal === 210 && d.discount === 21 && d.shipping === 30 && d.total === 219 && d.payLater === true, JSON.stringify([d.subtotal, d.discount, d.shipping, d.total]));
    assert(/below zero/.test(JSON.stringify(await call3('sfx_draft_save', { p_id: null, p: { name: 'X Y', lines: [{ variantId: vs, qty: 1, price: -5 }] } }))), 'negative price accepted');
    assert(/over 100/.test(JSON.stringify(await call3('sfx_draft_save', { p_id: null, p: { name: 'X Y', lines: [{ variantId: vs, qty: 1 }], discount: { kind: 'percent', value: 150 } } }))), '150% accepted');
    const stock0 = (await q('select stock from sfx_variants where id=$1', [vs]))[0].stock;
    const r = await call3('sfx_draft_convert', { p_id: d.id });
    const o = (await q('select total::float t, shipping::float sh, shipping_label sl, discount_amount::float da, discount_code dc, lines, timeline from sfx_orders where id=$1', [r.orderId]))[0];
    assert(o.t === 219 && o.sh === 30 && o.sl === 'Local delivery' && o.da === 21 && o.dc === null, JSON.stringify([o.t, o.sh, o.sl, o.da, o.dc]));
    assert((await q('select stock from sfx_variants where id=$1', [vs]))[0].stock === stock0 - 2, 'stock: custom item must not take stock, catalogue line must');
    assert(o.timeline.some((e) => /Payment due later/.test(e.label)), 'pay later not noted');
    await q("update sfx_stores set config = config - 'shipping' where tenant_id=$1", [tid]);
  });
  s.done();
}
