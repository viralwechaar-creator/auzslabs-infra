// OAuth 2.1 authorization-code + PKCE for the AI connector's MCP endpoint (db/320), alongside -- never
// instead of -- the existing auz_mcp_... Bearer connector keys (db/318). ChatGPT's custom-connector setup
// needs real OAuth discovery (it has no "paste a Bearer token" field the way Claude.ai's connector UI does);
// Claude and any other existing integration keep using the Bearer key path untouched.
//
// Phase 1 scope (see the session's own PR description for what's deliberately deferred to a follow-up):
// authorization code flow, PKCE (S256 only), minimal Dynamic Client Registration (public clients, no
// secret -- PKCE is what secures the exchange), discovery metadata, a real login+consent page, token
// issuance/refresh/revocation. Refresh tokens are reused rather than rotated on every refresh, and a 2FA
// account hits a clear error on this page rather than a built-in code-entry step -- both flagged, not hidden.
//
// Auth model: exactly like login() in auth/password.js, every function here runs before any session exists,
// so it talks to oauth_clients/oauth_auth_codes/oauth_tokens via a plain pool query (no RLS on those tables,
// see db/320's own comment) -- never through withAuth, which would need a uid these functions are the ones
// establishing in the first place. The one exception is the consent step, which already has a normal JWT by
// then and reads the caller's own tenant_id/role through withAuth exactly like every other authenticated route.
import { randomBytes, createHash } from 'node:crypto';
import { pool, withAuth } from '../db.js';
import { verifyToken } from '../auth.js';
import { HttpError, readRawBody, rateLimited, clientIp } from '../lib/http.js';
import { API_URL } from '../config.js';

const sha256hex = (v) => createHash('sha256').update(String(v)).digest('hex');
const b64url = (buf) => buf.toString('base64url');
const newToken = (prefix) => `${prefix}_${randomBytes(32).toString('base64url')}`;
const ACCESS_TTL_S = 3600; // 1 hour -- "short-lived access tokens" is an explicit OAuth 2.1 baseline requirement
const CODE_TTL_S = 600; // 10 minutes, single-use
const REFRESH_TTL_DAYS = 30; // a refresh token dies after 30 days and is replaced every time it is used

// Which AI apps may be registered: anyone can ask (Dynamic Client Registration), but the places a sign-in is
// sent back to must be the AI apps we know, or a local test tool. An attacker cannot register "their own Claude"
// pointing at their own site and ask an owner to approve it. Add more hosts with MCP_OAUTH_REDIRECT_HOSTS.
const DEFAULT_REDIRECT_HOSTS = ['chatgpt.com', 'openai.com', 'claude.ai', 'claude.com', 'anthropic.com'];
const redirectHosts = () => (process.env.MCP_OAUTH_REDIRECT_HOSTS ? process.env.MCP_OAUTH_REDIRECT_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : DEFAULT_REDIRECT_HOSTS);
export function redirectAllowed(u) {
  let x; try { x = new URL(u); } catch { return false; }
  if (x.username || x.password || x.hash) return false;
  const host = x.hostname.toLowerCase();
  if (x.protocol === 'http:') return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (x.protocol !== 'https:') return false;
  return redirectHosts().some((h) => host === h || host.endsWith('.' + h));
}
// What the owner agreed to: read only, or read and make changes. Anything unclear means read only.
const cleanScope = (v) => (/\bwrite\b/.test(String(v || '')) ? 'read write' : 'read');

async function parseBody(req) {
  const raw = await readRawBody(req, 200_000);
  const text = raw.toString('utf8');
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) { try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'bad json'); } }
  const out = {}; for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

function oauthError(reply, status, error, description) {
  return reply(status, { error, error_description: description });
}

