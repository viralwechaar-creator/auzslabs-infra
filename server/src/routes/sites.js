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
  ['app', /^\/(start\.html|my\.html|salesman\.html|builder\.html)/],
];
const appOf = (p) => { for (const [a, re] of APP_PAGES) if (re.test(p)) return a; return null; };
const base = () => (DOMAIN && DOMAIN !== 'localhost' ? DOMAIN : 'auzslab.in');

const cache = new Map(); let legacy = { at: 0, until: '' };
async function access(slug) {
  const hit = cache.get(slug); if (hit && Date.now() - hit.at < 30000) return hit.v;
  const { rows } = await pool.query('select site_access($1) as r', [slug]);
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
    const a = await access(slug);
    if (!a.exists) return notFound(res);
    const wanted = appOf(path);
    // an app page on a shop address: forward to the app's shared address for the transition period, then refuse
    if (wanted || a.kind === 'none') {
      if (await inLegacyWindow()) {
        const target = wanted || a.app || 'app';
        const q = uri.includes('?') ? uri.slice(uri.indexOf('?')) : '';
        return redirect(res, 'https://' + target + '.' + base() + (path === '/' || (!wanted && a.kind === 'none') ? '/' : path) + q);
      }
      return notFound(res);
    }
    res.writeHead(200, { 'X-Site-Kind': a.kind, 'Cache-Control': 'no-store' }); res.end(); return;
  }

  const bill = url.pathname.match(/^\/bill\/([A-Za-z0-9]{6,80})$/);
  if (bill && req.method === 'GET') {
    const { rows } = await pool.query('select bill_resolve($1) as r', [bill[1]]);
    const r = rows[0].r; if (!r) return notFound(res);
    const page = { style: '/stybill.html?t=', ledger: '/bill.html?t=', mob: '/mobbill.html?t=', pos: '/i.html?o=' }[r.k];
    return redirect(res, 'https://app.' + base() + page + encodeURIComponent(r.t));
  }
  return false;
}
