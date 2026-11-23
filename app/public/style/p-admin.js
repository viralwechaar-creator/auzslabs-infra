// Admin tab: the account features inside the app. Owner only; staff only when the owner approves them (admin_tab_access).
page('admin', {
  title: 'Admin', perm: () => !!S.adminOk,
  async render(v) {
    v.header({ title: t('Admin') });
    const host = h('div', { class: 'page-pad' });
    v.root.append(host);
    window.auzAdminTab.mount(host, { rpc: (fn, args) => api(fn, args), toast: (m, err) => toast(m, err ? { err: true } : {}), isOwner: !!S.adminOwner, sb });
  },
});
