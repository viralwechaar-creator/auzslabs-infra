// Starts the real API server against the TEST database, plus a tiny static server that behaves like
// our Caddy config (per-tenant subdomains via *.localhost, /api -> /salon-api, /i/<token>, land.html fallback).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PG } from './db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function proxy(req, res, port, newUrl) {
  const p = http.request({ host: '127.0.0.1', port, path: newUrl, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
  req.pipe(p);
}

import net from 'node:net';
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

export async function startStack({ apiPort, webPort, log = () => {} } = {}) {
  apiPort = apiPort || await freePort(); webPort = webPort || await freePort();
  const uploads = fs.mkdtempSync('/tmp/auz-uploads-');
  const env = { ...process.env, PORT: String(apiPort), PGHOST: PG.host, PGPORT: String(PG.port), POSTGRES_APP_PASSWORD: PG.appPassword, POSTGRES_DB: PG.db,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123', DOMAIN: 'localhost', DISABLE_RATE_LIMIT: '1', UPLOAD_ROOT: uploads, DOC_UPLOAD_ROOT: uploads + '-private' };
  const api = spawn('node', ['src/index.js'], { cwd: path.join(root, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  process.on('exit', () => { try { api.kill('SIGKILL'); } catch {} });
  let apiLog = '';
  api.stdout.on('data', (d) => (apiLog += d)); api.stderr.on('data', (d) => (apiLog += d));
  await new Promise((ok, no) => {
    const t0 = Date.now();
    const tick = () => { if (/listening/.test(apiLog)) return ok(); if (api.exitCode !== null) return no(new Error('API exited: ' + apiLog)); if (Date.now() - t0 > 15000) return no(new Error('API start timeout: ' + apiLog)); setTimeout(tick, 150); };
    tick();
  });
  log('api up on ' + apiPort);

  const web = http.createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const sub = host.endsWith('.localhost') ? host.slice(0, -'.localhost'.length) : '';
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (p.includes('..')) { res.writeHead(400); return res.end(); }
    if (!sub) { // marketing site (auzslab.in)
      let f = path.join(root, 'site', p);
      if (p.endsWith('/')) f = path.join(f, 'index.html');
      if (!isFile(f) && isFile(f + '.html')) f += '.html';
      return isFile(f) ? serveFile(res, f) : (res.writeHead(404, { 'content-type': 'text/html' }), res.end('<h1>404</h1>'));
    }
    // tenant subdomain (<slug>.auzslab.in)
    if (p.startsWith('/api/')) return proxy(req, res, apiPort, '/salon-api' + req.url.slice(4));
    if (p.startsWith('/uploads/')) { const f = path.join(uploads, p.slice(9)); return isFile(f) ? serveFile(res, f) : (res.writeHead(404), res.end()); }
    const app = path.join(root, 'app', 'public');
    let m;
    if ((m = /^(\/salon(?:\/[a-z]+)?)\/?$/.exec(p))) p = m[1] + '/index.html';
    if (/^\/i\/[a-f0-9]{8,32}$/.test(p)) p = '/salon/invoice.html';
    const f = path.join(app, p);
    return serveFile(res, isFile(f) ? f : path.join(app, 'land.html'));
  });
  await new Promise((ok) => web.listen(webPort, '127.0.0.1', ok));
  log('web up on ' + webPort);

  const apiBase = 'http://127.0.0.1:' + apiPort;
  // Pages on the marketing site and the POS apps talk to https://api.auzslab.in; send that to the local API instead.
  async function attach(context) {
    await context.route('https://api.auzslab.in/**', async (route) => {
      const r = route.request();
      const url = new URL(r.url());
      try {
        const resp = await fetch(apiBase + url.pathname + url.search, { method: r.method(), headers: { ...r.headers(), host: '127.0.0.1' }, body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() });
        const headers = {}; resp.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) headers[k] = v; });
        await route.fulfill({ status: resp.status, headers, body: Buffer.from(await resp.arrayBuffer()) });
      } catch (e) { await route.abort(); }
    });
  }
  return {
    apiPort, webPort, apiBase,
    url: (sub, p = '/') => `http://${sub ? sub + '.' : ''}localhost:${webPort}${p}`,
    attach, getLog: () => apiLog,
    async stop() { api.kill('SIGTERM'); await new Promise((ok) => web.close(ok)); fs.rmSync(uploads, { recursive: true, force: true }); },
  };
}
