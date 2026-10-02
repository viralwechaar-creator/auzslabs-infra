/* Shell: navigation (sidebar on desktop, tab bar on phones), banners (QR orders, ready, out for delivery),
   alert sounds, sign in, start-up. Loaded last. */
'use strict';
function navItems() {
  const r = isRestaurant(), pos = can('pos') && featureOn('pos'), kds = can('kitchen') && featureOn('kds') && !isRetail();
  return [
    pos && r && L('table').length ? { k: 'tables', label: 'Tables', ic: 'tables' } : null,
    pos ? { k: 'sell', label: 'Sell', ic: 'sell' } : null,
    can('orders') ? { k: 'orders', label: 'Orders', ic: 'orders' } : null,
    kds ? { k: 'kitchen', label: 'Kitchen', ic: 'kitchen', tone: 'orange' } : null,
    pos && r ? { k: 'reserve', label: 'Reservations', ic: 'reserve', tone: 'blue' } : null,
    pos ? { k: 'register', label: 'Register', ic: 'register', tone: 'green' } : null,
    kds && r ? { k: 'kotrep', label: 'KOT report', ic: 'kot', tone: 'orange', grp: 'more' } : null,
    can('kitchen') && cfg().hwToken ? { k: 'token', label: 'Token board', ic: 'token', tone: 'purple', grp: 'more' } : null,
    { k: 'more', label: 'More', ic: 'more', grp: 'more' },
  ].filter(Boolean);
}
const tabBarItems = (navs) => { const main = navs.filter((n) => n.k !== 'more' && !n.grp); return [...main.slice(0, 4), navs.find((n) => n.k === 'more')]; };
function defaultTab(navs) {
  let saved = null; try { saved = localStorage['pos.tab']; } catch {}
  if (saved && navs.some((n) => n.k === saved)) return saved;
  return (navs[0] || { k: 'more' }).k;
}
function go(tab) { S.tab = tab; try { localStorage['pos.tab'] = tab; } catch {} closeTicketSheet(); render(); const b = $('#body'); if (b && !V[tab].fixed) b.scrollTop = 0; }
const navBadge = (k) => { if (k === 'kitchen') return L('order').filter((o) => o.status !== 'void' && o.kstat === 'new').length; if (k === 'orders') return G.length; return 0; };

// the wordmark is ink on a light page; dark mode swaps in the white-type lockup
const posLogo = () => h('picture', null, h('source', { media: '(prefers-color-scheme: dark)', srcset: '/logo-pos-light.svg' }), h('img', { src: '/logo-pos.svg', alt: 'AUZslab POS' }));
function sideNav(navs) {
  const main = navs.filter((n) => !n.grp), more = navs.filter((n) => n.grp && n.k !== 'more');
  const btn = (n) => h('button', { class: S.tab === n.k ? 'on' : '', 'data-nav': n.k, 'aria-current': S.tab === n.k ? 'page' : null, onclick: () => go(n.k) }, icon(n.ic, 20), h('span', { class: 'grow ellip' }, n.label), navBadge(n.k) ? h('span', { class: 'badge' }, String(navBadge(n.k))) : null);
  return h('aside', { class: 'side' },
    h('div', { class: 'brand' }, posLogo()),
    h('nav', { class: 'nav', 'aria-label': 'Main' }, main.map(btn), more.length ? h('div', { class: 'grp' }, 'More') : null, more.map(btn), btn({ k: 'more', label: 'Staff & settings', ic: 'staff' })),
    h('div', { class: 'foot' }, L('outlet').length ? h('button', { onclick: pickOutlet }, icon('building', 16), outletName()) : null,
      S.role === 'owner' || S.role === 'manager' ? h('button', { onclick: () => (location.href = '/dashboard.html') }, icon('home', 16), 'Admin console') : null,
      h('div', { class: 'who ellip' }, myName() + ' · ' + cap1(S.role))));
}
function tabBar(navs) {
  return h('nav', { class: 'tabbar', 'aria-label': 'Main' }, tabBarItems(navs).filter(Boolean).map((n) => h('button', { class: S.tab === n.k || (n.k === 'more' && !tabBarItems(navs).some((x) => x && x.k === S.tab)) ? 'on' : '', 'data-tab': n.k, 'aria-current': S.tab === n.k ? 'page' : null, onclick: () => go(n.k) },
    icon(n.ic, 24, 1.7), h('span', null, n.label), navBadge(n.k) ? h('span', { class: 'badge' }, String(navBadge(n.k))) : null)));
}
function navbar(navs) {
  const n = navs.find((x) => x.k === S.tab) || { label: 'AUZslab' };
  return h('header', { class: 'navbar' }, h('div', { class: 'title grow ellip' }, S.tab === 'sell' && S.cur && S.cur.table ? 'Sell · ' + tn(S.cur.table) : n.label === 'More' ? 'More' : n.label),
    h('span', { id: 'net', class: 'status' }),
    h('button', { class: 'iconbtn', 'aria-label': 'Notifications', onclick: () => (location.href = 'https://auzslab.in/account.html#notifications') }, icon('bell', 22), h('span', { id: 'notifCount', class: 'dot hidden' })));
}

