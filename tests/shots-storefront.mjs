// Screenshots and layout measurements of every storefront dashboard page: desktop and phone, light and dark.
// Not a test. Usage: node tests/shots-storefront.mjs [outDir]   (default tests/report/storefront-ui)
// Writes <outDir>/<route>__<desktop|phone>__<light|dark>.png and results.json (overflow, small tap targets, font sizes).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, launchOptions } from './lib/pw.mjs';
import { build, q, PASSWORD, USERS } from './lib/db.mjs';
import { startStack } from './lib/stack.mjs';
import { rpc } from './lib/api.mjs';
import { ROOT, newCtx } from './lib/common.mjs';

const out = path.resolve(process.argv[2] || path.join(ROOT, 'tests/report/storefront-ui'));
fs.mkdirSync(out, { recursive: true });
const { menu } = await import(pathToFileURL(path.join(ROOT, 'app/public/storefront/data.js')).href);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SIZES = { desktop: [1280, 800, false], phone: [390, 844, true] };

await build(() => {});
const stack = await startStack();
const browser = await chromium.launch(launchOptions());
await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
const owner = await login(USERS.cafeOwner);
const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
const unwrap = (r) => (r && r.data !== undefined && !r.error ? r.data : r);
const pr = unwrap(await call('sfx_product_save', { p_id: null, p: { name: 'Linen shirt', price: 1499, status: 'active', category: 'Shirts', variants: [{ label: 'S', price: 1499, stock: 20 }, { label: 'M', price: 1499, stock: 20 }] } }));
await call('sfx_product_save', { p_id: null, p: { name: 'Canvas tote bag', price: 599, status: 'active', category: 'Bags', variants: [{ label: 'One size', price: 599, stock: 4 }] } });
await call('sfx_discount_save', { p_id: null, p: { code: 'WELCOME10', kind: 'percent', value: 10 } }).catch(() => {});
await q("update sfx_products set images=jsonb_build_array($2::text) where id=$1", [pr.id, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mO4wPDvPwMDAwMDAA0GBAHXbSHyAAAAAElFTkSuQmCC']).catch(() => {});
let firstOrder = null;
for (let i = 0; i < 4; i++) {
const zones = ['Asia/Kolkata','Asia/Kolkata','Asia/Dubai','Europe/London','America/New_York','Asia/Singapore','Australia/Sydney'];
for (let z = 0; z < zones.length; z++) await rpc(stack, 'public_sfx_track', { p_slug: 'testcafe', p: { events: [{ sid: 'visitor-' + z + '-abcdefgh', k: 'view', p: '/', dev: z % 2 ? 'phone' : 'desktop', tz: zones[z] }] } });
  await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: ['Asha Rao', 'Dev Mehta', 'Meera Shah', 'Karan Joshi'][i], phone: '98765000' + (10 + i), email: 'c' + i + '@example.com', address: '12 Park Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', payment: 'cod', lines: [{ variantId: pr.variants[i % 2].id, qty: 1 + (i % 3) }] } });
}
firstOrder = (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;

const routes = [];
const add = (r) => { if (!routes.includes(r)) routes.push(r); };
for (const m of menu) { if (!m.id) continue; add(m.id); for (const c of m.children || []) add(c[0]); }
['orders/' + firstOrder, 'products/' + pr.id, 'products/new', 'collections/new', 'customers'].forEach(add);

const results = [];
const ctx0 = await newCtx(browser, stack, { w: 1280, h: 800 });
const boot = await ctx0.newPage();
await boot.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await boot.waitForTimeout(800);
await boot.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
const savedLs = await boot.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; }); await ctx0.close();

