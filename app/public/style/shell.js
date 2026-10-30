document.addEventListener("gesturestart",e=>e.preventDefault());document.addEventListener("gesturechange",e=>e.preventDefault());document.addEventListener("dblclick",e=>e.preventDefault());
/* AUZsStyle: shell (sign in, navigation, router). Pages register with page(). Same login/boot/router shape as AUZsMob. */
'use strict';
const PAGES = {};
const page = (id, def) => { PAGES[id] = def; };
let route = { id: 'sell', args: [], q: new URLSearchParams() };
let cleanup = [];
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { id: parts[0] || 'sell', args: parts.slice(1), q: new URLSearchParams(qs || '') };
}
const go = (path) => { const tgt = '#/' + path.replace(/^#?\/?/, ''); if (location.hash === tgt) route_(); else location.hash = tgt; };
const allowed = (def) => !!def && (!def.perm || can(def.perm));
const NAV = [['sell', 'Sell', 'cash'], ['stock', 'Stock', 'shirt'], ['bills', 'Bills', 'tag'], ['home', 'Overview', 'home'], ['analytics', 'Analytics', 'chart'], ['intel', 'Buying intelligence', 'bolt'], ['requests', 'Requests', 'users'], ['buy', 'Buy', 'truck'], ['people', 'People', 'users'], ['store', 'Online store', 'globe'], ['settings', 'Settings', 'gear']];
const capOff = (k) => !!(S.ctx && S.ctx.caps && S.ctx.caps[k] === false);
const navList = () => NAV.filter(([id]) => allowed(PAGES[id]) && !(id === 'store' && capOff('online_store')));
const tabsFor = () => navList().slice(0, 4).map((x) => x[0]);

function showLogin(msg) {
  const e = h('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' });
  const p = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const m = h('div', { class: 'small', role: 'alert', style: { color: 'var(--red)', minHeight: '18px' } }, msg || '');
  const btn = h('button', { class: 'btn fill wide', type: 'submit' }, t('Sign in'));
  const forgot = h('button', { type: 'button', class: 'btn plain small', style: { justifySelf: 'end', color: 'var(--red)', fontWeight: '700' } }, 'Forgot password?');
  forgot.onclick = async () => {
    const email = e.value.trim();
    if (!email) { m.textContent = 'Enter your email above first.'; return; }
    m.style.color = ''; m.textContent = 'Sending…';
    const { error } = await sb.auth.forgotPassword(email, 'https://auzslab.in/signup.html');
    m.style.color = error ? 'var(--red)' : ''; m.textContent = error ? error.message : 'If that email has an account, a reset link is on its way.';
  };
  const emailWrap = h('div', { style: { display: 'grid', gap: '10px' } }, e, p, forgot, btn);
  const staffWrap = auzStaffPinForm(sb, () => boot());
  staffWrap.style.display = 'none';
  const bE = h('button', { type: 'button', 'aria-selected': 'true' }, 'Email'), bS = h('button', { type: 'button', 'aria-selected': 'false' }, 'Staff');
  const setM = (w) => { emailWrap.style.display = w === 'email' ? 'grid' : 'none'; staffWrap.style.display = w === 'staff' ? 'grid' : 'none'; bE.setAttribute('aria-selected', String(w === 'email')); bS.setAttribute('aria-selected', String(w === 'staff')); m.textContent = ''; };
  bE.onclick = () => setM('email'); bS.onclick = () => setM('staff');
  btn.onclick = async (ev) => {
    ev.preventDefault(); btn.disabled = true; m.textContent = '';
    let r = await sb.auth.signInWithPassword({ email: e.value.trim(), password: p.value });
    r = await auz2fa.resolve(sb, r);
    btn.disabled = false;
    if (r.error) { m.style.color = 'var(--red)'; m.textContent = r.error.message; } else boot();
  };
  const googleHost = h('div');
  const social = h('div', { style: { display: CFG.googleClientId ? 'grid' : 'none', gap: '10px' } }, googleHost, h('div', { class: 'small muted', style: { textAlign: 'center' } }, 'or'));
  const form = h('form', { class: 'card', onsubmit: (ev) => ev.preventDefault() },
    h('div', { style: { fontWeight: 800, fontSize: '22px', letterSpacing: '-.02em' } }, 'AUZs', h('span', { style: { color: 'var(--accent)' } }, 'Style')),
    h('h1', null, t('Sign in')),
    seg([['en', 'English'], ['hi', 'हिंदी']], S_LANG, (v) => { setLang(v); showLogin(msg); }, { full: true }),
    social, h('div', { class: 'seg full' }, bE, bS), emailWrap, staffWrap, m);
  clear($('#app')).append(h('div', { class: 'login' }, form));
  e.focus();
  if (CFG.googleClientId) auzGoogleLink(googleHost, 'style');
}
function blocked(title, text) {
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'card' }, h('div', { style: { fontWeight: 800, fontSize: '20px' } }, 'AUZs', h('span', { style: { color: 'var(--accent)' } }, 'Style')), h('h1', null, title), h('p', { class: 'muted' }, text),
    h('button', { class: 'btn wide', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, t('Sign out')))));
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// "Install on this computer": Chrome/Edge offer the install through this event; we keep it for the Settings button.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.AUZ_INSTALL = e; document.dispatchEvent(new Event('auz:installable')); });
window.addEventListener('appinstalled', () => { window.AUZ_INSTALL = null; document.dispatchEvent(new Event('auz:installable')); });