// ---------- render ----------
function render() {
  if (S.authExpired || !S.user) return login('Your session ended. Please sign in again.');
  applyTheme(); freshCur();
  const navs = navItems();
  if (!navs.some((n) => n.k === S.tab)) S.tab = defaultTab(navs);
  const view = V[S.tab] || V.more, keep = {};
  for (const sel of ['#body', '.items-scroll', '.cats-col', '.tk-lines']) { const e = $('#app ' + sel); if (e) keep[sel] = e.scrollTop; }
  const banners = [standaloneBanner(), guestBanner(), readyBanner(), dispatchedBanner()].filter(Boolean);
  $('#app').replaceChildren(h('div', { class: 'shell' }, sideNav(navs),
    h('div', { class: 'main' }, navbar(navs), banners.length ? h('div', { class: 'banners' }, banners) : null,
      h('main', { class: 'body' + (view.fixed ? ' fixed' : ''), id: 'body' }, view()), tabBar(navs))));
  for (const sel in keep) { const e = $('#app ' + sel); if (e) e.scrollTop = keep[sel]; }
  setNote(); refreshNotifCount(); refreshTicketSheet();
}

// ---------- QR orders (guest_orders): accepted exactly once, even with several tills open ----------
let G = [];
async function getG() {
  if (!navigator.onLine || !S.user) return;
  if (!featureOn('self_order')) { if (G.length) { G = []; render(); } return; }
  const { data, error } = await sb.from('guest_orders').select('*').eq('status', 'new').order('created_at'); if (error) return;
  const prev = new Set(G.map((g) => g.id)); G = data || [];
  const arrived = G.filter((g) => !prev.has(g.id));
  if (arrived.length) alertSound(arrived.some((g) => g.note === 'Waiter called') ? 'waiter' : 'guest');
  if ((arrived.length || prev.size !== G.length) && !isTyping()) render();
}
async function claimG(g, st) {
  const { data, error } = await sb.rpc('claim_guest_order', { p_id: g.id, p_status: st });
  if (error) { toast(error.message, { err: true }); return false; }
  if (!data) { toast('Another till already handled this'); getG(); return false; }
  return true;
}
async function acceptG(g) {
  if (!(g.items && g.items.length)) { if (await claimG(g, 'done')) toast('Got it'); return getG(); } // a waiter call has nothing to cook
  if (!(await claimG(g, 'done'))) return;
  const ex = tableOrder(g.tbl), o = ex ? structuredClone(ex) : newOrder({ type: 'Dine-in', table: g.tbl }), gone = [];
  g.items.forEach((i) => {
    const it = rec(i.id); if (!it) { gone.push(i.name || 'item'); return; }
    const sz = i.size && (it.sizes || []).find((s) => s.l === i.size), price = sz ? sz.p : it.price;
    const l = o.lines.find((x) => x.id === i.id && (x.size || '') === (i.size || '') && x.price === price && !x.note);
    if (l) l.qty += i.qty; else o.lines.push({ id: i.id, name: it.name, size: i.size || '', price, qty: i.qty, sent: 0, st: it.st || 'Kitchen' });
  });
  if (!(o.cust && (o.cust.name || o.cust.phone))) o.cust = { name: g.name, phone: g.phone };
  if (g.note) o.gn = g.note;
  o.src = o.src || 'QR';
  if (gone.length) toast('Not on the menu any more, left out: ' + gone.join(', '), { err: true });
  if (!o.no) o.no = await nextNo();
  const kno = await nextKot(), n = mk(o, kno);
  await persist(o);
  if (n.length) { await save('kotlog', { orderId: o.id, orderNo: o.no, kotNo: kno, type: o.type, table: o.table, cust: o.cust, items: n, createdAt: now() }, uid()); if (cfg().autoKot !== false) prn(kotHtml(o, n, { no: kno })); }
  if (S.cur && S.cur.id === o.id) S.cur = structuredClone(o); // the cashier has this order open: refresh it so the next save keeps the guest's items
  toast('Sent to kitchen · ' + (tn(o.table) || o.no)); getG(); render();
}
function guestBanner() {
  if (!G.length) return null;
  return h('div', { class: 'stack s8' }, G.map((g) => { const call = !(g.items && g.items.length);
    return h('div', { class: 'banner', style: { borderLeft: '4px solid var(--accent)' } }, icon(call ? 'bell' : 'qr', 22),
      h('div', { class: 'grow' }, h('b', null, (tn(g.tbl) || 'Table') + (call ? ' · waiter called' : ' · QR order')), h('span', { class: 'small sub' }, [g.name, g.phone, call ? null : g.items.map((i) => i.qty + '× ' + (i.name || '') + (i.size ? ' (' + i.size + ')' : '')).join(', '), g.note && g.note !== 'Waiter called' ? '"' + g.note + '"' : null].filter(Boolean).join(' · '))),
      h('button', { class: 'btn sm fill', onclick: () => acceptG(g) }, call ? 'Got it' : 'Accept'), call ? null : h('button', { class: 'btn sm', onclick: async () => { if (await claimG(g, 'rejected')) toast('Rejected'); getG(); } }, 'Reject')); }));
}
let hintClosed = false;
function standaloneBanner() {
  // iOS Safari in a normal tab always shows its own toolbars: tell staff to open the saved Home Screen app instead
  if (navigator.standalone !== false || hintClosed) return null;
  try { if (sessionStorage.getItem('auz_standalone_hint_dismissed')) return null; } catch {}
  return h('div', { class: 'banner info' }, icon('phone', 20), h('span', { class: 'grow small' }, 'For the full-screen app, open AUZslab from its icon on your Home Screen.'), h('button', { class: 'iconbtn', 'aria-label': 'Dismiss', onclick: () => { hintClosed = true; try { sessionStorage.setItem('auz_standalone_hint_dismissed', '1'); } catch {} render(); } }, icon('x', 18)));
}

