// AUZslab design system: every staff app reads the same tokens and accent, adapts at each layout tier (compact < 600,
// medium 600-899, expanded 900-1199, wide >= 1200), never scrolls sideways, keeps text >= 12px and touch targets >= 44px,
// works in dark mode, and the POS keyboard shortcuts work.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, layoutIssues } from '../../lib/common.mjs';
import { PASSWORD, USERS } from '../../lib/db.mjs';

const APPS = [
  { name: 'POS', host: 'testcafe', path: '/index.html', email: USERS.cafeOwner, ready: '.tbl-tile, .items .tile', fill: 'btn fill' },
  { name: 'Admin console', host: 'testcafe', path: '/dashboard.html', email: USERS.cafeOwner, ready: '.hello', fill: 'btn p' },
  { name: 'Back Office', host: 'testcafe', path: '/backoffice.html', email: USERS.cafeOwner, ready: '.top-bar h1', fill: 'p', tag: 'button' },
  { name: 'Payroll', host: 'testcafe', path: '/payroll.html', email: USERS.cafeOwner, ready: '.ax-shell', fill: 'p', tag: 'button' },
  { name: 'Accounting', host: 'testacct', path: '/accounts.html', email: USERS.acctOwner, ready: '.shell', fill: 'btn fill' },
];
const WIDTHS = [360, 600, 768, 900, 1024, 1200, 1440];

