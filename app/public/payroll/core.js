/* AUZslab Payroll: core. DOM helper, formatting, API, state, and the Apple-HIG UI kit (sheets, alerts, menus, segmented
   controls, lists, tables, charts, exports). Plain script, no build step: every page file below uses these globals.
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
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h4.5v-5.5h4v5.5h4.5V10"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.4-3.2 2.8-5 6-5s5.6 1.8 6 5"/><path d="M16 5a3 3 0 0 1 0 6M18 15c1.8.6 3 2 3.2 5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.5-3.6 3.2-5.5 7-5.5s6.5 1.9 7 5.5"/>',
  userplus: '<circle cx="10" cy="8" r="3.6"/><path d="M3 20c.5-3.6 3.2-5.5 7-5.5 1.6 0 3 .3 4.1.9M18 14v6M15 17h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  leave: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4M9 15l2 2 4-4"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="4" y="7" width="16" height="12" rx="2.5"/><path d="M16 13h2"/>',
  rupee: '<path d="M7 5h10M7 9h10M9.5 5c3 0 4.5 1.6 4.5 4s-1.5 4-4.5 4H7l8 6"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/>',
  bank: '<path d="M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
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
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.3v.2"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  building: '<path d="M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5h6v2M3 12h18"/>',
  tablet: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M11 18h2"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5 19 4M16 7l2 2M14 9l2 2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12"/>',
  login: '<path d="M10 17l5-5-5-5M15 12H3M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/>',
  logout: '<path d="M15 17l5-5-5-5M20 12H8M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15.5l-.6-2.3a1.5 1.5 0 0 1 2.7-1.2L8 15"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>', star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5 12 22l9-4.5"/>', book: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h12M9 8h6"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-1.5-3-5-4-5-1.5S12 9 12 9zM12 9c1.5-3 5-4 5-1.5S12 9 12 9z"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>', filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  scale: '<path d="M12 3v18M5 21h14M4 8h16M7 8l-3 7a3.5 3.5 0 0 0 6 0zM17 8l-3 7a3.5 3.5 0 0 0 6 0z"/>',
  cake: '<path d="M4 20h16M5 20v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6M5 16c2 1 3-1 5 0s3-1 5 0 3-1 4 0M12 12V9M12 6.5v.2"/>',
  door: '<path d="M6 21V4h10v17M4 21h16M13 12h.01"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.6 15.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 3.6-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  apple: '<path fill="currentColor" stroke="none" d="M16.365 1.43c0 1.14-.46 2.1-1.17 2.83-.78.8-2.03 1.42-3.09 1.33-.12-1.1.46-2.25 1.15-2.97.78-.83 2.17-1.46 3.11-1.19ZM20.6 17.17c-.46 1.06-.68 1.53-1.27 2.47-.82 1.3-1.98 2.93-3.41 2.94-1.27.02-1.6-.83-3.33-.82-1.73.01-2.09.84-3.36.82-1.43-.02-2.53-1.48-3.35-2.78-2.3-3.63-2.54-7.89-1.12-10.16.99-1.6 2.56-2.54 4.03-2.54 1.5 0 2.44.84 3.68.84 1.2 0 1.93-.85 3.66-.85 1.32 0 2.71.72 3.7 1.96-3.25 1.78-2.72 6.42.77 8.12Z"/>',
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
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const N = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const inr = (n, dp) => { n = Number(n) || 0; if (dp === undefined) dp = Number.isInteger(n) ? 0 : 2; const s = (dp === 0 ? nf0 : nf2).format(Math.abs(n)); return (n < 0 ? '-₹' : '₹') + s; };
const compact = (n) => { n = Number(n) || 0; const a = Math.abs(n), s = n < 0 ? '-' : ''; if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr'; if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L'; if (a >= 1e3) return s + '₹' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return s + '₹' + Math.round(a); };
function money(n, opts = {}) { const v = Number(n) || 0; return h('span', { class: 'money num' + (opts.cls ? ' ' + opts.cls : '') }, opts.compact ? compact(v) : inr(v, opts.dp)); }
const qty = (n) => { n = Number(n) || 0; return Number.isInteger(n) ? String(n) : String(r2(n)); };
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => (S.ctx && S.ctx.today) || isoDate(new Date());
const parseD = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return isoDate(d); };
const monthOf = (s) => String(s || today()).slice(0, 7);
const monthAdd = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1, 12); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
const monthName = (m, o = {}) => m ? new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1, 12).toLocaleDateString('en-GB', { month: o.short ? 'short' : 'long', year: o.noYear ? undefined : 'numeric' }) : '';
const daysIn = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const fmtD = (s, o = {}) => s ? parseD(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: o.noYear ? undefined : 'numeric', weekday: o.weekday ? 'short' : undefined }) : '';
const fmtT = (s) => s ? new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', ' ') : '';
const fmtDT = (s) => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const mins = (m) => { m = Math.round(Number(m) || 0); const hh = Math.floor(m / 60), mm = m % 60; return hh ? hh + 'h' + (mm ? ' ' + mm + 'm' : '') : mm + 'm'; };
const cap1 = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (f, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const STATES = { '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh' };
const stateOptions = () => [['', 'Pick a state'], ...Object.entries(STATES).sort((a, b) => a[1].localeCompare(b[1]))];
// state codes with a professional tax rule seeded (db/074); every other state shows "no professional tax"
const PT_STATES = ['27', '29', '19', '36', '37', '24', '33'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// a number in words for payslips (Indian system)
function inWords(n) {
  n = Math.round(Number(n) || 0); if (n === 0) return 'Zero rupees only';
  const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (x) => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? '-' + a[x % 10] : '');
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const parts = []; const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(three(cr) + ' crore'); if (lk) parts.push(two(lk) + ' lakh'); if (th) parts.push(two(th) + ' thousand'); if (n) parts.push(three(n));
  const s = parts.join(' ') + ' rupees only'; return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- API ----------
let busy = 0;
async function api(fn, args) {
  busy++; document.documentElement.setAttribute('aria-busy', 'true');
  try {
    let r;
    try { r = await sb.rpc(fn, args || {}); } catch (e) { throw new Error(navigator.onLine === false ? 'You are offline. Payroll needs a connection.' : 'Could not reach the server. Check your connection and try again.'); }
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
// employee documents and receipts: private storage, checked by pay_doc_check() on the server
async function uploadDoc(empId, file) {
  if (file.size > 10e6) throw new Error('Files can be up to 10 MB');
  const res = await apiFile('/storage/doc?empId=' + encodeURIComponent(empId), { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  return res.json();
}
async function openDoc(path) { const res = await apiFile('/storage/doc/' + path); const b = await res.blob(); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }

// ---------- state ----------
const S = { ctx: null, perms: {}, user: null, dash: null };
const can = (k) => !!S.perms[k];
const canPay = () => can('pay_salary') || can('pay_run') || can('pay_approve') || can('pay_pay');
const isHR = () => !!(S.ctx && S.ctx.hr);
const org = () => (S.ctx && S.ctx.org) || {};
const oset = (grp, k, def) => { const g = (org().settings || {})[grp] || {}; return g[k] === undefined ? def : g[k]; };
const masters = (k) => ((S.ctx && S.ctx.masters) || []).filter((m) => m.kind === k && m.active).map((m) => m.name);
const locName = (id) => ((S.ctx.locations || []).find((l) => l.id === id) || {}).name || '';
const shiftName = (id) => ((S.ctx.shifts || []).find((l) => l.id === id) || {}).name || '';
async function loadCtx() {
  const c = await api('pay_bootstrap');
  S.ctx = c; S.perms = c.perms || {};
  return c;
}
let PEOPLE = null;
async function people(force) { if (!PEOPLE || force) PEOPLE = await api('pay_list_employees', { p: { status: 'all' } }); return PEOPLE; }
const bust = () => { PEOPLE = null; };

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
function askText(title, message, placeholder, def = '', o = {}) {
  return new Promise((resolve) => {
    const inp = h(o.multi ? 'textarea' : 'input', { class: o.multi ? 'textarea' : 'input', placeholder, value: def, 'aria-label': title, style: { marginTop: '8px' }, inputmode: o.mode });
    alertBox({ title, message, body: inp, confirm: o.confirm || 'Continue', focus: o.multi ? 'textarea' : 'input' }).then((ok) => resolve(ok ? inp.value.trim() : null));
    if (!o.multi) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.def', inp.closest('.alert')).click(); });
  });
}
function menu(anchor, items, o = {}) {
  closeMenus();
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => it === '-' ? h('hr') : it.header ? h('div', { class: 'gh' }, it.header) :
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
// sheet: bottom sheet on phones, centred dialog on desktop. body is a Node; actions: [{label, primary, danger, onclick(close)}]
function sheet(o) {
  const prev = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const close = (v) => { off(); scrim.remove(); el.remove(); prev && prev.focus && prev.focus(); o.onClose && o.onClose(v); };
  const closeBtn = h('button', { class: 'btn plain', type: 'button', onclick: () => close() }, o.closeLabel || 'Cancel');
  const hdrRight = o.headerAction ? h('button', { class: 'btn plain', type: 'button', style: { fontWeight: 700 }, onclick: () => o.headerAction.onclick(close) }, o.headerAction.label) : h('span', { style: { minWidth: '64px' } });
  const body = h('div', { class: 'sheet-b' }, o.body);
  const foot = o.actions && o.actions.length ? h('div', { class: 'sheet-f' }, o.actions.filter(Boolean).map((a) => h('button', { class: 'btn ' + (a.primary ? 'fill ' : '') + (a.danger ? 'danger ' : ''), type: 'button', onclick: async (ev) => {
    if (a.onclick) { const b = ev.currentTarget; b.disabled = true; try { const r = await a.onclick(close); if (r === false) b.disabled = false; } catch (e) { b.disabled = false; fail(e); } }
  } }, a.label))) : null;
  const el = h('div', { class: 'sheet' + (o.full ? ' full' : '') + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, h('div', { class: 'sheet-h' }, closeBtn, h('h2', null, o.title), hdrRight), body, foot);
  document.body.append(scrim, el);
  const off = trap(el, () => close());
  scrim.onclick = () => close();
  setTimeout(() => ($('[autofocus]', body) || (o.noFocus ? null : $('input:not([type=hidden]):not([type=checkbox]),select,textarea', body)) || closeBtn).focus(), 60);
  return { close, el, body };
}

// ---------- components ----------
function badge(text, tone) { return h('span', { class: 'badge ' + (tone || '') }, text); }
const ATT = { present: ['Present', 'green'], late: ['Late', 'orange'], half: ['Half day', 'orange'], absent: ['Absent', 'red'], missing: ['No clock-out', 'orange'], leave: ['On leave', 'blue'],
  half_leave: ['Half leave', 'blue'], holiday: ['Holiday', ''], weekly_off: ['Day off', ''], upcoming: ['Not in yet', ''] };
const attBadge = (st) => st ? badge(...(ATT[st] || [cap1(st), ''])) : badge('No record', '');
const RUN = { draft: ['Draft', ''], calculated: ['To review', 'blue'], review: ['Waiting for approval', 'orange'], approved: ['Approved', 'blue'], finalized: ['To pay', 'orange'], paid: ['Paid', 'green'], locked: ['Closed', 'green'], cancelled: ['Cancelled', ''] };
const runBadge = (st) => badge(...(RUN[st] || [cap1(st), '']));
const REQ = { pending: ['Waiting', 'orange'], submitted: ['Waiting', 'orange'], requested: ['Waiting', 'orange'], approved: ['Approved', 'green'], active: ['Active', 'blue'], rejected: ['Declined', 'red'], cancelled: ['Cancelled', ''], paid: ['Paid', 'green'], closed: ['Closed', ''] };
const reqBadge = (st) => badge(...(REQ[st] || [cap1(st), '']));
const EMP = { onboarding: ['Joining', 'blue'], active: ['Active', 'green'], notice: ['Leaving', 'orange'], exited: ['Left', ''] };
const empBadge = (st) => badge(...(EMP[st] || [cap1(st), '']));
function avatar(name, size = 36, photo) {
  const hue = [...String(name || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  return h('span', { class: 'av', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * .38) + 'px', background: `hsl(${hue} 34% 88%)`, color: `hsl(${hue} 40% 28%)` }, 'aria-hidden': 'true' }, initials(name));
}
function seg(options, value, onChange, o = {}) {
  const el = h('div', { class: 'seg' + (o.full ? ' full' : ''), role: 'tablist', 'aria-label': o.label || 'View' });
  const set = (v) => { $$('button', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === String(v)))); };
  options.forEach(([v, label]) => el.append(h('button', { type: 'button', role: 'tab', 'data-v': v, 'aria-selected': String(v === value), onclick: () => { set(v); onChange(v); } }, label)));
  return el;
}
function chips(options, value, onChange, o = {}) {
  const multi = Array.isArray(value);
  const el = h('div', { class: 'chips' + (o.wrap ? ' wrap' : ''), role: 'group', 'aria-label': o.label });
  options.forEach(([v, label]) => el.append(h('button', { type: 'button', class: 'chip', 'data-v': v, 'aria-pressed': String(multi ? value.includes(v) : v === value), onclick: (e) => {
    if (multi) { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); onChange(v, on); }
    else { $$('.chip', el).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.v === String(v)))); onChange(v); }
  } }, label)));
  return el;
}
function field(label, control, hint) { const id = 'f' + Math.random().toString(36).slice(2, 8); if (control.setAttribute && !control.id) control.id = id; return h('div', { class: 'field' }, h('label', { for: control.id || id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null); }
function input(o = {}) { return h('input', { class: 'input' + (o.cls ? ' ' + o.cls : ''), type: o.type || 'text', placeholder: o.placeholder || '', value: o.value ?? '', inputmode: o.mode, autocomplete: o.auto || 'off', maxlength: o.max, min: o.min, max: o.maxv, step: o.step, required: o.required, 'aria-label': o.label, oninput: o.oninput, onchange: o.onchange, onkeydown: o.onkeydown, autofocus: o.autofocus }); }
function selectEl(options, value, o = {}) {
  const s = h('select', { class: 'select' + (o.cls ? ' ' + o.cls : ''), 'aria-label': o.label, onchange: o.onchange });
  options.forEach((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; s.append(h('option', { value: v, selected: String(v) === String(value) }, l)); });
  if (value != null) s.value = value;
  return s;
}
const dateInput = (v, o = {}) => input({ type: 'date', value: v, label: o.label, onchange: o.onchange, min: o.min, maxv: o.max });
function datalistInput(listId, options, o = {}) { const i = input({ ...o, label: o.label }); i.setAttribute('list', listId); return [i, h('datalist', { id: listId }, options.map((x) => h('option', { value: x })))]; }
function toggleRow(label, checked, onChange, sub) { const i = h('input', { type: 'checkbox', role: 'switch', checked, onchange: () => onChange(i.checked), 'aria-label': label }); return h('label', { class: 'li', style: { cursor: 'pointer' } }, h('div', { class: 'grow' }, h('div', { class: 't', style: { whiteSpace: 'normal' } }, label), sub ? h('div', { class: 's', style: { whiteSpace: 'normal' } }, sub) : null), h('span', { class: 'switch' }, i)); }
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
  const inner = [o.avatar ? avatar(o.avatar, 36) : o.icon ? h('span', { class: 'tile ' + (o.tone || '') }, icon(o.icon, 18)) : null,
    h('div', { class: 'grow' }, h('div', { class: 't' }, o.title), o.sub ? h('div', { class: 's' }, o.sub) : null),
    o.value != null || o.valueSub ? h('div', { class: 'v' }, o.value != null ? h('div', { class: 't' }, o.value) : null, o.valueSub ? h('div', { class: 's' }, o.valueSub) : null) : null,
    o.badge || null, o.right || null, o.onclick || o.chevron ? h('span', { class: 'chev' }, icon('chevR', 18)) : null];
  return o.onclick ? h('button', { class: 'li' + (o.sel ? ' sel' : ''), type: 'button', onclick: o.onclick }, inner) : h('div', { class: 'li' }, inner);
}
function section(title, ...kids) { return h('div', { class: 'sec' }, title ? h('div', { class: 'sec-h' }, typeof title === 'string' ? h('h3', null, title) : title) : null, ...kids); }
const isDesk = () => matchMedia('(min-width:900px)').matches;
// One dataset, two presentations: sortable table on desktop, grouped list on phones.
// columns: [{key, label, r:right, render(row), title:true, sub:true, value:true, badge:true, hideDesk, sortVal}]
function dataView(columns, rows, o = {}) {
  if (!rows.length) return o.empty || empty('list', 'Nothing here yet', o.emptyText);
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
    if (isDesk() && !o.listOnly) {
      const cols = columns.filter((c) => !c.hideDesk);
      const thead = h('tr', null, cols.map((c) => h('th', { class: (c.r ? 'r ' : '') + (c.sort !== false && c.key ? 'sortable' : ''), 'aria-sort': state.key === c.key ? (state.dir > 0 ? 'ascending' : 'descending') : 'none', onclick: c.sort !== false && c.key ? () => { state.dir = state.key === c.key ? -state.dir : 1; state.key = c.key; paint(); } : null }, c.label, state.key === c.key ? (state.dir > 0 ? ' ↑' : ' ↓') : '')));
      const tbody = h('tbody', null, data.map((r) => h('tr', { class: o.onRow ? 'click' : '', tabindex: o.onRow ? 0 : null, onclick: (e) => { if (!e.target.closest('input,button,a,select')) o.onRow && o.onRow(r); }, onkeydown: (e) => { if (e.key === 'Enter' && o.onRow) o.onRow(r); } },
        cols.map((c) => h('td', { class: c.r ? 'r' : '' }, cellVal(c, r))))));
      const foot = o.footer ? h('tfoot', null, h('tr', null, cols.map((c, i) => h('td', { class: c.r ? 'r' : '' }, o.footer[c.key] ?? (i === 0 ? 'Total' : ''))))) : null;
      wrap.append(h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, thead), tbody, foot))));
    } else {
      const T = columns.find((c) => c.title) || columns[0], Sb = columns.find((c) => c.sub), V = columns.find((c) => c.value), B = columns.find((c) => c.badge), A = columns.find((c) => c.avatar);
      wrap.append(h('div', { class: 'list' }, data.map((r) => h(o.onRow ? 'button' : 'div', { class: 'li', type: o.onRow ? 'button' : null, onclick: o.onRow ? () => o.onRow(r) : null },
        A ? avatar(A.avatar(r), 36) : null,
        h('div', { class: 'grow' }, h('div', { class: 't' }, cellVal(T, r)), Sb ? h('div', { class: 's' }, cellVal(Sb, r)) : null),
        h('div', { class: 'v' }, V ? h('div', { class: 't' }, cellVal(V, r)) : null, B ? h('div', { style: { marginTop: '3px' } }, cellVal(B, r)) : null),
        o.onRow ? h('span', { class: 'chev' }, icon('chevR', 18)) : null))));
    }
  };
  paint();
  wrap._repaint = paint;
  window.addEventListener('resize', wrap._rs = debounce(() => { if (wrap.isConnected) paint(); else window.removeEventListener('resize', wrap._rs); }, 150));
  return wrap;
}
// step indicator for the payroll run
function stepper(steps, current) {
  return h('ol', { class: 'steps', 'aria-label': 'Progress' }, steps.map((s, i) => h('li', { class: i < current ? 'done' : i === current ? 'now' : '', 'aria-current': i === current ? 'step' : null },
    h('span', { class: 'dot' }, i < current ? icon('check', 14) : String(i + 1)), h('span', { class: 'lbl' }, s))));
}
function banner(tone, ic, ...kids) { return h('div', { class: 'banner ' + (tone || '') }, icon(ic || 'info', 20), h('div', { class: 'grow' }, ...kids)); }

// ---------- charts (zero dependency SVG) ----------
const NS = 'http://www.w3.org/2000/svg';
const sv = (t, a, ...k) => { const e = document.createElementNS(NS, t); for (const x in a) e.setAttribute(x, a[x]); k.flat().forEach((c) => c != null && e.append(c instanceof Node ? c : document.createTextNode(c))); return e; };
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function barChart(items, o = {}) { // items: [{label, value, value2?}]
  const W = 640, H = 200, pl = 8, pb = 26, pt = 10, n = items.length || 1;
  const mx = niceMax(Math.max(...items.map((i) => Math.max(i.value || 0, i.value2 || 0)), 1));
  const bw = (W - pl * 2) / n, svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': o.label || 'Bar chart' });
  [0, .5, 1].forEach((f) => svg.append(sv('line', { x1: pl, x2: W - pl, y1: pt + (H - pt - pb) * (1 - f), y2: pt + (H - pt - pb) * (1 - f), stroke: 'currentColor', 'stroke-opacity': '.12' })));
  items.forEach((it, i) => {
    const bwh = Math.min(bw * (o.two ? .38 : .62), 42), x = pl + i * bw + bw / 2;
    const mk = (v, dx, cls) => { const hh = (H - pt - pb) * (v / mx); const r = sv('rect', { x: x + dx - bwh / 2, y: H - pb - hh, width: bwh, height: Math.max(hh, v > 0 ? 1.5 : 0), rx: 5, class: 'bar ' + (cls || '') }); r.append(sv('title', {}, `${it.label}: ${inr(v, 0)}`)); svg.append(r); };
    if (o.two) { mk(it.value, -bwh * .55, ''); mk(it.value2 || 0, bwh * .55, 'alt'); } else mk(it.value, 0, '');
    svg.append(sv('text', { x, y: H - 7, 'text-anchor': 'middle' }, it.label));
  });
  svg.append(sv('text', { x: W - pl, y: pt + 10, 'text-anchor': 'end' }, compact(mx)));
  return svg;
}

// ---------- files: CSV / XLSX out, CSV / XLSX in ----------
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
function zipStore(files) {
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
async function readXLSX(buf) {
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
async function readTable(file) {
  if (/\.xlsx$/i.test(file.name)) return readXLSX(await file.arrayBuffer());
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Save as .xlsx or .csv first');
  return parseCSV(await file.text());
}
function exportMenu(anchor, name, head, rows) {
  menu(anchor, [{ label: 'CSV file', icon: 'download', run: () => exportCSV(name, head, rows) }, { label: 'Excel (.xlsx)', icon: 'download', run: () => exportXLSX(name, head, rows) }, { label: 'Print or save as PDF', icon: 'print', run: () => printTable(name, head, rows) }]);
}
function printNode(node) {
  let ps = $('#printSheet'); if (!ps) { ps = h('div', { id: 'printSheet', class: 'print-only' }); document.body.append(ps); }
  clear(ps).append(node);
  setTimeout(() => window.print(), 60);
}
function printTable(title, head, rows) {
  printNode(h('div', null, h('h1', null, title), h('div', { class: 'small' }, (org().display_name || org().legal_name || '') + ' · printed ' + fmtDT(new Date())), h('div', { class: 'rule' }),
    h('table', null, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((v) => h('td', { class: typeof v === 'number' ? 'r' : '' }, typeof v === 'number' ? nf2.format(v) : v))))))));
}
