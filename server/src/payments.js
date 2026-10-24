import crypto from 'node:crypto';
import { pool, withAuth } from './db.js';

// Razorpay (cards/UPI/netbanking for Indian customers). Same
// dormant-until-configured pattern as mail.js/sms.js/the Google+Apple
// sign-in providers in auth.js: with no keys set, every function here
// throws a plain "not configured yet" and the caller (index.js) turns
// that into a normal error response -- the existing manual
// request-then-platform-admin-approves flow (db/007/db/027) is never
// touched by any of this.
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

export const razorpayConfigured = () => !!(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);

// Every AUZsPOS/AUZsPay/AUZsLedger price on the pricing sheet is quoted "+ GST" (db/072's own
// comment) but nothing actually charged it until now. 18% is the standard GST rate for software
// services in India, charged on the subscription only -- the one-time ₹2,190 setup fee is a flat
// amount with no GST added, charged once alongside the FIRST payment on a brand-new signup only
// (never on an addon_request -- an existing tenant was already set up). Both are plain constants,
// not admin-editable yet (same bar as addon_price_overrides' original seed values) -- revisit if
// the owner wants to tune them without a deploy.
// GST is a runtime switch (platform_flags 'gst_rate_pct', 0 until AUZslab is GST-registered, db/102).
export async function gstPct() {
  try {
    const { rows } = await pool.query(`select value from platform_flags where key = 'gst_rate_pct'`);
    const n = Number(rows[0]?.value);
    return Number.isFinite(n) && n >= 0 && n <= 40 ? n : 0;
  } catch { return 0; }
}


// The publishable half (key_id) is safe to hand to the browser --
// Checkout.js needs it to open the payment modal. key_secret and the
// webhook secret never leave this file.
export function paymentConfig() {
  return { enabled: razorpayConfigured(), keyId: razorpayConfigured() ? RAZORPAY_KEY_ID : null };
}

