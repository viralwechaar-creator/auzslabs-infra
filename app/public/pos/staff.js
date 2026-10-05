/* More: attendance, the manager approval PIN, this device (outlet, notifications), staff manual and recipes,
   links to the back office tools, sign out. On phones it also lists the screens that are not in the tab bar. */
'use strict';
V.more = () => {
  const navs = navItems(), tabKeys = tabBarItems(navs).map((n) => n.k), extra = navs.filter((n) => !tabKeys.includes(n.k) && n.k !== 'more');
  const sh = L('shift').filter((x) => x.u === S.user.id).sort((a, b) => (b.in > a.in ? 1 : -1)), mine = sh.find((x) => !x.out);
  const ps = S.pinStatus, rq = (S.recipeQ || '').toLowerCase(), recipes = L('item').filter((i) => i.recipeText && (!rq || i.name.toLowerCase().includes(rq)));
  const links = [];
  if (S.role === 'owner' || S.role === 'manager') {
    links.push(liRow({ ic: 'chart', tone: 'blue', title: 'Reports', chev: true, onclick: () => (location.href = '/backoffice.html?tab=rep') }), liRow({ ic: 'home', tone: 'purple', title: 'Admin console', chev: true, onclick: () => (location.href = '/dashboard.html') }), liRow({ ic: 'building', tone: 'gray', title: 'Back office', chev: true, onclick: () => (location.href = '/backoffice.html') }));
    if (featureOn('accounting') && S.features && S.features.accounting) links.push(liRow({ ic: 'receipt', tone: 'green', title: 'Accounting', chev: true, onclick: () => (location.href = '/accounts.html') }));
    if (can('o') && featureOn('website_builder')) links.push(liRow({ ic: 'globe', tone: 'teal', title: 'Website builder', chev: true, onclick: () => (location.href = '/builder.html') }));
  }
  return h('div', { class: 'page', style: { maxWidth: '760px' } },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'More'), h('div', { class: 'sub' }, myName() + ' · ' + cap1(S.role)))),
    extra.length ? h('div', { class: 'list only-phone' }, extra.map((n) => liRow({ ic: n.ic, tone: n.tone || 'gray', title: n.label, chev: true, onclick: () => go(n.k) }))) : null,
    h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Attendance')), h('div', { class: 'list' },
      liRow({ ic: 'clock', tone: mine ? 'green' : 'gray', title: mine ? 'On shift since ' + fmtTime(mine.in) : 'Not clocked in', right: h('button', { class: 'btn sm ' + (mine ? '' : 'fill'), onclick: async () => { if (mine) { mine.out = now(); await save('shift', mine, mine.id); toast('Clocked out'); } else { await save('shift', { u: S.user.id, e: S.user.email || myName(), in: now() }); toast('Clocked in'); } render(); } }, mine ? 'Clock out' : 'Clock in') }),
      ...sh.slice(0, 5).filter((x) => x.out).map((x) => liRow({ title: fmtDay(localDay(x.in)), sub: fmtTime(x.in) + ' to ' + fmtTime(x.out), value: Math.round((new Date(x.out) - new Date(x.in)) / 60000) + ' min' })))),
    can('m') ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Approvals')), h('div', { class: 'list' },
      liRow({ ic: 'lock', tone: 'orange', title: ps && ps.mine ? 'Change my approval PIN' : 'Set my approval PIN', sub: 'Type it on a cashier\'s till to approve discounts, cancellations and refunds' + (ps ? ' · ' + plural(+ps.approvers || 0, 'approver') + ' set' : ''), chev: true, onclick: setPinFlow }))) : null,
    h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'This device')), h('div', { class: 'list' },
      liRow({ ic: 'moon', tone: 'purple', title: 'Appearance', right: seg([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], auzThemeGet(), (v) => auzTheme(v)) }),
      L('outlet').length ? liRow({ ic: 'building', tone: 'gray', title: 'Outlet', value: outletName(), chev: true, onclick: pickOutlet }) : null,
      liRow({ ic: 'bell', tone: 'red', title: 'Order alerts when the app is closed', chev: true, onclick: enablePush }),
      liRow({ ic: 'bolt', tone: 'gray', title: 'Sync now', sub: h('span', { id: 'net2' }), chev: true, onclick: async () => { await syncNow(); toast('Synced'); render(); } }))),
    cfg().staffManual ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Staff manual')), h('div', { class: 'card pad', style: { whiteSpace: 'pre-wrap', fontSize: '15px' } }, cfg().staffManual)) : null,
    L('item').some((i) => i.recipeText) ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Recipes')),
      h('div', { class: 'search' }, icon('search', 18), h('input', { class: 'input', placeholder: 'Search a dish', value: S.recipeQ || '', 'aria-label': 'Search recipes', onchange: (e) => { S.recipeQ = e.target.value; render(); } })),
      h('div', { class: 'list' }, recipes.slice(0, 30).map((i) => liRow({ title: i.name, sub: h('span', { style: { whiteSpace: 'pre-wrap' } }, i.recipeText) })))) : null,
    links.length ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Business tools')), h('div', { class: 'list' }, links)) : null,
    h('div', { class: 'list' },
      S.role === 'owner' ? liRow({ ic: 'chart', tone: 'gray', title: 'Backup, export or clear data', onclick: () => auzMyData(sb) }) : null,
      liRow({ ic: 'logout', tone: 'red', title: 'Sign out', onclick: signOut }),
      liRow({ ic: 'trash', tone: 'red', title: 'Delete my account', onclick: deleteAccountFlow })),
    h('div', { class: 'powered' }, 'Powered by ', h('a', { href: 'https://auzslab.in', target: '_blank', rel: 'noopener' }, 'AUZslab')));
};
async function signOut() { if (!(await confirmBox('Sign out?', 'Unsynced changes stay on this device and sync when you sign in again.', 'Sign out', true))) return; await sb.auth.signOut(); localStorage.removeItem('u'); location.reload(); }
// Apple Guideline 5.1.1(v): self-service account deletion, reachable from inside the app.
async function deleteAccountFlow() {
  const pw = await alertBox({
    title: 'Delete your account?',
    msg: 'This cannot be undone. Enter your password to confirm (leave blank if you sign in with Google, Apple or phone).',
    input: { type: 'password', placeholder: 'Password' },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Delete account', value: '__input', def: true, dest: true }],
  });
  if (pw === null) return;
  const { error } = await sb.auth.deleteAccount(pw);
  if (error) { await alertBox({ title: 'Could not delete account', msg: error.message }); return; }
  localStorage.removeItem('u');
  location.href = '/index.html';
}
async function loadPinStatus() { if (!navigator.onLine || !S.user) return; try { const { data } = await sb.rpc('pos_pin_status'); if (data) S.pinStatus = data; } catch {} }
function setPinFlow() {
  let first = null, pin = '';
  const dots = h('div', { class: 'pin-dots' }), msg = h('div', { class: 'hint', style: { textAlign: 'center' } }, 'Choose 4 to 8 digits');
  const draw = () => dots.replaceChildren(...[0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map((i) => h('i', { class: i < pin.length ? 'on' : '' })));
  const s = sheet({ title: 'Approval PIN', narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack s20', style: { padding: '8px 0' } }, dots, msg,
    keypad((k) => { if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 8) pin += k; draw(); }),
    h('button', { class: 'btn fill lg wide', onclick: async () => {
      if (pin.length < 4) { msg.className = 'hint err'; msg.textContent = 'At least 4 digits'; return; }
      if (first === null) { first = pin; pin = ''; draw(); msg.className = 'hint'; msg.textContent = 'Type it again to confirm'; return; }
      if (pin !== first) { first = null; pin = ''; draw(); msg.className = 'hint err'; msg.textContent = 'The two PINs were different. Start again.'; return; }
      const { error } = await sb.rpc('pos_set_pin', { p_pin: pin });
      if (error) { first = null; pin = ''; draw(); msg.className = 'hint err'; msg.textContent = error.message; return; }
      s.close(); toast('Approval PIN saved'); await loadPinStatus(); render();
    } }, 'Continue')) });
  draw();
}
const outletList = () => [{ id: 'main', name: cfg().name || 'Main outlet' }, ...L('outlet').filter((o) => o.active !== false)];
const outletName = () => { const id = outletId(), o = outletList().find((x) => x.id === id); return o ? o.name : 'All outlets'; };
function pickOutlet() {
  const s = sheet({ title: 'Outlet', narrow: true, body: h('div', { class: 'list' }, outletList().map((o) => liRow({ title: o.name, right: outletId() === o.id ? h('span', { style: { color: 'var(--accent-text)' } }, icon('check', 20)) : null, onclick: () => { localStorage.outlet = o.id; s.close(); S.cur = null; S.resByDay = {}; loadBookings(today()); render(); } }))) });
}
function b64ToArr(s) { const p = '='.repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return info('Not available here', 'This browser cannot show notifications when the app is closed.');
  const perm = await Notification.requestPermission(); if (perm !== 'granted') return info('Notifications are off', 'Allow notifications for this site in the browser settings.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToArr(VAPID_PUBLIC) });
  const j = sub.toJSON(), { error } = await sb.from('push_subs').upsert({ user_id: S.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
  if (error) return toast('Could not save this device: ' + error.message, { err: true });
  toast('Order alerts are on for this device');
}