for (const [sizeName, [w, h, mobile]] of Object.entries(SIZES)) {
  const ctx = await newCtx(browser, stack, { w, h, mobile }); await ctx.addInitScript((st) => { for (const [k, v] of Object.entries(st)) try { localStorage.setItem(k, v); } catch (e) { /* about:blank */ } }, savedLs);
  if (process.env.BASELINE) await ctx.route('**/storefront/ui.css*', (r) => r.abort());
  if (process.env.SAFE) await ctx.route('**/storefront/*.css*', async (r) => { const f = new URL(r.request().url()).pathname; const body = (await import('node:fs')).readFileSync(path.join(process.cwd(), 'app/public' + f), 'utf8').replaceAll('env(safe-area-inset-top,0px)', process.env.SAFE + 'px').replaceAll('env(safe-area-inset-top, 0px)', process.env.SAFE + 'px'); await r.fulfill({ status: 200, contentType: 'text/css', body }); });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  for (const route of routes) {
    if (only && !only.some(o => route === o || route.startsWith(o + "/"))) continue;
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/' + route), { waitUntil: 'load' }); await page.waitForTimeout(2600);
    for (const scheme of ['light', 'dark']) {
      await page.evaluate((sc) => { const sh = document.querySelector('.shell'); if (sh) sh.dataset.theme = sc; }, scheme);
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const de = document.documentElement; const small = []; const vw = window.innerWidth;
        document.querySelectorAll('.shell main button, .shell main a.btn, .shell main input:not([type=hidden]):not([type=checkbox]), .shell main select').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width && r.height && r.height < 32) small.push((el.className || el.tagName).toString().slice(0, 30) + ':' + Math.round(r.height)); });
        const title = document.querySelector('main h1, .page-head h1'); const fs = title ? parseFloat(getComputedStyle(title).fontSize) : null;
        const over = []; document.querySelectorAll('.shell main *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.right > vw + 1 && r.width < vw * 3 && over.length < 4) over.push((el.className || el.tagName).toString().slice(0, 30)); });
        return { scrollW: de.scrollWidth, vw, hOverflow: de.scrollWidth > vw + 1, overEls: over, smallControls: small.length, smallSample: small.slice(0, 3), titlePx: fs, hasShell: !!document.querySelector('.shell'), bodyText: (document.querySelector('main') || document.body).innerText.length };
      });
      if (process.env.COLLAPSE && route === 'home' && scheme === 'light' && sizeName === 'desktop') {
        await page.click('[data-action=toggle-side]'); await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(out, 'sidebar_collapsed.png') });
        await page.click('[data-action=toggle-side]'); await page.waitForTimeout(300);
      }
      if (process.env.INTERACT && route === 'live-view' && scheme === 'light') {
        const c = await page.$('.gl-canvas'); const b = await c.boundingBox();
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 220, cy + 40, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(600);
        await page.mouse.wheel(0, -600); await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(out, 'globe_dragged_zoomed__' + sizeName + '.png') });
        await page.click('[data-g=toggle]'); await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(out, 'globe_map__' + sizeName + '.png') });
        await page.click('[data-g=toggle]'); await page.waitForTimeout(300);
      }
      if (process.env.DIALOG && route === 'orders' && scheme === 'light') {
        await page.evaluate(() => { const b = document.querySelector('.plus-menu .more-menu a'); b && b.closest('details').remove(); });
        await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/drafts'), { waitUntil: 'load' }); await page.waitForTimeout(2200);
        await page.evaluate(() => document.querySelector('[data-action="draft-new"]').click()); await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(out, 'dialog__' + sizeName + '.png') });
        await page.keyboard.press('Escape'); await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders'), { waitUntil: 'load' }); await page.waitForTimeout(1500);
      }
      if (process.env.DBG && sizeName === 'phone' && scheme === 'light') { const d = await page.evaluate(() => { const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: c.display, color: c.color, fs: c.fontSize, vis: c.visibility, op: c.opacity, text: (e.textContent || '').slice(0, 30) }; }; return { chk: (() => { const c = document.querySelector('td input[data-bulk]'); if (!c) return null; const t = c.closest('td'); const r = t.getBoundingClientRect(); const cs = getComputedStyle(t); return { tdIdx: [...t.parentNode.children].indexOf(t), label: t.dataset.label, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), pos: cs.position, order: cs.order, disp: cs.display, ml: cs.marginLeft }; })(), name: g('.mobile-page-name'), h1: g('.page-head h1'), top: g('.topbar'), brand: g('.mobile-brand'), crumb: g('.breadcrumb') }; }); console.log(route, JSON.stringify(d)); }
      const file = route.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) + '__' + sizeName + '__' + scheme + '.png';
      await page.screenshot({ path: path.join(out, file), fullPage: false });
      results.push({ route: route.replace(firstOrder, '<order>').replace(pr.id, '<product>'), size: sizeName, scheme, file, ...m });
    }
  }
  if (errs.length) results.push({ size: sizeName, pageErrors: errs.slice(0, 5) });
  await ctx.close();
}
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.route && (r.hOverflow || !r.hasShell));
console.log('pages', routes.length, 'captures', results.filter((r) => r.route).length, 'with sideways scroll or no shell:', bad.length);
for (const b of bad.slice(0, 40)) console.log(' ', b.route, b.size, b.scheme, 'scrollW', b.scrollW, 'vw', b.vw, (b.overEls || []).join(','));
await browser.close(); await stack.stop?.();
process.exit(0);
