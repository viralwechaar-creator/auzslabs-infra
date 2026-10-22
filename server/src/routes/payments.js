import { pool, withAuth } from '../db.js';
import { paymentConfig, gstPct, createOrder, createClientOrderPayment, createRenewalOrder, startRazorpayAutorenew, cancelRazorpayAutorenew, razorpayConfigured, verifyWebhookSignature, handleWebhookEvent } from '../payments.js';
import { cashfreeConfigured, startAutorenew, cancelAutorenew, verifyWebhookSignature as verifyCashfreeSignature, handleWebhookEvent as handleCashfreeWebhookEvent } from '../cashfree.js';
import { requireVerifiedEmail } from '../lib/guards.js';
import { HttpError, rateLimited, readJsonBody, readRawBody } from '../lib/http.js';

// Returns false when none of this module's routes matched, so the dispatcher in index.js tries the next module;
// any other return (including the undefined that `return reply(...)` gives) means the request was handled.
export async function handle(ctx) {
  const { req, res, url, user, ip, meta, reply, origin } = ctx;
  // ---- Razorpay payments (db/070) -- dormant until RAZORPAY_KEY_ID/SECRET
  // are set (see payments.js). /payments/config tells the cart page
  // whether to even offer online checkout. ----
  if (url.pathname === '/payments/config' && req.method === 'GET') {
    return reply(200, { ...paymentConfig(), gstPct: await gstPct() });
  }
  if (url.pathname === '/payments/create-order' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    // Each call hits Razorpay's own API -- worth a modest per-caller cap.
    if (rateLimited(`payorder:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    await requireVerifiedEmail(user.id);
    const { signup_request_id, addon_request_id, period } = await readJsonBody(req);
    let result;
    try {
      result = await createOrder({ userId: user.id, signupRequestId: signup_request_id, addonRequestId: addon_request_id, period: period === 'year' ? 'year' : 'month' });
    } catch (err) {
      throw new HttpError(400, err.message || 'could not start payment');
    }
    return reply(200, result);
  }
  // Pay online for a request-first order (db/200). The unguessable token in the pay link is the credential.
  if (url.pathname === '/payments/order/create' && req.method === 'POST') {
    if (rateLimited(`corderpay:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { token, terms } = await readJsonBody(req);
    let result;
    try { result = await createClientOrderPayment({ token, terms }); }
    catch (err) { throw new HttpError(400, err.message || 'could not start payment'); }
    return reply(200, result);
  }
  // AUZsStyle online store: card/UPI/net banking with the SHOP'S OWN Razorpay keys (db/232). The money goes straight to the shop.
  // The browser's success callback is verified by HMAC in SQL (sty_online_confirm); nothing is trusted without the signature.
  if (url.pathname === '/payments/sty/start' && req.method === 'POST') {
    if (rateLimited(`styrzp:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { token } = await readJsonBody(req);
    const { rows } = await pool.query('select sty_online_start($1) as r', [String(token || '')]).catch((e) => { throw new HttpError(400, e.message || 'could not start payment'); });
    const k = rows[0].r;
    const res = await fetch(`${process.env.RAZORPAY_API_URL || 'https://api.razorpay.com/v1'}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${k.key}:${k.secret}`).toString('base64') },
      body: JSON.stringify({ amount: Math.round(Number(k.total) * 100), currency: 'INR', receipt: String(k.number).slice(0, 40) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.id) throw new HttpError(400, 'The shop\'s card payment is not working right now. Please choose another way to pay.');
    await pool.query('select sty_online_set_order($1, $2)', [String(token), body.id]);
    return reply(200, { key: k.key, orderId: body.id, amount: body.amount, name: k.name, phone: k.phone, email: k.email, number: k.number });
  }
  if (url.pathname === '/payments/sty/verify' && req.method === 'POST') {
    if (rateLimited(`styrzpv:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const b = await readJsonBody(req);
    const { rows } = await pool.query('select sty_online_confirm($1, $2, $3, $4) as r', [String(b.token || ''), String(b.razorpay_order_id || ''), String(b.razorpay_payment_id || ''), String(b.razorpay_signature || '')])
      .catch((e) => { throw new HttpError(400, e.message || 'could not verify payment'); });
    return reply(200, rows[0].r);
  }
  // AUZsStyle: refunding a received return/exchange that was paid online, through the SHOP'S OWN Razorpay
  // account (db/248) -- a real refund, not just a status change. One route doing two things in order:
  // sty_refund_prepare validates (received stage, paid-online order, amount, the shop's own keys) WITHOUT
  // changing anything yet, then the real Razorpay refund call happens, and only once Razorpay has actually
  // confirmed it does this call sty_web_return_set to move the request to 'refunded' -- the exact same
  // function every other status change already goes through, so the stage graph and sty_manage gate apply
  // here exactly as everywhere else; this route never writes the status itself. Owner/manager only:
  // withAuth(user.id, ...) is what lets sty_guard('sty_manage') inside the SQL see the real caller.
  if (url.pathname === '/payments/sty/refund/start' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`styrzpr:${ip}`, 15, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { returnId, amount } = await readJsonBody(req);
    const prep = await withAuth(user.id, (client) => client.query('select sty_refund_prepare($1, $2) as r', [String(returnId || ''), Number(amount) || null]))
      .catch((e) => { throw new HttpError(400, e.message || 'could not start the refund'); });
    const k = prep.rows[0].r;
    const res = await fetch(`${process.env.RAZORPAY_API_URL || 'https://api.razorpay.com/v1'}/payments/${encodeURIComponent(k.paymentId)}/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${k.key}:${k.secret}`).toString('base64') },
      body: JSON.stringify({ amount: Math.round(Number(k.amount) * 100) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.id) throw new HttpError(400, (body && body.error && body.error.description) || 'Razorpay could not process this refund. Nothing was changed -- try again or refund it from the Razorpay dashboard directly.');
    await withAuth(user.id, (client) => client.query('select sty_web_return_set($1, $2) as r', [String(returnId), JSON.stringify({ status: 'refunded', refundAmount: k.amount, rzpRefundId: body.id })]))
      .catch((e) => { throw new HttpError(400, 'Razorpay refunded ' + k.amount + ' (refund id ' + body.id + ') but the request could not be marked refunded here: ' + (e.message || 'unknown error') + '. The money has already moved -- fix the record by hand.'); });
    return reply(200, { ok: true, rzpRefundId: body.id, amount: k.amount });
  }
  // ---- Renewals and auto-renewal (db/201): provider-agnostic front door for the apps' "Plan & account" sheet.
  // Razorpay Subscriptions when Razorpay is configured, else the older Cashfree code. Owner-only, gated in the SQL/route. ----
  if (url.pathname === '/payments/autorenew/config' && req.method === 'GET') {
    return reply(200, { enabled: razorpayConfigured() || cashfreeConfigured(), provider: razorpayConfigured() ? 'razorpay' : cashfreeConfigured() ? 'cashfree' : null, renewOnline: razorpayConfigured() });
  }
  if (url.pathname === '/payments/renew/create' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`renewpay:${ip}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    if (!razorpayConfigured()) throw new HttpError(400, 'Online payment is not switched on yet.');
    try { return reply(200, await createRenewalOrder({ userId: user.id })); }
    catch (err) { throw new HttpError(err.status || 400, err.message || 'could not start the renewal'); }
  }
  if (url.pathname === '/payments/autorenew/start' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`arstart:${ip}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    if (razorpayConfigured()) {
      try { return reply(200, await startRazorpayAutorenew({ userId: user.id, email: user.email })); }
      catch (err) { throw new HttpError(err.status || 400, err.message || 'could not start auto-renewal'); }
    }
    const profC = await withAuth(user.id, (client) => client.query('select tenant_id, role from profiles where id = $1', [user.id]));
    const pc = profC.rows[0];
    if (!pc || pc.role !== 'owner') throw new HttpError(403, 'owner access required');
    const trC = await pool.query('select name from tenants where id = $1', [pc.tenant_id]);
    try { return reply(200, await startAutorenew({ userId: user.id, tenantId: pc.tenant_id, tenantName: trC.rows[0]?.name || 'business', email: user.email, phone: user.phone })); }
    catch (err) { throw new HttpError(400, err.message || 'could not start auto-renewal'); }
  }
  if (url.pathname === '/payments/autorenew/cancel' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    const prof = await withAuth(user.id, (client) => client.query('select tenant_id, role from profiles where id = $1', [user.id]));
    const p = prof.rows[0];
    if (!p || p.role !== 'owner') throw new HttpError(403, 'owner access required');
    const row = (await pool.query(`select provider, provider_sub_id from subscriptions where tenant_id = $1 and status <> 'cancelled' order by created_at desc limit 1`, [p.tenant_id])).rows[0];
    if (row && row.provider === 'razorpay') {
      await cancelRazorpayAutorenew({ subId: row.provider_sub_id });
      await pool.query(`update subscriptions set status = 'cancelled', cancelled_at = now() where provider = 'razorpay' and provider_sub_id = $1`, [row.provider_sub_id]);
    } else await cancelAutorenew({ tenantId: p.tenant_id });
    return reply(200, { ok: true });
  }
  // Razorpay calls this directly, server-to-server -- no Bearer token,
  // no Origin, no rate limit by IP (it's always Razorpay's own IPs).
  // The signature check below is the only authentication this endpoint
  // has, and it is the ONLY thing allowed to ever mark a payment paid
  // and auto-provision a tenant -- see payments.js's own comment.
  if (url.pathname === '/payments/webhook' && req.method === 'POST') {
    const raw = await readRawBody(req, 1_000_000);
    if (!verifyWebhookSignature(raw, req.headers['x-razorpay-signature'])) {
      throw new HttpError(400, 'invalid signature');
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad json'); }
    await handleWebhookEvent(event);
    return reply(200, { ok: true });
  }

  // ---- Cashfree auto-renewal (db/116) -- dormant until CASHFREE_APP_ID/
  // CASHFREE_SECRET_KEY are set (see cashfree.js). Offered to every
  // tenant, not just new signups; a failed charge only flags the
  // business for the owner to chase, never suspends anything. ----
  if (url.pathname === '/payments/cashfree/config' && req.method === 'GET') {
    return reply(200, { enabled: cashfreeConfigured() });
  }
  if (url.pathname === '/payments/cashfree/start' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`cfautorenew:${ip}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const prof = await withAuth(user.id, (client) => client.query('select tenant_id, role from profiles where id = $1', [user.id]));
    const p = prof.rows[0];
    if (!p || p.role !== 'owner') throw new HttpError(403, 'owner access required');
    const tr = await pool.query('select name from tenants where id = $1', [p.tenant_id]);
    let result;
    try {
      result = await startAutorenew({ userId: user.id, tenantId: p.tenant_id, tenantName: tr.rows[0]?.name || 'business', email: user.email, phone: user.phone });
    } catch (err) {
      throw new HttpError(400, err.message || 'could not start auto-renewal');
    }
    return reply(200, result);
  }
  if (url.pathname === '/payments/cashfree/cancel' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    const prof = await withAuth(user.id, (client) => client.query('select tenant_id, role from profiles where id = $1', [user.id]));
    const p = prof.rows[0];
    if (!p || p.role !== 'owner') throw new HttpError(403, 'owner access required');
    await cancelAutorenew({ tenantId: p.tenant_id });
    return reply(200, { ok: true });
  }
  // Cashfree calls this server-to-server -- the signature check is the
  // only authentication it has, same discipline as the Razorpay webhook above.
  if (url.pathname === '/payments/cashfree/webhook' && req.method === 'POST') {
    const raw = await readRawBody(req, 1_000_000);
    if (!verifyCashfreeSignature(raw, req.headers['x-webhook-signature'], req.headers['x-webhook-timestamp'])) {
      throw new HttpError(400, 'invalid signature');
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad json'); }
    await handleCashfreeWebhookEvent(event);
    return reply(200, { ok: true });
  }
  return false;
}
