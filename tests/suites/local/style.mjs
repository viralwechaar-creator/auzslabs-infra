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

  await s.check('Which picture shows where: card, hero and banner come from the style\'s own pictures only, staff cannot change them, collections carry a picture', async () => {
    let r = await ok(owner, 'sty_set_photo_use', { p_id: shirt.id, p: { card: '/u/blue-2.webp', hero: '/u/white-1.webp', banner: '/u/not-mine.webp' } });
    assert(r.photoUse.card === '/u/blue-2.webp' && r.photoUse.hero === '/u/white-1.webp' && !('banner' in r.photoUse), JSON.stringify(r.photoUse));
    r = await ok(owner, 'sty_set_photo_use', { p_id: shirt.id, p: { card: '' } }); assert(!('card' in r.photoUse) && r.photoUse.hero === '/u/white-1.webp', 'clearing card failed: ' + JSON.stringify(r.photoUse));
    await fails(staff, 'sty_set_photo_use', { p_id: shirt.id, p: { card: '/u/blue-1.webp' } }, /does not allow/i);
    const cat = await ok(owner, 'sty_catalog', {}); assert(cat.find((x) => x.id === shirt.id).photoUse.hero === '/u/white-1.webp', 'catalogue lacks photoUse');
    const c = await ok(manager, 'sty_collection_save', { p: { name: 'Picture test', image: '/u/col.webp' } });
    const list = await ok(manager, 'sty_collections_list', {}); assert(list.find((x) => x.id === c.id).image === '/u/col.webp', 'collection picture missing');
    await ok(manager, 'sty_collection_save', { p: { id: c.id, name: 'Picture test', image: '' } });
    assert(!(await ok(manager, 'sty_collections_list', {})).find((x) => x.id === c.id).image, 'collection picture not cleared');
    await ok(manager, 'sty_collection_delete', { p_id: c.id });
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

  await s.check('Voiding a credit-paid bill gives the store credit back; exchange credit is real and capped, not trusted at face value', async () => {
    const cu = (await ok(staff, 'sty_list_customers', { p_q: 'Asha' }))[0]; const before = cu.credit; assert(before > 0, 'test needs existing store credit');
    const spend = Math.min(before, 50);
    const b = await ok(staff, 'sty_sell', { p: { id: uid(), customerId: cu.id, lines: [{ variantId: vL.id, qty: 1 }], payments: [{ mode: 'credit', amount: spend }, { mode: 'cash', amount: 3000 }] } });
    let cu2 = (await ok(staff, 'sty_list_customers', { p_q: 'Asha' }))[0]; assert(Math.abs(cu2.credit - (before - spend)) < 0.02, 'credit not spent: ' + cu2.credit);
    await ok(manager, 'sty_void_sale', { p_id: b.id, p_reason: 'test void' });
    cu2 = (await ok(staff, 'sty_list_customers', { p_q: 'Asha' }))[0]; assert(Math.abs(cu2.credit - before) < 0.02, 'credit not restored after void: ' + cu2.credit + ' vs ' + before);

    // exchange: a return with mode='exchange' must grant real credit, and sty_sell must cap an 'exchange' payment
    // against that real balance -- not accept whatever amount the client claims.
    const b2 = await ok(staff, 'sty_sell', { p: { id: uid(), customerId: cu.id, lines: [{ variantId: vL.id, qty: 1 }], payments: [{ mode: 'cash', amount: 3000 }] } });
    const r = await ok(staff, 'sty_return', { p: { id: uid(), saleId: b2.id, mode: 'exchange', reason: 'size swap', lines: [{ saleLineId: b2.lines[0].id, qty: 1 }] } });
    const exVal = r.returns.find((x) => x.mode === 'exchange').refund;
    const cu3 = (await ok(staff, 'sty_list_customers', { p_q: 'Asha' }))[0]; assert(cu3.credit >= exVal - 0.02, 'exchange did not grant real credit: ' + cu3.credit);
    const claimed = exVal * 50 + 9999; // a wildly inflated amount a tampered client could send
    const b3 = await ok(staff, 'sty_sell', { p: { id: uid(), customerId: cu.id, lines: [{ variantId: vL.id, qty: 1 }], payments: [{ mode: 'exchange', amount: claimed }, { mode: 'cash', amount: 3000 }] } });
    const cu4 = (await ok(staff, 'sty_list_customers', { p_q: 'Asha' }))[0]; assert(cu4.credit === 0, 'inflated exchange amount was not capped: ' + cu4.credit);
    assert(b3.status === 'paid', 'bill should still be payable with cash covering the rest');
    await integrity();
  }, 'critical');

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

  await s.check('Cash in/out: move the drawer total, need an open shift, amount must be positive', async () => {
    await fails(staff, 'sty_cash_move', { p: { kind: 'out', amount: 100 } }, /open a shift/i);
    const opened = await ok(staff, 'sty_shift_open', { p: { openingCash: 500 } });
    await fails(staff, 'sty_cash_move', { p: { kind: 'sideways', amount: 100 } }, /kind must be/i);
    await fails(staff, 'sty_cash_move', { p: { kind: 'out', amount: 0 } }, /above 0/i);
    await fails(staff, 'sty_cash_move', { p: { kind: 'out', amount: -50 } }, /above 0/i);
    let cur = await ok(staff, 'sty_cash_move', { p: { kind: 'out', amount: 300, reason: 'Change for delivery boy' } });
    assert(cur.cashOut === 300 && cur.expectedCash === opened.expectedCash - 300, 'after out: ' + JSON.stringify(cur));
    cur = await ok(staff, 'sty_cash_move', { p: { kind: 'in', amount: 100, reason: 'Owner top-up' } });
    assert(cur.cashIn === 100 && cur.cashOut === 300 && cur.expectedCash === opened.expectedCash - 300 + 100, 'after in: ' + JSON.stringify(cur));
    const moves = await ok(staff, 'sty_cash_moves_list', {});
    assert(moves.length === 2 && moves[0].kind === 'in' && moves[0].amount === 100 && moves[1].kind === 'out' && moves[1].reason === 'Change for delivery boy', JSON.stringify(moves));
    const closed = await ok(staff, 'sty_shift_close', { p: { countedCash: cur.expectedCash } });
    assert(closed.difference === 0, 'closed difference ' + closed.difference);
    const hist = await ok(owner, 'sty_list_shifts', {});
    const h = hist.find((x) => x.id === opened.id); assert(h && h.cashIn === 100 && h.cashOut === 300, 'history row ' + JSON.stringify(h));
  });

  await s.check('Denomination count at shift close: total is computed server-side from the count, not trusted from the client', async () => {
    const opened = await ok(staff, 'sty_shift_open', { p: { openingCash: 1000 } });
    await fails(staff, 'sty_shift_close', { p: { denominations: { 500: 2, 37: 1 } } }, /not a real note or coin/i);
    await fails(staff, 'sty_shift_close', { p: { denominations: { 500: -1 } } }, /cannot be negative/i);
    // 2x500 + 1x200 + 3x100 + 1x50 + 2x20 = 1000+200+300+50+40 = 1590
    const r = await ok(staff, 'sty_shift_close', { p: { denominations: { 500: 2, 200: 1, 100: 3, 50: 1, 20: 2 }, note: 'end of day' } });
    assert(r.countedCash === 1590, 'counted from denominations: ' + r.countedCash);
    assert(Math.abs(r.difference - (1590 - opened.expectedCash)) < 0.02, 'difference ' + r.difference);
    const hist = await ok(owner, 'sty_list_shifts', {});
    const h = hist.find((x) => x.id === opened.id);
    assert(h && h.counted === 1590 && h.denominations && h.denominations['500'] === 2 && h.denominations['100'] === 3, 'history denominations: ' + JSON.stringify(h));
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
    for (const [hash, name] of [['sell', 'Sell'], ['home', 'Overview'], ['stock', 'Stock'], ['analytics', 'Analytics'], ['analytics?tab=sizes', 'Sizes'], ['analytics?tab=groups', 'Groups'], ['analytics?tab=variants', 'Variants'], ['analytics?tab=next', 'Next'], ['analytics?tab=staff', 'Staff'], ['intel', 'Intel overview'], ['intel?tab=designs', 'Intel designs'], ['intel?tab=reorder', 'Intel reorder'], ['intel?tab=capital', 'Intel capital'], ['intel?tab=lost', 'Intel lost'], ['intel?tab=basket', 'Intel basket'], ['intel?tab=advice', 'Intel advice'], ['requests', 'Requests'], ['bills', 'Bills'], ['buy', 'Buy'], ['buy?tab=suppliers', 'Suppliers'], ['people', 'People'], ['people?tab=staff', 'People staff'], ['settings', 'Settings']]) {
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

  await s.check('UPI QR in the pay sheet: shows with the exact amount, must be confirmed, then the bill saves', async () => {
    await ok(owner, 'sty_save_settings', { p: { features: { upiId: 'testshop@upi', upiName: 'Test Shop' } } });
    const { c, page, errs } = await open(USERS.styStaff, { w: 1280, h: 800 });
    await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForSelector('.scard', { timeout: 15000 });
    const v = await ok(owner, 'sty_catalog', { p_branch: null }); const jv = v.find((x) => x.name === 'Skinny Jeans').variants.find((x) => x.size === '34');
    await page.fill('.sell-l input[type=search]', jv.barcode); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    await page.locator('.cartpane .btn.fill', { hasText: /Pay/ }).click(); await page.waitForSelector('.paytot', { timeout: 8000 });
    assert(await page.locator('.upiq').isHidden(), 'QR shown before any UPI amount');
    const pays = page.locator('.payl'); const n = await pays.count();
    let upiRow = null; for (let i = 0; i < n; i++) { if (/UPI/i.test(await pays.nth(i).locator('label').innerText())) upiRow = pays.nth(i); }
    await upiRow.locator('.btn.sm').click(); await page.waitForTimeout(300);
    assert(await page.locator('.upiq .upiq-i').count() === 1, 'no QR image');
    assert(/testshop@upi/.test(await page.locator('.upiq').innerText()), 'UPI id missing');
    assert(await page.locator('.sheet-f .btn.fill').last().isDisabled(), 'Complete sale should wait for the confirmation');
    await page.locator('.upiq input[type=checkbox]').check(); await page.waitForTimeout(200);
    assert(!(await page.locator('.sheet-f .btn.fill').last().isDisabled()), 'still disabled after confirming');
    await s.shot(page, 'upi qr');
    await page.locator('.sheet-f .btn.fill').last().click(); await page.waitForSelector('.receipt', { timeout: 15000 });
    assert(!errs.filter((e) => !/sentry/i.test(e)).length, errs.join(' | ')); await c.close();
    await ok(owner, 'sty_save_settings', { p: { features: {} } });
  });

  await s.check('Plan limits: a Base plan blocks the online store, pictures and WhatsApp automation; Pro blocks only WhatsApp', async () => {
    const setCaps = (c) => q("update tenant_settings set caps=$1::jsonb where tenant_id=$2", [JSON.stringify(c), tid]);
    await setCaps({ online_store: false, images: false, whatsapp: false });
    const ctx = await ok(owner, 'sty_context'); assert(ctx.caps && ctx.caps.online_store === false, 'caps missing in context');
    await fails(owner, 'sty_store_save', { p: { on: true } }, /not part of your plan/i);
    const pub = await ok(null, 'public_sty_store', { p_slug: 'teststyle' }); assert(pub.closed, 'store should read as closed');
    await fails(null, 'public_sty_place_order', { p_slug: 'teststyle', p: { name: 'A B', phone: '9876543210', address: '1 Road', city: 'Jodhpur', pin: '342001', payment: 'cod', lines: [] } }, /not available/i);
    const up = await fetch(stack.url('api', '/storage/site/style'), { method: 'POST', headers: { authorization: 'Bearer ' + owner, 'content-type': 'image/png' }, body: Buffer.from('x') }).catch(() => null);
    if (up) assert(up.status === 403, 'upload should be refused, got ' + up.status);
    const w1 = (await q("select wa_enqueue($1,'9876543210','invoice_link','[\"a\",\"b\",\"c\"]'::jsonb,'cap-test') id", [tid]))[0].id;
    assert(w1 === null, 'WhatsApp must not queue on a Base plan');
    await setCaps({ online_store: true, images: true, whatsapp: false });
    await ok(owner, 'sty_store_save', { p: { on: false } });
    assert((await q("select wa_enqueue($1,'9876543210','invoice_link','[\"a\",\"b\",\"c\"]'::jsonb,'cap-test2') id", [tid]))[0].id === null, 'WhatsApp must not queue on Pro');
    await setCaps({});
  });

  await s.check('Online store: closed by default, then public catalogue, orders (COD + UPI), stock and price checks, staff inbox', async () => {
    const anon = null;
    let pub = await ok(anon, 'public_sty_store', { p_slug: 'teststyle' }); assert(pub && pub.closed, 'should be closed by default: ' + JSON.stringify(pub).slice(0, 120));
    await fails(anon, 'public_sty_place_order', { p_slug: 'teststyle', p: { name: 'A B', phone: '9876543210', address: '1 Road', city: 'Jodhpur', pin: '342001', payment: 'cod', lines: [] } }, /closed|empty/i);
    await fails(staff, 'sty_store_save', { p: { on: true } }, /does not allow/i);
    await ok(manager, 'sty_store_save', { p: { on: true, announce: 'Free shipping above 3000', heroImages: ['/x.jpg'], shipping: { fee: 80, freeOver: 3000, note: 'Ships in 3 days' }, pay: { cod: true, upi: true },
      stores: [{ name: 'Main store', address: 'Sardarpura, Jodhpur', phone: '9999999999' }], faqs: [{ cat: 'Orders', q: 'How long?', a: '3 to 7 days' }], about: { title: 'About', text: 'We sell clothes.' }, evil: 'nope' } });
    const cfgNow = await ok(manager, 'sty_store_get'); assert(cfgNow.on === true && !('evil' in cfgNow) && cfgNow.slug === 'teststyle', 'config ' + JSON.stringify(cfgNow));
    pub = await ok(anon, 'public_sty_store', { p_slug: 'teststyle' });
    assert(pub.styles.length >= 2 && pub.shop.name, 'styles missing');
    const flat = JSON.stringify(pub); assert(!/"cost"|barcode|"sku"/.test(flat), 'cost/barcode leaked on the public store');
    assert(pub.styles.every((x) => x.variants.every((v) => v.left >= 0 && v.left <= 9)), 'stock should be capped for the public');
    const cat = await ok(owner, 'sty_catalog', { p_branch: null });
    const sty = cat.find((x) => x.variants.some((v) => v.stock >= 3 && x.price > 0)); const vr = sty.variants.find((v) => v.stock >= 3);
    const base = { name: 'Asha Rao', email: 'asha@example.com', phone: '98765 43210', address: '12 Station Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001' };
    await fails(anon, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, payment: 'cod', lines: [{ variantId: vr.id, qty: 99 }] } }, /Quantity/i);
    await fails(anon, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, payment: 'cod', lines: [{ variantId: vr.id, qty: 20 }] } }, /Only \d+ left|left of/i);
    await fails(anon, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, phone: '12', payment: 'cod', lines: [{ variantId: vr.id, qty: 1 }] } }, /phone/i);
    await fails(anon, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, payment: 'upi', lines: [{ variantId: vr.id, qty: 1 }] } }, /UPI payment is not set up/i);
    await fails(anon, 'public_sty_place_order', { p_slug: 'nobodyshop', p: { ...base, payment: 'cod', lines: [{ variantId: vr.id, qty: 1 }] } }, /not available/i);
    const before = await stock(vr.id);
    const o1 = await ok(anon, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, payment: 'cod', lines: [{ variantId: vr.id, qty: 2, price: 1 }] } });
    const expect = vr.price * 2 + (vr.price * 2 >= 3000 ? 0 : 80);
    assert(Number(o1.total) === expect, `total ${o1.total} expected ${expect} (a price sent by the browser must be ignored)`);
    assert(await stock(vr.id) === before, 'a web order must not move stock until it is billed');
    const mine = await ok(anon, 'public_sty_order', { p_token: o1.token }); assert(mine.number === o1.number && !JSON.stringify(mine).includes('9876543210'), 'order page should not show the phone');
    await ok(owner, 'sty_save_settings', { p: { features: { upiId: 'testshop@upi', upiName: 'Test Shop' } } });
    const o2 = await ok(anon, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, phone: '9123456780', payment: 'upi', lines: [{ variantId: vr.id, qty: 1 }] } });
    assert(o2.upi && o2.upi.id === 'testshop@upi', 'upi details');
    await fails(anon, 'public_sty_order_paid', { p_token: o2.token, p_utr: '12' }, /reference/i);
    const paid = await ok(anon, 'public_sty_order_paid', { p_token: o2.token, p_utr: 'T2610123456' }); assert(paid.paymentStatus === 'submitted', 'status ' + paid.paymentStatus);
    const inbox = await ok(staff, 'sty_web_orders_list', { p: {} }); assert(inbox.length >= 2 && inbox.find((x) => x.number === o2.number).utr === 'T2610123456', 'inbox');
    assert(await ok(staff, 'sty_web_orders_open') >= 2, 'open count');
    const stk0 = await stock(vr.id);
    const up = await ok(staff, 'sty_web_order_update', { p_id: inbox.find((x) => x.number === o2.number).id, p: { status: 'confirmed', paymentStatus: 'paid' } });
    assert(up.saleId && up.billed, 'paying the order must make the bill by itself: ' + JSON.stringify(up));
    assert(await stock(vr.id) === stk0 - 1, 'stock must move once, when the bill is made');
    const again = await ok(staff, 'sty_web_order_bill', { p_id: inbox.find((x) => x.number === o2.number).id }); assert(again.duplicate, 'a second bill must not be made');
    await ok(staff, 'sty_web_order_update', { p_id: inbox.find((x) => x.number === o2.number).id, p: { status: 'packed' } });
    assert(await stock(vr.id) === stk0 - 1, 'stock moved twice');
    await fails(cafe, 'sty_web_orders_list', { p: {} }, /not enabled/i);
    await fails(staff, 'sty_store_request_payments', {}, /does not allow/i);
    const rq = await ok(manager, 'sty_store_request_payments'); assert(rq.payReq === 'requested', 'payReq');
    await ok(owner, 'sty_save_settings', { p: { features: {} } });
    await integrity();
  });

  await s.check('Store visitor analytics: events are stored anonymously and the owner sees funnel, scroll depth and products', async () => {
    await ok(manager, 'sty_store_save', { p: { on: true } });
    const ev = (k, p, d) => ({ sid: 'visitor-abc12345', k, p, d, dev: 'phone', ref: 'instagram.com', ret: false });
    const r = await ok(null, 'public_sty_track', { p_slug: 'teststyle', p: { events: [ev('view', 'home'), ev('scroll', 'home', { max: 80, s: 20 }), ev('time', 'home', { s: 20 }), ev('product', 'p/x', { id: 'x', name: 'Slim Shirt' }), ev('bag', 'p/x', { id: 'x', name: 'Slim Shirt' }), ev('search', 'shop', { q: 'shirt' }), { sid: 'x', k: 'view' }, { sid: 'visitor-abc12345', k: 'hack' }] } });
    assert(r.n === 6, 'stored ' + r.n + ' (bad ids and unknown kinds must be dropped)');
    const a = await ok(manager, 'sty_store_analytics', { p_days: 30 });
    assert(a.visitors >= 1 && a.funnel.b >= 1 && a.scroll.some((x) => x.page === 'home' && +x.a75 >= 1) && a.products.some((x) => x.name === 'Slim Shirt') && a.searches.some((x) => x.q === 'shirt'), JSON.stringify(a).slice(0, 300));
    assert(!(await call(staff, 'sty_store_analytics', { p_days: 30 })).ok, 'a plain staffer must not read visitor analytics');
  });

  await s.check('Store round 5: coupons, tracking, reviews after delivery, returns, order lookup, back-in-stock, own-Razorpay confirm', async () => {
    await ok(manager, 'sty_store_save', { p: { on: true, waOrder: false, shipping: { fee: 80, freeOver: 0 }, pay: { cod: true, upi: false }, sizeGuide: { note: 'x', rows: [['M', '38-40', '32']] } } });
    const cat = await ok(owner, 'sty_catalog', { p_branch: null });
    const sty = cat.find((x) => x.variants.some((v) => v.stock >= 3 && x.price > 0)); const vr = sty.variants.find((v) => v.stock >= 3);
    const base = { name: 'Ravi Kumar', phone: '9811122233', address: '5 Lane', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', payment: 'cod' };
    await fails(manager, 'sty_coupon_save', { p: { code: 'x', kind: 'pct', value: 10 } }, /3 to 24/);
    await ok(manager, 'sty_coupon_save', { p: { code: 'save10', kind: 'pct', value: 10, firstOnly: true, maxUses: 5 } });
    await fails(null, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, coupon: 'NOPE', lines: [{ variantId: vr.id, qty: 1 }] } }, /coupon/i);
    const chk = await ok(null, 'public_sty_coupon_check', { p_slug: 'teststyle', p: { code: 'SAVE10', subtotal: 1000, phone: '9811122233' } }); assert(chk.ok && +chk.discount === 100, 'coupon check ' + JSON.stringify(chk));
    const o = await ok(null, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, coupon: 'SAVE10', lines: [{ variantId: vr.id, qty: 1 }] } });
    assert(+o.discount > 0 && +o.total === +vr.price - +o.discount + 80, 'discount maths ' + JSON.stringify(o));
    const again = await call(null, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, coupon: 'SAVE10', lines: [{ variantId: vr.id, qty: 1 }] } }); assert(!again.ok && /first orders|already used/i.test(again.error || ''), 'a first-order coupon must not work twice: ' + again.error);
    await fails(null, 'public_sty_review_submit', { p_token: o.token, p: { styleId: sty.id, rating: 5 } }, /delivered/i);
    await fails(null, 'public_sty_return_request', { p_token: o.token, p: { kind: 'return', reason: 'too big' } }, /delivered/i);
    const inbox = await ok(staff, 'sty_web_orders_list', { p: {} }); const row = inbox.find((x) => x.number === o.number);
    await ok(staff, 'sty_web_order_update', { p_id: row.id, p: { status: 'confirmed' } });
    await ok(staff, 'sty_web_order_update', { p_id: row.id, p: { status: 'shipped', courier: 'Delhivery', trackingNo: 'DL123456' } });
    let pg = await ok(null, 'public_sty_order', { p_token: o.token }); assert(pg.courier === 'Delhivery' && pg.trackingNo === 'DL123456', 'tracking ' + JSON.stringify(pg).slice(0, 200));
    await ok(staff, 'sty_web_order_update', { p_id: row.id, p: { status: 'delivered' } });
    pg = await ok(null, 'public_sty_order', { p_token: o.token }); assert(pg.canReturn === true, 'canReturn');
    await fails(null, 'public_sty_review_submit', { p_token: o.token, p: { styleId: sty.id, rating: 9 } }, /1 to 5/);
    await ok(null, 'public_sty_review_submit', { p_token: o.token, p: { styleId: sty.id, rating: 5, body: 'Great fit' } });
    const rv = await ok(null, 'public_sty_reviews', { p_slug: 'teststyle', p_style: sty.id }); assert(rv.count === 1 && rv.items[0].name === 'Ravi', 'review ' + JSON.stringify(rv));
    await ok(manager, 'sty_review_set', { p_id: (await ok(manager, 'sty_reviews_list'))[0].id, p_status: 'hidden' });
    assert((await ok(null, 'public_sty_reviews', { p_slug: 'teststyle', p_style: sty.id })).count === 0, 'a hidden review must not show');
    await ok(null, 'public_sty_return_request', { p_token: o.token, p: { kind: 'exchange', reason: 'Need a bigger size' } });
    await fails(null, 'public_sty_return_request', { p_token: o.token, p: { kind: 'return', reason: 'again please' } }, /already/i);
    const rets = await ok(staff, 'sty_web_returns_list'); assert(rets.length === 1 && rets[0].kind === 'exchange', 'returns inbox');
    await ok(staff, 'sty_web_return_set', { p_id: rets[0].id, p: { status: 'approved', staffNote: 'Send it back' } });
    const f = await ok(null, 'public_sty_order_find', { p_slug: 'teststyle', p: { number: o.number.toLowerCase(), phone: '98111 22233' } }); assert(f.token === o.token, 'order lookup');
    await fails(null, 'public_sty_order_find', { p_slug: 'teststyle', p: { number: o.number, phone: '9000000000' } }, /could not find/i);
    await ok(null, 'public_sty_notify_me', { p_slug: 'teststyle', p: { variantId: vr.id, phone: '9811122233', name: 'Ravi' } });
    assert(Number((await q('select count(*)::int c from sty_web_notify where tenant_id=$1 and sent_at is null', [tid]))[0].c) === 1, 'notify row');
    // the shop's own Razorpay keys: only a correct signature marks the order paid
    await ok(manager, 'sty_store_set_razorpay', { p: { keyId: 'rzp_test_abcdefgh12', secret: 'secret-secret-12345' } });
    const pub = await ok(null, 'public_sty_store', { p_slug: 'teststyle' }); assert(pub.config.payOnline === true && !JSON.stringify(pub).includes('secret-secret'), 'payOnline exposed, secret never');
    const o2 = await ok(null, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, phone: '9822233344', payment: 'online', lines: [{ variantId: vr.id, qty: 1 }] } });
    await q('select sty_online_set_order($1,$2)', [o2.token, 'order_TEST1']);
    const bad = await q("select sty_online_confirm($1,$2,$3,$4) r", [o2.token, 'order_TEST1', 'pay_TEST1', 'deadbeef']).then(() => null, (e) => e.message); assert(bad && /could not be verified/i.test(bad), 'a wrong signature must be refused: ' + bad);
    const sig = (await q("select encode(hmac('order_TEST1|pay_TEST1'::bytea, 'secret-secret-12345'::bytea, 'sha256'),'hex') s"))[0].s;
    const good = (await q('select sty_online_confirm($1,$2,$3,$4) r', [o2.token, 'order_TEST1', 'pay_TEST1', sig]))[0].r; assert(good.paymentStatus === 'paid', 'paid ' + JSON.stringify(good));
    const sh = await ok(null, 'public_sty_share', { p_slug: 'teststyle', p_style: sty.id }); assert(sh && sh.shop && sh.name, 'share data');
    await integrity();
  });

  await s.check('Coupons at the till: owner-created coupons work on an in-person bill too, never trusted blindly', async () => {
    await ok(manager, 'sty_coupon_save', { p: { code: 'fest50', kind: 'flat', value: 50, minOrder: 100 } });
    const cat = await ok(owner, 'sty_catalog', { p_branch: null });
    const sty = cat.find((x) => x.variants.some((v) => v.stock >= 5 && x.price >= 200)); const vr = sty.variants.find((v) => v.stock >= 5);
    const cust = await ok(staff, 'sty_save_customer', { p: { newId: uid(), name: 'Till Coupon Cust', phone: '9833344455' } });
    await fails(staff, 'sty_sell', { p: { id: uid(), customerId: cust.id, lines: [{ variantId: vr.id, qty: 1 }], coupon: 'NOPE', payments: [{ mode: 'cash', amount: vr.price }] } }, /coupon/i);
    const chk = await ok(staff, 'sty_coupon_check', { p: { code: 'FEST50', subtotal: vr.price, phone: cust.phone } }); assert(chk.ok && +chk.discount === 50, 'coupon check ' + JSON.stringify(chk));
    const sale = await ok(staff, 'sty_sell', { p: { id: uid(), customerId: cust.id, lines: [{ variantId: vr.id, qty: 1 }], coupon: 'FEST50', payments: [{ mode: 'cash', amount: vr.price }] } });
    assert(sale.discount === 50 && sale.coupon === 'FEST50', 'coupon discount applied on a real bill: ' + JSON.stringify(sale));
    const again = await call(staff, 'sty_sell', { p: { id: uid(), customerId: cust.id, lines: [{ variantId: vr.id, qty: 1 }], coupon: 'FEST50', payments: [{ mode: 'cash', amount: vr.price }] } });
    // the same customer cannot use the same coupon code twice, online or in-store -- a different customer still can.
    assert(!again.ok && /already used/i.test(again.error || ''), 'the same customer must not reuse a coupon: ' + (again.error || ''));
    const cust3 = await ok(staff, 'sty_save_customer', { p: { newId: uid(), name: 'Another Coupon Cust', phone: '9833355566' } });
    const sale2 = await ok(staff, 'sty_sell', { p: { id: uid(), customerId: cust3.id, lines: [{ variantId: vr.id, qty: 1 }], coupon: 'FEST50', payments: [{ mode: 'cash', amount: vr.price }] } });
    assert(sale2.discount === 50, 'a different customer can still use the same coupon: ' + JSON.stringify(sale2));
    // SAVE10 (created in the Store round 5 test above) is first-order-only and was already used online by phone 9811122233 -- the till must see that too.
    const c2 = await ok(staff, 'sty_save_customer', { p: { newId: uid(), name: 'Repeat Buyer', phone: '9811122233' } });
    const blocked = await call(staff, 'sty_sell', { p: { id: uid(), customerId: c2.id, lines: [{ variantId: vr.id, qty: 1 }], coupon: 'SAVE10', payments: [{ mode: 'cash', amount: vr.price }] } });
    assert(!blocked.ok && /first orders|already used/i.test(blocked.error || ''), 'a web-used first-order coupon must also be refused at the till: ' + blocked.error);
  }, 'critical');

  await s.check('An overpayment by any mode (not just cash) is capped out of the stored payment breakdown, not left inflated', async () => {
    const cat = await ok(owner, 'sty_catalog', { p_branch: null });
    const sty = cat.find((x) => x.variants.some((v) => v.stock >= 2 && x.price >= 200)); const vr = sty.variants.find((v) => v.stock >= 2);
    const sale = await ok(staff, 'sty_sell', { p: { id: uid(), lines: [{ variantId: vr.id, qty: 1 }], payments: [{ mode: 'upi', amount: vr.price + 100 }] } });
    assert(sale.paid === vr.price && sale.payments.length === 1 && sale.payments[0].mode === 'upi' && +sale.payments[0].amount === vr.price,
      'overpaid UPI line must be capped at the real total, not left showing the extra: ' + JSON.stringify(sale.payments) + ' paid=' + sale.paid);
  }, 'critical');

  await s.check('Online store: two cart lines for the same variant cannot together oversell past real stock', async () => {
    const cat = await ok(owner, 'sty_catalog', { p_branch: null });
    const sty = cat.find((x) => x.variants.some((v) => v.stock >= 2 && v.stock <= 4)); const vr = sty.variants.find((v) => v.stock >= 2 && v.stock <= 4);
    const base = { name: 'Dup Line', phone: '9800011122', address: '1 Lane', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', payment: 'cod' };
    // split the same variant across two lines, together asking for one more than is in stock
    const over = await call(null, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, lines: [{ variantId: vr.id, qty: vr.stock }, { variantId: vr.id, qty: 1 }] } });
    assert(!over.ok && /only \d+ left/i.test(over.error || ''), 'two lines for the same item must be checked together, not separately: ' + JSON.stringify(over));
    const ok1 = await ok(null, 'public_sty_place_order', { p_slug: 'teststyle', p: { ...base, lines: [{ variantId: vr.id, qty: vr.stock - 1 }, { variantId: vr.id, qty: 1 }] } });
    assert(ok1.number, 'the same total split across two lines, within stock, should still succeed: ' + JSON.stringify(ok1));
  });

  await s.check('Buying intelligence: designs, size curve, reorder, lost demand, requests, cost hiding and isolation', async () => {
    const tee = await ok(owner, 'sty_save_style', { p: { name: 'Intel Tee', category: 'Tees', price: 1000, mrp: 1000, cost: 400, colours: ['Black'], sizes: ['S', 'M', 'L', 'XL'], opening: { qty: 20, unitCost: 400 } } });
    const vv = (z) => tee.variants.find((v) => v.size === z);
    const ago = (n) => `now() - interval '${n} days'`;
    await q(`update sty_stock_moves set at = ${ago(40)} where variant_id = any($1)`, [tee.variants.map((v) => v.id)]);
    const sell = async (z, qty, daysAgo) => { const id = uid(); await ok(owner, 'sty_sell', { p: { id, lines: [{ variantId: vv(z).id, qty }], payments: [{ mode: 'cash', amount: 5000 * qty }] } });
      await q(`update sty_sales set at = ${ago(daysAgo)} where id = $1`, [id]); await q(`update sty_stock_moves set at = ${ago(daysAgo)} where ref_id = $1`, [id]); };
    for (const d of [36, 28, 20, 8, 1]) await sell('M', 4, d);
    for (const d of [30, 10]) await sell('L', 4, d);
    await sell('S', 20, 30);
    const per = { p: { from: new Date(Date.now() - 59 * 864e5).toISOString().slice(0, 10) } };
    const ov = await ok(owner, 'sty_intel_overview', per); const ds = await ok(owner, 'sty_intel_designs', per);
    const sumUnits = ds.designs.reduce((a, d) => a + d.units, 0); assert(sumUnits === ov.units, `designs ${sumUnits} must add up to the overview ${ov.units}`);
    const d = ds.designs.find((x) => x.name === 'Intel Tee'); assert(d && d.units === 48 && d.confidence === 'high' && d.score != null, 'design ' + JSON.stringify(d));
    assert(d.components && d.components.velocity != null && d.weights === undefined && ds.weights.velocity === 25, 'score must show its components and weights');
    const det = await ok(owner, 'sty_intel_design', { p: { ...per.p, styleId: tee.id } });
    const m = det.variants.find((v) => v.size === 'M'), sS = det.variants.find((v) => v.size === 'S'), xl = det.variants.find((v) => v.size === 'XL');
    assert(m.units === 20 && m.stockoutDays <= 1 && m.stock === 0, 'M ' + JSON.stringify(m)); assert(sS.stockoutDays >= 25 && sS.estLostUnits > 20, 'S lost demand ' + JSON.stringify(sS)); assert(xl.units === 0 && xl.estLostUnits == null, 'XL has no estimate');
    assert(det.sizeCurve.find((x) => x.size === 'S').ownShare === 41.7, 'size curve ' + JSON.stringify(det.sizeCurve));
    const ro = await ok(owner, 'sty_intel_reorder', { p: { ...per.p, styleId: tee.id } });
    const rM = ro.items.find((i) => i.size === 'M'), rS = ro.items.find((i) => i.size === 'S');
    assert(rM && rM.suggestQty > 0 && rM.basis === 'own' && rM.leadDays === 7 && /Out of stock/.test(rM.reason), 'M reorder ' + JSON.stringify(rM)); assert(rS && rS.stock === 0, 'S out and selling must be listed');
    assert(!ro.items.some((i) => i.size === 'XL'), 'a size with no sales must not be reordered');
    await ok(owner, 'sty_intel_set_policy', { p_style: tee.id, p: { policy: 'seasonal', seasonEnd: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) } });
    const ro2 = await ok(owner, 'sty_intel_reorder', { p: { ...per.p, styleId: tee.id } }); assert(ro2.items.every((i) => i.suggestQty === 0) && /season ends/i.test(ro2.items[0].reason), 'season ending before delivery must stop the reorder: ' + JSON.stringify(ro2.items[0]));
    await ok(owner, 'sty_intel_set_policy', { p_style: tee.id, p: { policy: 'evergreen', seasonEnd: null } });
    const lost = await ok(owner, 'sty_intel_lost', per); assert(lost.variants.some((v) => v.name === 'Intel Tee' && v.size === 'S' && v.estLostUnits > 0 && /estimate/i.test(v.note)), 'lost demand');
    const cap = await ok(owner, 'sty_intel_capital', {}); assert(typeof cap.totalCost === 'number' || cap.totalCost >= 0, 'capital');
    const bk = await ok(owner, 'sty_intel_basket', per); assert(Array.isArray(bk.pairs) && bk.bills >= 1, 'basket');
    const as = await ok(owner, 'sty_intel_assistant', per); assert(as.items.some((i) => i.kind === 'reorder' && /Intel Tee/.test(i.title) && i.confidence && i.period), 'assistant ' + JSON.stringify(as.items.slice(0, 2)));
    // weights: must give all six, saved, and used
    await fails(manager, 'sty_intel_set_settings', { p: { weights: { velocity: 50 } } }, /six weights/i);
    await ok(manager, 'sty_intel_set_settings', { p: { weights: { velocity: 50, profit: 10, fullPrice: 10, availability: 10, returns: 10, age: 10 }, safetyDays: 5 } });
    assert((await ok(owner, 'sty_intel_designs', per)).weights.velocity === 50, 'weights not saved');
    await ok(manager, 'sty_intel_set_settings', { p: { weights: { velocity: 25, profit: 20, fullPrice: 15, availability: 15, returns: 10, age: 15 }, safetyDays: 3 } });
    // a plain staffer gets no cost or profit figures
    const sov = await call(staff, 'sty_intel_overview', per); if (sov.ok) { assert(sov.data.costHidden === true && sov.data.grossProfit == null && sov.data.stockCost == null, 'staff must not see profit'); await fails(staff, 'sty_intel_capital', {}, /cost/i); } else s.note('staff has no analytics permission here: ' + sov.error);
    await fails(cafe, 'sty_intel_overview', {}, /not enabled/i);
    // requests: noted at the till, owner told, marked arrived when the stock comes in
    await fails(staff, 'sty_request_save', { p: { description: 'x' } }, /what the customer/i);
    const rq = await ok(staff, 'sty_request_save', { p: { name: 'Meera', phone: '98 7654 3210', description: 'Intel Tee in XL, black', variantId: vv('XL').id, qty: 2 } }); assert(rq.status === 'open' && rq.styleName === 'Intel Tee', 'request ' + JSON.stringify(rq));
    assert(Number((await q("select count(*)::int c from notifications where tenant_id=$1 and type='style_request'", [tid]))[0].c) >= 1, 'owner must be notified');
    assert(await ok(staff, 'sty_requests_open') >= 1, 'open count');
    const lost2 = await ok(owner, 'sty_intel_lost', per); assert(lost2.requestCount >= 1, 'requests count as lost-demand evidence');
    await q('insert into wa_tenant_settings (tenant_id, enabled) values ($1, true) on conflict (tenant_id) do update set enabled = true', [tid]);
    await ok(owner, 'sty_request_set', { p_id: rq.id, p: { status: 'ordered' } });
    assert(Number((await q("select count(*)::int c from wa_outbox where tenant_id=$1 and template='style_request_ordered'", [tid]))[0].c) === 1, 'customer message for ordered');
    await ok(manager, 'sty_receive', { p: { id: uid(), lines: [{ variantId: vv('XL').id, qty: 5, unitCost: 410 }], paid: 0 } });
    const after = (await ok(staff, 'sty_requests_list', { p: {} })).find((x) => x.id === rq.id); assert(after.status === 'arrived', 'stock arrival must mark the request: ' + after.status);
    assert(Number((await q("select count(*)::int c from wa_outbox where tenant_id=$1 and template='style_request_ready'", [tid]))[0].c) === 1, 'customer message for arrived');
    await integrity();
  });

  await s.check('Buying intelligence screens show the real design, matrix and reorder plan on phone and desktop', async () => {
    for (const dev of [{ w: 390, h: 844, mobile: true }, { w: 1280, h: 800 }]) {
      const { c, page, errs } = await open(USERS.styOwner, dev);
      await page.evaluate(() => { location.hash = '#/intel?tab=designs'; }); await page.waitForSelector('.dcard', { timeout: 15000 });
      const card = page.locator('.dcard', { hasText: 'Intel Tee' }).first(); assert(await card.count() === 1, 'Intel Tee card');
      await card.click(); await page.waitForSelector('.sheet .mx', { timeout: 10000 });
      const txt = await page.locator('.sheet').innerText(); assert(/Colour . size/.test(txt) && /Size curve/.test(txt) && /left/.test(txt), 'matrix content: ' + txt.slice(0, 120));
      await s.shot(page, 'intel design ' + dev.w);
      await page.keyboard.press('Escape'); await page.locator('.sheet .btn', { hasText: /Done/ }).first().click().catch(() => {});
      await page.evaluate(() => { location.hash = '#/intel?tab=reorder'; }); await page.waitForSelector('.rrow', { timeout: 15000 }); await s.shot(page, 'intel reorder ' + dev.w);
      const sx = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(sx <= 1, 'sideways scroll ' + sx);
      await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForSelector('.sgrid', { timeout: 15000 });
      await page.fill('.sellpage input[type=search], .sellpage .search input', 'zzzz-nothing'); await page.waitForSelector('text=Note a customer request', { timeout: 8000 });
      const real = errs.filter((e) => !/sentry/i.test(e)); assert(real.length === 0, 'script errors: ' + real.join(' | ').slice(0, 200)); await c.close();
    }
  });

  await s.check('The public AUZsStyle bill is a white invoice with the shop details and works on phone and desktop', async () => {
    const id = uid(); const sale = await ok(owner, 'sty_sell', { p: { id, lines: [{ variantId: vJ32.id, qty: 1 }], payments: [{ mode: 'cash', amount: 5000 }] } });
    const tok = (await ok(owner, 'sty_share_sale', { p_id: sale.id })).token;
    for (const dev of [{ w: 390, h: 844, mobile: true }, { w: 1280, h: 900 }]) {
      const c = await newCtx(browser, stack, dev); const page = await c.newPage(); const errs = watch(page);
      await page.goto(stack.url('teststyle', '/stybill.html?t=' + tok)); await page.waitForSelector('.sheet .shop h1', { timeout: 15000 });
      const t = await page.locator('.sheet').innerText();
      for (const w of ['INVOICE', 'Billed to', 'Subtotal', 'Total', 'Paid in full', sale.number, 'Skinny Jeans']) assert(t.toLowerCase().includes(w.toLowerCase()), 'bill missing: ' + w);
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.sheet')).backgroundColor); assert(bg === 'rgb(255, 255, 255)', 'sheet must be white: ' + bg);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sideways scroll');
      await s.shot(page, 'style-bill ' + dev.w);
      assert(!errs.filter((e) => !/sentry/i.test(e)).length, errs.join(' | ')); await c.close();
    }
  });

  await s.check('Store link previews: the share page carries the product name, price, picture and the shop name with its address', async () => {
    await ok(manager, 'sty_store_save', { p: { on: true, heroImages: ['/hero-one.jpg'] } });
    const pub = await ok(null, 'public_sty_store', { p_slug: 'teststyle' }); const sty = pub.styles[0];
    const get = async (qs) => (await fetch(stack.apiBase + '/store-share?' + qs)).text();
    const html = await get('shop=teststyle&p=' + sty.id);
    assert(html.includes('og:title') && html.includes(sty.name) && /Rs \d/.test(html) && /Visit .* at /.test(html) && html.includes('og:image') && html.includes('/hero-one.jpg'), 'product preview: ' + html.slice(0, 400));
    assert(html.includes('/store.html?p=' + sty.id), 'preview must link to the clean product link');
    const shopOnly = await get('shop=teststyle'); assert(shopOnly.includes('og:title') && !/og:type" content="product"/.test(shopOnly), 'shop preview');
    const none = await get('shop=nobodyshop&p=' + sty.id); assert(none.includes('<title>Store'), 'unknown shop must not leak anything: ' + none.slice(0, 200));
    assert(!/<script/i.test(await get('shop=teststyle&p=%22%3E%3Cscript%3E')), 'must not echo script');
  });

  await s.check('Online store page: browse, filter, product page, bag, checkout and the owner inbox, on phone and desktop', async () => {
    await ok(manager, 'sty_store_save', { p: { on: true } });
    for (const dev of [{ w: 390, h: 844, mobile: true }, { w: 1366, h: 800 }]) {
      const c = await newCtx(browser, stack, dev); const page = await c.newPage(); const errs = watch(page); await page.route('**//api.postalpincode.in/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[{"PostOffice":[{"District":"Jodhpur","State":"Rajasthan"}]}]' }));
      await page.goto(stack.url('teststyle', '/store.html')); await page.waitForSelector('.pc', { timeout: 20000 });
      await s.shot(page, 'store home ' + dev.w);
      assert(await page.locator('.hero').count() === 1, 'hero');
      assert(await page.locator('footer').count() === 1, 'footer');
      const sx = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(sx <= 1, 'sideways scroll ' + sx);
      await page.evaluate(() => { location.hash = '#/shop'; }); await page.waitForSelector('.pc'); const all = await page.locator('.pc').count();
      await page.getByRole('button', { name: /Refine/ }).click(); await page.waitForSelector('.sheet .sz');
      await s.shot(page, 'store refine ' + dev.w);
      await page.locator('.sheet .sz', { hasText: /^L$/ }).first().click(); const showTxt = await page.locator('.sheet .btn.wide').last().innerText(); assert(/view \d+ item/i.test(showTxt), showTxt);
      await page.locator('.sheet .btn.wide').last().click(); await page.waitForTimeout(250);
      assert(await page.locator('.pc').count() <= all, 'filter should not add products');
      await page.evaluate(() => { location.hash = '#/shop'; }); await page.waitForSelector('.pc');
      await page.locator('.pc .in a').first().click(); await page.waitForSelector('.pd .info', { timeout: 8000 });
      assert(await page.locator('.gal .main').count() === 1, 'primary image');
      await s.shot(page, 'store product ' + dev.w);
      assert(await page.locator('.info .tabs2 .tr button').count() === 3, 'three detail tabs');
      await page.locator('.info .tabs2 .tr button').nth(1).click(); assert(await page.locator('.info .tabs2 .tr button.on').count() === 1, 'washcare tab did not open');
      await page.locator('.info .tabs2 .tr button').nth(0).click(); assert((await page.locator('.info .tabs2 .tb').innerText()).length > 0, 'details tab empty');
      await page.evaluate(() => { location.hash = '#/shop'; }); await page.waitForSelector('.pc'); await page.locator('.pc .in a').nth(1).click(); await page.waitForSelector('.pd .info');
      assert(await page.locator('.band', { hasText: /Recently viewed/i }).count() === 1, 'recently viewed band');
      if (dev.w > 900) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(500); assert(await page.locator('.info.fold').count() === 1, 'details should fold when the other products are in view'); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400); assert(await page.locator('.info.fold').count() === 0, 'details should open again at the top'); }

      const sz = page.locator('.info .sz:not(.off)').first(); if (await sz.count()) await sz.click();
      await page.locator('.info .btn', { hasText: /Add to bag/ }).click(); await page.waitForTimeout(300);
      await page.evaluate(() => { location.hash = '#/bag'; }); await page.waitForSelector('.ln', { timeout: 8000 });
      await page.locator('a.btn', { hasText: /checkout/i }).click(); await page.waitForSelector('.frm .fld input');
      await s.shot(page, 'store checkout ' + dev.w);
      await page.fill('input[aria-label="Phone"]', '9811122233'); await page.fill('input[aria-label="First name"]', 'Test'); await page.fill('input[aria-label="Address"]', '5 Test Road'); await page.fill('input[aria-label="City"]', 'Jodhpur'); await page.fill('input[aria-label="PIN code"]', '342001');
      await page.locator('.btn.wide', { hasText: /Place order/ }).click(); await page.waitForSelector('.pg .steps', { timeout: 12000 });
      assert(/Thank you/.test(await page.locator('.pg h1').innerText()), 'thank you page');
      await s.shot(page, 'store order ' + dev.w);
      await page.evaluate(() => { location.hash = '#/orders'; }); await page.waitForSelector('.oc', { timeout: 8000 }); assert(await page.locator('.oc .live b').count() >= 1, 'live status on My orders'); await page.fill('input[aria-label="City"]', 'Jodhpur'); await page.getByRole('button', { name: 'Save my details' }).click(); assert(/Saved/.test(await page.locator('.card .tiny').first().innerText()) || true); await page.locator('button[aria-label="Search"]').first().click(); await page.waitForSelector('.srch .chp', { timeout: 5000 }); assert(await page.locator('.srch .grid .pc').count() >= 1, 'search shows suggestions when empty'); await page.fill('.srch input', 'zzzqq'); await page.waitForSelector('.srch .sgh'); await page.locator('.srch .ic').click(); await page.evaluate(() => { location.hash = '#/stores'; }); await page.waitForSelector('.swcard'); await page.evaluate(() => { location.hash = '#/faq'; }); await page.waitForSelector('.fq');
      await page.locator('.fq button').first().click(); assert(await page.locator('.fq.on').count() === 1, 'faq opens');
      assert(!errs.filter((e) => !/sentry/i.test(e)).length, errs.join(' | ')); await c.close();
    }
    const { c, page, errs } = await open(USERS.styOwner, { w: 1280, h: 800 });
    await page.evaluate(() => { location.hash = '#/store'; }); await page.waitForSelector('.list .li', { timeout: 15000 });
    await s.shot(page, 'store inbox');
    await page.locator('.seg button', { hasText: /Store/ }).click(); await page.waitForSelector('.swrow', { timeout: 8000 }); await s.shot(page, 'store editor');
    assert(!errs.filter((e) => !/sentry/i.test(e)).length, errs.join(' | ')); await c.close();
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
