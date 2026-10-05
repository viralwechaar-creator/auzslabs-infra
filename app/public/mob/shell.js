/* AUZsMob: shell (sign in, navigation, router). Pages register with page(). Staff home vs owner/manager
   home differ (section 5): everyone gets the four quick actions, owner/manager additionally see the shop
   dashboard. Same login/boot/router shape as Payroll's and Accounting's shell.js. */
'use strict';
const PAGES = {};
const page = (id, def) => { PAGES[id] = def; };
let route = { id: 'home', args: [], q: new URLSearchParams() };
let cleanup = [];

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { id: parts[0] || 'home', args: parts.slice(1), q: new URLSearchParams(qs || '') };
}
const go = (path) => { const tgt = '#/' + path.replace(/^#?\/?/, ''); if (location.hash === tgt) route_(); else location.hash = tgt; };
function allowed(def) { if (!def) return false; if (!def.perm) return true; return typeof def.perm === 'function' ? def.perm() : can(def.perm); }
function navList() {
  const items = [['home', 'home', 'home']];
  if (feat('sell')) items.push(['sell', 'sell', 'cash']);
  if (repairsMode() === 'full') items.push(['repairs', 'repairs', 'wrench']);
  if (feat('stock') || can('mob_manage')) items.push(['stock', 'stock', 'box']);
  if (can('mob_reports')) items.push(['reports', 'reports', 'chart']);
  if (feat('customers') || feat('vendors')) items.push(['dues', 'dues', 'wallet']);
  items.push(['settings', 'settings', 'gear']);
  return items.filter(([id]) => allowed(PAGES[id]));
}
function tabsFor() { return navList().slice(0, 4).map((x) => x[0]); }

// ---------- sign in / boot (same shape as the other apps' shell.js) ----------
function showLogin(msg) {
  const e = h('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' });
  const p = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const m = h('div', { class: 'small', role: 'alert', style: { color: 'var(--red)', minHeight: '18px' } }, msg || '');
  const btn = h('button', { class: 'btn fill wide', type: 'submit' }, t('signIn'));
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
  const methodStaffBtn = h('button', { type: 'button', 'aria-selected': 'false' }, 'Staff');
  const staffWrap = auzStaffPinForm(sb, () => boot());
  const setMethod = (which) => { emailWrap.style.display = which === 'email' ? 'grid' : 'none'; phoneWrap.style.display = which === 'phone' ? 'grid' : 'none'; staffWrap.style.display = which === 'staff' ? 'grid' : 'none'; methodStaffBtn.setAttribute('aria-selected', String(which === 'staff')); methodEmailBtn.setAttribute('aria-selected', String(which === 'email')); methodPhoneBtn.setAttribute('aria-selected', String(which === 'phone')); m.style.color = ''; m.textContent = ''; };
  methodEmailBtn.onclick = () => setMethod('email'); methodPhoneBtn.onclick = () => setMethod('phone'); methodStaffBtn.onclick = () => setMethod('staff');
  const methodRow = h('div', { class: 'seg full' }, methodEmailBtn, methodPhoneBtn, methodStaffBtn);

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
  const langSwitch = seg([['en', 'English'], ['hi', 'हिंदी']], S_LANG, (v) => { setLang(v); showLogin(msg); }, { full: true });
  const form = h('form', { class: 'card', onsubmit: (ev) => ev.preventDefault() },
    h('div', { style: { fontWeight: 800, fontSize: '22px', letterSpacing: '-.02em' } }, 'AUZs', h('span', { style: { color: 'var(--accent)' } }, 'Mob')),
    h('h1', null, t('signIn')), langSwitch,
    socialWrap, socialDivider, methodRow, emailWrap, phoneWrap, staffWrap, m);
  clear($('#app')).append(h('div', { class: 'login' }, form));
  e.focus();

  if (CFG.googleClientId && !document.getElementById('gsiScript')) { const gs = document.createElement('script'); gs.id = 'gsiScript'; gs.src = 'https://accounts.google.com/gsi/client'; gs.async = true; gs.defer = true; document.head.appendChild(gs); }
  if (CFG.googleClientId) {
    const initG = () => {
      if (!window.google) return setTimeout(initG, 50);
      socialWrap.style.display = 'grid'; socialDivider.style.display = 'block';
      google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: async (resp) => { m.style.color = ''; m.textContent = 'Signing in…'; const { error } = await sb.auth.signInWithGoogle(resp.credential); if (error) { m.style.color = 'var(--red)'; m.textContent = error.message; return; } boot(); } });
      google.accounts.id.renderButton(googleHost, { theme: 'outline', size: 'large', width: 332 });
    };
    initG();
  }
  if (CFG.appleClientId && !document.getElementById('appleSdkScript')) { const as = document.createElement('script'); as.id = 'appleSdkScript'; as.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'; document.head.appendChild(as); }
  if (CFG.appleClientId) {
    const initA = () => {
      if (!window.AppleID) return setTimeout(initA, 50);
      socialWrap.style.display = 'grid'; socialDivider.style.display = 'block'; appleBtn.style.display = 'flex';
      AppleID.auth.init({ clientId: CFG.appleClientId, scope: 'email name', redirectURI: location.origin + '/mob.html', usePopup: true });
      appleBtn.onclick = async () => { try { const resp = await AppleID.auth.signIn(); m.style.color = ''; m.textContent = 'Signing in…'; const { error } = await sb.auth.signInWithApple(resp.authorization.code); if (error) { m.style.color = 'var(--red)'; m.textContent = error.message; return; } boot(); } catch (err) { if (err && err.error === 'popup_closed_by_user') return; m.style.color = 'var(--red)'; m.textContent = 'Apple sign-in failed.'; } };
    };
    initA();
  }
}
function blocked(title, text) {
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'card' }, h('div', { style: { fontWeight: 800, fontSize: '20px' } }, 'AUZs', h('span', { style: { color: 'var(--accent)' } }, 'Mob')), h('h1', null, title), h('p', { class: 'muted' }, text),
    h('button', { class: 'btn wide', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, t('signOut')))));
}
async function boot() {
  try { setLang(localStorage['mob.lang'] || 'en'); } catch { setLang('en'); }
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'spin', style: { color: 'var(--tint)', width: '28px', height: '28px' } })));
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  let dash;
  try { dash = await api('my_dashboard'); } catch (e) { if (e.status === 401) return showLogin('Your session ended. Please sign in again.'); return blocked('Could not load', e.message); }
  const slug = window.TENANT_SLUG;
  if (slug && dash.tenant && dash.tenant.slug !== slug) { await sb.auth.signOut(); return showLogin('This login belongs to a different business (' + dash.tenant.slug + '.auzslab.in).'); }
  if (!(dash.features || {}).mobile || (dash.enabled_features || {}).mobile === false) return blocked(t('appName'), t('errNotEnabled'));
  S.user = { email: dash.my_email, role: dash.my_role, id: session.user.id }; S.dash = dash;
  let ctx;
  try { ctx = await api('mob_context'); } catch (e) { return blocked('Could not open AUZsMob', e.message); }
  S.ctx = ctx; S.perms = ctx.perms || {};
  // Carry the language picked at the (pre-login) sign-in screen into the app itself. mob_context's
  // my_language is only ever a real preference once this staffer (or their shop) has explicitly saved
  // one -- my_language_set says whether that's happened yet. Until then, trust whatever was picked at
  // login (localStorage) over the 'en' fallback, and save it so it's their real preference from here on;
  // once it's been set for real, always defer to the saved value, the way Settings expects.
  let localLang; try { localLang = localStorage['mob.lang']; } catch { /* private mode */ }
  if (!ctx.my_language_set && (localLang === 'hi' || localLang === 'en') && localLang !== ctx.my_language) {
    setLang(localLang);
    api('mob_save_my_language', { p_lang: localLang }).catch(() => { /* syncs next time Settings is opened */ });
  } else {
    setLang(ctx.my_language || 'en');
  }
  if (window.auzBrandLoad) auzBrandLoad(sb);
  await openDb(); // warm up IndexedDB before the first screen needs it
  trySync();
  buildShell();
  window.addEventListener('hashchange', route_);
  window.addEventListener('mob:sync', updateSyncPill);
  window.addEventListener('mob:pulled', () => route_());
  route_();
}

