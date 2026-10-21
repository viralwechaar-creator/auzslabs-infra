import { pool, withAuth } from '../db.js';
import { createUser, resetToRandomPassword, signToken, listSessions, revokeAllSessionsForUser } from '../auth.js';
import { saveSiteUpload, getUploadsDiskUsage } from '../storage.js';
import { sendStaffInviteEmail } from '../mail.js';
import { safeResetBase } from '../config.js';
import { myProfile } from '../lib/guards.js';
import { HttpError, rateLimited, readJsonBody, readRawBody } from '../lib/http.js';

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

  // ---- salesman: owner login for a trial tenant they created, so they can
  // also open the POS itself during a pitch, not just show the branded
  // website/invoice (db/137). Same discipline as /admin/provision-owner
  // above, but gated on is_salesman() + actually owning this exact trial.
  if (url.pathname === '/admin/salesman-provision-owner' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'unauthorized');
    const body = await readJsonBody(req);
    if (!body.tenant_id || (!body.email && !body.trial)) throw new HttpError(400, 'tenant_id and email are required');
    const { rows } = await withAuth(user.id, (client) =>
      client.query('select is_salesman($1) as ok, exists(select 1 from tenants where id = $2 and created_by_salesman = $1) as owns', [user.id, body.tenant_id]),
    );
    if (!rows[0]?.ok) throw new HttpError(403, 'forbidden -- not a salesman account');
    if (!rows[0]?.owns) throw new HttpError(403, 'not your trial tenant');
    if (body.trial) {
      // A trial login the client can use on their own device: the business's owner login (made if there is none),
      // with a fresh password each time. The tenant stays a trial until an admin converts it.
      const ex = await withAuth(user.id, (client) =>
        client.query(
          `select p.id as owner_id, au.email as owner_email, t.slug as slug
           from tenants t left join profiles p on p.tenant_id = t.id and p.role = 'owner'
           left join auth_users au on au.id = p.id where t.id = $1`,
          [body.tenant_id],
        ),
      );
      const row = ex.rows[0];
      if (!row) throw new HttpError(404, 'trial not found');
      let ownerId = row.owner_id, ownerEmail = row.owner_email;
      if (!ownerId) {
        ownerEmail = `trial-${row.slug}@trial.auzslab.in`;
        const made = await createUser({
          email: ownerEmail,
          password: crypto.randomUUID(),
          app_metadata: { tenant_id: body.tenant_id, role: 'owner' },
          user_metadata: { name: body.name || '' },
          verified: true,
        });
        ownerId = made.id;
      }
      const pw = await resetToRandomPassword(ownerId);
      return reply(200, { user_id: ownerId, email: ownerEmail, temp_password: pw });
    }
    const created = await createUser({
      email: body.email,
      password: crypto.randomUUID(),
      app_metadata: { tenant_id: body.tenant_id, role: 'owner' },
      user_metadata: { name: body.name || '' },
    });
    const tempPassword = await resetToRandomPassword(created.id);
    return reply(200, { user_id: created.id, temp_password: tempPassword });
  }

  // ---- salesman: open the POS directly, already signed in -- no email
  // prompt, no password to copy (db/139). Reuses the real owner login if
  // the salesman already made one with /admin/salesman-provision-owner
  // above (never creates a second one for the same trial); otherwise
  // creates a throwaway owner login on the spot. Either way this mints a
  // real, revocable session (signToken(), same as every other sign-in
  // path) and hands it back for the client to drop straight into the
  // #auz_gt= handoff fragment every app's sb-client.js already knows how
  // to consume (see site/signin.html's own Google handoff for the exact
  // same shape) -- so opening the returned link signs them straight into
  // the real POS, with real seeded data, with zero further taps.
  if (url.pathname === '/admin/salesman-open-pos' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'unauthorized');
    const body = await readJsonBody(req);
    if (!body.tenant_id) throw new HttpError(400, 'tenant_id is required');
    // Client setup staff (db/176): only the assigned person, only while the setup is open and inside its time
    // limit; every open is logged. They get the client's own owner session, but only for 8 hours and never renewed.
    const roleRow = await withAuth(user.id, (client) => client.query('select team_role($1) as role', [user.id]));
    if (roleRow.rows[0]?.role === 'setup') {
      const ctx = await withAuth(user.id, (client) => client.query('select team_setup_open_context($1) as c', [body.tenant_id]));
      const c = ctx.rows[0].c;
      const owner = { id: c.owner_id, email: c.owner_email, app_metadata: c.owner_meta };
      const access_token = await signToken(owner, meta, { limited: true });
      return reply(200, { access_token, niche: c.niche, user: { id: owner.id, email: owner.email, app_metadata: owner.app_metadata } });
    }
    const { rows } = await withAuth(user.id, (client) =>
      client.query(
        `select is_salesman($1) as ok, t.name as tenant_name, t.niche as niche,
           (t.created_by_salesman = $1) as owns,
           au.id as owner_id, au.email as owner_email, au.app_metadata as owner_meta
         from tenants t
         left join profiles p on p.tenant_id = t.id and p.role = 'owner'
         left join auth_users au on au.id = p.id
         where t.id = $2`,
        [user.id, body.tenant_id],
      ),
    );
    if (!rows[0]?.ok) throw new HttpError(403, 'forbidden -- not a salesman account');
    if (!rows[0]?.owns) throw new HttpError(403, 'not your trial tenant');
    let owner;
    if (rows[0].owner_id) {
      owner = { id: rows[0].owner_id, email: rows[0].owner_email, app_metadata: rows[0].owner_meta };
    } else {
      owner = await createUser({
        email: `pos-demo-${crypto.randomUUID().slice(0, 8)}@trial.auzslab.in`,
        password: crypto.randomUUID(),
        app_metadata: { tenant_id: body.tenant_id, role: 'owner' },
        user_metadata: { name: rows[0].tenant_name || '' },
        verified: true,
      });
    }
    // A mobile-shop trial opens AUZsMob, which needs something to show (db/147).
    if (rows[0].niche === 'mobile') await pool.query('select mob_trial_seed($1)', [body.tenant_id]);
    const access_token = await signToken(owner, meta);
    return reply(200, { access_token, niche: rows[0].niche, user: { id: owner.id, email: owner.email, app_metadata: owner.app_metadata } });
  }

  // ---- salesman: upload a logo (or any other branding image) for a
  // trial tenant they created (db/137). Reuses saveSiteUpload() exactly
  // as the owner's own /storage/site/:prefix route does -- its internal
  // tenant-slug lookup already goes through withAuth(uid,...), and the
  // t_salesman_read policy on tenants (db/137) is what makes that lookup
  // succeed for a salesman's own uid instead of only an owner's.
  const salesmanUploadMatch = url.pathname.match(/^\/storage\/salesman\/([0-9a-f-]{36})\/([a-zA-Z0-9_-]+)$/);
  if (salesmanUploadMatch && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    const [, tenantId, prefix] = salesmanUploadMatch;
    const { rows } = await withAuth(user.id, (client) =>
      client.query('select exists(select 1 from tenants where id = $1 and created_by_salesman = $2) as owns', [tenantId, user.id]),
    );
    if (!rows[0]?.owns) throw new HttpError(403, 'not your trial tenant');
    const buffer = await readRawBody(req, 8_000_000);
    const result = await saveSiteUpload({ tenantId, uid: user.id, prefix, buffer });
    return reply(200, result);
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
