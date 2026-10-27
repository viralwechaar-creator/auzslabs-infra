// Expense approval: staff ask, a manager approves, another person pays. Nothing is booked until it is paid.
function expenseAccounts() { return S.accounts.filter((a) => a.type === 'expense' && a.active); }

function expReqSheet(done) {
  const what = input({ placeholder: 'What is it for? e.g. Shop cleaning' }), amt = input({ type: 'number', mode: 'decimal', placeholder: '0' });
  const acc = selectEl([['', 'General expenses'], ...expenseAccounts().map((a) => [a.id, a.name])], '', {});
  const nt = h('textarea', { class: 'textarea', placeholder: 'Anything the approver should know (optional)', style: { minHeight: '60px' } });
  sheet({ title: 'Ask for money', body: h('div', { class: 'grid' }, field('What is it for', what), field('Amount (₹)', amt), field('Type of expense', acc), field('Note', nt)),
    actions: [{ label: 'Send for approval', primary: true, onclick: async (c) => {
      if (!what.value.trim() || !(Number(amt.value) > 0)) { toast('Write what it is for and the amount', { err: true }); return false; }
      await api('acc_expense_request_save', { p: { description: what.value, amount: Number(amt.value), account_id: acc.value || null, note: nt.value } });
      c(); toast('Sent for approval'); done && done();
    } }] });
}

function expReqPaySheet(x, done) {
  const pay = selectEl(payAccounts().map((a) => [a.id, a.name]), (payAccounts()[0] || {}).id || '', {});
  const ref = input({ placeholder: 'Reference or UTR (optional)' });
  sheet({ title: 'Pay ' + inr(x.amount, 0), body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, x.description + ' · asked by ' + x.requester), field('Pay from', pay), field('Reference', ref)),
    actions: [{ label: 'Pay and book it', primary: true, onclick: async (c) => { const r = await api('acc_expense_request_pay', { p: { id: x.id, account_id: pay.value, reference: ref.value } }); c(); toast('Paid and booked as ' + (r.number || 'an expense')); done && done(); } }] });
}

function expReqDetail(x, caps, done) {
  const acts = [];
  if (x.status === 'pending' && caps.can_approve && !x.mine) {
    acts.push({ label: 'Approve', primary: true, onclick: async (c) => { await api('acc_expense_request_decide', { p_id: x.id, p_decision: 'approve', p_note: null }); c(); toast('Approved'); done(); } });
    acts.push({ label: 'Reject', onclick: (c) => { c(); const why = input({ placeholder: 'Why?' }); sheet({ title: 'Reject request', body: field('Reason', why), actions: [{ label: 'Reject', primary: true, onclick: async (c2) => { if (!why.value.trim()) { toast('Say why', { err: true }); return false; } await api('acc_expense_request_decide', { p_id: x.id, p_decision: 'reject', p_note: why.value }); c2(); toast('Rejected'); done(); } }] }); } });
  }
  if (x.status === 'approved' && caps.can_pay && !x.mine) acts.push({ label: 'Pay now', primary: true, onclick: (c) => { c(); expReqPaySheet(x, done); } });
  if (x.status === 'pending' && x.mine) acts.push({ label: 'Cancel request', onclick: async (c) => { await api('acc_expense_request_cancel', { p_id: x.id }); c(); toast('Cancelled'); done(); } });
  sheet({ title: inr(x.amount, 0), closeLabel: 'Close', body: h('div', { class: 'grid' },
    h('div', null, h('div', { style: { fontWeight: 600 } }, x.description), h('div', { class: 'muted small' }, [x.account_name || 'General expenses', 'asked by ' + x.requester, fmtD(x.req_date)].join(' · '))),
    x.note ? h('p', null, x.note) : null, x.decision_note ? h('p', { class: 'muted' }, 'Decision note: ' + x.decision_note) : null,
    x.decider ? h('div', { class: 'cap' }, (x.status === 'rejected' ? 'Rejected' : 'Approved') + ' by ' + x.decider) : null,
    x.status === 'pending' && x.mine ? h('div', { class: 'cap' }, 'Waiting for a manager. You cannot approve your own request.') : null), actions: acts });
}

page('expreq', {
  title: 'Expense requests', icon: 'check', perm: 'acc_view',
  async render(v) {
    const st = v.q.get('s') || 'pending';
    const r = await api('acc_expense_request_list', { p: { status: st === 'all' ? null : st } });
    v.header({ title: 'Expense requests', actions: [can('acc_sales') ? { label: 'Ask for money', icon: 'plus', primary: true, run: () => expReqSheet(() => v.refresh()) } : null].filter(Boolean) });
    v.root.append(seg([['pending', 'Waiting'], ['approved', 'To pay'], ['paid', 'Paid'], ['rejected', 'Rejected'], ['all', 'All']], st, (t) => go('expreq?s=' + t)));
    if (!r.rows.length) { v.root.append(empty('check', 'Nothing here', 'Staff can ask for money here; a manager approves it, and then it is paid and booked.')); return; }
    v.root.append(dataView([
      { key: 'description', label: 'For', title: true }, { key: 'requester', label: 'Asked by', sub: true, render: (x) => x.requester + ' · ' + fmtD(x.req_date) },
      { key: 'status', label: 'Status', badge: true, render: (x) => badge(cap1(x.status), x.status === 'paid' ? 'green' : x.status === 'rejected' ? 'red' : '') },
      { key: 'amount', label: 'Amount', r: true, value: true, render: (x) => money(x.amount), sortVal: (x) => Number(x.amount) }], r.rows, { onRow: (x) => expReqDetail(x, r, () => v.refresh()) }));
  },
});
