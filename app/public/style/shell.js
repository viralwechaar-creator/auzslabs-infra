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
const NAV = [['sell', 'Sell', 'cash'], ['home', 'Overview', 'home'], ['stock', 'Stock', 'shirt'], ['analytics', 'Analytics', 'chart'], ['bills', 'Bills', 'tag'], ['buy', 'Buy', 'truck'], ['people', 'People', 'users'], ['settings', 'Settings', 'gear']];
const navList = () => NAV.filter(([id]) => allowed(PAGES[id]));
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

async function boot() {
  try { setLang(localStorage['sty.lang'] || 'en'); } catch { setLang('en'); }
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'spin', style: { color: 'var(--tint)', width: '28px', height: '28px' } })));
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
  S.dash = dash; S.ctx = ctx; S.perms = ctx.perms || {};
  S.user = { email: dash.my_email, role: dash.my_role, id: session.user.id };
  const lang = LS.get('lang.' + S.user.id, null) || ctx.settings.language || 'en';
  if (!localStorage['sty.lang']) setLang(lang);
  const saved = LS.get('branch.' + slugKey(), null);
  const brs = ctx.branches || [];
  S.branch = brs.find((b) => b.id === saved) ? saved : (brs.find((b) => b.isMain) || brs[0] || {}).id || null;
  buildShell();
  shopIcon();
  window.addEventListener('hashchange', route_);
  window.addEventListener('sty:q', updatePill);
  window.addEventListener('sty:synced', () => { updatePill(); if (['sell', 'stock', 'home'].includes(route.id)) route_(); });
  flushQueue();
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
  const n = getQ().length;
  return h('span', { class: 'sync-pill' + (n ? ' warn' : ''), onclick: n ? () => { flushQueue().then(() => toast(getQ().length ? t('Still offline') : t('All sent'))); } : null }, n ? icon('cloudOff', 14) : icon('cloudCheck', 14), n ? ' ' + n + ' ' + t('waiting to send') : ' ' + t('Up to date'));
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
  clear($('#app')).append(h('div', { class: 'shell' + (LS.get('side', '') ? ' ' + LS.get('side', '') : ''), id: 'shell' }, side, h('div', { class: 'main' }, topbar, h('main', { id: 'main', tabindex: '-1' })), tabbar));
  matchMedia('(min-width:900px)').addEventListener('change', () => route_());
}
function signOut() { sb.auth.signOut().then(() => location.reload()); }
function moreSheet() {
  const tabs = tabsFor(); const rest = navList().filter(([id]) => !tabs.includes(id));
  const brs = S.ctx.branches || [];
  const body = h('div', { class: 'grid' },
    rest.length ? section(t('More'), h('div', { class: 'list' }, rest.map(([id, l, ic]) => liRow({ icon: ic, title: t(l), chevron: true, onclick: () => { s.close(); go(id); } })))) : null,
    h('div', { class: 'list' },
      brs.length > 1 ? liRow({ icon: 'building', tone: 'gray', title: t('Branches'), sub: branchName(), chevron: true, onclick: (e) => { s.close(); setTimeout(() => pickBranch($('.topbar .tt')), 50); } }) : null,
      liRow({ icon: 'globe', tone: 'gray', title: t('Language'), badge: seg([['en', 'EN'], ['hi', 'HI']], S_LANG, (v) => { setLang(v); s.close(); buildShell(); route_(); }) }),
      liRow({ icon: 'moon', tone: 'gray', title: t('Appearance'), badge: seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v)) })),
    h('div', { class: 'list' }, liRow({ icon: 'user', tone: 'gray', title: S.user.email, sub: S.user.role }),
      liRow({ icon: 'user', tone: 'gray', title: 'Plan & account', onclick: () => { s.close(); auzPlan.open(sb); } }),
      liRow({ icon: 'info', tone: 'gray', title: 'Help & report a problem', onclick: () => { s.close(); auzHelp.open(sb); } }),
      S.user.role === 'owner' ? liRow({ icon: 'download', tone: 'gray', title: 'Backup, export or clear data', onclick: () => { s.close(); auzMyData(sb); } }) : null,
      liRow({ icon: 'logout', tone: 'gray', title: t('Sign out'), onclick: signOut })));
  const s = sheet({ title: t('More'), closeLabel: t('Done'), body });
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
function header(o, root) {
  const l = $('#tb-l'), t_ = $('#tb-t'), r = $('#tb-r'); if (!l) return;
  clear(l); clear(r);
  t_.textContent = o.title || '';
  document.title = (o.title ? o.title + ' · ' : '') + 'AUZsStyle';
  if (o.back) l.append(h('button', { class: 'btn plain', type: 'button', 'aria-label': 'Back', onclick: () => go(o.back) }, icon('chevL', 22)));
  else if (!isDesk()) l.append(h('button', { class: 'brandpill', type: 'button', onclick: moreSheet }, (S.ctx.settings && S.ctx.settings.logoUrl) ? h('img', { class: 'pill-logo', src: S.ctx.settings.logoUrl, alt: '' }) : icon('shirt', 16), h('b', null, (S.ctx.settings.shopName || (S.dash.tenant && S.dash.tenant.name) || 'AUZsStyle').slice(0, 18))));
  const desk = isDesk();
  (o.actions || []).filter(Boolean).forEach((a) => r.append(h('button', { class: 'btn ' + (desk ? (a.primary ? 'fill' : '') : 'plain') + (!desk ? ' icon' : ''), type: 'button', 'aria-label': a.label, title: a.label, onclick: a.run }, a.icon ? icon(a.icon, 20) : null, desk ? a.label : null)));
  if (root) { const old = root.querySelector(':scope > .large-title'); if (old) old.remove(); }
  if (!desk && root && !o.noLarge) root.prepend(h('h1', { class: 'large-title' }, o.title));
  if (!desk && !r.childNodes.length) r.append(h('span'));
}
document.addEventListener('DOMContentLoaded', () => { boot(); });
