import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { OFFLINE, licenceStatus, PRODUCT } from './licence.js';
import { syncStatus, syncNow } from '../sync-worker.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';

const CLOUD_URL = () => process.env.AUZ_CLOUD_URL || 'https://api.auzslab.in';
// Same small helper as sync-worker.js's, kept separate because that file never touches a request/response and this one does.
function readLicenceCode() { try { return JSON.parse(fs.readFileSync(path.join(process.env.AUZ_DATA_DIR || '', 'licence.json'), 'utf8')).code || ''; } catch { return ''; } }
function cloudJson(method, base, p, code, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const mod = u.protocol === 'https:' ? https : http;
    const data = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { 'X-Licence': code }; if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const req = mod.request(u, { method, timeout: 60000, headers }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => {
        if (res.statusCode >= 400) { let m = b; try { m = JSON.parse(b).error || b; } catch { /* plain text */ } const e = new Error(m || 'HTTP ' + res.statusCode); e.status = res.statusCode; return reject(e); }
        try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('The connection to AUZslab timed out.')));
    req.on('error', (e) => reject(new Error(e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'EAI_AGAIN' ? 'No internet connection.' : e.message)));
    if (data) req.end(data); else req.end();
  });
}
const postJson = (base, p, code, body) => cloudJson('POST', base, p, code, body);
const getJson = (base, p, code) => cloudJson('GET', base, p, code);
const delJson = (base, p, code) => cloudJson('DELETE', base, p, code);
// shared by every cloud-sync broker route: the plan must carry the add-on and be running, and this computer
// must actually be activated -- returns the licence code to send on, or throws the right HttpError.
function needSync() {
  const s = licenceStatus();
  if (!s || !(s.addons && s.addons.sync) || (s.state !== 'active' && s.state !== 'grace')) throw new HttpError(402, 'Cloud sync is not part of this computer\'s plan. Ask AUZslab to add it.');
  const code = readLicenceCode();
  if (!code) throw new HttpError(400, 'This computer is not activated yet.');
  return code;
}

// Installed (offline) copy only: this one process also hands out the app's own pages, because there is no web server beside it
// (in the cloud, Caddy does that), and creates the shop on the very first start. Does nothing on the cloud server.
const APP_ROOT = process.env.AUZ_APP_ROOT || '';
const HOME = { style: 'style.html', pos: 'index.html', ledger: 'accounts.html' }; // the page each installed product opens on
const UPLOADS = process.env.UPLOAD_ROOT || '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.mjs': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json' };

