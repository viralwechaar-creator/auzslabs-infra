/* AUZsMob: offline-first sync engine. Every phone keeps its own copy in IndexedDB (database `mob1`) with
   an outbox; when the internet is back, queued writes replay through the real mob_* RPCs (which are
   idempotent on the client-generated id, so a retried push is always safe), then a fresh mob_sync_pull
   folds in everything that changed -- including other staff's shared catalog updates, and (for an
   owner/manager) the rest of the shop's activity.

   This never claims "saved to server" before it is: a local write is "Saved on phone" the instant it's in
   IndexedDB; it only becomes "Synced" after the matching outbox entry's RPC call actually succeeds (the
   same lesson CLAUDE.md records from the old POS sync bug). */
'use strict';
const DB_NAME = 'mob1', DB_VERSION = 1;
const STORES = ['items', 'units', 'vendors', 'customers', 'purchases', 'sales', 'repairs', 'repairEvents', 'payments', 'stockMovements'];
let dbp;
function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'oid', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
// Empties this phone's offline copy (every store, the unsent outbox and the sync cursor). Used after the owner clears all
// data; a transaction rather than deleteDatabase, which can be blocked by a still-open connection.
async function wipeLocal() {
  const db = await openDb(), names = [...STORES, 'outbox', 'meta'];
  await new Promise((resolve, reject) => { const t = db.transaction(names, 'readwrite'); names.forEach((n) => t.objectStore(n).clear()); t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}
function tx(db, stores, mode) { return db.transaction(stores, mode); }
function reqP(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }

async function idbGetAll(store) { const db = await openDb(); return reqP(tx(db, [store], 'readonly').objectStore(store).getAll()); }
async function idbPut(store, row) { const db = await openDb(); return reqP(tx(db, [store], 'readwrite').objectStore(store).put(row)); }
async function idbPutMany(store, rows) { if (!rows.length) return; const db = await openDb(); const os = tx(db, [store], 'readwrite').objectStore(store); for (const r of rows) os.put(r); }
async function idbDelete(store, key) { const db = await openDb(); return reqP(tx(db, [store], 'readwrite').objectStore(store).delete(key)); }
async function metaGet(k) { const db = await openDb(); const r = await reqP(tx(db, ['meta'], 'readonly').objectStore('meta').get(k)); return r ? r.v : null; }
async function metaSet(k, v) { const db = await openDb(); return reqP(tx(db, ['meta'], 'readwrite').objectStore('meta').put({ k, v })); }

async function api(fn, args) {
  let r;
  try { r = await sb.rpc(fn, args || {}); } catch (e) { throw new Error(navigator.onLine === false ? t('errOffline') : t('errGeneric')); }
  const { data, error } = r;
  if (error) { const e = new Error(error.message || t('errGeneric')); e.code = error.code; e.status = error.status; throw e; }
  return data;
}

// ---------- outbox ----------
async function outboxAdd(fn, args) {
  const db = await openDb();
  await reqP(tx(db, ['outbox'], 'readwrite').objectStore('outbox').add({ fn, args, createdAt: Date.now() }));
  updateOutboxCount();
  trySync();
}
async function outboxAll() { const db = await openDb(); return reqP(tx(db, ['outbox'], 'readonly').objectStore('outbox').getAll()); }
async function updateOutboxCount() { S.outboxCount = (await outboxAll()).length; window.dispatchEvent(new CustomEvent('mob:sync')); }

// Undoes the optimistic local write a rejected outbox item made, so a refused sale or purchase doesn't
// keep sitting in IndexedDB looking saved. Only the two money-moving writes need this (everything else
// localPush writes -- items/vendors/customers -- uses the platform's p_base optimistic-concurrency
// contract, which returns {ok:false,conflict:true} as a normal success response, never reaches this path).
async function rejectLocal(fn, args) {
  const p = args && args.p;
  if (fn === 'mob_push_sale') {
    await idbDelete('sales', args.p_id);
    if (p && Array.isArray(p.items)) {
      const units = await idbGetAll('units');
      for (const it of p.items) {
        if (!it.unitId) continue;
        const u = units.find((x) => x.id === it.unitId);
        if (u && u.status === 'sold') { u.status = 'in_stock'; u.updated_at = new Date().toISOString(); await idbPut('units', u); }
      }
    }
  } else if (fn === 'mob_push_purchase') {
    await idbDelete('purchases', args.p_id);
    if (p && p.unitId) await idbDelete('units', p.unitId);
    const movements = await idbGetAll('stockMovements');
    for (const m of movements) if (m.ref_id === args.p_id) await idbDelete('stockMovements', m.id);
  } else if (fn === 'mob_push_repair_event') {
    // a status/part/payment/note tap that the server refused (e.g. not the job's staffer) would otherwise
    // keep showing locally forever -- the job looking updated on this phone while the server never recorded it
    await idbDelete('repairEvents', args.p_id);
  }
  window.dispatchEvent(new CustomEvent('mob:pulled'));
}

let syncing = false, retryDelay = 5000, retryTimer = null;
// A failure that says nothing about the data itself: no answer at all (server down, bad wifi, a lost reply),
// a gateway/server error (the API restarting during a deploy answers 502/503), a timeout or "slow down".
// These must NEVER drop a queued write: it stays in the outbox and is retried with a growing delay.
const isTransient = (e) => !e.status || e.status >= 500 || e.status === 408 || e.status === 429;
function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (navigator.onLine) trySync(); }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 300000);
}
// manual "tap to retry" (and the browser's online event): forget the back-off and try right now
function retrySyncNow() { retryDelay = 5000; return trySync(); }
// Send the front of the queue in ONE request (POST /sync) instead of one request per write: after a long time offline
// a phone can hold dozens of sales. Returns Map(oid -> result) or null when batching is not possible (older server,
// one item, no answer, signed out): the loop below then sends item by item exactly as before.
async function tryBatch(items) {
  if (items.length < 2 || !sb.sync) return null;
  try {
    const chunk = items.slice(0, 50);
    const r = await sb.sync(chunk.map((it) => ({ id: String(it.oid), fn: it.fn, args: it.args })));
    if (r.error || !r.data || !Array.isArray(r.data.results)) return null;
    const m = new Map();
    for (const x of r.data.results) m.set(Number(x.id), x);
    return m;
  } catch (e) { return null; }
}
async function trySync() {
  if (syncing) return;
  if (!navigator.onLine) { await updateOutboxCount(); return; }
  syncing = true;
  try {
    const db = await openDb();
    // Keeps draining the outbox, not just one snapshot of it: outboxAdd() fires trySync() itself but
    // never awaits it, so a save that queues several outbox entries back to back (a purchase bill with
    // several items, each its own mob_save_item + mob_push_purchase entry) can add later entries AFTER
    // this run already took its items = await outboxAll() snapshot -- and since the `syncing` guard above
    // drops every one of those later, concurrent trySync() calls as a no-op, those entries would otherwise
    // sit queued until something else happened to call trySync() again (a reload, the online event...),
    // which may be never. Looping until the outbox is actually empty (or a stop condition hits) closes
    // that gap, instead of only ever sending whatever was queued at the exact moment this run started.
    let stop = false;
    for (;;) {
      let items = await outboxAll();
      if (!items.length) break;
      const batch = await tryBatch(items);
      for (const it of items) {
        try {
          const br = batch && batch.get(Number(it.oid));
          if (br && br.ok) { /* sent in the batch */ }
          else if (br && br.skipped) { S.syncFailing = true; scheduleRetry(); stop = true; break; }   // an earlier write hit a temporary failure
          else if (br) { const be = new Error(br.error || t('errGeneric')); be.status = br.status; throw be; }
          else await api(it.fn, it.args);
        } catch (e) {
          if (e.status === 401) { S.syncFailing = false; stop = true; break; } // session dead: leave the rest queued until the next sign-in
          if (e.message === t('errOffline')) { stop = true; break; }          // truly offline: leave the rest queued
          if (isTransient(e)) {
            // server unreachable / 5xx / timeout: keep this write AND everything behind it, tell the user, retry later.
            // Before this, only a dead session or navigator.onLine === false kept the queue; a 503 (the API restarting
            // during a deploy) or a phone that "has wifi" but no route to the server fell through to the branch below
            // and the sale was rolled back off the phone as if the server had refused it.
            S.syncFailing = true; S.lastSyncError = e.message; scheduleRetry();
            stop = true; break;
          }
          // a real business-rule refusal (bad data, entitlement off, day closed, not enough stock): it will
          // never succeed by itself retrying, so it's dropped -- but unlike before, the optimistic local
          // write localPush already made (the "Saved on phone" row, and for a sale, the unit it flipped to
          // 'sold') is rolled back here too, and the staffer is told. Previously this just logged a console
          // warning and moved on: a sale that the server correctly refused (e.g. selling more of a loose-stock
          // item than the shop actually has) still sat in the local sales list looking saved, with no sign it
          // never reached the server -- the exact silent-failure shape "no restriction on selling what isn't
          // in stock" was reported as.
          console.warn('outbox item refused, dropping:', it.fn, e.message);
          await rejectLocal(it.fn, it.args);
          toast(t('notSaved') + ': ' + e.message, { err: true });
        }
        S.syncFailing = false; retryDelay = 5000;
        await reqP(tx(db, ['outbox'], 'readwrite').objectStore('outbox').delete(it.oid));
      }
      await updateOutboxCount();
      if (stop) break;
    }
    if (!S.syncFailing) await pull();
  } finally { syncing = false; window.dispatchEvent(new CustomEvent('mob:sync')); }
}

