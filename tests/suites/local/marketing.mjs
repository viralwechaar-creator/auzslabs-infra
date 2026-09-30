// Every page of auzslab.in: loads, no errors, every internal link/anchor resolves, key CTAs work.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, sitePages, layoutIssues } from '../../lib/common.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Marketing site: every page, link and button', 'Opens all pages of auzslab.in, checks for errors, broken links/anchors, contact button, menu, cart buttons.');
  const ctx = await newCtx(browser, stack); const pages = sitePages();
  const links = new Map();
  for (const f of pages) {
    const page = await ctx.newPage(); const errs = watch(page);
    await s.check(`${f} loads without errors`, async () => {
      const r = await page.goto(stack.url('', '/' + f), { waitUntil: 'load' }); assert(r.status() === 200, 'HTTP ' + r.status());
      await page.waitForTimeout(400);
      assert(!errs.length, errs.slice(0, 3).join(' | '));
      const t = await page.title(); assert(t && t.length > 3, 'missing <title>');
      assert(await page.locator('h1').count() > 0, 'page has no <h1>');
    }, 'critical');
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => [a.getAttribute('href'), (a.textContent || '').trim().slice(0, 30)]));
    for (const [h, t] of hrefs) { if (!links.has(h)) links.set(h, []); links.get(h).push(f + ' ("' + t + '")'); }
    await s.check(`${f}: every #anchor link points to something on the page`, async () => {
      const bad = await page.$$eval('a[href^="#"]', (as) => as.map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.getElementById(h.slice(1)) && !document.getElementsByName(h.slice(1)).length));
      assert(!bad.length, 'dead anchors: ' + [...new Set(bad)].join(', '));
    });
    await s.check(`${f}: images all load`, async () => { const i = await layoutIssues(page); const im = i.filter((x) => /image/.test(x)); assert(!im.length, im.join('; ')); }, 'minor');
    await page.close();
  }
  await s.check('Every internal link on the site leads to a real page', async () => {
    const bad = [];
    for (const [h, from] of links) {
      if (/^(mailto:|tel:|https?:|javascript:|#|sms:|whatsapp:)/i.test(h)) continue;
      const u = new URL(h, stack.url('', '/index.html')); const r = await fetch(stack.apiBase.replace(/:\d+$/, ':' + stack.webPort) + u.pathname, { headers: { host: 'localhost:' + stack.webPort } }).catch(() => ({ status: 0 }));
      if (r.status !== 200) bad.push(`${h} (${r.status}) on ${from[0]}`);
    }
    assert(!bad.length, bad.slice(0, 8).join(' | '));
  }, 'critical');

  const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(stack.url('', '/index.html')); await page.waitForTimeout(500);
  await s.check('Homepage on a phone: hamburger menu opens and closes', async () => {
    const mctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const mp = await mctx.newPage(); await mp.goto(stack.url('', '/index.html')); await mp.waitForTimeout(500);
    await mp.click('#menuToggle'); await mp.waitForTimeout(500);
    assert(await mp.locator('#sidebarDrawer').isVisible(), 'drawer did not open');
    const n = await mp.locator('#sidebarDrawer a').count(); assert(n >= 5, 'drawer has only ' + n + ' links');
    await mp.click('#drawerClose'); await mp.waitForTimeout(500);
    assert(!(await mp.locator('#drawerOverlay').evaluate((e) => e.classList.contains('open'))), 'drawer did not close'); await mctx.close();
  }, 'critical');
  await s.check('Homepage on desktop: MENU button slides the menu into view and it closes again', async () => {
    await page.click('#menuToggle'); await page.waitForTimeout(600);
    const box = await page.locator('#sidebarDrawer').boundingBox(); assert(box && box.x < 1280 - 100, 'menu panel is not on screen after clicking MENU (x=' + (box && Math.round(box.x)) + ')');
    await page.click('#drawerClose'); await page.waitForTimeout(700);
    const b2 = await page.locator('#sidebarDrawer').boundingBox(); assert(!b2 || b2.x >= 1270, 'menu did not close');
  }, 'critical');
  await s.check('Every link inside the menu drawer works', async () => {
    const hs = await page.$$eval('#sidebarDrawer a', (as) => as.map((a) => a.getAttribute('href')).filter((h) => h && !/^(#|mailto:|tel:|https?:)/.test(h)));
    for (const h of [...new Set(hs)]) { const r = await page.request.get(new URL(h, stack.url('', '/index.html')).href); assert(r.status() === 200, h + ' -> ' + r.status()); }
  }, 'critical');
  await s.check('Homepage: a "Contact" button opens the contact form', async () => {
    const trig = page.locator('main [data-open-contact]').first();
    assert(await trig.count(), 'no [data-open-contact] button found');
    await trig.scrollIntoViewIfNeeded(); await trig.click({ force: true }); await page.waitForTimeout(400);
    assert(await page.locator('#modal').isVisible(), 'contact modal did not open');
    await page.click('#modalClose'); await page.waitForTimeout(300);
  }, 'critical');
  await s.check('Contact form refuses an empty submit', async () => {
    await page.locator('main [data-open-contact]').first().click({ force: true }); await page.waitForTimeout(300);
    const before = await page.locator('#successView').isVisible().catch(() => false);
    await page.locator('#formView button[type=submit], #formView [type=submit]').first().click();
    await page.waitForTimeout(400);
    assert(!(await page.locator('#successView').isVisible().catch(() => false)) || before, 'empty form showed success');
  });
  await s.shot(page, 'homepage-desktop');
  await s.check('No console/network errors on the homepage after interaction', async () => assert(!errs.length, errs.slice(0, 3).join(' | ')));
  await ctx.close(); s.done();
}