// ---- a minimal, self-contained login + consent page (no dependency on site/, this is API-hosted) ----
function authorizePage(params) {
  const p = JSON.stringify(params);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to AUZslab</title>
<style>
body{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#f5f4f2;color:#171717;max-width:420px;margin:48px auto;padding:0 20px}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:24px;margin-top:16px}
h1{font-size:20px;margin:0 0 4px}.muted{color:#737373;font-size:14px;margin:0 0 16px}
input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #d4d4d4;border-radius:8px;font-size:15px;margin-bottom:10px}
button{width:100%;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
.primary{background:#171717;color:#fff}.ghost{background:#f0f0f0;color:#171717;margin-top:8px}
.err{color:#b91c1c;font-size:14px;margin-top:8px;display:none}
.row{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #eee;font-size:14px}
.opt{display:flex;gap:8px;align-items:flex-start;padding:10px;border:1px solid #e5e5e5;border-radius:10px;margin-bottom:8px;font-size:14px;cursor:pointer}.opt input{width:auto;margin:3px 0 0}
</style></head><body>
<h1>Connect to AUZslab</h1>
<p class="muted">Sign in as the business owner to continue.</p>
<div class="card" id="loginCard">
  <input id="email" type="email" placeholder="Email" autocomplete="username">
  <input id="password" type="password" placeholder="Password" autocomplete="current-password">
  <input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code from your authenticator app" style="display:none">
  <button class="primary" id="signIn">Sign in</button>
  <p class="err" id="loginErr"></p>
</div>
<div class="card" id="consentCard" style="display:none">
  <h1 id="appName">An AI app</h1>
  <p class="muted">wants to connect to your AUZslab business. Only continue if you started this connection yourself.</p>
  <div class="row"><span>Business</span><b id="bizName"></b></div>
  <div class="row"><span>Sends you back to</span><b id="redirHost"></b></div>
  <p class="muted" style="margin:14px 0 6px"><b>What may it do?</b></p>
  <label class="opt"><input type="radio" name="sc" value="read" checked> <span><b>Read only</b> (recommended): look at sales, stock, customers and reports. It cannot change anything.</span></label>
  <label class="opt"><input type="radio" name="sc" value="read write"> <span><b>Read and make changes</b>: also add items, post bills, record payments, approve requests and send WhatsApp messages. Every action is recorded in your AI activity log.</span></label>
  <button class="primary" id="allow" style="margin-top:16px">Allow</button>
  <button class="ghost" id="deny">Cancel</button>
  <p class="err" id="consentErr"></p>
</div>
<script>
const Q = ${p};
const err = (id, msg) => { const e = document.getElementById(id); e.textContent = msg; e.style.display = 'block'; };
document.getElementById('redirHost').textContent = (() => { try { return new URL(Q.redirect_uri).host; } catch { return Q.redirect_uri; } })();
let jwt = null;
let challenge = null;
async function afterSignIn() {
  const c = await fetch('/authorize/context', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(Q) }).then((x) => x.json());
  if (c.error) return err('loginErr', c.error_description || c.error);
  document.getElementById('appName').textContent = (c.client_name || 'An AI app') + ' wants access';
  document.getElementById('bizName').textContent = c.business_name;
  const wants = /\\bwrite\\b/.test(Q.scope || '');
  document.querySelector('input[name=sc][value="' + (wants ? 'read write' : 'read') + '"]').checked = true;
  document.getElementById('loginCard').style.display = 'none';
  document.getElementById('consentCard').style.display = 'block';
}
document.getElementById('signIn').onclick = async () => {
  const email = document.getElementById('email').value.trim(), password = document.getElementById('password').value, code = document.getElementById('code').value.trim();
  document.getElementById('loginErr').style.display = 'none';
  let r, j;
  if (challenge) {
    if (!code) return err('loginErr', 'Enter the 6-digit code.');
    r = await fetch('/auth/2fa/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge, code }) });
  } else {
    if (!email || !password) return err('loginErr', 'Enter your email and password.');
    r = await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  }
  j = await r.json();
  if (j.requires2fa && j.challenge) { challenge = j.challenge; document.getElementById('code').style.display = 'block'; document.getElementById('code').focus(); return err('loginErr', 'Enter the code from your authenticator app.'); }
  if (!r.ok || !j.access_token) return err('loginErr', j.error || 'Wrong email, password or code.');
  jwt = j.access_token;
  await afterSignIn();
};
document.getElementById('deny').onclick = () => { document.getElementById('consentCard').innerHTML = '<p class="muted">You can close this tab.</p>'; };
document.getElementById('allow').onclick = async () => {
  const r = await fetch('/authorize/approve', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify({ ...Q, scope: document.querySelector('input[name=sc]:checked').value }) });
  const j = await r.json();
  if (j.error) return err('consentErr', j.error_description || j.error);
  location.href = j.redirect;
};
</script></body></html>`;
}

export async function handle(ctx) {
  const { req, res, url, reply, origin } = ctx;
  const p = url.pathname;

  if (p === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
    return reply(200, { resource: `${API_URL}/mcp`, authorization_servers: [API_URL], bearer_methods_supported: ['header'] });
  }
  if (p === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
    return reply(200, {
      issuer: API_URL,
      authorization_endpoint: `${API_URL}/authorize`,
      token_endpoint: `${API_URL}/token`,
      registration_endpoint: `${API_URL}/register`,
      revocation_endpoint: `${API_URL}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'write'],
    });
  }

  // ---- Dynamic Client Registration (RFC 7591, minimal: public client, no secret) ----
  if (p === '/register' && req.method === 'POST') {
    const body = await parseBody(req);
    if (rateLimited('oreg:' + clientIp(req), 10, 3_600_000)) return oauthError(reply, 429, 'slow_down', 'too many registrations, try again later');
    const asked = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string' && u.length < 500).slice(0, 10) : [];
    if (!asked.length) return oauthError(reply, 400, 'invalid_redirect_uri', 'redirect_uris must be a non-empty array of URLs');
    const redirects = asked.filter(redirectAllowed);
    if (redirects.length !== asked.length) return oauthError(reply, 400, 'invalid_redirect_uri', 'redirect_uris must be https addresses of a known AI app (or a localhost address)');
    const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : 'AI app';
    const { rows } = await pool.query('insert into oauth_clients (client_name, redirect_uris) values ($1,$2) returning id', [name, redirects]);
    return reply(201, { client_id: rows[0].id, client_name: name, redirect_uris: redirects, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  }

  // ---- /authorize: GET renders the login+consent page; the page's own JS calls these two POSTs ----
  if (p === '/authorize' && req.method === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    if (q.response_type !== 'code') return reply(400, { error: 'unsupported_response_type' });
    if (q.code_challenge_method && q.code_challenge_method !== 'S256') return reply(400, { error: 'invalid_request', error_description: 'only S256 PKCE is supported' });
    if (!q.client_id || !q.redirect_uri || !q.code_challenge) return reply(400, { error: 'invalid_request', error_description: 'client_id, redirect_uri and code_challenge are required' });
    const { rows } = await pool.query('select redirect_uris from oauth_clients where id = $1', [q.client_id]).catch(() => ({ rows: [] }));
    if (!rows[0] || !rows[0].redirect_uris.includes(q.redirect_uri) || !redirectAllowed(q.redirect_uri)) return reply(400, { error: 'invalid_request', error_description: 'unknown client_id or redirect_uri not registered for it' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(authorizePage({ client_id: q.client_id, redirect_uri: q.redirect_uri, state: q.state || '', code_challenge: q.code_challenge, scope: cleanScope(q.scope) }));
    return;
  }

  if (p === '/authorize/context' && req.method === 'POST') {
    const user = verifyToken(bearerFromReq(req) || '');
    if (!user) return oauthError(reply, 401, 'invalid_token', 'sign-in expired, try again');
    const body = await parseBody(req);
    const client = await clientFor(body.client_id);
    if (!client) return oauthError(reply, 400, 'invalid_request', 'unknown client');
    const prof = await withAuth(user.id, (c) => c.query('select tenant_id, role from profiles where id = $1', [user.id])).then((r) => r.rows[0]);
    if (!prof || prof.role !== 'owner') return oauthError(reply, 403, 'access_denied', 'only the business owner can connect an AI app');
    const tenant = await withAuth(user.id, (c) => c.query('select name from tenants where id = $1', [prof.tenant_id])).then((r) => r.rows[0]);
    return reply(200, { client_name: client.client_name, business_name: tenant?.name || '' });
  }

  if (p === '/authorize/approve' && req.method === 'POST') {
    const user = verifyToken(bearerFromReq(req) || '');
    if (!user) return oauthError(reply, 401, 'invalid_token', 'sign-in expired, try again');
    const body = await parseBody(req);
    const client = await clientFor(body.client_id);
    if (rateLimited('oapp:' + user.id, 10, 600_000)) return oauthError(reply, 429, 'slow_down', 'too many attempts, try again later');
    if (!client || !client.redirect_uris.includes(body.redirect_uri) || !redirectAllowed(body.redirect_uri)) return oauthError(reply, 400, 'invalid_request', 'unknown client_id or redirect_uri');
    const prof = await withAuth(user.id, (c) => c.query('select tenant_id, role from profiles where id = $1', [user.id])).then((r) => r.rows[0]);
    if (!prof || prof.role !== 'owner') return oauthError(reply, 403, 'access_denied', 'only the business owner can connect an AI app');
    const code = newToken('auz_oac');
    await pool.query(
      `insert into oauth_auth_codes (code_hash, client_id, user_id, tenant_id, redirect_uri, code_challenge, scope, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7, now() + interval '${CODE_TTL_S} seconds')`,
      [sha256hex(code), client.id, user.id, prof.tenant_id, body.redirect_uri, body.code_challenge, cleanScope(body.scope)],
    );
    const redirect = new URL(body.redirect_uri);
    redirect.searchParams.set('code', code);
    if (body.state) redirect.searchParams.set('state', body.state);
    return reply(200, { redirect: redirect.toString() });
  }

  // ---- /token: authorization_code and refresh_token grants ----
  if (p === '/token' && req.method === 'POST') {
    if (rateLimited('otok:' + clientIp(req), 60, 600_000)) return oauthError(reply, 429, 'slow_down', 'too many requests, try again later');
    const body = await parseBody(req);
    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.code_verifier || !body.redirect_uri) return oauthError(reply, 400, 'invalid_request', 'code, code_verifier and redirect_uri are required');
      const { rows } = await pool.query('select * from oauth_auth_codes where code_hash = $1', [sha256hex(body.code)]);
      const row = rows[0];
      if (!row || row.used_at || row.expires_at < new Date() || row.redirect_uri !== body.redirect_uri) return oauthError(reply, 400, 'invalid_grant', 'code is invalid, expired, already used, or redirect_uri does not match');
      if (body.client_id && body.client_id !== row.client_id) return oauthError(reply, 400, 'invalid_grant', 'client_id does not match');
      const challenge = b64url(createHash('sha256').update(body.code_verifier).digest());
      if (challenge !== row.code_challenge) return oauthError(reply, 400, 'invalid_grant', 'PKCE verification failed');
      await pool.query('update oauth_auth_codes set used_at = now() where code_hash = $1', [sha256hex(body.code)]);
      return reply(200, await issueTokens(row.client_id, row.user_id, row.tenant_id, row.scope));
    }
    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return oauthError(reply, 400, 'invalid_request', 'refresh_token is required');
      const h = sha256hex(body.refresh_token);
      const { rows } = await pool.query('select * from oauth_tokens where (refresh_token_hash = $1 or prev_refresh_hash = $1) and revoked_at is null', [h]);
      const row = rows[0];
      if (!row) return oauthError(reply, 400, 'invalid_grant', 'refresh token is invalid or revoked');
      if (row.prev_refresh_hash === h && row.refresh_token_hash !== h) {
        // an OLD refresh token came back: either it was stolen or the app is replaying it, so end the whole grant
        await pool.query('update oauth_tokens set revoked_at = now() where id = $1', [row.id]);
        return oauthError(reply, 400, 'invalid_grant', 'refresh token was already used; connect again');
      }
      if (row.refresh_expires_at < new Date()) return oauthError(reply, 400, 'invalid_grant', 'refresh token expired; connect again');
      // every refresh gives a new refresh token (the old one stops working) and restarts the 30 days
      const access_token = newToken('auz_oat'), refresh_token = newToken('auz_ort');
      await pool.query(
        `update oauth_tokens set access_token_hash = $1, refresh_token_hash = $2, prev_refresh_hash = $3,
           access_expires_at = now() + interval '${ACCESS_TTL_S} seconds', refresh_expires_at = now() + interval '${REFRESH_TTL_DAYS} days' where id = $4`,
        [sha256hex(access_token), sha256hex(refresh_token), h, row.id],
      );
      return reply(200, { access_token, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token, scope: row.scope });
    }
    return oauthError(reply, 400, 'unsupported_grant_type', 'use authorization_code or refresh_token');
  }

  if (p === '/revoke' && req.method === 'POST') {
    const body = await parseBody(req);
    const token = body.token;
    if (!token) return reply(200, {}); // RFC 7009: unknown/absent token is still a 200
    await pool.query('update oauth_tokens set revoked_at = now() where (access_token_hash = $1 or refresh_token_hash = $1) and revoked_at is null', [sha256hex(token)]);
    return reply(200, {});
  }

  return false;
}

function bearerFromReq(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
async function clientFor(clientId) {
  if (!clientId) return null;
  const { rows } = await pool.query('select id, client_name, redirect_uris from oauth_clients where id = $1', [clientId]).catch(() => ({ rows: [] }));
  return rows[0] || null;
}
async function issueTokens(clientId, userId, tenantId, scope) {
  const access_token = newToken('auz_oat'), refresh_token = newToken('auz_ort');
  await pool.query(
    `insert into oauth_tokens (client_id, user_id, tenant_id, access_token_hash, refresh_token_hash, scope, access_expires_at)
     values ($1,$2,$3,$4,$5,$6, now() + interval '${ACCESS_TTL_S} seconds')`,
    [clientId, userId, tenantId, sha256hex(access_token), sha256hex(refresh_token), scope],
  );
  return { access_token, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token, scope };
}

// Exported for mcp.js: resolves an OAuth access token (NOT a connector key) to {user_id, tenant_id}, or null.
export async function resolveOauthAccessToken(token) {
  const { rows } = await pool.query(
    `update oauth_tokens set last_used_at = now() where access_token_hash = $1 and revoked_at is null and access_expires_at > now()
     returning user_id, tenant_id, scope`,
    [sha256hex(token)],
  );
  return rows[0] || null;
}
