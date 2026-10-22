import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';
import { tenantForIconContext, appIcon, appManifest } from '../appicon.js';

const DEFAULT_ICON_180 = readFileSync(new URL('../assets/default-icon-180.png', import.meta.url));
const BAILAMOS_180 = readFileSync(new URL('../assets/bailamos-180.png', import.meta.url));
const BAILAMOS_512 = readFileSync(new URL('../assets/bailamos-512.png', import.meta.url));
const RADZ_180 = readFileSync(new URL('../assets/radz-180.png', import.meta.url));
const RADZ_512 = readFileSync(new URL('../assets/radz-512.png', import.meta.url));
const DEFAULT_ICON_512 = readFileSync(new URL('../assets/default-icon-512.png', import.meta.url));

// One place that decides a business's icon picture: the one it uploaded, else the fixed Bailamos / Radz icons, else a
// generated one (logo or initials).
async function iconBuf(tenant, size) {
  if (tenant.settings && tenant.settings.appIcon) return appIcon(tenant, tenant.settings, size);
  if (tenant.slug === 'bailamos') return size <= 180 ? BAILAMOS_180 : BAILAMOS_512;
  if (tenant.slug === 'radz') return size <= 180 ? RADZ_180 : RADZ_512;
  return appIcon(tenant, tenant.settings, size);
}

// The website and POS pages are sent through here (Caddy routes them to the API on business addresses) so the
// business's icon can be written INTO the page as a data: link. An iPhone only accepts a home-screen icon that is
// part of the page it receives: the same picture linked by web address, or put in by script afterwards, showed a
// grey letter tile.
const APP_ROOT = process.env.APP_ROOT || '/srv/app';
const ICON_PAGES = new Set(['/site-kiln.html', '/site.html', '/index.html']);

// Returns false when none of this module's routes matched, so the dispatcher in index.js tries the next module;
// any other return (including the undefined that `return reply(...)` gives) means the request was handled.
export async function handle(ctx) {
  const { req, res, url, user, ip, meta, reply, origin } = ctx;
  // ---- AUZsStyle store link previews. WhatsApp / Facebook / Telegram bots do not run JavaScript, so Caddy sends them here for
  // /store.html and they get the product's own title, price, picture and the shop name + address. People never see this page. ----
  if (url.pathname === '/store-share' && req.method === 'GET') {
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].replace(/[^a-z0-9.:-]/gi, '');
    const slug = String(url.searchParams.get('shop') || host.split('.')[0]).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const pid = String(url.searchParams.get('p') || '').replace(/[^a-f0-9-]/gi, '').slice(0, 40);
    let d = null;
    try { const r = await pool.query('select public_sty_share($1, $2) as d', [slug, /^[0-9a-f-]{36}$/i.test(pid) ? pid : null]); d = r.rows[0] && r.rows[0].d; } catch { d = null; }
    const origin2 = 'https://' + host;
    const abs = (u) => (!u ? '' : /^https?:\/\//.test(u) ? u : u.startsWith('//') ? 'https:' + u : u.startsWith('data:') ? '' : origin2 + (u.startsWith('/') ? '' : '/') + u);
    const shop = (d && d.shop) || 'Store';
    const isP = !!(d && d.name);
    const price = d && d.price ? 'Rs ' + Math.round(Number(d.price)).toLocaleString('en-IN') : '';
    const title = isP ? d.name + (price ? ' · ' + price : '') + ' · ' + shop : shop + (d && d.tagline ? ' · ' + d.tagline : '');
    const desc = (isP ? [d.description, 'Visit ' + shop + ' at ' + host].filter(Boolean).join(' · ') : ((d && d.tagline) || 'Shop online') + ' · ' + host).replace(/\s+/g, ' ').slice(0, 200);
    const img = abs(isP ? (d.photo || d.heroPhoto) : ((d && (d.heroPhoto || d.photo)) || ''));
    const pageUrl = origin2 + '/store.html' + (isP ? '?p=' + pid : '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:type" content="${isP ? 'product' : 'website'}"><meta property="og:site_name" content="${esc(shop)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(pageUrl)}">${img ? `<meta property="og:image" content="${esc(img)}">` : ''}
<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">${img ? `<meta name="twitter:image" content="${esc(img)}">` : ''}
</head><body><a href="${esc(pageUrl)}">${esc(title)}</a></body></html>`);
  }
  // ---- health: for uptime monitors (UptimeRobot etc.). Public on purpose and carries nothing sensitive: it only
  // says whether the API is up and can reach the database. ----
  if (url.pathname === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    try {
      await pool.query('select 1');
      return reply(200, { ok: true, db: true, uptime_s: Math.round(process.uptime()) });
    } catch {
      return reply(503, { ok: false, db: false });
    }
  }

  // ---- per-tenant home-screen icon/manifest for the main app shell
  // (POS, console, Payroll, Accounting, AUZsMob). Public on purpose, no
  // session needed -- a browser asks for these before anyone is signed
  // in. See server/src/appicon.js. Falls back to the static, shared
  // AUZslab icon/manifest for a shared address (app., auzsmob., ...) or
  // an unknown subdomain. ----
  if (url.pathname === '/app-manifest.json' && req.method === 'GET') {
    const tenant = await tenantForIconContext(req);
    if (!tenant) { res.writeHead(302, { Location: '/manifest.json' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(JSON.stringify(appManifest(tenant, tenant.settings)));
    return;
  }
  const appIconMatch = url.pathname.match(/^\/app-icon\/(\d+)\.png$/);
  if (appIconMatch && req.method === 'GET') {
    const size = Math.min(512, Math.max(32, parseInt(appIconMatch[1], 10) || 192));
    // Always answer 200 with image bytes: iPhones show a blank icon when the icon address redirects or errors.
    const send = (buf, age) => { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=' + age }); res.end(buf); };
    const fallback = () => (size <= 180 ? DEFAULT_ICON_180 : DEFAULT_ICON_512);
    let buf = null;
    try { const tenant = await tenantForIconContext(req); if (tenant) buf = await iconBuf(tenant, size); } catch { buf = null; }
    if (buf) send(buf, 300); else send(fallback(), 300);
    return;
  }
  if (ICON_PAGES.has(url.pathname) && req.method === 'GET') {
    let html;
    try { html = await readFile(path.join(APP_ROOT, url.pathname), 'utf8'); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    try {
      const tenant = await tenantForIconContext(req);
      if (tenant) {
        const uri = 'data:image/png;base64,' + (await iconBuf(tenant, 180)).toString('base64');
        html = html.replace(/<link\s+rel=("?)apple-touch-icon\1[^>]*>/i, () => `<link rel="apple-touch-icon" href="${uri}">`);
        const nm = String((tenant.settings && tenant.settings.name) || tenant.name || '').replace(/[<>"&]/g, '').trim();
        if (nm) html = html.replace(/(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/i, (_m, a, b) => a + nm + b);
      }
    } catch { /* serve the page as it is */ }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
    return;
  }
  return false;
}
