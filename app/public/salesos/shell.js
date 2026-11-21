/* AUZslab SalesOS: shell (sign in, navigation, router). Pages register themselves with page().
   Two tiers share one app: field staff (Sales Executive) see the hands-on pages; managers
   (Sales Manager, Admin) see a consolidated Team overview + Audit log instead of duplicating
   every field screen with manager actions bolted on. Dashboard and Messages are for everyone.
   An owner (platform admin signed in directly) sees both tiers. */
'use strict';
const PAGES = {};
const page = (id, def) => { PAGES[id] = def; };
let route = { id: 'dashboard', args: [], q: new URLSearchParams() };
let cleanup = [];

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { id: parts[0] || 'dashboard', args: parts.slice(1), q: new URLSearchParams(qs || '') };
}
const go = (path) => { const t = '#/' + path.replace(/^#?\/?/, ''); if (location.hash === t) route_(); else location.hash = t; };
function allowed(def) {
  if (!def) return false;
  if (def.any) return true;
  if (def.field) return canField();
  if (def.manage) return canManage();
  return true;
}
function tabsFor() {
  if (canField()) return ['dashboard', 'field', 'leads', 'messages'];
  if (canManage()) return ['dashboard', 'team', 'audit', 'messages'];
  return ['dashboard', 'messages'];
}
function moreItems() {
  const tabs = tabsFor();
  const ordered = canField() ? ['dashboard', 'field', 'leads', 'demos', 'surveys', 'expenses', 'tasks', 'messages'].concat(canManage() ? ['team', 'audit'] : [])
    : canManage() ? ['dashboard', 'team', 'audit', 'messages'] : ['dashboard', 'messages'];
  return ordered.filter((id) => !tabs.includes(id) && allowed(PAGES[id]));
}

// ---------- sign in ----------
function showLogin(msg) {
  const e = h('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' });
  const p = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const m = h('div', { class: 'small', role: 'alert', style: { color: 'var(--red)', minHeight: '18px' } }, msg || '');
  const eyeBtn = h('button', { type: 'button', class: 'btn icon plain', 'aria-label': 'Show password', style: { position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)' } }, icon('eye', 18));
  eyeBtn.onclick = () => { const showing = p.type === 'text'; p.type = showing ? 'password' : 'text'; eyeBtn.replaceChildren(icon(showing ? 'eye' : 'eyeOff', 18)); };
  const pwWrap = h('div', { style: { position: 'relative' } }, p, eyeBtn);
  const btn = h('button', { class: 'btn fill wide', type: 'submit' }, 'Sign in');
  btn.onclick = async (ev) => {
    ev.preventDefault(); btn.disabled = true; m.textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: e.value.trim(), password: p.value });
    btn.disabled = false;
    if (error) { m.textContent = error.message; } else boot();
  };
  const googleHost = h('div');
  const socialDivider = h('div', { class: 'small muted', style: { display: 'none', textAlign: 'center' } }, 'or');
  const form = h('form', { class: 'card', onsubmit: (ev) => ev.preventDefault() },
    h('img', { src: '/icon-auzslab-192.png', alt: 'AUZslab', style: { height: '44px', width: '44px', borderRadius: '10px' } }),
    h('h1', null, 'SalesOS'), h('p', { class: 'muted' }, 'Sign in with the login AUZslab gave you.'),
    googleHost, socialDivider, e, pwWrap, btn, m);
  clear($('#app')).append(h('div', { class: 'login' }, form));
  e.focus();
  if (CFG.googleClientId) { socialDivider.style.display = 'block'; auzGoogleLink(googleHost, 'salesos'); }
}
function blocked(title, text) {
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'card' },
    h('img', { src: '/icon-auzslab-192.png', alt: 'AUZslab', style: { height: '44px', width: '44px', borderRadius: '10px' } }),
    h('h1', null, title), h('p', { class: 'muted' }, text),
    h('button', { class: 'btn wide', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sign out'))));
}
async function boot() {
  clear($('#app')).append(h('div', { class: 'login' }, h('div', { class: 'spin', style: { color: 'var(--tint)', width: '28px', height: '28px' } })));
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  let dash;
  try { dash = await api('my_dashboard'); } catch (e) { if (e.status === 401) return showLogin('Your session ended. Please sign in again.'); return blocked('Could not load', e.message); }
  if (!(dash.features || {}).salesos) return blocked('SalesOS is not enabled', 'This login is not part of the AUZslab internal sales team. Ask an admin to check your account.');
  S.dash = dash; S.user = { email: dash.my_email, role: dash.my_role };
  if (window.auzBrandLoad) auzBrandLoad(sb);
  buildShell();
  window.addEventListener('hashchange', route_);
  route_();
  loadNotifLoop();
}

// ---------- shell ----------
const sidePref = () => { try { return localStorage['sos.side'] || ''; } catch { return ''; } };
function toggleSide() {
  const sh = $('#shell'), mini = sh.classList.contains('min') || (!sh.classList.contains('full') && !matchMedia('(min-width:1200px)').matches);
  try { localStorage['sos.side'] = mini ? 'full' : 'min'; } catch { /* private mode */ }
  sh.classList.remove('min', 'full'); sh.classList.add(mini ? 'full' : 'min');
}
function navItem(id) {
  const p = PAGES[id]; if (!allowed(p)) return null;
  return h('a', { href: '#/' + id, 'data-nav': id, class: 'nav-i', title: p.title }, icon(p.icon, 20), h('span', { class: 'lbl-t' }, p.navTitle || p.title),
    id === 'messages' ? h('span', { class: 'cnt hidden', id: 'navUnread' }) : null);
}
function buildShell() {
  const groups = canField()
    ? [{ group: '', items: ['dashboard'] }, { group: 'My work', items: ['field', 'leads', 'demos', 'surveys', 'expenses', 'tasks'] }, { group: '', items: ['messages'] }]
    : [{ group: '', items: ['dashboard'] }, { group: '', items: ['messages'] }];
  const manageGroup = canManage() ? [{ group: 'Manage', items: ['team', 'audit'] }] : [];
  const side = h('aside', { class: 'side', 'aria-label': 'Sections' },
    h('div', { class: 'brand' }, h('img', { src: '/icon-auzslab-192.png', alt: '', width: 30, height: 30, style: { borderRadius: '8px' } }),
      h('div', { class: 'lbl-t grow' }, h('b', null, 'SalesOS'), h('span', null, 'AUZslab internal')),
      h('button', { class: 'side-tg', type: 'button', title: 'Collapse or expand the sidebar', 'aria-label': 'Collapse or expand the sidebar', onclick: toggleSide }, icon('sidebar', 20))),
    [...groups, ...manageGroup].map((g) => { const items = g.items.map((i) => navItem(i)).filter(Boolean); return items.length ? [g.group ? h('div', { class: 'gh' }, h('span', { class: 'lbl-t' }, g.group)) : null, items] : null; }),
    h('div', { class: 'foot' }, h('span', null, S.user.email), h('span', null, roleLabel()),
      seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet ? auzThemeGet() : 'system', (v) => auzTheme && auzTheme(v), { full: true }),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, h('button', { class: 'btn sm', type: 'button', onclick: signOut }, 'Sign out'))));
  const topbar = h('header', { class: 'topbar', id: 'topbar' }, h('div', { class: 'l', id: 'tb-l' }), h('div', { class: 'tt', id: 'tb-t', 'aria-live': 'polite' }), h('div', { class: 'r', id: 'tb-r' }));
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    tabsFor().map((id) => PAGES[id] && allowed(PAGES[id]) ? h('button', { type: 'button', 'data-tab': id, onclick: () => go(id) }, icon(PAGES[id].icon, 23), h('span', null, PAGES[id].tabLabel || PAGES[id].title),
      id === 'messages' ? h('span', { class: 'cnt hidden', id: 'tabUnread' }) : null) : null),
    h('button', { type: 'button', 'data-tab': 'more', onclick: moreSheet }, icon('more', 23), h('span', null, 'More')));
  clear($('#app')).append(h('div', { class: 'shell' + (sidePref() ? ' ' + sidePref() : ''), id: 'shell' }, side, h('div', { class: 'main' }, topbar, h('main', { id: 'main', tabindex: '-1' })), tabbar));
  document.addEventListener('keydown', globalKeys);
}
const roleLabel = () => S.user.role === 'owner' ? 'Owner' : cap1(S.user.role);
function signOut() { sb.auth.signOut().then(() => location.reload()); }
function moreSheet() {
  const items = moreItems();
  const body = h('div', { class: 'grid' },
    items.length ? section('More', h('div', { class: 'list' }, items.map((i) => liRow({ icon: PAGES[i].icon, title: PAGES[i].title, chevron: true, onclick: () => { s.close(); go(i); } })))) : null,
    h('div', { class: 'list' }, liRow({ icon: 'moon', tone: 'gray', title: 'Appearance', badge: seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet ? auzThemeGet() : 'system', (v) => auzTheme && auzTheme(v)) })),
    h('div', { class: 'list' }, liRow({ icon: 'user', tone: 'gray', title: S.user.email, sub: roleLabel() }), liRow({ icon: 'logout', tone: 'gray', title: 'Sign out', onclick: signOut })));
  const s = sheet({ title: 'More', closeLabel: 'Done', body, noFocus: true });
}
function globalKeys(e) {
  const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
}

