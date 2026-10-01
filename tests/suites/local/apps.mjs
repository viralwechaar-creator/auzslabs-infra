// Staff apps (POS, back office, payroll, website builder): sign in through the real login screen, then open every tab.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, layoutIssues } from '../../lib/common.mjs';
import { PASSWORD, USERS } from '../../lib/db.mjs';
import http from 'node:http';
// plain GET against the tenant host (static app files are served per subdomain)
const getText = (stack, path) => new Promise((ok, no) => http.get({ host: '127.0.0.1', port: stack.webPort, path, headers: { host: 'testcafe.localhost:' + stack.webPort } }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => ok(b)); }).on('error', no));

const APPS = [['POS', '/index.html'], ['Back office', '/backoffice.html'], ['Payroll', '/payroll.html'], ['Website builder', '/builder.html']];

export default async function run({ browser, stack }) {
  const s = suite('Staff apps: POS, back office, payroll, website builder', 'Logs in through the UI and opens every menu tab on a phone and a desktop; looks for crashes and layout breaks.');
  await s.check('Payroll is its own app: its manifest opens /payroll.html (not the POS) and has its own id', async () => {
    const pm = JSON.parse(await getText(stack, '/manifest-payroll.json')), m = JSON.parse(await getText(stack, '/manifest.json'));
    assert(pm.start_url === '/payroll.html', 'payroll manifest start_url is ' + pm.start_url + ' (home-screen app would open the POS)');
    assert(pm.id && pm.id !== m.id, 'payroll and POS manifests share an app id');
    assert(/manifest-payroll\.json/.test(await getText(stack, '/payroll.html')), 'payroll.html does not link its own manifest');
  }, 'critical');
  await s.check('Service worker never answers Payroll / Back Office / Builder with the POS page', async () => {
    const sw = await getText(stack, '/sw.js');
    assert(!/caches\.match\('\/index\.html'\)\)\)\)\};/.test(sw.replace(/\s+/g, '')) || /pathname==='\/'/.test(sw.replace(/\s+/g, '')) || /u\.pathname=='\/'/.test(sw), 'unconditional index.html fallback');
    assert(/Response\.error\(\)/.test(sw), 'no error response for non-POS pages');
    assert(['/payroll.html', '/backoffice.html', '/builder.html'].every((u) => sw.includes("'" + u + "'")), 'other apps are not precached');
  }, 'critical');
  for (const dev of [{ name: 'phone', w: 390, h: 844, mobile: true }, { name: 'desktop', w: 1366, h: 800 }]) {
    for (const [name, p] of APPS) {
      const ctx = await newCtx(browser, stack, dev); const page = await ctx.newPage(); const errs = watch(page);
      await s.check(`${name} (${dev.name}): login screen shows; wrong password is refused`, async () => {
        await page.goto(stack.url('testcafe', p), { waitUntil: 'load' }); await page.waitForSelector('input[type=password]', { timeout: 15000 });
        await page.fill('input[type=email]', USERS.cafeOwner); await page.fill('input[type=password]', 'wrong-password');
        await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForTimeout(1200);
        assert(await page.locator('input[type=password]').count(), 'wrong password let the user in');
      }, 'critical');
      await s.check(`${name} (${dev.name}): owner signs in and the app opens`, async () => {
        await page.fill('input[type=email]', USERS.cafeOwner); await page.fill('input[type=password]', PASSWORD);
        await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForTimeout(2500);
        assert(!(await page.locator('input[type=password]').count()), 'still on the login screen: ' + (await page.locator('body').innerText()).slice(0, 120).replace(/\n/g, ' '));
      }, 'critical');
      await s.shot(page, `${name} ${dev.name} home`);
      await s.check(`${name} (${dev.name}): every menu tab opens without errors or layout breaks`, async () => {
        const labels = await page.$$eval('.drawer button, nav button, .tabs button', (b) => [...new Set(b.map((x) => (x.textContent || '').trim()).filter((t) => t && t.length < 30 && !/sign out|log ?out/i.test(t)))]);
        assert(labels.length >= 2 || name !== 'POS', 'no navigation buttons found');
        const bad = [];
        for (const l of labels.slice(0, 40)) {
          const before = errs.length;
          await page.evaluate((t) => { const b = [...document.querySelectorAll('.drawer button, nav button, .tabs button')].find((x) => (x.textContent || '').trim() === t); b && b.click(); }, l);
          await page.waitForTimeout(350);
          if (errs.length > before) bad.push(l + ': ' + errs[errs.length - 1].slice(0, 100));
          const li = await layoutIssues(page); if (li.length && dev.mobile) bad.push(l + ': ' + li[0]);
        }
        assert(!bad.length, bad.slice(0, 5).join(' | '));
      }, 'major');
      await ctx.close();
    }
  }
  s.done();
}
