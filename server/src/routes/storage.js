import { pool, withAuth } from '../db.js';
import { saveSiteUpload, saveDocUpload, readDocUpload } from '../storage.js';
import { myProfile } from '../lib/guards.js';
import { HttpError, clientIp, rateLimited, readRawBody } from '../lib/http.js';

// Returns false when none of this module's routes matched, so the dispatcher in index.js tries the next module;
// any other return (including the undefined that `return reply(...)` gives) means the request was handled.
export async function handle(ctx) {
  const { req, res, url, user, ip, meta, reply, origin } = ctx;
  // ---- storage: POST /storage/site/:prefix (raw image body) ----
  const storageMatch = url.pathname.match(/^\/storage\/site\/([a-zA-Z0-9_-]+)$/);
  if (storageMatch && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    const profile = await myProfile(user.id);
    if (!profile?.tenant_id || (profile.role !== 'owner' && !(profile.role === 'manager' && storageMatch[1] === 'style'))) throw new HttpError(403, 'owner only');
    const buffer = await readRawBody(req, 8_000_000); // 8MB cap -- client already compresses to well under this
    const result = await saveSiteUpload({ tenantId: profile.tenant_id, uid: user.id, prefix: storageMatch[1], buffer });
    return reply(200, result);
  }

  // ---- storage: employee documents (private -- never under
  // Caddy's public /uploads/* file_server rule, see storage.js).
  // Payroll v2 decides with pay_doc_check(): people staff of the
  // business, or the employee themself. The old check (can this
  // session read the hr_employee record) is kept for documents of
  // the old Payroll. ----
  if (url.pathname === '/storage/doc' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    const profile = await myProfile(user.id);
    const tenantId = profile?.tenant_id;
    const empId = url.searchParams.get('empId');
    if (!tenantId || !empId) throw new HttpError(400, !tenantId ? 'could not resolve your tenant -- sign in again' : 'empId is required');
    const { rows } = await withAuth(user.id, (client) =>
      client.query(`select 1 where pay_doc_check($2) or exists (select 1 from records where tenant_id = $1 and kind = 'hr_employee' and id = $2 and not deleted)`, [tenantId, empId]),
    );
    if (!rows.length) throw new HttpError(403, 'not authorized for this employee');
    const buffer = await readRawBody(req, 10_000_000);
    const result = await saveDocUpload({ tenantId, empId, buffer });
    return reply(200, result);
  }
  const docMatch = url.pathname.match(/^\/storage\/doc\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (docMatch && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'authentication required');
    const [, tenantId, empId, filename] = docMatch;
    const profile = await myProfile(user.id);
    if (profile?.tenant_id !== tenantId) throw new HttpError(403, 'not authorized');
    const { rows } = await withAuth(user.id, (client) =>
      client.query(`select 1 where pay_doc_check($2) or exists (select 1 from records where tenant_id = $1 and kind = 'hr_employee' and id = $2 and not deleted)`, [tenantId, empId]),
    );
    if (!rows.length) throw new HttpError(403, 'not authorized for this employee');
    const doc = await readDocUpload({ tenantId, empId, filename });
    if (!doc) throw new HttpError(404, 'not found');
    res.writeHead(200, { 'Content-Type': doc.type, 'Cache-Control': 'private, max-age=31536000' });
    res.end(doc.buffer);
    return;
  }

  // ---- accounting attachments: private storage (never under Caddy's public /uploads), tenant resolved from the session.
  // acc_storage_check() raises unless accounting is on for the tenant and the caller's role may attach. ----
  if (url.pathname === '/storage/acc' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    const profile = await myProfile(user.id);
    const tenantId = profile?.tenant_id;
    if (!tenantId) throw new HttpError(400, 'could not resolve your tenant -- sign in again');
    await withAuth(user.id, (client) => client.query('select acc_storage_check() as ok'));
    const buffer = await readRawBody(req, 10_000_000);
    const saved = await saveDocUpload({ tenantId, empId: 'acc', buffer });
    return reply(200, { url: `/storage/acc/${saved.path.split('/')[0]}/${saved.path.split('/')[2]}`, contentType: saved.contentType });
  }
  const accMatch = url.pathname.match(/^\/storage\/acc\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (accMatch && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'authentication required');
    const [, tenantId, filename] = accMatch;
    const profile = await myProfile(user.id);
    if (profile?.tenant_id !== tenantId) throw new HttpError(403, 'not authorized');
    await withAuth(user.id, (client) => client.query(`select acc_guard('acc_view')`));
    const doc = await readDocUpload({ tenantId, empId: 'acc', filename });
    if (!doc) throw new HttpError(404, 'not found');
    res.writeHead(200, { 'Content-Type': doc.type, 'Cache-Control': 'private, max-age=31536000', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
    res.end(doc.buffer);
    return;
  }

  // ---- client orders: the payment screenshot (private; the secret link is the credential) ----
  const proofPost = url.pathname.match(/^\/storage\/order-proof\/([a-f0-9]{32})$/);
  if (proofPost && req.method === 'POST') {
    if (rateLimited(`orderproof:${clientIp(req)}`, 20, 60 * 60_000)) throw new HttpError(429, 'too many uploads, try again later');
    const { rows } = await pool.query('select order_proof_target($1) as id', [proofPost[1]]);
    const orderId = rows[0] && rows[0].id;
    if (!orderId) throw new HttpError(404, 'This link is not waiting for a payment.');
    const buffer = await readRawBody(req, 6_000_000);
    const saved = await saveDocUpload({ tenantId: 'orders', empId: orderId, buffer });
    await pool.query('select order_proof_record($1, $2)', [orderId, saved.path.split('/')[2]]);
    return reply(200, { ok: true });
  }
  const proofGet = url.pathname.match(/^\/storage\/order-proof\/([0-9a-f-]{36})$/);
  if (proofGet && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'authentication required');
    const { rows } = await withAuth(user.id, (client) => client.query('select admin_order_proof($1) as f', [proofGet[1]]));
    const file = rows[0] && rows[0].f;
    if (!file) throw new HttpError(404, 'no screenshot');
    const doc = await readDocUpload({ tenantId: 'orders', empId: proofGet[1], filename: file });
    if (!doc) throw new HttpError(404, 'not found');
    res.writeHead(200, { 'Content-Type': doc.type, 'Cache-Control': 'private, max-age=3600', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
    res.end(doc.buffer);
    return;
  }
  return false;
}
