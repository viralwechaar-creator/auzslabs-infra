/* AUZslab Accounting: core. DOM helper, formatting, API, state, and the Apple-HIG UI kit (sheets, alerts, menus,
   segmented controls, lists, tables, charts). Plain script, no build step: every page file below uses these globals.
   h() only ever sets textContent / attributes, never innerHTML, which is the XSS defence (icons are static strings). */
'use strict';
const CFG = window.CFG || {};
const sb = window.supabase.createClient(CFG.url, CFG.key);

// ---------- DOM ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'multiple') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  add(e, kids);
  return e;
}
function add(e, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
const clear = (e) => { while (e.firstChild) e.removeChild(e.firstChild); return e; };

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h4.5v-5.5h4v5.5h4.5V10"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.4-3.2 2.8-5 6-5s5.6 1.8 6 5"/><path d="M16 5a3 3 0 0 1 0 6M18 15c1.8.6 3 2 3.2 5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.5-3.6 3.2-5.5 7-5.5s6.5 1.9 7 5.5"/>',
  box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  bank: '<path d="M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18"/>',
  book: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h12M9 8h6"/>',
  percent: '<path d="M18 6 6 18"/><circle cx="8" cy="8" r="2.4"/><circle cx="16" cy="16" r="2.4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>', chevL: '<path d="M15 5l-7 7 7 7"/>', chevD: '<path d="M5 9l7 7 7-7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4M5 12v8h14v-8"/>',
  download: '<path d="M12 3v12M8 11l4 4 4-4M5 20h14"/>', upload: '<path d="M12 16V4M8 8l4-4 4 4M5 20h14"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>', edit: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.3v.2"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>', wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="4" y="7" width="16" height="12" rx="2.5"/><path d="M16 13h2"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  building: '<path d="M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3"/>', repeat: '<path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="9" r="1.2"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5 12 22l9-4.5"/>', file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>', chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  scale: '<path d="M12 3v18M5 21h14M4 8h16M7 8l-3 7a3.5 3.5 0 0 0 6 0zM17 8l-3 7a3.5 3.5 0 0 0 6 0z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>', cash: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>', star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>', refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>', undo: '<path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12"/>',
};
function icon(name, size = 22) {
  const s = document.createElement('span');
  s.className = 'ic'; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${ICONS[name] || ICONS.doc}</svg>`;
  return s;
}

// ---------- formatting ----------
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf3 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const N = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const inr = (n, dp) => { n = Number(n) || 0; if (dp === undefined) dp = (Number.isInteger(n) && window.matchMedia && !matchMedia('(min-width:900px)').matches) ? 0 : 2; const s = (dp === 0 ? nf0 : nf2).format(Math.abs(n)); return (n < 0 ? '-₹' : '₹') + s; };
const qty = (n) => nf3.format(Number(n) || 0);
const compact = (n) => { n = Number(n) || 0; const a = Math.abs(n), s = n < 0 ? '-' : ''; if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr'; if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L'; if (a >= 1e3) return s + '₹' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + ' K'; return s + '₹' + Math.round(a); };
function money(n, opts = {}) {
  const v = Number(n) || 0;
  return h('span', { class: 'money num' + (opts.signed && v < 0 ? ' neg' : '') + (opts.cls ? ' ' + opts.cls : '') }, opts.compact ? compact(v) : inr(v, opts.dp));
}
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseD = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return isoDate(d); };
const monthStart = (s = today()) => s.slice(0, 8) + '01';
const monthEnd = (s = today()) => { const d = parseD(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return isoDate(d); };
const fmtD = (s) => s ? parseD(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtDT = (s) => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const cap1 = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = (a) => [...new Set(a)];
const debounce = (f, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const DOC_LABEL = { invoice: 'Invoice', credit_note: 'Credit note', bill: 'Bill', debit_note: 'Debit note', expense: 'Expense', quotation: 'Quotation', sales_order: 'Sales order', delivery_challan: 'Delivery challan', purchase_request: 'Purchase request', purchase_order: 'Purchase order', goods_receipt: 'Goods receipt' };
const STATES = { '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other territory' };
const stateName = (c) => c ? (c + ' - ' + (STATES[c] || c)) : '';

// ---------- API ----------
let busy = 0;
async function api(fn, args) {
  busy++; document.documentElement.setAttribute('aria-busy', 'true');
  try {
    let r;
    try { r = await sb.rpc(fn, args || {}); } catch (e) { throw new Error(navigator.onLine === false ? 'You are offline. Accounting needs a connection to save and post.' : 'Could not reach the server. Check your connection and try again.'); }
    const { data, error } = r;
    if (error) { const e = new Error(error.message || 'Something went wrong'); e.status = error.status; throw e; }
    return data;
  } finally { if (--busy === 0) document.documentElement.removeAttribute('aria-busy'); }
}
async function token() { const { data: { session } } = await sb.auth.getSession(); return session && session.access_token; }
async function apiFile(path, opts = {}) {
  const t = await token();
  const res = await fetch(CFG.url.replace(/\/$/, '') + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch { /* keep */ } throw new Error(m); }
  return res;
}

// ---------- state ----------
const S = { ctx: null, org: null, perms: {}, accounts: [], taxcodes: [], branches: [], warehouses: [], masters: [], fys: [], products: null, parties: null, user: null };
const can = (k) => !!S.perms[k];
const acctBy = (k) => S.accounts.find((a) => a.system_key === k);
const acctName = (id) => (S.accounts.find((a) => a.id === id) || {}).name || '';
const payAccounts = () => S.accounts.filter((a) => (a.is_bank || a.is_cash) && a.active);
const taxRates = () => uniq([0, ...S.taxcodes.filter((t) => t.active && t.kind === 'taxable').map((t) => Number(t.rate))]).sort((a, b) => a - b);
const master = (k) => S.masters.filter((m) => m.kind === k && m.active).map((m) => m.name);
async function loadCtx() {
  const c = await api('acc_bootstrap');
  S.ctx = c; S.org = c.org; S.perms = c.perms; S.accounts = c.accounts; S.taxcodes = c.taxcodes; S.branches = c.branches; S.warehouses = c.warehouses; S.masters = c.masters; S.fys = c.fys;
  return c;
}
const PRODUCT_CAP = 5000;
async function products(force) { if (!S.products || force) { S.products = (await api('acc_list_products', { limit: PRODUCT_CAP })).rows; S.productsPartial = S.products.length >= PRODUCT_CAP; } return S.products; }
// big catalogues (more than PRODUCT_CAP items) are searched on the server and merged into the local list
function rememberProducts(rows) { S.products = S.products || []; rows.forEach((r) => { const i = S.products.findIndex((x) => x.id === r.id); if (i >= 0) S.products[i] = r; else S.products.push(r); }); }
async function searchProducts(q) { const rows = (await api('acc_list_products', { search: q, limit: 8 })).rows; rememberProducts(rows); return rows; }
async function parties(force) { if (!S.parties || force) S.parties = (await api('acc_list_parties', { limit: 5000, include_inactive: true })).rows; return S.parties; }
const bust = (...k) => { if (k.includes('products') || !k.length) S.products = null; if (k.includes('parties') || !k.length) S.parties = null; };
const orgState = () => S.org && S.org.state_code;
const curFY = () => S.fys.find((f) => f.start_date <= today() && today() <= f.end_date) || S.fys[0];

// ---------- toasts, alerts, menus, sheets ----------
let toastEl;
function toast(msg, o = {}) {
  if (toastEl) toastEl.remove();
  toastEl = h('div', { class: 'toast' + (o.err ? ' err' : ''), role: o.err ? 'alert' : 'status' }, o.err ? icon('alert', 20) : icon('check', 20), msg);
  document.body.append(toastEl);
  const el = toastEl; setTimeout(() => el.remove(), o.err ? 6000 : 2800);
}
const fail = (e) => { console.error(e); toast(e && e.message ? e.message : String(e), { err: true }); };
function trap(root, onEsc) {
  const key = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onEsc(); }
    if (e.key === 'Tab') {
      const f = $$('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', root).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  };
  document.addEventListener('keydown', key, true);
  return () => document.removeEventListener('keydown', key, true);
}
function alertBox(o) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const scrim = h('div', { class: 'scrim', style: { zIndex: 68 } });
    const done = (v) => { off(); scrim.remove(); box.remove(); prev && prev.focus && prev.focus(); resolve(v); };
    const acts = o.actions || [{ label: o.confirm || 'OK', value: true, role: 'def' }, ...(o.cancel === false ? [] : [{ label: o.cancel || 'Cancel', value: false }])];
    const box = h('div', { class: 'alert' + (o.wide ? ' wide' : ''), role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
      h('div', { class: 'm' }, h('h3', null, o.title), o.message ? h('p', null, o.message) : null, o.body || null),
      h('div', { class: 'acts' }, acts.map((a) => h('button', { class: a.role || '', type: 'button', onclick: () => done(a.value) }, a.label))));
    document.body.append(scrim, box);
    const off = trap(box, () => done(false));
    scrim.onclick = () => done(false);
    (o.focus ? $(o.focus, box) : $('.def,button', box)).focus();
  });
}
const confirmBox = (title, message, confirm = 'Confirm', danger = false) => alertBox({ title, message, actions: [{ label: confirm, value: true, role: danger ? 'danger' : 'def' }, { label: 'Cancel', value: false }] });
function askText(title, message, placeholder, def = '') {
  return new Promise((resolve) => {
    const inp = h('input', { class: 'input', placeholder, value: def, 'aria-label': title, style: { marginTop: '8px' } });
    alertBox({ title, message, body: inp, confirm: 'Continue', focus: 'input' }).then((ok) => resolve(ok ? inp.value.trim() : null));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.def', inp.closest('.alert')).click(); });
  });
}
function menu(anchor, items, o = {}) {
  closeMenus();
  const m = h('div', { class: 'menu', role: 'menu' }, items.map((it) => it === '-' ? h('hr') : it.header ? h('div', { class: 'gh' }, it.header) :
    h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', disabled: it.disabled, onclick: () => { closeMenus(); it.run(); } }, it.icon ? icon(it.icon, 20) : null, it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, o.right === false ? r.left : r.right - mw)) + 'px';
  m.style.top = (r.bottom + 6 + mh > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenus(); }
  m._off = () => document.removeEventListener('pointerdown', outside, true);
  m.querySelector('button:not(:disabled)')?.focus();
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); anchor.focus(); } });
}
function closeMenus() { $$('.menu').forEach((m) => { m._off && m._off(); m.remove(); }); }
// sheet: bottom sheet on phones, centred dialog on desktop. body is a Node; actions: [{label, primary, danger, onclick(close), keep}]
function sheet(o) {
  const prev = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const close = (v) => { off(); scrim.remove(); el.remove(); prev && prev.focus && prev.focus(); o.onClose && o.onClose(v); };
  const closeBtn = h('button', { class: 'btn plain', type: 'button', onclick: () => close() }, o.closeLabel || 'Cancel');
  const hdrRight = o.headerAction ? h('button', { class: 'btn plain', type: 'button', style: { fontWeight: 700 }, onclick: () => o.headerAction.onclick(close) }, o.headerAction.label) : h('span', { style: { minWidth: '64px' } });
  const body = h('div', { class: 'sheet-b' }, o.body);
  const foot = o.actions && o.actions.length ? h('div', { class: 'sheet-f' }, o.actions.map((a) => h('button', { class: 'btn ' + (a.primary ? 'fill ' : '') + (a.danger ? 'danger ' : ''), type: 'button', onclick: async (ev) => {
    if (a.onclick) { const b = ev.currentTarget; b.disabled = true; try { const r = await a.onclick(close); if (r === false) b.disabled = false; } catch (e) { b.disabled = false; fail(e); } }
  } }, a.label))) : null;
  const el = h('div', { class: 'sheet' + (o.full ? ' full' : '') + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, h('div', { class: 'sheet-h' }, closeBtn, h('h2', null, o.title), hdrRight), body, foot);
  document.body.append(scrim, el);
  const off = trap(el, () => close());
  scrim.onclick = () => close();
  setTimeout(() => ($('[autofocus],input:not([type=hidden]),select,textarea', body) || closeBtn).focus(), 60);
  return { close, el, body };
}

// ---------- components ----------
function badge(text, tone) { return h('span', { class: 'badge ' + (tone || '') }, text); }
const STATUS_TONE = { paid: 'green', posted: 'green', matched: 'green', reconciled: 'green', due: 'blue', open: 'blue', 'partially paid': 'orange', overdue: 'red', draft: '', 'pending approval': 'orange', cancelled: '', converted: 'blue', closed: '', unmatched: 'orange', ignored: '', mismatch: 'orange', generated: 'green', payload_ready: 'blue' };
const statusBadge = (s) => badge(cap1(s), STATUS_TONE[s] ?? '');
function seg(options, value, onChange, o = {}) {
  const el = h('div', { class: 'seg' + (o.full ? ' full' : ''), role: 'tablist', 'aria-label': o.label || 'View' });
  const set = (v) => { $$('button', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === String(v)))); };
  options.forEach(([v, label]) => el.append(h('button', { type: 'button', role: 'tab', 'data-v': v, 'aria-selected': String(v === value), onclick: () => { set(v); onChange(v); } }, label)));
  return el;
}
function chips(options, value, onChange) {
  const el = h('div', { class: 'chips', role: 'group' });
  options.forEach(([v, label]) => el.append(h('button', { type: 'button', class: 'chip', 'data-v': v, 'aria-pressed': String(v === value), onclick: () => { $$('.chip', el).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.v === String(v)))); onChange(v); } }, label)));
  return el;
}
function field(label, control, hint) { const id = 'f' + Math.random().toString(36).slice(2, 8); if (control.setAttribute && !control.id) control.id = id; return h('div', { class: 'field' }, h('label', { for: control.id || id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null); }
function input(o = {}) { return h('input', { class: 'input' + (o.cls ? ' ' + o.cls : ''), type: o.type || 'text', placeholder: o.placeholder || '', value: o.value ?? '', inputmode: o.mode, autocomplete: o.auto || 'off', maxlength: o.max, min: o.min, step: o.step, required: o.required, 'aria-label': o.label, oninput: o.oninput, onchange: o.onchange, onkeydown: o.onkeydown }); }
function selectEl(options, value, o = {}) {
  const s = h('select', { class: 'select' + (o.cls ? ' ' + o.cls : ''), 'aria-label': o.label, onchange: o.onchange });
  options.forEach((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; s.append(h('option', { value: v, selected: String(v) === String(value) }, l)); });
  if (value != null) s.value = value;
  return s;
}
const dateInput = (v, o = {}) => input({ type: 'date', value: v, label: o.label, onchange: o.onchange });
function checkbox(label, checked, onChange) { const i = h('input', { type: 'checkbox', checked, onchange: () => onChange && onChange(i.checked) }); return h('label', { class: 'check' }, i, h('span', null, label)); }
function toggleRow(label, checked, onChange, sub) { const i = h('input', { type: 'checkbox', role: 'switch', checked, onchange: () => onChange(i.checked), 'aria-label': label }); return h('label', { class: 'li', style: { cursor: 'pointer' } }, h('div', { class: 'grow' }, h('div', { class: 't' }, label), sub ? h('div', { class: 's', style: { whiteSpace: 'normal' } }, sub) : null), h('span', { class: 'switch' }, i)); }
function searchField(placeholder, onInput, value = '') {
  const i = h('input', { class: 'input', type: 'search', placeholder, value, 'aria-label': placeholder, autocomplete: 'off', oninput: () => { cl.classList.toggle('hidden', !i.value); onInput(i.value); } });
  const cl = h('button', { class: 'clear' + (value ? '' : ' hidden'), type: 'button', 'aria-label': 'Clear search', onclick: () => { i.value = ''; cl.classList.add('hidden'); onInput(''); i.focus(); } }, icon('x', 16));
  const wrap = h('div', { class: 'search' }, icon('search', 18), i, cl); wrap.input = i; return wrap;
}
function empty(ic, title, text, action) { return h('div', { class: 'empty' }, h('div', { class: 'ic' }, icon(ic, 28)), h('h3', null, title), text ? h('p', null, text) : null, action || null); }
function kpi(label, value, sub, onclick, tone) {
  const inner = [h('div', { class: 'k' }, label), h('div', { class: 'n num' + (tone ? ' ' + tone : '') }, value), sub ? h('div', { class: 'd' }, sub) : null];
  return onclick ? h('button', { class: 'kpi', type: 'button', onclick }, inner) : h('div', { class: 'kpi' }, inner);
}
function liRow(o) {
  const inner = [o.icon ? h('span', { class: 'tile ' + (o.tone || '') }, icon(o.icon, 18)) : null,
    h('div', { class: 'grow' }, h('div', { class: 't' }, o.title), o.sub ? h('div', { class: 's' }, o.sub) : null),
    o.value != null || o.valueSub ? h('div', { class: 'v' }, o.value != null ? h('div', { class: 't' }, o.value) : null, o.valueSub ? h('div', { class: 's' }, o.valueSub) : null) : null,
    o.badge || null, o.onclick || o.chevron ? h('span', { class: 'chev' }, icon('chevR', 18)) : null];
  return o.onclick ? h('button', { class: 'li' + (o.sel ? ' sel' : ''), type: 'button', onclick: o.onclick }, inner) : h('div', { class: 'li' }, inner);
}
const isDesk = () => matchMedia('(min-width:900px)').matches;
// One dataset, two presentations: sortable table on desktop, grouped list on phones.
// columns: [{key, label, r:right, sort, render(row), title:true (phone title), sub:true (phone subtitle), value:true (phone trailing), badge:true, hideMobile}]
function dataView(columns, rows, o = {}) {
  if (!rows.length) return o.empty || empty('list', 'Nothing here yet', o.emptyText);
  const sel = o.selectable ? new Set() : null;
  const state = { key: o.sortKey, dir: o.sortDir || 1 };
  const wrap = h('div');
  const cellVal = (c, r) => c.render ? c.render(r) : (r[c.key] ?? '');
  const sorted = () => {
    if (!state.key) return rows;
    const c = columns.find((x) => x.key === state.key);
    const val = (r) => c.sortVal ? c.sortVal(r) : r[c.key];
    return [...rows].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true })) * state.dir; });
  };
  const paint = () => {
    clear(wrap);
    const data = sorted();
    if (isDesk()) {
      const thead = h('tr', null, sel ? h('th', { style: { width: '44px' } }, h('input', { type: 'checkbox', 'aria-label': 'Select all', onchange: (e) => { data.forEach((r) => e.target.checked ? sel.add(r.id) : sel.delete(r.id)); o.onSelect && o.onSelect(sel); paint(); } })) : null,
        columns.filter((c) => !c.hideDesk).map((c) => h('th', { class: (c.r ? 'r ' : '') + (c.sort !== false && c.key ? 'sortable' : ''), 'aria-sort': state.key === c.key ? (state.dir > 0 ? 'ascending' : 'descending') : 'none', onclick: c.sort !== false && c.key ? () => { state.dir = state.key === c.key ? -state.dir : 1; state.key = c.key; paint(); } : null }, c.label, state.key === c.key ? (state.dir > 0 ? ' ↑' : ' ↓') : '')));
      const tbody = h('tbody', null, data.map((r) => h('tr', { class: o.onRow ? 'click' : '', tabindex: o.onRow ? 0 : null, onclick: (e) => { if (!e.target.closest('input,button,a,select')) o.onRow && o.onRow(r); }, onkeydown: (e) => { if (e.key === 'Enter' && o.onRow) o.onRow(r); } },
        sel ? h('td', null, h('input', { type: 'checkbox', checked: sel.has(r.id), 'aria-label': 'Select row', onchange: (e) => { e.target.checked ? sel.add(r.id) : sel.delete(r.id); o.onSelect && o.onSelect(sel); } })) : null,
        columns.filter((c) => !c.hideDesk).map((c) => h('td', { class: c.r ? 'r' : '' }, cellVal(c, r))))));
      const foot = o.footer ? h('tfoot', null, h('tr', null, sel ? h('td') : null, columns.filter((c) => !c.hideDesk).map((c, i) => h('td', { class: c.r ? 'r' : '' }, o.footer[c.key] ?? (i === 0 ? 'Total' : ''))))) : null;
      wrap.append(h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, thead), tbody, foot))));
    } else {
      const T = columns.find((c) => c.title) || columns[0], Sb = columns.find((c) => c.sub), V = columns.find((c) => c.value), B = columns.find((c) => c.badge);
      wrap.append(h('div', { class: 'list' }, data.map((r) => h(o.onRow ? 'button' : 'div', { class: 'li', type: o.onRow ? 'button' : null, onclick: o.onRow ? () => o.onRow(r) : null },
        sel ? h('input', { type: 'checkbox', checked: sel.has(r.id), 'aria-label': 'Select row', onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? sel.add(r.id) : sel.delete(r.id); o.onSelect && o.onSelect(sel); } }) : null,
        h('div', { class: 'grow' }, h('div', { class: 't' }, cellVal(T, r)), Sb ? h('div', { class: 's' }, cellVal(Sb, r)) : null),
        h('div', { class: 'v' }, V ? h('div', { class: 't' }, cellVal(V, r)) : null, B ? h('div', { style: { marginTop: '3px' } }, cellVal(B, r)) : null),
        o.onRow ? h('span', { class: 'chev' }, icon('chevR', 18)) : null))));
    }
  };
  paint();
  wrap._repaint = paint; wrap._sel = sel;
  window.addEventListener('resize', wrap._rs = debounce(() => { if (wrap.isConnected) paint(); else window.removeEventListener('resize', wrap._rs); }, 150));
  return wrap;
}

// ---------- charts (zero dependency SVG) ----------
const NS = 'http://www.w3.org/2000/svg';
const sv = (t, a, ...k) => { const e = document.createElementNS(NS, t); for (const x in a) e.setAttribute(x, a[x]); k.flat().forEach((c) => c != null && e.append(c instanceof Node ? c : document.createTextNode(c))); return e; };
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function barChart(items, o = {}) { // items: [{label, value, value2?}]
  const W = 640, H = 220, pl = 8, pb = 26, pt = 10, n = items.length || 1;
  const mx = niceMax(Math.max(...items.map((i) => Math.max(i.value || 0, i.value2 || 0)), 1));
  const bw = (W - pl * 2) / n, svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': o.label || 'Bar chart' });
  [0, .5, 1].forEach((f) => svg.append(sv('line', { x1: pl, x2: W - pl, y1: pt + (H - pt - pb) * (1 - f), y2: pt + (H - pt - pb) * (1 - f), stroke: 'currentColor', 'stroke-opacity': '.12' })));
  items.forEach((it, i) => {
    const bwh = Math.min(bw * (o.two ? .38 : .62), 38), x = pl + i * bw + bw / 2;
    const mk = (v, dx, cls) => { const hh = (H - pt - pb) * (v / mx); const r = sv('rect', { x: x + dx - bwh / 2, y: H - pb - hh, width: bwh, height: Math.max(hh, v > 0 ? 1.5 : 0), rx: 4, class: 'bar ' + (cls || '') }); r.append(sv('title', {}, `${it.label}: ${inr(v, 0)}`)); svg.append(r); };
    if (o.two) { mk(it.value, -bwh * .55, ''); mk(it.value2 || 0, bwh * .55, 'alt'); } else mk(it.value, 0, '');
    if (n <= 14 || i % Math.ceil(n / 12) === 0) svg.append(sv('text', { x, y: H - 7, 'text-anchor': 'middle' }, it.label));
  });
  svg.append(sv('text', { x: W - pl, y: pt + 10, 'text-anchor': 'end' }, compact(mx)));
  return svg;
}
function lineChart(points, o = {}) { // points: [{label, value}]
  const W = 640, H = 200, pl = 6, pb = 24, pt = 12, n = points.length;
  if (!n) return h('div');
  const mx = niceMax(Math.max(...points.map((p) => p.value), 1)), step = (W - pl * 2) / Math.max(n - 1, 1);
  const xy = points.map((p, i) => [pl + i * step, pt + (H - pt - pb) * (1 - p.value / mx)]);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': o.label || 'Line chart' });
  [0, .5, 1].forEach((f) => svg.append(sv('line', { x1: pl, x2: W - pl, y1: pt + (H - pt - pb) * (1 - f), y2: pt + (H - pt - pb) * (1 - f), stroke: 'currentColor', 'stroke-opacity': '.12' })));
  svg.append(sv('path', { d: `M${xy[0][0]},${H - pb} ` + xy.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${xy[n - 1][0]},${H - pb}Z`, class: 'area-p' }), sv('path', { d: xy.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' '), class: 'line-p' }));
  points.forEach((p, i) => { if (i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0) svg.append(sv('text', { x: xy[i][0], y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, p.label)); });
  xy.forEach((p, i) => { const c = sv('circle', { cx: p[0], cy: p[1], r: 6, fill: 'transparent' }); c.append(sv('title', {}, `${points[i].label}: ${inr(points[i].value, 0)}`)); svg.append(c); });
  svg.append(sv('text', { x: W - pl, y: 10, 'text-anchor': 'end' }, compact(mx)));
  return svg;
}
function hbars(items, o = {}) { // [{label, value, sub?}]
  const mx = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return h('div', { class: 'hbar' }, items.map((i) => h('div', { class: 'r' }, h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, i.label), h('div', { class: 'tr', 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(2, Math.abs(i.value) / mx * 100) + '%' } })), h('div', { class: 'num', style: { textAlign: 'right' } }, o.fmt ? o.fmt(i.value) : inr(i.value, 0)))));
}

