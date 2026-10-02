/* AUZslab POS interface kit (Apple HIG): sheets, alerts, toasts, segmented controls, steppers, keypad,
   manager approval with a PIN. No browser prompt()/confirm()/alert() anywhere in the POS. */
'use strict';
let toastT = null;
function toast(msg, o = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove()); clearTimeout(toastT);
  const t = h('div', { class: 'toast' + (o.err ? ' err' : ''), role: 'status' }, o.err ? icon('alert', 18) : icon('check', 18), msg);
  document.body.append(t); toastT = setTimeout(() => t.remove(), o.ms || (o.err ? 4200 : 2200));
}

const SHEETS = [];
// A sheet: bottom sheet on phones, centred card on desktop. actions: [{label, primary, danger, run(close) -> false keeps it open}]
function sheet({ title, body, actions, wide, narrow, full, closeLabel = 'Done', onClose, persist, cls } = {}) {
  const ov = h('div', { class: 'ov', onclick: (e) => { if (e.target === ov && !persist) close(); } });
  const bodyEl = h('div', { class: 'md-b' }, body);
  const foot = actions && actions.length ? h('div', { class: 'md-f' }) : null;
  const md = h('div', { class: 'md' + (wide ? ' wide' : '') + (narrow ? ' narrow' : '') + (full ? ' full' : '') + (cls ? ' ' + cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    h('div', { class: 'md-h' }, h('div', { class: 'title' }, title || ''), closeLabel ? h('button', { class: 'btn plain', onclick: () => close() }, closeLabel) : null), bodyEl, foot);
  let closed = false;
  function close(v) {
    if (closed) return; closed = true; const i = SHEETS.indexOf(api); if (i >= 0) SHEETS.splice(i, 1);
    ov.classList.add('closing'); setTimeout(() => ov.remove(), 230); onClose && onClose(v);
  }
  const api = { el: md, body: bodyEl, close, foot, setBody: (...k) => bodyEl.replaceChildren(...k.flat(9).filter((x) => x != null && x !== false)) };
  if (foot) foot.append(...actions.filter(Boolean).map((a) => {
    const b = h('button', { class: 'btn lg' + (a.primary ? ' fill' : '') + (a.danger ? ' danger' + (a.primary ? ' fill' : '') : '') + (a.cls ? ' ' + a.cls : ''), disabled: a.disabled, onclick: async () => {
      b.disabled = true;
      try { const r = await a.run(close, api); if (r !== false) close(); } catch (e) { toast(e.message || String(e), { err: true }); }
      b.disabled = false;
    } }, a.icon ? icon(a.icon, 18) : null, a.label);
    a.el = b; return b;
  }));
  ov.append(md); document.body.append(ov); SHEETS.push(api);
  setTimeout(() => { const f = md.querySelector('[autofocus]'); if (f && matchMedia('(hover:hover)').matches) f.focus(); }, 60);
  return api;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && SHEETS.length && !document.querySelector('.alert')) SHEETS[SHEETS.length - 1].close(); });

// alert / confirm / prompt as HIG alerts (centred, short, two or three buttons)
function alertBox({ title, msg, buttons = [{ label: 'OK', value: true, def: true }], input, vertical }) {
  return new Promise((res) => {
    const ov = h('div', { class: 'ov', style: { alignItems: 'center', padding: '24px' } });
    const inp = input ? h('input', { class: 'input', type: input.type || 'text', inputmode: input.mode, placeholder: input.placeholder || '', value: input.value ?? '', autocomplete: 'off', onkeydown: (e) => { if (e.key === 'Enter') done(buttons.find((b) => b.def)); } }) : null;
    const done = (b) => { ov.remove(); res(b && b.value === '__input' ? inp.value : b ? b.value : null); };
    ov.append(h('div', { class: 'alert', role: 'alertdialog' }, h('div', { class: 'ab' }, h('b', null, title), msg ? h('p', null, msg) : null, inp),
      h('div', { class: 'af' + (vertical || buttons.length > 2 ? ' v' : '') }, buttons.map((b) => h('button', { class: (b.def ? 'def' : '') + (b.dest ? ' dest' : ''), onclick: () => done(b) }, b.label)))));
    document.body.append(ov); if (inp) setTimeout(() => inp.focus(), 50);
  });
}
const confirmBox = (title, msg, ok = 'OK', dest = false) => alertBox({ title, msg, buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, def: !dest, dest }] });
const promptBox = (title, o = {}) => alertBox({ title, msg: o.msg, input: o, buttons: [{ label: 'Cancel', value: null }, { label: o.ok || 'OK', value: '__input', def: true }] });
const info = (title, msg) => alertBox({ title, msg });

