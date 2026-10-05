/* Staff sign in with a username + PIN (db/096). Shared by every staff app's login screen:
   auzStaffPinForm(sb, onDone) returns a ready-made form element; onDone() runs after a successful sign in.
   Plain DOM on purpose (each app has its own h() helper); uses the shared `input` / `btn fill wide` classes. */
window.auzStaffPinForm = function (sb, onDone) {
  function el(tag, props, kids) {
    const n = document.createElement(tag);
    Object.keys(props || {}).forEach((k) => { if (k === 'style') n.style.cssText = props[k]; else n.setAttribute(k, props[k]); });
    (kids || []).forEach((c) => n.append(c));
    return n;
  }
  const user = el('input', { class: 'input', type: 'text', placeholder: 'Username, e.g. ravi.yourshop', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Staff username' });
  const pin = el('input', { class: 'input', type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: 'PIN', autocomplete: 'current-password', 'aria-label': 'PIN' });
  const msg = el('div', { role: 'alert', style: 'min-height:18px;font-size:13px' });
  const btn = el('button', { type: 'button', class: 'btn fill wide' }, ['Continue']);
  const note = el('div', { style: 'font-size:12.5px;opacity:.7' }, ['Your owner gave you a username and PIN. No email needed.']);
  async function go() {
    msg.style.color = ''; msg.textContent = '';
    const u = user.value.trim(), p = pin.value.trim();
    if (!u || !/^\d{4,6}$/.test(p)) { msg.style.color = '#c2183f'; msg.textContent = 'Enter your username and your 4 or 6 digit PIN.'; return; }
    btn.disabled = true;
    try {
      const { error } = await sb.auth.signInWithStaffPin(u, p);
      if (error) { msg.style.color = '#c2183f'; msg.textContent = error.message || 'Wrong username or PIN'; pin.value = ''; return; }
      onDone();
    } finally { btn.disabled = false; }
  }
  btn.onclick = go;
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  user.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pin.focus(); } });
  return el('div', { style: 'display:none;gap:10px' }, [user, pin, btn, note, msg]);
};
