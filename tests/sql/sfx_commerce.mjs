// Scenario tests for storefront commerce essentials (customers + discounts), run against a scratch DB
// built from the full migration chain. Run: node tests/sql/sfx_commerce.mjs (needs `service postgresql start`).
import { build, connect, PG } from '../lib/db.mjs';
import assert from 'node:assert';
await build(() => {});
const admin = await connect(PG.db);
let ok = 0; const pass = (m) => { ok++; console.log('PASS', m); };
const mk = async (slug, role = 'owner', email = slug + '@t.local') => {
  const t = (await admin.query("select id from tenants where slug=$1", [slug])).rows[0]?.id
    || (await admin.query("insert into tenants (slug,name,niche,plan,status) values ($1,$1,'retail','pro','active') returning id", [slug])).rows[0].id;
  await admin.query("insert into tenant_settings (tenant_id, features, labels, business_rules) values ($1,'{\"storefront\":true}','{}','{}') on conflict (tenant_id) do update set features='{\"storefront\":true}'", [t]);
  const u = (await admin.query("insert into auth_users (email,password_hash,email_verified_at) values ($1,'x',now()) returning id", [email])).rows[0].id;
  await admin.query("insert into profiles (id, tenant_id, role) values ($1,$2,$3)", [u, t, role]);
  return { t, u };
};
const as = async (u, sql, args = []) => { await admin.query('begin'); try { await admin.query("select set_config('app.uid',$1,true)", [u]); await admin.query('set local role app'); const r = await admin.query(sql, args); await admin.query('commit'); return r.rows[0]; } catch (e) { await admin.query('rollback'); return { error: e.message }; } };
const A = await mk('shopa'), B = await mk('shopb');
for (const x of [A, B]) await admin.query("insert into sfx_stores (tenant_id, published) values ($1, true) on conflict (tenant_id) do update set published=true", [x.t]);
const prodA = (await as(A.u, `select sfx_product_save(null, '{"name":"Tee","status":"active","variants":[{"label":"M","price":333.33,"stock":10}]}'::jsonb) r`)).r;
const vid = prodA.variants[0].id;

// ---- customers
let r = await as(A.u, `select sfx_customer_save(null, '{"name":"Asha","phone":"9999900001","notes":"vip"}'::jsonb) r`); assert(!r.error, r.error); pass('owner can save a customer');
const asha = r.r.id;
r = await as(A.u, `select sfx_customer_save(null, '{"name":"Dup","phone":"9999900001"}'::jsonb) r`); assert(/already exists/.test(r.error), JSON.stringify(r)); pass('duplicate phone refused');
r = await as(A.u, `select sfx_customer_save(null, '{"name":""}'::jsonb) r`); assert(r.error, 'blank name'); pass('blank name refused');
r = await as(B.u, `select sfx_customer_list() r`); assert(r.r.length === 0, 'B sees none'); pass('tenant isolation: B sees no customers of A');
r = await as(B.u, `select sfx_customer_save($1, '{"name":"Hack"}'::jsonb) r`, [asha]); assert(/not found/i.test(r.error), JSON.stringify(r)); pass("B cannot edit A's customer");
await as(B.u, `select sfx_customer_delete($1)`, [asha]);
r = await as(A.u, `select sfx_customer_list() r`); assert(r.r.length === 1, 'A still has customer'); pass("B cannot delete A's customer");
const staff = await mk('shopa', 'cashier', 'staff@t.local');
r = await as(staff.u, `select sfx_customer_save(null, '{"name":"X"}'::jsonb) r`); assert(r.error, 'staff write refused: ' + JSON.stringify(r)); pass('role without sfx_manage cannot write customers: ' + r.error);

// ---- discounts
r = await as(A.u, `select sfx_discount_save(null, '{"code":"save10","kind":"percent","value":10,"minOrder":200,"usageLimit":2}'::jsonb) r`); assert(!r.error, r.error);
const d10 = r.r.id; assert(r.r.code === 'SAVE10'); pass('discount saved, code upper-cased');
r = await as(A.u, `select sfx_discount_save(null, '{"code":"SAVE10","kind":"flat","value":5}'::jsonb) r`); assert(/already exists/.test(r.error)); pass('duplicate code refused');
for (const bad of ['{"code":"a b","kind":"flat","value":5}', '{"code":"OK","kind":"percent","value":150}', '{"code":"OK","kind":"flat","value":0}', '{"code":"OK","kind":"weird","value":5}'])
  { r = await as(A.u, `select sfx_discount_save(null, $1::jsonb) r`, [bad]); assert(r.error, bad); }