// controls
function seg(options, cur, onChange, cls) {
  const el = h('div', { class: 'seg' + (cls ? ' ' + cls : ''), role: 'tablist' });
  const draw = (v) => el.replaceChildren(...options.map(([val, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(val === v), class: val === v ? 'on' : '', onclick: () => { draw(val); onChange(val); } }, label)));
  draw(cur); return el;
}
function stepper(v, onChange, min = 0, max = 999) {
  const b = h('b', null, String(v));
  const set = (n) => { n = Math.max(min, Math.min(max, n)); b.textContent = String(n); onChange(n); };
  return h('span', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'Less', onclick: (e) => { e.stopPropagation(); set(+b.textContent - 1); } }, icon('minus', 18)), b,
    h('button', { type: 'button', 'aria-label': 'More', onclick: (e) => { e.stopPropagation(); set(+b.textContent + 1); } }, icon('plus', 18)));
}
const input = (o = {}) => h('input', { class: 'input', type: o.type || 'text', inputmode: o.mode, placeholder: o.placeholder || '', value: o.value ?? '', maxlength: o.max, min: o.min, step: o.step, autocomplete: o.auto || 'off', 'aria-label': o.label || o.placeholder, autofocus: o.focus, oninput: o.oninput, onchange: o.onchange, onkeydown: o.onkeydown });
const textarea = (o = {}) => h('textarea', { class: 'textarea', placeholder: o.placeholder || '', 'aria-label': o.label || o.placeholder }, o.value || '');
const selectEl = (opts, val, onchange) => h('select', { class: 'select', value: val, onchange }, opts.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));
const field = (label, el, hint) => h('div', { class: 'field' }, h('label', null, label), el, hint ? h('div', { class: 'hint' }, hint) : null);
function switchEl(on, onChange) { const i = h('input', { type: 'checkbox', checked: on, role: 'switch', onchange: () => onChange(i.checked) }); return h('span', { class: 'switch' }, i, h('i')); }
function liRow({ ic, tone, title, sub, value, chev, onclick, cls, right }) {
  return h(onclick ? 'button' : 'div', { class: 'li' + (ic ? ' ico' : '') + (cls ? ' ' + cls : ''), type: onclick ? 'button' : null, onclick },
    ic ? h('span', { class: 'ic' + (tone ? ' ' + tone : '') }, icon(ic, 18)) : null,
    h('div', { class: 'grow' }, h('div', { class: 't' }, title), sub ? h('div', { class: 's' }, sub) : null),
    value != null ? h('div', { class: 'v' }, value) : null, right || null, chev ? h('span', { class: 'chev' }, icon('chev', 16)) : null);
}
const empty = (ic, title, text, action) => h('div', { class: 'empty' }, icon(ic, 44, 1.4), h('b', null, title), text ? h('div', null, text) : null, action || null);
const pill = (txt, tone) => h('span', { class: 'pill' + (tone ? ' ' + tone : '') }, txt);

// pick one reason (Back office -> Settings -> Reasons), or type another
function pickReason(title = 'Reason') {
  return new Promise((res) => {
    const reasons = L('reason').map((r) => r.name).filter(Boolean);
    let done = false;
    const s = sheet({ title, narrow: true, closeLabel: 'Cancel', onClose: () => { if (!done) res(null); }, body: h('div', { class: 'list' },
      ...reasons.map((r) => liRow({ title: r, chev: true, onclick: () => { done = true; s.close(); res(r); } })),
      liRow({ title: 'Other reason…', chev: true, onclick: async () => { const v = await promptBox('Reason', { placeholder: 'Type a reason' }); if (v && v.trim()) { done = true; s.close(); res(v.trim()); } } })) });
  });
}

