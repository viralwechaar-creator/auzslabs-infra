// Storefront outgoing webhooks: events are queued, signed, delivered, retried; unsafe addresses are refused.
import http from 'node:http';
import crypto from 'node:crypto';
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront webhooks', 'Queue, signature, delivery, retry, safety.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]); await q('delete from sfx_webhooks where tenant_id=$1', [tid]);
  // the real check needs https; the test receiver is plain http on this computer
  await q('alter table sfx_webhooks drop constraint if exists sfx_webhooks_url_check');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const err = async (fn, args) => JSON.stringify((await rpc(stack, fn, args, owner)).data).toLowerCase();
  const got = []; let mode = 200;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got.push({ headers: req.headers, body: b }); res.statusCode = mode; res.end('ok'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = 'http://127.0.0.1:' + srv.address().port + '/hook';
  const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Hook tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 50 }] } })).data;
  const vs = pr.variants[0].id;
  const place = async () => { await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Hook Buyer', phone: '97' + Math.floor(10000000 + Math.random() * 89999999), address: '1 Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', payment: 'cod', lines: [{ variantId: vs, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id; };
  let secret, hookId;

  await s.check('Adding a webhook: only a public https address and known events; the secret is shown once', async () => {
    assert(/https/.test(await err('sfx_webhook_create', { p_url: 'http://example.com/x', p_events: ['order.created'] })), 'http accepted');
    assert(/not reachable/.test(await err('sfx_webhook_create', { p_url: 'https://127.0.0.1/x', p_events: ['order.created'] })), 'loopback accepted');
    assert(/not reachable/.test(await err('sfx_webhook_create', { p_url: 'https://169.254.169.254/x', p_events: ['order.created'] })), 'metadata address accepted');
    assert(/at least one event/.test(await err('sfx_webhook_create', { p_url: 'https://example.com/x', p_events: ['nonsense'] })), 'unknown event accepted');
    const w = unwrap(await call('sfx_webhook_create', { p_url: 'https://example.com/x', p_events: ['order.created', 'order.paid', 'order.cancelled', 'refund.created'] }));
    assert(/^whsec_/.test(w.secret), JSON.stringify(w));
    const list = unwrap(await call('sfx_webhook_list', {}));
    assert(list.hooks.length === 1 && !JSON.stringify(list).includes(w.secret), 'list shows the secret');
    // point it at the local receiver for the next checks
    await q('update sfx_webhooks set url=$1 where id=$2', [url, w.id]); secret = w.secret; hookId = w.id;
  }, 'critical');

  await s.check('A new order is delivered once, signed, with the order inside', async () => {
    got.length = 0; const o = await place();
    assert(await waitFor(() => got.length >= 1), 'nothing delivered');
    const d = got[0]; const ts = d.headers['x-storefront-timestamp'];
    const want = 'sha256=' + crypto.createHmac('sha256', secret).update(ts + '.' + d.body).digest('hex');
    assert(d.headers['x-storefront-signature'] === want, 'bad signature');
    const j = JSON.parse(d.body); assert(j.event === 'order.created' && j.data.id === o && j.data.lines.length === 1 && !('token' in j.data), d.body.slice(0, 300));
    assert(d.headers['x-storefront-event'] === 'order.created', 'event header');
    await new Promise((r) => setTimeout(r, 1500));
    assert(got.filter((x) => JSON.parse(x.body).event === 'order.created').length === 1, 'delivered twice');
    assert((await q("select status from sfx_webhook_events where webhook_id=$1 and event='order.created' order by id desc limit 1", [hookId]))[0].status === 'sent', 'not marked sent');
  }, 'critical');

  await s.check('Paid and cancelled events follow the order; events nobody asked for are not sent', async () => {
    got.length = 0; const o = await place(); await waitFor(() => got.length >= 1); got.length = 0;
    await q("update sfx_orders set payment_status='paid' where id=$1", [o]);
    assert(await waitFor(() => got.some((x) => JSON.parse(x.body).event === 'order.paid')), 'no paid event');
    await q("update sfx_orders set fulfilment_status='fulfilled' where id=$1", [o]);
    await q("update sfx_orders set status='cancelled' where id=$1", [o]);
    assert(await waitFor(() => got.some((x) => JSON.parse(x.body).event === 'order.cancelled')), 'no cancelled event');
    await new Promise((r) => setTimeout(r, 1000));
    assert(!got.some((x) => JSON.parse(x.body).event === 'order.fulfilled'), 'sent an event that was not chosen');
  });

  await s.check('A failing receiver is retried with a wait, then delivery works again; turning a hook off stops events', async () => {
    mode = 500; got.length = 0; const o = await place();
    assert(await waitFor(() => got.length >= 1), 'no first attempt'); await new Promise((r) => setTimeout(r, 800));
    let e = (await q("select status, attempts, http_status, next_at > now() later from sfx_webhook_events where webhook_id=$1 and event='order.created' order by id desc limit 1", [hookId]))[0];
    assert(e.status === 'pending' && e.attempts === 1 && e.http_status === 500 && e.later === true, JSON.stringify(e));
    mode = 200; await q("update sfx_webhook_events set next_at = now() where webhook_id=$1 and status='pending'", [hookId]);
    assert(await waitFor(async () => (await q("select status from sfx_webhook_events where webhook_id=$1 and event='order.created' order by id desc limit 1", [hookId]))[0].status === 'sent'), 'not delivered after recovery');
    await call('sfx_webhook_set', { p_id: hookId, p_active: false }); got.length = 0; await place(); await new Promise((r) => setTimeout(r, 1500));
    assert(got.length === 0, 'event sent while the hook is off');
    await call('sfx_webhook_set', { p_id: hookId, p_active: true });
    assert(o, 'order');
  });

  await s.check('Test ping, delivery log, and another shop cannot see or change this hook', async () => {
    got.length = 0; await call('sfx_webhook_test', { p_id: hookId });
    assert(await waitFor(() => got.some((x) => JSON.parse(x.body).event === 'ping')), 'no ping');
    const log = unwrap(await call('sfx_webhook_deliveries', { p_id: hookId })); assert(log.length >= 3 && log[0].status, JSON.stringify(log).slice(0, 200));
    const other = await login(USERS.salonOwner);
    const r = await rpc(stack, 'sfx_webhook_list', {}, other); assert(!JSON.stringify(r.data).includes(hookId), 'other shop sees the hook');
    const d = await rpc(stack, 'sfx_webhook_delete', { p_id: hookId }, other);
    assert((await q('select count(*)::int n from sfx_webhooks where id=$1', [hookId]))[0].n === 1, 'another shop deleted the hook: ' + JSON.stringify(d.data));
  });

  await s.check('The delivery worker refuses addresses inside the network', async () => {
    const { isPrivateAddress } = await import('../../../server/src/webhooks.js');
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.16.0.9', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) assert(isPrivateAddress(ip), ip + ' allowed');
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert(!isPrivateAddress(ip), ip + ' refused');
  });
  await s.check('Dashboard: Webhooks panel on the Apps page, add one, see the secret once, view deliveries', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/apps'), { waitUntil: 'load' }); await page.waitForTimeout(4000);
    assert(/webhooks/i.test(await page.locator('main, body').first().innerText()), 'no Webhooks panel');
    await page.evaluate(() => document.querySelector('[data-action="webhook-new"]').click()); await page.waitForTimeout(600);
    await page.fill('#dialog input[name=url]', 'https://hooks.example.com/store');
    await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1800);
    const d = await page.locator('#dialog').innerText();
    assert(/whsec_/.test(d), 'no secret shown: ' + d.slice(0, 200));
    assert((await q("select count(*)::int n from sfx_webhooks where tenant_id=$1 and url='https://hooks.example.com/store'", [tid]))[0].n === 1, 'not saved');
    await page.evaluate(() => document.querySelector('#dialog [data-action="close-dialog"]').click()); await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('[data-action^="webhook-log:"]').click()); await page.waitForTimeout(1200);
    assert(/Recent deliveries/.test(await page.locator('#dialog').innerText()), 'no delivery log');
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  srv.close();
  s.done();
}
