/* AUZslab SalesOS: core. DOM helper, formatting, API, state, and the Apple-HIG UI kit (sheets,
   alerts, menus, segmented controls, lists). Same kit as Payroll/Accounting/AUZsMob, trimmed to
   what SalesOS needs. Plain script, no build step. h() only ever sets textContent/attributes,
   never innerHTML (icons are static strings), which is the XSS defence. */
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
  /* home/pin/target/chat double as the bottom nav's Home/Field/Leads/Messages glyphs (and, since
     each page's own icon is reused in the sidebar and in related list rows, everywhere else that
     names the same concept) -- redrawn slightly more geometric/rounded than a bare outline, same
     single-stroke, no-fill, 1.7 stroke-width convention as the rest of the icon set. */
  home: '<path d="M4 11.5 12 4.2l8 7.3"/><path d="M6.4 11V20H10V15.6A1.8 1.8 0 0 1 13.6 15.6V20H17.6V11"/>',
  pin: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4 15 12l-3 4.6-3-4.6Z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.1"/><path d="M12 2.5v3.3M12 18.2v3.3M2.5 12h3.3M18.2 12h3.3"/>',
  survey: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h8M9 13h8M9 17h5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="4" y="7" width="16" height="12" rx="2.5"/><path d="M16 13h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checksq: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 11l2.5 2.5L16 8.5"/>',
  chat: '<path d="M4 5h16v10H10l-6 4.5Z"/><circle cx="9" cy="10" r=".55" fill="currentColor"/><circle cx="12" cy="10" r=".55" fill="currentColor"/><circle cx="15" cy="10" r=".55" fill="currentColor"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.4-3.2 2.8-5 6-5s5.6 1.8 6 5"/><path d="M16 5a3 3 0 0 1 0 6M18 15c1.8.6 3 2 3.2 5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.5-3.6 3.2-5.5 7-5.5s6.5 1.9 7 5.5"/>',
  log: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>', chevL: '<path d="M15 5l-7 7 7 7"/>', chevD: '<path d="M5 9l7 7 7-7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  logout: '<path d="M15 17l5-5-5-5M20 12H8M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  camera: '<path d="M5 8h2l1.5-2h7L17 8h2a2 2 0 0 1 2 2v9H3v-9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13.5" r="3.5"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5h6v2M3 12h18"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  rupee: '<path d="M7 5h10M7 9h10M9.5 5c3 0 4.5 1.6 4.5 4s-1.5 4-4.5 4H7l8 6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.6 15.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 3.6-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
};
function icon(name, size = 22) {
  const s = document.createElement('span');
  s.className = 'ic'; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${ICONS[name] || ICONS.doc || ''}</svg>`;
  return s;
}

// ---------- formatting ----------
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr = (n, dp) => { n = Number(n) || 0; if (dp === undefined) dp = Number.isInteger(n) ? 0 : 2; const s = (dp === 0 ? nf0 : nf2).format(Math.abs(n)); return (n < 0 ? '-₹' : '₹') + s; };
function money(n) { return h('span', { class: 'num' }, inr(n)); }
const cap1 = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (f, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const fmtT = (iso) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const relTime = (iso) => { if (!iso) return ''; const d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + 'm ago'; if (d < 86400) return Math.floor(d / 3600) + 'h ago'; return fmtD(iso); };

// ---------- API ----------
let busy = 0;
async function api(fn, args) {
  busy++; document.documentElement.setAttribute('aria-busy', 'true');
  try {
    let r;
    try { r = await sb.rpc(fn, args || {}); } catch (e) { throw new Error(navigator.onLine === false ? 'You are offline. SalesOS needs a connection.' : 'Could not reach the server. Check your connection and try again.'); }
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
async function uploadExpenseReceipt(expenseId, file) {
  if (file.size > 6e6) throw new Error('Receipts can be up to 6 MB');
  await apiFile('/storage/sos-expense-receipt/' + expenseId, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
}
async function openExpenseReceipt(expenseId) { const res = await apiFile('/storage/sos-expense-receipt/' + expenseId); const b = await res.blob(); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }
async function uploadStaffDoc(docId, file) {
  if (file.size > 10e6) throw new Error('Files can be up to 10 MB');
  await apiFile('/storage/sos-staff-doc/' + docId, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
}
async function openStaffDoc(docId) { const res = await apiFile('/storage/sos-staff-doc/' + docId); const b = await res.blob(); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }

// ---------- state ----------
const S = { dash: null, user: null };
const canField = () => S.user && (S.user.role === 'Sales Executive' || S.user.role === 'owner');
const canManage = () => S.user && (S.user.role === 'Sales Manager' || S.user.role === 'Admin' || S.user.role === 'owner');

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
function avatar(name, size = 36) {
  const hue = [...String(name || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  return h('span', { class: 'av', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * .38) + 'px', background: `hsl(${hue} 34% 88%)`, color: `hsl(${hue} 40% 28%)` }, 'aria-hidden': 'true' }, initials(name));
}
function seg(options, value, onChange, o = {}) {
  const el = h('div', { class: 'seg' + (o.full ? ' full' : ''), role: 'tablist', 'aria-label': o.label || 'View' });
  const set = (v) => { $$('button', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === String(v)))); };
  options.forEach(([v, label]) => el.append(h('button', { type: 'button', role: 'tab', 'data-v': v, 'aria-selected': String(v === value), onclick: () => { set(v); onChange(v); } }, label)));
  return el;
}
function field(label, control, hint) { const id = 'f' + Math.random().toString(36).slice(2, 8); if (control.setAttribute && !control.id) control.id = id; return h('div', { class: 'field' }, h('label', { for: control.id || id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null); }
function input(o = {}) { return h('input', { class: 'input' + (o.cls ? ' ' + o.cls : ''), type: o.type || 'text', placeholder: o.placeholder || '', value: o.value ?? '', inputmode: o.mode, autocomplete: o.auto || 'off', maxlength: o.max, min: o.min, step: o.step, required: o.required, 'aria-label': o.label, oninput: o.oninput, onchange: o.onchange, onkeydown: o.onkeydown, autofocus: o.autofocus }); }
function selectEl(options, value, o = {}) {
  const s = h('select', { class: 'select' + (o.cls ? ' ' + o.cls : ''), 'aria-label': o.label, onchange: o.onchange });
  options.forEach((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; s.append(h('option', { value: v, selected: String(v) === String(value) }, l)); });
  if (value != null) s.value = value;
  return s;
}
function empty(ic, title, text, action) { return h('div', { class: 'empty' }, h('div', { class: 'ic' }, icon(ic, 28)), h('h3', null, title), text ? h('p', null, text) : null, action || null); }
function kpi(label, value, sub, onclick) {
  const inner = [h('div', { class: 'k' }, label), h('div', { class: 'n num' }, value), sub ? h('div', { class: 'd' }, sub) : null];
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

// Floating glass search pill (Apple "Liquid Glass"): a sticky, blurred, rounded bar that filters
// a list live as the person types. onInput receives the trimmed, lowercased query on every
// keystroke (debounced by the caller if the filter is expensive).
function glassSearch(placeholder, onInput) {
  const i = h('input', { type: 'search', placeholder, 'aria-label': placeholder, autocomplete: 'off', oninput: () => onInput(i.value.trim().toLowerCase()) });
  return h('div', { class: 'glass-search' }, icon('search', 18), i);
}
