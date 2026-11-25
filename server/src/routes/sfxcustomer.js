import { pool } from '../db.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';
import { sendCustomerLoginCode } from '../mail.js';

// Storefront customers: ask for a sign-in code. The answer is always the same ("if we know you, a code is on its way")
// so nobody can use this to find out who has shopped at a store. The code is made in the database (only a hash is kept)
// and sent here by email or WhatsApp. Returns false when no route matched (see index.js).
export async function handle(ctx) {
  const { req, url, ip, reply } = ctx;
  if (url.pathname !== '/storefront/customer/code' || req.method !== 'POST') return false;
  if (rateLimited(`sfxcode:${ip}`, 12, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
  const { slug, contact } = await readJsonBody(req, 5_000);
  const k = String(contact || '').trim().slice(0, 200);
  if (!slug || !k) throw new HttpError(400, 'Enter your phone number or email');
  if (rateLimited(`sfxcode:${String(slug).toLowerCase()}:${k.toLowerCase()}`, 5, 60 * 60_000)) return reply(200, { ok: true });
  try {
    const { rows } = await pool.query('select sfx_customer_code_issue($1, $2) as r', [String(slug).toLowerCase(), k]);
    const r = rows[0]?.r;
    if (r) {
      const shop = (await pool.query('select name from tenants where id = $1', [r.tenantId])).rows[0]?.name || 'the store';
      if (r.viaEmail && r.email) await sendCustomerLoginCode({ to: r.email, shop, code: r.code });
      else if (r.phone) await pool.query("select wa_enqueue($1, $2, 'sfx_login_code', $3::jsonb, $4)", [r.tenantId, r.phone, JSON.stringify([shop, r.code]), 'login-' + Date.now()]);
    }
  } catch (err) { console.warn('storefront customer code failed', err.message); }
  return reply(200, { ok: true });
}