export default async function run({ browser, stack }) {
  const s = suite('Design system: one look across the staff apps, at every width', 'Checks that POS, admin console, Back Office, Payroll and Accounting share the AUZslab tokens and accent, adapt at every layout tier, and stay readable and usable.');
  const open = async (app, w, h = 900, opts = {}) => {
    let c2;
    if (opts.dark) { c2 = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' }); await stack.attach(c2); }
    else c2 = await newCtx(browser, stack, { w, h, mobile: w < 900 });
    const page = await c2.newPage(); const errs = watch(page);
    await page.goto(stack.url(app.host, app.path)); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', app.email); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector(app.ready, { timeout: 20000 }); await page.waitForTimeout(900);
    return { ctx: c2, page, errs };
  };
  // the colour a primary button in this app actually paints, plus the token values
  const sample = (page, app) => page.evaluate(({ cls, tag }) => {
    const b = document.createElement(tag || 'button'); b.className = cls; b.textContent = 'x'; document.body.append(b);
    const st = getComputedStyle(b), cs = getComputedStyle(document.documentElement);
    const out = { fill: st.backgroundColor, ink: st.color, ds: !!document.querySelector('link[href*="/ds/auz.css"]'), font: getComputedStyle(document.body).fontFamily, bg: getComputedStyle(document.body).backgroundColor, label: cs.getPropertyValue('--label').trim() };
    b.remove(); return out;
  }, { cls: app.fill, tag: app.tag });

  const fills = {};
  for (const app of APPS) {
    await s.check(`${app.name}: loads the shared design system, system font, warm-neutral page and the business accent`, async () => {
      const { ctx, page, errs } = await open(app, 1440);
      const x = await sample(page, app); fills[app.name] = x.fill;
      assert(x.ds, 'does not link /ds/auz.css');
      assert(/-apple-system|system-ui/.test(x.font) && !/^Inter/.test(x.font), 'body font is ' + x.font);
      assert(x.bg === 'rgb(245, 244, 242)', 'page background is ' + x.bg + ', not the shared --bg');
      assert(x.label === '#1d1d1f', 'text token is ' + x.label);
      const bad = errs.filter((e) => !/WebSocket|ERR_CERT|tunnel|ERR_FAILED|print/i.test(e)); assert(!bad.length, bad.slice(0, 2).join(' | '));
      await ctx.close();
    }, 'major');
  }
  await s.check('Same business, same accent: POS, admin console, Back Office and Payroll paint primary buttons in one colour', () => {
    const cafe = ['POS', 'Admin console', 'Back Office', 'Payroll'].map((n) => fills[n]);
    assert(cafe.every((c) => c && c === cafe[0]), 'primary colours differ: ' + JSON.stringify(fills));
    assert(cafe[0] === 'rgb(31, 61, 46)', 'accent is not the business colour #1f3d2e: ' + cafe[0]);
    assert(fills.Accounting === 'rgb(128, 0, 32)', 'Accounting (no business colour set) is not AUZslab wine: ' + fills.Accounting);
  }, 'major');

  for (const app of APPS) {
    await s.check(`${app.name}: no sideways scrolling at ${WIDTHS.join(', ')} px`, async () => {
      const { ctx, page } = await open(app, WIDTHS[0], 800); const bad = [];
      for (const w of WIDTHS) { await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(250); const li = await layoutIssues(page); if (li.length) bad.push(w + 'px: ' + li[0]); }
      assert(!bad.length, bad.join(' | ')); await ctx.close();
    }, 'major');
  }

  const sideW = (page, sel) => page.evaluate((x) => { const e = document.querySelector(x); if (!e) return 0; const st = getComputedStyle(e); return st.display === 'none' ? 0 : Math.round(e.getBoundingClientRect().width); }, sel);
  const vis = (page, sel) => page.evaluate((x) => { const e = document.querySelector(x); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; }, sel);
  await s.check('POS layout tiers: phone cart bar, tablet split view (items + order), icon rail to 1199px, full sidebar from 1200px, and the toggle', async () => {
    const pos = APPS[0]; const { ctx, page } = await open(pos, 390, 844);
    await page.evaluate(() => { S.cur = null; go('sell'); }); await page.waitForTimeout(400);
    await page.locator('.items .tile').first().click(); await page.waitForTimeout(300);
    assert(await vis(page, '.cart-bar') && !(await vis(page, '.sell .ticket-pane')), 'phone: expected the cart bar, not the order pane');
    assert(await vis(page, '.tabbar'), 'phone: no tab bar');
    await page.setViewportSize({ width: 768, height: 1024 }); await page.waitForTimeout(300);
    assert(await vis(page, '.sell .ticket-pane') && !(await vis(page, '.cart-bar')), 'tablet: items and the order are not side by side');
    await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(300);
    assert((await sideW(page, '.side')) === 72, 'expanded: sidebar is ' + (await sideW(page, '.side')) + 'px, not the 72px rail');
    assert(!(await vis(page, '.tabbar')), 'expanded: tab bar still shown');
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
    assert((await sideW(page, '.side')) === 240, 'wide: sidebar is ' + (await sideW(page, '.side')) + 'px');
    await page.locator('.side-tg').click(); await page.waitForTimeout(400);
    assert((await sideW(page, '.side')) === 72, 'toggle did not collapse the sidebar');
    await page.locator('.side-tg').click(); await page.waitForTimeout(400);
    assert((await sideW(page, '.side')) === 240, 'toggle did not expand the sidebar again');
    const groups = await page.locator('.side .grp').allInnerTexts();
    assert(['Service', 'More', 'Back office'].every((g) => groups.some((x) => x.toLowerCase() === g.toLowerCase())), 'sidebar groups: ' + groups.join(', '));
    assert(await page.locator('.side a.navlink', { hasText: 'Inventory' }).count(), 'no Inventory link to the back office');
    await ctx.close();
  }, 'major');
  await s.check('POS keyboard: ? lists shortcuts, Alt+number switches section, / jumps to item search', async () => {
    const { ctx, page } = await open(APPS[0], 1440);
    await page.keyboard.press('?'); await page.waitForTimeout(300);
    assert(/Keyboard shortcuts/.test(await page.locator('.md').last().innerText()), 'shortcuts sheet did not open');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await page.keyboard.press('Alt+Digit3'); await page.waitForTimeout(400);
    const tab = await page.evaluate(() => S.tab), third = await page.evaluate(() => navItems().filter((n) => n.k !== 'more')[2].k);
    assert(tab === third, 'Alt+3 opened ' + tab + ', expected ' + third);
    await page.keyboard.press('/'); await page.waitForTimeout(400);
    assert(await page.evaluate(() => S.tab === 'sell' && document.activeElement && document.activeElement.type === 'search'), '/ did not focus the item search');
    await ctx.close();
  }, 'minor');
  await s.check('Accounting layout tiers: tab bar on phones, centred sheets on tablets, icon rail to 1199px, full sidebar from 1200px', async () => {
    const acc = APPS[4]; const { ctx, page } = await open(acc, 390, 844);
    assert(await vis(page, '.tabbar') && !(await vis(page, '.side')), 'phone: expected tab bar only');
    await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(400);
    assert((await sideW(page, '.side')) === 72, 'expanded: sidebar is ' + (await sideW(page, '.side')) + 'px');
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(400);
    assert((await sideW(page, '.side')) === 240, 'wide: sidebar is ' + (await sideW(page, '.side')) + 'px');
    const groups = await page.locator('.side .gh').allInnerTexts();
    assert(['Sales', 'Purchases', 'Accounts', 'Financial reports'].every((g) => groups.includes(g)), 'groups: ' + groups.join(', '));
    await ctx.close();
  }, 'major');
  await s.check('Payroll layout tiers: bottom tab bar on phones, sidebar on desktop', async () => {
    const { ctx, page } = await open(APPS[3], 390, 844);
    assert(await vis(page, '.ax-tabs') && !(await vis(page, '.ax-side')), 'phone: expected the tab bar only');
    await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(300);
    assert((await sideW(page, '.ax-side')) === 72 && !(await vis(page, '.ax-tabs')), 'expanded: expected the icon rail');
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
    assert((await sideW(page, '.ax-side')) === 240, 'wide: sidebar ' + (await sideW(page, '.ax-side')));
    await page.locator('.ax-side nav button', { hasText: 'Payroll run' }).click(); await page.waitForTimeout(400);
    assert((await page.locator('.top-bar h1').innerText()) === 'Payroll run', 'sidebar did not switch section');
    await ctx.close();
  }, 'major');

  for (const app of [APPS[0], APPS[1], APPS[4]]) {
    await s.check(`${app.name} (phone): text is at least 12px and controls are at least 44px tall`, async () => {
      const { ctx, page } = await open(app, 390, 844);
      const r = await page.evaluate(() => {
        const tiny = [], small = [];
        for (const e of document.querySelectorAll('body *')) {
          const rc = e.getBoundingClientRect(); if (!rc.width || !rc.height || rc.bottom < 0 || rc.top > innerHeight) continue;
          const st = getComputedStyle(e); if (st.visibility === 'hidden' || +st.opacity === 0) continue;
          const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (own && parseFloat(st.fontSize) < 12) tiny.push(e.tagName + ' ' + st.fontSize + ' "' + e.textContent.trim().slice(0, 20) + '"');
          if ((e.matches('.tabbar button, .tabbar a, button.btn, .btn') ) && rc.height < 43.5 && !e.closest('svg')) small.push(e.textContent.trim().slice(0, 20) + ' ' + Math.round(rc.height) + 'px');
        }
        return { tiny: tiny.slice(0, 4), small: small.slice(0, 4) };
      });
      assert(!r.tiny.length, 'text under 12px: ' + r.tiny.join(', '));
      assert(!r.small.length, 'targets under 44px: ' + r.small.join(', '));
      await ctx.close();
    }, 'minor');
  }

  for (const app of [APPS[0], APPS[1], APPS[4]]) {
    await s.check(`${app.name}: dark appearance is really dark and body text stays readable (contrast 4.5:1 or more)`, async () => {
      const { ctx, page } = await open(app, 1440, 900, { dark: true });
      const r = await page.evaluate(() => {
        const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number), lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bg = rgb(getComputedStyle(document.body).backgroundColor), fg = rgb(getComputedStyle(document.body).color), a = lum(bg), b = lum(fg);
        const light = [...document.querySelectorAll('.card, .kpi, .sync, .pay, .side, .ticket-pane')].filter((e) => { const c = rgb(getComputedStyle(e).backgroundColor); return c.length === 3 && lum(c) > 0.6 && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'; }).map((e) => e.className).slice(0, 3);
        return { bgL: a, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), light };
      });
      assert(r.bgL < 0.05, 'page background is not dark');
      assert(r.ratio >= 4.5, 'body text contrast ' + r.ratio.toFixed(2));
      assert(!r.light.length, 'light panels left in dark mode: ' + r.light.join(', '));
      await ctx.close();
    }, 'major');
  }

  await s.check('Open sheets pin the page behind them: scrolling inside a sheet never moves the page (POS and Accounting, phone)', async () => {
    const pos = APPS[0]; { const { ctx, page } = await open(pos, 390, 844);
      await page.evaluate(() => go('more')); await page.waitForTimeout(500);
      await page.evaluate(() => { const b = document.querySelector('#body'); b.scrollTop = 40; sheet({ title: 'Long', body: h('div', null, ...Array.from({ length: 60 }, (_, i) => h('p', null, 'line ' + i))) }); });
      await page.waitForTimeout(500);
      const before = await page.evaluate(() => document.querySelector('#body').scrollTop);
      await page.locator('.md-b').evaluate((e) => { e.scrollTop = 9999; }); await page.mouse.move(195, 500); await page.mouse.wheel(0, 600); await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ bg: document.querySelector('#body').scrollTop, sheet: document.querySelector('.md-b').scrollTop, locked: document.documentElement.classList.contains('auz-lock') }));
      assert(after.locked, 'page was not locked while the sheet is open'); assert(after.sheet > 0, 'sheet did not scroll'); assert(after.bg === before, 'background scrolled from ' + before + ' to ' + after.bg);
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      assert(!(await page.evaluate(() => document.documentElement.classList.contains('auz-lock'))), 'page stayed locked after the sheet closed');
      await ctx.close(); }
    const acc = APPS[4]; { const { ctx, page } = await open(acc, 390, 844);
      await page.evaluate(() => go('reports')); await page.waitForTimeout(600); await page.evaluate(() => window.scrollTo(0, 120)); await page.waitForTimeout(200);
      const y0 = await page.evaluate(() => scrollY);
      await page.evaluate(() => sheet({ title: 'Long', body: h('div', null, ...Array.from({ length: 60 }, (_, i) => h('p', null, 'line ' + i))) })); await page.waitForTimeout(500);
      await page.mouse.move(195, 500); await page.mouse.wheel(0, 800); await page.waitForTimeout(300);
      const st = await page.evaluate(() => ({ locked: document.documentElement.classList.contains('auz-lock'), fixed: getComputedStyle(document.body).position, top: document.body.style.top }));
      assert(st.locked && st.fixed === 'fixed', 'page not pinned behind the sheet'); assert(st.top === '-' + y0 + 'px', 'page jumped: ' + st.top);
      await page.keyboard.press('Escape'); await page.locator('.sheet-h button').first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(500);
      assert(Math.abs((await page.evaluate(() => scrollY)) - y0) <= 2, 'scroll position not restored after closing');
      await ctx.close(); }
  }, 'major');

  await s.check('Back Office menu (phone): header on top, nothing clipped, Settings opens and closes its sub-menu, no stuck dim layer', async () => {
    const { ctx, page } = await open(APPS[2], 390, 844);
    await page.locator('.hamburger-btn').click(); await page.waitForTimeout(600);
    const r = await page.evaluate(() => { const d = document.querySelector('.drawer').getBoundingClientRect(), h = document.querySelector('.drawer .dh').getBoundingClientRect(), f = document.querySelector('.drawer .dl button').getBoundingClientRect(); return { top: Math.round(d.top), headTop: Math.round(h.top), firstBelow: f.top >= h.bottom, subOpen: document.querySelector('.drawer .dsub').classList.contains('open') }; });
    assert(r.top === 0 && r.headTop === 0, 'drawer does not start at the top: ' + JSON.stringify(r)); assert(r.firstBelow, 'first item is under the header');
    assert(await page.locator('.drawer .dq', { hasText: 'Open POS' }).count() && await page.locator('.drawer .dq', { hasText: 'Sign out' }).count(), 'Open POS / Sign out missing under the header');
    await page.locator('.drawer .dsec').click(); await page.waitForTimeout(300);
    const nowOpen = await page.evaluate(() => document.querySelector('.drawer .dsub').classList.contains('open')); assert(nowOpen !== r.subOpen, 'Settings did not toggle');
    await page.locator('.drawer .dsec').click(); await page.waitForTimeout(300);
    assert((await page.evaluate(() => document.querySelector('.drawer .dsub').classList.contains('open'))) === r.subOpen, 'Settings did not toggle back');
    await page.locator('.drawer .dx').click(); await page.waitForTimeout(500);
    assert(await page.evaluate(() => getComputedStyle(document.querySelector('.drawer-ov')).visibility === 'hidden'), 'dim layer still visible after closing');
    await ctx.close();
  }, 'major');
  s.done();
}
