import { readFileSync } from 'node:fs';
import { pool } from '../db.js';
import { tenantForIconContext, appIcon, appManifest } from '../appicon.js';

const DEFAULT_ICON_180 = readFileSync(new URL('../assets/default-icon-180.png', import.meta.url));
const BAILAMOS_180 = readFileSync(new URL('../assets/bailamos-180.png', import.meta.url));
const BAILAMOS_512 = readFileSync(new URL('../assets/bailamos-512.png', import.meta.url));
const RADZ_180 = readFileSync(new URL('../assets/radz-180.png', import.meta.url));
const RADZ_512 = readFileSync(new URL('../assets/radz-512.png', import.meta.url));
const DEFAULT_ICON_512 = readFileSync(new URL('../assets/default-icon-512.png', import.meta.url));

// Returns false when none of this module's routes matched, so the dispatcher in index.js tries the next module;
// any other return (including the undefined that `return reply(...)` gives) means the request was handled.
export async function handle(ctx) {
  const { req, res, url, user, ip, meta, reply, origin } = ctx;
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
    try { const tenant = await tenantForIconContext(req); if (tenant) buf = tenant.slug === 'bailamos' ? (size <= 180 ? BAILAMOS_180 : BAILAMOS_512) : tenant.slug === 'radz' ? (size <= 180 ? RADZ_180 : RADZ_512) : await appIcon(tenant, tenant.settings, size); } catch { buf = null; }
    if (buf) send(buf, 300); else send(fallback(), 300);
    return;
  }
  return false;
}
