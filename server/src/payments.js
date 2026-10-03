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

// Every AuzsPOS/AuzsPay/AuzsLedger price on the pricing sheet is quoted "+ GST" (db/072's own
// comment) but nothing actually charged it until now. 18% is the standard GST rate for software
// services in India, charged on the subscription only -- the one-time ₹2,179 setup fee is a flat
// amount with no GST added, charged once alongside the FIRST payment on a brand-new signup only
// (never on an addon_request -- an existing tenant was already set up). Both are plain constants,
// not admin-editable yet (same bar as addon_price_overrides' original seed values) -- revisit if
// the owner wants to tune them without a deploy.
const GST_RATE = 0.18;
const SETUP_FEE = 2179;

// Rounds to the paisa (2 decimals), same convention as priceFeatures()'s own total.
const round2 = (n) => Math.round(n * 100) / 100;

// Builds the exact itemized bill for a cart: subscription subtotal (bundle-aware, from
// priceFeatures), GST on the subscription, the flat one-time setup fee (signup only, no GST on
// it), and what's actually due today vs. the recurring monthly amount from month 2. cart.html's
// own bill preview mirrors this exactly, so what a visitor sees is what Razorpay actually
// charges -- never a naive sum.
function billFor(subtotal, { isSignup }) {
  const setupFee = isSignup ? SETUP_FEE : 0;
  const subtotalGst = round2(subtotal * GST_RATE);
  const monthlyTotal = round2(subtotal + subtotalGst);
  const dueToday = round2(subtotal + subtotalGst + setupFee);
  return { subtotal, subtotalGst, setupFee, monthlyTotal, dueToday };
}

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

// Prices a cart (db/072). Three tiers, checked in order:
//  1. An exact bundle match (db/072's `bundles`, e.g. AuzsPOS+AuzsPay at
//     the Starter price) -- bundles are NOT simple sums of the individual
//     prices, so this has to be checked before summing anything.
//  2. A single-product addon_request for a tenant that already owns a
//     product the sheet prices differently for (`addon_price_overrides`,
//     e.g. AuzsPay is Rs 999 standalone but Rs 1,399 for an existing
//     AuzsPOS customer) -- only meaningful when `tenantFeatures` is passed
//     (an addon_request always has a target tenant; a signup_request,
//     a brand-new tenant, never does).
//  3. The flat sum of product_prices -- a key with no row, or a price of
//     0 ("not priced yet", db/070's own comment), makes the WHOLE
//     request ineligible for online payment rather than silently
//     charging a partial amount; the caller falls back to the manual flow.
async function priceFeatures(client, features, { tenantFeatures } = {}) {
  const keys = Object.keys(features || {}).filter((k) => features[k] === true);
  if (!keys.length) return null;
  const sortedKeys = [...keys].sort().join(',');

  const { rows: bundleRows } = await client.query('select feature_keys, monthly_price from bundles');
  const bundleMatch = bundleRows.find((b) => [...b.feature_keys].sort().join(',') === sortedKeys);
  if (bundleMatch) return Number(bundleMatch.monthly_price);

  if (keys.length === 1 && tenantFeatures) {
    const { rows: overrideRows } = await client.query('select requires, monthly_price from addon_price_overrides where key = $1', [keys[0]]);
    const override = overrideRows.find((o) => tenantFeatures[o.requires] === true);
    if (override) return Number(override.monthly_price);
  }

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

  // Both branches read through withAuth (app.uid set to the caller), not a bare
  // pool.query -- signup_requests/addon_requests are RLS-protected on exactly
  // that ("user_id = app_uid()" / tenant ownership, db/007 and db/027), and a
  // bare pool.query (app.uid unset) would silently see zero rows for every
  // real caller, not just an attacker. Caught in testing before this ever
  // shipped against a real database -- see db/072's own comment on the
  // tenant_settings half of this same bug.
  let features, tenantFeatures, receipt;
  if (signupRequestId) {
    const row = await withAuth(userId, async (client) => {
      const { rows } = await client.query(
        `select features from signup_requests where id = $1 and user_id = $2 and status = 'pending'`,
        [signupRequestId, userId],
      );
      return rows[0];
    });
    if (!row) throw new Error('That request was not found, is not yours, or has already been handled.');
    features = row.features;
    receipt = `signup_${signupRequestId}`;
  } else {
    // addon_request_pricing_context (db/072) is SECURITY DEFINER, specifically
    // because tenant_settings has no owner-read RLS policy at all (admin-only)
    // -- it does its own ownership check (ar.user_id = app_uid(), which withAuth
    // below makes resolve correctly) and only then reads past that RLS to get
    // the target tenant's current features, needed for addon_price_overrides
    // (e.g. AuzsPay costs more as an add-on for an existing AuzsPOS tenant
    // than it does standalone).
    const ctx = await withAuth(userId, async (client) => {
      const { rows } = await client.query('select addon_request_pricing_context($1) as result', [addonRequestId]);
      return rows[0]?.result;
    });
    if (!ctx) throw new Error('That request was not found, is not yours, or has already been handled.');
    features = ctx.features;
    tenantFeatures = ctx.tenant_features;
    receipt = `addon_${addonRequestId}`;
  }

  const subtotal = await priceFeatures(pool, features, { tenantFeatures });
  if (subtotal === null) throw new Error('One or more of these products is not available for online payment yet -- use the request form instead.');
  const bill = billFor(subtotal, { isSignup: !!signupRequestId });

  const order = await razorpayApi('orders', {
    amount: Math.round(bill.dueToday * 100), // paise -- subtotal + GST + (signup only) flat setup fee, no GST on the fee
    currency: 'INR',
    receipt,
    notes: {
      signup_request_id: signupRequestId || '', addon_request_id: addonRequestId || '',
      subtotal: String(bill.subtotal), gst: String(bill.subtotalGst), setup_fee: String(bill.setupFee),
    },
  });

  await pool.query(
    `insert into payments (razorpay_order_id, user_id, signup_request_id, addon_request_id, amount, status)
     values ($1, $2, $3, $4, $5, 'created')`,
    [order.id, userId, signupRequestId || null, addonRequestId || null, bill.dueToday],
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
