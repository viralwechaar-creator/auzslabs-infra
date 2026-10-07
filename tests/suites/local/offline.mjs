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

  // ---------- POST /sync: the whole queue in one request ----------
  const sync = async (tok, ops) => { const r = await fetch(stack.apiBase + '/sync', { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify({ ops }) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
  await s.check('/sync: a queue sent in one request lands in order, and sending it again changes nothing', async () => {
    const it = uid(), sale = uid(), buy = uid();
    const ops = [
      { id: 'a', fn: 'mob_save_item', args: { p_id: it, p: { name: 'Batch Cable ' + it.slice(0, 4), category: 'accessory', serialized: false, sellingPrice: 100, costPrice: 40, lowStockAt: 0 } } },
      { id: 'b', fn: 'mob_push_purchase', args: { p_id: buy, p: { itemId: it, qty: 5, rate: 40 } } },
      { id: 'c', fn: 'mob_push_sale', args: { p_id: sale, p: { items: [{ itemId: it, name: 'Batch Cable', qty: 2, price: 100 }], paid: 200, paymentMode: 'cash' } } },
    ];
    const r1 = await sync(owner, ops); assert(r1.status === 200 && r1.body.results.every((x) => x.ok), JSON.stringify(r1.body));
    assert(await movesFor(it) === 3, 'stock should be 5 - 2, was ' + await movesFor(it));
    const r2 = await sync(owner, ops); assert(r2.status === 200 && r2.body.results.every((x) => x.ok), 'replay: ' + JSON.stringify(r2.body));
    assert(await salesWith(sale) === 1 && await movesFor(it) === 3, 'the replay duplicated something');
  }, 'critical');
  await s.check('/sync: a refused op (not enough stock) fails alone; later ops still go through', async () => {
    const sale1 = uid(), sale2 = uid(); const before = await movesFor(item);
    const r = await sync(owner, [
      { id: 'big', fn: 'mob_push_sale', args: { p_id: sale1, p: { items: [{ itemId: item, name: 'Offline Cable', qty: 99999, price: 100 }], paid: 0, paymentMode: 'cash' } } },
      { id: 'ok', fn: 'mob_push_sale', args: { p_id: sale2, p: { items: [{ itemId: item, name: 'Offline Cable', qty: 1, price: 100 }], paid: 100, paymentMode: 'cash' } } },
    ]);
    const [a, b] = r.body.results; assert(a.ok === false && a.status === 400 && /stock/i.test(a.error), JSON.stringify(a)); assert(b.ok === true, JSON.stringify(b));
    assert(await salesWith(sale1) === 0 && await salesWith(sale2) === 1 && await movesFor(item) === before - 1, 'wrong database state');
  }, 'critical');
  await s.check('/sync: no new door: login needed, anonymous and unknown functions refused, size capped, other businesses refused', async () => {
    assert((await sync(null, [{ id: 'x', fn: 'mob_save_item', args: {} }])).status === 401, 'anonymous batch accepted');
    const r = await sync(owner, [{ id: 'p', fn: 'public_menu', args: { tenant_slug: 'testmob' } }, { id: 'u', fn: 'drop_everything', args: {} }, { id: 'v', fn: 'provision_from_payment', args: {} }]);
    assert(r.body.results.every((x) => x.ok === false && (x.status === 400 || x.status === 404)), JSON.stringify(r.body));
    assert((await sync(owner, Array.from({ length: 51 }, (_, i) => ({ id: String(i), fn: 'mob_context', args: {} })))).status === 413, 'size cap');
    assert((await sync(owner, [])).status === 400, 'empty batch');
    const cafe = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.cafeOwner, password: PASSWORD }) })).json()).access_token;
    const o = await sync(cafe, [{ id: 'z', fn: 'mob_push_sale', args: { p_id: uid(), p: { items: [{ itemId: item, name: 'x', qty: 1, price: 1 }], paid: 1, paymentMode: 'cash' } } }]);
    assert(o.body.results[0].ok === false, 'another business could sell from this shop: ' + JSON.stringify(o.body));
  }, 'critical');
  await s.check('/sync: after a temporary failure the rest are not tried (so the phone keeps them queued, in order)', async () => {
    const r = await sync(owner, [{ id: '1', fn: 'mob_context', args: {} }, { id: '2', fn: 'mob_push_sale', args: { p_id: 'not-a-uuid', p: {} } }, { id: '3', fn: 'mob_context', args: {} }]);
    const res = r.body.results; assert(res[0].ok === true, 'first op'); assert(res[1].ok === false, 'bad id op'); // bad id is a business error (4xx) -> the next one still runs
    assert(res[2].ok === true || res[2].skipped, 'third op: ' + JSON.stringify(res[2]));
  });
  await s.check('AUZsMob sends a queue of several sales in one /sync request, each arriving once', async () => {
    const { c, page } = await open(); const ids = [uid(), uid(), uid()]; let syncCalls = 0, singles = 0;
    let down = true; const seen = [];
    await page.route('**/sync', (r) => { if (r.request().method() !== 'POST') return r.fallback(); syncCalls++; if (!down) seen.push('sync'); return down ? r.abort() : r.fallback(); });
    await page.route('**/rpc/mob_push_sale', (r) => { if (r.request().method() !== 'POST') return r.fallback(); singles++; if (!down) seen.push('single'); return down ? r.abort() : r.fallback(); });
    page.on('response', async (rs) => { if (/\/sync$/.test(rs.url()) && !down) { try { seen.push('resp=' + (await rs.text()).slice(0, 300)); } catch {} } });
    for (const id of ids) await queueSale(page, id, 1);
    await page.waitForTimeout(500); down = false; syncCalls = 0; singles = 0;
    assert(await waiting(page) === 3, 'queue ' + await waiting(page));
    await settle(page); await page.waitForTimeout(1200);
    assert(syncCalls === 1 && singles === 0, `sync calls ${syncCalls}, single sale calls ${singles}, order ${seen.join(' ')}`);
    for (const id of ids) assert(await salesWith(id) === 1, 'sale missing ' + id);
    assert(await waiting(page) === 0, 'queue not emptied');
    await c.close();
  }, 'critical');
  await s.check('POS: searching and browsing stay fast with a big local catalogue (1k, 5k, 10k, 50k items)', async () => {
    const { c, page } = await openPos(); const out = [];
    for (const N of [1000, 5000, 10000, 50000]) {
      const r = await page.evaluate((N) => {
        for (const id of Object.keys(R)) if (id.startsWith('perf-')) delete R[id];
        for (let i = 0; i < N; i++) R['perf-' + i] = { kind: 'item', deleted: false, data: { id: 'perf-' + i, name: 'Perf item ' + i + ' ' + ['mango', 'banana', 'cable', 'case', 'shake'][i % 5], short: 'P' + i, cat: 'perfcat' + (i % 20), price: 10 + (i % 90), veg: 'veg' } };
        const o = curOrder(), t = (f) => { const a = performance.now(); f(); return Math.round(performance.now() - a); };
        S.q = 'perf item 12'; const search = t(() => { for (let k = 0; k < 5; k++) visibleItems(o); });
        S.q = 'mango'; const search2 = t(() => { for (let k = 0; k < 5; k++) visibleItems(o); });
        S.q = ''; S.cat = 'perfcat3'; const browse = t(() => { for (let k = 0; k < 5; k++) visibleItems(o); });
        S.q = 'perf item 12'; const paint = t(() => render()); S.q = '';
        return { search: Math.round(search / 5), search2: Math.round(search2 / 5), browse: Math.round(browse / 5), paint };
      }, N);
      out.push(N + ' items: search ' + r.search + ' ms, wide search ' + r.search2 + ' ms, category ' + r.browse + ' ms, repaint ' + r.paint + ' ms');
      if (N <= 10000) assert(r.search < 250 && r.browse < 250 && r.paint < 3000, N + ' items too slow: ' + JSON.stringify(r));
    }
    console.log('\nPERF (this machine, headless Chromium, no throttling)\n  ' + out.join('\n  '));
    await c.close();
  }, 'major');
  await s.check('POS printing: a connected receipt printer gets proper ESC/POS bytes; a dead one falls back to the print window; none = print window', async () => {
    const { c, page } = await openPos();
    const r = await page.evaluate(async () => {
      const out = {}, dec = (b) => String.fromCharCode(...b.filter((x) => x >= 32 && x < 127 || x === 10));
      window.__sent = []; window.__frames = 0; const realFrame = printFrame; printFrame = () => { window.__frames++; };
      const o = { no: 'INV-77', type: 'Takeaway', created: new Date().toISOString(), lines: [{ name: 'Mango Shake', qty: 2, price: 120 }, { name: 'Veg Sandwich', qty: 1, price: 80, note: 'no onion' }], pays: [{ m: 'cash', amt: 320 }], cust: { name: 'Asha' } };
      o.t = tot(o);
      // 1. no printer chosen: the normal print window
      prn(kotHtml(o, [{ n: 'Mango Shake', q: 2, s: 'Kitchen' }], { no: 5 })); out.noPrinter = window.__frames;
      // 2. a working printer
      auzPrinter._use({ kind: 'mock', name: 'Mock printer', write: async (b) => { window.__sent.push(Array.from(b)); } });
      prn(kotHtml(o, [{ n: 'Mango Shake', q: 2, s: 'Kitchen', note: 'less sugar' }], { no: 5 })); prnReceipt(o, false, false); prnReceipt(o, true, false); prnReceipt(o, false, true);
      await new Promise((r) => setTimeout(r, 300));
      out.sent = window.__sent.map((b) => ({ n: b.length, init: b[0] === 0x1b && b[1] === 0x40, cut: b.slice(-4).join(',') === '29,86,66,0', text: dec(b) }));
      out.frames = window.__frames;
      // 3. a printer that fails: falls back to the print window, with a message
      auzPrinter._use({ kind: 'mock', name: 'Broken', write: async () => { throw new Error('offline'); } });
      prn(kotHtml(o, [{ n: 'Tea', q: 1, s: 'Kitchen' }], {})); await new Promise((r) => setTimeout(r, 300)); out.afterFail = window.__frames;
      auzPrinter._use(null); printFrame = realFrame;
      return out;
    });
    assert(r.noPrinter === 1, 'without a printer the print window should open');
    const [kot, bill, dup, prov] = r.sent; assert(r.sent.length === 4, 'bytes sent: ' + r.sent.length);
    assert(kot.init && kot.cut && /KOT/.test(kot.text) && /2 x Mango Shake|2x Mango Shake|Mango Shake/.test(kot.text) && /less sugar/.test(kot.text), 'kitchen ticket: ' + kot.text);
    assert(bill.init && bill.cut && /INV-77/.test(bill.text) && /Mango Shake/.test(bill.text) && /TOTAL/.test(bill.text) && /Rs ?320/.test(bill.text) && !/₹/.test(bill.text) && /Cash/.test(bill.text) && /no onion/.test(bill.text), 'bill: ' + bill.text);
    assert(/DUPLICATE/.test(dup.text) && /PROVISIONAL/.test(prov.text) && /not paid yet/i.test(prov.text), 'duplicate/provisional marks');
    assert(r.frames === 1, 'a working printer must not also open the print window (frames ' + r.frames + ')');
    assert(r.afterFail === 2, 'a failing printer must fall back to the print window (frames ' + r.afterFail + ')');
    await c.close();
  }, 'critical');
  await s.check('ESC/POS encoder: text is plain ASCII (rupee prints as Rs), widths wrap, cash drawer and cut commands are correct', async () => {
    const { c, page } = await openPos();
    const r = await page.evaluate(() => {
      const e = new auzEsc.Esc(32); e.line('Price ₹120 – “tea” café').lr('Mango Shake with a very long name here', 'Rs 240.00').drawer().cut();
      const b = Array.from(e.bytes()), txt = String.fromCharCode(...b.filter((x) => x >= 32 && x < 127 || x === 10));
      return { b, txt, max: Math.max(...txt.split('\n').map((l) => l.length)), over: b.some((x) => x > 127 && false) };
    });
    assert(/Price Rs 120 - "tea" cafe/.test(r.txt), 'ascii: ' + r.txt); assert(r.max <= 32, 'a line is wider than the paper: ' + r.max);
    assert(r.b.slice(0, 2).join(',') === '27,64' && r.b.join(',').includes('27,112,0,25,250') && r.b.slice(-4).join(',') === '29,86,66,0', 'init / drawer / cut bytes');
    await c.close();
  });
  await s.check('Service worker list covers every file Accounting loads (so it can start with no connection)', async () => {
    const fs = await import('node:fs'); const html = fs.readFileSync(new URL('../../../app/public/accounts.html', import.meta.url), 'utf8'), sw = fs.readFileSync(new URL('../../../app/public/sw.js', import.meta.url), 'utf8');
    const urls = [...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('//'));
    const missing = ['/accounts.html', ...urls].filter((u) => !sw.includes("'" + u + "'")); assert(!missing.length, 'not precached: ' + missing.join(', '));
  }, 'major');
  await s.check('Object storage: signing matches the AWS published example; upload and read round-trip against an S3-style server; dormant without settings', async () => {
    const { signS3, s3Enabled, s3Put, s3Get } = await import('../../../server/src/s3.js');
    const r = signS3({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1', key: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z'), extra: { range: 'bytes=0-9' } });
    assert(r.signature === 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41', 'signature ' + r.signature);
    assert(!s3Enabled(), 'should be dormant without settings');
    const http = await import('node:http'); const store = new Map();
    const srv = http.createServer((q, res) => { const ch = []; q.on('data', (d) => ch.push(d)); q.on('end', () => {
      if (!/^AWS4-HMAC-SHA256 Credential=AK\//.test(q.headers.authorization || '')) { res.statusCode = 403; return res.end(); }
      if (q.method === 'PUT') { store.set(q.url, Buffer.concat(ch)); res.end(); } else if (store.has(q.url)) res.end(store.get(q.url)); else { res.statusCode = 404; res.end(); } }); });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    Object.assign(process.env, { S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'sk', S3_ENDPOINT: 'http://127.0.0.1:' + srv.address().port });
    try {
      assert(s3Enabled(), 'should be on');
      await s3Put('private/t/e/a.pdf', Buffer.from('hello'), 'application/pdf');
      assert((await s3Get('private/t/e/a.pdf')).toString() === 'hello', 'read back');
      assert((await s3Get('private/t/e/none.pdf')) === null, 'missing is null');
    } finally { for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT']) delete process.env[k]; srv.close(); }
  }, 'major');
}
