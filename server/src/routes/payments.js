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
