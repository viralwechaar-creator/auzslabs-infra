// POS: the full restaurant flow on the rebuilt POS (tables, order, kitchen, payment), the features added from the
// audit (charges, approvals, table moves, splits, reservations, register, gift cards) and the server rules that
// protect bills (db/068). Each check drives the real screens and then reads the database to confirm.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('POS workflow: tables, order, kitchen, payment, approvals, register', 'Takes real orders through the rebuilt staff POS and checks the screens, the database and the audit log agree at every hand-over.');
  const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  const orders = () => q("select id, data from records where tenant_id=$1 and kind='order' and not deleted", [tid]).then((r) => r.map((x) => ({ ...x.data, _id: x.id })));
  const kots = () => q("select data from records where tenant_id=$1 and kind='kotlog'", [tid]).then((r) => r.map((x) => x.data));
  const audit = (action) => q('select * from pos_audit where tenant_id=$1 and action=$2 order by id', [tid, action]);
  const until = async (fn, ms = 12000) => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > ms) return false; await page.waitForTimeout(250); } };
  const text = () => page.locator('body').innerText();
  const nav = async (k) => { await page.locator('[data-nav="' + k + '"]').click(); await page.waitForTimeout(500); };
  const tile = (name) => page.locator('.items .tile', { hasText: name }).first();
  const pane = page.locator('.ticket-pane');
  const custFill = async (name, phone) => { await pane.locator('input[aria-label="Customer name"]').fill(name); await pane.locator('input[aria-label="Phone"]').fill(phone); };
  const sheetBtn = (re) => page.locator('.md button', { hasText: re }).last();
  const payCashExact = async () => { await pane.locator('button', { hasText: /^Pay$/ }).click(); await page.waitForTimeout(400); await page.locator('.alert button', { hasText: 'Take payment' }).click({ timeout: 800 }).catch(() => {}); await sheetBtn(/^Cash$/).click(); await page.waitForTimeout(300); await sheetBtn(/^Exact/).click(); await page.waitForTimeout(300); await sheetBtn(/^Complete/).click(); await page.waitForTimeout(900); await page.locator('.md-h .btn', { hasText: /^Done$/ }).last().click().catch(() => {}); await page.waitForTimeout(300); };
  const freshOrder = async (extra) => { await page.evaluate((x) => { S.cur = newOrder(x); go('sell'); }, extra); await page.waitForTimeout(400); };
  const syncClient = () => page.evaluate(() => syncNow());
  const addRec = (id, kind, data) => q('insert into records (id, tenant_id, kind, data) values ($1,$2,$3,$4) on conflict (tenant_id, id) do update set data = excluded.data, deleted = false', [id, tid, kind, JSON.stringify({ id, ...data })]);

  await s.check('Staff sign-in opens the POS on the tables screen', async () => {
    await page.goto(stack.url('testcafe', '/index.html')); await page.waitForSelector('input[type=password]');
    await page.fill('input[type=email]', USERS.cafeOwner); await page.fill('input[type=password]', PASSWORD); await page.locator('button', { hasText: /sign in/i }).last().click();
    await page.waitForSelector('.tbl-tile', { timeout: 15000 });
  }, 'critical');
  await s.shot(page, 'pos-tables-desktop');

  await s.check('Send to kitchen: the order and its numbered KOT reach the server, with nothing left to sync', async () => {
    await page.locator('.tbl-tile').first().click(); await page.waitForSelector('.items .tile');
    await tile('Chicken 65').click(); await tile('Chicken 65').click();
    await custFill('Workflow Guest', '9811122233');
    await pane.locator('button', { hasText: 'Send to kitchen' }).click();
    assert(await until(async () => (await orders()).length === 1 && (await kots()).length === 1), 'order and kotlog did not both sync');
    assert((await kots())[0].kotNo === '1', 'KOT number is ' + (await kots())[0].kotNo);
    await page.waitForTimeout(1200); const t = await page.locator('#net').innerText(); assert(/Synced/.test(t), 'status says: ' + t);
  }, 'critical');
  await s.shot(page, 'pos-sell-desktop');

  await s.check('Kitchen screen shows the order; start preparing, then ready', async () => {
    await nav('kitchen'); const t = await text(); assert(/TC-\d+/.test(t) && /2× Chicken 65/.test(t), 'order not on the kitchen screen');
    await page.locator('button', { hasText: 'Start preparing' }).first().click(); await page.waitForTimeout(600);
    await page.locator('button', { hasText: 'Food is ready' }).first().click();
    assert(await until(async () => (await orders())[0].kstat === 'ready'), 'ready did not reach the server');
  }, 'critical');

  await s.check('Paying with the one-tap "Exact" cash button completes the sale', async () => {
    await nav('sell'); await payCashExact();
    assert(await until(async () => (await orders())[0].status === 'paid'), 'order was not marked paid');
    assert((await audit('bill_paid')).length === 1, 'no bill_paid audit row');
  }, 'critical');

  await s.check('A paid order does not come back to the kitchen and is not "ready to serve"', async () => {
    const o = (await orders())[0];
    assert(o.kstat === 'ready' || o.kstat === 'served', 'kitchen status was reset to "' + o.kstat + '" by payment');
    assert(o.readyAt && o.preparingAt, 'the kitchen timestamps were wiped by payment');
    await nav('kitchen'); assert(/No orders waiting/.test(await text()), 'paid order is back on the kitchen screen');
    assert(!(await page.locator('[data-banner="ready"]').count()), 'a paid, served order is still in the ready banner');
  }, 'critical');

  await s.check('A "Waiter called" alert is acknowledged once, without opening an empty order', async () => {
    await q("insert into guest_orders (tenant_id, tbl, name, phone, note, items) values ($1,'tbl-1','Table 1','','Waiter called','[]'::jsonb)", [tid]);
    const before = (await orders()).length;
    assert(await until(async () => /Got it/.test(await text()), 20000), 'waiter call never showed on the POS');
    await page.locator('button', { hasText: 'Got it' }).first().click();
    assert(await until(async () => (await q("select status from guest_orders where tenant_id=$1 and note='Waiter called'", [tid]))[0].status === 'done'), 'waiter call not marked done');
    assert((await orders()).length === before, 'acknowledging a waiter call created an empty order');
  });

  await s.check('A QR order is claimed by one till only (the second claim is refused)', async () => {
    const tok = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token;
    const [{ id }] = await q("insert into guest_orders (tenant_id, tbl, name, phone, items, status) values ($1,'tbl-1','Q','9','[]'::jsonb,'rejected') returning id", [tid]);
    await q("update guest_orders set status='new' where id=$1", [id]);
    const a = await rpc(stack, 'claim_guest_order', { p_id: id, p_status: 'done' }, tok), b = await rpc(stack, 'claim_guest_order', { p_id: id, p_status: 'done' }, tok);
    assert(a.data && a.data.data === true && b.data && b.data.data === false, 'claims: ' + JSON.stringify([a.data, b.data]));
  }, 'major');

  await s.check('The selling screen is not rebuilt every second (taps and typing survive)', async () => {
    await nav('sell'); await page.evaluate(() => { window.__marker = document.querySelector('.items'); });
    await page.waitForTimeout(3500);
    assert(await page.evaluate(() => window.__marker === document.querySelector('.items')), 'the item grid was replaced within 3.5 s');
  }, 'major');

  await s.check('Advance order: schedule for later, it waits under "Advance orders" and in the live counts', async () => {
    await freshOrder({ type: 'Takeaway' });
    await tile('Paneer Tikka').click(); await custFill('Advance Guest', '9822233344');
    await pane.locator('button[aria-label="Order actions"]').click(); await page.waitForTimeout(300);
    await page.locator('.md button.li', { hasText: 'Schedule for later' }).click(); await page.waitForTimeout(300);
    await sheetBtn(/^Save$/).click(); await page.waitForTimeout(300);
    await pane.locator('button', { hasText: /^Hold$/ }).click();
    assert(await until(async () => (await orders()).some((o) => o.adv && o.status === 'open')), 'the scheduled order did not reach the server with its time');
    await nav('orders'); const t = await text();
    assert(/Advance orders \(1\)/.test(t), 'no "Advance orders" section'); assert(/Running orders/.test(t) && /Out for delivery/.test(t), 'live counts missing');
  }, 'major');

  await addRec('tbl-2', 'table', { name: 'T2', sec: 'Main', seats: 4 }); await addRec('tbl-3', 'table', { name: 'T3', sec: 'Main', seats: 6 });
  await s.check('Charges set in the console are billed: service charge on dine-in, packing on takeaway, with GST on them', async () => {
    await q("update records set data = data || '{\"serviceChargePct\":10,\"packingCharge\":20}' where tenant_id=$1 and id='settings'", [tid]); await syncClient();
    await freshOrder({ type: 'Dine-in', table: 'tbl-2' }); await page.locator('.cats [data-cat="cat-start"]').click(); await tile('Paneer Tikka').click();
    const t = await page.evaluate(() => tot(S.cur));
    assert(t.svc === 28 && t.tax === 15.4 && t.total === 323, 'dine-in total ' + JSON.stringify(t));
    assert(/Service charge 10%/.test(await pane.innerText()), 'service charge row not on the ticket');
    await custFill('Charge Guest', '9833344455'); await pane.locator('button', { hasText: /^Hold$/ }).click();
    assert(await until(async () => (await orders()).some((o) => o.table === 'tbl-2' && o.t && o.t.svc === 28 && o.t.total === 323)), 'held order did not store the service charge');
    await freshOrder({ type: 'Takeaway' }); await tile('Paneer Tikka').click();
    const t2 = await page.evaluate(() => tot(S.cur)); assert(t2.pack === 20 && t2.total === 315, 'takeaway total ' + JSON.stringify(t2));
    await q("update records set data = data - 'serviceChargePct' - 'packingCharge' where tenant_id=$1 and id='settings'", [tid]); await syncClient();
    await page.evaluate(() => { S.cur = null; });
  }, 'major');

  await s.check('Move a table: the order follows to the new table and the move is in the audit log', async () => {
    await nav('tables'); await page.locator('.tables .tbl-tile[data-table="tbl-2"]').click(); await page.waitForTimeout(500);
    await pane.locator('button[aria-label="Order actions"]').click(); await page.waitForTimeout(300);
    await page.locator('.md button.li', { hasText: 'Move to another table' }).click(); await page.waitForTimeout(400);
    await page.locator('.md .tbl-tile[data-table="tbl-3"]').click();
    assert(await until(async () => (await orders()).some((o) => o.table === 'tbl-3' && o.status === 'open')), 'order did not move to T3');
    assert(await until(async () => (await audit('table_move')).length === 1), 'no table_move audit row');
  }, 'major');

  await s.check('Split a bill after the kitchen has it: a separate bill is created and the server accepts the move', async () => {
    await tile('Paneer Tikka').click(); await pane.locator('button', { hasText: 'Send to kitchen' }).click();
    assert(await until(async () => (await orders()).some((o) => o.table === 'tbl-3' && o.lines[0].sent === 2)), 'second item was not sent');
    await pane.locator('button[aria-label="Order actions"]').click(); await page.waitForTimeout(300);
    await page.locator('.md button.li', { hasText: 'Split bill' }).click(); await page.waitForTimeout(400);
    await page.locator('.md .stepper button[aria-label="More"]').first().click(); await sheetBtn(/^Split$/).click();
    const paySheet = page.locator('.md', { hasText: 'Split equally' }); await paySheet.waitFor({ timeout: 8000 }); // the new bill opens straight in payment
    await paySheet.locator('.md-h .btn', { hasText: 'Cancel' }).click(); await page.waitForTimeout(400);
    assert(await until(async () => { const os = (await orders()).filter((o) => o.status === 'open' && (o.table === 'tbl-3' || o.kfrom)); return os.length === 2 && os.every((o) => o.lines.reduce((a, l) => a + l.qty, 0) === 1); }), 'the split did not leave two bills of one item each');
    assert(await until(async () => (await audit('items_moved')).length === 1), 'no items_moved audit row');
    assert(!(await audit('kot_cancel')).length, 'the split was logged as a cancellation');
  }, 'major');

  await s.check('Reservations: book a table, the same table cannot be double-booked, seating opens the order', async () => {
    await nav('reserve'); await page.locator('button', { hasText: 'New reservation' }).click(); await page.waitForTimeout(300);
    await page.fill('.md input[placeholder="Guest name"]', 'Reserved Guest'); await page.fill('.md input[placeholder="10-digit mobile"]', '9844455566');
    await page.fill('.md input[type=time]', '21:00'); await page.locator('.md select').selectOption('tbl-2'); await sheetBtn(/^Reserve$/).click();
    assert(await until(async () => (await q("select count(*)::int n from bookings where tenant_id=$1 and party_size=2 and resource_id='tbl-2' and status='confirmed'", [tid]))[0].n === 1), 'reservation not stored');
    await page.locator('button', { hasText: 'New reservation' }).click(); await page.waitForTimeout(300);
    await page.fill('.md input[placeholder="Guest name"]', 'Clash Guest'); await page.fill('.md input[placeholder="10-digit mobile"]', '9855566677');
    await page.fill('.md input[type=time]', '21:30'); await page.locator('.md select').selectOption('tbl-2'); await sheetBtn(/^Reserve$/).click(); await page.waitForTimeout(800);
    assert(/already reserved/.test(await text()), 'no double-booking message'); await page.locator('.md-h .btn', { hasText: 'Cancel' }).last().click();
    assert((await q("select count(*)::int n from bookings where tenant_id=$1 and resource_id='tbl-2'", [tid]))[0].n === 1, 'a clashing reservation was stored');
    await page.locator('.li', { hasText: 'Reserved Guest' }).click(); await page.waitForTimeout(300); await page.locator('.md button.li', { hasText: 'Seat now' }).click(); await page.waitForTimeout(800);
    assert(await page.evaluate(() => S.cur && S.cur.table === 'tbl-2' && S.cur.covers === 2 && !!S.cur.resId), 'seating did not open an order for T2 with the party size');
    assert(await until(async () => (await q("select status from bookings where tenant_id=$1 and customer_name='Reserved Guest'", [tid]))[0].status === 'seated'), 'booking not marked seated');
    await page.evaluate(() => { S.cur = null; });
  }, 'major');

  await s.check('Register: open with a float, a cash sale, a cash out, and the close records the shortfall', async () => {
    await nav('register'); await page.fill('input[aria-label="Opening float"]', '1000'); await page.locator('button', { hasText: 'Open register' }).click();
    assert(await until(async () => (await q("select count(*)::int n from records where tenant_id=$1 and kind='register'", [tid]))[0].n === 1), 'register not opened');
    await freshOrder({ type: 'Takeaway' }); await page.locator('.cats [data-cat="cat-drink"]').click(); await tile('Masala Tea').click(); await page.waitForTimeout(300);
    await page.locator('.md .li', { hasText: 'Full' }).click(); await sheetBtn(/^Add/).click(); await custFill('Tea Guest', '9866677788'); await payCashExact();
    await nav('register'); await page.locator('button', { hasText: 'Cash out' }).click(); await page.fill('.md input[aria-label="Amount"]', '100'); await sheetBtn(/^Record$/).click(); await page.waitForTimeout(500);
    const exp = await page.evaluate(() => registerSummary(currentRegister()).expected); assert(exp === 942, 'expected cash ' + exp + ', wanted 1000 + 42 − 100');
    await page.locator('button', { hasText: 'Close register' }).click(); await page.waitForTimeout(300);
    await page.locator('.alert button', { hasText: 'Close anyway' }).click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(300);
    await page.fill('.md input[aria-label="Counted total"]', '932'); await sheetBtn(/^Close register$/).click();
    assert(await until(async () => { const r = (await q("select data from records where tenant_id=$1 and kind='register'", [tid]))[0].data; return r.closedAt && r.variance === -10 && r.expected === 942; }), 'register close did not store expected 942 / variance −10');
    assert((await audit('register_close')).length === 1 && (await audit('cash_out')).length === 1, 'register close or cash out missing from the audit log');
    await page.locator('.md-h .btn', { hasText: 'Done' }).last().click().catch(() => {});
  }, 'major');

  await s.check('Gift card tender: the balance is redeemed on the server and the rest paid in cash', async () => {
    await addRec('gc-1', 'giftcard', { code: 'GIFT100', amt: 100, bal: 100 }); await syncClient();
    await freshOrder({ type: 'Takeaway' }); await page.locator('.cats [data-cat="cat-start"]').click(); await tile('Paneer Tikka').click(); await custFill('Gift Guest', '9877788899');
    await pane.locator('button', { hasText: /^Pay$/ }).click(); await page.waitForTimeout(400);
    await sheetBtn(/^Gift card$/).click(); await page.fill('.md input[aria-label="Gift card code"]', 'gift100'); await page.waitForTimeout(200); await sheetBtn(/^Use card$/).click(); await page.waitForTimeout(800);
    await sheetBtn(/^Cash$/).click(); await sheetBtn(/^Exact/).click(); await page.waitForTimeout(300); await sheetBtn(/^Complete/).click(); await page.waitForTimeout(900);
    await page.locator('.md-h .btn', { hasText: /^Done$/ }).last().click().catch(() => {});
    assert(await until(async () => +(await q("select data->>'bal' b from records where tenant_id=$1 and id='gc-1'", [tid]))[0].b === 0), 'gift card balance not reduced to 0');
    assert(await until(async () => (await orders()).some((o) => o.status === 'paid' && (o.pays || []).some((p) => p.m === 'giftcard' && p.amt === 100))), 'paid bill has no gift card payment');
  }, 'major');

  // ---------- a cashier, a manager PIN, and the server rules ----------
  await q("insert into auth_users (email, password_hash, app_metadata) values ('cashier-cafe@test.local', crypt($1, gen_salt('bf', 4)), jsonb_build_object('tenant_id', $2::text, 'role', 'cashier')) on conflict do nothing", [PASSWORD, tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const ownerTok = await login(USERS.cafeOwner), cashTok = await login('cashier-cafe@test.local');

  await s.check('An owner sets an approval PIN; a cashier cannot', async () => {
    const a = await rpc(stack, 'pos_set_pin', { p_pin: '2468' }, ownerTok), b = await rpc(stack, 'pos_set_pin', { p_pin: '1357' }, cashTok);
    assert(a.status === 200, 'owner could not set a PIN: ' + JSON.stringify(a.data)); assert(b.status === 403, 'cashier set a PIN: ' + b.status);
  }, 'critical');

  const cctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const cp = await cctx.newPage(); const cerrs = watch(cp);
  await s.check('A cashier\'s 20% discount needs the manager PIN, and the paid bill carries the approval', async () => {
    await cp.goto(stack.url('testcafe', '/index.html')); await cp.waitForSelector('input[type=password]');
    await cp.fill('input[type=email]', 'cashier-cafe@test.local'); await cp.fill('input[type=password]', PASSWORD); await cp.locator('button', { hasText: /sign in/i }).last().click();
    await cp.waitForSelector('[data-nav="sell"]', { timeout: 15000 });
    await cp.evaluate(() => { S.cur = newOrder({ type: 'Takeaway' }); go('sell'); }); await cp.waitForTimeout(500);
    await cp.locator('.cats [data-cat="cat-start"]').click(); await cp.locator('.items .tile', { hasText: 'Paneer Tikka' }).first().click();
    const cpane = cp.locator('.ticket-pane'); await cpane.locator('input[aria-label="Customer name"]').fill('Discount Guest'); await cpane.locator('input[aria-label="Phone"]').fill('9888899900');
    await cpane.locator('.tk-sum button', { hasText: 'Add discount' }).click(); await cp.fill('.md input[aria-label="Discount"]', '20'); await cp.locator('.md button', { hasText: /^Apply$/ }).last().click(); await cp.waitForTimeout(500);
    assert(/Approve discount/.test(await cp.locator('body').innerText()), 'no approval sheet for a cashier discount');
    for (const d of '1111') await cp.locator('.md .keypad button', { hasText: new RegExp('^' + d + '$') }).click();
    await cp.locator('.md button', { hasText: /^Approve$/ }).click(); await cp.waitForTimeout(800);
    assert(/not right/.test(await cp.locator('body').innerText()), 'a wrong PIN was not refused');
    for (const d of '2468') await cp.locator('.md .keypad button', { hasText: new RegExp('^' + d + '$') }).click();
    await cp.locator('.md button', { hasText: /^Approve$/ }).click(); await cp.waitForTimeout(800);
    assert(await cp.evaluate(() => S.cur.disc && S.cur.disc.v === 20 && !!S.cur.disc.approvedBy && !!S.cur.disc.approvedBy.token), 'discount not applied with a signed approval');
    await cpane.locator('button', { hasText: /^Pay$/ }).click(); await cp.waitForTimeout(400); await cp.locator('.md button', { hasText: /^Cash$/ }).last().click(); await cp.locator('.md button', { hasText: /^Exact/ }).last().click(); await cp.waitForTimeout(300); await cp.locator('.md button', { hasText: /^Complete/ }).last().click();
    assert(await until(async () => (await orders()).some((o) => o.status === 'paid' && o.disc && o.disc.v === 20)), 'the approved bill was not accepted by the server');
    assert(await until(async () => (await audit('discount')).some((a) => a.approved_by === USERS.cafeOwner)), 'audit log does not name the approving owner');
  }, 'critical');

  await s.check('Server refuses a cashier\'s unapproved over-limit discount, even when sent directly', async () => {
    const r = await rpc(stack, 'push_record', { rid: 'evil-disc', rkind: 'order', rdata: { id: 'evil-disc', status: 'paid', t: { sub: 1000, d: 500, tax: 25, total: 525 }, disc: { t: '%', v: 50 }, lines: [] }, rdeleted: false, base: null, force: true }, cashTok);
    assert(r.status === 403, 'status ' + r.status); assert(!(await q("select 1 from records where id='evil-disc'")).length, 'the order was stored');
  }, 'critical');
  await s.check('Server refuses a cashier overwriting the business settings through the sync function', async () => {
    const r = await rpc(stack, 'push_record', { rid: 'settings', rkind: 'order', rdata: { id: 'settings', hacked: true }, rdeleted: false, base: null, force: true }, cashTok);
    const st = (await q("select kind, data->>'name' n from records where tenant_id=$1 and id='settings'", [tid]))[0];
    assert(r.status === 403 && st.kind === 'settings' && st.n === 'Test Cafe', 'settings were overwritten: ' + JSON.stringify(st));
  }, 'critical');
  await s.check('A paid bill cannot be rewritten or refunded by a cashier without approval', async () => {
    const paid = (await orders()).find((o) => o.status === 'paid' && o.no);
    const stale = { ...paid, lines: [{ id: 'x', name: 'x', price: 1, qty: 1, sent: 0 }], t: { sub: 1, d: 0, tax: 0, round: 0, total: 1 }, pays: [] }; delete stale._id;
    await rpc(stack, 'push_record', { rid: paid.id, rkind: 'order', rdata: stale, rdeleted: false, base: null, force: true }, cashTok);
    const now = (await orders()).find((o) => o.id === paid.id); assert(now.t.total === paid.t.total && now.lines.length === paid.lines.length, 'a stale copy rewrote the paid bill');
    const ref = { ...now, refunds: [{ amt: 10, reason: 'x', at: new Date().toISOString(), m: 'cash' }] }; delete ref._id;
    const r = await rpc(stack, 'push_record', { rid: paid.id, rkind: 'order', rdata: ref, rdeleted: false, base: null, force: true }, cashTok);
    assert(r.status === 403, 'unapproved refund status ' + r.status);
  }, 'critical');
  await s.check('A cashier marking a table for cleaning syncs (it used to be refused)', async () => {
    await cp.evaluate(async () => { const t = rec('tbl-3'); await save('table', { ...t, cleaned: false }, t.id); await syncNow(); });
    assert(await until(async () => (await q("select data->>'cleaned' c from records where tenant_id=$1 and id='tbl-3'", [tid]))[0].c === 'false'), 'cleaning flag did not reach the server');
    assert(!(await cp.locator('#net').innerText()).includes('problem'), 'sync problem shown');
  }, 'major');
  await s.check('No JavaScript errors on the cashier till', async () => { const bad = cerrs.filter((e) => !/print|WebSocket|ERR_CERT|tunnel/i.test(e)); assert(!bad.length, bad.slice(0, 3).join(' | ')); }, 'major');
  await cctx.close();

  await s.check('Phone: every POS screen fits the width and shows the tab bar', async () => {
    const pctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const pp = await pctx.newPage();
    await pp.goto(stack.url('testcafe', '/index.html')); await pp.waitForSelector('input[type=password]');
    await pp.fill('input[type=email]', USERS.cafeOwner); await pp.fill('input[type=password]', PASSWORD); await pp.locator('button', { hasText: /sign in/i }).last().click();
    await pp.waitForSelector('.tabbar', { timeout: 15000 });
    const bad = [];
    for (const k of ['tables', 'sell', 'orders', 'kitchen', 'reserve', 'register', 'more']) {
      await pp.evaluate((x) => go(x), k); await pp.waitForTimeout(400);
      const w = await pp.evaluate(() => { const b = document.querySelector('#body'); return [b.scrollWidth, b.clientWidth, [...b.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.chips,.seg,.strip')).length]; });
      if (w[0] > w[1] + 2 || w[2]) bad.push(k + ' ' + w.join('/'));
      if (k === 'sell' || k === 'orders') await s.shot(pp, 'pos-' + k + '-phone');
    }
    assert(!bad.length, 'overflowing: ' + bad.join(', '));
    await pctx.close();
  }, 'major');

  await s.check('Cash drawer (admin console): a top-up and a withdrawal reach the server and show on Withdrawals & Top-ups', async () => {
    const before = (await q("select data from records where tenant_id=$1 and kind='cashmove'", [tid])).length;
    await page.goto(stack.url('testcafe', '/dashboard.html#fin/withdrawals')); await page.waitForSelector('button:has-text("Cash top-up")', { timeout: 15000 }); await page.waitForTimeout(800);
    const fillAmount = async (amt) => { await page.locator('.fld', { hasText: 'Amount' }).locator('input').fill(amt); await page.locator('.mf button.p, .mf button:has-text("Save")').first().click(); await page.waitForTimeout(700); };
    await page.locator('button', { hasText: 'Cash top-up' }).first().click(); await page.waitForTimeout(400); await fillAmount('500');
    await page.locator('button', { hasText: /^Withdrawal$|^\s*Withdrawal/ }).first().click(); await page.waitForTimeout(400); await fillAmount('120');
    assert(await until(async () => (await q("select data from records where tenant_id=$1 and kind='cashmove'", [tid])).length === before + 2), 'cash movements did not reach the server');
    const t = await text(); assert(/\+₹500/.test(t) && /−₹120/.test(t), 'Withdrawals & Top-ups does not show the top-up and withdrawal');
  }, 'major');

  await s.check('Menu (admin console): select items and raise their prices by 10 percent; each change is audited', async () => {
    await page.goto(stack.url('testcafe', '/dashboard.html#menu/items')); await page.waitForSelector('button:has-text("Items"), .content', { timeout: 15000 }); await page.waitForTimeout(1200);
    const prices = () => q("select data->>'name' n, (data->>'price')::numeric p from records where tenant_id=$1 and kind='item' and not deleted order by 1", [tid]).then((r) => r.map((x) => x.n + ':' + +x.p));
    const before = await prices();
    page.removeAllListeners('dialog'); page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('10') : d.accept()).catch(() => {}));
    const hdr = page.locator('input[type=checkbox]').first(); await hdr.check({ force: true }); await page.waitForTimeout(400);
    assert(/\d+ selected/.test(await text()), 'no selection bar appeared');
    await page.locator('button', { hasText: 'Price +%' }).click(); await page.waitForTimeout(500);
    const ok = page.locator('.md button, .alert button, button.p', { hasText: /^(Yes|OK|Confirm|Increase|Apply|Continue)/ }).last(); if (await ok.count()) await ok.click().catch(() => {});
    assert(await until(async () => { const a = await prices(); return a.join() !== before.join(); }), 'prices did not change');
    const after = await prices(), b0 = before.map((x) => +x.split(':')[1]), a0 = after.map((x) => +x.split(':')[1]);
    assert(a0.some((v, i) => Math.abs(v - Math.round(b0[i] * 110) / 100) < 0.011 && v > b0[i]), 'no price rose by 10%');
    assert(await until(async () => (await audit('price_change')).length >= 1), 'price changes are not in the audit log');
  }, 'major');

  await s.check('One admin console: the old Back Office address forwards to it, the POS shows a single "Admin console" and no "Back office", and the Hardware switches live in the console', async () => {
    await page.goto(stack.url('testcafe', '/backoffice.html?tab=rep')); await page.waitForURL(/dashboard\.html#rep\/sales/, { timeout: 15000 });
    await page.goto(stack.url('testcafe', '/index.html')); await page.waitForSelector('.tbl-tile, .items .tile, .ticket-pane', { timeout: 15000 }); await page.waitForTimeout(600);
    await page.evaluate(() => go('more')); await page.waitForTimeout(700);
    const body = await text();
    assert(!/back office/i.test(body), 'the POS still mentions Back office');
    assert(((await page.locator('.li, button', { hasText: /^Admin console/ }).count()) >= 1) && (body.match(/Admin console/g) || []).length === 1, 'expected exactly one Admin console entry, found ' + (body.match(/Admin console/g) || []).length);
    await page.goto(stack.url('testcafe', '/dashboard.html#mgmt/hardware')); await page.waitForSelector('text=Barcode scanner', { timeout: 15000 });
    assert(/Token display screen/.test(await text()), 'Hardware page is missing the token display switch');
  }, 'critical');

  // the 409 from the deliberate double booking above is the expected answer, not an error
  await s.check('No JavaScript errors during the whole workflow', async () => { const bad = errs.filter((e) => !/print|callback|WebSocket|ERR_CERT|tunnel/i.test(e) && !/icon-[a-z]+\.svg.*ERR_ABORTED/.test(e) && !/409.*\/db\/bookings/.test(e)); assert(!bad.length, bad.slice(0, 3).join(' | ')); }, 'major');
  await ctx.close(); s.done();
}
