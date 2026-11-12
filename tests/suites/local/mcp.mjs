// AI connector (MCP + OAuth) safety: read-only keys and grants cannot change anything, only known AI apps can be
// registered, OAuth refresh tokens rotate and expire, and the consent page works. Real API and database.
// (The request-rate limits are off in the test copy of the API, so they are checked separately by hand.)
import crypto from 'node:crypto';
import { suite, assert } from '../../lib/harness.mjs';
import { PASSWORD, USERS, q } from '../../lib/db.mjs';

const b64url = (b) => b.toString('base64url');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

export default async function run({ stack }) {
  const s = suite('AI connector: read-only access, known apps only, rotating tokens', 'A read-only key or grant can only read, only known AI apps can register for OAuth, and refresh tokens are replaced on use and expire.');
  const call = async (method, path, body, token, form) => {
    const r = await fetch(stack.apiBase + path, { method, headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? (form ? new URLSearchParams(body).toString() : JSON.stringify(body)) : undefined });
    const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data };
  };
  const jwt = (await call('POST', '/auth/login', { email: USERS.cafeOwner, password: PASSWORD })).data.access_token;
  const mkKey = async (args) => (await call('POST', '/rpc/mcp_create_key', args, jwt)).data.data;
  const mcp = async (token, method, params) => (await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params: params || {} }, token)).data;
  const tool = async (token, name, args) => { const r = await mcp(token, 'tools/call', { name, arguments: args || {} }); return r.result || r.error; };
  const names = async (token) => (await mcp(token, 'tools/list')).result.tools.map((t) => t.name);

  let readKey, fullKey;
  await s.check('A key made without saying what it may do is read-only; a full key must be asked for', async () => {
    const a = await mkKey({ p_label: 'no scope' }); readKey = a.key;
    assert(a.scope === 'read', 'default scope ' + a.scope);
    const b = await mkKey({ p_label: 'full', p_scope: 'full' }); fullKey = b.key;
    assert(b.scope === 'full', 'full scope ' + b.scope);
    const list = (await call('POST', '/rpc/mcp_list_keys', {}, jwt)).data.data;
    assert(list.some((k) => k.scope === 'read') && list.some((k) => k.scope === 'full'), 'list does not show scopes');
  }, 'critical');

  await s.check('A read-only key does not even list the tools that change things, and cannot call them', async () => {
    const n = await names(readKey);
    assert(n.includes('list_inventory'), 'read tool missing');
    for (const w of ['add_inventory_item', 'whatsapp_send', 'ledger_post_document', 'payroll_decide_loan']) assert(!n.includes(w), w + ' is offered to a read-only key');
    const r = await tool(readKey, 'add_inventory_item', { name: 'Should not exist', price: 5 });
    assert(r.isError === true && /read-only/i.test(JSON.stringify(r.content)), 'a read-only key could call a write tool: ' + JSON.stringify(r));
    assert(!(await q(`select 1 from records where kind='item' and data->>'name'='Should not exist'`)).length, 'the item was created');
    const ok = await tool(readKey, 'list_inventory', {}); assert(ok.isError === false, 'a read tool failed: ' + JSON.stringify(ok));
  }, 'critical');

  await s.check('A full key can still make changes (and the change is recorded in the activity log)', async () => {
    assert((await names(fullKey)).includes('add_inventory_item'), 'write tool not offered');
    const r = await tool(fullKey, 'add_inventory_item', { name: 'MCP scope test item', price: 12 });
    assert(r.isError === false, 'full key refused: ' + JSON.stringify(r));
    await new Promise((x) => setTimeout(x, 400));
    assert((await q(`select 1 from mcp_audit where tool='add_inventory_item' and ok`)).length, 'no audit row');
  }, 'critical');

  await s.check('A wrong key is refused with 401, never with data', async () => {
    const r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'auz_mcp_' + 'x'.repeat(43));
    assert(r.status === 401, 'status ' + r.status);
  }, 'critical');

  let clientId;
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  await s.check('Only known AI apps (or a localhost tool) can register for OAuth; an unknown site cannot', async () => {
    const bad = await call('POST', '/register', { client_name: 'Claude', redirect_uris: ['https://evil.example/callback'] }); assert(bad.status === 400, 'evil registered: ' + bad.status);
    const mixed = await call('POST', '/register', { client_name: 'Claude', redirect_uris: [redirect, 'https://evil.example/cb'] }); assert(mixed.status === 400, 'mixed list registered: ' + mixed.status);
    const plain = await call('POST', '/register', { client_name: 'x', redirect_uris: ['http://claude.ai/cb'] }); assert(plain.status === 400, 'plain http registered');
    const look = await call('POST', '/register', { client_name: 'x', redirect_uris: ['https://claude.ai.evil.example/cb'] }); assert(look.status === 400, 'look-alike host registered');
    const ok = await call('POST', '/register', { client_name: 'Claude', redirect_uris: [redirect] }); assert(ok.status === 201, 'claude.ai refused: ' + ok.status); clientId = ok.data.client_id;
    const lo = await call('POST', '/register', { client_name: 'Inspector', redirect_uris: ['http://localhost:6274/oauth/callback'] }); assert(lo.status === 201, 'localhost refused: ' + lo.status);
  }, 'critical');

  await s.check('The consent page loads for a registered app, offers read-only first, and its script is valid', async () => {
    const r = await fetch(stack.apiBase + '/authorize?' + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: 'x', code_challenge_method: 'S256', scope: 'read write' }));
    const html = await r.text(); assert(r.status === 200 && /Read only/.test(html) && /Read and make changes/.test(html), 'page ' + r.status);
    const js = html.match(/<script>([\s\S]*)<\/script>/)[1]; try { new Function(js); } catch (e) { assert(false, 'page script does not parse: ' + e.message); }
    const unknown = await fetch(stack.apiBase + '/authorize?' + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://evil.example/cb', code_challenge: 'x' }));
    assert(unknown.status === 400, 'unregistered redirect accepted: ' + unknown.status);
  }, 'critical');

  const grant = async (scope) => {
    const verifier = b64url(crypto.randomBytes(32)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const ap = await call('POST', '/authorize/approve', { client_id: clientId, redirect_uri: redirect, state: 's', code_challenge: challenge, scope }, jwt);
    assert(ap.status === 200 && ap.data.redirect, 'approve ' + ap.status + ' ' + JSON.stringify(ap.data));
    const code = new URL(ap.data.redirect).searchParams.get('code');
    const tk = await call('POST', '/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, client_id: clientId }, null, true);
    assert(tk.status === 200 && tk.data.access_token, 'token ' + tk.status + ' ' + JSON.stringify(tk.data));
    return tk.data;
  };
  let tokens;
  await s.check('An OAuth grant approved as read-only can only read; asking for anything odd gives read-only too', async () => {
    tokens = await grant('read'); assert(tokens.scope === 'read', 'scope ' + tokens.scope);
    assert(!(await names(tokens.access_token)).includes('add_inventory_item'), 'write tool offered');
    const r = await tool(tokens.access_token, 'add_inventory_item', { name: 'Nope', price: 1 }); assert(r.isError === true, 'write allowed');
    const odd = await grant('admin everything'); assert(odd.scope === 'read', 'odd scope became ' + odd.scope);
    const rw = await grant('read write'); assert(rw.scope === 'read write', 'read write became ' + rw.scope);
    assert((await names(rw.access_token)).includes('add_inventory_item'), 'a read-write grant cannot change anything');
  }, 'critical');

  await s.check('Refresh tokens are replaced on every use, an old one cannot be reused, and reuse ends the whole grant', async () => {
    const a = await call('POST', '/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, null, true);
    assert(a.status === 200 && a.data.refresh_token && a.data.refresh_token !== tokens.refresh_token, 'no new refresh token: ' + JSON.stringify(a.data));
    const again = await call('POST', '/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, null, true);
    assert(again.status === 400, 'the old refresh token still worked: ' + again.status);
    const after = await call('POST', '/token', { grant_type: 'refresh_token', refresh_token: a.data.refresh_token }, null, true);
    assert(after.status === 400, 'the grant survived a replayed token: ' + after.status);
  }, 'critical');

  await s.check('A refresh token stops working after 30 days', async () => {
    const t = await grant('read');
    await q(`update oauth_tokens set refresh_expires_at = now() - interval '1 minute' where refresh_token_hash = $1`, [sha(t.refresh_token)]);
    const r = await call('POST', '/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token }, null, true);
    assert(r.status === 400, 'an expired refresh token worked: ' + r.status);
  }, 'critical');

  await s.check('Only a business owner can approve a connection (a logged-out caller cannot)', async () => {
    const r = await call('POST', '/authorize/approve', { client_id: clientId, redirect_uri: redirect, code_challenge: 'x', scope: 'read' });
    assert(r.status === 401, 'status ' + r.status);
  }, 'critical');
}
