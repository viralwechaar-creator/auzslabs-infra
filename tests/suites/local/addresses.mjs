// Addresses: one address per app, a shop address only for a shop with a website, short bill links, and nothing opens by typing a different address.
// The server decisions (/site/check, /bill/<code>) are tested against the real database. The routing itself is tested with a real Caddy when one is
// available (CADDY_BIN, `caddy` on the PATH, or a download); without one that part is skipped and says so.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { suite, assert } from '../../lib/harness.mjs';
import { q } from '../../lib/db.mjs';

const free = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const get = (port, host, p, headers = {}) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { Host: host, ...headers } }, (x) => { let b = ''; x.on('data', (c) => { b += c; }); x.on('end', () => res({ s: x.statusCode, h: x.headers, b })); }); r.on('error', rej); r.end(); });

function findCaddy() {
  for (const c of [process.env.CADDY_BIN, '/tmp/caddybin/caddy', 'caddy']) { if (!c) continue; const r = spawnSync(c, ['version'], { encoding: 'utf8' }); if (r.status === 0) return c; }
  return null;
}

export default async function run({ stack }) {
  const s = suite('Addresses', 'One address per app; a shop address only for a shop with a website; short bill links; typing another address opens nothing.');
  const API = stack.apiPort;
  // shops: qr cafe, style store (on), salon, pos only, and one suspended
  const mk = async (slug, niche, features, extra = '') => {
    await q('delete from tenants where slug = $1', [slug]);
    const t = (await q("insert into tenants (slug, name, niche, status) values ($1, $1, $2, 'active') returning id", [slug, niche]))[0].id;
    await q('insert into tenant_settings (tenant_id, features) values ($1, $2::jsonb)', [t, JSON.stringify(features)]);
    return t;
  };
  const tQr = await mk('addrqr', 'cafe', { pos: true, self_order: true });
  const tStore = await mk('addrstore', 'retail', { style: true });
  await q("insert into sty_store (tenant_id, config) values ($1, '{\"on\":true}'::jsonb) on conflict (tenant_id) do update set config = '{\"on\":true}'::jsonb", [tStore]);
  await mk('addrsalon', 'salon', { salon: true });
  await mk('addrpos', 'cafe', { pos: true });
  const tSus = await mk('addrsus', 'cafe', { pos: true, self_order: true }); await q("update tenants set status = 'suspended' where id = $1", [tSus]);
  const tStoreOff = await mk('addrstoreoff', 'retail', { style: true });
  const chk = (slug, p, extra) => get(API, '127.0.0.1', '/site/check', { 'x-forwarded-host': slug + '.auzslab.in', 'x-forwarded-uri': p, ...(extra || {}) });

  await s.check('Server: a shop address exists only for a shop with a website, and says which kind', async () => {
    const a = await chk('addrqr', '/'); assert(a.s === 200 && a.h['x-site-kind'] === 'qr', 'qr ' + a.s + ' ' + a.h['x-site-kind']);
    const b = await chk('addrstore', '/store.html'); assert(b.s === 200 && b.h['x-site-kind'] === 'store', 'store ' + b.s + ' ' + b.h['x-site-kind']);
    const c = await chk('addrsalon', '/salon/'); assert(c.s === 200 && c.h['x-site-kind'] === 'salon', 'salon ' + c.s + ' ' + c.h['x-site-kind']);
    for (const slug of ['addrpos', 'addrstoreoff']) { const d = await chk(slug, '/'); assert(d.s === 302, slug + ' (no website) should forward during the transition, got ' + d.s); }
    for (const slug of ['addrsus', 'nosuchshop']) { const d = await chk(slug, '/'); assert(d.s === 404, slug + ' -> ' + d.s); }
    assert((await get(API, '127.0.0.1', '/site/check', { 'x-forwarded-host': 'evil.example.com', 'x-forwarded-uri': '/' })).s === 404, 'a foreign host must be refused');
    assert((await get(API, '127.0.0.1', '/site/check', { 'x-forwarded-host': 'a.b.auzslab.in', 'x-forwarded-uri': '/' })).s === 404, 'a nested name must be refused');
  }, 'critical');

  await s.check('Server: an app page on a shop address is forwarded to that app\'s own address during the transition, and refused after it', async () => {
    for (const [p, app] of [['/index.html', 'auzspos'], ['/dashboard.html', 'auzspos'], ['/mob.html', 'auzsmob'], ['/style.html', 'auzsstyle'], ['/payroll.html', 'auzspay'], ['/accounts.html', 'auzsledger'], ['/scan.html', 'auzsscan'], ['/finance.html', 'auzsfinance']]) {
      const r = await chk('addrqr', p + '?x=1'); assert(r.s === 302 && r.h.location === 'https://' + app + '.auzslab.in' + p + '?x=1', p + ' -> ' + r.s + ' ' + r.h.location);
    }
    const r0 = await chk('addrpos', '/'); assert(r0.h.location === 'https://auzspos.auzslab.in/', 'a shop with no website goes to its main app: ' + r0.h.location);
  }, 'critical');

  await s.check('Server: a customer\'s short bill link finds the bill and forwards to the page that shows it', async () => {
    const tok = 'ab12cd34ef56';
    await q("insert into records (id, tenant_id, kind, data) values ('bill-test-1', $1, 'order', $2::jsonb) on conflict (tenant_id, id) do update set data = excluded.data", [tQr, JSON.stringify({ id: 'bill-test-1', tok, status: 'paid' })]);
    const r = await get(API, '127.0.0.1', '/bill/' + tok); assert(r.s === 302 && r.h.location === 'https://app.auzslab.in/i.html?o=' + tok, r.s + ' ' + r.h.location);
    for (const bad of ['zzzzzzzzzz', 'a', 'x'.repeat(90), '..%2f..%2fetc']) { const x = await get(API, '127.0.0.1', '/bill/' + bad); assert(x.s === 404, bad + ' -> ' + x.s); }
    const sq = (await q("select bill_resolve('ab12cd34ef56') r"))[0].r; assert(sq && sq.k === 'pos', JSON.stringify(sq));
  }, 'critical');

  await s.check('The automatic WhatsApp bill links are the short main-site link (a shop website page stays on the shop address)', async () => {
    const r = (await q("select wa_tenant_link($1, '/bill.html?t=abc123def') a, wa_tenant_link($1, '/mobbill.html?t=abc123def') b, wa_tenant_link($1, '/store.html#/order/x') c", [tQr]))[0];
    assert(r.a === 'https://auzslab.in/b/abc123def' && r.b === 'https://auzslab.in/b/abc123def', JSON.stringify(r));
    assert(r.c === 'https://addrqr.auzslab.in/store.html#/order/x', r.c);
  });

  await s.check('Browser helper: a link to another app goes to that app\'s address with the sign-in; the main site and local testing are left alone', async () => {
    const win = {}; const g = { window: win, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, location: { hash: '', pathname: '/', search: '', hostname: 'x', protocol: 'https:' }, history: { replaceState() {} }, btoa: (x) => Buffer.from(x, 'binary').toString('base64') };
    new Function('window', 'document', 'localStorage', 'location', 'history', 'btoa', 'unescape', 'encodeURIComponent', fs.readFileSync('app/public/sb-client.js', 'utf8'))(g.window, g.document, g.localStorage, g.location, g.history, g.btoa, unescape, encodeURIComponent);
    const f = win.auzAppUrlFor; const S = { access_token: 'T', user: { id: 1 } };
    const u = f('auzspos.auzslab.in', 'https:', '/mob.html#/x', S); assert(u.startsWith('https://auzsmob.auzslab.in/mob.html#auz_gt=') && u.endsWith('&/x'), u);
    assert(f('auzspos.auzslab.in', 'https:', '/dashboard.html#menu/tables', S) === '/dashboard.html#menu/tables', 'same app stays');
    assert(f('auzslab.in', 'https:', '/index.html', S) === '/index.html' && f('auzslab.in', 'https:', '/style.html', S) === '/style.html', 'the main site is never rewritten');
    assert(f('teststyle.test.local', 'http:', '/mob.html', S) === '/mob.html' && f('127.0.0.1', 'http:', '/mob.html', S) === '/mob.html', 'local testing is left alone');
    assert(f('cafe.auzslab.in', 'https:', '/style.html', null) === 'https://auzsstyle.auzslab.in/style.html', 'no session: just the address');
    assert(f('auzspos.auzslab.in', 'https:', '/ds/auz.css', S) === '/ds/auz.css', 'a shared file is not an app');
  });


  // last, because the server remembers the transition date for a minute
  async function afterTransition() {
    await s.check('Server: after the transition an app page on a shop address and a shop with no website show "not found"', async () => {
      const was = (await q("select value from platform_flags where key = 'legacy_shop_addr_until'"))[0];
      await q("update platform_flags set value = '2000-01-01' where key = 'legacy_shop_addr_until'");
      await new Promise((r) => setTimeout(r, 61000)); // the server remembers the date for a minute
      try {
        assert((await chk('addrqr', '/index.html')).s === 404, 'after the transition an app page on a shop address must be 404');
        assert((await chk('addrpos', '/')).s === 404, 'after the transition a shop with no website must be 404');
        assert((await chk('addrqr', '/')).s === 200, 'its website still works');
      } finally { await q("update platform_flags set value = $1 where key = 'legacy_shop_addr_until'", [was.value]); }
    }, 'critical');
  }

  // ---- the real routing, when a Caddy is available ----
  const caddy = findCaddy();
  if (!caddy) { await s.check('Routing with a real Caddy: SKIPPED (no caddy binary found; set CADDY_BIN to run it)', async () => {}); await afterTransition(); return s; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzcaddy-')); const cp = await free();
  let src = fs.readFileSync('Caddyfile', 'utf8');
  const a = src.indexOf('*.{$DOMAIN} {'), b = src.indexOf('# Monitoring dashboard');
  let blk = src.slice(a, b).replace(/    tls \{[\s\S]*?\n    \}\n/, '').replace('*.{$DOMAIN} {', `http://*.auzslab.in:${cp} {`).replaceAll('{$DOMAIN}', 'auzslab.in').replaceAll('api:3000', '127.0.0.1:' + API)
    .replace('root * /srv/app', 'root * ' + path.resolve('app/public')).replace('root * /srv/uploads', 'root * ' + dir);
  const rootA = src.indexOf('{$DOMAIN} {\n    import security_headers'), rootB = src.indexOf('# ---- Addresses under the main domain');
  const root = src.slice(rootA, rootB).replace('{$DOMAIN} {', `http://auzslab.in:${cp} {`).replaceAll('api:3000', '127.0.0.1:' + API).replace('root * /srv/site', 'root * ' + path.resolve('site'));
  fs.writeFileSync(path.join(dir, 'Caddyfile'), '{\n auto_https off\n admin off\n}\n(compress) {\n encode zstd gzip\n}\n(security_headers) {\n header X-Content-Type-Options nosniff\n}\n' + root + src.slice(src.indexOf('# files every app page needs'), a) + blk);
  const cad = spawn(caddy, ['run', '--config', path.join(dir, 'Caddyfile'), '--adapter', 'caddyfile'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { await get(cp, 'auzslab.in', '/'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    const t = async (host, p, want, loc) => { const r = await get(cp, host + '.auzslab.in', p); assert(r.s === want, `${host}${p} -> ${r.s}, wanted ${want}`); if (loc) assert(r.h.location === loc, `${host}${p} -> ${r.h.location}`); };
    await s.check('Routing: each app address serves its own app and no other app', async () => {
      for (const [h, ok, no] of [['auzspos', ['/', '/index.html', '/dashboard.html', '/pos/core.js'], ['/style.html', '/mob.html', '/payroll.html', '/accounts.html', '/start.html', '/site.html', '/store.html', '/style/core.js']],
        ['auzsstyle', ['/', '/style.html', '/style/core.js'], ['/index.html', '/mob.html', '/pos/core.js', '/dashboard.html']], ['auzsmob', ['/mob.html', '/mob/core.js'], ['/style.html', '/index.html']],
        ['auzspay', ['/payroll.html', '/payroll/core.js'], ['/index.html']], ['auzsledger', ['/accounts.html', '/accounts/core.js'], ['/scan.html', '/index.html']], ['auzsscan', ['/scan.html', '/accounts/core.js'], ['/accounts.html']],
        ['auzsfinance', ['/finance.html', '/finance/core.js'], ['/index.html']], ['app', ['/', '/start.html', '/i.html', '/stybill.html'], ['/index.html', '/mob.html', '/style.html', '/store.html']]]) {
        for (const p of ok) await t(h, p, 200); for (const p of no) await t(h, p, 404);
      }
      await t('auzspos', '/ds/auz.css', 200); await t('auzsstyle', '/sb-client.js', 200);
    }, 'critical');
    await s.check('Routing: a shop address serves only its website; an app page on it forwards to the app address; no website means no address', async () => {
      await t('addrqr', '/', 200); await t('addrqr', '/site.html', 200); await t('addrqr', '/index.html', 302, 'https://auzspos.auzslab.in/index.html'); await t('addrqr', '/pos/core.js', 404); await t('addrqr', '/style/core.js', 404);
      await t('addrqr', '/salon/', 404); await t('addrqr', '/api/site', 404); await t('addrqr', '/ds/auz.css', 200);
      await t('addrstore', '/', 200); await t('addrstore', '/store.html', 200); await t('addrstore', '/store/store.js', 200); await t('addrstore', '/style.html', 302, 'https://auzsstyle.auzslab.in/style.html');
      await t('addrsalon', '/', 200); await t('addrsalon', '/salon/', 200); await t('addrsalon', '/salon/admin/', 200);
      await t('addrpos', '/', 302, 'https://auzspos.auzslab.in/'); await t('addrsus', '/', 404); await t('nosuchshop', '/', 404); await t('nosuchshop', '/site.html', 404);
    }, 'critical');
    await s.check('Routing: the main site\'s short bill link reaches the server, and an app address can be framed only by the hub', async () => {
      const r = await get(cp, 'auzslab.in', '/b/ab12cd34ef56'); assert(r.s === 302 && r.h.location === 'https://app.auzslab.in/i.html?o=ab12cd34ef56', r.s + ' ' + r.h.location);
      const x = await get(cp, 'auzsstyle.auzslab.in', '/style.html'); assert(/frame-ancestors 'self' https:\/\/app\./.test(x.h['content-security-policy'] || ''), String(x.h['content-security-policy']));
    });
  } finally { cad.kill(); }
  await afterTransition();
  return s;
}
