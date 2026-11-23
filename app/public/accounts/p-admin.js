// Admin tab: the account features inside AUZsLedger. Owner only; staff only when the owner approves them.
page('admin', {
  title: 'Admin', icon: 'gear', perm: 'admin_tab',
  async render(v) {
    v.header({ title: 'Admin' });
    const host = h('div', { class: 'section' });
    v.root.append(host);
    window.auzAdminTab.mount(host, { rpc: (fn, args) => api(fn, args), toast: (m, err) => toast(m, err ? { err: true } : {}), isOwner: !!S.adminOwner, sb });
  },
});