// ---------- notifications (poll every 30s while the app is open) ----------
let notifTimer = null;
async function loadNotifLoop() {
  await refreshNotif();
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = setInterval(refreshNotif, 30000);
}
async function refreshNotif() {
  let rows; try { rows = await api('sos_my_notifications', { p_unread_only: true }); } catch { return; }
  const n = rows.length;
  $$('#navUnread,#tabUnread,#bellDot').forEach((el) => { el.classList.toggle('hidden', !n); el.textContent = n > 9 ? '9+' : String(n); });
}
function notifPanel() {
  api('sos_my_notifications', { p_unread_only: false }).then((rows) => {
    const panel = h('div', { class: 'notifpanel' },
      h('div', { class: 'notifhead' }, h('b', null, 'Notifications'), h('button', { class: 'btn plain sm', type: 'button', onclick: async () => { await api('sos_notifications_mark_all_read'); close(); refreshNotif(); } }, 'Mark all read')),
      rows.length ? rows.map((n) => h('div', { class: 'notifitem' + (n.read_at ? '' : ' unread') }, h('b', null, n.title), n.body ? h('div', { class: 'nbody' }, n.body) : null, h('div', { class: 'small muted', style: { marginTop: '4px' } }, relTime(n.created_at))))
        : h('div', { class: 'notifitem muted' }, 'No notifications.'));
    document.body.append(panel);
    const close = () => { panel.remove(); document.removeEventListener('pointerdown', outside, true); };
    function outside(e) { if (!panel.contains(e.target) && e.target.id !== 'bellBtn' && !panel.contains(e.target.closest && e.target.closest('#bellBtn'))) close(); }
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  });
}

