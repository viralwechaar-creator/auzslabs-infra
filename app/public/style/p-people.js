/* AUZsStyle: People. Customers (points, store credit, usual size, last purchase) and the shop's staff with targets. */
'use strict';
page('people', {
  title: 'People', perm: 'sty_view',
  async render(v) {
    const tab = v.q.get('tab') || 'customers';
    v.header({ title: t('People'), actions: [{ label: t('New customer'), icon: 'plus', primary: true, run: () => customerForm(null, () => v.refresh()) }] });
    const root = v.root;
    if (can('sty_reports')) root.append(seg([['customers', t('Customers')], ['staff', t('Staff')]], tab, (x) => go('people?tab=' + x), { full: true }));
    const host = h('div'); root.append(host); host.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
    if (tab === 'staff' && can('sty_reports')) return staffTab(host, v);
    let q = ''; const list = h('div', { class: 'list' });
    const load = debounce(async () => {
      let rows = []; try { rows = await api('sty_list_customers', { p_q: q, p_limit: 200 }) || []; } catch (e) { return fail(e); }
      clear(list).append(...(rows.length ? rows.map((c) => liRow({ icon: 'user', title: c.name, sub: [c.phone, c.usualSize ? t('Size') + ' ' + c.usualSize : '', c.lastAt ? t('Last') + ' ' + fmtDay(c.lastAt) : ''].filter(Boolean).join(' · '), value: inr(c.spent, 0), valueSub: c.visits + ' ' + t('visits'), chevron: true, onclick: () => customerSheet(c, () => v.refresh()) })) : [empty('users', t('No customers yet'), t('They are added when you bill them, or add one here.'))]));
    }, 200);
    clear(host).append(h('div', { class: 'grid' }, searchField(t('Name or phone'), (x) => { q = x; load(); }), list)); load();
  },
});
function customerSheet(c, done) {
  const body = h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('Spent'), inr(c.spent, 0), c.visits + ' ' + t('visits')), kpi(t('Points'), c.points || 0), kpi(t('Store credit'), inr(c.credit, 0))),
    h('div', { class: 'muted' }, [c.phone, c.usualSize ? t('Usual size') + ' ' + c.usualSize : '', c.birthday ? t('Birthday') + ' ' + fmtDay(c.birthday) : '', c.notes].filter(Boolean).join(' · ')),
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); customerForm(c, done); } }, icon('edit', 18), t('Edit')),
      c.phone ? h('button', { class: 'btn', type: 'button', onclick: () => window.open('https://wa.me/91' + String(c.phone).replace(/\D/g, '').slice(-10), '_blank', 'noopener') }, icon('share', 18), 'WhatsApp') : null,
      h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); go('bills?customer=' + c.id); } }, icon('tag', 18), t('Bills'))));
  const s = sheet({ title: c.name, closeLabel: t('Done'), body });
}
async function staffTab(host, v) {
  let staff = [], an = null;
  try { staff = await api('sty_staff_list') || []; an = await api('sty_analytics', { p: { from: rangeFor('month').from, to: rangeFor('month').to, branchId: null } }); } catch (e) { return fail(e); }
  const by = Object.fromEntries((an.staff || []).map((x) => [x.id, x]));
  clear(host).append(h('div', { class: 'grid' }, h('div', { class: 'cap' }, t('This month')), h('div', { class: 'list' }, staff.map((u) => { const a = by[u.id] || {}; return liRow({ icon: 'user', title: u.name || '—', sub: u.role + ' · ' + (a.bills || 0) + ' ' + t('Bills') + (a.target ? ' · ' + t('Target') + ' ' + inr(a.target, 0) : ''), value: inr(a.revenue || 0, 0), valueSub: a.commission ? t('Commission') + ' ' + inr(a.commission) : '', chevron: can('sty_manage'), onclick: can('sty_manage') ? () => targetSheet(u, a, () => v.refresh()) : null }); }))));
}
function targetSheet(u, a, done) {
  const tg = input({ type: 'number', mode: 'decimal', value: a.target || '', placeholder: '0' }), cm = input({ type: 'number', mode: 'decimal', value: a.commission_pct || '', placeholder: '0' });
  sheet({ title: u.name, body: h('div', { class: 'grid' }, h('p', { class: 'muted small' }, t('Set this month\'s sales target and the commission % on their sales.')), field(t('Monthly target') + ' ₹', tg), field(t('Commission') + ' %', cm)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => { await api('sty_set_target', { p: { userId: u.id, target: N(tg.value), commissionPct: N(cm.value) } }); close(); toast(t('Saved')); done(); } }] });
}
