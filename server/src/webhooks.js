// Outgoing storefront webhooks (db/432). Sends queued events to the shop owner's address, signed, with retries.
// Safe by design: https only, the address is checked again at connection time (so a name that later points inside our network is refused),
// no redirects are followed, short timeout, and a small answer limit. WEBHOOK_ALLOW_PRIVATE=1 is for local tests only.
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import crypto from 'node:crypto';
import { pool } from './db.js';

const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === '1';

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true;
    const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateAddress(m[1]);
    return false;
  }
  return true;
}

// the lookup used for the connection itself: every address must be public
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || (!allowPrivate() && addrs.some((a) => isPrivateAddress(a.address)))) return cb(new Error('address not allowed'));
    const a = addrs[0];
    if (options && options.all) return cb(null, addrs.map((x) => ({ address: x.address, family: x.family })));
    return cb(null, a.address, a.family);
  });
}

export function signBody(secret, timestamp, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
}

function post(urlStr, body, headers) {
  return new Promise((resolve) => {
    let u; try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, status: 0, error: 'bad address' }); }
    if (!allowPrivate() && u.protocol !== 'https:') return resolve({ ok: false, status: 0, error: 'https only' });
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return resolve({ ok: false, status: 0, error: 'bad address' });
    if (u.username || u.password) return resolve({ ok: false, status: 0, error: 'bad address' });
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers: { ...headers, 'content-length': Buffer.byteLength(body) }, lookup: safeLookup, timeout: 8000 }, (res) => {
      let n = 0; res.on('data', (c) => { n += c.length; if (n > 65536) res.destroy(); });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, error: res.statusCode >= 200 && res.statusCode < 300 ? null : 'answered ' + res.statusCode }));
      res.on('error', () => resolve({ ok: false, status: res.statusCode || 0, error: 'connection lost' }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timed out' }); });
    req.on('error', (e) => resolve({ ok: false, status: 0, error: String(e.message || e).slice(0, 120) }));
    req.end(body);
  });
}

export async function processWebhooks() {
  const { rows } = await pool.query('select sfx_webhook_claim($1) as r', [20]);
  const list = rows[0]?.r || [];
  for (const e of list) {
    const body = JSON.stringify(e.payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await post(e.url, body, {
      'content-type': 'application/json', 'user-agent': 'AUZslab-Webhooks/1',
      'x-storefront-event': e.event, 'x-storefront-delivery': String(e.id), 'x-storefront-timestamp': ts, 'x-storefront-signature': signBody(e.secret, ts, body),
    });
    await pool.query('select sfx_webhook_result($1, $2, $3, $4)', [e.id, r.ok, r.status || null, r.error]).catch(() => {});
  }
  return list.length;
}

let timer = null;
export function startWebhookWorker() {
  if (process.env.DISABLE_WEBHOOKS === '1' || timer) return;
  timer = setInterval(() => { processWebhooks().catch((e) => console.warn('webhook worker:', e.message)); }, Number(process.env.WEBHOOK_WORKER_MS) || 10_000);
  timer.unref();
}
