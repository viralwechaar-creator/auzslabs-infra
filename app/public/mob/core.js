/* AUZsMob: core. DOM helper, formatting, the Apple-HIG UI kit (same shape as Payroll/Accounting's own
   core.js -- see those for the convention; this is deliberately its own copy, not a shared module), and
   the offline-first sync engine (IndexedDB store `mob1` + an outbox, see sync.js). h() only ever sets
   textContent / attributes, never innerHTML, which is the XSS defence (icons are static strings). */
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
  cash: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/>',
  box: '<path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z"/><path d="M3 7.5V17l9 4.5V12M21 7.5V17l-9 4.5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 1-5 5L4 17l3 3 5.7-5.7a4 4 0 0 1 5-5l-3 3-2-2z"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="4" y="7" width="16" height="12" rx="2.5"/><path d="M16 13h2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>', chevL: '<path d="M15 5l-7 7 7 7"/>', chevD: '<path d="M5 9l7 7 7-7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  download: '<path d="M12 3v12M8 11l4 4 4-4M5 20h14"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>', edit: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.3v.2"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.5-3.6 3.2-5.5 7-5.5s6.5 1.9 7 5.5"/>',
  logout: '<path d="M15 17l5-5-5-5M20 12H8M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.6 15.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 3.6-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  apple: '<path fill="currentColor" stroke="none" d="M16.365 1.43c0 1.14-.46 2.1-1.17 2.83-.78.8-2.03 1.42-3.09 1.33-.12-1.1.46-2.25 1.15-2.97.78-.83 2.17-1.46 3.11-1.19ZM20.6 17.17c-.46 1.06-.68 1.53-1.27 2.47-.82 1.3-1.98 2.93-3.41 2.94-1.27.02-1.6-.83-3.33-.82-1.73.01-2.09.84-3.36.82-1.43-.02-2.53-1.48-3.35-2.78-2.3-3.63-2.54-7.89-1.12-10.16.99-1.6 2.56-2.54 4.03-2.54 1.5 0 2.44.84 3.68.84 1.2 0 1.93-.85 3.66-.85 1.32 0 2.71.72 3.7 1.96-3.25 1.78-2.72 6.42.77 8.12Z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.3"/><path d="M10.2 5h3.6"/><circle cx="12" cy="18.3" r=".6" fill="currentColor"/>',
  truck: '<rect x="2" y="7" width="12" height="9" rx="1.5"/><path d="M14 10h4l4 3.5V16h-8z"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8 7l1.6-2.5h4.8L16 7"/><circle cx="12" cy="13.5" r="3.5"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4M5 12v8h14v-8"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M17.5 17H6a4 4 0 0 1-1-7.87M9.3 7.3A5.5 5.5 0 0 1 19 10.5a4 4 0 0 1 1.3 7"/>',
  cloudCheck: '<path d="M7 17a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.8-1.2A4 4 0 0 1 17 17H7Z"/><path d="M9.5 13l2 2 3.5-3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};
