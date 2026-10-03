/* AUZslab Payroll: shell (sign in, navigation by role, router, search). Pages register themselves with page().
   Two audiences share one app: people who run HR and payroll (owner, managers, custom roles with pay_* rights) and
   every employee for their own day, leave and pay (self-service). Someone can be both; the menu shows what they may use. */
'use strict';
const PAGES = {};
const page = (id, def) => { PAGES[id] = def; };
const NAV_HR = [
  { group: '', items: ['home'] },
  { group: 'People', items: ['people', 'time', 'leave'] },
  { group: 'Pay', items: ['pay', 'loans', 'claims', 'compliance'] },
  { group: 'More', items: ['reports', 'settings'] },
];
const NAV_ME = [{ group: 'For me', items: ['today', 'my-time', 'my-leave', 'my-pay', 'my-profile', 'team'] }];
let route = { id: 'home', args: [], q: new URLSearchParams() };
let cleanup = [];

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { id: parts[0] || homeId(), args: parts.slice(1), q: new URLSearchParams(qs || '') };
}
const homeId = () => (isHR() ? 'home' : 'today');
const go = (path) => { const t = '#/' + path.replace(/^#?\/?/, ''); if (location.hash === t) route_(); else location.hash = t; };
const back = (fallback) => { if (history.length > 2) history.back(); else go(fallback || homeId()); };
// may this person open the page?
function allowed(def) {
  if (!def) return false;
  if (def.any) return true;
  if (def.ess) return !!(S.ctx && S.ctx.me) && (!def.manager || S.ctx.is_manager || (S.me && S.me.is_manager));
  if (!isHR()) return false;
  if (typeof def.perm === 'function') return def.perm();
  return !def.perm || can(def.perm);
}

// ---------- sign in / boot ----------
// Google/Apple/phone sign-in (db/069) alongside email+password -- phone has
// to be here too: a staff member who only ever signed up by phone has no
// password and no email of their own to fall back on.
function showLogin(msg) {
  const e = h('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' });
  const p = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const m = h('div', { class: 'small', role: 'alert', style: { color: 'var(--red)', minHeight: '18px' } }, msg || '');
  const btn = h('button', { class: 'btn fill wide', type: 'submit' }, 'Sign in');

  const eyeBtn = h('button', { type: 'button', class: 'btn icon plain', 'aria-label': 'Show password', style: { position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)' } }, icon('eye', 18));
  eyeBtn.onclick = () => { const showing = p.type === 'text'; p.type = showing ? 'password' : 'text'; eyeBtn.replaceChildren(icon(showing ? 'eye' : 'eyeOff', 18)); };
  const pwWrap = h('div', { style: { position: 'relative' } }, p, eyeBtn);

  const forgotBtn = h('button', { type: 'button', class: 'btn plain small', style: { justifySelf: 'end', color: 'var(--red)', fontWeight: '700' } }, 'Forgot password?');
  forgotBtn.onclick = async () => {
    const email = e.value.trim();
    if (!email) { m.textContent = 'Enter your email above first.'; return; }
    m.style.color = ''; m.textContent = 'Sending…';
    const { error } = await sb.auth.forgotPassword(email, 'https://auzslab.in/signup.html');
    m.style.color = error ? 'var(--red)' : ''; m.textContent = error ? error.message : 'If that email has an account, a reset link is on its way.';
  };
  const emailWrap = h('div', { style: { display: 'grid', gap: '10px' } }, e, pwWrap, forgotBtn);

  const phoneNum = h('input', { class: 'input', type: 'tel', placeholder: '+91 98765 43210', autocomplete: 'tel', 'aria-label': 'Phone number' });
  const phoneCode = h('input', { class: 'input', type: 'text', placeholder: '6-digit code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' });
  const verifyBtn = h('button', { type: 'button', class: 'btn fill wide' }, 'Verify & continue');
  verifyBtn.onclick = async () => {
    m.style.color = ''; m.textContent = 'Verifying…';
    const { error } = await sb.auth.verifyPhoneOtp(phoneNum.value.trim(), phoneCode.value.trim());
    if (error) { m.style.color = 'var(--red)'; m.textContent = error.message; return; }
    boot();
  };
  const codeStep = h('div', { style: { display: 'none', gap: '10px' } }, phoneCode, verifyBtn);
  const sendCodeBtn = h('button', { type: 'button', class: 'btn fill wide' }, 'Send code');
  sendCodeBtn.onclick = async () => {
    const phone = phoneNum.value.trim();
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) { m.style.color = 'var(--red)'; m.textContent = 'Enter your number with a country code, e.g. +91 98765 43210.'; return; }
    m.style.color = ''; m.textContent = 'Sending…';
    const { data, error } = await sb.auth.sendPhoneOtp(phone);
    if (error) { m.style.color = 'var(--red)'; m.textContent = error.message; return; }
    if (data && data.sent === false) { m.style.color = 'var(--red)'; m.textContent = data.reason || 'Could not send a code right now.'; return; }
    m.style.color = ''; m.textContent = ''; codeStep.style.display = 'grid'; sendCodeBtn.textContent = 'Resend code';
  };
  const phoneWrap = h('div', { style: { display: 'none', gap: '10px' } }, phoneNum, sendCodeBtn, codeStep);

  const methodEmailBtn = h('button', { type: 'button', 'aria-selected': 'true' }, 'Email');
  const methodPhoneBtn = h('button', { type: 'button', 'aria-selected': 'false' }, 'Phone');
  const setMethod = (which) => {
    emailWrap.style.display = which === 'email' ? 'grid' : 'none';
    phoneWrap.style.display = which === 'phone' ? 'grid' : 'none';
    methodEmailBtn.setAttribute('aria-selected', String(which === 'email'));
    methodPhoneBtn.setAttribute('aria-selected', String(which === 'phone'));
    m.style.color = ''; m.textContent = '';
  };
  methodEmailBtn.onclick = () => setMethod('email');
  methodPhoneBtn.onclick = () => setMethod('phone');
  const methodRow = h('div', { class: 'seg full' }, methodEmailBtn, methodPhoneBtn);

  const googleHost = h('div');
  const appleBtn = h('button', { type: 'button', class: 'btn wide', style: { display: 'none', gap: '8px' } }, icon('apple', 18), 'Continue with Apple');
  const socialDivider = h('div', { class: 'small muted', style: { display: 'none', textAlign: 'center' } }, 'or');
  const socialWrap = h('div', { style: { display: 'none', gap: '10px' } }, googleHost, appleBtn);

  btn.onclick = async (ev) => {
    ev.preventDefault(); btn.disabled = true; m.textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: e.value.trim(), password: p.value });
    btn.disabled = false;
    if (error) { m.style.color = 'var(--red)'; m.textContent = error.message; } else boot();
  };
  emailWrap.append(btn);

  const form = h('form', { class: 'card', onsubmit: (ev) => ev.preventDefault() },
    h('img', { src: '/logo-payroll.svg', alt: 'AUZslab Payroll' }), h('h1', null, 'Sign in'), h('p', { class: 'muted' }, 'Use your AUZslab login. Staff use the login their employer gave them.'),
    socialWrap, socialDivider, methodRow, emailWrap, phoneWrap, m);
  clear($('#app')).append(h('div', { class: 'login' }, form));
  e.focus();

  if (CFG.googleClientId && !document.getElementById('gsiScript')) {
    const gs = document.createElement('script'); gs.id = 'gsiScript'; gs.src = 'https://accounts.google.com/gsi/client'; gs.async = true; gs.defer = true;
    document.head.appendChild(gs);
  }
  if (CFG.googleClientId) {
    const initG = () => {
      if (!window.google) return setTimeout(initG, 50);
      socialWrap.style.display = 'grid'; socialDivider.style.display = 'block';
      google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: async (resp) => {
        m.style.color = ''; m.textContent = 'Signing in…';
        const { error } = await sb.auth.signInWithGoogle(resp.credential);
        if (error) { m.style.color = 'var(--red)'; m.textContent = error.message; return; }
        boot();
      } });
      google.accounts.id.renderButton(googleHost, { theme: 'outline', size: 'large', width: 332 });
    };
    initG();
  }
  if (CFG.appleClientId && !document.getElementById('appleSdkScript')) {
    const as = document.createElement('script'); as.id = 'appleSdkScript'; as.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
    document.head.appendChild(as);
  }
  if (CFG.appleClientId) {
    const initA = () => {
      if (!window.AppleID) return setTimeout(initA, 50);
      socialWrap.style.display = 'grid'; socialDivider.style.display = 'block'; appleBtn.style.display = 'flex';
      AppleID.auth.init({ clientId: CFG.appleClientId, scope: 'email name', redirectURI: location.origin + '/payroll.html', usePopup: true });
      appleBtn.onclick = async () => {
        try {
          const resp = await AppleID.auth.signIn();
          m.style.color = ''; m.textContent = 'Signing in…';
          const { error } = await sb.auth.signInWithApple(resp.authorization.code);
          if (error) { m.style.color = 'var(--red)'; m.textContent = error.message; return; }
          boot();
        } catch (err) { if (err && err.error === 'popup_closed_by_user') return; m.style.color = 'var(--red)'; m.textContent = 'Apple sign-in failed.'; }
      };
    };
    initA();
  }
}
function blocked(title, text) {
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'card' }, h('img', { src: '/logo-payroll.svg', alt: 'AUZslab Payroll' }), h('h1', null, title), h('p', { class: 'muted' }, text),
    h('button', { class: 'btn wide', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sign out'))));
}
async function boot() {
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'spin', style: { color: 'var(--tint)', width: '28px', height: '28px' } })));
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  let dash;
  try { dash = await api('my_dashboard'); } catch (e) { if (e.status === 401) return showLogin('Your session ended. Please sign in again.'); return blocked('Could not load', e.message); }
  const slug = window.TENANT_SLUG;
  if (slug && dash.tenant && dash.tenant.slug !== slug) { await sb.auth.signOut(); return showLogin('This login belongs to a different business (' + dash.tenant.slug + '.auzslab.in). Sign in at your own business link.'); }
  if (!(dash.features || {}).payroll || (dash.enabled_features || {}).payroll === false) return blocked('Payroll is not switched on', 'AUZslab Payroll is not part of this business’s plan. The owner can add it from the account page.');
  S.user = { email: dash.my_email, role: dash.my_role }; S.dash = dash;
  try { await loadCtx(); } catch (e) { return blocked('Could not open Payroll', e.message); }
  if (S.ctx.no_access) return blocked('Your login is not linked yet', 'Ask your manager to open Payroll, find your name under People and link this login (' + (S.user.email || '') + ') to it. Then sign in again.');
  if (window.auzBrandLoad) auzBrandLoad(sb);
  buildShell();
  window.addEventListener('hashchange', route_);
  route_();
  if (isHR() && can('pay_admin') && !org().setup_done && !sessionStorage.getItem('pay.setupSeen')) { sessionStorage.setItem('pay.setupSeen', '1'); setTimeout(() => setupWizard(), 300); }
}