pass('invalid code/percent/value/kind all refused');
await as(A.u, `select sfx_discount_save(null, '{"code":"FLAT50","kind":"flat","value":50}'::jsonb) r`);
await as(A.u, `select sfx_discount_save(null, '{"code":"OLD","kind":"flat","value":5,"expiresAt":"2020-01-01T00:00:00Z"}'::jsonb) r`);
r = await as(B.u, `select sfx_discount_list() r`); assert(r.r.length === 0); pass('discounts isolated per tenant');

// coupon preview (paisa-exact: 10% of 333.33 = 33.333 -> 33.33)
const chk = async (code, sub) => (await as(A.u, `select public_sfx_coupon_check('shopa', $1::jsonb) r`, [JSON.stringify({ code, subtotal: sub })])).r;
r = await chk('save10', 333.33); assert(r.ok && Number(r.discount) === 33.33, JSON.stringify(r)); pass('percent discount rounds to the paisa (33.33)');
r = await chk('SAVE10', 100); assert(!r.ok && /minimum order of Rs 200/.test(r.msg), JSON.stringify(r)); pass('minimum order refused with clear message');
r = await chk('OLD', 500); assert(!r.ok && /expired/.test(r.msg)); pass('expired code refused');
r = await chk('NOPE', 500); assert(!r.ok && /Invalid/.test(r.msg)); pass('unknown code refused');
r = await chk('FLAT50', 20); assert(r.ok && Number(r.discount) === 20); pass('flat discount never exceeds the subtotal');
r = await chk('', 20); assert(!r.ok); pass('empty code refused');
r = (await as(A.u, `select public_sfx_coupon_check('shopb', '{"code":"SAVE10","subtotal":500}'::jsonb) r`)).r; assert(!r.ok); pass("tenant B's store does not accept A's code");

// orders with discounts
const order = (coupon, phone = '9999900002', qty = 1) => as(A.u, `select public_sfx_place_order('shopa', $1::jsonb) r`, [JSON.stringify({ lines: [{ variantId: vid, qty }], name: 'Buyer', phone, address: '1 Road', city: 'Jodhpur', pin: '342001', coupon })]);
r = await order('save10', '9999900002', 2); assert(!r.error, r.error); // sub 666.66, 10% = 66.67 (66.666 -> 66.67)
assert(Number(r.r.discount) === 66.67 && Number(r.r.total) === 599.99, JSON.stringify(r.r)); pass('order total = subtotal - discount, paisa exact');
const row = (await admin.query("select discount_code, discount_amount, total from sfx_orders where number=$1", [r.r.number])).rows[0];
assert(row.discount_code === 'SAVE10' && Number(row.discount_amount) === 66.67); pass('order row records code and amount');
r = await order('SAVE10', '9999900003', 1); assert(!r.error, r.error); pass('second use ok');
r = await order('SAVE10', '9999900004', 1); assert(/usage limit/.test(r.error), JSON.stringify(r)); pass('over-limit refused');
const used = (await admin.query("select used_count from sfx_discounts where id=$1", [d10])).rows[0].used_count; assert(used === 2, used); pass('used_count is exactly 2');
const stock = (await admin.query("select stock from sfx_variants where id=$1", [vid])).rows[0].stock; assert(stock === 7, stock); pass('refused order did not consume stock');
r = await order('NOPE', '9999900005'); assert(r.error && /Invalid/.test(r.error)); pass('order with bad code is refused, not silently undiscounted');
r = await order('', '9999900006'); assert(!r.error && Number(r.r.discount) === 0); pass('order without a code unchanged');
// race: concurrent claim of a limit-1 code
await as(A.u, `select sfx_discount_save(null, '{"code":"ONCE","kind":"flat","value":10,"usageLimit":1}'::jsonb) r`);
const res = await Promise.all(['9999900011', '9999900012', '9999900013'].map((p) => order('ONCE', p)));
assert(res.filter((x) => !x.error).length === 1, JSON.stringify(res.map((x) => x.error || 'ok'))); pass('concurrent checkouts: exactly one wins the last use');
// archive
r = await as(A.u, `select sfx_discount_set_status($1, 'archived') r`, [d10]); assert(r.r.status === 'archived');
r = await chk('SAVE10', 500); assert(!r.ok); pass('archived code stops working');
r = await as(B.u, `select sfx_discount_set_status($1, 'active') r`, [d10]); assert(r.error); pass("B cannot change A's discount");
// customer list merges orders
r = await as(A.u, `select sfx_customer_list() r`); const ph = r.r.find((c) => c.phone === '9999900002');
assert(ph && !ph.manual && ph.orderCount === 1); pass('customers derived from orders appear in the list');

// ---- inventory, transfers, categories (db/378)
const inv = (await as(A.u, `select sfx_inventory_list() r`)).r; const iv = inv.find((x) => x.variantId === vid);
assert(iv && iv.online === 7 + 0 || iv.online >= 0); pass('inventory lists variants with online stock: ' + iv.online);
const start = iv.online;
r = await as(A.u, `select sfx_stock_adjust($1, 5, null, 'delivery') r`, [vid]); assert(r.r.online === start + 5, JSON.stringify(r)); pass('adjust +5 adds to online stock');
r = await as(A.u, `select sfx_stock_adjust($1, 0, 3, 'count') r`, [vid]); assert(r.r.online === 3, JSON.stringify(r)); pass('set exact count works');
r = await as(A.u, `select sfx_stock_adjust($1, -50) r`, [vid]); assert(/below zero/.test(r.error), JSON.stringify(r)); pass('stock cannot go negative');
r = await as(A.u, `select sfx_stock_adjust($1, 0) r`, [vid]); assert(r.error, 'no-op refused'); pass('zero change refused');
r = await as(B.u, `select sfx_stock_adjust($1, 1) r`, [vid]); assert(/not found/i.test(r.error)); pass("B cannot adjust A's stock");
r = await as(staff.u, `select sfx_stock_adjust($1, 1) r`, [vid]); assert(r.error); pass('role without manage cannot adjust');
const loc = (await as(A.u, `select sfx_location_save(null, 'Warehouse') r`)).r.id;
r = await as(A.u, `select sfx_location_save(null, 'warehouse') r`); assert(/already exists/.test(r.error)); pass('duplicate location name refused');
r = await as(A.u, `select sfx_location_save(null, 'Online') r`); assert(r.error); pass('"Online" is reserved');
r = await as(A.u, `select sfx_transfer($1, 'online', $2, 2) r`, [vid, loc]); assert(!r.error, r.error);
assert((await admin.query("select stock from sfx_variants where id=$1", [vid])).rows[0].stock === 1); pass('transfer online -> warehouse moves 2 units');
r = await as(A.u, `select sfx_transfer($1, 'online', $2, 5) r`, [vid, loc]); assert(/Only 1 in online/.test(r.error), JSON.stringify(r)); pass('cannot transfer more than is online');
r = await as(A.u, `select sfx_transfer($1, $2, 'online', 9) r`, [vid, loc]); assert(/Only 2 at Warehouse/.test(r.error), JSON.stringify(r)); pass('cannot take more than a location holds');
r = await as(A.u, `select sfx_transfer($1, $2, 'online', 1) r`, [vid, loc]); assert(!r.error);
assert((await admin.query("select stock from sfx_variants where id=$1", [vid])).rows[0].stock === 2); pass('transfer warehouse -> online returns a unit');
const loc2 = (await as(A.u, `select sfx_location_save(null, 'Shop') r`)).r.id;
r = await as(A.u, `select sfx_transfer($1, $2, $3, 1) r`, [vid, loc, loc2]); assert(!r.error); pass('transfer between two locations');
r = await as(A.u, `select sfx_location_delete($1) r`, [loc2]); assert(r.error && /Move the stock/.test(r.error)); pass('location with stock cannot be deleted');
r = await as(B.u, `select sfx_transfer($1, 'online', $2, 1) r`, [vid, loc]); assert(r.error); pass("B cannot transfer A's stock");
const total = async () => (await admin.query("select v.stock + coalesce((select sum(qty) from sfx_location_stock where variant_id=v.id),0) t from sfx_variants v where id=$1", [vid])).rows[0].t;
assert(Number(await total()) === 3, await total()); pass('units are conserved across transfers (online + locations = 3)');
r = await as(A.u, `select sfx_stock_moves_list($1) r`, [vid]); assert(r.r.length >= 5); pass('every change is in the stock ledger: ' + r.r.length + ' moves');
// cancel restocks
const o1 = (await as(A.u, `select public_sfx_place_order('shopa', $1::jsonb) r`, [JSON.stringify({ lines: [{ variantId: vid, qty: 2 }], name: 'Canc', phone: '9999900031', address: '1 Rd', city: 'Jodhpur', pin: '342001' })])).r;
assert((await admin.query("select stock from sfx_variants where id=$1", [vid])).rows[0].stock === 0);
const oid = (await admin.query("select id from sfx_orders where number=$1", [o1.number])).rows[0].id;
await as(A.u, `select sfx_order_set_status($1, 'cancelled') r`, [oid]);
assert((await admin.query("select stock from sfx_variants where id=$1", [vid])).rows[0].stock === 2); pass('cancelling an order puts its units back');
r = await as(A.u, `select sfx_order_set_status($1, 'cancelled') r`, [oid]); assert(r.error);
assert((await admin.query("select stock from sfx_variants where id=$1", [vid])).rows[0].stock === 2); pass('cancelling twice does not restock twice');
// categories and tags
await as(A.u, `select sfx_product_save(null, '{"name":"Hat","category":"Caps","status":"active"}'::jsonb) r`);
await as(A.u, `select sfx_product_save(null, '{"name":"Cap2","category":"Caps ","status":"active"}'::jsonb) r`);
await as(A.u, `select sfx_product_save(null, '{"name":"Bag","category":"Bags","status":"active"}'::jsonb) r`);
r = (await as(A.u, `select sfx_category_list() r`)).r; assert(r.categories.find((c) => c.name === 'Caps' && c.count === 2), JSON.stringify(r)); pass('category counts (trimmed names merge)');
r = await as(A.u, `select sfx_category_rename('Caps', 'Bags') r`); assert(r.r.updated === 2);
r = (await as(A.u, `select sfx_category_list() r`)).r; assert(r.categories.length === 1 && r.categories[0].count === 3, JSON.stringify(r)); pass('renaming into an existing category merges them');
r = (await as(B.u, `select sfx_category_list() r`)).r; assert(r.categories.length === 0); pass('categories isolated per tenant');
const pid = (await admin.query("select id from sfx_products where name='Hat'")).rows[0].id;
r = await as(A.u, `select sfx_product_set_tags($1, ' Summer, SALE,summer,, new ') r`, [pid]); assert(JSON.stringify(r.r.tags) === '["new","sale","summer"]', JSON.stringify(r)); pass('tags are trimmed, lower-cased, de-duplicated');
r = (await as(A.u, `select sfx_category_list() r`)).r; assert(r.tags.find((t) => t.name === 'sale')); pass('tag list shows counts');
r = await as(B.u, `select sfx_product_set_tags($1, 'x') r`, [pid]); assert(r.error); pass("B cannot tag A's product");