// ---------- shell ----------
const sidePref = () => { try { return localStorage['mob.side'] || ''; } catch { return ''; } };
function toggleSide() {
  const sh = $('#shell'), mini = sh.classList.contains('min') || (!sh.classList.contains('full') && !matchMedia('(min-width:1200px)').matches);
  try { localStorage['mob.side'] = mini ? 'full' : 'min'; } catch { /* private mode */ }
  sh.classList.remove('min', 'full'); sh.classList.add(mini ? 'full' : 'min');
}
function navItem(id, label, ic) {
  const p = PAGES[id]; if (!allowed(p)) return null;
  return h('a', { href: '#/' + id, 'data-nav': id, class: 'nav-i', title: label }, icon(ic, 20), h('span', { class: 'lbl-t' }, label));
}
function otherApps() {
  if (!['owner', 'manager'].includes(S.user.role)) return null;
  const apps = [['/index.html', 'POS', 'cash', 'pos'], ['/payroll.html', 'Payroll', 'wallet', 'payroll'], ['/accounts.html', 'Accounting', 'chart', 'accounting']]
    .filter((a) => (S.dash.features || {})[a[3]] === true && (S.dash.enabled_features || {})[a[3]] !== false);
  if (!apps.length) return null;
  return [h('div', { class: 'gh' }, h('span', { class: 'lbl-t' }, 'Other apps')), apps.map(([href, lbl, ic]) => h('a', { href, class: 'nav-i', title: lbl }, icon(ic, 20), h('span', { class: 'lbl-t' }, lbl)))];
}
function buildShell() {
  const nav = navList();
  const side = h('aside', { class: 'side', 'aria-label': 'Sections' },
    h('div', { class: 'brand' }, icon('phone', 28), h('div', { class: 'lbl-t grow' }, h('b', null, 'AUZsMob'), h('span', null, S.dash.tenant ? S.dash.tenant.name : '')),
      h('button', { class: 'side-tg', type: 'button', 'aria-label': 'Toggle sidebar', onclick: toggleSide }, icon('sidebar', 20))),
    nav.map(([id, , ic]) => navItem(id, t(id), ic)),
    otherApps(),
    h('div', { class: 'foot' }, h('span', null, syncStatusNode()), h('span', null, S.user.email),
      seg([['en', 'EN'], ['hi', 'HI']], S_LANG, (v) => saveLang(v), { full: true }),
      seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v), { full: true }),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, h('button', { class: 'btn sm', type: 'button', onclick: signOut }, t('signOut')))));
  const topbar = h('header', { class: 'topbar', id: 'topbar' }, h('div', { class: 'l', id: 'tb-l' }), h('div', { class: 'tt', id: 'tb-t' }), h('div', { class: 'r', id: 'tb-r' }));
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    tabsFor().map((id) => h('button', { type: 'button', 'data-tab': id, onclick: () => go(id) }, icon(nav.find((n) => n[0] === id)[2], 25), h('span', null, t(id)))),
    h('button', { type: 'button', 'data-tab': 'more', onclick: moreSheet }, icon('more', 25), h('span', null, t('more'))));
  clear($('#app')).append(h('div', { class: 'shell' + (sidePref() ? ' ' + sidePref() : ''), id: 'shell' }, side, h('div', { class: 'main' }, topbar, h('main', { id: 'main', tabindex: '-1' })), tabbar));
  matchMedia('(min-width:900px)').addEventListener('change', () => route_());
}
async function saveLang(v) { setLang(v); try { await api('mob_save_my_language', { p_lang: v }); } catch { /* syncs later */ } buildShell(); route_(); }
function updateSyncPill() { const el = $('.sync-pill'); if (el) el.replaceWith(syncStatusNode()); }
function signOut() { sb.auth.signOut().then(() => location.reload()); }
function moreSheet() {
  const tabs = tabsFor();
  const nav = navList().filter(([id]) => !tabs.includes(id));
  const body = h('div', { class: 'grid' },
    nav.length ? section(t('more'), h('div', { class: 'list' }, nav.map(([id, , ic]) => liRow({ icon: ic, title: t(id), chevron: true, onclick: () => { s.close(); go(id); } })))) : null,
    h('div', { class: 'list' },
      liRow({ icon: 'globe', tone: 'gray', title: t('language'), badge: seg([['en', 'EN'], ['hi', 'HI']], S_LANG, (v) => saveLang(v)) }),
      liRow({ icon: 'moon', tone: 'gray', title: 'Appearance', badge: seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v)) })),
    h('div', { class: 'list' }, liRow({ icon: 'user', tone: 'gray', title: S.user.email, sub: S.user.role }), liRow({ icon: 'user', tone: 'gray', title: 'Plan & account', onclick: () => { s.close(); auzPlan.open(sb); } }), S.user.role === 'owner' ? liRow({ icon: 'download', tone: 'gray', title: 'Backup, export or clear data', onclick: () => { s.close(); auzMyData(sb); } }) : null, liRow({ icon: 'logout', tone: 'gray', title: t('signOut'), onclick: signOut })));
  const s = sheet({ title: t('more'), closeLabel: 'Done', body });
}

