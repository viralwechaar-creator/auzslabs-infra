// Reads the real, rendered marketing pages (site/*.html in Chromium at phone width) and writes native/auzshub/assets/site/pages.json:
// each section as a tree of boxes / text / images / svg with the COMPUTED styles (fonts, sizes, colours, borders, radii, shadows, padding, gap,
// rotation), so the app can draw the same cards and elements. Run after the website changes:
//   node native/auzshub/tool/extract_site.mjs      (needs Playwright + Chromium; see CLAUDE.md "Native hub marketing pages")
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../site');
const OUT = path.resolve(here, '../assets/site/pages.json');
const PAGES = ['index', 'products', 'pricing', 'pos', 'qr-ordering', 'payroll', 'accounting', 'scan-and-bill', 'billing', 'crm', 'inventory', 'intelligence', 'platform', 'studio', 'ip-custom-development', 'creatopz', 'business-cafes', 'business-clothing', 'business-mobile-repair', 'business-retail', 'business-salons', 'learn', 'resources-getting-started', 'resources-operations', 'resources-growth', 'contact', 'live-demo', 'security', 'terms', 'privacy', 'refund', 'cookies', 'acceptable-use', 'hardware-terms', 'join-team', 'sitemap', 'delete-account'];
const STACK = new Set(['index', 'pos', 'billing', 'business-cafes', 'products']);
const PAGE_PRODUCT = { pos: 'pos', 'qr-ordering': 'self_order', payroll: 'payroll', accounting: 'accounting', billing: 'billing', crm: 'crm', inventory: 'inventory', 'business-mobile-repair': 'mobile', 'scan-and-bill': 'scan' };
const INCLUDED = new Set(['crm', 'billing', 'inventory']);

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
    r.end(d);
  });
}).listen(8125);