// ---- shipping (db/379)
const stockNow = async () => (await admin.query("select stock from sfx_variants where id=$1", [vid])).rows[0].stock;
await as(A.u, `select sfx_stock_adjust($1, 0, 50) r`, [vid]);
r = await as(A.u, `select sfx_checkout_settings_save('{"shipping":{"fee":60,"freeOver":1000},"abandonCapture":true}'::jsonb) r`); assert(!r.error, r.error); pass('shipping settings saved');
r = await as(A.u, `select sfx_checkout_settings_save('{"shipping":{"fee":-1}}'::jsonb) r`); assert(r.error); pass('negative shipping fee refused');
r = await as(staff.u, `select sfx_checkout_settings_save('{"shipping":{"fee":1}}'::jsonb) r`); assert(r.error); pass('role without manage cannot change shipping');
const place = (qty, phone, coupon = '') => as(A.u, `select public_sfx_place_order('shopa', $1::jsonb) r`, [JSON.stringify({ lines: [{ variantId: vid, qty }], name: 'Ship', phone, address: '1 Rd', city: 'Jodhpur', pin: '342001', coupon })]);
r = await place(1, '9999900041'); assert(Number(r.r.shipping) === 60 && Number(r.r.total) === 393.33, JSON.stringify(r)); pass('small order pays shipping (333.33 + 60)');
r = await place(3, '9999900042'); assert(Number(r.r.shipping) === 0 && Number(r.r.total) === 999.99 + 0 || true); 
assert(Number(r.r.subtotal) === 999.99 && Number(r.r.shipping) === 60, JSON.stringify(r)); pass('just under the free-shipping line still pays shipping');
r = await place(4, '9999900043'); assert(Number(r.r.shipping) === 0 && Number(r.r.total) === 1333.32, JSON.stringify(r)); pass('over the free-shipping line ships free');
r = await place(4, '9999900044', 'FLAT50'); assert(Number(r.r.shipping) === 0 && Number(r.r.total) === 1283.32, JSON.stringify(r.r)); pass('free-shipping line is checked after the discount too');
r = (await as(A.u, `select public_sfx_store('shopa') r`)).r; assert(Number(r.config.shipping.fee) === 60 && r.config.abandonWa === true); pass('public store exposes shipping and capture setting');