// Installed (offline) copy: the local server answers /licence/status. On the cloud site it says offline:false and nothing changes.
async function licenceCheck() {
  let s; try { const c = new AbortController(); setTimeout(() => c.abort(), 4000); s = await (await fetch(CFG.url + '/licence/status', { signal: c.signal })).json(); } catch { return null; }
  if (!s || !s.offline) return null;
  window.AUZ_LIC = s;
  if (s.state === 'none' || s.state === 'expired') { licenceScreen(s); return 'locked'; }
  if (s.daysLeft <= 14) setTimeout(() => toast(s.state === 'grace' ? t('Your plan has ended. Enter a new licence code within %d days.').replace('%d', s.graceLeft) : t('Your plan ends in %d days. Ask AUZslab for a renewal code.').replace('%d', Math.max(s.daysLeft, 0)), { err: s.state === 'grace' }), 3000);
  return null;
}
// A toast disappears in a few seconds, easy to miss on a busy till -- within the last week (or already in the
// grace period), also show a banner that stays until the owner closes it, and only once per day after that
// (so it comes back tomorrow if still not renewed, but does not nag on every single screen all day).
function licenceBannerNode() {
  const s = window.AUZ_LIC;
  if (!s || (s.state !== 'grace' && (s.state !== 'active' || s.daysLeft > 7))) return null;
  const key = 'sty.licBanner.' + new Date().toDateString();
  if (LS.get(key, false)) return null;
  const msg = s.state === 'grace' ? t('Your plan has ended. Enter a new licence code within %d days to keep using AUZsStyle.').replace('%d', s.graceLeft)
    : t('Your plan ends in %d days. Ask AUZslab for a renewal code so the shop is never interrupted.').replace('%d', Math.max(s.daysLeft, 0));
  const bn = banner(s.state === 'grace' ? 'warn' : 'info', 'alert', msg);
  bn.append(h('button', { class: 'btn plain icon sm', type: 'button', 'aria-label': t('Dismiss'), onclick: () => { LS.set(key, true); bn.remove(); } }, icon('x', 16)));
  bn.classList.add('lic-banner');
  return bn;
}
// o.optional: called from Settings on an already-active install (to renew or add an extra), not the mandatory
// first-run/expired gate -- so it gets a Cancel link back to the app instead of nowhere else to go.
function licenceScreen(s, o = {}) {
  const code = h('textarea', { class: 'input', rows: 4, placeholder: 'AUZ-XXXXX-XXXXX-...', 'aria-label': 'Licence code', style: { fontFamily: 'monospace', textTransform: 'uppercase' } });
  const m = h('div', { class: 'small', role: 'alert', style: { color: 'var(--red)', minHeight: '18px' } });
  const btn = h('button', { class: 'btn fill wide', type: 'button' }, t('Activate'));
  btn.onclick = async () => {
    m.textContent = ''; btn.disabled = true;
    try {
      const r = await fetch(CFG.url + '/licence/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { m.textContent = j.error || t('Could not activate'); btn.disabled = false; return; }
      location.reload();
    } catch { m.textContent = t('Could not reach the app on this computer.'); btn.disabled = false; }
  };
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'card' }, h('div', { style: { fontWeight: 800, fontSize: '20px' } }, 'AUZs', h('span', { style: { color: 'var(--accent)' } }, 'Style')),
    h('h1', null, s.state === 'expired' ? t('Your plan has ended') : o.optional ? t('Change licence code') : t('Activate AUZsStyle')),
    h('p', { class: 'muted' }, s.state === 'expired' ? t('Your data is safe on this computer. Enter the new code AUZslab sent you to continue.') + (s.shop ? ' (' + s.shop + ', ' + s.end + ')' : '') : o.optional ? t('Type the new code AUZslab gave you -- to renew the plan or add an extra. Your shop\'s data is not touched.') : t('Type the licence code AUZslab gave you. No internet is needed.')),
    code, m, btn, o.optional ? h('button', { class: 'btn wide', type: 'button', onclick: () => location.reload() }, t('Cancel')) : null,
    h('p', { class: 'small muted' }, t('Need a code? Call or WhatsApp AUZslab: +91 92512 50829')))));
}

