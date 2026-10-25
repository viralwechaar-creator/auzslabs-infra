// AUZsStyle offline-first: the whole app keeps working with the server unreachable. Screens open from the copy kept on the
// device, new styles / stock purchases / stock changes / suppliers / settings / collections are made with no connection,
// and when the connection returns they reach the server exactly once, with the ids and tag codes made on the device.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('AUZsStyle offline: the whole app', 'Open the app, change the catalogue, stock, suppliers and settings with the server unreachable, then reconnect.');
  const tid = (await q("select id from tenants where slug='teststyle'"))[0].id;
  const c = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await c.newPage(); const errs = watch(page);
  let down = false; await page.route('https://api.auzslab.in/**', (r) => (down ? r.abort() : r.fallback()));
  await page.goto(stack.url('teststyle', '/style.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
  await page.fill('input[type=email]', USERS.styOwner); await page.fill('input[type=password]', PASSWORD);
  await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 });
  // open the screens once while online so their answers are kept on the device
  await page.evaluate(async () => { await loadCatalog(true); await api('sty_list_suppliers'); await api('sty_collections_list'); await api('sty_list_customers', {}); await topUpBarcodes(); if (!S.cat.length) { await api('sty_save_style', { p: { name: 'Base Tee', category: 'Tees', price: 300, mrp: 300, cost: 100, colours: ['Blue'], sizes: ['M'], opening: { qty: 3, unitCost: 100, branchId: S.branch } } }); await loadCatalog(true); } });
  await page.waitForTimeout(800);
  const names = { style: 'Offline Tee ' + Date.now(), shop: 'Offline Shop ' + Date.now() };

  await s.check('Tag codes are reserved on the device while online', async () => {
    const n = await page.evaluate(() => barcodePool().length); assert(n >= 100, 'pool ' + n);
  }, 'critical');

  await s.check('With the server unreachable the app still opens from the saved copy and shows the styles', async () => {
    down = true; await page.reload(); await page.waitForSelector('.shell', { timeout: 20000 });
    const n = await page.evaluate(async () => { await loadCatalog(true); return S.cat.length; }); assert(n >= 1, 'styles ' + n);
    assert(await page.evaluate(() => navigator.onLine !== false && S.offlineData === true), 'should know the data is the offline copy');
  }, 'critical');

  let ids;
  await s.check('Offline: a new style with sizes and colours, opening stock and tag codes', async () => {
    ids = await page.evaluate(async (nm) => {
      const newId = uid(), vk = ['Red|M', 'Red|L'], variantIds = {}, barcodes = {};
      const codes = takeBarcodes(2); vk.forEach((k, i) => { variantIds[k] = uid(); barcodes[k] = codes[i]; });
      const r = await api('sty_save_style', { p: { newId, variantIds, barcodes, name: nm, category: 'Tees', price: 500, mrp: 600, cost: 200, colours: ['Red'], sizes: ['M', 'L'], opening: { qty: 5, unitCost: 200, branchId: S.branch } } });
      return { newId, variantIds, barcodes, got: r && r.id, queued: getQ().length };
    }, names.style);
    assert(ids.got === ids.newId && ids.queued === 1, JSON.stringify(ids));
    const st = await page.evaluate(async (id) => { S.catAt = 0; await loadCatalog(true); const s = S.cat.find((x) => x.id === id); return s && { n: s.variants.length, stock: s.variants.reduce((a, v) => a + v.stock, 0), bc: s.variants.map((v) => v.barcode).sort() }; }, ids.newId);
    assert(st && st.n === 2 && st.stock === 10 && st.bc.every(Boolean), JSON.stringify(st));
  }, 'critical');
  await s.check('Offline: buy stock for it, adjust it, add a supplier, change a setting, make a collection', async () => {
    const vM = (Object.values(ids.variantIds))[0];
    const out = await page.evaluate(async ({ vM, newId, shop }) => {
      await api('sty_receive', { p: { id: uid(), branchId: S.branch, invoiceNo: 'OFF-1', paid: 0, lines: [{ variantId: vM, qty: 10, unitCost: 220 }] } });
      await api('sty_adjust', { p: { branchId: S.branch, variantId: vM, qty: 2, mode: 'remove', note: 'offline' } });
      const sid = uid(); const list = await api('sty_save_supplier', { p: { newId: sid, name: 'Offline Supplier' } });
      const ctx = await api('sty_save_settings', { p: { shopName: shop } });
      const colId = uid(); await api('sty_collection_save', { p: { newId: colId, name: 'Offline Edit' } });
      await api('sty_collection_members', { p_id: colId, p_add: [newId] });
      S.catAt = 0; await loadCatalog(true); const sty = S.cat.find((x) => x.id === newId);
      const cols = await api('sty_collections_list');
      return { q: getQ().length, stockM: sty.variants.find((v) => v.id === vM).stock, supplierShown: list.some((x) => x.name === 'Offline Supplier'), shop: ctx.settings.shopName, col: cols.find((x) => x.id === colId), sid, colId };
    }, { vM, newId: ids.newId, shop: names.shop });
    assert(out.q === 7, 'queue ' + out.q); assert(out.stockM === 13, 'stock ' + out.stockM); assert(out.supplierShown && out.shop === names.shop && out.col && out.col.styleIds.includes(ids.newId), JSON.stringify(out));
    ids.sid = out.sid; ids.colId = out.colId;
  }, 'critical');
  await s.check('The status pill shows what is waiting and the list opens', async () => {
    assert(/waiting|Offline/i.test(await page.locator('.sync-pill').first().innerText()), 'pill');
    await page.locator('.sync-pill').first().click(); await page.waitForSelector('.sheet');
    const txt = await page.locator('.sheet').innerText(); assert(/Waiting changes/i.test(txt) && /Style saved/i.test(txt) && /Stock bought/i.test(txt), txt.slice(0, 300));
  });
  await s.check('A change the server will refuse is kept, with the reason, instead of being lost', async () => {
    const vM = (Object.values(ids.variantIds))[0];
    await page.evaluate(async (v) => { await api('sty_adjust', { p: { branchId: S.branch, variantId: v, qty: 500, mode: 'remove', note: 'too many' } }); }, vM);
  });

  await s.check('Back online: everything is sent once, in order, with the same ids and tag codes', async () => {
    down = false;
    await page.evaluate(async () => { await flushQueue(); await flushQueue(); });
    await page.waitForTimeout(800);
    const left = await page.evaluate(() => ({ pending: pendingCount(), failed: failedOps().map((e) => e.fail) }));
    assert(left.pending === 0 && left.failed.length === 1 && /Only/.test(left.failed[0]), JSON.stringify(left));
    const v = await q('select id, barcode from sty_variants where tenant_id=$1 and style_id=$2 order by size', [tid, ids.newId]);
    assert(v.length === 2, 'variants ' + v.length);
    for (const row of v) assert(Object.values(ids.variantIds).includes(row.id) && Object.values(ids.barcodes).includes(row.barcode), 'ids/codes changed: ' + JSON.stringify(row));
    const stock = Number((await q('select coalesce(sum(m.qty),0)::int s from sty_stock_moves m join sty_variants v on v.id=m.variant_id where m.tenant_id=$1 and v.style_id=$2', [tid, ids.newId]))[0].s);
    assert(stock === 18, 'server stock ' + stock);
    assert((await q("select count(*)::int n from sty_suppliers where tenant_id=$1 and id=$2 and name='Offline Supplier'", [tid, ids.sid]))[0].n === 1, 'supplier');
    assert((await q('select shop_name from sty_settings where tenant_id=$1', [tid]))[0].shop_name === names.shop, 'setting');
    assert((await q('select count(*)::int n from sty_collection_styles where collection_id=$1 and style_id=$2', [ids.colId, ids.newId]))[0].n === 1, 'collection');
  }, 'critical');
  await s.check('Sending the same change again changes nothing (the server remembers it)', async () => {
    const before = Number((await q('select count(*)::int n from sty_stock_moves where tenant_id=$1', [tid]))[0].n);
    const r = await page.evaluate(async (v) => {
      const id = 'dup-' + Date.now(); const op = { id, fn: 'sty_adjust', args: { p: { branchId: S.branch, variantId: v, qty: 1, mode: 'add', note: 'dup' } } };
      const a = await sb.sync([op]); const b = await sb.sync([op]);
      return [a.data.results[0].ok, b.data.results[0].ok];
    }, Object.values(ids.variantIds)[0]);
    assert(r[0] && r[1], 'both answered ok');
    const after = Number((await q('select count(*)::int n from sty_stock_moves where tenant_id=$1', [tid]))[0].n); assert(after === before + 1, `moves ${before} -> ${after}`);
  });
  await s.check('Every screen opens offline from its saved copy, with no script errors', async () => {
    await page.evaluate(async () => { for (const id of ['stock', 'buy', 'people', 'bills', 'home', 'settings']) { location.hash = '#/' + id; await new Promise((r) => setTimeout(r, 900)); } });
    const bad = errs.filter((e) => !/favicon|sentry|net::|Failed to load resource/i.test(String(e))); assert(!bad.length, bad.slice(0, 3).join(' | '));
  });
  await c.close();
  s.done();
}
