/* AUZsStyle: small helpers and the catalogue. The offline engine (api(), the change queue, saved answers, tag codes) is in
   offline.js, which loads right after this file. Every read is saved on the device and every change waits in one queue
   when the shop has no connection (see offline.js). */
'use strict';
const LS = {
  get(k, d) { try { const v = localStorage.getItem('sty.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sty.' + k, JSON.stringify(v)); } catch { /* private mode / full */ } },
};
const slugKey = () => (S.dash && S.dash.tenant ? S.dash.tenant.slug : 'x');

// ---------- catalogue ----------
// S.cat = styles with their variants and stock for the current branch (S.branch). Loaded on demand, cached for offline.
async function loadCatalog(force) {
  if (!force && S.cat.length && Date.now() - S.catAt < 20000) return S.cat;
  S.cat = await api('sty_catalog', { p_branch: S.branch || null });
  S.catAt = Date.now();
  return S.cat;
}
const allVariants = () => S.cat.flatMap((s) => s.variants.map((v) => ({ ...v, style: s })));
function findStyleCode(code) { code = String(code).trim().toLowerCase(); return code ? S.cat.find((s) => s.code && s.code.toLowerCase() === code) || null : null; }
function findBarcode(code) {
  code = String(code).trim(); if (!code) return null;
  const lc = code.toLowerCase();
  for (const style of S.cat) for (const variant of style.variants) {
    if (String(variant.barcode || '').toLowerCase() === lc || (variant.sku && variant.sku.toLowerCase() === lc)) return { style, variant };
  }

  // Some scanners drop the leading zero when reading a UPC-A encoded as EAN-13.
  // Exact style codes still take precedence over the alternate barcode spelling.
  const alternate = window.auzScanner?.variants(code)[1];
  if (!alternate || findStyleCode(code)) return null;
  let match = null;
  for (const style of S.cat) for (const variant of style.variants) {
    if (style.active === false || variant.active === false || String(variant.barcode || '').trim() !== alternate) continue;
    if (match) return null;
    match = { style, variant };
  }
  return match;
}
const styleStock = (s) => s.variants.reduce((a, v) => a + (v.active === false ? 0 : v.stock), 0);