// ---------- sounds: each event has its own pattern ----------
const ALERT_TONES = { kot: { freqs: [880], reps: 3, gap: 0.45, vib: [200, 100, 200, 100, 200] }, ready: { freqs: [660, 990], reps: 2, gap: 0.3, vib: [150, 80, 150, 80, 300] }, guest: { freqs: [523, 659, 784], reps: 1, gap: 0.15, vib: [100, 60, 100, 60, 100, 60, 200] }, waiter: { freqs: [440, 349], reps: 3, gap: 0.28, vib: [300, 150, 300, 150, 300, 150, 300] } };
function alertSound(kind = 'kot') {
  const c = ALERT_TONES[kind] || ALERT_TONES.kot;
  try { const a = new (window.AudioContext || window.webkitAudioContext)(); let t = a.currentTime; for (let r = 0; r < c.reps; r++) for (const f of c.freqs) { const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(a.destination); g.gain.value = 0.001; g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + c.gap - 0.05); o.start(t); o.stop(t + c.gap); t += c.gap; } } catch {}
  try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(c.vib); } catch {}
}
// tickets already waiting when the app opens are noted silently; only new arrivals make a sound
const seenNew = new Set(), seenReady = new Set(); let alertsPrimed = false;
function checkAlerts() {
  for (const o of L('order')) {
    if (o.status === 'void') continue;
    if (o.kstat === 'new') { if (!seenNew.has(o.id)) { seenNew.add(o.id); if (alertsPrimed && can('kitchen')) alertSound('kot'); } } else seenNew.delete(o.id);
    if (o.kstat === 'ready') { if (!seenReady.has(o.id)) { seenReady.add(o.id); if (alertsPrimed) alertSound('ready'); } } else seenReady.delete(o.id);
  }
  alertsPrimed = true;
}
async function refreshNotifCount() { try { const { data } = await sb.from('notifications').select('id').eq('read', false); const el = $('#notifCount'); if (el) { el.textContent = data && data.length ? String(data.length) : ''; el.classList.toggle('hidden', !(data && data.length)); } } catch {} }