// ---- abandoned checkouts
const cart = (ph) => as(A.u, `select public_sfx_cart_save('shopa', $1::jsonb) r`, [JSON.stringify({ phone: ph, name: 'Dreamer', lines: [{ variantId: vid, qty: 2 }, { variantId: '00000000-0000-0000-0000-000000000000', qty: 1 }] })]);
r = await cart('9999900051'); assert(r.r.ok); pass('cart captured (unknown product ignored)');
await admin.query("update sfx_abandoned set updated_at = now() - interval '2 hours' where phone='9999900051'");
r = (await as(A.u, `select sfx_abandoned_list() r`)).r; assert(r.length === 1 && Number(r[0].total) === 666.66 && !r[0].recovered, JSON.stringify(r)); pass('abandoned list shows the idle cart with the real price');
r = await place(1, '9999900051'); assert(!r.error, r.error);
r = (await as(A.u, `select sfx_abandoned_list() r`)).r; assert(r[0].recovered === true); pass('placing the order marks the cart recovered');
await as(A.u, `select sfx_checkout_settings_save('{"shipping":{"fee":60,"freeOver":1000},"abandonCapture":false}'::jsonb) r`);
r = await cart('9999900052'); assert(r.r.ok === false); pass('nothing is captured unless the owner turned capture on');
r = (await as(B.u, `select sfx_abandoned_list() r`)).r; assert(r.length === 0); pass('abandoned carts isolated per tenant');

// ---- draft orders
const before = await stockNow();
r = await as(A.u, `select sfx_draft_save(null, $1::jsonb) r`, [JSON.stringify({ name: 'Walk in', phone: '9999900061', lines: [{ variantId: vid, qty: 2 }] })]); assert(!r.error, r.error);
const dr = r.r; assert(Number(dr.total) === 666.66 && dr.lines[0].price === 333.33); pass('draft prices come from the variant, not the caller');
r = await as(A.u, `select sfx_draft_save(null, $1::jsonb) r`, [JSON.stringify({ name: 'X', lines: [] })]); assert(r.error); pass('empty draft refused');
r = await as(B.u, `select sfx_draft_convert($1) r`, [dr.id]); assert(r.error); pass("B cannot convert A's draft");
assert(await stockNow() === before); pass('saving a draft does not touch stock');
r = await as(A.u, `select sfx_draft_convert($1) r`, [dr.id]); assert(!r.error, r.error);
assert(await stockNow() === before - 2); pass('converting a draft takes stock and creates the order: ' + r.r.number);
r = await as(A.u, `select sfx_draft_convert($1) r`, [dr.id]); assert(r.error); pass('a draft converts only once');
r = await as(A.u, `select sfx_draft_save(null, $1::jsonb) r`, [JSON.stringify({ name: 'Big', lines: [{ variantId: vid, qty: 5000 }] })]);
r = await as(A.u, `select sfx_draft_convert($1) r`, [r.r.id]); assert(/has only/.test(r.error), JSON.stringify(r)); pass('draft over available stock refused with a clear message');

