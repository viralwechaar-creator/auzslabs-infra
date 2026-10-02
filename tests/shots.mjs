// Design screenshots of every staff app at the four layout widths (phone, tablet, compact desktop, desktop), light
// and dark. Not a test: a before/after record. Usage: node tests/shots.mjs [outDir]   (default tests/report/design)
import fs from 'node:fs';
import path from 'node:path';
import { chromium, launchOptions } from './lib/pw.mjs';
import { build, PASSWORD, USERS } from './lib/db.mjs';
import { startStack } from './lib/stack.mjs';
import { rpc } from './lib/api.mjs';
import { ROOT } from './lib/common.mjs';

const out = path.resolve(process.argv[2] || path.join(ROOT, 'tests/report/design'));
fs.mkdirSync(out, { recursive: true });
const WIDTHS = [[390, 844, true], [768, 1024, true], [1024, 768, false], [1440, 900, false]];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const scheme = process.env.SCHEME || 'light';

await build(() => {});
const stack = await startStack();
const browser = await chromium.launch(launchOptions());
const token = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
const acct = await token(USERS.acctOwner);
await rpc(stack, 'acc_bootstrap', {}, acct);
const cust = (await rpc(stack, 'acc_save_party', { p: { kind: 'customer', name: 'Raj Traders', phone: '9876543210' } }, acct)).data.data;
for (let i = 0; i < 3; i++) await rpc(stack, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust.id, post: true, lines: [{ description: 'Catering ' + (i + 1), qty: 2 + i, rate: 1250 }] } }, acct);

async function login(page, host, url, email, ready) {
  await page.goto(stack.url(host, url)); await page.waitForSelector('input[type=password]', { timeout: 20000 });
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASSWORD);
  await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector(ready, { timeout: 20000 }); await page.waitForTimeout(1200);
}
const APPS = {
  pos: { host: 'testcafe', url: '/index.html', email: USERS.cafeOwner, ready: '.tbl-tile', views: {
    tables: async (p) => { await p.evaluate(() => go('tables')); },
    sell: async (p) => { await p.evaluate(() => go('tables')); await p.locator('.tbl-tile').first().click(); await p.waitForSelector('.items .tile'); await p.locator('.items .tile').nth(0).click(); await p.locator('.items .tile').nth(1).click(); },
    orders: async (p) => { await p.evaluate(() => go('orders')); },
    kitchen: async (p) => { await p.evaluate(() => go('kitchen')); },
    more: async (p) => { await p.evaluate(() => go('more')); } } },
  console: { host: 'testcafe', url: '/dashboard.html', email: USERS.cafeOwner, ready: '.hello', views: {
    home: async () => {}, items: async (p) => { await p.evaluate(() => go(flatNav().find((x) => /item/i.test(x[0]))[0])); } } },
  backoffice: { host: 'testcafe', url: '/backoffice.html', email: USERS.cafeOwner, ready: 'body', views: { home: async () => {} } },
  payroll: { host: 'testcafe', url: '/payroll.html', email: USERS.cafeOwner, ready: 'body', views: { home: async () => {} } },
  accounts: { host: 'testacct', url: '/accounts.html', email: USERS.acctOwner, ready: '.shell', views: {
    home: async (p) => { await p.evaluate(() => go('home')); }, sales: async (p) => { await p.evaluate(() => go('sales')); },
    invoice: async (p) => { await p.evaluate(() => go('new/invoice')); }, reports: async (p) => { await p.evaluate(() => go('reports')); } } },
};
for (const [app, a] of Object.entries(APPS)) {
  if (only && !only.includes(app)) continue;
  for (const [w, hgt, mobile] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, colorScheme: scheme });
    await stack.attach(ctx); const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    try {
      await login(page, a.host, a.url, a.email, a.ready);
      for (const [v, fn] of Object.entries(a.views)) {
        try { await fn(page); await page.waitForTimeout(900); } catch (e) { errs.push(v + ': ' + e.message.split('\n')[0]); }
        await page.screenshot({ path: path.join(out, `${app}-${v}-${w}${scheme === 'dark' ? '-dark' : ''}.png`) });
      }
    } catch (e) { errs.push('login: ' + e.message.split('\n')[0]); }
    if (errs.length) console.log(app, w, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}
await browser.close(); await stack.stop();
console.log('screenshots in ' + out);
