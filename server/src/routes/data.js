import { withAuth } from '../db.js';
import { revokeAllSessionsForUser } from '../auth.js';
import { captureError } from '../errors.js';
import { requireVerifiedEmail } from '../lib/guards.js';
import { sendTeamApplicationReceived, sendTeamApplicationToAdmin, sendTeamDecisionEmail } from '../mail.js';
import { HttpError, httpFromError, rateLimited, readJsonBody } from '../lib/http.js';
import { TABLES } from '../data/tables.js';
import { RPC } from '../data/rpc-registry.js';
import { callRpc, handleInsert, handleSelect, handleUpdate } from '../data/queries.js';
import { cached, invalidatePublic } from '../lib/pubcache.js';

// Returns false when none of this module's routes matched, so the dispatcher in index.js tries the next module;
// any other return (including the undefined that `return reply(...)` gives) means the request was handled.
export async function handle(ctx) {
  const { req, res, url, user, ip, meta, reply, origin } = ctx;
  // ---- generic data API (records/profiles/guest_orders/push_subs/leads/signup_requests/bookings) ----
  const dbMatch = url.pathname.match(/^\/db\/([a-z_]+)$/);
  if (dbMatch) {
    const table = dbMatch[1];
    const cfg = TABLES[table];
    if (!cfg) throw new HttpError(404, 'unknown table');
    const uid = user?.id || null;

    if (req.method !== 'GET' && user) invalidatePublic();
    const result = await withAuth(uid, async (client) => {
      if (req.method === 'GET') return handleSelect(client, table, cfg, url.searchParams);
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        return handleInsert(client, table, cfg, body, url.searchParams.get('onConflict'));
      }
      if (req.method === 'PATCH') {
        const body = await readJsonBody(req);
        return handleUpdate(client, table, cfg, body, url.searchParams);
      }
      throw new HttpError(405, 'method not allowed');
    });
    return reply(200, { data: result });
  }

  // ---- batch sync: POST /sync { ops: [{ id, fn, args }] } ----
  // Lets a phone send everything it queued while offline in one request instead of one request per record. It adds no
  // new door: every op goes through exactly the same allow-list, login check and per-function permission checks as
  // POST /rpc/<fn> (anonymous functions are refused here), each op in its own transaction so one refusal never undoes
  // the others. Ops run in order. After a failure that may be temporary (500s, 401, 429, 408) the rest are not tried
  // ({skipped:true}) so the client keeps them queued and the order is preserved; a refusal (4xx business rule) only
  // fails that op. The functions are idempotent on their client-generated ids, so resending a batch is safe.
  if (url.pathname === '/sync' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    const body = await readJsonBody(req);
    const ops = Array.isArray(body && body.ops) ? body.ops : null;
    if (!ops || !ops.length) throw new HttpError(400, 'ops must be a non-empty list');
    if (ops.length > 50) throw new HttpError(413, 'at most 50 ops per request');
    const results = []; let stopped = false;
    for (const op of ops) {
      const id = op && op.id != null ? String(op.id).slice(0, 80) : null;
      if (stopped) { results.push({ id, ok: false, skipped: true }); continue; }
      try {
        const fnName = op && typeof op.fn === 'string' ? op.fn : '';
        const cfg = RPC[fnName];
        if (!cfg) throw new HttpError(404, 'unknown function');
        if (!cfg.auth) throw new HttpError(400, 'this function cannot be sent in a batch');
        if (fnName === 'submit_signup_request' || fnName === 'submit_addon_request') await requireVerifiedEmail(user.id);
        const args = op.args && typeof op.args === 'object' ? op.args : {};
        const data = await withAuth(user.id, (client) => callRpc(client, fnName, args));
        results.push({ id, ok: true, data });
      } catch (e) {
        const { status, message } = httpFromError(e);
        if (status === 500) { console.error(e); captureError(e, { method: 'POST', path: '/sync', user_id: user.id }); }
        results.push({ id, ok: false, status, error: message });
        if (status >= 500 || status === 401 || status === 408 || status === 429) stopped = true;
      }
    }
    return reply(200, { results });
  }

  // ---- rpc ----
  const rpcMatch = url.pathname.match(/^\/rpc\/([a-z_]+)$/);
  if (rpcMatch && req.method === 'POST') {
    const fnName = rpcMatch[1];
    const cfg = RPC[fnName];
    if (!cfg) throw new HttpError(404, 'unknown function');
    if (cfg.auth && !user) throw new HttpError(401, 'authentication required');
    // Public/anonymous RPCs (public_menu, place_order, ...) are
    // reachable by every customer self-ordering off a QR code, often
    // from one shared cafe/restaurant WiFi IP -- so this stays
    // generous (300 / 5 min) rather than a tight per-request cap.
    // Authenticated calls aren't limited here: a logged-in session
    // already required passing the login rate limit above.
    if (!cfg.auth && rateLimited(`public:${ip}`, 300, 5 * 60_000)) throw new HttpError(429, 'too many requests, please slow down');
    // The contact form shares the generous public-RPC bucket above (sized for QR self-ordering, not a "get in
    // touch" form), so it also gets its own tighter cap -- a real visitor never submits this more than a
    // couple of times; this bounds the spam a bot can push into leads even if it clears the honeypot (db/131).
    if (fnName === 'submit_team_application' && rateLimited(`teamapp:${ip}`, 5, 60 * 60_000)) throw new HttpError(429, 'too many requests, try again later');
    if (fnName === 'submit_lead' && rateLimited(`lead:${ip}`, 5, 60 * 60_000)) throw new HttpError(429, 'too many requests, try again later');
    if (fnName === 'submit_signup_request' || fnName === 'submit_addon_request') await requireVerifiedEmail(user.id);
    const args = await readJsonBody(req);
    const uid = user?.id || null;
    // Anything that checks a password or sets someone's PIN/password is limited per person, so a stolen session token cannot be used to guess the current password.
    if (user && ['change_my_password', 'reset_staff_password', 'staff_reset_pin', 'admin_reset_client_password'].includes(fnName) && rateLimited(`pwrpc:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    // read-only, much-repeated or expensive answers are shared for a few seconds (lib/pubcache.js lists which and for how long)
    const result = await cached(fnName, args, uid, () => withAuth(uid, (client) => callRpc(client, fnName, args)));
    // After a password / PIN change, old sessions must stop working at once (the person changing their own password keeps the one they are using).
    if (user && fnName === 'change_my_password') await revokeAllSessionsForUser(user.id, user.jti || null).catch(() => {});
    if (user && ['reset_staff_password', 'staff_reset_pin'].includes(fnName) && args && /^[0-9a-f-]{36}$/i.test(String(args.p_staff_id || ''))) await revokeAllSessionsForUser(args.p_staff_id).catch(() => {});
    if (user && fnName === 'staff_set_active' && args && args.p_active === false && /^[0-9a-f-]{36}$/i.test(String(args.p_staff_id || ''))) await revokeAllSessionsForUser(args.p_staff_id).catch(() => {});
    // admin_reset_client_password (db/130) now returns the owner's user_id specifically so this can run: a platform admin
    // "logging in as owner" to do setup, then generating the final handoff password, must not leave their own setup
    // session still valid after telling the owner "your old password stops working" -- that sentence was only true of
    // the password, never the still-open session, until this line.
    if (fnName === 'admin_reset_client_password' && result && /^[0-9a-f-]{36}$/i.test(String(result.user_id || ''))) await revokeAllSessionsForUser(result.user_id).catch(() => {});
    // Join-the-team emails (best effort: a missing mail key or a bounce never fails the request).
    if (fnName === 'submit_team_application' && args && !args.p_hp && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(args.p_email || ''))) {
      sendTeamApplicationReceived({ to: String(args.p_email), name: String(args.p_name || '') }).catch(() => {});
      sendTeamApplicationToAdmin({ to: process.env.ADMIN_NOTIFY_EMAIL || 'helloauzslab@gmail.com', name: String(args.p_name || ''), email: String(args.p_email), phone: String(args.p_phone || ''), role: String(args.p_role || '') }).catch(() => {});
    }
    if (fnName === 'admin_decide_team_application' && result && result.email) {
      sendTeamDecisionEmail({ to: result.email, name: result.name, approved: result.status === 'approved', role: result.role }).catch(() => {});
    }
    if (user && (fnName.startsWith('sty_') || fnName.startsWith('admin_') || fnName === 'push_record' || fnName.startsWith('save_') || fnName.startsWith('salesman_'))) invalidatePublic();
    return reply(200, { data: result });
  }
  return false;
}
