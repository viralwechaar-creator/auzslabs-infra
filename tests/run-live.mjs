// Option B: READ-ONLY smoke test against the real website. It only opens pages and clicks harmless things.
// A guard aborts every request that could change data (anything except GET/HEAD/OPTIONS and a few read-only RPCs).
import tls from 'node:tls';
import { chromium, launchOptions } from './lib/pw.mjs';
import { reset, suite, watch, assert, summary } from './lib/harness.mjs';
import { writeReport, verdict, printFailures } from './lib/report.mjs';
import { DEVICES, layoutIssues } from './lib/common.mjs';

const BASE = (process.env.BASE_URL || 'https://auzslab.in').replace(/\/$/, '');
const HOST = new URL(BASE).hostname;
const DEMOS = (process.env.DEMO_TENANTS || 'demo-salon,demo-cafe,demo-retail').split(',').filter(Boolean);
const SAFE_POST = /\/rpc\/(public_menu|public_page|public_invoice|my_dashboard)\b|\/salon-api\/(slots|site)\b|\/auth\/login\b/;
reset('live site (read-only)');
const blocked = [];
const guard = async (ctx) => { await ctx.addInitScript(() => { try { sessionStorage.setItem('sk_loaded', '1'); } catch {} }); return guardRoute(ctx); };
const guardRoute = (ctx) => ctx.route('**/*', (route) => {
  const r = route.request(), m = r.method();
  if (['GET', 'HEAD', 'OPTIONS'].includes(m) || SAFE_POST.test(r.url()) || !/auzslab\.in/.test(r.url())) return route.continue();
  blocked.push(m + ' ' + r.url()); return route.abort();
});

const browser = await chromium.launch(launchOptions());
const tenantUrl = (slug, p = '/') => `https://${slug}.${HOST}${p}`;