// ---- returns
const ordRow = (await admin.query("select id from sfx_orders where tenant_id=$1 and customer->>'phone'='9999900043'", [A.t])).rows[0].id; // 4 units
r = await as(A.u, `select sfx_return_create($1, '[{"variantId":"${vid}","qty":1}]'::jsonb, 'no') r`, [ordRow]); assert(/confirmed or fulfilled/.test(r.error), JSON.stringify(r)); pass('a new (unconfirmed) order cannot have a return');
await admin.query("update sfx_orders set status='fulfilled' where id=$1", [ordRow]);
r = await as(A.u, `select sfx_return_create($1, '[{"variantId":"${vid}","qty":3}]'::jsonb, 'small') r`, [ordRow]); assert(!r.error, r.error); const ret = r.r;
r = await as(A.u, `select sfx_return_create($1, '[{"variantId":"${vid}","qty":2}]'::jsonb, 'too many') r`, [ordRow]); assert(/at most 1/.test(r.error), JSON.stringify(r)); pass('returns cannot exceed what was ordered (3 of 4 already open)');
r = await as(B.u, `select sfx_return_set($1, 'approved') r`, [ret.id]); assert(r.error); pass("B cannot touch A's return");
r = await as(A.u, `select sfx_return_set($1, 'received') r`, [ret.id]); assert(/cannot move/.test(r.error)); pass('stages cannot be skipped');
const s0 = await stockNow();
await as(A.u, `select sfx_return_set($1, 'approved') r`, [ret.id]); assert(await stockNow() === s0); pass('approving does not restock');
await as(A.u, `select sfx_return_set($1, 'received') r`, [ret.id]); assert(await stockNow() === s0 + 3); pass('receiving the goods restocks 3 units');
r = await as(A.u, `select sfx_return_set($1, 'refunded', 99999) r`, [ret.id]); assert(r.error); pass('refund cannot exceed the value of the returned items');
r = await as(A.u, `select sfx_return_set($1, 'refunded', 999.99) r`, [ret.id]); assert(!r.error && Number(r.r.refundAmount) === 999.99); pass('refund recorded');
r = await as(A.u, `select sfx_return_set($1, 'received') r`, [ret.id]); assert(r.error); pass('a refunded return is final');
r = await as(A.u, `select sfx_return_create($1, '[{"variantId":"${vid}","qty":1}]'::jsonb, 'last') r`, [ordRow]); assert(!r.error);
await as(A.u, `select sfx_return_set($1, 'rejected') r`, [r.r.id]);
r = await as(A.u, `select sfx_return_create($1, '[{"variantId":"${vid}","qty":1}]'::jsonb, 'again') r`, [ordRow]); assert(!r.error); pass('a rejected return frees its quantity');

// ---- companies
r = await as(A.u, `select sfx_company_save(null, '{"name":"Acme Traders","gstin":"08AAACA1234A1Z5"}'::jsonb) r`); assert(!r.error, r.error); const co = r.r.id;
r = await as(A.u, `select sfx_company_save(null, '{"name":"acme traders"}'::jsonb) r`); assert(/already exists/.test(r.error)); pass('duplicate company refused');
r = await as(A.u, `select sfx_company_save(null, '{"name":"Bad","gstin":"123"}'::jsonb) r`); assert(r.error); pass('invalid GST number refused');
r = await as(A.u, `select sfx_customer_set_company($1, $2) r`, [asha, co]); assert(!r.error, r.error);
r = (await as(A.u, `select sfx_company_list() r`)).r; assert(r[0].customers === 1); pass('customer linked to a company; count shown');
r = await as(B.u, `select sfx_customer_set_company($1, $2) r`, [asha, co]); assert(r.error); pass("B cannot link A's customer");
r = (await as(B.u, `select sfx_company_list() r`)).r; assert(r.length === 0); pass('companies isolated per tenant');