async function pull() {
  const since = await metaGet('cursor');
  let r;
  try { r = await api('mob_sync_pull', { p_since: since }); } catch { return; }
  if (r.full) {
    // A first sync (new phone, cleared data, or away over 90 days) is a window: the last 90 days, everything still
    // open, and ONE opening stock row per item for older history. Drop the stock rows this phone already held, or
    // they would be counted twice on top of the opening row. Rows for entries still waiting in the outbox stay.
    const waiting = new Set((await outboxAll()).map((o) => o.args && o.args.p_id).filter(Boolean));
    for (const m of await idbGetAll('stockMovements')) if (!waiting.has(m.ref_id)) await idbDelete('stockMovements', m.id);
  }
  for (const [store, key] of [['items', 'items'], ['units', 'units'], ['vendors', 'vendors'], ['customers', 'customers'],
    ['purchases', 'purchases'], ['sales', 'sales'], ['repairs', 'repairs'], ['repairEvents', 'repair_events'],
    ['payments', 'payments'], ['stockMovements', 'stock_movements']]) {
    await idbPutMany(store, r[key] || []);
  }
  await metaSet('cursor', r.server_time);
  // pick up owner changes to the feature switches / rates (at most every 5 minutes) so other phones follow
  if (S.ctx && Date.now() - (S._ctxAt || 0) > 300000) {
    S._ctxAt = Date.now();
    try {
      const c = await api('mob_context');
      const changed = JSON.stringify(c.settings && c.settings.features) !== JSON.stringify(S.ctx.settings && S.ctx.settings.features);
      S.ctx = c;
      if (changed && typeof buildShell === 'function') buildShell();
    } catch { /* offline: keep the last known switches */ }
  }
  window.dispatchEvent(new CustomEvent('mob:pulled'));
}

