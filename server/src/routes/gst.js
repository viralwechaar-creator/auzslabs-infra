import { withAuth } from '../db.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';
import { gstEnabled, gstinValid, lookup } from '../gst.js';

// GET /gst/config, POST /gst/lookup {gstin}: fills party / business details from a GST number (AUZsLedger, AUZsScan, AUZsFinance).
export async function handle(ctx) {
  const { req, url, user, reply } = ctx;
  if (url.pathname === '/gst/config' && req.method === 'GET') return reply(200, { enabled: gstEnabled() });
  if (url.pathname !== '/gst/lookup' || req.method !== 'POST') return false;
  if (!user) throw new HttpError(401, 'Sign in first.');
  if (rateLimited('gst:' + user.id, 30, 10 * 60_000)) throw new HttpError(429, 'Too many lookups. Try again in a few minutes.');
  const body = await readJsonBody(req);
  const gstin = String(body.gstin || '').trim().toUpperCase();
  if (!gstinValid(gstin)) throw new HttpError(400, 'That GST number does not look right. Check it and try again.');
  const tenantId = (await withAuth(user.id, (c) => c.query('select gst_lookup_allowed() as t'))).rows[0].t;
  if (!tenantId) throw new HttpError(403, 'GST lookup is not part of your plan.');
  const r = await lookup({ gstin, tenantId, userId: user.id });
  if (r.error) throw new HttpError(r.error, r.message);
  return reply(200, r);
}
