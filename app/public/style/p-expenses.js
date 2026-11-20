/* AUZsStyle: Expenses (shop running costs not tied to a purchase -- rent, salaries, bills) and the Audit log
   (a trail of who did what -- void, return, price/settings change, bulk edit). Its own page, not buried in
   Settings -- sign-ins are a separate system entirely (auth_users/profiles) and never appear in the audit log. */
'use strict';
const EXU = {}, AUU = {};
page('expenses', {
  title: 'Expenses', perm: 'sty_manage',
  async render(v) {
    const tab = v.q.get('tab') || 'expenses';
    v.header({ title: t(tab === 'audit' ? 'Audit log' : 'Expenses'), actions: tab === 'expenses' ? [
      { label: t('New expense'), icon: 'plus', primary: true, run: () => expenseForm(null, () => v.refresh()) },
    ] : [] });
    const root = v.root;
    root.append(seg([['expenses', t('All expenses')], ['audit', t('Audit log')]], tab, (x) => go('expenses?tab=' + x), { full: true }));
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
  let rows = [], query = '', payment = '', request = 0;
  const results = h('div', { class: 'people-cards' });
  const summary = h('div', { class: 'kpis' });
  const matching = () => rows.filter((row) => (!payment || row.mode === payment) &&
    [row.category, row.note, row.staff].some((value) => String(value || '').toLowerCase().includes(query)));
  function paint() {
    const visible = matching();
    const total = visible.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    clear(summary).append(kpi(t('Total expenses'), inr(total, 0), visible.length + ' ' + t('entries')));
    clear(results).append(...(visible.length ? visible.map((row) => peopleRecordCard({
      name: row.category, detail: [fmtDT(row.at), row.note, row.staff].filter(Boolean).join(' · '),
      amount: inr(row.amount), status: String(row.mode || '').toUpperCase(), tone: 'settled',
      open: () => expenseForm(row, load),
    })) : [empty('wallet', t('No matching expenses'), t('Try another date range, search, or payment method.'))]));
  }
  async function load() {
    const version = ++request;
    clear(results).append(h('div', { class: 'spin' }));
    try {
      const data = await api('sty_list_expenses', { p: { from: EXU.from, to: EXU.to } }) || [];
      if (version !== request) return;
      rows = data;
      paint();
    } catch (error) {
      if (version !== request) return;
      rows = [];
      clear(summary);
      clear(results).append(empty('cloudOff', t('Could not load expenses'), error.message,
        h('button', { class: 'btn', type: 'button', onclick: load }, t('Try again'))));
    }
  }
  clear(host).append(h('div', { class: 'grid' }, rangePicker(EXU, load, ['month', '30', '90', 'custom']),
    searchField(t('Search expenses'), (value) => { query = value.trim().toLowerCase(); paint(); }),
    seg([['', t('All')], ['cash', t('Cash')], ['upi', 'UPI'], ['card', t('Card')], ['bank', t('Bank')]], payment,
      (value) => { payment = value; paint(); }, { label: t('Payment method') }),
    h('div', null, h('button', { class: 'btn sm', type: 'button', onclick: () => exportCSV('expenses-' + EXU.from + '-' + EXU.to,
      ['Date', 'Category', 'Amount', 'Payment method', 'Note', 'Staff'],
      matching().map((row) => [row.at, row.category, row.amount, row.mode, row.note, row.staff])) }, icon('download', 16), t('Export CSV'))),
    summary, results));
  await load();
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
