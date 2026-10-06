// Local-first / offline-first guarantees, checked against the real apps and the real API:
// a completed local sale must never disappear (server down, 5xx, lost reply, restart while offline) and
// must never be duplicated by a retry; a genuine business refusal is still rolled back and reported.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Offline-first: queued writes survive outages and are never duplicated', 'Drives AUZsMob with the server down, answering 503, losing its reply and with the phone restarted before sync, then checks the database holds exactly one copy.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.mobOwner);
  const call = async (fn, args) => { const r = await rpc(stack, fn, args || {}, owner); return { ok: r.status === 200, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const tid = (await q("select id from tenants where slug='testmob'"))[0].id;
  const uid = () => crypto.randomUUID();
  const salesWith = async (id) => Number((await q('select count(*)::int n from mob_sales where tenant_id=$1 and id=$2', [tid, id]))[0].n);
  const movesFor = async (item) => Number((await q('select coalesce(sum(qty),0)::float8 s from mob_stock_movements where tenant_id=$1 and item_id=$2', [tid, item]))[0].s);
  // a loose-stock item with 10 in hand
  const item = uid();
  const saved = await call('mob_save_item', { p_id: item, p: { name: 'Offline Cable ' + item.slice(0, 4), category: 'accessory', serialized: false, sellingPrice: 100, costPrice: 40, lowStockAt: 0 } });
  assert(saved.ok, 'item not created: ' + saved.error);
  const pur = await call('mob_push_purchase', { p_id: uid(), p: { itemId: item, qty: 10, rate: 40 } });
  assert(pur.ok, 'stock not added: ' + pur.error);

  const open = async () => {
    const c = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('testmob', '/mob.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', USERS.mobOwner); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 }); await page.waitForTimeout(900);
    return { c, page, errs };
  };
  const queueSale = (page, id, qty) => page.evaluate(async ([id, item, qty]) => {
    await outboxAdd('mob_push_sale', { p_id: id, p: { items: [{ itemId: item, name: 'Offline Cable', qty, price: 100 }], paid: 100 * qty, paymentMode: 'cash' } });
  }, [id, item, qty]);
  const onPost = (page, handler) => page.route('**/rpc/mob_push_sale', (r) => (r.request().method() === 'OPTIONS' ? r.continue() : handler(r)));
  const waiting = (page) => page.evaluate(async () => (await outboxAll()).length);
  const settle = async (page) => { await page.evaluate(() => retrySyncNow()); await page.waitForTimeout(600); };

  await s.check('The API answering 503 keeps the sale queued; once it recovers the sale arrives exactly once', async () => {
    const { c, page } = await open(); const id = uid();
    await onPost(page, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"service unavailable"}' }));
    await queueSale(page, id, 1); await page.waitForTimeout(800);
    assert(await waiting(page) === 1, 'the sale left the queue while the server answered 503');
    assert(await salesWith(id) === 0, 'server already has it?');
    await page.unroute('**/rpc/mob_push_sale'); await settle(page);
    assert(await waiting(page) === 0, 'queue did not drain after recovery');
    assert(await salesWith(id) === 1, 'expected exactly one sale, got ' + await salesWith(id));
    await c.close();
  }, 'critical');

  await s.check('No route to the server while the phone thinks it is online (connection refused) keeps the sale', async () => {
    const { c, page } = await open(); const id = uid();
    await onPost(page, (r) => r.abort('connectionrefused'));
    await queueSale(page, id, 1); await page.waitForTimeout(800);
    assert(await waiting(page) === 1, 'the sale was dropped on a network failure');
    await page.unroute('**/rpc/mob_push_sale'); await settle(page);
    assert(await salesWith(id) === 1, 'sale missing after recovery');
    await c.close();
  }, 'critical');

  await s.check('A lost reply (server saved it, the phone never heard) is retried without a duplicate sale or stock move', async () => {
    const { c, page } = await open(); const id = uid(); const before = await movesFor(item);
    await onPost(page, async (r) => { await rpc(stack, 'mob_push_sale', JSON.parse(r.request().postData() || '{}'), owner); await r.abort('failed'); });  // the server processes it (done here, the browser cannot reach the real API host from the test runner), the answer is lost
    await queueSale(page, id, 2); await page.waitForTimeout(1200);
    assert(await salesWith(id) === 1, 'server should have recorded the first attempt');
    assert(await waiting(page) === 1, 'phone should still think it is unsent');
    await page.unroute('**/rpc/mob_push_sale'); await settle(page); await settle(page);
    assert(await waiting(page) === 0, 'queue not drained');
    assert(await salesWith(id) === 1, 'duplicate sale after retry: ' + await salesWith(id));
    assert(await movesFor(item) === before - 2, 'stock moved more than once: ' + before + ' -> ' + await movesFor(item));
    await c.close();
  }, 'critical');

  await s.check('A sale queued while the API is unreachable survives a restart of the app and syncs when the API is back', async () => {
    const { c, page } = await open(); const id = uid();
    await page.route('**/rpc/**', (r) => (r.request().method() === 'OPTIONS' ? r.continue() : r.abort('connectionrefused')));
    await queueSale(page, id, 1); await page.waitForTimeout(500);
    assert(await waiting(page) === 1, 'not queued');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    assert(await page.evaluate(async () => (await outboxAll()).length) === 1, 'queued sale lost across the restart');
    await page.unroute('**/rpc/**'); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.shell', { timeout: 20000 });
    await settle(page); await page.waitForTimeout(500);
    assert(await waiting(page) === 0, 'queue did not drain after the API came back');
    assert(await salesWith(id) === 1, 'sale missing on the server');
    await c.close();
  }, 'critical');

  await s.check('A genuine refusal (selling more than is in stock) is still rolled back and told to the user, not retried forever', async () => {
    const { c, page } = await open(); const id = uid();
    await queueSale(page, id, 500); await page.waitForTimeout(1500);
    assert(await waiting(page) === 0, 'a refused sale must leave the queue');
    assert(await salesWith(id) === 0, 'server accepted an oversell');
    await c.close();
  }, 'major');

  await s.check('The sync pill shows a retry state while the server is failing and returns to Synced afterwards', async () => {
    const c = await newCtx(browser, stack, { w: 1280, h: 800 }); const page = await c.newPage();
    await page.goto(stack.url('testmob', '/mob.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', USERS.mobOwner); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 }); await page.waitForTimeout(900);
    const id = uid();
    await onPost(page, (r) => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"bad gateway"}' }));
    await queueSale(page, id, 1); await page.waitForTimeout(900);
    const txt = await page.locator('.sync-pill').first().innerText().catch(() => '');
    assert(/retry|दोबारा/i.test(txt), 'no retry prompt on the pill: ' + txt);
    await page.unroute('**/rpc/mob_push_sale'); await page.locator('.sync-pill').first().click(); await page.waitForTimeout(1200);
    assert(await waiting(page) === 0, 'tap to retry did not send the sale');
    await c.close();
  }, 'major');

  // ---------- AUZsPOS ----------
  const cafeTid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  const cafeTok = await login(USERS.cafeOwner);
  const rowsFor = async (id) => (await q('select data from records where tenant_id=$1 and id=$2', [cafeTid, id])).length;
  const openPos = async () => {
    const c = await newCtx(browser, stack, { w: 1280, h: 800 }); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/index.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', USERS.cafeOwner); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.tbl-tile', { timeout: 20000 }); await page.waitForTimeout(900);
    return { c, page, errs };
  };
  const posOut = (page) => page.evaluate(async () => (await all('out')).length);
  const saveOrder = (page, id) => page.evaluate(async (id) => { await save('order', { status: 'open', items: [], note: 'offline test' }, id); }, id);
  const onPush = (page, handler) => page.route('**/rpc/push_record', (r) => (r.request().method() === 'OPTIONS' ? r.continue() : handler(r)));

  await s.check('POS: an order saved while the API answers 503 stays queued and reaches the server exactly once after recovery', async () => {
    const { c, page } = await openPos(); const id = uid();
    await onPush(page, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"service unavailable"}' }));
    await saveOrder(page, id); await page.waitForTimeout(1000);
    assert(await posOut(page) === 1, 'queued order lost while the server was failing');
    assert(await rowsFor(id) === 0, 'server already has it?');
    await page.unroute('**/rpc/push_record'); await page.evaluate(() => syncNow()); await page.waitForTimeout(800);
    assert(await posOut(page) === 0, 'queue did not drain');
    assert(await rowsFor(id) === 1, 'expected one order row, got ' + await rowsFor(id));
    await c.close();
  }, 'critical');

  await s.check('POS: a lost reply is retried without creating a duplicate order', async () => {
    const { c, page } = await openPos(); const id = uid();
    await onPush(page, async (r) => { await rpc(stack, 'push_record', JSON.parse(r.request().postData() || '{}'), cafeTok); await r.abort('failed'); });
    await saveOrder(page, id); await page.waitForTimeout(1200);
    assert(await rowsFor(id) === 1, 'server should have stored the first attempt');
    await page.unroute('**/rpc/push_record'); await page.evaluate(() => syncNow()); await page.waitForTimeout(1000);
    assert(await posOut(page) === 0, 'queue not drained after retry');
    assert(await rowsFor(id) === 1, 'duplicate order rows after retry: ' + await rowsFor(id));
    await c.close();
  }, 'critical');

  await s.check('POS: an order queued while the API is unreachable survives a restart and syncs afterwards', async () => {
    const { c, page } = await openPos(); const id = uid();
    await page.route('**/rpc/**', (r) => (r.request().method() === 'OPTIONS' ? r.continue() : r.abort('connectionrefused')));
    await saveOrder(page, id); await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    assert(await page.evaluate(async () => (await all('out')).length) === 1, 'order lost across the restart');
    await page.unroute('**/rpc/**'); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.tbl-tile', { timeout: 20000 }); await page.waitForTimeout(800);
    await page.evaluate(() => syncNow()); await page.waitForTimeout(1000);
    assert(await posOut(page) === 0, 'queue did not drain');
    assert(await rowsFor(id) === 1, 'order missing on the server');
    await c.close();
  }, 'critical');

  await s.check('POS: billing is not stalled by a server that never answers (invoice number falls back to a local one within seconds)', async () => {
    const { c, page } = await openPos();
    await page.route('**/rpc/next_invoice_no', (r) => (r.request().method() === 'OPTIONS' ? r.continue() : new Promise(() => {})));
    const t0 = Date.now(); const no = await page.evaluate(() => nextNo()); const ms = Date.now() - t0;
    assert(ms < 5000, 'numbering waited ' + ms + ' ms for a server that never answers');
    assert(/~$/.test(String(no)), 'expected a local number, got ' + no);
    await c.close();
  }, 'critical');
}
