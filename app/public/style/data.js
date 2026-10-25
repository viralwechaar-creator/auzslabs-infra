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
  for (const s of S.cat) for (const v of s.variants) if (v.barcode === code || (v.sku && v.sku.toLowerCase() === lc) || v.barcode.toLowerCase() === lc) return { style: s, variant: v };
  return null;
}
const styleStock = (s) => s.variants.reduce((a, v) => a + (v.active === false ? 0 : v.stock), 0);