// ---------- sign in, start ----------
function login(msg) {
  const e = h('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' }), p = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const m = h('div', { class: 'hint' + (msg ? ' err' : '') }, msg || '');
  const go1 = async () => { m.className = 'hint'; m.textContent = 'Signing in…'; const { error } = await sb.auth.signInWithPassword({ email: e.value.trim(), password: p.value }); if (error) { m.className = 'hint err'; m.textContent = error.message; } else boot(); };
  p.onkeydown = (ev) => { if (ev.key === 'Enter') go1(); };
  $('#app').replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' }, posLogo(), h('h2', null, 'Sign in'), h('p', { class: 'sub' }, 'Use the email and password your business gave you.'), e, p, m, h('button', { class: 'btn fill lg wide', onclick: go1 }, 'Sign in'))));
}
async function seed() { localStorage.seeded = 1; const c = uid(); await save('cat', { name: 'Tea', n: 1 }, c); await save('item', { name: 'Masala Tea', cat: c, price: 25, sizes: [] }); await save('item', { name: 'Coffee', cat: c, price: 49, sizes: [{ l: 'M', p: 29 }, { l: 'L', p: 49 }] }); for (let i = 1; i <= 6; i++) await save('table', { name: 'T' + i }); }
async function loadStaffList() { try { const { data } = await sb.from('profiles').select('id,email,name'); STAFF_LIST = data || []; render(); } catch {} }
let booted = false;
async function boot() {
  if (!C.url || C.url.includes('YOUR-PROJECT')) return $('#app').replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' }, h('h2', null, 'Setup needed'), h('p', null, 'Open config.js and add the API address.'))));
  navigator.storage && navigator.storage.persist && navigator.storage.persist();
  navigator.serviceWorker && navigator.serviceWorker.register('/sw.js');
  let c = JSON.parse(localStorage.u || 'null'), ses = null; try { ses = (await sb.auth.getSession()).data.session; } catch {}
  const id = ses ? ses.user.id : c && c.id;
  if (id) { const meta = await get('meta', 'lastUser'); if (meta && meta.v && meta.v !== id) { await clr('rec'); await clr('out'); await del('meta', 'since'); } await put('meta', { k: 'lastUser', v: id }); }
  (await all('rec')).forEach((r) => (R[r.id] = r));
  if (ses) { S.user = ses.user; try { const { data } = await sb.from('profiles').select('role,role_id').eq('id', ses.user.id).single(); if (data) localStorage.u = JSON.stringify((c = { id: ses.user.id, role: data.role, role_id: data.role_id })); } catch {} } else if (c) S.user = { id: c.id };
  if (!S.user) return login();
  S.role = (c && c.role) || 'cashier'; S.role_id = (c && c.role_id) || null; S.perms = null;
  if (S.role_id) { try { const { data } = await sb.from('roles').select('permissions').eq('id', S.role_id).single(); S.perms = data && data.permissions; } catch {} }
  S.features = null; S.enabledFeatures = {}; let dash = null; try { dash = (await sb.rpc('my_dashboard')).data; } catch {}
  // one email is one login across every business: refuse a login from another business's address instead of showing it under this one's branding
  if (dash && window.TENANT_SLUG && dash.tenant && dash.tenant.slug !== window.TENANT_SLUG) { await sb.auth.signOut(); S.user = null; localStorage.removeItem('u'); return login('This login belongs to a different business (' + dash.tenant.slug + '.auzslab.in). Sign in at your own business\'s link.'); }
  if (dash && dash.features) { S.features = dash.features; S.enabledFeatures = dash.enabled_features || {}; }
  let askedTab = null; try { const q = new URLSearchParams(location.search).get('tab'); const map = { pos: 'sell', tabs: 'orders', kds: 'kitchen', staff: 'more' }; if (q) askedTab = map[q] || q; } catch {}
  S.authExpired = false; $('#app').replaceChildren(h('div', { class: 'login' }, h('div', { class: 'sub' }, 'Loading…')));
  if (!booted) {
    booted = true;
    addEventListener('online', () => { sync(); setNote(); }); addEventListener('offline', setNote);
    sb.channel('r').on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, () => sync()).subscribe();
    sb.channel('g').on('postgres_changes', { event: '*', schema: 'public', table: 'guest_orders' }, () => getG()).subscribe();
    sb.channel('n').on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => refreshNotifCount()).subscribe();
    setInterval(sync, 30000); setInterval(getG, 15000); setInterval(refreshNotifCount, 60000); setInterval(checkAlerts, 5000);
    setInterval(() => { if (navigator.onLine && S.user && isRestaurant()) loadBookings(today()).then(() => { if ((S.tab === 'tables' || S.tab === 'reserve') && !isTyping()) render(); }); }, 120000);
    // live clocks without rebuilding the screen (a full redraw every second used to swallow taps)
    setInterval(() => { $$('[data-kt]').forEach((e) => (e.textContent = clockText(e.dataset.kt))); }, 1000);
    setInterval(() => { $$('[data-since]').forEach((e) => (e.textContent = minsSince(e.dataset.since) + ' min')); }, 30000);
  }
  await syncNow(); getG(); checkAlerts();
  if (can('o') && !L('cat').length && !localStorage.seeded) await seed();
  S.tab = askedTab && navItems().some((n) => n.k === askedTab) ? askedTab : defaultTab(navItems());
  if (isRestaurant()) loadBookings(today()).then(() => { if (S.tab === 'tables' && !isTyping()) render(); });
  loadStaffList(); loadPinStatus();
  render();
}
boot();
