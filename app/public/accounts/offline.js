/* AUZsLedger offline drafts. Accounting stays server-authoritative: posting, gapless numbers, stock and ledgers all happen on
   the server. What works with no connection is WRITING: open Accounting (it starts from a saved copy of your setup, suppliers,
   customers and products), write a bill, expense, invoice or note, and it is kept on this device. When the connection is back
   it is sent as a DRAFT (acc_save_draft_offline, idempotent) and you check and post it as usual. Nothing is ever posted offline. */
'use strict';
const OFFLINE_TYPES = ['invoice', 'credit_note', 'bill', 'debit_note', 'expense'];
const offlineNow = () => !!(S.offline || navigator.onLine === false);

// ---------- a tiny key-value + queue store (IndexedDB), the same shape the other apps use ----------
let _odb = null;
function offDb() {
  return _odb || (_odb = new Promise((resolve, reject) => {
    const r = indexedDB.open('acc1', 2);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' }); if (!d.objectStoreNames.contains('q')) d.createObjectStore('q', { keyPath: 'op' }); if (!d.objectStoreNames.contains('sq')) d.createObjectStore('sq', { keyPath: 'op' }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  }));
}
const reqP2 = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
async function offSave(k, v) { try { const d = await offDb(); await reqP2(d.transaction('kv', 'readwrite').objectStore('kv').put({ k, v, at: Date.now() })); } catch (e) { /* the cache is a convenience, never a reason to fail */ } }
async function offLoad(k) { try { const d = await offDb(); const r = await reqP2(d.transaction('kv', 'readonly').objectStore('kv').get(k)); return r ? r.v : null; } catch (e) { return null; } }

// what the offline editor needs: the setup (chart of accounts, tax codes, org) plus the people and products to pick from
async function cacheBoot() { await offSave('boot', { ctx: S.ctx, dash: S.dash, user: S.user, email: (S.user && S.user.email) || '', slug: S.dash && S.dash.tenant && S.dash.tenant.slug }); }
async function offBootCache(session) {
  const c = await offLoad('boot'); if (!c || !c.ctx || !c.dash) return null;
  const mail = ((session && session.user && session.user.email) || '').toLowerCase();
  if (mail && c.email && mail !== String(c.email).toLowerCase()) return null;                  // a copy kept for somebody else
  if (window.TENANT_SLUG && c.slug && window.TENANT_SLUG !== c.slug) return null;
  return c;
}

// ---------- the queue ----------
const draftQueue = async () => { try { const d = await offDb(); return (await reqP2(d.transaction('q', 'readonly').objectStore('q').getAll())).sort((a, b) => a.at - b.at); } catch (e) { return []; } };
async function draftPut(row) { const d = await offDb(); await reqP2(d.transaction('q', 'readwrite').objectStore('q').put(row)); }
async function draftDel(op) { const d = await offDb(); await reqP2(d.transaction('q', 'readwrite').objectStore('q').delete(op)); }
const opId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2, 10));
function draftLabel(p) {
  const party = (S.parties || []).find((x) => x.id === p.party_id);
  return { type: DOC_LABEL[p.doc_type] || p.doc_type, party: party ? party.name : (p.party_id ? 'Supplier' : (p.doc_type === 'expense' ? 'Expense' : 'Walk-in')), date: p.doc_date, total: p._total };
}
async function queueDraft(payload, total) {
  if (!OFFLINE_TYPES.includes(payload.doc_type)) throw new Error('This kind of document cannot be saved offline.');
  const p = { ...payload }; delete p.id; delete p.payments; p.post = false; p._total = total;
  const row = { op: opId(), at: Date.now(), payload: p, state: 'waiting', label: draftLabel(p) };
  await draftPut(row); offChanged(); return row;
}
let flushing2 = false;
async function flushDrafts() {
  if (flushing2 || navigator.onLine === false) return { sent: 0, refused: 0 };
  flushing2 = true; let sent = 0, refused = 0;
  try {
    for (const it of await draftQueue()) {
      if (it.state === 'refused') { refused++; continue; }                                    // waits for the person: retry or discard
      try {
        const p = { ...it.payload }; delete p._total; p.op = it.op;
        await api('acc_save_draft_offline', { p });
        await draftDel(it.op); sent++;
      } catch (e) {
        if (!e.status || e.status >= 500 || e.status === 401 || e.status === 408 || e.status === 429) break;       // still offline / server busy / signed out: keep the rest
        it.state = 'refused'; it.error = e.message; await draftPut(it); refused++;            // a real refusal (supplier gone, period locked, no permission): never silently dropped
      }
    }
  } finally { flushing2 = false; }
  if (sent) { toast(sent + ' offline draft' + (sent > 1 ? 's' : '') + ' saved to your books. Open them in Sales or Purchases to check and post.'); bust('products', 'parties'); }
  offChanged(); return { sent, refused };
}
async function retryDraft(op) { const d = await offDb(); const it = await reqP2(d.transaction('q', 'readonly').objectStore('q').get(op)); if (it) { it.state = 'waiting'; delete it.error; await draftPut(it); } return flushDrafts(); }

// ---------- the bar above every page + the "Offline drafts" page ----------
let _offCount = { waiting: 0, refused: 0 };
function offChanged() { window.dispatchEvent(new CustomEvent('acc:drafts')); updateOffBar(); }
async function updateOffBar() {
  const bar = document.getElementById('offbar'); if (!bar) return;
  const q = (await draftQueue()).concat(window.sqItems ? sqItems() : []); _offCount = { waiting: q.filter((x) => x.state !== 'refused').length, refused: q.filter((x) => x.state === 'refused').length };
  const off = offlineNow(); let text = '', act = null;
  if (S.offline && !off) { text = 'You are back online. Reload to use everything again.'; act = { label: 'Reload', run: () => location.reload() }; }
  else if (off) { text = (window.AUZ_SCAN ? 'You are offline. Keep scanning and selling: everything is saved on this phone and sent to your books when you are back online.' : 'You are offline. You can still write bills, expenses and invoices: they are kept on this device and sent as drafts when you are back online.') + (_offCount.waiting ? ' Waiting: ' + _offCount.waiting + '.' : ''); act = window.AUZ_SCAN ? null : { label: 'Offline drafts', run: () => go('offline') }; }
  else if (_offCount.refused) { text = _offCount.refused + ' offline draft' + (_offCount.refused > 1 ? 's were' : ' was') + ' refused by the books. Open Offline drafts to see why.'; act = { label: 'Open', run: () => go('offline') }; }
  else if (_offCount.waiting) { text = _offCount.waiting + ' offline draft' + (_offCount.waiting > 1 ? 's' : '') + ' waiting to be sent.'; act = { label: 'Send now', run: () => Promise.all([flushDrafts(), window.sqFlush ? sqFlush() : null]) }; }
  bar.hidden = !text; clear(bar);
  if (text) bar.append(icon(off ? 'alert' : 'info', 18), h('span', { class: 'grow' }, text), act ? h('button', { class: 'btn sm', type: 'button', onclick: act.run }, act.label) : null);
}
window.addEventListener('online', () => { if (window.sqFlush) sqFlush(); flushDrafts().then(() => { updateOffBar(); if (S.offline && route && route.id === 'offline') location.reload(); }); });
window.addEventListener('offline', updateOffBar);
setInterval(() => { if (navigator.onLine !== false && !S.offline) { flushDrafts(); if (window.sqFlush) sqFlush(); } }, 60000);

page('offline', {
  title: 'Offline drafts', icon: 'upload', nav: false,
  async render(v) {
    v.header({ title: 'Offline drafts' });
    const q = await draftQueue(), off = offlineNow();
    const kinds = [['bill', 'purchase', 'New bill', 'receipt'], ['expense', 'purchase', 'New expense', 'cash'], ['invoice', 'sales', 'New invoice', 'doc']].filter(([t, perm]) => can(perm === 'sales' ? 'acc_sales' : 'acc_purchase'));
    v.root.append(
      h('div', { class: 'card' }, h('p', null, off ? 'You are offline. Write a bill, expense or invoice below: it is kept on this device and sent to your books as a draft when you are back online. Posting needs a connection.' : 'You are online. Drafts written while offline are sent automatically. You can also write one here any time.'),
        h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '8px' } }, kinds.map(([t, , label, ic]) => h('button', { class: 'btn fill', type: 'button', onclick: () => go('new/' + t) }, icon('plus', 18), label)), q.some((x) => x.state !== 'refused') && !off ? h('button', { class: 'btn', type: 'button', onclick: async () => { await flushDrafts(); v.refresh(); } }, 'Send now') : null)),
      h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Waiting to send (' + q.length + ')')),
        q.length ? h('div', { class: 'list' }, q.map((it) => liRow({ icon: it.state === 'refused' ? 'alert' : 'doc', tone: it.state === 'refused' ? 'red' : '', title: it.label.type + ' · ' + it.label.party, sub: (it.label.date ? fmtD(it.label.date) + ' · ' : '') + (it.state === 'refused' ? 'Refused: ' + it.error : 'Saved ' + fmtDT(it.at) + ', waiting'), value: it.label.total != null ? inr(it.label.total) : null,
          badge: h('span', { class: 'row', style: { gap: '6px' } }, it.state === 'refused' ? h('button', { class: 'btn sm', type: 'button', onclick: async (e) => { e.stopPropagation(); await retryDraft(it.op); v.refresh(); } }, 'Retry') : null,
            h('button', { class: 'btn sm danger', type: 'button', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('Discard this draft?', 'It has not reached your books and cannot be brought back.', 'Discard', true)) { await draftDel(it.op); offChanged(); v.refresh(); } } }, 'Discard')) })))
          : empty('upload', 'Nothing waiting', 'Drafts written offline appear here until they are sent.')));
  },
});

// ---------- starting up with no connection ----------
function applyCtx(c) { S.ctx = c; S.org = c.org; S.perms = c.perms; S.accounts = c.accounts; S.taxcodes = c.taxcodes; S.branches = c.branches; S.warehouses = c.warehouses; S.masters = c.masters; S.fys = c.fys; }