// local-first write: show it immediately, queue it, and let trySync() take it from there
async function localPush(store, row, fn, args) {
  await idbPut(store, { ...row, _pending: true });
  await outboxAdd(fn, args);
  window.dispatchEvent(new CustomEvent('mob:pulled'));
}

window.addEventListener('online', () => { S.online = true; window.dispatchEvent(new CustomEvent('mob:sync')); retrySyncNow(); });
window.addEventListener('offline', () => { S.online = false; window.dispatchEvent(new CustomEvent('mob:sync')); });
setInterval(() => { if (navigator.onLine) trySync(); }, 60_000);

function syncStatusNode() {
  const n = S.outboxCount;
  if (!S.online) return h('span', { class: 'sync-pill off' }, icon('cloudOff', 15), t('offline'));
  if (S.syncFailing && n > 0) return h('span', { class: 'sync-pill off', role: 'button', tabindex: 0, style: 'cursor:pointer', title: S.lastSyncError || '', onclick: retrySyncNow }, icon('refresh', 15), t('syncProblemRetry', { n }));
  if (n > 0) return h('span', { class: 'sync-pill wait', role: 'button', tabindex: 0, style: 'cursor:pointer', onclick: retrySyncNow }, icon('refresh', 15), t('waitingForInternet', { n }));
  return h('span', { class: 'sync-pill ok' }, icon('cloudCheck', 15), t('synced'));
}