// ---- runs inside the page ----
function inPage([name, stackMode, pageProduct, included]) {
  const hex = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return h(p[0]) + h(p[1]) + h(p[2]) + (a < 1 ? h(a * 255) : '');
  };
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const r1 = (n) => Math.round(n * 10) / 10;
  const SKIP_TAG = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CANVAS', 'FORM', 'SELECT', 'INPUT', 'TEXTAREA', 'TEMPLATE', 'IFRAME', 'VIDEO', 'AUDIO', 'HEADER', 'ASIDE', 'NAV', 'FOOTER', 'BR', 'HR']);
  const fam = (f) => (/space mono/i.test(f) ? 'm' : (/georgia|serif|cursive|caveat|playfair/i.test(f.replace(/sans-serif/gi, '')) && !/inter|apple-system/i.test(f.split(',')[0]) ? 's' : 'i'));
  const tstyle = (cs) => {
    const s = {};
    const fs = num(cs.fontSize); s.fs = r1(fs);
    const lh = cs.lineHeight === 'normal' ? 1.2 : num(cs.lineHeight) / fs; s.lh = r1(lh * 100) / 100;
    const fw = parseInt(cs.fontWeight, 10); if (fw !== 400) s.fw = fw;
    const f = fam(cs.fontFamily); if (f !== 'i') s.ff = f;
    const ls = num(cs.letterSpacing); if (ls) s.ls = r1(ls * 100) / 100;
    const sw = num(cs.webkitTextStrokeWidth);
    const fh = hex(cs.webkitTextFillColor);
    if (sw > 0) { const sc = hex(cs.webkitTextStrokeColor) || hex(cs.color) || '000000'; s.sk = [r1(sw), sc]; if (!fh) s.nf = 1; }
    const col = fh || hex(cs.color); s.col = col || '000000';
    if (cs.textTransform === 'uppercase') s.tt = 'u';
    if (cs.textAlign === 'center') s.ta = 'c'; else if (cs.textAlign === 'right' || cs.textAlign === 'end') s.ta = 'r';
    if (cs.fontStyle === 'italic') s.it = 1;
    if ((cs.textDecorationLine || '').includes('underline')) s.ul = 1;
    if ((cs.textDecorationLine || '').includes('line-through')) s.st = 1;
    return s;
  };
  const rotOf = (cs) => {
    const m = /matrix\(([^)]+)\)/.exec(cs.transform || '');
    if (!m) return 0;
    const p = m[1].split(',').map(Number);
    return r1(Math.atan2(p[1], p[0]) * 180 / Math.PI);
  };
  const shadow = (v) => {
    if (!v || v === 'none') return null;
    const out = [];
    const re = /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/g;
    let m;
    while ((m = re.exec(v))) out.push([r1(+m[2]), r1(+m[3]), r1(+m[4]), r1(+(m[5] || 0)), hex(m[1]) || '00000000']);
    return out.length ? out : null;
  };
  const side = (cs, s) => { const w = num(cs['border' + s + 'Width']); if (!w || cs['border' + s + 'Style'] === 'none') return 0; const c = hex(cs['border' + s + 'Color']); return c ? [r1(w), c, cs['border' + s + 'Style'] === 'dashed' || cs['border' + s + 'Style'] === 'dotted' ? 'd' : 's'] : 0; };
  const isBlockDisplay = (d) => !/^inline($|-(?!block|flex))/.test(d) || /inline-(block|flex|grid)/.test(d) ? !/^inline$/.test(d) && !/^contents$/.test(d) : false;
  const visible = (el, cs) => {
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.hasAttribute('hidden')) return false;
    if (parseFloat(cs.opacity) < 0.02) return false;
    return true;
  };
  const productOf = (el) => {
    let a = el;
    while (a && a.nodeType === 1) { if (a.dataset && a.dataset.product) return a.dataset.product; a = a.parentElement; }
    return pageProduct || '';
  };
  const actions = (el, n) => {
    if (el.tagName === 'A' && el.getAttribute('href') && !/^javascript/.test(el.getAttribute('href'))) n.h = el.getAttribute('href');
    let act = '';
    if (el.hasAttribute('data-add') || el.hasAttribute('data-product')) act = 'add';
    if (el.hasAttribute('data-open-contact')) act = 'contact';
    const m = /[?&]add=([a-z_,]+)/.exec(n.h || '');
    let p = '';
    if (m) { act = 'add'; p = m[1]; delete n.h; }
    if (el.hasAttribute('data-add-plan')) { act = 'add'; p = el.getAttribute('data-add-plan'); }
    if (act) {
      n.a = act;
      if (act === 'add') { n.p = p || productOf(el); if (included.includes(n.p)) { n.a = 'inc'; } }
    }
  };
  const pseudo = (el, which, cs) => {
    const ps = getComputedStyle(el, which);
    const c = ps.content;
    if (!c || c === 'none' || c === 'normal') return null;
    if (ps.display === 'none') return null;
    const isAbs = ps.position === 'absolute' || ps.position === 'fixed';
    const txt = /^"(.*)"$/.exec(c);
    const t = txt ? txt[1].replace(/\\(.)/g, '$1') : '';
    if (t) { const n = { k: 't', r: [{ x: t }], s: tstyle(ps) }; if (isAbs) { n.abs = [r1(num(ps.left)), r1(num(ps.top))]; } return n; }
    if (isAbs) return null;
    const bg = hex(ps.backgroundColor);
    const w = num(ps.width), h = num(ps.height);
    if (bg && w > 0 && h > 0) { const n = { k: 'r', w: r1(w), h: r1(h), bg }; const rr = num(ps.borderTopLeftRadius); if (rr) n.r = rr; return n; }
    return null;
  };
  const SPECIAL_LIVE = (el) => el.id === 'bundleGrid' ? 'bundles' : (el.id === 'firstBill' ? 'calc' : null);

  const textual = (el) => {
    // true when every child is text or an unstyled inline element
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) continue;
      if (ch.nodeType !== 1) continue;
      const cs = getComputedStyle(ch);
      if (SKIP_TAG.has(ch.tagName) && ch.tagName !== 'BR') { if (cs.display !== 'none') return false; continue; }
      if (ch.tagName === 'IMG' || ch.tagName === 'svg' || ch.tagName === 'BUTTON') return false;
      if (ch.tagName === 'A' && (ch.className || '').toString().match(/\bbtn\b|\bpair\b|\btag\b/)) return false;
      if (!visible(ch, cs) && !ch.classList.contains('gst-t')) continue;
      if (cs.position === 'absolute' || cs.position === 'fixed') return false;
      if (!/^inline$/.test(cs.display)) { if (cs.display === 'inline-block' || cs.display === 'inline-flex') { if (hex(cs.backgroundColor) || side(cs, 'Top') || side(cs, 'Left')) return false; continue; } return false; }
      if (hex(cs.backgroundColor) || side(cs, 'Top')) return false;
      if (!textual(ch)) return false;
    }
    return true;
  };

  const runsOf = (el, parentStyle, out, base) => {
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) {
        const raw = ch.textContent.replace(/\s+/g, ' ');
        if (!raw.trim() && !raw.includes(' ')) continue;
        const pe = ch.parentElement;
        const st = tstyle(getComputedStyle(pe));
        const run = { x: raw };
        const o = {};
        for (const k of Object.keys(st)) if (JSON.stringify(st[k]) !== JSON.stringify(base[k])) o[k] = st[k];
        if (Object.keys(o).length) run.s = o;
        const a = pe.closest('a[href]');
        if (a && !/^javascript/.test(a.getAttribute('href'))) run.h = a.getAttribute('href');
        if (pe.closest('.gst-t')) run.g = 1;
        out.push(run);
      } else if (ch.nodeType === 1) {
        const cs = getComputedStyle(ch);
        if (ch.tagName === 'BR') { out.push({ x: '\n' }); continue; }
        if (ch.tagName === 'SCRIPT' || ch.tagName === 'STYLE' || ch.tagName === 'svg') continue;
        if (!visible(ch, cs) && !ch.classList.contains('gst-t')) continue;
        runsOf(ch, cs, out, base);
      }
    }
  };
  const mergeRuns = (rs) => {
    const out = [];
    for (const r of rs) {
      const l = out[out.length - 1];
      if (l && JSON.stringify(l.s || null) === JSON.stringify(r.s || null) && l.h === r.h && l.g === r.g) l.x += r.x; else out.push({ ...r });
    }
    if (out.length) { out[0].x = out[0].x.replace(/^\s+/, ''); out[out.length - 1].x = out[out.length - 1].x.replace(/\s+$/, ''); }
    return out.filter((r) => r.x !== '');
  };
  const textNode = (el, cs, parentRect) => {
    const base = tstyle(cs);
    const rs = [];
    runsOf(el, cs, rs, base);
    const runs = mergeRuns(rs);
    if (!runs.length) return null;
    const rc = el.getBoundingClientRect();
    const nl = Math.max(1, Math.round(rc.height / Math.max(1, base.fs * base.lh)));
    return { k: 't', r: runs, s: base, nl };
  };

  let svgCount = 0;
  const svgOf = (el) => {
    const rc = el.getBoundingClientRect();
    if (rc.width < 2 || rc.height < 2) return null;
    const c = el.cloneNode(true);
    const orig = [el, ...el.querySelectorAll('*')];
    const cl = [c, ...c.querySelectorAll('*')];
    orig.forEach((o, i) => {
      const cs = getComputedStyle(o);
      const t = cl[i];
      if (!t.setAttribute) return;
      const set = (a, v) => { if (v && v !== 'none' && v !== 'normal') t.setAttribute(a, v); };
      const fill = cs.fill, stroke = cs.stroke;
      t.setAttribute('fill', fill && fill !== 'none' ? fill : 'none');
      if (stroke && stroke !== 'none') { t.setAttribute('stroke', stroke); set('stroke-width', cs.strokeWidth); set('stroke-linecap', cs.strokeLinecap); set('stroke-linejoin', cs.strokeLinejoin); } else t.setAttribute('stroke', 'none');
      if (cs.opacity !== '1') t.setAttribute('opacity', cs.opacity);
      t.removeAttribute('style'); t.removeAttribute('class'); t.removeAttribute('data-art'); t.removeAttribute('stroke-dashoffset');
      { const da = (cs.strokeDasharray || '').split(/[ ,]+/).map(parseFloat).filter((x) => !isNaN(x)); if (da.length && da.every((x) => x > 0 && x < 30)) t.setAttribute('stroke-dasharray', da.join(' ')); else t.removeAttribute('stroke-dasharray'); }
    });
    c.setAttribute('width', String(Math.round(rc.width)));
    c.setAttribute('height', String(Math.round(rc.height)));
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!c.getAttribute('viewBox')) c.setAttribute('viewBox', `0 0 ${Math.round(rc.width)} ${Math.round(rc.height)}`);
    svgCount++;
    return { k: 'v', svg: c.outerHTML.replace(/\s+/g, ' '), w: r1(rc.width), h: r1(rc.height) };
  };

  const conv = (el, parentRect, parentInner) => {
    if (el.nodeType !== 1) return null;
    const cs = getComputedStyle(el);
    if (SKIP_TAG.has(el.tagName)) return null;
    if (!visible(el, cs)) return null;
    const rect = el.getBoundingClientRect();
    if (el.tagName === 'svg' || el.tagName === 'SVG') return svgOf(el);
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') || '';
      if (!src || rect.width < 2) return null;
      return { k: 'i', src, w: r1(rect.width), h: r1(rect.height), r: num(cs.borderTopLeftRadius) || undefined };
    }
    const live = SPECIAL_LIVE(el);
    if (live) return { k: 'x', live };
    if (el.classList.contains('band') || el.classList.contains('mega-logo') || el.classList.contains('dot-texture') || el.classList.contains('fx-field') || el.classList.contains('hero-art') && false) return null;
    const abs = cs.position === 'absolute' || cs.position === 'fixed';
    const n = { k: 'b', s: {} };
    const s = n.s;
    // accordion item
    if (el.classList.contains('uk-accordion-item')) {
      const head = el.querySelector('.uk-accordion-head');
      const body = el.querySelector('.uk-accordion-body-inner') || el.querySelector('.uk-accordion-body');
      const hn = head ? conv(head, rect, rect.width) : null;
      const bn = body ? conv(body, rect, rect.width) : null;
      const out = { k: 'a', o: el.classList.contains('is-open') ? 1 : 0, hd: hn, bd: bn };
      const m1 = num(cs.marginTop), m2 = num(cs.marginBottom); if (m1) out.mt = r1(m1); if (m2) out.mb = r1(m2);
      const b = side(cs, 'Bottom'); if (b) out.line = b;
      return out;
    }
    if (el.tagName === 'DETAILS') {
      const sm = el.querySelector('summary');
      const kids = [];
      for (const ch of el.childNodes) { if (ch === sm) continue; const k = conv(ch, rect, rect.width); if (k) kids.push(k); }
      return { k: 'a', q: sm ? sm.textContent.trim() : '', o: el.open ? 1 : 0, c: kids };
    }
    const bg = hex(cs.backgroundColor);
    const bd = { t: side(cs, 'Top'), r: side(cs, 'Right'), b: side(cs, 'Bottom'), l: side(cs, 'Left') };
    const rad = [num(cs.borderTopLeftRadius), num(cs.borderTopRightRadius), num(cs.borderBottomRightRadius), num(cs.borderBottomLeftRadius)].map(r1);
    const pad = [num(cs.paddingTop), num(cs.paddingRight), num(cs.paddingBottom), num(cs.paddingLeft)].map(r1);
    if (bg) s.bg = bg;
    if (bd.t || bd.r || bd.b || bd.l) s.bd = bd;
    if (rad.some((x) => x)) s.r = rad.every((x) => x === rad[0]) ? rad[0] : rad;
    if (pad.some((x) => x)) s.p = pad;
    const sh = shadow(cs.boxShadow); if (sh) s.sh = sh;
    const rot = rotOf(cs); if (rot) s.rot = rot;
    if (cs.overflow !== 'visible' && (rad.some((x) => x) || cs.overflowX !== 'visible')) { s.cl = 1; }
    const mt = num(cs.marginTop), mb = num(cs.marginBottom);
    if (num(cs.marginLeft) > 0.5 && !(cs.marginLeft === cs.marginRight)) s.ml = r1(num(cs.marginLeft));
    if (mt) s.mt = r1(mt);
    if (mb) s.mb = r1(mb);
    if (cs.marginLeft === cs.marginRight && rect.width < parentInner * 0.97 && Math.abs(num(cs.marginLeft) - (parentInner - rect.width) / 2) < 2 && num(cs.marginLeft) > 2) s.ac = 1;
    if (rect.width < parentInner * 0.97 && parentInner > 0) s.w = Math.round((rect.width / parentInner) * 1000) / 1000;
    const disp = cs.display;
    if (/inline/.test(disp)) s.fit = 1;
    if (cs.maxWidth !== 'none' && !String(cs.maxWidth).includes('%')) { const mw = num(cs.maxWidth); if (mw && mw < parentInner) s.mw = r1(mw); }
    // layout
    const isFlex = disp === 'flex' || disp === 'inline-flex';
    const isGrid = disp === 'grid' || disp === 'inline-grid';
    if (isFlex) {
      s.d = cs.flexDirection.startsWith('column') ? 'c' : 'r';
      if (cs.flexWrap === 'wrap') s.wr = 1;
      const g = num(cs.columnGap) || num(cs.gap); const rg = num(cs.rowGap);
      if (g) s.g = r1(g); if (rg) s.rg = r1(rg);
      if (cs.justifyContent !== 'normal' && cs.justifyContent !== 'flex-start') s.jc = cs.justifyContent.replace('flex-', '').replace('space-', 's');
      if (cs.alignItems !== 'normal' && cs.alignItems !== 'stretch') s.ai = cs.alignItems.replace('flex-', '');
    } else if (isGrid) {
      const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
      s.d = 'g'; s.cols = cols;
      const g = num(cs.columnGap) || num(cs.gap); const rg = num(cs.rowGap);
      if (g) s.g = r1(g); if (rg) s.rg = r1(rg);
    }
    if (el.parentElement) {
      const pcs = getComputedStyle(el.parentElement);
      if (/flex/.test(pcs.display) && num(cs.flexGrow) > 0) s.fg = 1;
    }
    if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 4) s.sx = 1;
    if (el.tagName === 'LI' && cs.display === 'list-item' && cs.listStyleType !== 'none') {
      const ol = el.parentElement && el.parentElement.tagName === 'OL';
      const idx = [...el.parentElement.children].filter((c) => c.tagName === 'LI').indexOf(el) + 1;
      s.li = ol ? idx + '.' : '•';
      s.lic = hex(cs.color) || '000000';
    }
    actions(el, n);
    const link = el.tagName === 'A' || el.tagName === 'BUTTON';
    if (link && !n.h && !n.a && el.tagName === 'BUTTON') return textual(el) ? null : null;
    // price live markers
    if (el.hasAttribute && el.hasAttribute('data-price-card')) {
      const b = el.querySelector('[data-add-plan]');
      if (b) n.pc = b.getAttribute('data-add-plan');
    }
    if (el.classList.contains('price-card-price')) n.lp = 1;
    if (el.hasAttribute('data-mob-price')) n.lp = 2;
    if (el.classList.contains('price-card-sub') && el.closest('[data-price-card]') && el.closest('[data-price-card]').querySelector('[data-mob-price]')) n.lp = 3;
    if (el.id) n.id = el.id;
    // position
    if (abs && parentRect) { n.abs = [r1(rect.left - parentRect.left), r1(rect.top - parentRect.top)]; }
    // children
    const kids = [];
    const before = pseudo(el, '::before', cs);
    if (before) kids.push(before);
    const innerW = rect.width - pad[1] - pad[3] - ((bd.l && bd.l[0]) || 0) - ((bd.r && bd.r[0]) || 0);
    if (textual(el) && !isFlex && !isGrid) {
      const t = textNode(el, cs, rect);
      if (t) kids.push(t);
    } else {
      let pend = [];
      const flushText = () => {
        if (!pend.length) return;
        const wrap = document.createElement('span');
        const rs = [];
        const base = tstyle(cs);
        for (const p of pend) {
          if (p.nodeType === 3) { const raw = p.textContent.replace(/\s+/g, ' '); if (raw.trim()) rs.push({ x: raw }); }
          else runsOf({ childNodes: [p] }, cs, rs, base);
        }
        const runs = mergeRuns(rs);
        if (runs.length) {
          let top = Infinity, bot = -Infinity;
          for (const q of pend) {
            const rg = document.createRange();
            rg.selectNodeContents(q.nodeType === 1 ? q : q);
            const rr = rg.getBoundingClientRect();
            if (rr.height > 0) { top = Math.min(top, rr.top); bot = Math.max(bot, rr.bottom); }
          }
          const nl = isFinite(top) ? Math.max(1, Math.round((bot - top) / Math.max(1, base.fs * base.lh))) : 1;
          kids.push({ k: 't', r: runs, s: base, nl });
        }
        pend = [];
      };
      for (const ch of el.childNodes) {
        if (ch.nodeType === 3) { if (ch.textContent.trim()) pend.push(ch); continue; }
        if (ch.nodeType !== 1) continue;
        const ccs = getComputedStyle(ch);
        if (!visible(ch, ccs) && !ch.classList.contains('gst-t')) continue;
        const inlineUnstyled = ccs.display === 'inline' && !hex(ccs.backgroundColor) && !SKIP_TAG.has(ch.tagName) && ch.tagName !== 'svg' && ch.tagName !== 'IMG' && ch.tagName !== 'A' || (ch.tagName === 'A' && ccs.display === 'inline' && textual(ch) && !isFlex);
        if (ch.tagName === 'BR') { pend.push(ch); continue; }
        if (inlineUnstyled && !isFlex && !isGrid && textual(ch)) { pend.push(ch); continue; }
        flushText();
        const k = conv(ch, rect, innerW);
        if (k) {
          if (isGrid || (isFlex && cs.flexWrap === 'wrap')) {
            const cr = ch.getBoundingClientRect();
            k.x = r1(cr.left - rect.left - pad[3] - ((bd.l && bd.l[0]) || 0));
            k.y = r1(cr.top - rect.top - pad[0] - ((bd.t && bd.t[0]) || 0));
            k.pw = r1(cr.width);
          }
          kids.push(k);
        }
      }
      flushText();
    }
    const after = pseudo(el, '::after', cs);
    if (after) kids.push(after);
    // a text-only link or button keeps its pill look as a box; empty boxes with no look are dropped
    if (!kids.length && !s.bg && !s.bd && !n.h && !n.a) {
      if (rect.height < 3 || rect.width < 3) return null;
      if (!(rect.height >= 3 && (s.bg || s.bd))) return null;
    }
    if (kids.length === 1 && !s.bg && !s.bd && !s.sh && !s.p && !n.h && !n.a && !n.id && !s.rot && !n.pc && !n.lp && !s.li && !s.abs && !s.cl && !s.sx && kids[0].k !== 'b' && !n.abs) {
      // an unstyled wrapper around one thing: keep margins and width hints on the child
      const c0 = kids[0];
      if (c0.k === 't') { c0.m = [s.mt || 0, s.mb || 0]; if (s.ml) c0.ml = s.ml; if (s.w) c0.w = s.w; if (s.ac) c0.ac = 1; if (s.mw) c0.mw = s.mw; if (cs.textAlign === 'center' && !c0.s.ta) c0.s.ta = 'c'; return c0; }
    }
    n.c = kids;
    return n;
  };

  // ---- sections ----
  const main = document.querySelector('main');
  const secs = [];
  const secOf = (el, extra) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const pad = [num(cs.paddingTop), num(cs.paddingRight), num(cs.paddingBottom), num(cs.paddingLeft)];
    const cl = el.className.toString();
    const tone = /stack-panel-dark|\bdark\b/.test(cl) ? 'dark' : (/\balt\b/.test(cl) ? 'alt' : '');
    // unwrap a single .wrap so the section content is flat
    let host = el;
    const kids = [...el.children].filter((c) => !SKIP_TAG.has(c.tagName) && visible(c, getComputedStyle(c)));
    const node = conv(host, null, rect.width);
    const out = { c: tone, n: node && node.k === 'b' ? node : { k: 'b', s: {}, c: node ? [node] : [] }, h: Math.round(rect.height) };
    if (el.dataset.tab) out.tab = el.dataset.tab;
    if (el.id) out.id = el.id;
    return out;
  };
  const collect = (el) => {
    for (const ch of el.children) {
      if (SKIP_TAG.has(ch.tagName)) continue;
      const cs = getComputedStyle(ch);
      if (!visible(ch, cs)) continue;
      const cl = ch.className.toString();
      if (ch.classList.contains('stack')) { collect(ch); continue; }
      if (ch.tagName === 'SECTION' || /stack-panel/.test(cl)) { secs.push(secOf(ch)); continue; }
      if (ch.tagName === 'HR') { secs.push({ c: '', n: { k: 'b', s: {}, c: [] }, hr: 1, h: 3 }); continue; }
      const only = [...ch.children].filter((c) => !SKIP_TAG.has(c.tagName) || c.tagName === 'HR');
      const plain = !/^rgba?\(0, 0, 0, 0\)$/.test(cs.backgroundColor) === false && !num(cs.borderTopWidth);
      if (/\bwrap\b|\bcontent\b/.test(cl) || (only.length && only.every((c) => c.tagName === 'SECTION' || c.classList.contains('stack') || c.tagName === 'HR' || /wrap/.test(c.className.toString())))) { collect(ch); continue; }
      secs.push(secOf(ch));
    }
  };
  collect(main);
  const t = document.title.replace(/\s*[|—–-]\s*AUZslab.*$/i, '').trim() || name;
  const md = document.querySelector('meta[name=description]');
  const fr = main.firstElementChild ? main.getBoundingClientRect().top + window.scrollY : 0;
  const first = secs.length ? 0 : 0;
  return { title: t, desc: md ? md.content : '', mode: stackMode ? 'stack' : 'flat', secs, svgs: svgCount, top: Math.round(fr) };
}

const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const data = {};
for (const name of PAGES) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const pg = await ctx.newPage();
  await pg.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  pg.on('pageerror', () => {});
  await pg.goto(`http://localhost:8125/${name}.html?intro=0`, { waitUntil: 'load' }).catch(() => {});
  await pg.waitForTimeout(1200);
  await pg.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); } window.scrollTo(0, 0); });
  await pg.waitForTimeout(400);
  const res = await pg.evaluate(inPage, [name, STACK.has(name), PAGE_PRODUCT[name] || '', [...INCLUDED]]).catch((e) => { console.error(name, e.message); return null; });
  if (res) { data[name] = res; console.log(name, res.secs.length, 'sections', JSON.stringify(res).length, 'bytes'); }
  await ctx.close();
}
await b.close();
srv.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
