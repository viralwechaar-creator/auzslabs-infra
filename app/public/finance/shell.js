/* AUZsFinance: shell (sign in, navigation, router). Pages register with page(). Same login/boot/router shape as AUZsStyle. */
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
const allowed = (def) => !!def && (!def.perm || can(def.perm));
const NAV = [['home', 'Today', 'home'], ['activity', 'Activity', 'swap'], ['dues', 'Dues', 'users'], ['owner', 'Owner & loans', 'wallet'], ['accounts', 'Accounts', 'cash'], ['reports', 'Reports', 'chart'], ['assets', 'Assets', 'building'], ['budget', 'Budget', 'tag'], ['approvals', 'Approvals', 'check'], ['repeat', 'Repeating', 'refresh'], ['bank', 'Bank import', 'download'], ['insights', 'Insights', 'bolt'], ['settings', 'Settings', 'gear']];
const navList = () => NAV.filter(([id]) => allowed(PAGES[id]));
const tabsFor = () => navList().slice(0, 4).map((x) => x[0]);

function showLogin(msg) {
  const e = h('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' });
  const p = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const m = h('div', { class: 'small', role: 'alert', style: { color: 'var(--red)', minHeight: '18px' } }, msg || '');
  const btn = h('button', { class: 'btn fill wide', type: 'submit' }, 'Sign in');
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
    h('div', { style: { fontWeight: 800, fontSize: '22px', letterSpacing: '-.02em' } }, 'AUZs', h('span', { style: { color: 'var(--accent)' } }, 'Finance')),
    h('h1', null, 'Sign in'), social, h('div', { class: 'seg full' }, bE, bS), emailWrap, staffWrap, m);
  clear($('#app')).append(h('div', { class: 'login' }, form));
  e.focus();
  if (CFG.googleClientId) auzGoogleLink(googleHost, 'finance');
}
function blocked(title, text) {
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'card' }, h('div', { style: { fontWeight: 800, fontSize: '20px' } }, 'AUZs', h('span', { style: { color: 'var(--accent)' } }, 'Finance')), h('h1', null, title), h('p', { class: 'muted' }, text),
    h('button', { class: 'btn wide', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sign out'))));
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

async function boot() {
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'spin', style: { color: 'var(--tint)', width: '28px', height: '28px' } })));
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  let dash, ctx;
  const ck = 'boot.' + (session.user.id || '');
  try {
    dash = await api('my_dashboard');
    const slug = window.TENANT_SLUG;
    if (slug && dash.tenant && dash.tenant.slug !== slug) { await sb.auth.signOut(); return showLogin('This login belongs to a different business (' + dash.tenant.slug + '.auzslab.in).'); }
    if (!(dash.features || {}).finance || (dash.enabled_features || {}).finance === false) return blocked('AUZsFinance', 'AUZsFinance is not part of your plan. Ask us to add it.');
    ctx = await api('fin_bootstrap');
    LS.set(ck, { dash, ctx });
  } catch (e) {
    if (e.status === 401) return showLogin('Your session ended. Please sign in again.');
    const c = e.net && LS.get(ck, null);
    if (!c) return blocked('Could not open AUZsFinance', e.message);
    dash = c.dash; ctx = c.ctx;
  }
  S.dash = dash; S.ctx = ctx; S.perms = ctx.perms || {};
  S.user = { email: ctx.email, role: ctx.role, id: session.user.id };
  buildShell();
  window.addEventListener('hashchange', route_);
  route_();
}
async function reloadCtx() { S.ctx = await api('fin_bootstrap'); S.perms = S.ctx.perms || {}; }
function navItem(id, label, ic) {
  if (!allowed(PAGES[id])) return null;
  return h('a', { href: '#/' + id, 'data-nav': id, class: 'nav-i', title: label }, icon(ic, 20), h('span', { class: 'lbl-t' }, label));
}
function buildShell() {
  const nav = navList();
  const side = h('aside', { class: 'side', 'aria-label': 'Sections' },
    h('div', { class: 'brand' }, icon('wallet', 28), h('div', { class: 'lbl-t grow' }, h('b', null, 'AUZsFinance'), h('span', null, S.dash.tenant ? S.dash.tenant.name : '')),
      h('button', { class: 'side-tg', type: 'button', 'aria-label': 'Toggle sidebar', onclick: () => $('#shell').classList.toggle('min') }, icon('sidebar', 20))),
    can('write') ? h('button', { class: 'nav-i add-side', type: 'button', onclick: () => addTxn() }, icon('plus', 20), h('span', { class: 'lbl-t' }, 'Add entry')) : null,
    nav.map(([id, l, ic]) => navItem(id, l, ic)),
    h('div', { class: 'foot' }, h('span', null, S.user.email),
      seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v), { full: true }),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => auzHelp.open(sb) }, 'Help'), h('button', { class: 'btn sm', type: 'button', onclick: signOut }, 'Sign out'))));
  const topbar = h('header', { class: 'topbar', id: 'topbar' }, h('div', { class: 'l', id: 'tb-l' }), h('div', { class: 'tt', id: 'tb-t' }), h('div', { class: 'r', id: 'tb-r' }));
  const tabs = tabsFor();
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    tabs.map((id) => { const n = NAV.find((x) => x[0] === id); return h('button', { type: 'button', 'data-tab': id, 'aria-label': n[1], title: n[1], onclick: () => go(id) }, icon(n[2], 24), h('span', null, n[1])); }),
    h('button', { type: 'button', 'data-tab': 'more', 'aria-label': 'More', title: 'More', onclick: moreSheet }, icon('more', 24), h('span', null, 'More')));
  const fab = can('write') ? h('button', { class: 'fab', type: 'button', 'aria-label': 'Add entry', title: 'Add entry', onclick: () => addTxn() }, icon('plus', 26)) : null;
  clear($('#app')).append(h('div', { class: 'shell', id: 'shell' }, side, h('div', { class: 'main' }, topbar, h('main', { id: 'main', tabindex: '-1' })), tabbar, fab));
  matchMedia('(min-width:900px)').addEventListener('change', () => route_());
}
function signOut() { sb.auth.signOut().then(() => location.reload()); }
function moreSheet() {
  const tabs = tabsFor(); const rest = navList().filter(([id]) => !tabs.includes(id));
  const body = h('div', { class: 'grid' },
    rest.length ? h('div', { class: 'list' }, rest.map(([id, l, ic]) => liRow({ icon: ic, title: l, chevron: true, onclick: () => { s.close(); go(id); } }))) : null,
    h('div', { class: 'list' }, liRow({ icon: 'moon', tone: 'gray', title: 'Appearance', badge: seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v)) })),
    h('div', { class: 'list' }, liRow({ icon: 'user', tone: 'gray', title: S.user.email, sub: S.user.role }),
      liRow({ icon: 'info', tone: 'gray', title: 'Help & report a problem', onclick: () => { s.close(); auzHelp.open(sb); } }),
      S.user.role === 'owner' ? liRow({ icon: 'download', tone: 'gray', title: 'Backup, export or clear data', onclick: () => { s.close(); auzMyData(sb); } }) : null,
      liRow({ icon: 'logout', tone: 'gray', title: 'Sign out', onclick: signOut })));
  const s = sheet({ title: 'More', closeLabel: 'Done', body });
}
async function route_() {
  closeMenus();
  cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanup = [];
  route = parseHash();
  let def = PAGES[route.id];
  if (!def || !allowed(def)) { route = { id: 'home', args: [], q: new URLSearchParams() }; def = PAGES.home; }
  const main = $('#main'); if (!main) return;
  const root = h('div', { class: 'page', 'data-p': route.id });
  clear(main).append(root);
  $$('[data-nav]').forEach((a) => a.removeAttribute('aria-current')); $$('[data-tab]').forEach((a) => a.removeAttribute('aria-current'));
  $(`[data-nav="${route.id}"]`)?.setAttribute('aria-current', 'page');
  const tab = tabsFor().includes(route.id) ? route.id : 'more'; $(`[data-tab="${tab}"]`)?.setAttribute('aria-current', 'page');
  const nm = (NAV.find((x) => x[0] === route.id) || [0, route.id])[1];
  const view = { id: route.id, args: route.args, q: route.q, root, header: (o) => header(o, root), refresh: () => route_(), onLeave: (f) => cleanup.push(f) };
  try { header({ title: nm }, root); await def.render(view); } catch (e) {
    console.error(e); clear(root).append(empty('alert', 'Something went wrong', e.message, h('button', { class: 'btn fill', onclick: route_ }, 'Try again')));
  }
  main.focus({ preventScroll: true }); window.scrollTo(0, 0);
}
function header(o, root) {
  const l = $('#tb-l'), t_ = $('#tb-t'), r = $('#tb-r'); if (!l) return;
  clear(l); clear(r);
  t_.textContent = o.title || '';
  document.title = (o.title ? o.title + ' · ' : '') + 'AUZsFinance';
  if (o.back) l.append(h('button', { class: 'btn plain', type: 'button', 'aria-label': 'Back', onclick: () => go(o.back) }, icon('chevL', 22)));
  else if (!isDesk()) l.append(h('button', { class: 'brandpill', type: 'button', onclick: moreSheet }, icon('wallet', 16), h('b', null, ((S.dash.tenant && S.dash.tenant.name) || 'AUZsFinance').slice(0, 18))));
  const desk = isDesk();
  (o.actions || []).filter(Boolean).forEach((a) => r.append(h('button', { class: 'btn ' + (desk ? (a.primary ? 'fill' : '') : 'plain') + (!desk ? ' icon' : ''), type: 'button', 'aria-label': a.label, title: a.label, onclick: a.run }, a.icon ? icon(a.icon, 20) : null, desk ? a.label : null)));
  if (root) { const old = root.querySelector(':scope > .large-title'); if (old) old.remove(); }
  if (!desk && root && !o.noLarge) root.prepend(h('h1', { class: 'large-title' }, o.title));
}
document.addEventListener('DOMContentLoaded', () => { boot(); });