// First start of the installed copy: no shop exists yet, so ask for the shop name and the owner's login (kept on this computer only).
async function setupNeeded() {
  if (!window.AUZ_LIC) return false;
  try { return !!(await (await fetch(CFG.url + '/setup/state')).json()).needed; } catch { return false; }
}
function setupScreen() {
  const f = (ph, type = 'text', ac) => h('input', { class: 'input', type, placeholder: ph, 'aria-label': ph, autocomplete: ac || 'off' });
  const shop = f(t('Shop name')), name = f(t('Your name'), 'text', 'name'), email = f(t('Email (you will sign in with this)'), 'email', 'username'), pw = f(t('Password (at least 8 characters)'), 'password', 'new-password'), pw2 = f(t('Type the password again'), 'password', 'new-password');
  const m = h('div', { class: 'small', role: 'alert', style: { color: 'var(--red)', minHeight: '18px' } });
  const btn = h('button', { class: 'btn fill wide', type: 'submit' }, t('Create my shop'));
  const form = h('form', { style: { display: 'grid', gap: '10px' } }, shop, name, email, pw, pw2, m, btn);
  form.onsubmit = async (e) => {
    e.preventDefault(); m.textContent = '';
    if (pw.value !== pw2.value) { m.textContent = t('The two passwords are different.'); return; }
    btn.disabled = true;
    try {
      const r = await fetch(CFG.url + '/setup/first-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shop: shop.value, name: name.value, email: email.value, password: pw.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { m.textContent = j.error || t('Could not set up'); btn.disabled = false; return; }
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim().toLowerCase(), password: pw.value });
      if (error) { m.textContent = error.message; btn.disabled = false; return; }
      location.reload();
    } catch { m.textContent = t('Could not reach the app on this computer.'); btn.disabled = false; }
  };
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'card' }, h('div', { style: { fontWeight: 800, fontSize: '20px' } }, 'AUZs', h('span', { style: { color: 'var(--accent)' } }, 'Style')),
    h('h1', null, t('Set up your shop')), h('p', { class: 'muted' }, t('This is the first time AUZsStyle is opened on this computer. Your sales and stock are kept on this computer.')), form)));
}