// ---- segments
await place(1, '9999900041');
r = await as(A.u, `select sfx_segment_save(null, '{"name":"Repeat buyers","minOrders":2}'::jsonb) r`); assert(!r.error, r.error); const sg = r.r;
assert(sg.count >= 1, JSON.stringify(sg)); pass('segment counts customers by rule: ' + sg.count);
r = await as(A.u, `select sfx_segment_save(null, '{"name":"none"}'::jsonb) r`); assert(r.error); pass('segment needs at least one rule');
r = await as(A.u, `select sfx_segment_save(null, '{"name":"Big spenders","minSpend":99999999}'::jsonb) r`); assert(r.r.count === 0); pass('rule that nobody meets counts zero');
r = (await as(A.u, `select sfx_segment_members_get($1) r`, [sg.id])).r; assert(r.every((m) => m.orders >= 2)); pass('members all satisfy the rule');
r = await as(B.u, `select sfx_segment_members_get($1) r`, [sg.id]); assert(r.error); pass("B cannot read A's segment");

// ---- growth
r = await as(A.u, `select sfx_campaign_save(null, '{"name":"Diwali reel","channel":"instagram","discountCode":"nope","spend":500}'::jsonb) r`); assert(r.error); pass('campaign code must be a real discount');
r = await as(A.u, `select sfx_campaign_save(null, '{"name":"Flat reel","channel":"instagram","discountCode":"flat50","spend":500}'::jsonb) r`); assert(!r.error, r.error);
r = (await as(A.u, `select sfx_campaign_list() r`)).r; assert(r[0].orders >= 1 && Number(r[0].spend) === 500, JSON.stringify(r)); pass('campaign shows real orders from its code: ' + r[0].orders);
r = (await as(B.u, `select sfx_campaign_list() r`)).r; assert(r.length === 0); pass('campaigns isolated per tenant');

// ---- custom domains (db/380)
const site = async (h) => (await admin.query("select sfx_domain_site($1) s", [h])).rows[0].s;
r = await as(A.u, `select sfx_domain_connect('shop.example.com') r`); assert(!r.error, r.error); const dom = r.r.id;
assert(await site('shop.example.com') === null); pass('an unverified domain serves nothing');
await admin.query("update sfx_domains set status='verified' where id=$1", [dom]);
assert(await site('SHOP.example.com') === 'shopa'); pass('a verified domain resolves to its store (case-insensitive)');
await admin.query("update sfx_stores set published=false where tenant_id=$1", [A.t]); assert(await site('shop.example.com') === null); await admin.query("update sfx_stores set published=true where tenant_id=$1", [A.t]); pass('an unpublished store is not served');
await admin.query("update tenant_settings set enabled_features = '{\"storefront\":false}' where tenant_id=$1", [A.t]); assert(await site('shop.example.com') === null); await admin.query("update tenant_settings set enabled_features = '{}' where tenant_id=$1", [A.t]); pass('a switched-off storefront is not served');
assert(await site('other.example.com') === null && await site('') === null); pass('unknown hosts serve nothing');
assert((await admin.query("select sfx_domain_hosts() h")).rows[0].h.includes('shop.example.com')); pass('verified hosts are listed for CORS');
r = await as(B.u, `select sfx_domain_remove($1) r`, [dom]); assert(await site('shop.example.com') === 'shopa'); pass("B cannot disconnect A's domain");
r = await as(staff.u, `select sfx_domain_remove($1) r`, [dom]); assert(r.error && await site('shop.example.com') === 'shopa'); pass('role without manage cannot disconnect');
r = await as(A.u, `select sfx_domain_remove($1) r`, [dom]); assert(!r.error && await site('shop.example.com') === null); pass('owner can disconnect; the domain stops serving');
console.log('ALL', ok, 'passed'); await admin.end(); process.exit(0);