function icon(name, size = 22) {
  const s = document.createElement('span');
  s.className = 'ic'; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${ICONS[name] || ICONS.box}</svg>`;
  return s;
}

// ---------- formatting ----------
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const N = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const inr = (n, dp) => { n = Number(n) || 0; if (dp === undefined) dp = Number.isInteger(n) ? 0 : 2; const s = (dp === 0 ? nf0 : nf2).format(Math.abs(n)); return (n < 0 ? '-₹' : '₹') + s; };
function money(n, opts = {}) { const v = Number(n) || 0; return h('span', { class: 'money num' + (opts.cls ? ' ' + opts.cls : '') }, inr(v, opts.dp)); }
const qty = (n) => { n = Number(n) || 0; return Number.isInteger(n) ? String(n) : String(r2(n)); };
const fmtDT = (s) => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (f, ms = 250) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => f(...a), ms); }; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
const isDesk = () => matchMedia('(min-width:900px)').matches;

// ---------- state ----------
const S = { ctx: null, perms: {}, user: null, dash: null, online: navigator.onLine, outboxCount: 0 };
const can = (k) => !!S.perms[k];

// ---------- toasts, alerts, menus, sheets (same convention as Payroll/Accounting) ----------
let toastEl;
function toast(msg, o = {}) {
  if (toastEl) toastEl.remove();
  toastEl = h('div', { class: 'toast' + (o.err ? ' err' : '') }, o.err ? icon('alert', 20) : icon('check', 20), msg);
  document.body.append(toastEl);
  const el = toastEl; setTimeout(() => el.remove(), o.err ? 6000 : 2600);
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
    const acts = o.actions || [{ label: o.confirm || 'OK', value: true, role: 'def' }, ...(o.cancel === false ? [] : [{ label: o.cancel || t('cancel'), value: false }])];
    const box = h('div', { class: 'alert' + (o.wide ? ' wide' : ''), role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
      h('div', { class: 'm' }, h('h3', null, o.title), o.message ? h('p', null, o.message) : null, o.body || null),
      h('div', { class: 'acts' }, acts.map((a) => h('button', { class: a.role || '', type: 'button', onclick: () => done(a.value) }, a.label))));
    document.body.append(scrim, box);
    const off = trap(box, () => done(false));
    scrim.onclick = () => done(false);
    (o.focus ? $(o.focus, box) : $('.def,button', box)).focus();
  });
}
const confirmBox = (title, message, confirm, danger = false) => alertBox({ title, message, actions: [{ label: confirm || t('save'), value: true, role: danger ? 'danger' : 'def' }, { label: t('cancel'), value: false }] });
function sheet(o) {
  const prev = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const close = (v) => { off(); scrim.remove(); el.remove(); prev && prev.focus && prev.focus(); o.onClose && o.onClose(v); };
  const closeBtn = h('button', { class: 'btn plain', type: 'button', onclick: () => close() }, o.closeLabel || t('cancel'));
  const body = h('div', { class: 'sheet-b' }, o.body);
  const foot = o.actions && o.actions.length ? h('div', { class: 'sheet-f' }, o.actions.filter(Boolean).map((a) => h('button', { class: 'btn ' + (a.primary ? 'fill ' : '') + (a.danger ? 'danger ' : ''), type: 'button', onclick: async (ev) => {
    if (a.onclick) { const b = ev.currentTarget; b.disabled = true; try { const r = await a.onclick(close); if (r === false) b.disabled = false; } catch (e) { b.disabled = false; fail(e); } }
  } }, a.label))) : null;
  const el = h('div', { class: 'sheet' + (o.full ? ' full' : '') + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, h('div', { class: 'sheet-h' }, closeBtn, h('h2', null, o.title), h('span', { style: { minWidth: '64px' } })), body, foot);
  document.body.append(scrim, el);
  const off = trap(el, () => close());
  scrim.onclick = () => close();
  setTimeout(() => ($('[autofocus]', body) || $('input:not([type=hidden]):not([type=checkbox]),select,textarea', body) || closeBtn).focus(), 60);
  return { close, el, body };
}
function menu(anchor, items) {
  closeMenus();
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => it === '-' ? h('hr') :
    h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', onclick: () => { closeMenus(); it.run(); } }, it.icon ? icon(it.icon, 20) : null, it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + 'px';
  m.style.top = (r.bottom + 6 + mh > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenus(); }
  m._off = () => document.removeEventListener('pointerdown', outside, true);
}
function closeMenus() { $$('.menu').forEach((m) => { m._off && m._off(); m.remove(); }); }

// ---------- components ----------
function badge(text, tone) { return h('span', { class: 'badge ' + (tone || '') }, text); }
function seg(options, value, onChange, o = {}) {
  const el = h('div', { class: 'seg' + (o.full ? ' full' : ''), role: 'tablist', 'aria-label': o.label || 'View' });
  const set = (v) => { $$('button', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === String(v)))); };
  options.forEach(([v, label]) => el.append(h('button', { type: 'button', role: 'tab', 'data-v': v, 'aria-selected': String(v === value), onclick: () => { set(v); onChange(v); } }, label)));
  return el;
}
function field(label, control, hint) { const id = 'f' + Math.random().toString(36).slice(2, 8); if (control.setAttribute && !control.id) control.id = id; return h('div', { class: 'field' }, h('label', { for: control.id || id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null); }
function input(o = {}) { return h('input', { class: 'input' + (o.cls ? ' ' + o.cls : ''), type: o.type || 'text', placeholder: o.placeholder || '', value: o.value ?? '', inputmode: o.mode, autocomplete: o.auto || 'off', maxlength: o.max, min: o.min, step: o.step, required: o.required, 'aria-label': o.label, oninput: o.oninput, onchange: o.onchange, autofocus: o.autofocus }); }
function selectEl(options, value, o = {}) {
  const s = h('select', { class: 'select' + (o.cls ? ' ' + o.cls : ''), 'aria-label': o.label, onchange: o.onchange });
  options.forEach((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; s.append(h('option', { value: v, selected: String(v) === String(value) }, l)); });
  if (value != null) s.value = value;
  return s;
}
function searchField(placeholder, onInput, value = '') {
  const i = h('input', { class: 'input', type: 'search', placeholder, value, 'aria-label': placeholder, autocomplete: 'off', oninput: () => { cl.classList.toggle('hidden', !i.value); onInput(i.value); } });
  const cl = h('button', { class: 'clear' + (value ? '' : ' hidden'), type: 'button', 'aria-label': 'Clear', onclick: () => { i.value = ''; cl.classList.add('hidden'); onInput(''); i.focus(); } }, icon('x', 16));
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
    o.badge || null, o.right || null, o.onclick || o.chevron ? h('span', { class: 'chev' }, icon('chevR', 18)) : null];
  return o.onclick ? h('button', { class: 'li' + (o.sel ? ' sel' : ''), type: 'button', onclick: o.onclick }, inner) : h('div', { class: 'li' }, inner);
}
function section(title, ...kids) { return h('div', { class: 'sec' }, title ? h('div', { class: 'sec-h' }, typeof title === 'string' ? h('h3', null, title) : title) : null, ...kids); }
function dataView(columns, rows, o = {}) {
  if (!rows.length) return o.empty || empty('box', t('noneYet'), o.emptyText);
  const wrap = h('div');
  const cellVal = (c, r) => c.render ? c.render(r) : (r[c.key] ?? '');
  const paint = () => {
    clear(wrap);
    if (isDesk() && !o.listOnly) {
      const cols = columns.filter((c) => !c.hideDesk);
      const thead = h('tr', null, cols.map((c) => h('th', { class: c.r ? 'r' : '' }, c.label)));
      const tbody = h('tbody', null, rows.map((r) => h('tr', { class: o.onRow ? 'click' : '', onclick: (e) => { if (!e.target.closest('input,button,a,select')) o.onRow && o.onRow(r); } },
        cols.map((c) => h('td', { class: c.r ? 'r' : '' }, cellVal(c, r))))));
      wrap.append(h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, thead), tbody))));
    } else {
      const T = columns.find((c) => c.title) || columns[0], Sb = columns.find((c) => c.sub), V = columns.find((c) => c.value), B = columns.find((c) => c.badge);
      wrap.append(h('div', { class: 'list' }, rows.map((r) => h(o.onRow ? 'button' : 'div', { class: 'li', type: o.onRow ? 'button' : null, onclick: o.onRow ? () => o.onRow(r) : null },
        h('div', { class: 'grow' }, h('div', { class: 't' }, cellVal(T, r)), Sb ? h('div', { class: 's' }, cellVal(Sb, r)) : null),
        h('div', { class: 'v' }, V ? h('div', { class: 't' }, cellVal(V, r)) : null, B ? h('div', { style: { marginTop: '3px' } }, cellVal(B, r)) : null),
        o.onRow ? h('span', { class: 'chev' }, icon('chevR', 18)) : null))));
    }
  };
  paint();
  window.addEventListener('resize', wrap._rs = debounce(() => { if (wrap.isConnected) paint(); else window.removeEventListener('resize', wrap._rs); }, 150));
  return wrap;
}
function banner(tone, ic, ...kids) { return h('div', { class: 'banner ' + (tone || '') }, icon(ic || 'info', 20), h('div', { class: 'grow' }, ...kids)); }
