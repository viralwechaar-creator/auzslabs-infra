// Razorpay for request-first orders (db/200): the client pays the quoted total online; only the signed webhook can mark it paid and it runs
// the admin's own confirm step (access, gapless bill number, renewal dates, payment record). A fake Razorpay API stands in for the real one.
import crypto from 'node:crypto';
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Razorpay: pay a quoted request online', 'Pay online creates a Razorpay order for exactly the quoted total; the signed webhook confirms the order, gives access and the bill, once.');
  const login = async (email) => { const d = await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json(); return (d.data || d).access_token; };
  const call = async (fn, args, tok) => { const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(args) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d && d.data !== undefined ? d.data : d, raw: d }; };
  const post = (p, body, headers = {}) => fetch(stack.apiBase + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const hook = (event, secret = stack.rzp.webhookSecret) => { const raw = JSON.stringify(event); return post('/payments/webhook', raw, { 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') }); };
  const captured = (orderId, payId, paise) => ({ event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: orderId, amount: paise, status: 'captured' } } } });
  const adm = await login(USERS.admin), cust = await login(USERS.plain);
  let tok, id, TOTAL = 0;

  await s.check('Setup: a quoted request with the payment link sent; the config says online payment is on', async () => {
    const cfg = await (await fetch(stack.apiBase + '/payments/config')).json();
    assert(cfg.enabled === true && cfg.keyId === 'rzp_test_TESTKEY' && !JSON.stringify(cfg).includes('rzp-test-secret'), 'config: ' + JSON.stringify(cfg));
    const r = await call('submit_client_order', { p: { contact_name: 'Online Payer', phone: '9812300011', business_name: 'Online Cafe', niche: 'cafe', requirement: 'POS', products: ['pos'] } }, cust);
    assert(r.status === 200, JSON.stringify(r.raw)); tok = r.data.token; id = r.data.id;
    const t = await call('admin_save_order_quote', { p_id: id, p_quote: { items: [{ key: 'pos', plan: 'month', rate: 1090, discount: 0, gst: 18 }], setup: { on: true, amount: 2190, gst: 0 } } }, adm);
    assert(t.status === 200 && Number(t.data.total) > 3000, 'quote: ' + JSON.stringify(t.raw)); TOTAL = Number(t.data.total);
    assert((await call('admin_set_order_status', { p_id: id, p_status: 'link_sent' }, adm)).status === 200, 'link not sent');
  }, 'critical');

  await s.check('Pay online: refused without the terms ticked, for a wrong link and before the link was sent; otherwise a Razorpay order for exactly the quote total', async () => {
    assert((await post('/payments/order/create', { token: tok, terms: false })).status === 400, 'order created without the terms');
    assert((await post('/payments/order/create', { token: 'f'.repeat(32), terms: true })).status === 400, 'order created for an unknown link');
    const r = await post('/payments/order/create', { token: tok, terms: true }); const o = await r.json();
    assert(r.status === 200 && o.keyId === 'rzp_test_TESTKEY' && o.amount === Math.round(TOTAL * 100) && o.currency === 'INR' && /^order_/.test(o.orderId), 'create: ' + JSON.stringify(o));
    const last = stack.rzp.orders[stack.rzp.orders.length - 1];
    assert(last.amount === Math.round(TOTAL * 100) && last.notes.client_order_id === id && /^Basic /.test(last.auth), 'what Razorpay was asked: ' + JSON.stringify(last));
    const row = (await q('select status, client_order_id, user_id, amount from payments where razorpay_order_id=$1', [o.orderId]))[0];
    assert(row.status === 'created' && row.client_order_id === id && Number(row.amount) === TOTAL, JSON.stringify(row));
    assert((await q('select payment from client_orders where id=$1', [id]))[0].payment.terms_accepted_at, 'the terms were not recorded');
    assert((await q('select status from client_orders where id=$1', [id]))[0].status === 'link_sent', 'creating an order changed the request');
    stack.rzp.last = o;
  }, 'critical');

  await s.check('Webhook: a wrong signature is refused and changes nothing; the client\'s own "paid" message cannot mark anything', async () => {
    const ev = captured(stack.rzp.last.orderId, 'pay_FAKE0001', Math.round(TOTAL * 100));
    assert((await hook(ev, 'a-wrong-secret-of-the-same-sort')).status === 400, 'bad signature accepted');
    assert((await post('/payments/webhook', JSON.stringify(ev))).status === 400, 'unsigned webhook accepted');
    assert((await q('select status from client_orders where id=$1', [id]))[0].status === 'link_sent', 'order changed without a valid webhook');
  }, 'critical');

  await s.check('Webhook with the wrong amount: the order stays unpaid and the admin is told', async () => {
    const r = await hook(captured(stack.rzp.last.orderId, 'pay_WRONGAMT1', 100));
    assert(r.status === 200, 'webhook status ' + r.status);
    assert((await q('select status from client_orders where id=$1', [id]))[0].status === 'link_sent', 'a short payment marked the order paid');
    assert((await q("select count(*)::int n from notifications where tenant_id is null and title like 'Online payment does not match%'"))[0].n >= 1, 'the admin was not told');
  }, 'critical');

  await s.check('Webhook, signed and right: the order is paid, access is given, the bill is numbered, the payment recorded; a replay does nothing more', async () => {
    const ev = captured(stack.rzp.last.orderId, 'pay_GOOD0001', Math.round(TOTAL * 100));
    assert((await hook(ev)).status === 200, 'good webhook refused');
    const o = (await q('select status, invoice_no, tenant_id, payment, paid_at from client_orders where id=$1', [id]))[0];
    assert(o.status === 'paid' && /^AUZ\/\d{4}-\d{2}\/\d{4}$/.test(o.invoice_no) && o.tenant_id && o.payment.method === 'razorpay' && o.payment.razorpay_payment_id === 'pay_GOOD0001', JSON.stringify(o));
    const f = (await q('select features from tenant_settings where tenant_id=$1', [o.tenant_id]))[0].features; assert(f.pos === true, 'access not given: ' + JSON.stringify(f));
    const cp = (await q("select amount, mode, utr, note from client_payments where tenant_id=$1", [o.tenant_id]))[0];
    assert(Number(cp.amount) === TOTAL && cp.mode === 'other' && cp.utr === 'pay_GOOD0001', 'payment record: ' + JSON.stringify(cp));
    assert((await q('select status, razorpay_payment_id from payments where razorpay_order_id=$1', [stack.rzp.last.orderId]))[0].status === 'paid', 'payments row not paid');
    const inv = o.invoice_no;
    assert((await hook(ev)).status === 200, 'replay refused');
    const after = (await q('select invoice_no from client_orders where id=$1', [id]))[0].invoice_no;
    assert(after === inv && (await q('select count(*)::int n from client_payments where tenant_id=$1', [o.tenant_id]))[0].n === 1, 'a replay made a second bill or payment');
    const pub = (await call('public_client_order', { p_token: tok })).data; assert(pub.status === 'paid' && pub.invoice_no === inv, 'the client page does not show paid');
    assert((await post('/payments/order/create', { token: tok, terms: true })).status === 400, 'a paid order could be paid again');
  }, 'critical');

  await s.check('pay.html: the "Pay online" card shows with the bill, enforces the terms box and opens the payment with the right amount', async () => {
    const r = await call('submit_client_order', { p: { contact_name: 'Page Payer', phone: '9812300012', business_name: 'Page Cafe', requirement: 'x', products: ['payroll'] } }, cust);
    await call('admin_save_order_quote', { p_id: r.data.id, p_quote: { items: [{ key: 'payroll', plan: 'month', rate: 590, discount: 0, gst: 18 }], setup: { on: false } } }, adm);
    await call('admin_set_order_status', { p_id: r.data.id, p_status: 'link_sent' }, adm);
    const c = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await c.newPage(); const errs = watch(page);
    let opened = null;
    await page.route('https://checkout.razorpay.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: 'window.Razorpay=function(o){window.__rz=o;this.on=function(){};this.open=function(){window.__rzOpened=true;};};' }));
    await page.goto(stack.url('', '/pay.html?t=' + r.data.token)); await page.waitForSelector('#payOnline', { timeout: 15000 });
    const amt = (await call('public_client_order', { p_token: r.data.token })).data.totals.total; assert(new RegExp(Number(amt).toLocaleString('en-IN', { minimumFractionDigits: 2 }).replace('.', '\\.') + ' online', 'i').test(await page.locator('#payOnline').innerText()), 'button amount: ' + await page.locator('#payOnline').innerText());
    await page.click('#payOnline'); assert(/tick the box/i.test(await page.locator('#onErr').innerText()), 'the terms box was not enforced');
    await page.check('#agree'); await page.click('#payOnline'); await page.waitForFunction(() => window.__rzOpened === true, null, { timeout: 15000 });
    const o = await page.evaluate(() => window.__rz); assert(o.amount === Math.round(Number(amt) * 100) && o.key === 'rzp_test_TESTKEY' && /^order_/.test(o.order_id) && o.theme.color === '#800020', JSON.stringify(o));
    assert(await page.locator('#qr').count() === 1, 'the UPI QR fallback is gone');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sideways scroll');
    await s.shot(page, 'razorpay-pay-page');
    assert(!errs.some((e) => /JS error/.test(e)), errs.join(' | ')); await c.close();
  }, 'critical');
  s.done();
}
