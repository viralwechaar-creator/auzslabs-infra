import crypto from 'node:crypto';
import { pool } from './db.js';
import { priceInfo } from './payments.js';

// Cashfree Subscriptions (recurring auto-renewal). Same dormant-until-
// configured discipline as payments.js's Razorpay integration -- with no
// keys set, every function here throws "not configured yet" and the
// manual renewal flow (owner chases payment, updates renewal_date by
// hand) is completely unchanged. See db/116's own comment for the owner
// decisions this was built against, and the "not yet tested against a
// real sandbox" caveat -- read that before trusting this in production.
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const CASHFREE_WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET || '';
// 'test' (sandbox.cashfree.com) until explicitly switched to 'prod' -- never default to live money.
const CASHFREE_ENV = process.env.CASHFREE_ENV === 'prod' ? 'prod' : 'test';
const BASE = CASHFREE_ENV === 'prod' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

export const cashfreeConfigured = () => !!(CASHFREE_APP_ID && CASHFREE_SECRET_KEY);

async function cashfreeApi(path, method, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-client-id': CASHFREE_APP_ID,
      'x-client-secret': CASHFREE_SECRET_KEY,
      'x-api-version': '2023-08-01',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Cashfree API error (${res.status})`);
  return data;
}

// Starts auto-renewal for the caller's own tenant, at their current
// entitled products' monthly price (bundle-aware, via payments.js's own
// priceInfo -- the same pricing rule as a fresh signup, just priced
// against what this tenant already owns instead of a cart). Returns the
// authorization link the owner must open to approve the recurring debit
// (UPI Autopay / eNACH / card, Cashfree's choice at authorization time) --
// nothing is charged until they do.
export async function startAutorenew({ userId, tenantId, tenantName, email, phone }) {
  if (!cashfreeConfigured()) throw new Error('Auto-renewal is not set up yet -- renew manually for now.');

  const { rows: fr } = await pool.query('select features from tenant_settings where tenant_id = $1', [tenantId]);
  const features = fr[0]?.features || {};
  const info = await priceInfo(pool, features, { period: 'month' });
  if (!info || info.subtotal <= 0) throw new Error('Your current plan cannot be auto-renewed online yet -- contact AUZslab.');

  const subscriptionId = `autorenew_${tenantId}_${Date.now()}`;
  const planId = `plan_${tenantId}`;

  // A Cashfree subscription plan is created (or reused) per tenant, then
  // a subscription instance against it -- two calls, matching their
  // documented two-step flow. If the plan already exists this first call
  // is expected to fail with a "plan already exists"-shaped error; that
  // is swallowed deliberately since the plan itself never needs editing
  // (amount comes from priceInfo fresh each time a tenant restarts
  // auto-renewal, which creates a new plan id only if the amount changed
  // -- see planId below).
  const amountPlanId = `${planId}_${Math.round(info.subtotal * 100)}`;
  try {
    await cashfreeApi('/subscriptions/plans', 'POST', {
      plan_id: amountPlanId,
      plan_name: `AUZslab monthly - ${tenantName}`,
      plan_type: 'PERIODIC',
      plan_currency: 'INR',
      plan_recurring_amount: info.subtotal,
      plan_max_amount: info.subtotal,
      plan_max_cycles: 0, // 0 = no end date, matches "renews every month until cancelled"
      plan_intervals: 1,
      plan_interval_type: 'MONTH',
    });
  } catch (err) {
    if (!/already exists/i.test(err.message || '')) throw err;
  }

  const sub = await cashfreeApi('/subscriptions', 'POST', {
    subscription_id: subscriptionId,
    plan_details: { plan_id: amountPlanId },
    customer_details: { customer_name: tenantName, customer_email: email, customer_phone: phone || '9999999999' },
    authorization_details: { authorization_amount: 1, authorization_amount_refund: true },
    subscription_first_charge_time: 'AT_THE_END_OF_AUTHORIZATION',
  });

  await pool.query(
    `insert into subscriptions (tenant_id, provider_sub_id, status, amount, feature_keys, created_by)
     values ($1, $2, 'created', $3, $4, $5)`,
    [tenantId, subscriptionId, info.subtotal, JSON.stringify(Object.keys(features).filter((k) => features[k] === true)), userId],
  );

  return { authLink: sub.authorization_details?.authorization_link || sub.subscription_session_id || null, subscriptionId };
}

export async function cancelAutorenew({ tenantId }) {
  const { rows } = await pool.query(`select provider_sub_id from subscriptions where tenant_id = $1 and status not in ('cancelled') order by created_at desc limit 1`, [tenantId]);
  const row = rows[0];
  if (!row) return; // nothing to cancel -- a no-op, not an error
  if (cashfreeConfigured()) {
    try { await cashfreeApi(`/subscriptions/${row.provider_sub_id}/cancel`, 'POST', {}); } catch { /* best-effort -- the row below still records intent */ }
  }
  await pool.query(`update subscriptions set status = 'cancelled', cancelled_at = now() where provider_sub_id = $1`, [row.provider_sub_id]);
}

// Cashfree signs webhooks as base64(hmac_sha256(timestamp + rawBody, webhook_secret))
// in the x-webhook-signature header, with the timestamp in x-webhook-timestamp
// (per their published Payment Gateway webhook spec). NOT verified against a
// real Cashfree delivery from this environment -- confirm this still matches
// before relying on it; if it doesn't, deliveries will just fail signature
// verification safely (400), never silently accept an unverified event.
export function verifyWebhookSignature(rawBody, signatureHeader, timestampHeader) {
  if (!CASHFREE_WEBHOOK_SECRET || !signatureHeader || !timestampHeader) return false;
  const expected = crypto.createHmac('sha256', CASHFREE_WEBHOOK_SECRET).update(timestampHeader + rawBody).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(String(signatureHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Called only after verifyWebhookSignature has passed. Idempotent (an
// already-recorded charge for the same cycle is a no-op). On success,
// extends the tenant's renewal_date by one month -- the same field an
// admin updates by hand today, so the renewal-reminder job (db/098) and
// every app's "Plan & account" sheet keep working unchanged. On failure,
// ONLY flags it (status + a platform-admin notification, same table
// renewal_notify_run already uses) -- never touches entitlement or
// access, per the owner's own "never auto-suspend" decision.
export async function handleWebhookEvent(event) {
  const type = event?.type || event?.event; // Cashfree's own field name for this may differ; both checked defensively
  const data = event?.data?.subscription || event?.data || {};
  const subscriptionId = data.subscription_id || data.cf_subscription_id;
  if (!subscriptionId) return;

  const { rows } = await pool.query('select id, tenant_id from subscriptions where provider_sub_id = $1', [subscriptionId]);
  const row = rows[0];
  if (!row) return;

  if (/AUTHORIZED|ACTIVE/i.test(String(type))) {
    await pool.query(`update subscriptions set status = 'active', authorized_at = coalesce(authorized_at, now()) where id = $1`, [row.id]);
  } else if (/CHARGE.*SUCCESS|PAYMENT.*SUCCESS/i.test(String(type))) {
    await pool.query(
      `update subscriptions set status = 'active', last_charge_status = 'success', last_charge_at = now(),
         next_charge_on = (current_date + interval '1 month')::date where id = $1`,
      [row.id],
    );
    await pool.query(`update tenants set renewal_date = (current_date + interval '1 month')::date where id = $1`, [row.tenant_id]);
  } else if (/CHARGE.*FAILED|PAYMENT.*FAILED/i.test(String(type))) {
    await pool.query(`update subscriptions set status = 'payment_failed', last_charge_status = 'failed', last_charge_at = now() where id = $1`, [row.id]);
    const { rows: tr } = await pool.query('select name from tenants where id = $1', [row.tenant_id]);
    await pool.query(
      `insert into notifications(tenant_id, type, title, body) values (null, 'renewal', $1, $2)`,
      [`Auto-renewal failed: ${tr[0]?.name || row.tenant_id}`, 'Their card/UPI autopay declined. Follow up manually -- access was not changed.'],
    );
  }
}