// ---------- router ----------
async function route_() {
  closeMenus();
  cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanup = [];
  route = parseHash();
  let def = PAGES[route.id];
  if (!def || !allowed(def)) { route = { id: 'dashboard', args: [], q: new URLSearchParams() }; def = PAGES[route.id]; }
  const main = $('#main'); if (!main) return;
  const root = h('div', { class: 'page' }, h('div', { class: 'skel', style: { height: '44px', width: '55%' } }), h('div', { class: 'skel', style: { height: '120px' } }), h('div', { class: 'skel', style: { height: '220px' } }));
  clear(main).append(root);
  $$('[data-nav]').forEach((a) => a.removeAttribute('aria-current')); $$('[data-tab]').forEach((a) => a.removeAttribute('aria-current'));
  $(`[data-nav="${route.id}"]`)?.setAttribute('aria-current', 'page');
  const tab = tabsFor().includes(route.id) ? route.id : 'more'; $(`[data-tab="${tab}"]`)?.setAttribute('aria-current', 'page');
  if (!allowed(def)) { header({ title: def.title }); clear(root).append(empty('lock', 'No access', 'Your role does not include ' + def.title.toLowerCase() + '.')); return; }
  const view = { id: route.id, args: route.args, q: route.q, root, header: (o) => header(o, root), refresh: () => route_(), onLeave: (f) => cleanup.push(f) };
  try { clear(root); header({ title: def.title }, root); await def.render(view); } catch (e) {
    console.error(e); clear(root).append(empty('alert', 'Could not load this page', e.message, h('button', { class: 'btn fill', onclick: route_ }, 'Try again')));
  }
  main.focus({ preventScroll: true }); window.scrollTo(0, 0);
}
function header(o, root) {
  const l = $('#tb-l'), t = $('#tb-t'), r = $('#tb-r'); if (!l) return;
  clear(l); clear(r);
  t.textContent = o.title || '';
  document.title = (o.title ? o.title + ' · ' : '') + 'AUZslab SalesOS';
  if (o.back) l.append(h('button', { class: 'btn plain', type: 'button', 'aria-label': 'Back', onclick: () => (typeof o.back === 'function' ? o.back() : go(o.back)) }, icon('chevL', 22), h('span', { class: 'desk-only' }, 'Back')));
  const bellBtn = h('button', { class: 'btn icon plain bellbtn', type: 'button', id: 'bellBtn', 'aria-label': 'Notifications', onclick: notifPanel }, icon('bell', 20), h('span', { class: 'bellbadge hidden', id: 'bellDot' }));
  r.append(bellBtn);
  const desk = isDesk();
  const acts = (o.actions || []).filter(Boolean);
  const mk = (a) => h('button', { class: 'btn ' + (desk ? (a.primary ? 'fill' : '') : 'plain') + (a.danger ? ' danger' : '') + (!desk && a.icon ? ' icon' : ''), type: 'button', 'aria-label': a.label, title: a.label, onclick: (ev) => (a.menu ? menu(ev.currentTarget, a.menu) : a.run()) }, a.icon ? icon(a.icon, 20) : null, desk || !a.icon ? a.label : null);
  acts.forEach((a) => r.append(mk(a)));
  if (root) $$('#large-title,.page-sub', root).forEach((x) => x.remove());
  if (!desk && root && !o.noLarge) {
    root.prepend(...[h('h1', { class: 'large-title', id: 'large-title' }, o.title), o.sub ? h('p', { class: 'page-sub' }, o.sub) : null].filter(Boolean));
    const tb = $('#topbar'); tb.classList.remove('scrolled');
    const lt = $('#large-title', root);
    if (lt && 'IntersectionObserver' in window) { const io = new IntersectionObserver(([en]) => tb.classList.toggle('scrolled', !en.isIntersecting), { rootMargin: '-56px 0px 0px 0px' }); io.observe(lt); cleanup.push(() => io.disconnect()); }
  } else if (desk && root && o.sub) root.prepend(h('p', { class: 'muted', style: { marginTop: '-10px' } }, o.sub));
}

document.addEventListener('DOMContentLoaded', () => { boot(); });