// numeric keypad
function keypad(onKey, opts = {}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', opts.dot ? '.' : '', '0', '⌫'];
  return h('div', { class: 'keypad' }, keys.map((k) => (k === '' ? h('span') : h('button', { type: 'button', class: k === '⌫' ? 'k-fn' : '', 'aria-label': k === '⌫' ? 'Delete' : k, onclick: () => onKey(k) }, k))));
}

// Manager approval. An owner/manager approves their own action; a cashier needs a manager to type their PIN on this till.
// The server returns an approval signed for this one action on this one record (db/068 pos_verify_pin).
const APPROVE_LABEL = { discount: 'Approve discount', void: 'Approve cancellation', refund: 'Approve refund', cancel: 'Approve item cancellation', comp: 'Approve complimentary bill', credit: 'Approve credit bill', return: 'Approve return', price: 'Approve price change' };
async function selfApproval(action, ref) {
  // signed when online, so a bill a manager approved here can be closed by a cashier on another till
  if (navigator.onLine) { try { const { data, error } = await sb.rpc('pos_sign_approval', { p_action: action, p_ref: ref }); if (!error && data && data.ok) return { id: data.id, name: data.name, action, exp: data.exp, token: data.token }; } catch {} }
  return { id: S.user.id, name: myName(), action, self: true };
}
function approve(action, ref, detail) {
  if (can('m')) return selfApproval(action, ref);
  return new Promise((res) => {
    let pin = '', done = false, busyV = false;
    // with no approver PIN on the business yet, say so instead of letting every PIN look wrong
    const hintText = () => (S.pinStatus && !S.pinStatus.approvers ? 'No manager has an approval PIN yet. The owner sets one in Staff & settings.' : detail || 'A manager types their approval PIN.');
    const dots = h('div', { class: 'pin-dots' }), msg = h('div', { class: 'hint', style: { textAlign: 'center', minHeight: '18px' } }, hintText());
    const draw = () => dots.replaceChildren(...[0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map((i) => h('i', { class: i < pin.length ? 'on' : '' })));
    const s = sheet({ title: APPROVE_LABEL[action] || 'Manager approval', narrow: true, closeLabel: 'Cancel', onClose: () => { if (!done) res(null); },
      body: h('div', { class: 'stack s20', style: { padding: '8px 0' } }, h('div', { style: { textAlign: 'center' } }, icon('lock', 34, 1.5), h('div', { class: 'sub', style: { marginTop: '6px' } }, 'Manager PIN')), dots, msg,
        keypad(async (k) => {
          if (busyV) return;
          if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 8) pin += k;
          draw(); msg.className = 'hint'; msg.textContent = hintText();
        }),
        h('button', { class: 'btn fill lg wide', onclick: async () => {
          if (pin.length < 4) { msg.textContent = 'Enter at least 4 digits'; return; }
          if (!navigator.onLine) { msg.className = 'hint err'; msg.textContent = 'Approvals need an internet connection. Ask a manager to sign in on this till.'; return; }
          busyV = true; msg.textContent = 'Checking…';
          const { data, error } = await sb.rpc('pos_verify_pin', { p_pin: pin, p_action: action, p_ref: ref });
          busyV = false;
          if (error) { msg.className = 'hint err'; msg.textContent = error.message; pin = ''; draw(); return; }
          if (!data || !data.ok) { msg.className = 'hint err'; msg.textContent = 'That PIN is not right'; dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); pin = ''; draw(); return; }
          done = true; s.close(); toast('Approved by ' + data.name);
          res({ id: data.id, name: data.name, action, exp: data.exp, token: data.token });
        } }, 'Approve')) });
    draw();
    if (S.pinStatus && !S.pinStatus.approvers) loadPinStatus().then(() => { if (!pin && !done) msg.textContent = hintText(); });
  });
}
