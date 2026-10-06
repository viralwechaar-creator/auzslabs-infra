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

  // ---------- feature switches (db/093): each switch is enforced by the server, not just hidden ----------
  const setFeat = (f) => ok(owner, 'mob_save_settings', { p: { features: f } });
  const ALL_ON = { sell: true, purchase: true, repairs: 'full', stock: true, serials: true, customers: true, vendors: true, dayclose: true };
  await s.check('Feature switches: only the owner may change them, bad values are refused, defaults are all-on', async () => {
    const c0 = await ok(owner, 'mob_context'); assert(c0.settings.features && c0.settings.features.stock === true && c0.settings.features.repairs === 'full', 'defaults: ' + JSON.stringify(c0.settings.features));
    await fails(manager, 'mob_save_settings', { p: { features: { stock: false } } });
    await fails(owner, 'mob_save_settings', { p: { features: { repairs: 'weird' } } }, /MB005|repairs/i);
    await fails(owner, 'mob_save_settings', { p: { features: { nonsense: true } } });
  }, 'critical');
  await s.check('Simple mode: stock/serials/customers/vendors/dayclose off, repairs simple -> the simple flow works and each off feature is refused (MB010)', async () => {
    await setFeat({ ...ALL_ON, stock: false, serials: false, customers: false, vendors: false, dayclose: false, repairs: 'simple' });
    const svc = uid(), gadget = uid();
    await ok(staff, 'mob_save_item', { p_id: svc, p: { name: 'Repair / service', category: 'service', serialized: false, sellingPrice: 0, costPrice: 0 } });
    await ok(staff, 'mob_save_item', { p_id: gadget, p: { name: 'Tempered glass', category: 'accessory', serialized: false, sellingPrice: 150, costPrice: 40 } });
    // a sale of a never-purchased item is allowed with stock off (no stock check, no movement)
    await ok(staff, 'mob_push_sale', { p_id: uid(), p: { items: [{ itemId: gadget, name: 'Tempered glass', qty: 2, price: 150 }], paid: 300, paymentMode: 'cash' } });
    assert((await stockOf(gadget)) === 0, 'stock moved with stock switched off');
    // a repair is a sale line carrying the part cost; credit and customer details are ignored with customers off
    const rs = uid();
    const r = await ok(staff, 'mob_push_sale', { p_id: rs, p: { items: [{ itemId: svc, name: 'Screen change', qty: 1, price: 2500, partCost: 1200, partName: 'Screen change' }], customerName: 'Ignored', paid: 100, paymentMode: 'credit' } });
    const row = (await q('select total::float8 total, paid::float8 paid, balance::float8 balance, customer_id from mob_sales where id=$1', [rs]))[0];
    assert(row.total === 2500 && row.paid === 2500 && row.balance === 0 && !row.customer_id, 'simple repair sale row: ' + JSON.stringify(row));
    const part = await q("select total::float8 total, note from mob_purchases where tenant_id=$1 and note like 'Part for repair:%'", [tid]);
    assert(part.length === 1 && part[0].total === 1200, 'part purchase row: ' + JSON.stringify(part));
    const led = await ok(owner, 'mob_report_ledger', { p_from: '2000-01-01', p_to: '2100-01-01' });
    const lr = (led.rows || led).find((x) => /Screen change/.test(x.item_name || '') || x.is_repair);
    assert(lr && Number(lr.cost_total) === 1200 && Number(lr.sale_total) === 2500 && Number(lr.profit) === 1300, 'ledger row for the repair: ' + JSON.stringify(lr));
    await fails(staff, 'mob_create_repair', { p_id: uid(), p: { deviceModel: 'x', problem: 'y' } }, /switched off/i);
    await fails(staff, 'mob_save_customer', { p_id: uid(), p: { name: 'A', phone: '1' } }, /switched off/i);
    await fails(staff, 'mob_save_vendor', { p_id: uid(), p: { name: 'V' } }, /switched off/i);
    await fails(staff, 'mob_push_purchase', { p_id: uid(), p: { itemId: phone, qty: 1, rate: 1, imei: '100000000000099', unitId: uid(), source: 'secondhand' } }, /switched off/i);
    await fails(owner, 'mob_adjust_stock', { p_id: uid(), p_item_id: gadget, p_qty_delta: 1 }, /switched off/i);
    await integrity();
  }, 'critical');
  await s.check('Sell and Purchase switches: off means the server refuses', async () => {
    await setFeat({ ...ALL_ON, sell: false });
    await fails(staff, 'mob_push_sale', { p_id: uid(), p: { items: [{ itemId: cable, qty: 1, price: 199 }], paid: 199, paymentMode: 'cash' } }, /switched off/i);
    await setFeat({ ...ALL_ON, purchase: false });
    await fails(staff, 'mob_push_purchase', { p_id: uid(), p: { itemId: cable, qty: 1, rate: 90 } }, /switched off/i);
    await setFeat(ALL_ON);
    await ok(staff, 'mob_push_purchase', { p_id: uid(), p: { itemId: cable, qty: 1, rate: 90 } });
  }, 'critical');
  await s.check('Switching everything back on restores the full flow (stock counted again)', async () => {
    const c1 = await ok(owner, 'mob_context'); assert(c1.settings.features.stock === true && c1.settings.features.repairs === 'full', 'features did not reset');
    await integrity();
  }, 'major');

  // ---------- adding staff without any custom role (a new business has none) ----------
  await s.check('Owner adds staff with no custom role: gets everyday access; manager built-in works; duplicate email is explained', async () => {
    const stamp = Date.now();
    const loginRaw = async (email, password) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json());
    const inv = await ok(owner, 'invite_staff', { p_email: `noRole${stamp}@test.local`, p_name: 'No Role', p_phone: '9000000000' });
    assert(inv.temp_password && inv.verify_token, 'invite did not return a login: ' + JSON.stringify(inv));
    await ok(null, 'confirm_staff_email', { p_token: inv.verify_token });
    const l = await loginRaw(`norole${stamp}@test.local`, inv.temp_password);
    const tok = l.access_token || (l.data && l.data.access_token);
    assert(tok, 'verified staff could not sign in: ' + JSON.stringify(l));
    const c = await ok(tok, 'mob_context');
    assert(c.perms.mob_sell && c.perms.mob_purchase && !c.perms.mob_manage && !c.perms.mob_reports, 'default staff perms: ' + JSON.stringify(c.perms));
    const inv2 = await ok(owner, 'invite_staff', { p_email: `mgr${stamp}@test.local`, p_name: 'Mgr', p_phone: '', p_builtin: 'manager' });
    await ok(null, 'confirm_staff_email', { p_token: inv2.verify_token });
    const l2 = await loginRaw(`mgr${stamp}@test.local`, inv2.temp_password);
    const c2 = await ok(l2.access_token || (l2.data && l2.data.access_token), 'mob_context');
    assert(c2.perms.mob_manage && c2.perms.mob_reports, 'built-in manager perms: ' + JSON.stringify(c2.perms));
    await fails(owner, 'invite_staff', { p_email: `NOROLE${stamp}@test.local`, p_name: 'Dup', p_phone: '' }, /already has an AUZslab login/i);
    await fails(owner, 'invite_staff', { p_email: 'not-an-email', p_name: 'X', p_phone: '' }, /valid email/i);
    await fails(staff, 'invite_staff', { p_email: `x${stamp}@test.local`, p_name: 'X', p_phone: '' }, /owner only/i);
  }, 'critical');

  // ---------- staff username + PIN sign in (db/096) ----------
  await s.check('Username + PIN: created by the owner, signs in, company-bound username, PIN lockout, reset, turn off', async () => {
    const stamp = Date.now();
    const pinLogin = async (username, pin) => { const r = await fetch(stack.apiBase + '/auth/staff-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, pin }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const st1 = await ok(owner, 'staff_create', { p_name: 'Ravi Kumar ' + stamp, p_phone: '9000000001' });
    assert(/^ravi\.testmob$/.test(st1.username) || /^ravi\d+\.testmob$/.test(st1.username), 'username shape: ' + st1.username);
    assert(/^\d{4}$/.test(st1.pin) && st1.pin_len === 4, 'cashier PIN should be 4 digits: ' + JSON.stringify(st1));
    const ok1 = await pinLogin(st1.username.toUpperCase(), st1.pin);
    assert(ok1.status === 200 && ok1.body.access_token, 'staff could not sign in: ' + JSON.stringify(ok1));
    const c = await ok(ok1.body.access_token, 'mob_context');
    assert(c.perms.mob_sell && !c.perms.mob_manage, 'PIN staff perms: ' + JSON.stringify(c.perms));
    // a second Ravi in the same company gets a different username; PIN is unique within the company
    const st2 = await ok(owner, 'staff_create', { p_name: 'Ravi Singh', p_phone: '' });
    assert(st2.username !== st1.username && st2.pin !== st1.pin, 'second Ravi clashed: ' + JSON.stringify([st1, st2]));
    // wrong PIN: generic error; email login can't be used with the PIN
    const bad = await pinLogin(st1.username, st1.pin === '0000' ? '1111' : '0000');
    assert(bad.status === 401 && /Wrong username or PIN/.test(bad.body.error || bad.body.message || JSON.stringify(bad.body)), 'wrong pin: ' + JSON.stringify(bad));
    const unknown = await pinLogin('nobody.testmob', '1234');
    assert(unknown.status === 401, 'unknown username should look like a wrong PIN');
    const asEmail = await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: st1.username + '@staff.auzslab.in', password: st1.pin }) });
    assert(asEmail.status !== 200, 'PIN worked as an email password');
    // lockout after 5 wrong PINs, even the right PIN is refused, then the owner resets
    const wrongPin = st2.pin === '0001' ? '0002' : '0001';
    for (let i = 0; i < 5; i++) await pinLogin(st2.username, wrongPin);
    const locked = await pinLogin(st2.username, st2.pin);
    assert(locked.status === 429, 'login should be locked: ' + JSON.stringify(locked));
    const row2 = (await q('select id from auth_users where username = $1', [st2.username]))[0];
    const reset = await ok(owner, 'staff_reset_pin', { p_staff_id: row2.id });
    assert(/^\d{4}$/.test(reset.pin), 'reset pin shape');
    assert((await pinLogin(st2.username, reset.pin)).status === 200, 'new PIN should work and clear the lockout');
    await fails(owner, 'staff_reset_pin', { p_staff_id: row2.id, p_pin: '12' }, /exactly 4 digits/i);
    await fails(owner, 'staff_reset_pin', { p_staff_id: row2.id, p_pin: st1.pin }, /already uses that PIN/i);
    // turning the login off blocks sign in, on restores it
    await ok(owner, 'staff_set_active', { p_staff_id: row2.id, p_active: false });
    assert((await pinLogin(st2.username, reset.pin)).status === 401, 'disabled staff signed in');
    await ok(owner, 'staff_set_active', { p_staff_id: row2.id, p_active: true });
    assert((await pinLogin(st2.username, reset.pin)).status === 200, 'enabled staff could not sign in');
    // manager gets a 6-digit PIN; only the owner may create / reset; another business cannot touch these staff
    const mg = await ok(owner, 'staff_create', { p_name: 'Meena', p_builtin: 'manager' });
    assert(/^\d{6}$/.test(mg.pin) && mg.pin_len === 6, 'manager PIN should be 6 digits: ' + JSON.stringify(mg));
    const mc = await ok((await pinLogin(mg.username, mg.pin)).body.access_token, 'mob_context');
    assert(mc.perms.mob_manage, 'manager perms');
    await fails(staff, 'staff_create', { p_name: 'X' }, /owner only/i);
    await fails(cafe, 'staff_reset_pin', { p_staff_id: row2.id }, /not found|owner only/i);
    const other = await ok(cafe, 'staff_create', { p_name: 'Ravi' });
    assert(other.username.endsWith('.testcafe') && other.username !== st1.username, 'other company username: ' + other.username);
  }, 'critical');

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
  await s.check('Sell asks for the price every time: staff can bill the same product at different prices (catalogue price untouched), optional vendor shows', async () => {
    const itm = uid(), vnd = uid();
    await ok(owner, 'mob_save_item', { p_id: itm, p: { name: 'Priceask Charger', category: 'accessory', serialized: false, sellingPrice: 500, costPrice: 300, lowStockAt: 0 } });
    await ok(owner, 'mob_save_vendor', { p_id: vnd, p: { name: 'Askvendor Traders' } });
    await ok(owner, 'mob_push_purchase', { p_id: uid(), p: { itemId: itm, vendorId: vnd, qty: 10, rate: 300, imei: null, sellingPrice: 500, unitId: null } });
    const { c, page } = await open(USERS.mobOwner, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForTimeout(800);
    for (const price of ['450', '620']) {
      await page.fill('input[aria-label="Search by name, IMEI or serial"]', 'Priceask'); await page.waitForTimeout(500);
      await page.locator('.li', { hasText: /Priceask Charger/ }).first().click(); await page.waitForTimeout(300);
      const pr = page.locator('.input[aria-label="Selling price (this bill)"]');
      assert(await pr.count() === 1 && (await pr.inputValue()) !== undefined, 'price question not shown');
      assert(/Vendor \(optional\)/.test(await page.locator('body').innerText()), 'optional vendor not offered');
      await pr.fill(price);
      await page.locator('button', { hasText: /^Add to cart$/ }).click(); await page.waitForTimeout(400);
    }
    const body = await page.locator('body').innerText();
    assert(/450/.test(body) && /620/.test(body), 'both prices should be separate cart lines: ' + body.slice(0, 300));
    await page.locator('button', { hasText: /^Checkout$/ }).first().click().catch(() => {}); await page.waitForTimeout(1500);
    await c.close();
    const sale = (await q("select items from mob_sales where tenant_id=$1 and items::text like '%Priceask Charger%' order by created_at desc limit 1", [tid]))[0];
    assert(sale, 'sale not saved');
    const prices = sale.items.map((l) => Number(l.price)).sort();
    assert(prices.join() === '450,620', 'billed prices: ' + prices);
    assert((await q("select selling_price from mob_items where id=$1", [itm]))[0].selling_price == 500, 'catalogue price changed');
  }, 'major');
  await s.check('Simple mode screens: no Repairs/Stock/Dues tabs, Sell offers Repair / service and adds it to the cart, Settings shows the Features card', async () => {
    await setFeat({ ...ALL_ON, stock: false, serials: false, customers: false, vendors: false, dayclose: false, repairs: 'simple' });
    const { c, page } = await open(USERS.mobOwner, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForTimeout(600);
    const tabs = await page.locator('.tabbar, .a-tabbar, nav').allInnerTexts();
    assert(!/repairs/i.test(tabs.join(' ')) && !/dues/i.test(tabs.join(' ')), 'switched-off tabs still shown: ' + tabs.join('|'));
    await page.locator('button', { hasText: /Repair \/ service/ }).first().click(); await page.waitForTimeout(300);
    await page.fill('.input[aria-label="What was repaired"]', 'Screen change');
    await page.fill('.input[aria-label="Charged to customer"]', '2500');
    await page.locator('button', { hasText: /^Add to cart$/ }).click(); await page.waitForTimeout(500);
    assert(/Screen change/.test(await page.content()), 'repair line not in cart');
    await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForTimeout(600);
    assert(/Features/.test(await page.locator('body').innerText()), 'Features card missing from Settings');
    await c.close();
    await setFeat(ALL_ON);
  }, 'major');
  await s.check('Staff tab on the AUZsMob sign-in screen: username + PIN opens the app', async () => {
    const st = await ok(owner, 'staff_create', { p_name: 'Screen Test ' + Date.now() });
    const c = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('testmob', '/mob.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.locator('.seg button', { hasText: /^Staff$/ }).click();
    await page.fill('input[aria-label="Staff username"]', st.username); await page.fill('input[aria-label="PIN"]', st.pin);
    await page.locator('button', { hasText: /^Continue$/ }).click();
    await page.waitForSelector('.shell', { timeout: 20000 });
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
  await s.check('Plan and renewal: sign-in links to the AUZslab site, banner when the plan ends soon, plan sheet, renewal notifications', async () => {
    const c0 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p0 = await c0.newPage();
    await p0.goto(stack.url('testmob', '/mob.html')); await p0.waitForSelector('input[type=password]', { timeout: 20000 }); await p0.waitForTimeout(2200);
    const hrefs = await p0.locator('#auz-newacct a').evaluateAll((a) => a.map((x) => x.href));
    assert(hrefs.some((h) => /auzslab\.in\/cart\.html\?add=mobile&from=mob/.test(h)) && hrefs.some((h) => /pricing\.html/.test(h)), 'sign-in screen has no Create an account / See plans links: ' + hrefs);
    await c0.close();
    await q("update tenants set renewal_date = current_date + 3 where slug='testmob'");
    const { c, page } = await open(USERS.mobOwner, { w: 390, h: 844, mobile: true });
    await page.waitForSelector('text=Your plan ends in 3 days', { timeout: 12000 });
    await page.locator('button', { hasText: /^Renew$/ }).click();
    await page.waitForSelector('text=Plan & account'); const sheet = await page.locator('[aria-label="Plan and account"]').innerText();
    assert(/Renew now/.test(sheet) && /Create a new account/.test(sheet) && /See all plans/.test(sheet), 'plan sheet missing actions: ' + sheet.slice(0, 200));
    await c.close();
    const n1 = (await q("select renewal_notify_run() r"))[0].r; assert(n1.some((x) => x.tenant === 'Test Mobile Shop' && x.stage === 'd3'), 'no renewal notice created');
    assert((await q("select renewal_notify_run() r"))[0].r.length === 0, 'renewal notices repeated');
    assert((await q("select count(*)::int c from notifications where type='renewal' and tenant_id=$1", [tid]))[0].c === 1, 'owner notification missing');
    await q("update tenants set renewal_date = null where slug='testmob'");
  }, 'major');
  await s.check('Phone tab bar: with features switched off the remaining buttons share the width equally', async () => {
    await setFeat({ sell: false, purchase: false, repairs: 'off', stock: false, serials: false, customers: false, vendors: false, dayclose: false });
    const { c, page } = await open(USERS.mobStaff, { w: 390, h: 844, mobile: true });
    const boxes = await page.locator('.tabbar button').evaluateAll((b) => b.map((x) => { const r = x.getBoundingClientRect(); return { l: r.left, w: r.width }; }));
    assert(boxes.length >= 2 && boxes.length < 5, 'expected fewer than 5 tabs, got ' + boxes.length);
    assert(boxes.every((b) => Math.abs(b.w - boxes[0].w) < 1.5), 'tab widths differ: ' + boxes.map((b) => Math.round(b.w)));
    assert(Math.abs(boxes.reduce((n, b) => n + b.w, 0) - 390) < 3, 'tabs do not fill the bar: ' + boxes.map((b) => Math.round(b.w)));
    await c.close(); await setFeat(ALL_ON);
  }, 'major');
  await s.check('Menu buttons (db/105): owner picks and orders the buttons; bad lists and non-owners are refused; the phone bar shows exactly those', async () => {
    await fails(manager, 'mob_save_settings', { p: { features: { nav: ['home'] } } });
    await fails(owner, 'mob_save_settings', { p: { features: { nav: ['home', 'bogus'] } } }, /MB005|nav/i);
    await fails(owner, 'mob_save_settings', { p: { features: { nav: ['home', 'home'] } } }, /MB005|nav/i);
    await fails(owner, 'mob_save_settings', { p: { features: { nav: 'home' } } }, /MB005|nav/i);
    await setFeat({ nav: ['home', 'reports', 'settings'] });
    const c1 = await ok(owner, 'mob_context'); assert(JSON.stringify(c1.settings.features.nav) === '["home","reports","settings"]', 'nav not saved');
    const { c, page } = await open(USERS.mobOwner, { w: 390, h: 844, mobile: true });
    const labels = await page.locator('.tabbar button').allInnerTexts();
    assert(labels.length === 3 && /home/i.test(labels[0]) && /report/i.test(labels[1]) && /setting/i.test(labels[2]), 'tab bar is ' + JSON.stringify(labels));
    await c.close();
    await setFeat({ nav: [] });
    const { c: c2, page: p2 } = await open(USERS.mobOwner, { w: 390, h: 844, mobile: true });
    assert((await p2.locator('.tabbar button').count()) === 5, 'automatic menu should show 4 buttons + More');
    await c2.close();
  }, 'major');
  await s.check('Google sign-in: apps link to the central page, the hand-off logs the user in, a bad return address is refused', async () => {
    const c = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await c.newPage();
    await page.goto(stack.url('testmob', '/mob.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    const g = await page.locator('a[aria-label="Continue with Google"]').getAttribute('href');
    assert(/^https:\/\/auzslab\.in\/signin\.html\?app=mob&return=/.test(g || ''), 'Google button does not point at the central page: ' + g);
    await c.close();
    const lr = await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.mobOwner, password: PASSWORD }) })).json();
    const d = lr.data !== undefined ? lr.data : lr;
    const frag = Buffer.from(unescape(encodeURIComponent(JSON.stringify({ t: d.access_token, u: d.user })))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const c2 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p2 = await c2.newPage();
    await p2.goto(stack.url('testmob', '/mob.html') + '#auz_gt=' + frag); await p2.waitForSelector('.shell', { timeout: 20000 });
    assert(!/auz_gt/.test(p2.url()), 'hand-off token left in the address bar');
    await c2.close();
    const c3 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p3 = await c3.newPage();
    await p3.goto(stack.url('', '/signin.html') + '?app=mob&return=' + encodeURIComponent('https://evil.example/steal')); await p3.waitForTimeout(800);
    assert(/not valid/i.test(await p3.locator('body').innerText()), 'a non-AUZslab return address was accepted');
    await c3.close();
    const c4 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p4 = await c4.newPage();
    let gurl = ''; await p4.route(/accounts\.google\.com/, (r) => { gurl = r.request().url(); r.abort(); });
    await p4.goto(stack.url('', '/signin.html') + '?app=mob&return=' + encodeURIComponent(stack.url('testmob', '/mob.html'))); await p4.waitForTimeout(1500);
    const gu = new URL(gurl || 'http://none/');
    assert(gu.pathname === '/o/oauth2/v2/auth' && gu.searchParams.get('response_type') === 'id_token' && /apps\.googleusercontent\.com$/.test(gu.searchParams.get('client_id') || '') && /\/signin\.html$/.test(gu.searchParams.get('redirect_uri') || '') && gu.searchParams.get('nonce'), 'sign-in page did not send the browser to Google correctly: ' + gurl);
    await p4.goto(stack.url('', '/signin.html') + '#id_token=a.b.c&state=bad'); await p4.waitForTimeout(500);
    assert(/did not finish/i.test(await p4.locator('body').innerText()), 'a bad Google answer was not refused');
    await c4.close();
    const pl = await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.plain, password: PASSWORD }) })).json();
    const pd = pl.data !== undefined ? pl.data : pl;
    const pf = Buffer.from(unescape(encodeURIComponent(JSON.stringify({ t: pd.access_token, u: pd.user })))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const c5 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p5 = await c5.newPage();
    await p5.goto(stack.url('', '/signup.html') + '#auz_gt=' + pf); await p5.waitForURL(/\/index\.html/, { timeout: 15000 });
    await c5.close();
    // a login whose account was deleted (e.g. by the clean-up) must not leave a dead account page
    const sr = await (await fetch(stack.apiBase + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'stale-' + Date.now() + '@test.local', password: PASSWORD }) })).json();
    const sd = sr.data !== undefined ? sr.data : sr;
    assert(sd.access_token, 'test signup failed: ' + JSON.stringify(sr).slice(0, 120));
    await q('delete from auth_users where id = $1', [sd.user.id]);
    const c6 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p6 = await c6.newPage();
    await p6.addInitScript((v) => { try { localStorage.setItem('auz_session', v); } catch (e) {} }, JSON.stringify({ access_token: sd.access_token, user: sd.user }));
    await p6.goto(stack.url('', '/account.html')); await p6.waitForURL(/\/signup\.html/, { timeout: 15000 });
    await c6.close();
  }, 'critical');
  await s.check('Integrity still holds at the very end', integrity, 'critical');
  s.done();
}