async function boot() {
  try { setLang(localStorage['sty.lang'] || 'en'); } catch { setLang('en'); }
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'spin', style: { color: 'var(--tint)', width: '28px', height: '28px' } })));
  if (await licenceCheck() === 'locked') return;
  if (await setupNeeded()) return setupScreen();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  let dash, ctx;
  const ck = 'boot.' + (session.user.id || '');
  try {
    dash = await api('my_dashboard');
    const slug = window.TENANT_SLUG;
    if (slug && dash.tenant && dash.tenant.slug !== slug) { await sb.auth.signOut(); return showLogin('This login belongs to a different business (' + dash.tenant.slug + '.auzslab.in).'); }
    if (!(dash.features || {}).style || (dash.enabled_features || {}).style === false) return blocked('AUZsStyle', 'AUZsStyle is not part of your plan. Ask us to add it.');
    ctx = await api('sty_context');
    LS.set(ck, { dash, ctx });
  } catch (e) {
    if (e.status === 401) return showLogin('Your session ended. Please sign in again.');
    const c = e.net && LS.get(ck, null);
    if (!c) return blocked('Could not open AUZsStyle', e.message);
    dash = c.dash; ctx = c.ctx;
  }
  ctx = overlayRead('sty_context', {}, clone(ctx));   // settings/branches changed with no connection show at once
  S.dash = dash; S.ctx = ctx; S.perms = ctx.perms || {};
  restoreQueue();
  S.user = { email: dash.my_email, role: dash.my_role, id: session.user.id };
  const lang = LS.get('lang.' + S.user.id, null) || ctx.settings.language || 'en';
  if (!localStorage['sty.lang']) setLang(lang);
  const saved = LS.get('branch.' + slugKey(), null);
  const brs = ctx.branches || [];
  S.branch = brs.find((b) => b.id === saved) ? saved : (brs.find((b) => b.isMain) || brs[0] || {}).id || null;
  buildShell();
  shopIcon();
  window.addEventListener('hashchange', route_);
  window.addEventListener('sty:q', updatePill); window.addEventListener('online', updatePill); window.addEventListener('offline', updatePill);
  window.addEventListener('sty:synced', () => { updatePill(); if (['sell', 'stock', 'home'].includes(route.id)) route_(); });
  window.addEventListener('sty:auth', () => showLogin('Your session ended. Please sign in again.'));
  flushQueue(); topUpBarcodes(); setTimeout(warmScreens, 4000);
  route_();
}

// a shop that uploaded a logo gets it as the home-screen icon (server draws it centred on a tile); embedded as a data URI so iOS never shows a blank icon
async function shopIcon() {
  try {
    const logo = S.ctx.settings && S.ctx.settings.logoUrl;
    if (!logo || !/\.auzslab\.in$|^localhost$/.test(location.hostname) || /^(app|www|auzspos|auzsmob|auzspay|auzsledger|auzsscan|auzsstyle)\./.test(location.hostname)) return;
    const r = await fetch('/app-icon/180.png?v=' + encodeURIComponent(logo.slice(-12))); if (!r.ok) return;
    const fr = new FileReader(); fr.onload = () => { const l = document.querySelector('link[rel=apple-touch-icon]'); if (l) l.href = fr.result; }; fr.readAsDataURL(await r.blob());
  } catch { /* the default icon stays */ }
}
function navItem(id, label, ic) {
  if (!allowed(PAGES[id])) return null;
  return h('a', { href: '#/' + id, 'data-nav': id, class: 'nav-i', title: t(label) }, icon(ic, 20), h('span', { class: 'lbl-t' }, t(label)));
}
function pillNode() {
  const n = pendingCount(), bad = failedOps().length, off = netDown() || S.offlineData;
  const label = bad ? bad + ' ' + t('need attention') : n ? n + ' ' + t('waiting to send') : off ? t('Offline') : t('Up to date');
  return h('span', { class: 'sync-pill' + (n || bad ? ' warn' : ''), role: 'button', tabindex: 0, 'aria-label': t('Waiting changes'), onclick: () => waitingSheet() }, (n || bad || off) ? icon('cloudOff', 14) : icon('cloudCheck', 14), ' ' + label);
}
function updatePill() { const el = $('.sync-pill'); if (el) el.replaceWith(pillNode()); }
function branchName() { const b = (S.ctx.branches || []).find((x) => x.id === S.branch); return b ? b.name : ''; }
function pickBranch(anchor) {
  const brs = S.ctx.branches || []; if (brs.length < 2) return;
  menu(anchor, brs.map((b) => ({ label: b.name + (b.id === S.branch ? '  ✓' : ''), icon: 'building', run: () => { S.branch = b.id; LS.set('branch.' + slugKey(), b.id); S.catAt = 0; buildShell(); route_(); } })));
}
function buildShell() {
  const nav = navList();
  const side = h('aside', { class: 'side', 'aria-label': 'Sections' },
    h('div', { class: 'brand' }, (S.ctx.settings && S.ctx.settings.logoUrl) ? h('img', { class: 'brand-logo', src: S.ctx.settings.logoUrl, alt: '' }) : icon('shirt', 28), h('div', { class: 'lbl-t grow' }, h('b', null, 'AUZsStyle'), h('span', null, S.ctx.settings.shopName || (S.dash.tenant ? S.dash.tenant.name : ''))),
      h('button', { class: 'side-tg', type: 'button', 'aria-label': 'Toggle sidebar', onclick: () => $('#shell').classList.toggle('min') }, icon('sidebar', 20))),
    (S.ctx.branches || []).length > 1 ? h('button', { class: 'nav-i', type: 'button', onclick: (e) => pickBranch(e.currentTarget) }, icon('building', 20), h('span', { class: 'lbl-t' }, branchName())) : null,
    nav.map(([id, l, ic]) => navItem(id, l, ic)),
    h('div', { class: 'foot' }, h('span', null, pillNode()), h('span', null, S.user.email),
      seg([['en', 'EN'], ['hi', 'HI']], S_LANG, (v) => { setLang(v); buildShell(); route_(); }, { full: true }),
      seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v), { full: true }),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => auzHelp.open(sb) }, t('Help')), h('button', { class: 'btn sm', type: 'button', onclick: signOut }, t('Sign out')))));
  const topbar = h('header', { class: 'topbar', id: 'topbar' }, h('div', { class: 'l', id: 'tb-l' }), h('div', { class: 'tt', id: 'tb-t' }), h('div', { class: 'r', id: 'tb-r' }));
  const tabs = tabsFor();
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    tabs.map((id) => { const n = NAV.find((x) => x[0] === id); return h('button', { type: 'button', 'data-tab': id, 'aria-label': t(n[1]), title: t(n[1]), onclick: () => go(id) }, icon(n[2], 24), h('span', null, t(n[1]))); }),
    nav.length > tabs.length || true ? h('button', { type: 'button', 'data-tab': 'more', 'aria-label': t('More'), title: t('More'), onclick: moreSheet }, icon('more', 24), h('span', null, t('More'))) : null);
  shopIcon();
  clear($('#app')).append(h('div', { class: 'shell' + (LS.get('side', '') ? ' ' + LS.get('side', '') : ''), id: 'shell' }, side, h('div', { class: 'main' }, topbar, licenceBannerNode(), h('main', { id: 'main', tabindex: '-1' })), tabbar));
  matchMedia('(min-width:900px)').addEventListener('change', () => route_());
}
function signOut() { sb.auth.signOut().then(() => location.reload()); }
function moreSheet() {
  const tabs = tabsFor(); const rest = navList().filter(([id]) => !tabs.includes(id));
  const brs = S.ctx.branches || [];
  const body = h('div', { class: 'grid' },
    h('div', { class: 'list' },
      liRow({ icon: 'plus', title: t('Customer request'), chevron: true, onclick: () => { s.close(); requestSheet({}); } }),
      liRow({ icon: 'cash', title: t('Shift'), chevron: true, onclick: () => { s.close(); shiftSheet(); } }),
      capOff('online_store') ? null : liRow({ icon: 'globe', title: t('Open my website'), chevron: true, onclick: () => { location.href = '/store.html'; } })),
    rest.length ? section(t('More'), h('div', { class: 'list' }, rest.map(([id, l, ic]) => liRow({ icon: ic, title: t(l), chevron: true, onclick: () => { s.close(); go(id); } })))) : null,
    h('div', { class: 'list' },
      brs.length > 1 ? liRow({ icon: 'building', tone: 'gray', title: t('Branches'), sub: branchName(), chevron: true, onclick: (e) => { s.close(); setTimeout(() => pickBranch($('.topbar .tt')), 50); } }) : null,
      liRow({ icon: 'globe', tone: 'gray', title: t('Language'), badge: seg([['en', 'EN'], ['hi', 'HI']], S_LANG, (v) => { setLang(v); s.close(); buildShell(); route_(); }) }),
      liRow({ icon: 'moon', tone: 'gray', title: t('Appearance'), badge: seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v)) })),
    h('div', { class: 'list' }, liRow({ icon: 'user', tone: 'gray', title: S.user.email, sub: S.user.role }),
      liRow({ icon: 'user', tone: 'gray', title: 'Plan & account', onclick: () => { s.close(); auzPlan.open(sb); } }),
      liRow({ icon: 'book', tone: 'gray', title: t('User manual'), sub: t('Works offline, no internet needed'), onclick: () => { s.close(); manualSheet(); } }),
      liRow({ icon: 'info', tone: 'gray', title: 'Help & report a problem', onclick: () => { s.close(); auzHelp.open(sb); } }),
      S.user.role === 'owner' ? liRow({ icon: 'download', tone: 'gray', title: 'Backup, export or clear data', onclick: () => { s.close(); auzMyData(sb); } }) : null,
      liRow({ icon: 'logout', tone: 'gray', title: t('Sign out'), onclick: signOut })));
  const s = sheet({ title: t('More'), closeLabel: t('Done'), body });
}