// ---------- shell ----------
const sidePref = () => { try { return localStorage['pay.side'] || ''; } catch { return ''; } };
function toggleSide() {
  const sh = $('#shell'), mini = sh.classList.contains('min') || (!sh.classList.contains('full') && !matchMedia('(min-width:1200px)').matches);
  try { localStorage['pay.side'] = mini ? 'full' : 'min'; } catch { /* private mode */ }
  sh.classList.remove('min', 'full'); sh.classList.add(mini ? 'full' : 'min');
}
function navItem(id) {
  const p = PAGES[id]; if (!allowed(p)) return null;
  return h('a', { href: '#/' + id, 'data-nav': id, class: 'nav-i', title: p.title }, icon(p.icon, 20), h('span', { class: 'lbl-t' }, p.navTitle || p.title), id === 'home' ? h('span', { class: 'cnt hidden', id: 'navPending' }) : null);
}
function tabsFor() {
  if (isHR()) return ['home', 'people', 'time', canPay() ? 'pay' : 'leave'];
  return ['today', 'my-time', 'my-leave', 'my-pay'];
}
function buildShell() {
  const role = S.user.role;
  const apps = [['/index.html', 'POS', 'bag', 'pos'], ['/accounts.html', 'Accounting', 'book', 'accounting']].filter((a) => (S.dash.features || {})[a[3]] && (S.dash.enabled_features || {})[a[3]] !== false && ['owner', 'manager'].includes(role));
  const groups = [...(isHR() ? NAV_HR : []), ...(S.ctx.me ? NAV_ME : [])];
  const side = h('aside', { class: 'side', 'aria-label': 'Sections' },
    h('div', { class: 'brand' }, h('img', { src: '/icon-payroll.svg', alt: '', width: 30, height: 30 }), h('div', { class: 'lbl-t grow' }, h('b', null, 'Payroll'), h('span', null, org().display_name || S.ctx.tenant.name)),
      h('button', { class: 'side-tg', type: 'button', title: 'Collapse or expand the sidebar', 'aria-label': 'Collapse or expand the sidebar', onclick: toggleSide }, icon('sidebar', 20))),
    groups.map((g) => { const items = g.items.map((i) => navItem(i)).filter(Boolean); return items.length ? [g.group ? h('div', { class: 'gh' }, h('span', { class: 'lbl-t' }, g.group)) : null, items] : null; }),
    apps.length ? [h('div', { class: 'gh' }, h('span', { class: 'lbl-t' }, 'Other apps')), apps.map(([href, t, ic]) => h('a', { href, class: 'nav-i', title: t }, icon(ic, 20), h('span', { class: 'lbl-t' }, t)))] : null,
    h('div', { class: 'foot' }, S.ctx.tenant.is_demo ? h('span', { class: 'badge orange' }, 'Demo data') : null, h('span', null, S.user.email), h('span', null, roleLabel()),
      seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v), { full: true }),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, h('button', { class: 'btn sm', type: 'button', onclick: signOut }, 'Sign out'))));
  const topbar = h('header', { class: 'topbar', id: 'topbar' }, h('div', { class: 'l', id: 'tb-l' }), h('div', { class: 'tt', id: 'tb-t', 'aria-live': 'polite' }), h('div', { class: 'r', id: 'tb-r' }));
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    tabsFor().map((id) => PAGES[id] && allowed(PAGES[id]) ? h('button', { type: 'button', 'data-tab': id, onclick: () => go(id) }, icon(PAGES[id].icon, 25), h('span', null, PAGES[id].tabLabel || PAGES[id].title)) : null),
    h('button', { type: 'button', 'data-tab': 'more', onclick: moreSheet }, icon('more', 25), h('span', null, 'More')));
  clear($('#app')).append(h('div', { class: 'shell' + (sidePref() ? ' ' + sidePref() : ''), id: 'shell' }, side, h('div', { class: 'main' }, topbar, h('main', { id: 'main', tabindex: '-1' })), tabbar));
  document.addEventListener('keydown', globalKeys);
  matchMedia('(min-width:900px)').addEventListener('change', () => route_());
}
const roleLabel = () => S.user.role === 'owner' ? 'Owner' : S.user.role === 'manager' ? 'Manager' : isHR() ? cap1(S.user.role) : 'Employee';
function signOut() { sb.auth.signOut().then(() => location.reload()); }
// Apple Guideline 5.1.1(v): self-service account deletion, reachable from inside the app.
async function deleteAccountFlow() {
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'Password (leave blank if you use Google, Apple or phone sign-in)', style: { marginTop: '8px' } });
  const ok = await alertBox({ title: 'Delete your account?', message: 'This cannot be undone.', body: pw, confirm: 'Delete account', actions: [{ label: 'Delete account', value: true, role: 'danger' }, { label: 'Cancel', value: false }] });
  if (!ok) return;
  const { error } = await sb.auth.deleteAccount(pw.value);
  if (error) { await alertBox({ title: 'Could not delete account', message: error.message, cancel: false }); return; }
  location.href = '/payroll.html';
}
function moreSheet() {
  const tabs = tabsFor();
  const groups = [...(isHR() ? NAV_HR : []), ...(S.ctx.me ? NAV_ME : [])];
  const body = h('div', { class: 'grid' }, groups.map((g) => {
    const items = g.items.filter((i) => !tabs.includes(i) && allowed(PAGES[i]));
    return items.length ? section(g.group || 'Main', h('div', { class: 'list' }, items.map((i) => liRow({ icon: PAGES[i].icon, title: PAGES[i].title, chevron: true, onclick: () => { s.close(); go(i); } })))) : null;
  }),
    isHR() && can('pay_time') ? h('div', { class: 'list' }, liRow({ icon: 'tablet', title: 'Clock-in kiosk', sub: 'Turn this device into a shared clock-in screen', onclick: () => { s.close(); go('kiosk'); } })) : null,
    h('div', { class: 'list' }, liRow({ icon: 'moon', tone: 'gray', title: 'Appearance', badge: seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v)) })),
    h('div', { class: 'list' }, liRow({ icon: 'user', tone: 'gray', title: S.user.email, sub: roleLabel() + (S.ctx.tenant.is_demo ? ' · demo data' : '') }), liRow({ icon: 'logout', tone: 'gray', title: 'Sign out', onclick: signOut }), liRow({ icon: 'trash', tone: 'red', title: 'Delete my account', onclick: () => { s.close(); deleteAccountFlow(); } })));
  const s = sheet({ title: 'More', closeLabel: 'Done', body, noFocus: true });
}
function globalKeys(e) {
  const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && isHR()) { e.preventDefault(); openPalette(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/' && isHR()) { e.preventDefault(); openPalette(); }
}

// ---------- router ----------
async function route_() {
  closeMenus();
  cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanup = [];
  route = parseHash();
  let def = PAGES[route.id];
  if (!def || !allowed(def)) { if (def && !def.ess && !isHR()) { route = { id: homeId(), args: [], q: new URLSearchParams() }; def = PAGES[route.id]; } }
  if (!def) { route = { id: homeId(), args: [], q: new URLSearchParams() }; def = PAGES[route.id]; }
  const main = $('#main'); if (!main) return;
  const root = h('div', { class: 'page' }, h('div', { class: 'skel', style: { height: '44px', width: '55%' } }), h('div', { class: 'skel', style: { height: '120px' } }), h('div', { class: 'skel', style: { height: '220px' } }));
  clear(main).append(root);
  $$('[data-nav]').forEach((a) => a.removeAttribute('aria-current')); $$('[data-tab]').forEach((a) => a.removeAttribute('aria-current'));
  const navId = def.navAs || route.id;
  $(`[data-nav="${navId}"]`)?.setAttribute('aria-current', 'page');
  const tab = tabsFor().includes(navId) ? navId : 'more'; $(`[data-tab="${tab}"]`)?.setAttribute('aria-current', 'page');
  if (!allowed(def)) { header({ title: def.title }); clear(root).append(empty('lock', 'No access', 'Your role does not include ' + def.title.toLowerCase() + '. Ask the owner to change your role.')); return; }
  const view = { id: route.id, args: route.args, q: route.q, root, header: (o) => header(o, root), refresh: () => route_(), onLeave: (f) => cleanup.push(f) };
  try { clear(root); header({ title: def.title }, root); await def.render(view); } catch (e) {
    console.error(e); clear(root).append(empty('alert', 'Could not load this page', e.message, h('button', { class: 'btn fill', onclick: route_ }, 'Try again')));
  }
  main.focus({ preventScroll: true }); window.scrollTo(0, 0);
}
// o: {title, sub, back: 'path', actions:[{label, icon, primary, run, menu:[...]}]}
function header(o, root) {
  const l = $('#tb-l'), t = $('#tb-t'), r = $('#tb-r'); if (!l) return;
  clear(l); clear(r);
  t.textContent = o.title || '';
  document.title = (o.title ? o.title + ' · ' : '') + 'AUZslab Payroll';
  if (o.back) l.append(h('button', { class: 'btn plain', type: 'button', 'aria-label': 'Back', onclick: () => (typeof o.back === 'function' ? o.back() : go(o.back)) }, icon('chevL', 22), h('span', { class: 'desk-only' }, 'Back')));
  const desk = isDesk();
  if (desk && isHR()) r.append(h('div', { class: 'gsearch' }, h('button', { class: 'input', type: 'button', style: { textAlign: 'left', color: 'var(--label3)', display: 'flex', alignItems: 'center', gap: '8px' }, onclick: openPalette, 'aria-label': 'Search people and payrolls' }, icon('search', 18), h('span', { class: 'gs-t' }, 'Search'), h('span', { class: 'muted small gs-t', style: { marginLeft: 'auto' } }, '⌘K'))));
  const acts = (o.actions || []).filter(Boolean);
  const primary = acts.filter((a) => a.primary), others = acts.filter((a) => !a.primary);
  const mk = (a) => {
    const b = h('button', { class: 'btn ' + (desk ? (a.primary ? 'fill' : '') : 'plain') + (a.danger ? ' danger' : '') + (!desk && a.icon ? ' icon' : ''), type: 'button', 'aria-label': a.label, title: a.label, disabled: a.disabled, onclick: () => (a.menu ? menu(b, a.menu) : a.run(b)) }, a.icon ? icon(a.icon, 20) : null, desk || !a.icon ? a.label : null);
    return b;
  };
  if (desk) acts.forEach((a) => r.append(mk(a)));
  else {
    primary.forEach((a) => r.append(mk(a)));
    if (others.length === 1) r.append(mk(others[0]));
    else if (others.length > 1) { const mb = h('button', { class: 'btn plain icon', type: 'button', 'aria-label': 'More actions', onclick: () => menu(mb, others.map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, run: () => (a.menu ? menu(mb, a.menu) : a.run(mb)) }))) }, icon('more', 22)); r.append(mb); }
  }
  if (root) $$('#large-title,.page-sub,.desk-sub', root).forEach((x) => x.remove());
  if (!desk && root && !o.noLarge) {
    root.prepend(...[h('h1', { class: 'large-title', id: 'large-title' }, o.title), o.sub ? h('p', { class: 'page-sub' }, o.sub) : null].filter(Boolean));
    const tb = $('#topbar'); tb.classList.remove('scrolled');
    const lt = $('#large-title', root);
    if (lt && 'IntersectionObserver' in window) { const io = new IntersectionObserver(([en]) => tb.classList.toggle('scrolled', !en.isIntersecting), { rootMargin: '-56px 0px 0px 0px' }); io.observe(lt); cleanup.push(() => io.disconnect()); }
  } else if (desk && root && o.sub) root.prepend(h('p', { class: 'muted desk-sub', style: { marginTop: '-10px' } }, o.sub));
  if (!desk && !r.childNodes.length) r.append(h('span'));
}

