import { pool } from '../db.js';
import { tenantForIconContext, appIcon, appManifest } from '../appicon.js';

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
    const tenant = await tenantForIconContext(req);
    if (!tenant) { res.writeHead(302, { Location: '/icon-512.png' }); res.end(); return; }
    const buf = await appIcon(tenant, tenant.settings, size);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
    res.end(buf);
    return;
  }
  return false;
}
