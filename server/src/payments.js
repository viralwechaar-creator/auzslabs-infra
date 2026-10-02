import crypto from 'node:crypto';
import { pool } from './db.js';

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

// The publishable half (key_id) is safe to hand to the browser --
// Checkout.js needs it to open the payment modal. key_secret and the
// webhook secret never leave this file.
export function paymentConfig() {
  return { enabled: razorpayConfigured(), keyId: razorpayConfigured() ? RAZORPAY_KEY_ID : null };
}

async function razorpayApi(path, body) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.description || `Razorpay API error (${res.status})`);
  return data;
}

// Sums product_prices for exactly the keys that are `true` in a
// features object (a signup_request's or addon_request's own
// `features` column) -- a key with no row, or a price of 0 ("not
// priced yet" -- see db/070's own comment), makes the WHOLE request
// ineligible for online payment rather than silently charging a
// partial amount; the caller falls back to the manual flow for that case.
async function priceFeatures(client, features) {
  const keys = Object.keys(features || {}).filter((k) => features[k] === true);
  if (!keys.length) return null;
  const { rows } = await client.query('select key, monthly_price from product_prices where key = any($1)', [keys]);
  const priced = new Map(rows.map((r) => [r.key, Number(r.monthly_price)]));
  let total = 0;
  for (const k of keys) {
    const p = priced.get(k);
    if (!p || p <= 0) return null; // unpriced product in the mix -- no online checkout for this request
    total += p;
  }
  return Math.round(total * 100) / 100;
}

// Creates a Razorpay order for a pending signup_request or
// addon_request the calling user owns, and records it in `payments`.
// Returns what the client needs to open Checkout.js. Throws a plain
// Error with a user-facing message on any failure (unpriced cart,
// wrong owner, Razorpay itself down) -- index.js wraps it as a 400.
export async function createOrder({ userId, signupRequestId, addonRequestId }) {
  if (!razorpayConfigured()) throw new Error('Online payment is not set up yet -- use the request form instead.');
  if ((signupRequestId && addonRequestId) || (!signupRequestId && !addonRequestId)) {
    throw new Error('exactly one of signupRequestId or addonRequestId is required');
  }

  let features, receipt;
  if (signupRequestId) {
    const { rows } = await pool.query(
      `select features from signup_requests where id = $1 and user_id = $2 and status = 'pending'`,
      [signupRequestId, userId],
    );
    if (!rows[0]) throw new Error('That request was not found, is not yours, or has already been handled.');
    features = rows[0].features;
    receipt = `signup_${signupRequestId}`;
  } else {
    const { rows } = await pool.query(
      `select features from addon_requests where id = $1 and user_id = $2 and status = 'pending'`,
      [addonRequestId, userId],
    );
    if (!rows[0]) throw new Error('That request was not found, is not yours, or has already been handled.');
    features = rows[0].features;
    receipt = `addon_${addonRequestId}`;
  }

  const amount = await priceFeatures(pool, features);
  if (amount === null) throw new Error('One or more of these products is not available for online payment yet -- use the request form instead.');

  const order = await razorpayApi('orders', {
    amount: Math.round(amount * 100), // paise
    currency: 'INR',
    receipt,
    notes: { signup_request_id: signupRequestId || '', addon_request_id: addonRequestId || '' },
  });

  await pool.query(
    `insert into payments (razorpay_order_id, user_id, signup_request_id, addon_request_id, amount, status)
     values ($1, $2, $3, $4, $5, 'created')`,
    [order.id, userId, signupRequestId || null, addonRequestId || null, amount],
  );

  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: RAZORPAY_KEY_ID };
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
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') return;
  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id) return;

  const { rows } = await pool.query('select id, status, signup_request_id, addon_request_id from payments where razorpay_order_id = $1', [payment.order_id]);
  const row = rows[0];
  if (!row) return; // an order this server never created, or a test event -- nothing to do
  if (row.status !== 'paid') {
    await pool.query(`update payments set status = 'paid', razorpay_payment_id = $1, paid_at = now() where id = $2`, [payment.id, row.id]);
  }

  if (row.signup_request_id) await pool.query('select provision_from_payment($1)', [row.id]);
  else await pool.query('select provision_addon_from_payment($1)', [row.id]);
}
