import { pool, withAuth } from '../db.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';

// Storefront: (1) a read-only API for a shop's own data, called with a key the owner made; (2) Razorpay Route onboarding.
// Returns false when no route matched (see index.js).
const ROUTE_ON = () => process.env.RAZORPAY_ROUTE_ENABLED === '1' && !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET;

export async function handle(ctx) {
  const { req, url, user, ip, reply } = ctx;

  // ---- read-only API: GET /storefront-api/v1/{orders|products|inventory}?limit=&after= with Authorization: Bearer sfx_live_...
  const m = url.pathname.match(/^\/storefront-api\/v1\/(orders|products|inventory)$/);
  if (m) {
    if (req.method !== 'GET') throw new HttpError(405, 'This API is read only');
    if (rateLimited(`sfxapi-ip:${ip}`, 300, 60_000)) throw new HttpError(429, 'too many requests');
    const key = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!/^sfx_live_[a-f0-9]{48}$/.test(key)) throw new HttpError(401, 'A valid API key is required');
    if (rateLimited(`sfxapi-key:${key.slice(0, 20)}`, 120, 60_000)) throw new HttpError(429, 'too many requests for this key');
    const t = (await pool.query('select sfx_api_key_tenant($1) as t', [key])).rows[0]?.t;
    if (!t) throw new HttpError(401, 'That API key is not valid or was revoked');
    const limit = Number(url.searchParams.get('limit') || 50);
    const after = url.searchParams.get('after');
    if (after && Number.isNaN(Date.parse(after))) throw new HttpError(400, 'after must be a date like 2026-11-01T00:00:00Z');
    const data = (await pool.query('select sfx_api_read($1, $2, $3, $4) as d', [t, m[1], limit, after || null])).rows[0]?.d;
    return reply(200, { data });
  }

  // ---- Razorpay Route: start a linked account for this shop (owner or manager). Dormant until AUZslab switches Route on.
  if (url.pathname === '/payments/sfx/route/start' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'sign in first');
    if (rateLimited(`sfxroute:${user.id}`, 6, 60 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const p = await readJsonBody(req, 20_000);
    const tenant = (await pool.query('select sfx_route_owner_ok($1) as t', [user.id])).rows[0]?.t;
    if (!tenant) throw new HttpError(403, 'Only the owner or a manager can set up payouts');
    if (!ROUTE_ON()) throw new HttpError(400, 'Payouts through AUZslab are not switched on yet. AUZslab will tell you when they are.');
    const legal = String(p.legalName || '').trim().slice(0, 120); const email = String(p.email || '').trim().slice(0, 120); const phone = String(p.phone || '').replace(/\D/g, '').slice(-10);
    if (legal.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.length !== 10) throw new HttpError(400, 'Enter the legal business name, an email and a 10 digit phone number');
    const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const r = await fetch(`${process.env.RAZORPAY_API_URL || 'https://api.razorpay.com/v1'}/accounts`.replace('/v1/accounts', '/v2/accounts'), {
      method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone, type: 'route', legal_business_name: legal, business_type: String(p.businessType || 'individual').slice(0, 40), contact_name: legal,
        profile: { category: 'ecommerce', subcategory: 'fashion_and_lifestyle', addresses: { registered: { street1: String(p.street || 'Not given').slice(0, 100), city: String(p.city || '').slice(0, 40), state: String(p.state || '').slice(0, 40), postal_code: String(p.pin || '').slice(0, 6), country: 'IN' } } } }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(400, body?.error?.description || 'Razorpay did not accept these details');
    await pool.query('select sfx_route_set($1, $2::jsonb)', [tenant, JSON.stringify({ accountId: body.id, status: 'pending', legalName: legal, businessType: p.businessType, email, phone, bankAccount: p.bankAccount, ifsc: p.ifsc, note: 'Razorpay will ask for the remaining KYC details.' })]);
    return reply(200, { ok: true, status: 'pending' });
  }
  return false;
}