// ---------- files: CSV / XLSX in and out ----------
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
const csvCell = (v) => { v = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v) && isNaN(Number(v))) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function download(name, blob) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function exportCSV(name, head, rows) { download(name + '.csv', new Blob(['﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); }
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipStore(files) { // files: [[name, string]] -> Blob (uncompressed zip, enough for .xlsx)
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), db = enc.encode(text), crc = crc32(db);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true); lh.setUint32(18, db.length, true); lh.setUint32(22, db.length, true); lh.setUint16(26, nb.length, true);
    parts.push(lh, nb, db);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, db.length, true); ch.setUint32(24, db.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    cd.push(ch, nb); off += 30 + nb.length + db.length;
  }
  const cdSize = cd.reduce((s, x) => s + (x.byteLength ?? x.length), 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cd, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function exportXLSX(name, head, rows) {
  const col = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const cell = (v, r, c) => { const ref = col(c) + (r + 1); if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`; return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v ?? '')}</t></is></c>`; };
  const sheetXml = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + [head, ...rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('') + '</sheetData></worksheet>';
  download(name + '.xlsx', zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheetXml]]));
}
async function inflateRaw(bytes) { const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
async function readXLSX(buf) { // first worksheet -> array of rows (strings)
  const u8 = new Uint8Array(buf), dv = new DataView(buf); let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not a valid .xlsx file');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const ent = {};
  for (let i = 0; i < n; i++) { const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true); const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)); ent[name] = { m, cs, lo }; p += 46 + nl + xl + cl; }
  const get = async (name) => { const x = ent[name]; if (!x) return null; const nl = dv.getUint16(x.lo + 26, true), xl = dv.getUint16(x.lo + 28, true), start = x.lo + 30 + nl + xl, data = u8.subarray(start, start + x.cs); return new TextDecoder().decode(x.m === 0 ? data : await inflateRaw(data)); };
  const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const shared = []; const ss = await get('xl/sharedStrings.xml');
  if (ss) parse(ss).querySelectorAll('si').forEach((si) => shared.push([...si.querySelectorAll('t')].map((t) => t.textContent).join('')));
  const sheetName = Object.keys(ent).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('No worksheet found in this file');
  const doc = parse(await get(sheetName)), rows = [];
  const colIdx = (ref) => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  doc.querySelectorAll('row').forEach((r) => {
    const row = [];
    r.querySelectorAll('c').forEach((c) => { const t = c.getAttribute('t'), v = c.querySelector('v'); let val = ''; if (t === 's') val = shared[+(v && v.textContent)] ?? ''; else if (t === 'inlineStr') val = c.textContent; else val = v ? v.textContent : ''; row[colIdx(c.getAttribute('r'))] = val; });
    if (row.some((x) => x !== undefined && x !== '')) rows.push([...row].map((x) => x ?? ''));
  });
  return rows;
}
async function readTable(file) { // CSV or XLSX -> [[...]] rows
  if (/\.xlsx$/i.test(file.name)) return readXLSX(await file.arrayBuffer());
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Save as .xlsx or .csv first');
  return parseCSV(await file.text());
}
function exportMenu(anchor, name, head, rows) {
  menu(anchor, [{ label: 'CSV file', icon: 'download', run: () => exportCSV(name, head, rows) }, { label: 'Excel (.xlsx)', icon: 'download', run: () => exportXLSX(name, head, rows) }, { label: 'Print or save as PDF', icon: 'print', run: () => printTable(name, head, rows) }]);
}
function printTable(title, head, rows) {
  let ps = $('#printSheet'); if (!ps) { ps = h('div', { id: 'printSheet', class: 'print-only' }); document.body.append(ps); }
  clear(ps).append(h('h1', null, title), h('div', { class: 'small' }, (S.org && (S.org.trade_name || S.org.legal_name)) + ' · printed ' + fmtDT(new Date())), h('div', { class: 'rule' }),
    h('table', null, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((v, i) => h('td', { class: typeof v === 'number' ? 'r' : '' }, typeof v === 'number' ? nf2.format(v) : v)))))));
  setTimeout(() => window.print(), 50);
}

// ---------- attachments (private storage) ----------
async function uploadAttachment(entity, id, file) {
  if (file.size > 10e6) throw new Error('Files can be up to 10 MB');
  const res = await apiFile('/storage/acc', { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  const j = await res.json();
  await api('acc_add_attachment', { p_entity: entity, p_id: id, p_name: file.name, p_url: j.url, p_size: file.size });
}
async function openAttachment(a) { const res = await apiFile(a.url.replace(/^.*?(\/storage\/)/, '/storage/')); const b = await res.blob(); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }
