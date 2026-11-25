/* Finance features live INSIDE the Ledger tabs (no separate Finance menu group). Each Finance page is shown as a
   section of the Ledger tab where it fits best, switched with a small tab bar at the top of that tab:
     Home > Money today | Books > Cash entries, Owner & loans | Parties > Dues | Banking > Money accounts, Bank import,
     Cash withdrawals | Reports > Cash reports, Budget | Assets > Asset register | Analytics > Insights | GST > Tax memo |
     Expense requests > Approvals | Subscriptions > Repeating | Settings > Money settings.
   The fin-* pages keep working as before (same code, same data); old links (#/fin-activity ...) forward to the right tab. */
'use strict';
const FIN_TABS = {
  home: [['', 'Overview'], ['fin-home', 'Money today']],
  books: [['', 'Books'], ['fin-activity', 'Cash entries'], ['fin-owner', 'Owner & loans']],
  parties: [['', 'Parties'], ['fin-dues', 'Dues']],
  banking: [['', 'Banking'], ['fin-accounts', 'Money accounts'], ['fin-bank', 'Bank import'], ['fin-withdrawals', 'Cash withdrawals']],
  reports: [['', 'Reports'], ['fin-reports', 'Cash reports'], ['fin-budget', 'Budget']],
  assets: [['', 'Fixed assets'], ['fin-assets', 'Asset register']],
  analytics: [['', 'Analytics'], ['fin-insights', 'Insights']],
  gst: [['', 'GST'], ['fin-tax', 'Tax memo']],
  expreq: [['', 'Requests'], ['fin-approvals', 'Approvals']],
  subscriptions: [['', 'Subscriptions'], ['fin-repeat', 'Repeating']],
  settings: [['', 'Settings'], ['fin-settings', 'Money settings']],
};
const FIN_HOST = { 'fin-tools': 'home' };
Object.entries(FIN_TABS).forEach(([host, tabs]) => tabs.forEach(([id]) => { if (id) FIN_HOST[id] = host; }));
// go() for a Finance page: opens the host tab with that section selected (keeps any ?query such as ?open=<entry>)
function finGo(path) {
  const [id, qs] = String(path).replace(/^#?\/?/, '').split('?');
  const host = FIN_HOST[id];
  if (!host) return go(path);
  go(host + '?sec=' + id + (qs ? '&' + qs : ''));
}
const FIN_RENAME = { 'fin-home': 'Money today', 'fin-activity': 'Cash entries', 'fin-dues': 'Dues', 'fin-owner': 'Owner & loans', 'fin-accounts': 'Money accounts', 'fin-reports': 'Cash reports', 'fin-insights': 'Insights', 'fin-settings': 'Money settings', 'fin-tools': 'Money tools' };
Object.keys(FIN_HOST).forEach((id) => {
  const def = PAGES[id]; if (!def || def._merged) return; def._merged = true;
  def.nav = false; def.navAs = FIN_HOST[id]; if (FIN_RENAME[id]) def.title = FIN_RENAME[id];
  const orig = def.render;
  def.render = async function (v) {
    // opened straight from an old link: forward to the host tab
    if (v.id === id) { const q = v.q.toString(); finGo(id + (q ? '?' + q : '')); return; }
    return orig.call(this, v);
  };
});
Object.entries(FIN_TABS).forEach(([host, tabs]) => {
  const def = PAGES[host]; if (!def || def._finWrapped) return; def._finWrapped = true;
  const orig = def.render;
  def.render = async function (v) {
    if ((v.args && v.args.length) || !(window.finOn && finOn())) return orig.call(this, v);
    const t = v.q.get('sec') || '';
    const known = tabs.some(([id]) => id === t);
    const bar = h('div', { class: 'fin-tabs' }, seg(tabs.map(([id, label]) => [id, label]), known ? t : '', (id) => go(host + (id ? '?sec=' + id : '')), { label: 'Sections' }));
    const box = h('div', { class: 'fin-tab-body' });
    v.root.append(bar, box);
    const v2 = Object.assign({}, v, { root: box });
    if (known && t) { const fd = PAGES[t]; v.header({ title: fd.title }); return fd.render.call(fd, v2); }
    return orig.call(this, v2);
  };
});
