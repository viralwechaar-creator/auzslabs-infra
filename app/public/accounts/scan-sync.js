/* AUZsScan offline-first queue. Scanning, selling, adding a new product and receiving stock all work with NO connection:
   each action is written to this phone first (IndexedDB, store 'sq') and sent to the books later through acc_offline_apply, which is
   idempotent on the operation id, so a lost reply or a retry never makes a second bill. Until a sale is sent it carries a
   PROVISIONAL number (OFF-xxx-n); the real, gapless tax-invoice number is given by the books when it syncs.
   The queue is also the source of truth for the stock shown while offline: sqOverlay() applies the waiting sales, stock receipts and
   new products on top of the last list received from the server, so a refresh never forgets them.
   Loaded after offline.js and before p-scan.js. */
'use strict';
const SQ = { items: [], loaded: false, base: null, busy: false };
function sqItems() { return SQ.items; }
const sqTransient = (e) => !e.status || e.status >= 500 || e.status === 401 || e.status === 408 || e.status === 429;

async function sqLoad() {
  try { const d = await offDb(); SQ.items = (await reqP2(d.transaction('sq', 'readonly').objectStore('sq').getAll())).sort((a, b) => a.at - b.at); } catch (e) { SQ.items = SQ.items || []; }
  SQ.loaded = true; return SQ.items;
}
async function sqPut(row) {
  const d = await offDb(); await reqP2(d.transaction('sq', 'readwrite').objectStore('sq').put(row));
  const i = SQ.items.findIndex((x) => x.op === row.op); if (i >= 0) SQ.items[i] = row; else SQ.items.push(row);
}
async function sqDel(op) {
  const d = await offDb(); await reqP2(d.transaction('sq', 'readwrite').objectStore('sq').delete(op));
  SQ.items = SQ.items.filter((x) => x.op !== op);
}
function sqChanged() { window.dispatchEvent(new CustomEvent('scan:queue')); if (window.updateOffBar) updateOffBar(); }

// ---------- provisional bill numbers (OFF-<phone code>-<n>) ----------
function sqNextRef() {
  let dev = '', n = 0;
  try { dev = localStorage['scan.dev'] || (localStorage['scan.dev'] = Math.random().toString(36).slice(2, 5).toUpperCase()); n = (Number(localStorage['scan.seq']) || 0) + 1; localStorage['scan.seq'] = String(n); }
  catch (e) { dev = 'X'; n = Date.now() % 100000; }
  return 'OFF-' + dev + '-' + String(n).padStart(3, '0');
}
const sqNewOp = () => (typeof opId === 'function' ? opId() : String(Date.now()) + Math.random().toString(36).slice(2, 10));
const sqTempId = () => 'local:' + sqNewOp();
const sqIsTemp = (id) => typeof id === 'string' && id.startsWith('local:');

async function sqEnqueue(kind, payload, meta, op) {
  const row = { op: op || sqNewOp(), at: Date.now(), kind, payload, state: 'waiting', meta: meta || {} };
  await sqPut(row); sqChanged(); return row;
}

// ---------- what the local lists look like with the waiting entries applied ----------
function sqOverlay(list) {
  const rows = (list || []).map((p) => ({ ...p }));
  const by = new Map(rows.map((p) => [p.id, p]));
  for (const it of SQ.items) {
    if (it.state === 'refused') continue;
    if (it.kind === 'product' && it.meta && it.meta.temp && !by.has(it.meta.temp.id)) { const t = { ...it.meta.temp, stock: 0 }; rows.push(t); by.set(t.id, t); }
    else if (it.kind === 'sale') (it.payload.lines || []).forEach((l) => { const p = by.get(l.product_id); if (p && p.track_stock && !p.is_service) p.stock = Number(p.stock || 0) - Number(l.qty); });
    else if (it.kind === 'stock') (it.payload.lines || []).forEach((l) => { const p = by.get(l.product_id); if (p) p.stock = Number(p.stock || 0) + Number(l.qty); });
  }
  return rows;
}
function sqSetBase(list) { SQ.base = list; return SQ.items.some((x) => x.state !== 'refused') ? sqOverlay(list) : list; }
function sqRefreshLocal() { if (SQ.base) S.products = sqOverlay(SQ.base); }

// ---------- sending ----------
const sqSubst = (payload, map) => JSON.parse(JSON.stringify(payload), (k, v) => (typeof v === 'string' && map[v] ? map[v] : v));
async function sqMap() { return (await offLoad('scan.map')) || {}; }
async function sqRemember(done) {
  const l = (await offLoad('scan.done')) || []; l.unshift(done); await offSave('scan.done', l.slice(0, 40));
}
async function sqRecent() { return (await offLoad('scan.done')) || []; }

async function sqFlush() {
  if (SQ.busy || navigator.onLine === false) return { sent: 0, refused: 0 };
  if (!SQ.loaded) await sqLoad();
  SQ.busy = true; let sent = 0, refused = 0, sales = 0;
  try {
    const map = await sqMap();
    for (const it of SQ.items.slice()) {
      if (it.state === 'refused') { refused++; continue; }
      try {
        const payload = sqSubst(it.payload, map);
        const r = await api('acc_offline_apply', { p: { op: it.op, kind: it.kind, payload } });
        if (it.kind === 'product' && it.meta && it.meta.temp && r && r.id) { map[it.meta.temp.id] = r.id; await offSave('scan.map', map); }
        if (it.kind === 'sale') { sales++; await sqRemember({ ref: it.meta && it.meta.ref, number: r.number, total: r.total, at: it.at, name: it.meta && it.meta.name }); }
        await sqDel(it.op); sent++;
      } catch (e) {
        if (sqTransient(e)) break;                                         // still offline / server busy / signed out: keep everything, try again later
        it.state = 'refused'; it.error = e.message; await sqPut(it); refused++;     // a real refusal is shown to the person, never dropped
      }
    }
  } finally { SQ.busy = false; }
  if (sent) {
    bust('products', 'parties'); try { await products(true); } catch (e) { /* offline again */ }
    toast(sales ? sales + (sales === 1 ? ' sale' : ' sales') + ' sent to your books with final invoice numbers.' : sent + ' saved entr' + (sent === 1 ? 'y' : 'ies') + ' sent to your books.');
  }
  sqChanged(); return { sent, refused };
}
async function sqRetry(op) { const it = SQ.items.find((x) => x.op === op); if (it) { it.state = 'waiting'; delete it.error; await sqPut(it); } return sqFlush(); }
async function sqDiscard(op) { await sqDel(op); sqRefreshLocal(); sqChanged(); }

// Race a request against a clock: a weak signal can hang for a minute. The operation id makes a late answer harmless.
const sqWithin = (promise, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(Object.assign(new Error('The connection is too slow'), { timeout: true })), ms); promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });

sqLoad().then(sqChanged);
window.addEventListener('scan:queue', () => { /* pages listen to this to refresh their pending card */ });
