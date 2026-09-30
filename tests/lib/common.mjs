import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEVICES = [
  { name: 'iPhone SE', w: 320, h: 640, mobile: true }, { name: 'iPhone 8', w: 375, h: 667, mobile: true },
  { name: 'iPhone 14', w: 390, h: 844, mobile: true }, { name: 'Pixel Large', w: 430, h: 932, mobile: true },
  { name: 'iPad portrait', w: 768, h: 1024, mobile: true }, { name: 'iPad landscape', w: 1024, h: 768 },
  { name: 'Laptop', w: 1280, h: 800 }, { name: 'Desktop', w: 1536, h: 864 },
];
export const sitePages = () => fs.readdirSync(path.join(ROOT, 'site')).filter((f) => f.endsWith('.html')).sort();

export async function newCtx(browser, stack, dev = { w: 1280, h: 800 }) {
  const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, isMobile: !!dev.mobile, hasTouch: !!dev.mobile, deviceScaleFactor: 1 });
  if (stack) await stack.attach(ctx);
  return ctx;
}
// Horizontal overflow, tiny text and tiny tap targets: the usual "looks broken on phone" problems.
export async function layoutIssues(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth, out = [];
    const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
    if (sw > vw + 2) {
      let worst = null;
      for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > vw + 2 && getComputedStyle(el).position !== 'fixed' && !el.closest('[aria-hidden="true"],.marquee,.ticker')) { worst = el; break; } }
      out.push('page scrolls sideways (' + sw + 'px wide on a ' + vw + 'px screen)' + (worst ? ' near <' + worst.tagName.toLowerCase() + ' class="' + (worst.className && worst.className.baseVal === undefined ? worst.className : '') + '">' : ''));
    }
    const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:'));
    if (imgs.length) out.push(imgs.length + ' broken image(s), e.g. ' + imgs[0].src.slice(0, 90));
    return out;
  });
}
