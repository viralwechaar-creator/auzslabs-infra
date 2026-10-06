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
// services in India, charged on the subscription only -- the one-time ₹2,179 setup fee is a flat
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
const SETUP_FEE = 2179;

// Rounds to the paisa (2 decimals), same convention as priceFeatures()'s own total.
const round2 = (n) => Math.round(n * 100) / 100;

// Builds the exact itemized bill for a cart: subscription subtotal (bundle-aware, from
// priceFeatures), GST on the subscription, the flat one-time setup fee (signup only, no GST on
// it), and what's actually due today vs. the recurring monthly amount from month 2. cart.html's
// own bill preview mirrors this exactly, so what a visitor sees is what Razorpay actually
// charges -- never a naive sum.
function billFor(subtotal, { isSignup, exempt = 0, setupExempt = false, gstRate = 0 }) {
  const setupFee = isSignup && !setupExempt ? SETUP_FEE : 0;
  const subtotalGst = round2((subtotal - exempt) * gstRate);
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
//  1. An exact bundle match (db/072's `bundles`, e.g. AUZsPOS+AUZsPay at
//     the Starter price) -- bundles are NOT simple sums of the individual
//     prices, so this has to be checked before summing anything.
//  2. A single-product addon_request for a tenant that already owns a
//     product the sheet prices differently for (`addon_price_overrides`,
//     e.g. AUZsPay is Rs 999 standalone but Rs 1,399 for an existing
//     AUZsPOS customer) -- only meaningful when `tenantFeatures` is passed
//     (an addon_request always has a target tenant; a signup_request,
//     a brand-new tenant, never does).
//  3. The flat sum of product_prices -- a key with no row, or a price of
//     0 ("not priced yet", db/070's own comment), makes the WHOLE
//     request ineligible for online payment rather than silently
//     charging a partial amount; the caller falls back to the manual flow.
async function priceFeatures(client, features, { tenantFeatures, period = 'month' } = {}) {
  const info = await priceInfo(client, features, { tenantFeatures, period });
  return info ? info.subtotal : null;
}

// Prices a cart and says which part of it is GST-exempt and whether the one-time setup fee applies.
// A bundle or an add-on override replaces the per-product prices, so nothing in it is exempt (none of today's
// bundles contain an exempt product). Yearly pricing only exists for carts of products that have a yearly price.
async function priceInfo(client, features, { tenantFeatures, period = 'month' } = {}) {
  const keys = Object.keys(features || {}).filter((k) => features[k] === true);
  if (!keys.length) return null;
  const sortedKeys = [...keys].sort().join(',');

  const { rows: bundleRows } = await client.query('select feature_keys, monthly_price, yearly_price from bundles where active');
  const bundleMatch = bundleRows.find((b) => [...b.feature_keys].sort().join(',') === sortedKeys);
  if (bundleMatch) {
    const bp = Number(period === 'year' ? bundleMatch.yearly_price : bundleMatch.monthly_price);
    return bp > 0 ? { subtotal: bp, exempt: 0, setupExempt: false } : null; // no yearly price on this bundle -> monthly only
  }

  if (keys.length === 1 && tenantFeatures) {
    const { rows: overrideRows } = await client.query('select requires, monthly_price from addon_price_overrides where key = $1', [keys[0]]);
    const override = overrideRows.find((o) => tenantFeatures[o.requires] === true);
    if (override) return period === 'year' ? null : { subtotal: Number(override.monthly_price), exempt: 0, setupExempt: false };
  }

  const { rows } = await client.query('select key, monthly_price, yearly_price, gst_exempt, setup_fee_exempt from product_prices where key = any($1)', [keys]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let total = 0, exempt = 0, setupExempt = true;
  for (const k of keys) {
    const r = byKey.get(k);
    const p = r ? Number(period === 'year' ? r.yearly_price : r.monthly_price) : 0;
    if (!p || p <= 0) return null; // unpriced (or no yearly price) product in the mix -- no online checkout for this request
    total += p;
    if (r.gst_exempt) exempt += p;
    if (!r.setup_fee_exempt) setupExempt = false;
  }
  return { subtotal: Math.round(total * 100) / 100, exempt: Math.round(exempt * 100) / 100, setupExempt };
}

// Creates a Razorpay order for a pending signup_request or
// addon_request the calling user owns, and records it in `payments`.
// Returns what the client needs to open Checkout.js. Throws a plain
// Error with a user-facing message on any failure (unpriced cart,
// wrong owner, Razorpay itself down) -- index.js wraps it as a 400.
export async function createOrder({ userId, signupRequestId, addonRequestId, period = 'month' }) {
  if (period !== 'month' && period !== 'year') throw new Error('unknown billing period');
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
    // (e.g. AUZsPay costs more as an add-on for an existing AUZsPOS tenant
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

  const info = await priceInfo(pool, features, { tenantFeatures, period });
  if (info === null) throw new Error(period === 'year' ? 'Yearly billing is not available for this combination of products -- choose monthly.' : 'One or more of these products is not available for online payment yet -- use the request form instead.');
  const bill = billFor(info.subtotal, { isSignup: !!signupRequestId, exempt: info.exempt, setupExempt: info.setupExempt, gstRate: (await gstPct()) / 100 });

  const order = await razorpayApi('orders', {
    amount: Math.round(bill.dueToday * 100), // paise -- subtotal + GST + (signup only) flat setup fee, no GST on the fee
    currency: 'INR',
    receipt,
    notes: {
      signup_request_id: signupRequestId || '', addon_request_id: addonRequestId || '',
      subtotal: String(bill.subtotal), gst: String(bill.subtotalGst), setup_fee: String(bill.setupFee), period,
    },
  });

  await pool.query(
    `insert into payments (razorpay_order_id, user_id, signup_request_id, addon_request_id, amount, status, period)
     values ($1, $2, $3, $4, $5, 'created', $6)`,
    [order.id, userId, signupRequestId || null, addonRequestId || null, bill.dueToday, period],
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
