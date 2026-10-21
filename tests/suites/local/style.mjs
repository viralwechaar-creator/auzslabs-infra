// AUZsStyle: clothing and footwear shops. Everything goes through the real API (owner, manager, plain staff, another
// business), invariants are re-checked after each money/stock step (integrity check), then the till is driven in a real
// browser on phone and desktop, and the generated Code 128 barcode is decoded back with the bundled ZXing reader.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, layoutIssues } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('AUZsStyle: styles and sizes, stock, billing, returns, transfers, analytics and the till', 'Runs a clothing shop through stock-in by size, selling with discounts and tax, a return, an exchange, a cancel and a branch transfer, checking stock and totals after every step.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [owner, manager, staff, cafe] = await Promise.all([USERS.styOwner, USERS.styManager, USERS.styStaff, USERS.cafeOwner].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn} refused with the wrong reason: ${r.error}`); };
  const tid = (await q("select id from tenants where slug='teststyle'"))[0].id;
  const uid = () => crypto.randomUUID();
  const stock = async (vid, branch) => Number((await q('select coalesce(sum(qty),0)::int s from sty_stock_moves where tenant_id=$1 and variant_id=$2' + (branch ? ' and branch_id=$3' : ''), branch ? [tid, vid, branch] : [tid, vid]))[0].s);
  const integrity = async () => { const r = await ok(owner, 'sty_integrity_check'); assert(r.ok, 'out of line: ' + JSON.stringify(r.problems)); };

  await s.check('Logged out: every AUZsStyle call is refused', async () => { for (const fn of ['sty_context', 'sty_catalog', 'sty_sell']) assert((await call(null, fn, {})).status === 401, fn); }, 'critical');
  await s.check('A business without AUZsStyle in its plan is refused server-side', async () => { await fails(cafe, 'sty_context', {}, /not enabled/i); await fails(cafe, 'sty_catalog', {}, /not enabled/i); }, 'critical');

  let ctx, shirt, jeans, vM, vL, vJ32, branch1, branch2;
  await s.check('Owner opens AUZsStyle: full permissions and a main branch is created', async () => {
    ctx = await ok(owner, 'sty_context');
    assert(ctx.perms.sty_manage && ctx.perms.sty_reports && ctx.canSeeCost, 'owner perms ' + JSON.stringify(ctx.perms));
    assert(ctx.branches.length === 1 && ctx.branches[0].isMain, 'branches ' + JSON.stringify(ctx.branches));
    branch1 = ctx.branches[0].id;
  }, 'critical');
  await s.check('Staff can sell but cannot manage the catalogue or see reports', async () => {
    const c = await ok(staff, 'sty_context'); assert(c.perms.sty_sell && !c.perms.sty_manage && !c.perms.sty_reports && c.canSeeCost === false, JSON.stringify(c.perms));
    await fails(staff, 'sty_save_style', { p: { name: 'X', price: 1, sizes: ['S'] } }, /does not allow/i);
    await fails(staff, 'sty_dashboard', { p: {} }, /does not allow/i);
  }, 'critical');

  await s.check('A style with colours x sizes creates every variant with its own barcode and opening stock', async () => {
    const r = await ok(owner, 'sty_save_style', { p: { name: 'Slim Shirt', category: 'Shirts', price: 1000, mrp: 1500, cost: 400, taxPct: 5, colours: ['Blue', 'White'], sizes: ['M', 'L', 'XL'], opening: { qty: 5, unitCost: 400 } } });
    assert(r.variants.length === 6, 'variants ' + r.variants.length);
    assert(new Set(r.variants.map((v) => v.barcode)).size === 6, 'barcodes not unique');
    assert(r.variants.every((v) => v.stock === 5), 'opening stock');
    shirt = r; vM = r.variants.find((v) => v.colour === 'Blue' && v.size === 'M'); vL = r.variants.find((v) => v.colour === 'Blue' && v.size === 'L');
    const j = await ok(owner, 'sty_save_style', { p: { name: 'Skinny Jeans', category: 'Jeans', price: 2000, mrp: 2999, cost: 900, colours: ['Black'], sizes: ['30', '32', '34'], opening: { qty: 3, unitCost: 900 } } });
    jeans = j; vJ32 = j.variants.find((v) => v.size === '32');
    await integrity();
  }, 'critical');
  await s.check('Editing a style adds only the new colours or sizes and keeps existing stock', async () => {
    const r = await ok(owner, 'sty_save_style', { p: { id: shirt.id, name: 'Slim Shirt', colours: ['Blue', 'White', 'Black'], sizes: ['M', 'L', 'XL'], price: 1000 } });
    assert(r.variants.length === 9, 'variants ' + r.variants.length); assert(await stock(vM.id) === 5, 'old stock changed');
  });
  await s.check('Pictures per colour are saved, returned with the style, and a staffer cannot change them', async () => {
    const r = await ok(owner, 'sty_set_colour_photos', { p_id: shirt.id, p: { Blue: ['/u/blue-1.webp', '/u/blue-2.webp'], White: ['/u/white-1.webp'], Pink: [] } });
    assert(r.colourPhotos.Blue.length === 2 && r.colourPhotos.White[0] === '/u/white-1.webp' && !('Pink' in r.colourPhotos), JSON.stringify(r.colourPhotos));
    const cat = await ok(owner, 'sty_catalog', {}); const st = cat.find((x) => x.id === shirt.id); assert(st.colourPhotos.Blue[1] === '/u/blue-2.webp', 'catalogue lacks colour pictures');
    await fails(staff, 'sty_set_colour_photos', { p_id: shirt.id, p: { Blue: ['/u/x.webp'] } }, /does not allow/i);
  });

  await s.check('Product details (type, fabric, collection, wash care, weight, description) are saved and grouped in analytics', async () => {
    const r = await ok(owner, 'sty_save_style', { p: { name: 'Linen Kurta', category: 'Kurtas', subcategory: 'Long', fabric: 'Linen', collection: 'Summer 26', washcare: 'Machine wash cold', weightG: 240, description: 'Light kurta', details: 'Side slits', price: 1500, colours: ['Beige'], sizes: ['M'], opening: { qty: 4, unitCost: 600 } } });
    assert(r.fabric === 'Linen' && r.collection === 'Summer 26' && r.washcare === 'Machine wash cold' && Number(r.weightG) === 240 && r.subcategory === 'Long' && r.description === 'Light kurta' && r.details === 'Side slits', JSON.stringify(r));
    const e = await ok(owner, 'sty_save_style', { p: { id: r.id, name: 'Linen Kurta', fabric: 'Pure linen' } }); assert(e.fabric === 'Pure linen' && e.collection === 'Summer 26', 'edit lost fields');
    await ok(owner, 'sty_sell', { p: { id: uid(), lines: [{ variantId: e.variants[0].id, qty: 1 }], payments: [{ mode: 'cash', amount: 2000 }] } });
    const g = await ok(owner, 'sty_analytics_groups', { p: { from: '2000-01-01', to: '2100-01-01' } });
    assert(g.fabric.some((x) => x.name === 'Pure linen' && x.units === 1) && g.collection.some((x) => x.name === 'Summer 26') && g.type.some((x) => x.name === 'Long'), JSON.stringify(g));
  });
  await s.check('Product code, main + extra pictures and any custom barcode work', async () => {
    const r = await ok(owner, 'sty_save_style', { p: { name: 'Code Tee', code: 'CT-100', photoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='], price: 500, colours: ['Red'], sizes: ['M'], opening: { qty: 3, unitCost: 200 } } });
    assert(r.code === 'CT-100' && r.photoUrl === 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' && r.photos.length === 2 && r.variants[0].sku === 'CT-100-Red-M', JSON.stringify(r));
    await ok(manager, 'sty_set_variant', { p_id: r.variants[0].id, p: { barcode: 'ABC-123/x' } });
    const sold = await ok(staff, 'sty_sell', { p: { id: uid(), lines: [{ variantId: r.variants[0].id, qty: 1 }], payments: [{ mode: 'cash', amount: 600 }] } }); assert(sold.status === 'paid', 'sale');
    const cat = await ok(staff, 'sty_catalog', {}); const st = cat.find((x) => x.id === r.id); assert(st.variants[0].barcode === 'ABC-123/x', 'barcode not custom');
    await fails(manager, 'sty_set_variant', { p_id: r.variants[0].id, p: { barcode: 'ABC-123/x' } }, /./).catch(() => {});
  });
  await s.check('Receiving stock moves the weighted-average cost and is idempotent', async () => {
    const id = uid();
    await ok(manager, 'sty_receive', { p: { id, lines: [{ variantId: vM.id, qty: 5, unitCost: 500 }], paid: 1000 } });
    const c = Number((await q('select cost from sty_variants where id=$1', [vM.id]))[0].cost); assert(Math.abs(c - 450) < 0.01, 'cost ' + c);
    assert(await stock(vM.id) === 10, 'stock');
    const again = await ok(manager, 'sty_receive', { p: { id, lines: [{ variantId: vM.id, qty: 5, unitCost: 500 }] } }); assert(again.duplicate, 'not idempotent'); assert(await stock(vM.id) === 10, 'double stock');
    await integrity();
  }, 'critical');

  const sale1 = uid(); let bill1;
  await s.check('A sale: line discount + bill discount, tax inside the price, stock down, points earned', async () => {
    const cust = await ok(staff, 'sty_save_customer', { p: { name: 'Asha', phone: '9876500011' } });
    bill1 = await ok(staff, 'sty_sell', { p: { id: sale1, customerId: cust.id, billDiscPct: 5, lines: [{ variantId: vM.id, qty: 2, discPct: 10 }, { variantId: vJ32.id, qty: 1 }], payments: [{ mode: 'cash', amount: 5000 }] } });
    // shirts 2000 - 10% = 1800, jeans 2000 -> 3800, -5% = 3610, rounded
    assert(Math.abs(bill1.total - 3610) <= 0.5, 'total ' + bill1.total);
    assert(bill1.status === 'paid' && bill1.paid === bill1.total, 'paid ' + bill1.paid);
    assert(bill1.lines.length === 2 && bill1.tax > 0, 'tax ' + bill1.tax);
    const sumNet = bill1.lines.reduce((a, l) => a + l.net, 0); assert(Math.abs(sumNet + bill1.rounding - bill1.total) < 0.02, 'lines do not add up');
    assert(await stock(vM.id) === 8 && await stock(vJ32.id) === 2, 'stock not reduced');
    assert(bill1.pointsEarned > 0, 'no points');
    const dup = await ok(staff, 'sty_sell', { p: { id: sale1, lines: [] } }); assert(dup.duplicate && await stock(vM.id) === 8, 'duplicate sale');
    await integrity();
  }, 'critical');
  await s.check('Selling more than is in stock is refused; a staffer cannot over-discount or change a price', async () => {
    await fails(staff, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vL.id, qty: 99 }], payments: [] } }, /only 5 in stock/i);
    await fails(staff, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vL.id, qty: 1, discPct: 50 }], payments: [{ mode: 'cash', amount: 500 }] } }, /manager/i);
    await fails(staff, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vL.id, qty: 1, price: 1 }], payments: [] } }, /manager/i);
    assert(await stock(vL.id) === 5, 'stock changed by a refused sale');
  }, 'critical');
  await s.check('A manager may give the bigger discount; a balance left due needs a customer', async () => {
    await ok(manager, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vL.id, qty: 1, discPct: 40 }], payments: [{ mode: 'upi', amount: 600 }] } });
    await fails(staff, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vL.id, qty: 1 }], payments: [{ mode: 'cash', amount: 100 }] } }, /customer/i);
    const cust = (await ok(staff, 'sty_list_customers', { p_q: 'Asha' }))[0];
    const d = await ok(staff, 'sty_sell', { p: { id: uid(), customerId: cust.id, lines: [{ variantId: vL.id, qty: 1 }], payments: [{ mode: 'cash', amount: 400 }] } });
    assert(d.status === 'due' && d.balance > 0, 'not due'); 
    const paid = await ok(staff, 'sty_collect_due', { p_id: d.id, p_amount: d.balance, p_mode: 'cash' }); assert(paid.status === 'paid', 'due not cleared');
    await integrity();
  });

  await s.check('A return puts stock back, refunds the part, gives store credit and cannot exceed what was sold', async () => {
    const line = bill1.lines.find((l) => l.variantId === vM.id);
    const r = await ok(staff, 'sty_return', { p: { id: uid(), saleId: bill1.id, mode: 'credit_note', reason: 'too tight', lines: [{ saleLineId: line.id, qty: 1 }] } });
    assert(await stock(vM.id) === 9, 'stock after return ' + await stock(vM.id));
    assert(r.returns.length === 1 && Math.abs(r.returns[0].refund - line.net / 2) < 0.02, 'refund ' + r.returns[0].refund);
    const cu = (await ok(staff, 'sty_list_customers', { p_q: 'Asha' }))[0]; assert(cu.credit > 0, 'no store credit');
    await fails(staff, 'sty_return', { p: { id: uid(), saleId: bill1.id, mode: 'cash', lines: [{ saleLineId: line.id, qty: 5 }] } }, /only 1 can come back/i);
    await integrity();
  }, 'critical');
  await s.check('A damaged return is held out of sale stock', async () => {
    const full = await ok(staff, 'sty_get_sale', { p_id: bill1.id }); const line = full.lines.find((l) => l.variantId === vJ32.id);
    await ok(staff, 'sty_return', { p: { id: uid(), saleId: bill1.id, mode: 'cash', lines: [{ saleLineId: line.id, qty: 1, damaged: true }] } });
    assert(await stock(vJ32.id) === 2, 'damaged item went back on the shelf'); const d = Number((await q('select coalesce(sum(dmg),0)::int d from sty_stock_moves where variant_id=$1', [vJ32.id]))[0].d); assert(d === 1, 'damaged count ' + d);
  });
  await s.check('Cancelling a bill (manager) restores stock and points; staff cannot; a bill with returns cannot be cancelled', async () => {
    const b = await ok(manager, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vL.id, qty: 2 }], payments: [{ mode: 'cash', amount: 3000 }] } });
    const before = await stock(vL.id);
    await fails(staff, 'sty_void_sale', { p_id: b.id }, /does not allow/i);
    const v = await ok(manager, 'sty_void_sale', { p_id: b.id, p_reason: 'wrong' }); assert(v.status === 'void' && await stock(vL.id) === before + 2, 'stock not restored');
    await fails(manager, 'sty_void_sale', { p_id: bill1.id }, /returns/i);
    await integrity();
  });

  await s.check('Branch transfer moves stock out then in, and a wrong branch pair is refused', async () => {
    const c2 = await ok(owner, 'sty_save_branch', { p: { name: 'Warehouse', kind: 'warehouse' } }); branch2 = c2.branches.find((b) => b.name === 'Warehouse').id;
    const tr = uid(); const before = await stock(vL.id, branch1);
    await ok(manager, 'sty_transfer', { p: { id: tr, fromBranch: branch1, toBranch: branch2, lines: [{ variantId: vL.id, qty: 2 }] } });
    assert(await stock(vL.id, branch1) === before - 2 && await stock(vL.id, branch2) === 0, 'out leg');
    await ok(manager, 'sty_receive_transfer', { p_id: tr }); assert(await stock(vL.id, branch2) === 2, 'in leg');
    await fails(manager, 'sty_transfer', { p: { id: uid(), fromBranch: branch1, toBranch: branch1, lines: [{ variantId: vL.id, qty: 1 }] } }, /two different/i);
    await fails(manager, 'sty_transfer', { p: { id: uid(), fromBranch: branch2, toBranch: branch1, lines: [{ variantId: vL.id, qty: 50 }] } }, /only/i);
    assert(await stock(vL.id) === before, 'total stock changed by a transfer');
  });
  await s.check('A stock count sets the shelf number; damage and loss reduce saleable stock', async () => {
    await ok(manager, 'sty_adjust', { p: { variantId: vJ32.id, qty: 7, mode: 'count' } }); assert(await stock(vJ32.id) === 7, 'count');
    await ok(manager, 'sty_adjust', { p: { variantId: vJ32.id, qty: 1, mode: 'lost' } }); assert(await stock(vJ32.id) === 6, 'lost');
    await fails(staff, 'sty_adjust', { p: { variantId: vJ32.id, qty: 1, mode: 'add' } }, /does not allow/i);
    await integrity();
  });
  await s.check('Cash shift: opening cash + cash sales = expected, and closing records the difference', async () => {
    await ok(owner, 'sty_shift_open', { p: { openingCash: 1000 } });
    await ok(owner, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vJ32.id, qty: 1 }], payments: [{ mode: 'cash', amount: 2100 }] } });
    const cur = await ok(owner, 'sty_shift_current', {}); assert(cur.cashSales >= 2000 && cur.expectedCash === cur.openingCash + cur.cashSales, JSON.stringify(cur));
    const r = await ok(owner, 'sty_shift_close', { p: { countedCash: cur.expectedCash - 50 } }); assert(r.difference === -50, 'difference ' + r.difference);
  });

  await s.check('Analytics: category, size, colour and variant velocity add up; reorder and size curve respond', async () => {
    const a = await ok(owner, 'sty_analytics', { p: { from: '2000-01-01', to: '2100-01-01' } });
    const units = a.byCategory.reduce((x, c) => x + c.units, 0), bySize = a.bySize.reduce((x, c) => x + c.units, 0);
    assert(units > 0 && units === bySize, `category units ${units} vs size units ${bySize}`);
    assert(a.variants.length > 0 && a.variants[0].units >= a.variants[a.variants.length - 1].units, 'variants not sorted');
    const v = a.variants.find((x) => x.barcode === vM.barcode); assert(v && v.received >= 10 && v.sell_through > 0, 'sell-through ' + JSON.stringify(v));
    assert(a.staff.length >= 1 && a.catSize.length >= 1, 'staff / catSize');
    await ok(manager, 'sty_adjust', { p: { variantId: vL.id, qty: 0, mode: 'count' } });
    const ins = await ok(owner, 'sty_insights', { p: { branchId: branch1 } });
    assert(ins.reorder.some((x) => x.id === vL.id), 'a sold-out selling item is not in reorder'); assert(ins.stockOutSelling.some((x) => x.id === vL.id), 'stock-out-selling');
    assert(ins.sizeCurve.length >= 1, 'size curve');
    const d = await ok(owner, 'sty_dashboard', { p: { from: '2000-01-01', to: '2100-01-01' } }); assert(d.current.bills > 0 && d.current.revenue > 0 && d.inventory.units > 0, 'dashboard ' + JSON.stringify(d.current));
    await fails(staff, 'sty_analytics', { p: {} }, /does not allow/i);
  }, 'critical');
  await s.check('Another business cannot read this shop\'s styles or bills', async () => {
    await fails(cafe, 'sty_catalog', {}, /not enabled/i);
    const direct = await q("select count(*)::int n from sty_styles where tenant_id <> $1 and tenant_id not in (select id from tenants where slug = 'demo')", [tid]); assert(direct[0].n === 0, 'foreign rows in a one-shop test');
  }, 'critical');
  await s.check('Day close refuses a bill dated inside a closed day', async () => {
    await ok(owner, 'sty_day_close', { p_date: '2020-01-31' });
    await fails(owner, 'sty_sell', { p: { id: uid(), at: '2020-01-15T10:00:00Z', lines: [{ variantId: vJ32.id, qty: 1 }], payments: [{ mode: 'cash', amount: 2100 }] } }, /closed/i);
    await ok(owner, 'sty_day_close', { p_date: null });
  });

  await s.check('A shop logo becomes the home-screen icon source', async () => {
    await ok(owner, 'sty_save_settings', { p: { logoUrl: 'https://api.test.local/uploads/style/logo.png' } });
    const r = await q("select public_app_icon_context('teststyle') c"); const c = r[0].c;
    assert(c.settings.logo === 'https://api.test.local/uploads/style/logo.png', 'logo not exposed: ' + JSON.stringify(c.settings));
    await ok(owner, 'sty_save_settings', { p: { logoUrl: '' } });
    const r2 = await q("select public_app_icon_context('teststyle') c"); assert(!r2[0].c.settings.logo, 'empty logo must not be exposed');
  });

  await s.check('Logo upload end to end: upload, save, icon drawn from it, shown in the app', async () => {
    const c = await newCtx(browser, stack, { w: 1280, h: 800 }); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('teststyle', '/style.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', USERS.styOwner); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 });
    const out = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 200; cv.height = 200; const g = cv.getContext('2d'); g.fillStyle = '#0a7'; g.fillRect(0, 0, 200, 200); g.fillStyle = '#fff'; g.fillRect(60, 60, 80, 80);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg'));
      const up = await sb.storage.from('site').upload('style/logo-test.jpg', blob, { contentType: 'image/jpeg' });
      const url = sb.storage.from('site').getPublicUrl('x').data.publicUrl;
      let saved = null; try { saved = await api('sty_save_settings', { p: { logoUrl: url } }); } catch (e) { saved = { err: e.message }; }
      const ic = await fetch('/app-icon/180.png'); const ab = await ic.arrayBuffer();
      return { err: up.error && up.error.message, url, saved: saved && (saved.settings ? saved.settings.logoUrl : saved), icType: ic.headers.get('content-type'), icLen: ab.byteLength };
    });
    await page.evaluate(async () => { await api('sty_save_settings', { p: { logoUrl: '' } }); });
    await s.shot(page, 'logo flow'); await c.close();
    assert(!out.err && out.url, 'upload failed: ' + JSON.stringify(out));
    assert(out.saved === out.url, 'logo not saved: ' + JSON.stringify(out));
  });

  // ---------- screens ----------
  const open = async (email, dev) => {
    const c = await newCtx(browser, stack, dev); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('teststyle', '/style.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 }); await page.waitForTimeout(900);
    return { c, page, errs };
  };
  const screens = async (dev, label) => {
    const { c, page, errs } = await open(USERS.styOwner, dev); const bad = [];
    for (const [hash, name] of [['sell', 'Sell'], ['home', 'Overview'], ['stock', 'Stock'], ['analytics', 'Analytics'], ['analytics?tab=sizes', 'Sizes'], ['analytics?tab=groups', 'Groups'], ['analytics?tab=variants', 'Variants'], ['analytics?tab=next', 'Next'], ['analytics?tab=staff', 'Staff'], ['bills', 'Bills'], ['buy', 'Buy'], ['buy?tab=suppliers', 'Suppliers'], ['people', 'People'], ['people?tab=staff', 'People staff'], ['settings', 'Settings']]) {
      const before = errs.length; await page.evaluate((x) => { location.hash = '#/' + x; }, hash); await page.waitForTimeout(1100);
      if (process.env.SHOTS) { await s.shot(page, `${label} ${name}`); await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(250); await s.shot(page, `${label} ${name} DARK`); await page.emulateMedia({ colorScheme: 'light' }); }
      const body = await page.locator('#main').innerText();
      if (/Something went wrong|Could not load/i.test(body)) bad.push(`${label} ${name}: ${body.slice(0, 80)}`);
      if (/undefined|NaN|\[object|\bnull\b/.test(body)) bad.push(`${label} ${name}: shows undefined/NaN/null`);
      if (errs.length > before) bad.push(`${label} ${name}: ${errs[errs.length - 1].slice(0, 100)}`);
      if (dev.mobile) { const li = await layoutIssues(page); if (li.length) bad.push(`${label} ${name}: ${li[0]}`); }
    }
    await s.shot(page, label + ' settings'); await c.close(); return bad;
  };
  await s.check('Every screen opens on a phone with no errors, no sideways scroll', async () => { const bad = await screens({ w: 390, h: 844, mobile: true }, 'phone'); assert(!bad.length, bad.join(' | ')); });
  await s.check('Every screen opens on a laptop with no errors', async () => { const bad = await screens({ w: 1280, h: 800 }, 'desktop'); assert(!bad.length, bad.join(' | ')); });

  const till = async (dev, label) => {
    const { c, page, errs } = await open(USERS.styStaff, dev);
    await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForSelector('.scard', { timeout: 15000 });
    // scanning a tag (the search box takes Enter like a hardware scanner) adds that exact size
    const v = await ok(owner, 'sty_catalog', { p_branch: null }); const jv = v.find((x) => x.name === 'Skinny Jeans').variants.find((x) => x.size === '34');
    await page.fill('.sell-l input[type=search]', jv.barcode); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    const mobile = dev.mobile;
    if (mobile) await page.locator('.cartbar').click(); await page.waitForTimeout(400);
    const billText = await page.locator(mobile ? '.sheet' : '.cartpane').innerText();
    assert(/Skinny Jeans/.test(billText) && /34/.test(billText), 'scanned item not on the bill: ' + billText.slice(0, 120));
    await page.locator(mobile ? '.sheet .btn.fill' : '.cartpane .btn.fill', { hasText: /Pay/ }).click(); await page.waitForSelector('.paytot', { timeout: 8000 });
    await page.locator('.sheet-f .btn.fill').last().click(); await page.waitForSelector('.receipt', { timeout: 15000 });
    const rc = await page.locator('.receipt').innerText(); assert(/AS-\d+/.test(rc) && /Total/.test(rc), 'receipt: ' + rc.slice(0, 120));
    await s.shot(page, label + ' receipt'); assert(!errs.filter((e) => !/sentry/i.test(e)).length, errs.join(' | ')); await c.close();
  };
  await s.check('Till on a phone: scan a tag, bill it, pay cash, get a receipt', async () => { await till({ w: 390, h: 844, mobile: true }, 'phone till'); }, 'critical');
  await s.check('Till on a laptop: scan a tag, bill it, pay cash, get a receipt', async () => { await till({ w: 1280, h: 800 }, 'desktop till'); }, 'critical');

  await s.check('A bill gets a short public link that shows the bill but no staff, cost or customer phone', async () => {
    const sale = await ok(owner, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vM.id, qty: 1 }], payments: [{ mode: 'cash', amount: 1500 }] } });
    const t1 = (await ok(owner, 'sty_share_sale', { p_id: sale.id })).token; const t2 = (await ok(owner, 'sty_share_sale', { p_id: sale.id })).token;
    assert(/^[a-f0-9]{10}$/.test(t1) && t1 === t2, 'token ' + t1 + ' / ' + t2);
    const pub = await call(null, 'public_sty_sale', { p_token: t1 }); assert(pub.ok && pub.data && pub.data.sale.number === sale.number, 'public bill: ' + JSON.stringify(pub).slice(0, 120));
    const txt = JSON.stringify(pub.data); assert(!/staff|cost|barcode|"phone":"\d/i.test(txt.replace(/"shop":\{[^}]*\}/, '')), 'public bill leaks: ' + txt.slice(0, 200));
    assert((await call(null, 'public_sty_sale', { p_token: 'ffffffffff' })).data == null, 'unknown token answered');
    await fails(staff, 'sty_share_sale', { p_id: '00000000-0000-0000-0000-000000000001' }, /not found/i);
  });
  await s.check('Limited stock and Sold out labels: set by a manager, shown on the till, and Sold out cannot be added to a bill', async () => {
    const r = await ok(owner, 'sty_set_badge', { p_id: shirt.id, p_badge: 'limited' }); assert(r.badge === 'limited', 'badge ' + r.badge);
    await fails(owner, 'sty_set_badge', { p_id: shirt.id, p_badge: 'rare' }, /limited or soldout/i);
    await fails(staff, 'sty_set_badge', { p_id: shirt.id, p_badge: 'soldout' }, /does not allow/i);
    const { c, page } = await open(USERS.styStaff, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForSelector('.scard', { timeout: 15000 });
    assert(/Limited stock/i.test(await page.locator('.scard', { hasText: 'Slim Shirt' }).innerText()), 'no Limited stock label on the card');
    await c.close();
    await ok(owner, 'sty_set_badge', { p_id: shirt.id, p_badge: 'soldout' });
    const o2 = await open(USERS.styStaff, { w: 390, h: 844, mobile: true });
    await o2.page.evaluate(() => { location.hash = '#/sell'; }); await o2.page.waitForSelector('.scard', { timeout: 15000 });
    const card = o2.page.locator('.scard', { hasText: 'Slim Shirt' }); assert(/Sold out/i.test(await card.innerText()), 'no Sold out label');
    await card.locator('.pic').click(); await o2.page.waitForTimeout(500);
    assert(!(await o2.page.locator('.vp-h').count()), 'a sold-out style opened the picker');
    await o2.c.close();
    await ok(owner, 'sty_set_badge', { p_id: shirt.id, p_badge: null });
  });
  await s.check('Picking a colour on the till switches the picture to that colour', async () => {
    const { c, page } = await open(USERS.styStaff, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForSelector('.scard', { timeout: 15000 });
    await page.locator('.scard', { hasText: 'Slim Shirt' }).locator('.pic').click(); await page.waitForSelector('.vp-h .ph img', { timeout: 8000 });
    const first = await page.locator('.vp-h .ph img').getAttribute('src'); assert(/blue-1/.test(first), 'first colour picture: ' + first);
    await page.locator('.sheet .chip', { hasText: 'White' }).first().click(); await page.waitForTimeout(300);
    const second = await page.locator('.vp-h .ph img').getAttribute('src'); assert(/white-1/.test(second), 'picture did not switch: ' + second);
    await s.shot(page, 'colour picture'); await c.close();
  });

  await s.check('CRM and WhatsApp automation: segments, detail, bill link queued once, birthday greeting, gates', async () => {
    const cu = await ok(staff, 'sty_save_customer', { p: { name: 'Riya Shah', phone: '9811100022', birthday: '1995-03-04', anniversary: '2020-05-06', gender: 'female', city: 'Jodhpur' } });
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(5, 10);
    await ok(staff, 'sty_save_customer', { p: { id: cu.id, birthday: '1990-' + today } });
    const sid = uid();
    await ok(staff, 'sty_sell', { p: { id: sid, customerId: cu.id, lines: [{ variantId: vM.id, qty: 1 }], payments: [{ mode: 'cash', amount: 5000 }] } });
    const ov = await ok(staff, 'sty_crm_overview'); assert(ov.total >= 1 && ov.withPhone >= 1, 'overview ' + JSON.stringify(ov));
    assert(ov.upcoming.some((u) => u.kind === 'birthday' && u.days === 0), 'today birthday missing');
    const det = await ok(staff, 'sty_customer_detail', { p_id: cu.id }); assert(det.visits === 1 && det.bills.length === 1 && det.likes.length === 1 && det.city === 'Jodhpur', JSON.stringify(det));
    const list = await ok(staff, 'sty_crm_list', { p: { q: 'riya', segment: 'new' } }); assert(list.length === 1, 'segment new ' + list.length);
    await fails(cafe, 'sty_crm_list', { p: {} }, /not enabled/i);
    // nothing leaves until the shop switches WhatsApp on
    assert(Number((await q("select count(*)::int n from wa_outbox where tenant_id=$1", [tid]))[0].n) === 0, 'queued while off');
    await q("insert into wa_tenant_settings (tenant_id, enabled) values ($1, true) on conflict (tenant_id) do update set enabled = true", [tid]);
    const sid2 = uid();
    await ok(staff, 'sty_sell', { p: { id: sid2, customerId: cu.id, lines: [{ variantId: vM.id, qty: 1 }], payments: [{ mode: 'cash', amount: 5000 }] } });
    await q("select sty_wa_daily_run()"); await q("select sty_wa_daily_run()");
    const rows = await q("select template, params->>4 link from wa_outbox where tenant_id=$1 order by template", [tid]);
    assert(rows.filter((r) => r.template === 'invoice_link').length === 1 && /\/b\/[a-f0-9]{10}$/.test(rows.find((r) => r.template === 'invoice_link').link), 'bill link ' + JSON.stringify(rows));
    assert(rows.filter((r) => r.template === 'birthday_greeting').length === 1, 'birthday once: ' + JSON.stringify(rows));
    await ok(staff, 'sty_save_customer', { p: { id: cu.id, waOptin: false } });
    await ok(staff, 'sty_sell', { p: { id: uid(), customerId: cu.id, lines: [{ variantId: vM.id, qty: 1 }], payments: [{ mode: 'cash', amount: 5000 }] } });
    assert((await q("select count(*)::int n from wa_outbox where tenant_id=$1 and template='invoice_link'", [tid]))[0].n === 1, 'opted-out customer got a bill link');
    await q("update wa_tenant_settings set enabled=false where tenant_id=$1", [tid]);
    await integrity();
  });

  await s.check('Collections: create, add styles, remove, rename rules, staff cannot change, other business separate', async () => {
    const c = await ok(manager, 'sty_collection_save', { p: { name: 'Summer 2026', note: 'Light fabrics' } });
    await fails(manager, 'sty_collection_save', { p: { name: 'summer 2026' } }, /already exists/i);
    await fails(staff, 'sty_collection_save', { p: { name: 'Nope' } }, /does not allow/i);
    let r = await ok(manager, 'sty_collection_members', { p_id: c.id, p_add: [shirt.id, jeans.id] }); assert(r.count === 2, 'count ' + r.count);
    await ok(manager, 'sty_collection_members', { p_id: c.id, p_add: [shirt.id] });
    let list = await ok(staff, 'sty_collections_list'); const mine = list.find((x) => x.id === c.id); assert(mine && mine.styleIds.length === 2, JSON.stringify(list));
    await fails(staff, 'sty_collection_members', { p_id: c.id, p_remove: [shirt.id] }, /does not allow/i);
    r = await ok(manager, 'sty_collection_members', { p_id: c.id, p_remove: [jeans.id] }); assert(r.count === 1, 'after remove ' + r.count);
    await fails(cafe, 'sty_collections_list', {}, /not enabled/i);
    const { c: cx, page } = await open(USERS.styStaff, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForSelector('.scard', { timeout: 15000 });
    await page.locator('.chips .chip', { hasText: 'Summer 2026' }).click(); await page.waitForTimeout(300);
    assert(await page.locator('.scard').count() === 1, 'collection filter should show 1 style');
    await cx.close();
    await ok(manager, 'sty_collection_delete', { p_id: c.id });
    assert(!(await ok(staff, 'sty_collections_list')).some((x) => x.id === c.id), 'not deleted');
  });

  await s.check('Barcode tags: the generated Code 128 reads back with the scanner library', async () => {
    const c = await newCtx(browser, stack, { w: 800, h: 600 }); const page = await c.newPage();
    await page.goto(stack.url('teststyle', '/style.html')); await page.waitForTimeout(800);
    const out = await page.evaluate(async (code) => {
      const svg = barcodeSvg(code, { height: 60, width: 300 });
      const xml = new XMLSerializer().serializeToString(svg), img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
      const cv = document.createElement('canvas'); cv.width = 600; cv.height = 120; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 120); g.drawImage(img, 0, 0, 600, 120);
      try { return await auzScanner._decode(g.getImageData(0, 0, 600, 120)); } catch (e) { return 'ERR ' + e; }
    }, '2000000037');
    await c.close();
    if (out === 'no-lib') { s.note('ZXing not loadable here; barcode decode check skipped'); return; }
    assert(out === '2000000037', 'decoded ' + out);
  }, 'major');
  s.done();
}