// ---------- router ----------
async function route_() {
  closeMenus();
  cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanup = [];
  route = parseHash();
  let def = PAGES[route.id];
  if (!def || !allowed(def)) { route = { id: 'home', args: [], q: new URLSearchParams() }; def = PAGES[route.id]; }
  const main = $('#main'); if (!main) return;
  const root = h('div', { class: 'page' });
  clear(main).append(root);
  $$('[data-nav]').forEach((a) => a.removeAttribute('aria-current')); $$('[data-tab]').forEach((a) => a.removeAttribute('aria-current'));
  $(`[data-nav="${route.id}"]`)?.setAttribute('aria-current', 'page');
  const tab = tabsFor().includes(route.id) ? route.id : 'more'; $(`[data-tab="${tab}"]`)?.setAttribute('aria-current', 'page');
  const view = { id: route.id, args: route.args, q: route.q, root, header: (o) => header(o, root), refresh: () => route_(), onLeave: (f) => cleanup.push(f) };
  try { header({ title: t(def.navAs || route.id) }, root); await def.render(view); } catch (e) {
    console.error(e); clear(root).append(empty('alert', t('errGeneric'), e.message, h('button', { class: 'btn fill', onclick: route_ }, t('tryAgain'))));
  }
  main.focus({ preventScroll: true }); window.scrollTo(0, 0);
}
function header(o, root) {
  const l = $('#tb-l'), t_ = $('#tb-t'), r = $('#tb-r'); if (!l) return;
  clear(l); clear(r);
  t_.textContent = o.title || '';
  document.title = (o.title ? o.title + ' · ' : '') + 'AUZsMob';
  if (o.back) l.append(h('button', { class: 'btn plain', type: 'button', 'aria-label': 'Back', onclick: () => go(o.back) }, icon('chevL', 22)));
  const desk = isDesk();
  const acts = (o.actions || []).filter(Boolean);
  acts.forEach((a) => r.append(h('button', { class: 'btn ' + (desk ? (a.primary ? 'fill' : '') : 'plain') + (!desk ? ' icon' : ''), type: 'button', 'aria-label': a.label, title: a.label, onclick: a.run }, a.icon ? icon(a.icon, 20) : null, desk ? a.label : null)));
  // header() is called twice per page load -- once by route_() with a fallback title before def.render()
  // runs, then again by the page's own v.header() call with the real title -- so any previous large-title
  // node must be removed first, or the two calls stack into a visible duplicate title.
  if (root) { const old = root.querySelector(':scope > .large-title'); if (old) old.remove(); }
  if (!desk && root && !o.noLarge) root.prepend(h('h1', { class: 'large-title' }, o.title));
  if (!desk && !r.childNodes.length) r.append(h('span'));
}

document.addEventListener('DOMContentLoaded', () => { boot(); });
