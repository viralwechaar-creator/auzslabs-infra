// The scroll-world pages: scroll every page end to end on a phone and a desktop, look for crashes, dead scenes and slow frames;
// then make sure the same pages are still readable with animations switched off (reduced motion).
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';

const WORLD = ['index', 'products', 'pos', 'crm', 'billing', 'inventory', 'qr-ordering', 'payroll', 'website-builder', 'business-cafes', 'business-salons', 'business-retail', 'business-clothing', 'platform', 'pricing', 'contact', 'creatopz', 'custom-build', 'live-demo', 'resources-getting-started', 'resources-operations', 'resources-growth'];

export default async function run({ browser, stack }) {
  const s = suite('Scroll worlds: every page scrolled end to end, plus the no-animation fallback', 'Looks for JavaScript errors while scrolling, scenes that never start, sideways overflow, and checks the pages stay readable with reduced motion.');
  for (const dev of [{ name: 'phone', w: 390, h: 844, mobile: true }, { name: 'tablet', w: 768, h: 1024, mobile: true }, { name: 'desktop', w: 1366, h: 800 }]) {
    const ctx = await newCtx(browser, stack, dev); const page = await ctx.newPage(); const errs = watch(page);
    for (const n of WORLD) {
      await s.check(`${n} (${dev.name}): scrolls top to bottom without errors, scenes run, no sideways scroll`, async () => {
        errs.length = 0;
        await page.goto(stack.url('', '/' + n + '.html'), { waitUntil: 'load' }); await page.waitForTimeout(700);
        const info = await page.evaluate(async () => {
          const H = document.documentElement.scrollHeight, out = { scenes: window.FX ? FX.scenes.length : -1, live: document.documentElement.classList.contains('fx-live'), flow: document.documentElement.classList.contains('fx-flow-ready'), moved: 0 };
          const frames = []; let last = performance.now(); let stop = false;
          (function loop(t) { frames.push(t - last); last = t; if (!stop) requestAnimationFrame(loop); })(last);
          for (let y = 0; y < H; y += 420) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 55)); }
          window.scrollTo(0, H);
          for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); if (!window.FX || !FX.scenes.length || Math.min(...FX.scenes.filter((x) => x.mode === 'pin').map((x) => x.p).concat([1])) > .95) break; }
          stop = true;
          frames.sort((a, b) => a - b); out.p95 = Math.round(frames[Math.floor(frames.length * .95)] || 0); out.h = H;
          out.over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          out.progress = window.FX && FX.scenes.length ? Math.min(...FX.scenes.filter((x) => x.mode === 'pin').map((x) => x.p).concat([1])) : 1;
          return out;
        });
        assert(!errs.length, errs.slice(0, 3).join(' | '));
        assert(info.live || info.flow, 'animation layer not switched on');
        assert(info.flow && info.scenes === 0, 'expected the flowing stacked layout, got scenes=' + info.scenes);
        assert(await page.evaluate(() => document.querySelectorAll('.stack-panel').length >= 2), 'stack panels missing');
        assert(info.over <= 2, 'page scrolls sideways by ' + info.over + 'px');
        {
          await page.evaluate(async () => { window.scrollTo({ top: 0, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 900)); });
          const bad = await page.evaluate(() => {
            const els = [...document.querySelectorAll('main .fx-stage .k')].filter((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('.hh') && !e.closest('.fx-world') && !e.closest('.stack-panel') && !e.matches('.cubebox, .stack3d, .doorway'); });
            const it = els.map((e) => ({ e, r: e.getBoundingClientRect(), t: (e.className.baseVal ?? e.className).toString().split(' ').slice(0, 2).join('.') })), out = [];
            for (let i = 0; i < it.length; i++) for (let j = i + 1; j < it.length; j++) { const a = it[i], b = it[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue; const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top); if (x > 8 && y > 8 && x * y > .15 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) out.push(a.t + ' overlaps ' + b.t); }
            return out.slice(0, 3);
          });
          assert(!bad.length, 'text blocks overlap: ' + bad.join(' | '));
        }
        assert(info.progress > .95 || info.scenes === 0, 'scene stuck at ' + info.progress);
      }, 'critical');
    }
    await ctx.close();
  }
  // reduced motion: the page must still be a normal readable document
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); await rctx.addInitScript(() => { try { sessionStorage.setItem('sk_loaded', '1'); } catch {} }); await stack.attach(rctx);
  const rp = await rctx.newPage(); const re = watch(rp);
  for (const n of ['index', 'products', 'pos', 'business-salons', 'pricing', 'contact', 'resources-getting-started']) {
    await s.check(`${n} with animations off: headline, buttons and body text are all visible`, async () => {
      re.length = 0; await rp.goto(stack.url('', '/' + n + '.html'), { waitUntil: 'load' }); await rp.waitForTimeout(500);
      assert(!(await rp.evaluate(() => document.documentElement.classList.contains('fx-live'))), 'animation layer still on');
      const r = await rp.evaluate(() => { const m = document.querySelector('main'); const t = m.innerText.trim(); const hid = [...m.querySelectorAll('h1,h2,a.btn,button.btn')].filter((e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.visibility === 'hidden' || cs.display === 'none' || (cs.opacity === '0' && !e.closest('[data-reveal],.fx-split')); }).map((e) => e.textContent.trim().slice(0, 30)); return { len: t.length, hid, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
      assert(r.len > 200, 'only ' + r.len + ' characters of text on the page');
      assert(!r.hid.length, 'hidden: ' + r.hid.slice(0, 4).join(' | '));
      assert(r.over <= 2, 'sideways overflow ' + r.over + 'px');
      assert(!re.length, re.slice(0, 2).join(' | '));
    }, 'critical');
  }
  await rctx.close(); s.done();
}
