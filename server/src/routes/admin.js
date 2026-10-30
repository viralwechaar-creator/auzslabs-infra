import { pool, withAuth } from '../db.js';
import { createUser, resetToRandomPassword, signToken, listSessions, revokeAllSessionsForUser } from '../auth.js';
import { saveSiteUpload, getUploadsDiskUsage, getTenantFileSizes } from '../storage.js';
import { metricsReport, tenantUsage } from '../metrics.js';
import { sendStaffInviteEmail } from '../mail.js';
import { safeResetBase } from '../config.js';
import { myProfile } from '../lib/guards.js';
import { HttpError, rateLimited, readJsonBody, readRawBody } from '../lib/http.js';
import { signLicence, verifyLicence, publicFromPrivate, PRODUCTS } from '../licence.js';

// Returns false when none of this module's routes matched, so the dispatcher in index.js tries the next module;
// any other return (including the undefined that `return reply(...)` gives) means the request was handled.
export async function handle(ctx) {
  const { req, res, url, user, ip, meta, reply, origin } = ctx;
  // ---- admin: provision-owner (was a Supabase Edge Function) ----
  if (url.pathname === '/admin/provision-owner' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'unauthorized');
    // platform_admins has RLS (id = app_uid()) -- a bare pool.query here
    // never sets app.uid, so the row is invisible and this check fails
    // for every caller regardless of admin status. Must go through
    // withAuth like every other query that touches an RLS-protected table.
    const { rows } = await withAuth(user.id, (client) =>
      client.query('select 1 from platform_admins where id = $1', [user.id]),
    );
    if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
    const body = await readJsonBody(req);
    if (!body.tenant_id || (!body.email && !body.trial)) throw new HttpError(400, 'tenant_id and email are required');
    const created = await createUser({
      email: body.email,
      password: crypto.randomUUID(),
      app_metadata: { tenant_id: body.tenant_id, role: 'owner' },
      user_metadata: { name: body.name || '' },
    });
    const tempPassword = await resetToRandomPassword(created.id);
    // shared with the new owner directly (e.g. over WhatsApp) -- see
    // resetToRandomPassword's own note on why this replaces a
    // recovery-link email.
    return reply(200, { user_id: created.id, temp_password: tempPassword });
  }

  // ---- staff invite: send the verification email (Resend) ----
  // Separate from invite_staff itself because Postgres can't make an
  // outbound HTTPS call -- invite_staff (db/044) only ever creates
  // the token; this is what actually emails it, from account.html
  // right after that RPC succeeds.
  if (url.pathname === '/staff/send-invite-email' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    const profile = await myProfile(user.id);
    if (profile?.role !== 'owner') throw new HttpError(403, 'owner only');
    const body = await readJsonBody(req);
    if (!body.email || !body.verify_link) throw new HttpError(400, 'email and verify_link are required');
    // Not an open mail relay: the link in the mail must open on our own site, and one owner can only send so many a day.
    if (rateLimited(`staffinvite:${user.id}`, 30, 24 * 60 * 60_000)) throw new HttpError(429, 'too many invites sent today');
    if (safeResetBase(body.verify_link) !== (() => { try { const u = new URL(String(body.verify_link)); return u.origin + u.pathname + u.search; } catch { return null; } })()) throw new HttpError(400, 'invalid link');
    const sent = await sendStaffInviteEmail({ to: body.email, name: body.name || '', verifyLink: body.verify_link });
    return reply(200, sent);
  }

  // ---- admin: uploads disk usage (System resources panel) ----
  // Not a Postgres RPC like the rest of that panel -- Postgres has no
  // way to stat a directory on the API container's filesystem, so
  // this stays a plain HTTP endpoint the admin.html page fetches
  // alongside admin_system_stats and merges into the same display.
  if (url.pathname === '/admin/uploads-usage' && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'unauthorized');
    const { rows } = await withAuth(user.id, (client) =>
      client.query('select 1 from platform_admins where id = $1', [user.id]),
    );
    if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
    return reply(200, await getUploadsDiskUsage());
  }

  // ---- admin: make a licence code for the installed (offline) AUZsStyle. Signed with LICENCE_PRIVATE_KEY (server .env only). ----
  if (url.pathname === '/admin/licence/issue' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'unauthorized');
    const { rows: adm } = await withAuth(user.id, (client) => client.query('select 1 from platform_admins where id = $1', [user.id]));
    if (!adm.length) throw new HttpError(403, 'forbidden -- not a platform admin');
    if (!process.env.LICENCE_PRIVATE_KEY) throw new HttpError(400, 'Licence signing is not set up on the server yet (LICENCE_PRIVATE_KEY).');
    const b = await readJsonBody(req);
    const shop = String(b.shop || '').trim(); if (!shop) throw new HttpError(400, 'Shop name is required');
    const prodKey = PRODUCTS[b.product] ? String(b.product) : 'style';
    const addons = { cloud: !!(b.addons && b.addons.cloud), whatsapp: !!(b.addons && b.addons.whatsapp), store: !!(b.addons && b.addons.store), sync: prodKey === 'style' && !!(b.addons && b.addons.sync) }; // live cloud sync exists only for AUZsStyle
    let code; const product = PRODUCTS[b.product] ? String(b.product) : 'style';
    try { code = signLicence({ shop, end: String(b.end || ''), addons, product }, process.env.LICENCE_PRIVATE_KEY); } catch (e) { throw new HttpError(400, e.message); }
    await withAuth(user.id, (client) => client.query('select admin_log_licence($1::jsonb) as r', [JSON.stringify({ shop, product, end: b.end, addons, note: b.note || '', tenantId: b.tenantId || null, code, codeId: verifyLicence(code, publicFromPrivate(process.env.LICENCE_PRIVATE_KEY)).id, renewOf: b.renewOf || null })]));
    return reply(200, { code });
  }

  // ---- admin: what each client costs us (System resources). Combines database usage, files on disk and request time kept in memory. ----
  if (url.pathname === '/admin/costs' && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'unauthorized');
    const { rows: adm } = await withAuth(user.id, (client) => client.query('select 1 from platform_admins where id = $1', [user.id]));
    if (!adm.length) throw new HttpError(403, 'forbidden -- not a platform admin');
    const [{ rows: u }, { rows: s }, files] = await Promise.all([
      withAuth(user.id, (client) => client.query('select admin_client_usage() as r')),
      withAuth(user.id, (client) => client.query('select admin_cost_settings() as r')),
      getTenantFileSizes(),
    ]);
    const m = await metricsReport();
    return reply(200, { settings: s[0].r, usage: u[0].r, files, requests: tenantUsage(), since: m.since, minutes: m.minutes });
  }

  // ---- admin: product load (System resources panel): request metrics kept in memory by metrics.js ----
  if (url.pathname === '/admin/load' && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'unauthorized');
    const { rows } = await withAuth(user.id, (client) => client.query('select 1 from platform_admins where id = $1', [user.id]));
    if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
    return reply(200, await metricsReport());
  }

  // ---- admin: Users directory -- list a user's active sessions (same
  // data as their own "Where you're signed in" card, listSessions is
  // already a plain function with no owner-check built in). ----
  const userSessionsMatch = url.pathname.match(/^\/admin\/users\/([0-9a-f-]{36})\/sessions$/);
  if (userSessionsMatch && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'unauthorized');
    const { rows } = await withAuth(user.id, (client) =>
      client.query('select 1 from platform_admins where id = $1', [user.id]),
    );
    if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
    return reply(200, { sessions: await listSessions(userSessionsMatch[1]) });
  }

  // ---- admin: Users directory -- sign a user out of every device at once
  // (db/087). Not a Postgres RPC: revoking has to update auth.js's
  // in-memory revokedJtis Set synchronously (see revokeSession's own
  // comment) or the running server keeps honouring the token until its
  // next restart -- the same reason the self-service version
  // (/auth/sessions/:jti/revoke) isn't a generic RPC either. ----
  const revokeUserSessionsMatch = url.pathname.match(/^\/admin\/users\/([0-9a-f-]{36})\/revoke-sessions$/);
  if (revokeUserSessionsMatch && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'unauthorized');
    const { rows } = await withAuth(user.id, (client) =>
      client.query('select 1 from platform_admins where id = $1', [user.id]),
    );
    if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
    const targetId = revokeUserSessionsMatch[1];
    const count = await revokeAllSessionsForUser(targetId);
    await withAuth(user.id, (client) =>
      client.query('select admin_log($1, $2, $3, $4::jsonb)', ['revoke_sessions', 'user', targetId, JSON.stringify({ count })]),
    );
    return reply(200, { ok: true, count });
  }
  return false;
}
