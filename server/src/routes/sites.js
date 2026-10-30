import { pool } from '../db.js';
import { DOMAIN } from '../config.js';

// Addresses. Caddy asks this module two things (nothing here is reachable by a browser on purpose: both answers are only useful to Caddy):
//   GET /site/check        -- for every page request on a SHOP address (shopname.auzslab.in): may this shop have a website address?
//                             200 = yes (X-Site-Kind says which website), 302 = old address, forward to the app address (30 days),
//                             404 = no such page. Apps are never served on a shop address.
//   GET /bill/<code>       -- a customer's short bill link (auzslab.in/b/<code>) -> the page that shows that bill.
// The decision is by what the shop has (db/301 site_access), never by what is typed in the address.

// Which shared address each app page belongs to. A shop address asked for one of these pages is forwarded (during the transition) or refused.
const APP_PAGES = [
  ['auzspos', /^\/(index\.html|dashboard\.html|backoffice\.html|pos\/|console\/)/],
  ['auzsstyle', /^\/(style\.html|style\/)/],
  ['auzsmob', /^\/(mob\.html|mob\/)/],
  ['auzspay', /^\/(payroll\.html|payroll\/)/],
  ['auzsledger', /^\/(accounts\.html|accounts\/)/],
  ['auzsscan', /^\/scan\.html/],
  ['auzsfinance', /^\/(finance\.html|finance\/)/],
  ['app', /^\/(start\.html|my\.html)/],
];
// files a shop's own website / bill pages use: never an app page, whatever folder they live in
const WEB_SUPPORT = /^\/(mob\/receipt|accounts\/(bill|invoice-templates|taxinv)\.js|accounts\/accounts\.css)/;
const appOf = (p) => { if (WEB_SUPPORT.test(p)) return null; for (const [a, re] of APP_PAGES) if (re.test(p)) return a; return null; };
const base = () => (DOMAIN && DOMAIN !== 'localhost' ? DOMAIN : 'auzslab.in');

const cache = new Map(); let legacy = { at: 0, until: '' };
async function access(slug) {
  const hit = cache.get(slug); if (hit && Date.now() - hit.at < 30000) return hit.v;
  let rows;
  try { ({ rows } = await pool.query('select site_access($1::text) as r', [slug])); }
  catch (e) {
    // the database has not had db/301 applied yet: say so plainly instead of a 500 on every page of every shop
    if (e && e.code === '42883') { const err = new Error('The address rules are not installed yet: run  bash tools/migrate.sh apply  on the server (db/301).'); err.status = 503; err.notReported = true; throw err; }
    throw e;
  }
  const v = rows[0].r || { exists: false };
  if (cache.size > 2000) cache.clear();
  cache.set(slug, { at: Date.now(), v });
  return v;
}
async function inLegacyWindow() {
  if (Date.now() - legacy.at > 60000) {
    const { rows } = await pool.query("select value from platform_flags where key = 'legacy_shop_addr_until'");
    legacy = { at: Date.now(), until: rows[0] ? rows[0].value : '' };
  }
  return !!legacy.until && new Date().toISOString().slice(0, 10) <= legacy.until;
}

const PAGE_404 = '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Page not found</title><body style="font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#222"><div style="text-align:center"><h1 style="font-size:20px">Page not found</h1><p>This address has no page. Visit <a href="https://' + 'AUZ_BASE' + '">AUZslab</a>.</p></div></body>';
function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(PAGE_404.replace('AUZ_BASE', base())); }
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }

export async function handle(ctx) {
  const { req, res, url } = ctx;

  if (url.pathname === '/site/check' && req.method === 'GET') {
    const host = String(req.headers['x-forwarded-host'] || '').split(',')[0].toLowerCase().replace(/:\d+$/, '');
    const uri = String(req.headers['x-forwarded-uri'] || '/');
    const path = uri.split('?')[0];
    const slug = host.endsWith('.' + base()) ? host.slice(0, -(base().length + 1)) : '';
    if (!slug || slug.includes('.')) return notFound(res);
    let a;
    try { a = await access(slug); }
    catch (e) {
      // the address rules are not installed in the database yet (db/301): keep every address working exactly as it did before
      if (e && e.status === 503) { if (Date.now() - (access.warned || 0) > 60000) { access.warned = Date.now(); console.error('[site/check] ' + e.message); } res.writeHead(200, { 'X-Site-Kind': 'none', 'X-Site-Legacy': '1', 'Cache-Control': 'no-store' }); res.end(); return; }
      throw e;
    }
    if (!a.exists) return notFound(res);
    const wanted = appOf(path);
    // Old shop addresses keep working exactly as before during the transition window, and the demo businesses always do:
    // Caddy then serves every file of the app (see X-Site-Legacy in the Caddyfile).
    if (a.demo || await inLegacyWindow()) {
      res.writeHead(200, { 'X-Site-Kind': a.kind, 'X-Site-Legacy': '1', 'Cache-Control': 'no-store' }); res.end(); return;
    }
    // Remote access for AUZsStyle: its own address always opens the AUZsStyle app (staff sign in from anywhere).
    if (a.style && (wanted === 'auzsstyle' || (a.kind === 'none' && path === '/'))) {
      res.writeHead(200, { 'X-Site-Kind': a.kind, 'X-Site-Remote': 'style', 'Cache-Control': 'no-store' }); res.end(); return;
    }
    // after the window an app page (or a shop without a website) on a shop address is refused
    if (wanted || a.kind === 'none') return notFound(res);
    res.writeHead(200, { 'X-Site-Kind': a.kind, 'Cache-Control': 'no-store' }); res.end(); return;
  }

  const bill = url.pathname.match(/^\/bill\/([A-Za-z0-9]{6,80})$/);
  if (bill && req.method === 'GET') {
    const { rows } = await pool.query('select bill_resolve($1::text) as r', [bill[1]]);
    const r = rows[0].r; if (!r) return notFound(res);
    const page = { style: '/stybill.html?t=', ledger: '/bill.html?t=', mob: '/mobbill.html?t=', pos: '/i.html?o=' }[r.k];
    return redirect(res, 'https://app.' + base() + page + encodeURIComponent(r.t));
  }
  return false;
}
