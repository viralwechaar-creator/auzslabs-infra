/* AUZsStyle: API access, the catalogue cache and the unsent-sales queue. A sale carries a phone-made id, so sending it
   again is always safe. Selling works with no connection: the sale waits in `sty.q`, stock in the cached catalogue goes
   down at once, and everything is sent as soon as the shop is back online. A refusal (4xx) is shown and dropped; a
   dead connection or a 5xx keeps the sale waiting. */
'use strict';
async function api(fn, args) {
  let r;
  try { r = await sb.rpc(fn, args || {}); } catch (e) { const er = new Error(navigator.onLine === false ? t('You are offline') : t('Could not reach the server')); er.net = true; throw er; }
  const { data, error } = r;
  if (error) { const e = new Error(error.message || t('Something went wrong')); e.code = error.code; e.status = error.status; e.net = !error.status || error.status >= 500 || error.status === 408 || error.status === 429; throw e; }
  return data;
}
const LS = {
  get(k, d) { try { const v = localStorage.getItem('sty.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sty.' + k, JSON.stringify(v)); } catch { /* private mode / full */ } },
};
const slugKey = () => (S.dash && S.dash.tenant ? S.dash.tenant.slug : 'x');

// ---------- catalogue ----------
// S.cat = styles with their variants and stock for the current branch (S.branch). Loaded on demand, cached for offline.
async function loadCatalog(force) {
  const key = 'cat.' + slugKey() + '.' + (S.branch || 'all');
  if (!force && S.cat.length && Date.now() - S.catAt < 20000) return S.cat;
  try {
    S.cat = await api('sty_catalog', { p_branch: S.branch || null });
    S.catAt = Date.now(); LS.set(key, S.cat);
  } catch (e) {
    if (!e.net) throw e;
    const c = LS.get(key, null); if (c) S.cat = c; else throw e;
  }
  applyQueueToCatalog();
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

// ---------- unsent sales ----------
const getQ = () => LS.get('q.' + slugKey(), []);
const setQ = (q) => { LS.set('q.' + slugKey(), q); window.dispatchEvent(new Event('sty:q')); };
function applyQueueToCatalog() {
  const q = getQ(); if (!q.length) return;
  const idx = {}; for (const s of S.cat) for (const v of s.variants) idx[v.id] = v;
  for (const e of q) if (e.fn === 'sty_sell') for (const l of e.args.p.lines) if (idx[l.variantId]) idx[l.variantId].stock -= l.qty;
}
let flushing = false;
async function flushQueue() {
  if (flushing || !navigator.onLine) return; flushing = true;
  try {
    let q = getQ(), changed = false;
    while (q.length) {
      const e = q[0];
      try { await api(e.fn, e.args); q.shift(); changed = true; setQ(q); }
      catch (er) {
        if (er.net) break;
        q.shift(); setQ(q); changed = true; toast(t('Not saved') + ': ' + er.message, { err: true });
      }
    }
    if (changed) { S.catAt = 0; window.dispatchEvent(new Event('sty:synced')); }
  } finally { flushing = false; }
}
// Sends one write now; if the shop is offline, keeps it and tells the caller it is queued.
async function sendOrQueue(fn, args) {
  try { return { done: true, data: await api(fn, args) }; }
  catch (e) {
    if (!e.net) throw e;
    const q = getQ(); q.push({ fn, args, at: Date.now() }); setQ(q);
    return { done: false, queued: true };
  }
}
window.addEventListener('online', flushQueue);
setInterval(flushQueue, 45000);
