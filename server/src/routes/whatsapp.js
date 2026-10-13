import { pool, withAuth } from '../db.js';
import { HttpError, rateLimited, readJsonBody, readRawBody } from '../lib/http.js';
import { connectShopNumber, handleWebhookEvent, verifyChallenge, verifyWebhookSignature, waPlatformConfigured } from '../whatsapp.js';

// Returns false when none of this module's routes matched (see index.js).
export async function handle(ctx) {
  const { req, url, user, ip, reply } = ctx;

  // ---- Meta's webhook. GET = the one-time "verify this URL" handshake; POST = delivery receipts and replies,
  // authenticated ONLY by the HMAC signature (same discipline as the payment webhooks). ----
  if (url.pathname === '/whatsapp/webhook') {
    if (req.method === 'GET') {
      if (!verifyChallenge(url.searchParams.get('hub.mode'), url.searchParams.get('hub.verify_token'))) throw new HttpError(403, 'forbidden');
      ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
      ctx.res.end(url.searchParams.get('hub.challenge') || '');
      return;
    }
    if (req.method === 'POST') {
      const raw = await readRawBody(req, 2_000_000);
      if (!verifyWebhookSignature(raw, req.headers['x-hub-signature-256'])) throw new HttpError(400, 'invalid signature');
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad json'); }
      await handleWebhookEvent(body);
      return reply(200, { ok: true });
    }
  }

  // Whether the AUZslab number is set up (so the admin screen can say so). No secrets.
  if (url.pathname === '/whatsapp/config' && req.method === 'GET') {
    return reply(200, { platform: waPlatformConfigured() });
  }

  // ---- A shop owner connects / disconnects their own WhatsApp number. The token goes straight to the server and is
  // stored encrypted; nothing ever sends it back. ----
  if (url.pathname === '/whatsapp/connect' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`waconnect:${ip}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const prof = await withAuth(user.id, (c) => c.query('select tenant_id, role from profiles where id = $1', [user.id]));
    const p = prof.rows[0];
    if (!p || p.role !== 'owner') throw new HttpError(403, 'owner access required');
    const demo = await pool.query('select is_demo from tenants where id = $1', [p.tenant_id]);
    if (demo.rows[0]?.is_demo) throw new HttpError(403, 'not available on the demo');
    const { phone_number_id, waba_id, token } = await readJsonBody(req);
    try {
      return reply(200, { ok: true, ...(await connectShopNumber({ tenantId: p.tenant_id, phoneNumberId: phone_number_id, wabaId: waba_id, token })) });
    } catch (err) { throw new HttpError(400, err.message); }
  }
  return false;
}
