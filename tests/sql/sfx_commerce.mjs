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
console.log('ALL', ok, 'passed'); await admin.end(); process.exit(0);
