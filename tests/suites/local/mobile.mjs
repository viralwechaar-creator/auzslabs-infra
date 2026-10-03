// AUZsMob: mobile phone retail & repair shops. Every rule is checked through the real API (as the owner,
// a manager, two staff and another business), the invariants are checked after every stock/money step
// (stock is always sum(movements), a sold unit always has exactly one matching movement, bill numbers are
// unique, staff only ever see their own purchases/sales/repairs through mob_sync_pull), then the screens
// are driven on phone and desktop.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, layoutIssues } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('AUZsMob: catalog, purchases, sales, repairs, dues, staff isolation and screens', 'Runs a real mobile phone shop through stock-in, a sale, a repair job and a settlement, checking every invariant and every access rule, then opens every screen on phone and desktop.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [owner, manager, staff, staff2, cafe] = await Promise.all([USERS.mobOwner, USERS.mobManager, USERS.mobStaff, USERS.mobStaff2, USERS.cafeOwner].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn} refused with the wrong reason: ${r.error}`); return r; };
  const tid = (await q("select id from tenants where slug='testmob'"))[0].id;
  const uid = () => crypto.randomUUID();
  const stockOf = async (itemId) => Number((await q('select coalesce(sum(qty),0)::float8 s from mob_stock_movements where tenant_id=$1 and item_id=$2', [tid, itemId]))[0].s);
  const integrity = async (tok) => { const r = await ok(tok || owner, 'mob_integrity_check'); const bad = r.checks.filter((c) => !c.ok); assert(r.ok, 'mob data out of line: ' + bad.map((c) => c.name + ' (' + c.detail + ')').join('; ')); return r; };

  // ---------- access ----------
  await s.check('Logged out: every AUZsMob call is refused', async () => {
    for (const fn of ['mob_context', 'mob_sync_pull', 'mob_push_sale']) { const r = await call(null, fn, {}); assert(r.status === 401, fn + ' status ' + r.status); }
  }, 'critical');
  await s.check('A business without AUZsMob in its plan is refused server-side', async () => { await fails(cafe, 'mob_context', {}, /not (part|switched|enabled)|not allowed|mobile/i); await fails(cafe, 'mob_sync_pull', {}); }, 'critical');

  // ---------- bootstrap, catalog ----------
  let ctx, phone, cable;
  await s.check('Owner opens AUZsMob: context has full perms and can see purchase rates', async () => {
    ctx = await ok(owner, 'mob_context');
    assert(ctx.perms.mob_manage && ctx.perms.mob_reports, 'owner missing perms: ' + JSON.stringify(ctx.perms));
    assert(ctx.can_see_rates === true, 'owner cannot see rates');
  }, 'critical');
  await s.check('Manager has full perms too; a plain staffer only has the four everyday ones', async () => {
    const m = await ok(manager, 'mob_context'); assert(m.perms.mob_manage && m.perms.mob_reports, 'manager missing perms');
    const st = await ok(staff, 'mob_context');
    assert(st.perms.mob_sell && st.perms.mob_purchase && st.perms.mob_repair && !st.perms.mob_reports && !st.perms.mob_manage, 'staff perms: ' + JSON.stringify(st.perms));
    assert(st.can_see_rates === false, 'staff can see rates by default');
  }, 'critical');
  await s.check('Catalog: owner adds a serialized phone and an accessory', async () => {
    phone = uid(); cable = uid();
    await ok(owner, 'mob_save_item', { p_id: phone, p: { name: 'Galaxy A14', category: 'phone_new', serialized: true, sellingPrice: 14999, costPrice: 12000, lowStockAt: 0 } });
    await ok(owner, 'mob_save_item', { p_id: cable, p: { name: 'USB-C Cable', category: 'accessory', serialized: false, sellingPrice: 199, costPrice: 90, lowStockAt: 5 } });
    const rows = await q('select name, serialized from mob_items where tenant_id=$1 order by name', [tid]);
    assert(rows.length === 2, 'items ' + rows.length);
  }, 'critical');

  // ---------- purchases, IMEI dedup, idempotency ----------
  let unit1, purchase1;
  await s.check('Purchase: staff buys one phone in, serial unit is created and stock moves by 1', async () => {
    purchase1 = uid(); unit1 = uid();
    await ok(staff, 'mob_push_purchase', { p_id: purchase1, p: { itemId: phone, qty: 1, rate: 12000, imei: '100000000000001', sellingPrice: 14999, unitId: unit1 } });
    const u = (await q('select status, imei from mob_item_units where id=$1', [unit1]))[0];
    assert(u && u.status === 'in_stock' && u.imei === '100000000000001', 'unit not created correctly: ' + JSON.stringify(u));
    assert(await stockOf(phone) === 1, 'phone stock ' + (await stockOf(phone)));
  }, 'critical');
  await s.check('Pushing the same purchase id again is a safe no-op (idempotent outbox retry)', async () => {
    const r = await ok(staff, 'mob_push_purchase', { p_id: purchase1, p: { itemId: phone, qty: 1, rate: 12000, imei: '100000000000001', unitId: unit1 } });
    assert(r.already === true, 'retried purchase was not recognised as a duplicate');
    assert(await stockOf(phone) === 1, 'stock moved again on a retried purchase: ' + (await stockOf(phone)));
  }, 'critical');
  await s.check('Duplicate IMEI (same shop, still in stock) is refused by the database', async () => {
    const r = await call(staff, 'mob_push_purchase', { p_id: uid(), p: { itemId: phone, qty: 1, rate: 12000, imei: '100000000000001', unitId: uid() } });
    assert(!r.ok, 'a second in-stock unit with the same IMEI was accepted');
  }, 'critical');
  await s.check('Accessory purchase (no serial) just moves the quantity', async () => {
    await ok(owner, 'mob_push_purchase', { p_id: uid(), p: { itemId: cable, qty: 20, rate: 90 } });
    assert(await stockOf(cable) === 20, 'cable stock ' + (await stockOf(cable)));
  }, 'major');

  // ---------- sell, void ----------
  let sale1;
  await s.check('Sell: the phone is sold, the unit flips to sold and stock drops by 1', async () => {
    sale1 = uid();
    const r = await ok(staff, 'mob_push_sale', { p_id: sale1, p: { items: [{ unitId: unit1, itemId: phone, name: 'Galaxy A14', qty: 1, price: 14999 }], customerName: 'Demo Customer', customerPhone: '9876500000', discount: 0, paid: 10000, paymentMode: 'credit' } });
    assert(r.ok, JSON.stringify(r));
    const u = (await q('select status from mob_item_units where id=$1', [unit1]))[0];
    assert(u.status === 'sold', 'unit not marked sold');
    assert(await stockOf(phone) === 0, 'phone stock after sale ' + (await stockOf(phone)));
    const bill = (await q('select bill_no, balance, total from mob_sales where id=$1', [sale1]))[0];
    assert(bill.bill_no, 'no bill number assigned');
    assert(Math.abs(Number(bill.balance) - 4999) < 0.01, 'balance due ' + bill.balance + ' (14999 paid 10000)');
  }, 'critical');
  await s.check('An already-sold unit cannot be sold again', async () => {
    await fails(staff, 'mob_push_sale', { p_id: uid(), p: { items: [{ unitId: unit1, itemId: phone, name: 'Galaxy A14', qty: 1, price: 14999 }], paid: 14999, paymentMode: 'cash' } }, /not available|sold/i);
  }, 'critical');
  await s.check('A plain staffer cannot void a sale; the owner can, and stock comes back', async () => {
    await fails(staff, 'mob_void_sale', { p_sale_id: sale1 }, /role|not allowed|owner|manager/i);
    await ok(owner, 'mob_void_sale', { p_sale_id: sale1, p_reason: 'Test void' });
    const u = (await q('select status from mob_item_units where id=$1', [unit1]))[0];
    assert(u.status === 'in_stock', 'unit not restored after void');
    assert(await stockOf(phone) === 1, 'stock not restored after void: ' + (await stockOf(phone)));
  }, 'critical');
  await s.check('Re-sell the now-restored phone, this time paid in full, for the dues/report checks below', async () => {
    sale1 = uid();
    await ok(staff, 'mob_push_sale', { p_id: sale1, p: { items: [{ unitId: unit1, itemId: phone, name: 'Galaxy A14', qty: 1, price: 14999 }], customerName: 'Demo Customer', customerPhone: '9876500000', discount: 0, paid: 10000, paymentMode: 'credit' } });
  }, 'critical');

  // ---------- staff isolation (the real enforcement point: mob_sync_pull) ----------
  let staff2Purchase;
  await s.check('Another staffer buys an accessory batch of their own', async () => {
    staff2Purchase = uid();
    await ok(staff2, 'mob_push_purchase', { p_id: staff2Purchase, p: { itemId: cable, qty: 5, rate: 90 } });
  }, 'major');
  await s.check('Staff pull: sees own purchases/sales, not the other staffer’s, but sees the shared catalog', async () => {
    const pull = await ok(staff, 'mob_sync_pull', {});
    assert(pull.items.length >= 2 && pull.units.length >= 1, 'staff cannot see the shared catalog');
    assert(pull.purchases.some((p) => p.id === purchase1) && !pull.purchases.some((p) => p.id === staff2Purchase), 'staff purchases are not isolated: ' + pull.purchases.map((p) => p.id).join(','));
    assert(pull.sales.some((x) => x.id === sale1), 'staff cannot see own sale');
  }, 'critical');
  await s.check('Owner/manager pull (mob_reports): sees every staffer’s purchases and sales', async () => {
    const pull = await ok(owner, 'mob_sync_pull', {});
    assert(pull.purchases.some((p) => p.id === purchase1) && pull.purchases.some((p) => p.id === staff2Purchase), 'owner does not see every staffer’s purchases');
  }, 'critical');
  await s.check('Another business cannot reach this tenant’s AUZsMob data at all', async () => {
    await fails(cafe, 'mob_push_sale', { p_id: uid(), p: { items: [] } });
  }, 'critical');

  // ---------- repairs ----------
  let repair1;
  await s.check('Repair: staff opens a job, adds a part (stock moves), the owner adds a payment, status moves to ready', async () => {
    repair1 = uid();
    // mob_create_repair already writes the opening 'received' status event itself (same as mob_repairs' schema
    // header says) -- pushing a second one here would be testing something the real UI never does.
    await ok(staff, 'mob_create_repair', { p_id: repair1, p: { customerName: 'Walk-in', customerPhone: '9876500001', deviceModel: 'iPhone 11', problem: 'Cracked screen', advance: 500, estimate: 2500, warrantyDays: 30 } });
    const before = await stockOf(cable);
    await ok(staff, 'mob_push_repair_event', { p_id: uid(), p_repair_id: repair1, p: { type: 'part', itemId: cable, qty: 1, cost: 90 } });
    assert(await stockOf(cable) === before - 1, 'part did not decrement stock');
    await ok(owner, 'mob_push_repair_event', { p_id: uid(), p_repair_id: repair1, p: { type: 'payment', amount: 2000, method: 'cash' } });
    await ok(staff, 'mob_push_repair_event', { p_id: uid(), p_repair_id: repair1, p: { type: 'status', status: 'ready' } });
    const events = await q('select type, status from mob_repair_events where repair_id=$1 order by created_at', [repair1]);
    assert(events.filter((e) => e.type === 'status').length === 2 && events.some((e) => e.type === 'part') && events.some((e) => e.type === 'payment'), 'repair events: ' + JSON.stringify(events));
  }, 'critical');
  await s.check('A different staffer cannot add to someone else’s job unless they have mob_reports', async () => {
    await fails(staff2, 'mob_push_repair_event', { p_id: uid(), p_repair_id: repair1, p: { type: 'note', note: 'nope' } }, /not authorized/i);
    await ok(manager, 'mob_push_repair_event', { p_id: uid(), p_repair_id: repair1, p: { type: 'note', note: 'manager can' } });
  }, 'critical');

  // ---------- dues, reports, staff-see-rates ----------
  await s.check('Dues and reports: the open balance shows up for the owner, and reports are owner/manager only', async () => {
    const dash = await ok(owner, 'mob_report_dashboard', {});
    assert(Number(dash.customer_dues) >= 4999 - 0.01, 'customer dues ' + dash.customer_dues);
    assert(Number(dash.repairs_pending) >= 1, 'repairs pending ' + dash.repairs_pending);
    await fails(staff, 'mob_report_dashboard', {}, /role|not allowed|manager|owner/i);
  }, 'critical');
  await s.check('staff_see_purchase_rates: off by default, the owner can turn it on for staff', async () => {
    let st = await ok(staff, 'mob_context'); assert(st.can_see_rates === false, 'staff sees rates before the switch is on');
    await ok(owner, 'mob_save_settings', { p: { staffSeePurchaseRates: true } });
    st = await ok(staff, 'mob_context'); assert(st.can_see_rates === true, 'staff still cannot see rates after the owner turned it on');
    await ok(owner, 'mob_save_settings', { p: { staffSeePurchaseRates: false } });
  }, 'major');
  await s.check('Day close: a sale dated on or before the lock date is refused', async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    await ok(owner, 'mob_save_settings', { p: { dayCloseDate: todayStr } });
    await fails(staff, 'mob_push_sale', { p_id: uid(), p: { items: [{ itemId: cable, qty: 1, price: 199 }], paid: 199, paymentMode: 'cash' } }, /closed|MB003/i);
    await ok(owner, 'mob_save_settings', { p: { dayCloseDate: null } });
  }, 'major');
  await s.check('Export is owner-only and returns every table', async () => {
    const exp = await ok(owner, 'mob_export_all', {});
    assert(Array.isArray(exp.sales) && Array.isArray(exp.purchases) && Array.isArray(exp.repairs), 'export missing tables: ' + Object.keys(exp).join(','));
    await fails(staff, 'mob_export_all', {}, /owner/i);
  }, 'major');
  await s.check('Integrity holds after every step', integrity, 'critical');

  // ---------- screens ----------
  const open = async (email, dev) => {
    const c = await newCtx(browser, stack, dev); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('testmob', '/mob.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 }); await page.waitForTimeout(900);
    return { c, page, errs };
  };
  const pageOk = async (page, errs, hash, label, mobile) => {
    const before = errs.length;
    await page.evaluate((x) => { location.hash = x; }, hash); await page.waitForTimeout(900);
    const body = await page.locator('#main').innerText();
    const out = [];
    if (/Could not load this page|something went wrong/i.test(body)) out.push(label + ': ' + body.split('\n').slice(0, 3).join(' '));
    if (/undefined|NaN|\[object/.test(body)) out.push(label + ': shows undefined/NaN');
    if (/\bnull\b/.test(body) && !/null\)/.test(label)) out.push(label + ': shows a literal "null"');
    if (errs.length > before) out.push(label + ': ' + errs[errs.length - 1].slice(0, 120));
    if (mobile) { const li = await layoutIssues(page); if (li.length) out.push(label + ': ' + li[0]); }
    return out;
  };
  const OWNER_PAGES = [['#/home', 'Home'], ['#/sell', 'Sell'], ['#/sell/history', 'Sale history'], ['#/repairs', 'Repairs'], ['#/repairs/' + repair1, 'Repair detail'],
    ['#/stock', 'Stock catalog'], ['#/stock/units', 'Stock units'], ['#/stock/vendors', 'Stock vendors'], ['#/dues', 'Dues customer'], ['#/dues/vendor', 'Dues vendor'],
    ['#/reports', 'Reports'], ['#/reports?range=week', 'Reports week'], ['#/settings', 'Settings']];
  for (const dev of [{ name: 'phone', w: 390, h: 844, mobile: true }, { name: 'desktop', w: 1366, h: 860 }]) {
    await s.check(`Owner (${dev.name}): every screen opens with no errors, no blanks and no sideways scroll`, async () => {
      const { c, page, errs } = await open(USERS.mobOwner, dev); const bad = [];
      for (const [hash, label] of OWNER_PAGES) bad.push(...(await pageOk(page, errs, hash, label, dev.mobile)));
      await s.shot(page, 'AUZsMob owner ' + dev.name);
      assert(!bad.length, bad.slice(0, 5).join(' | '));
      await c.close();
    }, 'major');
    await s.check(`Staff (${dev.name}): everyday screens open; Reports is not reachable`, async () => {
      const { c, page, errs } = await open(USERS.mobStaff, dev); const bad = [];
      for (const [hash, label] of [['#/home', 'Home'], ['#/sell', 'Sell'], ['#/repairs', 'Repairs'], ['#/stock', 'Stock'], ['#/dues', 'Dues'], ['#/settings', 'Settings']]) bad.push(...(await pageOk(page, errs, hash, label, dev.mobile)));
      const hasReports = await page.locator('a[data-nav=reports]').isVisible().catch(() => false);
      if (hasReports) bad.push('staff can see the Reports nav item');
      await s.shot(page, 'AUZsMob staff ' + dev.name);
      assert(!bad.length, bad.slice(0, 5).join(' | '));
      await c.close();
    }, 'major');
  }
  await s.check('Phone: adding a purchase works end to end through the real UI (the Save-button/null-append regressions)', async () => {
    const { c, page } = await open(USERS.mobOwner, { w: 390, h: 844, mobile: true });
    await page.locator('.big-action', { hasText: /add purchase/i }).click(); await page.waitForTimeout(300);
    await page.fill('input[aria-label="Item name"]', 'Phone test item'); await page.waitForTimeout(250);
    await page.locator('.li', { hasText: /^New:/ }).click(); await page.waitForTimeout(300);
    await page.fill('.input[aria-label="Purchase rate"]', '5000'); await page.fill('.input[aria-label="Selling price"]', '6999');
    await page.fill('.input[aria-label="Qty"]', '3');
    await page.locator('button', { hasText: /^Save$/ }).click(); await page.waitForTimeout(1500);
    const row = (await q("select id from mob_items where tenant_id=$1 and name='Phone test item'", [tid]))[0];
    assert(row, 'purchase item was not saved through the real UI');
    await c.close();
  }, 'critical');
  await s.check('Hindi toggle changes the Settings title, and switches back', async () => {
    const { c, page } = await open(USERS.mobOwner, { w: 1366, h: 860 });
    await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForTimeout(600);
    await page.locator('.seg button', { hasText: 'हिंदी' }).click(); await page.waitForTimeout(300);
    assert(/सेटिंग्स/.test(await page.content()), 'Hindi label did not render anywhere on the Settings page');
    await page.locator('.seg button', { hasText: 'English' }).click(); await page.waitForTimeout(300);
    await c.close();
  }, 'major');
  await s.check('Integrity still holds at the very end', integrity, 'critical');
  s.done();
}
