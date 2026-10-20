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
    assert(await page.locator('#qr').count() === 0, 'the manual UPI QR is still shown when online payment is on');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sideways scroll');
    await s.shot(page, 'razorpay-pay-page'); await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(400); await s.shot(page, 'razorpay-pay-page-desktop');
    assert(!errs.some((e) => /JS error/.test(e)), errs.join(' | ')); await c.close();
  }, 'critical');

  const other = await login(USERS.cafeOwner);
  let tenantId, rtok, sub1;
  const tenantOf = async () => (await q('select tenant_id from client_orders where id=$1', [id]))[0].tenant_id;
  const renewalDate = async () => String((await q('select renewal_date::text d from tenants where id=$1', [tenantId]))[0].d);
  const addMonths = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

  await s.check('Renew now: an owner gets a renewal order priced from what the business was last billed; others and hand-set-up businesses are refused; paying it extends the plan and issues a new bill', async () => {
    tenantId = await tenantOf();
    const before = await renewalDate();
    const noOwner = await post('/payments/renew/create', {}, {}); assert(noOwner.status === 401, 'anonymous could start a renewal');
    const bad = await post('/payments/renew/create', {}, { authorization: 'Bearer ' + other }); assert(bad.status === 400, 'a business with no paid order got a renewal: ' + bad.status);
    const r = await post('/payments/renew/create', {}, { authorization: 'Bearer ' + cust }); const d = await r.json(); assert(r.status === 200 && /^[a-f0-9]{32}$/.test(d.token), 'renew: ' + JSON.stringify(d)); rtok = d.token;
    const again = await (await post('/payments/renew/create', {}, { authorization: 'Bearer ' + cust })).json(); assert(again.token === rtok, 'a second press made a second order');
    const o = (await q('select kind, status, totals, products from client_orders where token=$1', [rtok]))[0];
    assert(o.kind === 'renewal' && o.status === 'link_sent' && o.products.join() === 'pos' && Number(o.totals.total) > 0 && !(o.totals.lines || []).some((l) => l.type === 'setup'), JSON.stringify(o));
    const c = await post('/payments/order/create', { token: rtok, terms: true }); const cd = await c.json(); assert(c.status === 200 && cd.amount === Math.round(Number(o.totals.total) * 100), 'renewal order: ' + JSON.stringify(cd));
    const orderId = cd.orderId; const rid = (await q('select id from client_orders where token=$1', [rtok]))[0].id;
    assert((await hook(captured(orderId, 'pay_RENEW0001', cd.amount))).status === 200, 'webhook');
    const after = (await q('select status, invoice_no, kind from client_orders where id=$1', [rid]))[0];
    assert(after.status === 'paid' && /^AUZ\//.test(after.invoice_no), JSON.stringify(after));
    const nd = await renewalDate(); assert(nd > before && nd === addMonths(nd > before ? addMonths(nd, -1) : before, 1), 'renewal date not moved: ' + before + ' -> ' + nd);
    assert((await q('select count(*)::int n from client_payments where tenant_id=$1', [tenantId]))[0].n === 2, 'payment not recorded');
    await hook(captured(orderId, 'pay_RENEW0001', cd.amount));
    assert((await q('select count(*)::int n from client_payments where tenant_id=$1', [tenantId]))[0].n === 2 && (await renewalDate()) === nd, 'a replay renewed twice');
  }, 'critical');

  await s.check('Failed payments: a failed attempt is recorded with its reason, a later good payment still works, three failures in a day tell the admin', async () => {
    const mk = async () => { const r = await (await post('/payments/renew/create', {}, { authorization: 'Bearer ' + cust })).json(); const c = await (await post('/payments/order/create', { token: r.token, terms: true })).json(); return c.orderId; };
    const failed = (oid, why) => ({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_F' + Math.random().toString(36).slice(2, 8), order_id: oid, error_description: why } } } });
    const o1 = await mk(); assert((await hook(failed(o1, 'Your card was declined'))).status === 200, 'failed webhook refused');
    const row = (await q('select status, failure_reason from payments where razorpay_order_id=$1', [o1]))[0]; assert(row.status === 'failed' && /declined/.test(row.failure_reason), JSON.stringify(row));
    const o2 = await mk(); await hook(failed(o2, 'Bank server down')); const o3 = await mk(); await hook(failed(o3, 'OTP wrong'));
    assert((await q("select count(*)::int n from notifications where tenant_id is null and title like 'A client online payment keeps failing%'"))[0].n === 1, 'the admin was not told after three failures');
    assert((await hook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_X', order_id: 'order_NOPE', error_description: 'x' } } } })).status === 200, 'an unknown order broke the webhook');
  }, 'critical');

  await s.check('Auto-renewal: owner-only; creates a plan and a subscription for what the business pays; authorised, charged (bill + extended plan, once), a wrong amount is held, a failed charge flags without cutting access, cancel stops it', async () => {
    assert((await post('/payments/autorenew/start', {}, { authorization: 'Bearer ' + other })).status === 400, 'a business with no paid order started auto-renewal');
    const r = await post('/payments/autorenew/start', {}, { authorization: 'Bearer ' + cust }); const d = await r.json();
    assert(r.status === 200 && /^https:\/\/rzp\.io\//.test(d.authLink) && /^sub_TEST/.test(d.subscriptionId), 'start: ' + JSON.stringify(d)); sub1 = d.subscriptionId;
    const plan = stack.rzp.plans[stack.rzp.plans.length - 1]; const sb = stack.rzp.subs[stack.rzp.subs.length - 1];
    const rq = (await q('select renewal_quote($1) as r', [tenantId]))[0].r;
    assert(plan.period === 'monthly' && plan.item.amount === Math.round(Number(rq.totals.total) * 100) && sb.plan_id === plan.id && sb.total_count === 120 && sb.notes.tenant_id === tenantId, JSON.stringify({ plan, sb }));
    assert((await post('/payments/autorenew/start', {}, { authorization: 'Bearer ' + cust })).status === 400, 'a second auto-renewal was created');
    assert((await call('my_autorenew', {}, cust)).data.status === 'created', 'status not created');
    const ev = (event, pay) => ({ event, payload: { subscription: { entity: { id: sub1 } }, ...(pay ? { payment: { entity: pay } } : {}) } });
    await hook(ev('subscription.authenticated')); assert((await call('my_autorenew', {}, cust)).data.status === 'active', 'not active after authorisation');
    const amt = Math.round(Number(rq.totals.total) * 100); const before = await renewalDate();
    await hook(ev('subscription.charged', { id: 'pay_AUTO0001', amount: 100 }));
    assert((await renewalDate()) === before && (await q("select count(*)::int n from notifications where tenant_id is null and title like 'Renewal payment does not match%'"))[0].n === 1, 'a wrong amount extended the plan');
    await hook(ev('subscription.charged', { id: 'pay_AUTO0002', amount: amt }));
    const nd = await renewalDate(); assert(nd > before, 'charge did not extend: ' + before + ' -> ' + nd);
    const bill = (await q("select invoice_no, kind, status, payment from client_orders where tenant_id=$1 and payment->>'razorpay_payment_id'='pay_AUTO0002'", [tenantId]))[0];
    assert(bill && bill.kind === 'renewal' && bill.status === 'paid' && /^AUZ\//.test(bill.invoice_no) && bill.payment.method === 'auto-renewal', 'no renewal bill: ' + JSON.stringify(bill));
    await hook(ev('subscription.charged', { id: 'pay_AUTO0002', amount: amt }));
    assert((await renewalDate()) === nd && (await q("select count(*)::int n from client_orders where tenant_id=$1 and payment->>'razorpay_payment_id'='pay_AUTO0002'", [tenantId]))[0].n === 1, 'a replay made a second bill');
    await hook(ev('subscription.pending'));
    assert((await call('my_autorenew', {}, cust)).data.status === 'payment_failed', 'failure not flagged');
    assert((await q('select status from tenants where id=$1', [tenantId]))[0].status === 'active', 'a failed charge cut access');
    assert((await q("select count(*)::int n from notifications where tenant_id=$1 and title like 'Auto-renewal payment failed%'", [tenantId]))[0].n >= 1, 'the client was not told');
    await hook(ev('subscription.charged', { id: 'pay_AUTO0003', amount: amt }));
    assert((await call('my_autorenew', {}, cust)).data.status === 'active', 'a good charge did not clear the failure');
    const cn = await post('/payments/autorenew/cancel', {}, { authorization: 'Bearer ' + cust }); assert(cn.status === 200, 'cancel failed');
    assert(stack.rzp.cancelled.some((u) => u.includes(sub1)) && (await call('my_autorenew', {}, cust)).data.on === false, 'cancel did not reach Razorpay / the row');
  }, 'critical');

  await s.check('Renewal reminders skip a business on an active auto-renewal (until it lapses) and resume when it is off', async () => {
    const ev = (event) => ({ event, payload: { subscription: { entity: { id: sub1 } } } });
    await q("update tenants set renewal_date = current_date + 2 where id=$1", [tenantId]); await q('delete from renewal_notices where tenant_id=$1', [tenantId]); await q('delete from notifications where tenant_id=$1', [tenantId]);
    await q("update subscriptions set status='active', cancelled_at=null where provider_sub_id=$1", [sub1]);
    await q('select renewal_notify_run()');
    assert((await q("select count(*)::int n from notifications where tenant_id=$1 and type='renewal'", [tenantId]))[0].n === 0, 'a reminder was sent to a business on auto-renewal');
    await q("update subscriptions set status='cancelled' where provider_sub_id=$1", [sub1]); await q('delete from renewal_notices where tenant_id=$1', [tenantId]);
    await q('select renewal_notify_run()');
    assert((await q("select count(*)::int n from notifications where tenant_id=$1 and type='renewal'", [tenantId]))[0].n === 1, 'the reminder did not come back');
  }, 'critical');
  s.done();
}