// ---------- search ----------
function openPalette() {
  const input = searchField('Search people and payrolls', () => run());
  const out = h('div', { class: 'col', role: 'listbox', 'aria-label': 'Results' });
  let items = [], idx = 0, seq = 0;
  const pageItems = () => Object.entries(PAGES).filter(([, p]) => p.title && p.nav !== false && allowed(p)).map(([id, p]) => ({ title: p.title, sub: 'Go to', icon: p.icon, run: () => go(id) }));
  const paint = () => {
    clear(out);
    if (!items.length) { out.append(h('p', { class: 'muted', style: { padding: '12px 4px' } }, 'No results.')); return; }
    out.append(h('div', { class: 'list' }, items.map((it, i) => h('button', { class: 'li' + (i === idx ? ' sel' : ''), type: 'button', role: 'option', 'aria-selected': String(i === idx), onclick: () => choose(it) }, it.avatar ? avatar(it.avatar, 32) : h('span', { class: 'tile gray' }, icon(it.icon || 'doc', 18)), h('div', { class: 'grow' }, h('div', { class: 't' }, it.title), it.sub ? h('div', { class: 's' }, it.sub) : null)))));
  };
  const choose = (it) => { sh.close(); it.run(); };
  const run = debounce(async () => {
    const q = input.input.value.trim().toLowerCase(), my = ++seq;
    const local = pageItems().filter((p) => !q || p.title.toLowerCase().includes(q)).slice(0, q ? 4 : 20);
    items = local; idx = 0; paint();
    if (q.length < 2) return;
    try {
      const rs = await api('pay_search', { p_q: q }); if (my !== seq) return;
      items = [...rs.map((r) => ({ title: r.title, sub: (r.type === 'employee' ? 'Person' : 'Payroll') + (r.sub ? ' · ' + r.sub : ''), avatar: r.type === 'employee' ? r.title : null, icon: 'wallet', run: () => go((r.type === 'employee' ? 'person/' : 'run/') + r.id) })), ...local]; idx = 0; paint();
    } catch { /* offline: pages only */ }
  }, 180);
  const sh = sheet({ title: 'Search', closeLabel: 'Close', body: h('div', { class: 'grid' }, input, out) });
  input.input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); paint(); } else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); paint(); } else if (e.key === 'Enter' && items[idx]) { e.preventDefault(); choose(items[idx]); } });
  run();
}

document.addEventListener('DOMContentLoaded', () => { boot(); });