// 1. pages + links
{
  const s = suite('Live: every page is up and healthy', 'GET every public page of ' + BASE + ', check status, errors, links.');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await guard(ctx);
  const home = await (await fetch(BASE + '/')).text();
  const pages = new Set(['/', ...[...home.matchAll(/href="\/?([a-z0-9-]+\.html)"/gi)].map((m) => '/' + m[1])]);
  const seen = new Set(pages); const queue = [...pages]; const hrefs = new Map();
  while (queue.length) {
    const p = queue.shift(); const page = await ctx.newPage(); const errs = watch(page);
    await s.check(`${p} loads with no errors`, async () => {
      const t0 = Date.now(); const r = await page.goto(BASE + p, { waitUntil: 'load' }); assert(r.status() === 200, 'HTTP ' + r.status());
      assert(Date.now() - t0 < 6000, 'slow: ' + (Date.now() - t0) + ' ms'); await page.waitForTimeout(500); assert(!errs.length, errs.slice(0, 3).join(' | '));
    }, 'critical');
    const hs = await page.$$eval('a[href]', (a) => a.map((x) => x.getAttribute('href'))).catch(() => []);
    for (const h of hs) { if (!hrefs.has(h)) hrefs.set(h, p); if (/^\/?[a-z0-9-]+\.html/i.test(h) || /^\/[a-z0-9-]+$/i.test(h)) { const u = h.startsWith('/') ? h : '/' + h; const clean = u.split('#')[0].split('?')[0]; if (!seen.has(clean)) { seen.add(clean); queue.push(clean); } } }
    await page.close();
  }
  await s.check('All internal links respond 200', async () => {
    const bad = []; for (const [h, from] of hrefs) { if (/^(mailto:|tel:|#|javascript:|sms:)/.test(h)) continue; const u = new URL(h, BASE + '/'); if (u.host !== HOST) continue; const r = await fetch(u.href, { method: 'HEAD', redirect: 'follow' }).catch(() => ({ status: 0 })); if (r.status >= 400 || !r.status) bad.push(h + ' (' + r.status + ') on ' + from); }
    assert(!bad.length, bad.slice(0, 8).join(' | '));
  }, 'critical');
  await s.check('External links (social, WhatsApp, partners) are reachable', async () => {
    const bad = []; for (const [h, from] of hrefs) { if (!/^https?:/.test(h) || new URL(h).host.endsWith(HOST)) continue; const r = await fetch(h, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } }).catch(() => ({ status: 0 })); if (r.status === 0 || r.status === 404 || r.status === 410) bad.push(h + ' (' + r.status + ') on ' + from); }
    assert(!bad.length, bad.slice(0, 6).join(' | '));
  }, 'minor');
  await ctx.close(); s.done();
}
// 2. responsive
{
  const s = suite('Live: layout on phones, tablets and desktops', 'Home + key pages at 8 screen sizes, read-only.');
  const paths = ['/', '/products.html', '/pricing.html', '/business-salons.html', '/cart.html', '/signup.html', '/contact.html'];
  for (const d of DEVICES) {
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, isMobile: !!d.mobile, hasTouch: !!d.mobile }); await guard(ctx); const page = await ctx.newPage();
    for (const p of paths) { await s.check(`${p} fits ${d.name} (${d.w}px)`, async () => { await page.goto(BASE + p, { waitUntil: 'load' }); await page.waitForTimeout(500); const i = await layoutIssues(page); assert(!i.length, i.join('; ')); }, d.w <= 430 ? 'major' : 'minor'); if (p === '/') await s.shot(page, 'home @ ' + d.name); }
    await ctx.close();
  }
  s.done();
}
// 3. CTAs
{
  const s = suite('Live: buttons that open things (nothing is submitted)', 'Menu, contact form, demo links. Sending is blocked by the guard.');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); await guard(ctx); const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(BASE + '/'); await page.waitForTimeout(800);
  await s.check('Hamburger menu opens and lists pages', async () => { await page.click('#menuToggle'); await page.waitForTimeout(400); assert(await page.locator('#sidebarDrawer').isVisible()); assert((await page.locator('#sidebarDrawer a').count()) >= 5); }, 'critical');
  await s.check('Contact button opens the form', async () => { await page.click('#drawerClose').catch(() => {}); await page.waitForTimeout(300); await page.locator('main [data-open-contact]').first().click(); await page.waitForTimeout(400); assert(await page.locator('#modal').isVisible()); }, 'critical');
  await s.check('Sign-in / signup page shows its form', async () => { await page.goto(BASE + '/signup.html'); await page.waitForTimeout(600); assert(await page.locator('#email').isVisible() && await page.locator('#password').isVisible()); }, 'critical');
  await s.check('No JS errors while clicking around', async () => assert(!errs.length, errs.slice(0, 3).join(' | ')));
  await ctx.close(); s.done();
}
// 4. demo tenants
{
  const s = suite('Live: demo businesses', 'The public demo salon / café / retail sites are up and their login screens render.');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); await guard(ctx); const page = await ctx.newPage(); const errs = watch(page);
  for (const slug of DEMOS) {
    const page = await ctx.newPage(); const errs = watch(page);
    await s.check(`${slug}: front door loads`, async () => { const r = await page.goto(tenantUrl(slug), { waitUntil: 'load' }); assert(r.status() < 400, 'HTTP ' + r.status()); await page.waitForTimeout(1800); assert(!errs.length, errs.splice(0).slice(0, 3).join(' | ')); }, 'critical');
    await s.shot(page, slug + ' front door'); await page.close();
  }
  if (DEMOS.includes('demo-salon')) {
    await s.check('demo-salon: booking slots load', async () => { const r = await fetch(tenantUrl('demo-salon', '/api/slots?date=' + new Date(Date.now() + 864e5).toISOString().slice(0, 10))); assert(r.ok); const d = await r.json(); assert(d.closed || (d.slots && d.slots.length), 'no slots'); }, 'critical');
    await s.check('demo-salon: admin login page renders', async () => { await page.goto(tenantUrl('demo-salon', '/salon/admin/')); await page.waitForTimeout(1200); assert(await page.locator('#loginForm').isVisible()); }, 'critical');
    await s.check('demo-salon: admin area is closed without a password', async () => { const r = await fetch(tenantUrl('demo-salon', '/api/admin/data')); assert(r.status === 401, 'status ' + r.status); }, 'critical');
  }
  await ctx.close(); s.done();
}
// 5. server health
{
  const s = suite('Live: HTTPS, security headers, speed', 'Certificate, redirects, headers and response times.');
  await s.check('http:// redirects to https://', async () => { const r = await fetch('http://' + HOST + '/', { redirect: 'manual' }).catch(() => ({ status: 0, headers: new Map() })); assert(r.status >= 300 && r.status < 400, 'status ' + r.status); assert(String(r.headers.get('location')).startsWith('https://')); }, 'major');
  await s.check('Certificate is valid for more than 14 days', async () => {
    const days = await new Promise((ok, no) => { const sock = tls.connect(443, HOST, { servername: HOST }, () => { const c = sock.getPeerCertificate(); sock.end(); ok((new Date(c.valid_to) - Date.now()) / 864e5); }); sock.on('error', no); });
    assert(days > 14, 'expires in ' + Math.round(days) + ' days');
  }, 'critical');
  await s.check('Wildcard certificate covers tenant subdomains', async () => { const r = await fetch(tenantUrl(DEMOS[0] || 'demo-salon')); assert(r.status < 500); }, 'critical');
  await s.check('Home page responds in under 1.5 s (5 tries, median)', async () => { const t = []; for (let i = 0; i < 5; i++) { const a = Date.now(); await (await fetch(BASE + '/?_=' + i)).text(); t.push(Date.now() - a); } t.sort((a, b) => a - b); assert(t[2] < 1500, 'median ' + t[2] + ' ms'); }, 'major');
  await s.check('Unknown page gives a proper 404 (not a blank or server error)', async () => { const r = await fetch(BASE + '/definitely-not-a-page-xyz.html'); assert(r.status === 404, 'status ' + r.status); }, 'minor');
  await s.check('Internal tools are not exposed publicly (.env, .git, db dumps)', async () => { const bad = []; for (const p of ['/.env', '/.git/config', '/docker-compose.yml', '/server/src/index.js', '/db/000_own_auth.sql']) { const r = await fetch(BASE + p); const t = await r.text(); if (r.status === 200 && !/<html/i.test(t)) bad.push(p); } assert(!bad.length, 'exposed: ' + bad.join(', ')); }, 'critical');
  await s.check('Read-only guard: nothing tried to write data during this run', async () => { assert(!blocked.length, 'blocked writes: ' + blocked.slice(0, 3).join(' | ')); }, 'minor');
  s.done();
}
await browser.close();
const file = writeReport(), v = verdict(), sm = summary();
console.log(`\n${v.label}: ${sm.pass} passed, ${sm.fail} failed (${sm.bySev.critical} critical, ${sm.bySev.major} major, ${sm.bySev.minor} minor)\nReport: ${file}`);
process.exit(sm.bySev.critical ? 1 : 0);
