/* AUZsStyle: Expenses (shop running costs not tied to a purchase -- rent, salaries, bills) and the Audit log
   (a trail of who did what -- void, return, price/settings change, bulk edit). Its own page, not buried in
   Settings -- sign-ins are a separate system entirely (auth_users/profiles) and never appear in the audit log. */
'use strict';
const EXU = {}, AUU = {};
page('expenses', {
  title: 'Expenses', perm: 'sty_manage',
  async render(v) {
    const tab = v.q.get('tab') || 'expenses';
    v.header({ title: t('Expenses') + ' & ' + t('Audit log'), actions: tab === 'expenses' ? [{ label: t('Add expense'), icon: 'plus', primary: true, run: () => expenseForm(null, () => v.refresh()) }] : [] });
    const root = v.root;
    root.append(seg([['expenses', t('Expenses')], ['audit', t('Audit log')]], tab, (x) => go('expenses?tab=' + x), { full: true }));
    const host = h('div'); root.append(host);
    host.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
    if (tab === 'audit') return auditTab(host);
    return expensesTab(host, v);
  },
});
function expenseForm(e, done) {
  const cat = input({ value: e ? e.category : '', placeholder: t('Rent, Salaries, Electricity...') });
  const amt = input({ type: 'number', mode: 'decimal', value: e ? e.amount : '', placeholder: '0' });
  const mode = selectEl([['cash', t('Cash')], ['upi', 'UPI'], ['card', t('Card')], ['bank', t('Bank')]], e ? e.mode : 'cash');
  const note = input({ value: e ? e.note || '' : '', placeholder: t('Optional') });
  sheet({ title: e ? t('Edit expense') : t('New expense'), body: h('div', { class: 'grid' }, field(t('Category'), cat), field(t('Amount'), amt), field(t('Paid by'), mode), field(t('Note'), note)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => {
      if (!N(amt.value)) { toast(t('Enter an amount'), { err: true }); return false; }
      try { await api('sty_expense_save', { p: { id: e && e.id, category: cat.value, amount: N(amt.value), mode: mode.value, note: note.value } }); } catch (ex) { fail(ex); return false; }
      close(); toast(t('Saved')); done && done();
    } }] });
}
async function expensesTab(host, v) {
  Object.assign(EXU, rangeFor(EXU.k || 'month', EXU.from ? { from: EXU.from, to: EXU.to } : null));
  async function load() {
    let rows = []; try { rows = await api('sty_list_expenses', { p: { from: EXU.from, to: EXU.to } }) || []; } catch (e) { return clear(host).append(empty('cloudOff', t('Could not load'), e.message)); }
    const tot = rows.reduce((a, r) => a + r.amount, 0);
    clear(host).append(h('div', { class: 'grid' },
      rangePicker(EXU, load, ['month', '30', '90', 'custom']),
      h('div', { class: 'kpis' }, kpi(t('Total expenses'), inr(tot, 0), rows.length + ' ' + t('entries'))),
      h('div', { class: 'list' }, rows.length ? rows.map((r) => liRow({ icon: 'wallet', title: r.category, sub: fmtDT(r.at) + (r.note ? ' · ' + r.note : '') + (r.staff ? ' · ' + r.staff : ''), value: inr(r.amount), valueSub: String(r.mode).toUpperCase(), chevron: true, onclick: () => expenseForm(r, load) })) : [empty('wallet', t('No expenses in this period'), t('Add rent, salaries, bills -- anything not tied to a purchase.'))])));
  }
  load();
}
async function auditTab(host) {
  Object.assign(AUU, rangeFor(AUU.k || 'today', AUU.from ? { from: AUU.from, to: AUU.to } : null));
  let q = '';
  async function load() {
    let rows = []; try { rows = await api('sty_audit_list', { p: { from: AUU.from, to: AUU.to, q } }) || []; } catch (e) { return clear(host).append(empty('cloudOff', t('Could not load'), e.message)); }
    clear(host).append(h('div', { class: 'grid' },
      rangePicker(AUU, load, ['today', 'week', 'month', '30', 'custom']),
      searchField(t('Action, reference, staff'), debounce((x) => { q = x; load(); }, 250), q),
      h('div', { class: 'list' }, rows.length ? rows.map((r) => liRow({ icon: 'clock', title: String(r.action).replace(/[._]/g, ' '), sub: fmtDT(r.at) + (r.staff ? ' · ' + r.staff : '') + (r.ref ? ' · ' + r.ref : ''), value: '', chevron: false })) : [empty('clock', t('Nothing in this period'))])));
  }
  load();
}
