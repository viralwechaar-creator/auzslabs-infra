// AUZsStyle <-> Storefront link (db/403): one catalogue, stock, collections, tags and online orders in both places.
import { suite, assert } from '../../lib/harness.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ stack }) {
  const s = suite('AUZsStyle and Storefront linked', 'Products, stock, collections, tags and online orders stay equal in both directions once a business links them.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.styOwner);
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (fn, args, tok) => { const r = await call(tok || owner, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const tid = (await q("select id from tenants where slug='teststyle'"))[0].id;
  await q("update tenant_settings set features = features || '{\"style\":true,\"storefront\":true}' where tenant_id=$1", [tid]);
  await q("insert into sfx_stores (tenant_id, published) values ($1, true) on conflict (tenant_id) do update set published=true", [tid]);
  const stockOf = async (vid) => Number((await q('select coalesce(sum(qty),0)::int s from sty_stock_moves where variant_id=$1', [vid]))[0].s);

  const made = await ok('sty_save_style', { p: { name: 'Link Shirt', category: 'Shirts', price: 900, mrp: 1200, cost: 300, colours: ['Blue'], sizes: ['M', 'L'], opening: { qty: 6, unitCost: 300 } } });
  await s.check('Linking needs both products and copies the existing catalogue with stock', async () => {
    await q("update tenant_settings set features = features || '{\"storefront\":false}' where tenant_id=$1", [tid]);
    const bad = await call(owner, 'sfx_style_link_set', { p_on: true }); assert(!bad.ok, 'linked without the storefront');
    await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id=$1", [tid]);
    const st = await ok('sfx_style_link_status'); assert(st.available && !st.linked, JSON.stringify(st));
    await ok('sfx_style_link_set', { p_on: true });
    const prod = (await q("select * from sfx_products where tenant_id=$1 and source_style_id=$2", [tid, made.id]))[0]; assert(prod && prod.name === 'Link Shirt' && Number(prod.price) === 900 && Number(prod.compare_at) === 1200, JSON.stringify(prod));
    const vars = await q('select label, stock from sfx_variants where product_id=$1 order by label', [prod.id]);
    assert(vars.length === 2 && vars[0].label === 'Blue / L' && vars[0].stock === 6, JSON.stringify(vars));
  }, 'critical');

  const prod = (await q("select * from sfx_products where tenant_id=$1 and source_style_id=$2", [tid, made.id]))[0];
  await s.check('Editing the product in AUZsStyle shows in the storefront (name, price, tags, collection)', async () => {
    await ok('sty_save_style', { p: { id: made.id, name: 'Link Shirt Pro', category: 'Shirts', price: 950, mrp: 1200, cost: 300 } });
    await ok('sty_set_tags', { p_id: made.id, p_tags: ['summer', 'cotton'] });
    const col = await ok('sty_collection_save', { p: { name: 'Summer Link' } });
    await ok('sty_collection_members', { p_id: col.id, p_add: [made.id] });
    const r = (await q('select name, price, tags from sfx_products where id=$1', [prod.id]))[0];
    assert(r.name === 'Link Shirt Pro' && Number(r.price) === 950 && r.tags.includes('cotton'), JSON.stringify(r));
    const m = await q("select 1 from sfx_collection_products cp join sfx_collections c on c.id=cp.collection_id where c.name='Summer Link' and cp.product_id=$1", [prod.id]); assert(m.length === 1, 'collection membership missing');
  }, 'critical');

  await s.check('Editing the product in the storefront shows in AUZsStyle (name, price, tag, category)', async () => {
    const vrows = await q('select id, label, stock from sfx_variants where product_id=$1 order by position', [prod.id]);
    await ok('sfx_product_save', { p_id: prod.id, p: { name: 'Link Shirt Web', category: 'Tops', price: 980, status: 'active', description: 'From the web', variants: vrows.map((v) => ({ id: v.id, label: v.label, price: 980, stock: v.stock })) } });
    await ok('sfx_product_set_tags', { p_id: prod.id, p_tags: 'web-only' });
    const dbg = (await q('select price from sfx_products where id=$1', [prod.id]))[0]; const r = (await q('select name, price, category, tags, description from sty_styles where id=$1', [made.id]))[0]; r.sfxPrice = dbg.price;
    assert(r.name === 'Link Shirt Web' && Number(r.price) === 980 && r.category === 'Tops' && r.tags.includes('web-only') && r.description === 'From the web', JSON.stringify(r));
  }, 'critical');

  await s.check('Changing only the price of an imported product (several sizes) changes every size', async () => {
    await ok('sfx_product_save', { p_id: prod.id, p: { name: 'Link Shirt Web', category: 'Tops', price: 1111, status: 'active' } });
    const vs = await q('select price from sfx_variants where product_id=$1', [prod.id]);
    assert(vs.length >= 2 && vs.every((v) => Number(v.price) === 1111), JSON.stringify(vs));
  }, 'critical');

  await s.check('A product created in the storefront appears in AUZsStyle with sizes and stock', async () => {
    const np = await ok('sfx_product_save', { p_id: null, p: { name: 'Web Born Tee', category: 'Tees', price: 500, status: 'active', variants: [{ label: 'Black / S', price: 500, stock: 4 }, { label: 'Black / M', price: 500, stock: 3 }] } });
    const st = (await q("select * from sty_styles where tenant_id=$1 and name='Web Born Tee'", [tid]))[0]; assert(st, 'style not created');
    const vs = await q('select id, colour, size, barcode from sty_variants where style_id=$1 order by size', [st.id]); assert(vs.length === 2 && vs[0].colour === 'Black' && vs[0].size === 'M' && vs[0].barcode, JSON.stringify(vs));
    assert(await stockOf(vs.find((x) => x.size === 'S').id) === 4, 'opening stock not carried');
  }, 'critical');

  await s.check('Stock: a till sale lowers the online stock; an online stock edit becomes an AUZsStyle adjustment', async () => {
    const vL = (await q("select v.id, sv.id as sfxid from sty_variants v join sfx_variants sv on sv.source_variant_id=v.id where v.style_id=$1 and v.size='L'", [made.id]))[0];
    await q("insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind) values ($1, sty_main_branch($1), $2, -2, 'sale')", [tid, vL.id]);
    assert((await q('select stock from sfx_variants where id=$1', [vL.sfxid]))[0].stock === 4, 'online stock did not follow the till');
    await q('update sfx_variants set stock = 10 where id=$1', [vL.sfxid]);
    assert(await stockOf(vL.id) === 10, 'storefront stock edit not in the ledger: ' + await stockOf(vL.id));
  }, 'critical');

  await s.check('An online order lands in both places, takes stock once, and status follows both ways', async () => {
    const v = (await q("select sv.id, sv.source_variant_id from sfx_variants sv join sfx_products p on p.id=sv.product_id where p.id=$1 and sv.label='Blue / M'", [prod.id]))[0];
    const before = await stockOf(v.source_variant_id);
    const r = await (await fetch(stack.apiBase + '/rpc/public_sfx_place_order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_slug: 'teststyle', p: { name: 'Asha Rao', phone: '9876543210', address: '12 Park Road', city: 'Jodhpur', pin: '342001', lines: [{ variantId: v.id, qty: 2 }] } }) })).json();
    const res = r.data || r.result || r; assert(res.number, JSON.stringify(r).slice(0, 200));
    const so = (await q('select * from sfx_orders where number=$1', [res.number]))[0]; assert(so && so.sty_order_id, 'order not mirrored to AUZsStyle');
    const wo = (await q('select * from sty_web_orders where id=$1', [so.sty_order_id]))[0]; assert(wo && Number(wo.total) === Number(so.total) && wo.stock_taken, JSON.stringify(wo));
    assert(await stockOf(v.source_variant_id) === before - 2, 'stock not taken once');
    await q("select sfx_order_set_status_test()").catch(() => {});
    await q("update sty_web_orders set status='confirmed' where id=$1", [wo.id]);
    assert((await q('select status from sfx_orders where id=$1', [so.id]))[0].status === 'confirmed', 'status not mirrored to the storefront');
    await q("update sty_web_orders set status='cancelled' where id=$1", [wo.id]);
    assert((await q('select status from sfx_orders where id=$1', [so.id]))[0].status === 'cancelled' && await stockOf(v.source_variant_id) === before, 'cancel did not return stock exactly once');
  }, 'critical');

  await s.check('Unlinked, nothing is copied either way', async () => {
    await ok('sfx_style_link_set', { p_on: false });
    await ok('sty_save_style', { p: { name: 'Unlinked Jacket', category: 'Jackets', price: 100, colours: ['Red'], sizes: ['S'] } });
    assert((await q("select count(*)::int n from sfx_products where tenant_id=$1 and name='Unlinked Jacket'", [tid]))[0].n === 0, 'copied while unlinked');
  }, 'major');
}