async function razorpayApi(path, body) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`${process.env.RAZORPAY_API_URL || 'https://api.razorpay.com/v1'}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.description || `Razorpay API error (${res.status})`);
  return data;
}

// Online payment for a request-first order (db/155, db/200). The token in the pay link is the only
// credential (same as the page itself), so this needs no login. The charge is exactly the saved quote
// total; the order is created here and only the signed webhook can ever mark it paid.
export async function createClientOrderPayment({ token, terms }) {
  if (!razorpayConfigured()) throw new Error('Online payment is not switched on yet. Please pay by UPI and send the screenshot.');
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new Error('This link is not valid.');
  const { rows } = await pool.query('select order_online_start($1, $2) as result', [token, !!terms]);
  const o = rows[0]?.result;
  const paise = Math.round(Number(o.total) * 100);
  if (!(paise >= 100)) throw new Error('This request has no amount to pay yet.');
  const order = await razorpayApi('orders', {
    amount: paise,
    currency: 'INR',
    receipt: `corder_${String(o.id).replace(/-/g, '').slice(0, 24)}`,
    notes: { client_order_id: String(o.id), business: String(o.business_name || '').slice(0, 80) },
  });
  await pool.query(
    `insert into payments (razorpay_order_id, user_id, client_order_id, amount, status, period) values ($1, null, $2, $3, 'created', 'month')`,
    [order.id, o.id, Number(o.total)],
  );
  return {
    orderId: order.id, amount: order.amount, currency: order.currency, keyId: RAZORPAY_KEY_ID,
    prefill: { name: o.contact_name || '', email: o.email || '', contact: o.phone || '' },
    description: `AUZslab: ${o.business_name || 'your order'}`,
  };
}

// ---- Renewal: pay the next period now, or switch on auto-debit (Razorpay Subscriptions, db/201) ----
const OWNER_TENANT = async (userId) => {
  const prof = await withAuth(userId, (client) => client.query('select tenant_id, role from profiles where id = $1', [userId]));
  const p = prof.rows[0];
  if (!p || p.role !== 'owner') { const e = new Error('owner access required'); e.status = 403; throw e; }
  return p.tenant_id;
};
export async function createRenewalOrder({ userId }) {
  const tenantId = await OWNER_TENANT(userId);
  const { rows } = await pool.query('select renewal_order_create($1, $2) as result', [tenantId, userId]);
  return rows[0].result;
}
export async function startRazorpayAutorenew({ userId, email }) {
  if (!razorpayConfigured()) throw new Error('Auto-renewal is not set up yet. Renew by hand for now.');
  const tenantId = await OWNER_TENANT(userId);
  const { rows: ex } = await pool.query(`select 1 from subscriptions where tenant_id = $1 and status <> 'cancelled' limit 1`, [tenantId]);
  if (ex.length) throw new Error('Auto-renewal is already on.');
  const { rows: q } = await pool.query('select renewal_quote($1) as result', [tenantId]);
  const rq = q[0].result;
  if (!rq) throw new Error('Your plan was set up by AUZslab directly. Please contact us to switch on auto-renewal.');
  if (rq.error) throw new Error('Your plan has products on different billing periods. Please contact us to switch on auto-renewal.');
  const total = Number(rq.totals.total);
  const yearly = rq.period === 'year';
  const { rows: tr } = await pool.query('select name, renewal_date from tenants where id = $1', [tenantId]);
  const plan = await razorpayApi('plans', { period: yearly ? 'yearly' : 'monthly', interval: 1, item: { name: `AUZslab ${yearly ? 'yearly' : 'monthly'} - ${String(tr[0]?.name || '').slice(0, 60)}`, amount: Math.round(total * 100), currency: 'INR' }, notes: { tenant_id: String(tenantId) } });
  const body = { plan_id: plan.id, total_count: yearly ? 10 : 120, customer_notify: 1, notes: { tenant_id: String(tenantId) } };
  // The first auto-debit lands on the renewal date (never before the period already paid for ends)
  const rd = tr[0]?.renewal_date ? new Date(String(tr[0].renewal_date).slice(0, 10) + 'T00:30:00+05:30') : null;
  if (rd && rd.getTime() - Date.now() > 24 * 3600 * 1000) body.start_at = Math.floor(rd.getTime() / 1000);
  const sub = await razorpayApi('subscriptions', body);
  const { rows: f } = await pool.query('select features from tenant_settings where tenant_id = $1', [tenantId]);
  const features = f[0]?.features || {};
  await pool.query(
    `insert into subscriptions (tenant_id, provider, provider_sub_id, provider_plan_id, status, period, amount, feature_keys, created_by)
     values ($1, 'razorpay', $2, $3, 'created', $4, $5, $6, $7)`,
    [tenantId, sub.id, plan.id, yearly ? 'year' : 'month', total, JSON.stringify(Object.keys(features).filter((k) => features[k] === true)), userId],
  );
  return { authLink: sub.short_url || null, subscriptionId: sub.id };
}
export async function cancelRazorpayAutorenew({ subId }) {
  try { await razorpayApi(`subscriptions/${subId}/cancel`, { cancel_at_cycle_end: 0 }); } catch { /* best effort: the row below still records the owner's choice */ }
}

// Raw-body HMAC-SHA256 verification against Razorpay's published
// algorithm (https://razorpay.com/docs/webhooks/validate-test/) --
// the signature MUST be computed over the exact raw bytes Razorpay
// sent, before any JSON.parse, or a byte-for-byte-identical payload
// with different key ordering would fail to verify.
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!RAZORPAY_WEBHOOK_SECRET || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signatureHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Called only after verifyWebhookSignature has already passed --
// never trust the client's own "payment succeeded" callback (that's
// just a UI hint to start polling payment_status, see cart.html).
// Razorpay delivers webhooks at-least-once and does retry, so every
// step here is idempotent: a payment already marked 'paid', or a
// signup/addon request already 'approved', is a no-op, not an error.
export async function handleWebhookEvent(event) {
  const ev = String(event.event || '');
  // A failed attempt: remember why (a client keeps failing -> the admin is told).
  if (ev === 'payment.failed') {
    const pf = event.payload?.payment?.entity;
    if (pf?.order_id) await pool.query('select online_payment_failed($1, $2, $3)', [pf.order_id, pf.id || null, pf.error_description || pf.error_reason || null]);
    return;
  }
  // Auto-renewal (Razorpay Subscriptions): authorised, charged, halted/pending (a charge failed) or cancelled.
  if (ev.startsWith('subscription.')) {
    const sub = event.payload?.subscription?.entity;
    const pay = event.payload?.payment?.entity;
    if (!sub?.id) return;
    const kind = { 'subscription.authenticated': 'authenticated', 'subscription.activated': 'activated', 'subscription.charged': 'charged', 'subscription.pending': 'failed', 'subscription.halted': 'failed', 'subscription.cancelled': 'cancelled', 'subscription.completed': 'completed' }[ev];
    if (!kind) return;
    await pool.query('select subscription_event($1, $2, $3, $4, $5)', [sub.id, kind, pay?.id || null, pay?.amount != null ? Number(pay.amount) / 100 : null, ev === 'subscription.halted' ? 'retries used up' : ev === 'subscription.pending' ? 'a charge was declined' : null]);
    return;
  }
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') return;
  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id) return;

  const { rows } = await pool.query('select id, status, signup_request_id, addon_request_id, client_order_id from payments where razorpay_order_id = $1', [payment.order_id]);
  const row = rows[0];
  if (!row) return; // an order this server never created, or a test event -- nothing to do
  if (row.status !== 'paid') {
    await pool.query(`update payments set status = 'paid', razorpay_payment_id = $1, paid_at = now() where id = $2`, [payment.id, row.id]);
  }

  if (row.client_order_id) {
    // request-first order: runs the admin's own confirm step (access, bill number, renewals). Never throws; a mismatch tells the admin.
    await pool.query('select online_confirm_order_payment($1, $2, $3)', [row.client_order_id, payment.id, Number(payment.amount) / 100]);
    return;
  }
  if (row.signup_request_id) await pool.query('select provision_from_payment($1)', [row.id]);
  else await pool.query('select provision_addon_from_payment($1)', [row.id]);
}
