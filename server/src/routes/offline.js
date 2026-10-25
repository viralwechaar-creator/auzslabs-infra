import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { OFFLINE } from './licence.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';

// Installed (offline) copy only: this one process also hands out the app's own pages, because there is no web server beside it
// (in the cloud, Caddy does that), and creates the shop on the very first start. Does nothing on the cloud server.
const APP_ROOT = process.env.AUZ_APP_ROOT || '';
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
    return reply(200, { needed: rows[0].needed });
  }
  if (url.pathname === '/setup/first-run' && req.method === 'POST') {
    if (rateLimited('setup:' + ip, 10, 15 * 60_000)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    const b = await readJsonBody(req);
    const shop = String(b.shop || '').trim(), email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
    if (!shop || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter the shop name and a valid email.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    try { await pool.query('select offline_first_run($1, $2, $3, $4)', [shop, String(b.name || ''), email, await bcrypt.hash(password, 10)]); }
    catch (e) { throw new HttpError(400, /already set up/.test(e.message) ? 'This computer is already set up. Sign in instead.' : 'Could not set up: ' + e.message); }
    return reply(200, { ok: true });
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
  const rel = p === '/' ? 'style.html' : p.replace(/^\/+/, '');
  const f = inside(APP_ROOT, rel);
  if (f) return sendFile(res, f);
  return false;
}