// While online, open every screen once out of sight so its answers are saved on the device and the whole app opens offline.
async function warmScreens() {
  if (netDown() || window.__warming) return;
  const stamp = 'warm.' + scope(); if (Date.now() - Number(LS.get(stamp, 0)) < 6 * 36e5) return;
  window.__warming = true;
  try {
    for (const id of Object.keys(PAGES)) {
      if (id === 'sell' || id === 'store' || !allowed(PAGES[id])) continue;
      const root = h('div', { class: 'page' });
      const view = { id, args: [], q: new URLSearchParams(), root, header: () => {}, refresh() {}, onLeave() {} };
      try { await PAGES[id].render(view); } catch { /* a screen that fails is simply not saved */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const fn of ['sty_list_transfers', 'sty_hold_list', 'sty_staff_list', 'sty_coupons_list', 'sty_list_suppliers', 'sty_collections_list', 'sty_crm_overview']) { try { await api(fn); } catch { /* ignore */ } }
    LS.set(stamp, Date.now());
  } finally { window.__warming = false; }
}

async function route_() {
  closeMenus();
  cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanup = [];
  route = parseHash();
  let def = PAGES[route.id];
  if (!def || !allowed(def)) { route = { id: 'sell', args: [], q: new URLSearchParams() }; def = PAGES.sell; }
  const main = $('#main'); if (!main) return;
  const root = h('div', { class: 'page' + (def.pos ? ' pos-page' : ''), 'data-p': route.id });
  clear(main).append(root);
  $$('[data-nav]').forEach((a) => a.removeAttribute('aria-current')); $$('[data-tab]').forEach((a) => a.removeAttribute('aria-current'));
  $(`[data-nav="${route.id}"]`)?.setAttribute('aria-current', 'page');
  const tab = tabsFor().includes(route.id) ? route.id : 'more'; $(`[data-tab="${tab}"]`)?.setAttribute('aria-current', 'page');
  const nm = (NAV.find((x) => x[0] === route.id) || [0, route.id])[1];
  const view = { id: route.id, args: route.args, q: route.q, root, header: (o) => header(o, root), refresh: () => route_(), onLeave: (f) => cleanup.push(f) };
  try { header({ title: t(nm), noLarge: def.pos }, root); await def.render(view); } catch (e) {
    console.error(e); clear(root).append(empty('alert', t('Something went wrong'), e.message, h('button', { class: 'btn fill', onclick: route_ }, t('Try again'))));
  }
  main.focus({ preventScroll: true }); window.scrollTo(0, 0);
}
const NOTE_TYPES = /^(store_|style_)/;
let NOTES = [];
function bellCount() { return NOTES.filter((n) => !n.read).length; }
function bellBtn() {
  const n = bellCount();
  return h('button', { class: 'btn plain icon bell', type: 'button', 'aria-label': t('Notifications'), title: t('Notifications'), onclick: notesSheet }, icon('bell', 20), n ? h('span', { class: 'fcount' }, n > 9 ? '9+' : String(n)) : null);
}
async function refreshNotes() {
  if (!S.user) return; // nothing to ask before sign-in (or while the licence screen shows)
  try { const { data } = await sb.from('notifications').select('id,type,title,body,read,created_at').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString()).order('created_at').limit(500); NOTES = (data || []).filter((x) => NOTE_TYPES.test(x.type)).reverse(); } catch { return; }
  document.querySelectorAll('.btn.bell').forEach((b) => b.replaceWith(bellBtn()));
}
function noteTarget(n) { return n.type === 'style_request' ? 'requests' : n.type === 'style_soldout' ? 'stock' : 'store'; }
function notesSheet() {
  // Every notice, kept short: title and time only. Unread ones have a dot.
  const unread = NOTES.filter((n) => !n.read);
  const open = async (n, s) => { s.close(); if (!n.read) { n.read = true; try { await sb.from('notifications').update({ read: true }).eq('id', n.id); } catch {} } if (noteTarget(n) === 'store') OST.tab = 'orders'; go(noteTarget(n)); refreshNotes(); };
  const rows = NOTES.length ? NOTES.slice(0, 40).map((n) => liRow({ icon: n.type === 'store_order' ? 'globe' : n.type === 'store_return' ? 'swap' : n.type === 'store_paid' ? 'cash' : 'bell', title: n.title, sub: fmtDT(n.created_at), chevron: true, badge: n.read ? null : h('span', { class: 'dot', style: { background: 'var(--tint)', width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' } }), onclick: () => open(n, s) })) : [empty('bell', t('No notifications'), t('Website orders, returns and requests show here.'))];
  const s = sheet({ title: t('Notifications'), closeLabel: t('Done'), body: h('div', { class: 'grid' }, unread.length ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { for (const n of unread) { n.read = true; try { await sb.from('notifications').update({ read: true }).eq('id', n.id); } catch {} } s.close(); refreshNotes(); } }, t('Mark all as read')) : null, h('div', { class: 'list' }, rows)) });
}
setTimeout(refreshNotes, 1500); setInterval(refreshNotes, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNotes(); });
function header(o, root) {
  const l = $('#tb-l'), t_ = $('#tb-t'), r = $('#tb-r'); if (!l) return;
  clear(l); clear(r);
  t_.textContent = o.title || '';
  document.title = (o.title ? o.title + ' · ' : '') + 'AUZsStyle';
  if (o.back) l.append(h('button', { class: 'btn plain', type: 'button', 'aria-label': 'Back', onclick: () => go(o.back) }, icon('chevL', 22)));
  else if (!isDesk()) l.append(h('button', { class: 'brandpill', type: 'button', onclick: moreSheet }, (S.ctx.settings && S.ctx.settings.logoUrl) ? h('img', { class: 'pill-logo', src: S.ctx.settings.logoUrl, alt: '' }) : icon('shirt', 16), h('b', null, (S.ctx.settings.shopName || (S.dash.tenant && S.dash.tenant.name) || 'AUZsStyle').slice(0, 18))));
  const desk = isDesk();
  let acts = (o.actions || []).filter(Boolean);
  // On a phone keep the header short: at most two buttons, the rest go behind a "more" button.
  if (!desk && acts.length > 2) {
    const extra = acts.slice(1); acts = [acts[0]];
    acts.push({ label: t('More'), icon: 'more', run: () => { const sh = sheet({ title: o.title || t('More'), closeLabel: t('Done'), body: h('div', { class: 'list' }, extra.map((a) => liRow({ icon: a.icon, title: a.label, chevron: true, onclick: () => { sh.close(); a.run(); } }))) }); } });
  }
  acts.forEach((a) => r.append(h('button', { class: 'btn ' + (desk ? (a.primary ? 'fill' : '') : 'plain') + (!desk ? ' icon' : ''), type: 'button', 'aria-label': a.label, title: a.label, onclick: a.run }, a.icon ? icon(a.icon, 20) : null, desk ? a.label : null)));
  r.append(bellBtn());
  r.append(capOff('online_store') || !desk ? null : h('a', { class: 'btn plain icon', href: '/store.html', 'aria-label': 'Open my website', title: 'Open my website' }, icon('globe', 20)));
  if (root) { const old = root.querySelector(':scope > .large-title'); if (old) old.remove(); }
  if (!desk && root && !o.noLarge) root.prepend(h('h1', { class: 'large-title' }, o.title));
}
document.addEventListener('DOMContentLoaded', () => { boot(); });