function sendFile(res, file, extra = {}) {
  const st = fs.statSync(file);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': extra.cache || 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}
// a request path -> a file strictly inside root (no ../, no absolute tricks), or null
function inside(root, rel) {
  const p = path.normalize(path.join(root, decodeURIComponent(rel)));
  return p.startsWith(path.resolve(root) + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}

export async function handle(ctx) {
  if (!OFFLINE) return false;
  const { req, res, url, ip, reply } = ctx;
  if (url.pathname === '/setup/state' && req.method === 'GET') {
    const { rows } = await pool.query('select offline_setup_needed() as needed');
    return reply(200, { needed: rows[0].needed, product: PRODUCT });
  }
  if (url.pathname === '/setup/first-run' && req.method === 'POST') {
    if (rateLimited('setup:' + ip, 10, 15 * 60_000)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    const b = await readJsonBody(req);
    const shop = String(b.shop || '').trim(), email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
    if (!shop || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter the shop name and a valid email.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    try { await pool.query('select offline_first_run($1, $2, $3, $4, $5, $6)', [shop, String(b.name || ''), email, await bcrypt.hash(password, 10), PRODUCT, PRODUCT === 'pos' && b.biz === 'retail' ? 'retail' : PRODUCT === 'pos' ? 'restaurant' : null]); }
    catch (e) { throw new HttpError(400, /already set up/.test(e.message) ? 'This computer is already set up. Sign in instead.' : 'Could not set up: ' + e.message); }
    return reply(200, { ok: true });
  }
  // The LAN address(es) this computer answers on, so a phone on the same WiFi can reach it (e.g. to add product
  // photos from the phone's camera -- see p-settings.js "Add photos from your phone"). Loopback and virtual
  // adapters (Docker, VPN, Hyper-V) are left out; what remains is what a phone on the shop's real WiFi can use.
  if (url.pathname === '/offline/lan-info' && req.method === 'GET') {
    const ifaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(ifaces)) {
      if (/vethernet|virtual|docker|vmware|vpn|loopback/i.test(name)) continue;
      for (const a of ifaces[name] || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }
    return reply(200, { ips, port: Number(process.env.PORT) || null });
  }
  // The last part of this computer's own app.log / server.log -- so "Help & report a problem" can send the real
  // error, not just a screenshot, even though this program has no remote crash reporting (it is meant to run with
  // no internet). Capped so a huge log file is never sent whole.
  if (url.pathname === '/offline/logs' && req.method === 'GET') {
    const dataDir = process.env.AUZ_DATA_DIR || '';
    const tail = (file, max = 20000) => { try { const s = fs.readFileSync(file, 'utf8'); return s.length > max ? '...(earlier lines cut)...\n' + s.slice(-max) : s; } catch { return ''; } };
    return reply(200, { appLog: dataDir ? tail(path.join(dataDir, 'app.log')) : '', serverLog: dataDir ? tail(path.join(dataDir, 'server.log')) : '' });
  }
  // Cloud Sync Stage 2 (db/277): the owner types the email/password they want to use for REMOTE access into
  // Settings on this computer; this just carries it to the cloud server over TLS (never stored or logged here
  // either) which hashes it and creates the login. Needs the 'sync' add-on and a connection.
  if (url.pathname === '/offline/cloud-sync-register' && req.method === 'POST') {
    if (rateLimited('syncreg:' + ip, 10, 15 * 60_000)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    const code = needSync();
    const b = await readJsonBody(req);
    const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    try { return reply(200, await postJson(CLOUD_URL(), '/cloud/sync/register', code, { email, password, name: String(b.name || '') })); }
    catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message); }
  }
  // Cloud Sync Stage 5 (db/279): list / add / remove extra remote logins on the same cloud tenant. "Turn remote
  // access off" is just removing every login here -- there is no separate switch.
  if (url.pathname === '/offline/cloud-sync-logins' && req.method === 'GET') {
    const code = needSync();
    try { return reply(200, await getJson(CLOUD_URL(), '/cloud/sync/logins', code)); }
    catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message); }
  }
  if (url.pathname === '/offline/cloud-sync-logins' && req.method === 'POST') {
    if (rateLimited('syncreg:' + ip, 10, 15 * 60_000)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    const code = needSync();
    const b = await readJsonBody(req);
    const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || ''), role = String(b.role || 'cashier');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (role !== 'manager' && role !== 'cashier') throw new HttpError(400, 'Choose manager or cashier.');
    try { return reply(200, await postJson(CLOUD_URL(), '/cloud/sync/logins', code, { email, password, role, name: String(b.name || '') })); }
    catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message); }
  }
  if (url.pathname === '/offline/cloud-sync-password' && req.method === 'POST') {
    if (rateLimited('syncpw:' + ip, 10, 15 * 60_000)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    const code = needSync();
    const b = await readJsonBody(req);
    const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Which login?');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    try { return reply(200, await postJson(CLOUD_URL(), '/cloud/sync/logins/password', code, { email, password })); }
    catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message); }
  }
  if (url.pathname === '/offline/cloud-sync-logins' && req.method === 'DELETE') {
    const code = needSync();
    const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
    if (!email) throw new HttpError(400, 'Which login to remove?');
    try { return reply(200, await delJson(CLOUD_URL(), '/cloud/sync/logins?email=' + encodeURIComponent(email), code)); }
    catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message); }
  }
  // Cloud Sync status for Settings (Stage 4): whether this computer's plan even has the add-on, and -- if so --
  // when the background worker (sync-worker.js) last tried, when it last actually got through, any error from
  // the last try, and how many of this computer's own changes are still waiting to go up.
  if (url.pathname === '/offline/sync-status' && req.method === 'GET') {
    const s = licenceStatus();
    const available = !!(s && s.addons && s.addons.sync && (s.state === 'active' || s.state === 'grace'));
    if (!available) return reply(200, { available: false });
    const { rows: trows } = await pool.query('select id from tenants limit 1'); const tid = trows[0]?.id;
    let pending = 0;
    if (tid) { const { rows } = await pool.query('select count(*) n from sty_change_log where tenant_id = $1 and id > (select coalesce(last_pushed, 0) from sty_sync_cursor where tenant_id = $1)', [tid]); pending = Number(rows[0].n); }
    return reply(200, { available: true, pending, ...syncStatus() });
  }
  // The "Sync now" button (Settings -> Remote access): runs a push and a pull right away instead of waiting for
  // the 2-minute timer. Same needSync() gate as the other cloud-sync broker routes.
  if (url.pathname === '/offline/sync-now' && req.method === 'POST') {
    if (rateLimited('syncnow:' + ip, 10, 5 * 60_000)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    needSync();
    try { return reply(200, await syncNow()); }
    catch (e) { throw new HttpError(502, e.message); }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = url.pathname;
  if (p === '/config.js') { // the pages find the server through this file: here it is this same program
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    res.end(`window.CFG={url:${JSON.stringify('http://' + req.headers.host)},key:'',googleClientId:'',appleClientId:'',sentryDsn:''};`);
    return;
  }
  if (p.startsWith('/uploads/') && UPLOADS) { const f = inside(UPLOADS, p.slice('/uploads/'.length)); if (f) return sendFile(res, f, { cache: 'public, max-age=31536000, immutable' }); return false; }
  if (!APP_ROOT) return false;
  const rel = p === '/' ? HOME[PRODUCT] : p.replace(/^\/+/, '');
  const f = inside(APP_ROOT, rel);
  if (f) return sendFile(res, f);
  return false;
}
