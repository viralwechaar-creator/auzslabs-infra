/* AUZsStyle: People. Customers (points, store credit, usual size, last purchase) and the shop's staff with targets. */
'use strict';
page('people', {
  title: 'People', perm: () => can('sty_view') || allowed(PAGES.requests),
  async render(v) {
    const tabs = [
      ...(can('sty_view') ? [['customers', t('Customers')], ['dues', t('Dues')], ['followups', t('Follow-ups')]] : []),
      ...(allowed(PAGES.requests) ? [['requests', t('Requests')]] : []),
      ...(can('sty_view') && can('sty_reports') ? [['staff', t('Staff')]] : []),
    ];
    const requested = v.q.get('tab');
    const tab = tabs.some(([id]) => id === requested) ? requested : tabs[0][0];
    const root = v.root;
    root.append(seg(tabs, tab, (id) => go('people?tab=' + id), { full: true }));
    if (tab === 'requests') return PAGES.requests.render(v);
    v.header({ title: t(tab === 'customers' ? 'Customers' : 'People'), actions: [
      { label: t('New customer'), icon: 'plus', primary: true, run: () => customerForm(null, () => v.refresh()) },
      { label: t('Reminders'), icon: 'share', run: () => go('people?tab=followups') },
    ] });
    const host = h('div'); root.append(host); host.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
    if (tab === 'staff' && can('sty_reports')) return staffTab(host, v);
    if (tab === 'followups') return followTab(host, v);
    if (tab === 'dues') return duesTab(host, v);
    return customersTab(host, v);
  },
});
function peopleRecordCard({ name, detail, amount, status, tone, pick, open }) {
  return h('article', { class: 'people-card' }, pick,
    h('button', { type: 'button', class: 'people-open', onclick: open },
      h('span', { class: 'people-identity' }, h('strong', null, name), h('small', null, detail)),
      h('span', { class: 'people-balance' }, h('strong', null, amount),
        h('small', { class: 'people-status is-' + tone }, status)), icon('right', 15)));
}
async function customersTab(host, v) {
  const limit = 1000;
  let overview, customers, dues;
  try {
    [overview, customers, dues] = await Promise.all([
      api('sty_crm_overview'),
      api('sty_crm_list', { p: { limit } }),
      api('sty_dues_list'),
    ]);
  } catch (error) {
    clear(host).append(empty('users', t('Could not load customers'), error.message,
      h('button', { class: 'btn', type: 'button', onclick: () => v.refresh() }, t('Try again'))));
    return;
  }
  overview = overview || {};
  customers = customers || [];
  const balances = new Map();
  for (const bill of dues || []) {
    const amount = Number(bill.balance) || 0;
    if (amount <= 0) continue;
    const balance = balances.get(bill.customerId) || { due: 0, overdue: 0 };
    balance.due += amount;
    if (bill.overdue) balance.overdue += amount;
    balances.set(bill.customerId, balance);
  }
  const totals = [...balances.values()].reduce((sum, entry) => ({
    due: sum.due + entry.due, overdue: sum.overdue + entry.overdue,
  }), { due: 0, overdue: 0 });
  const modes = [['all', 'All'], ['owing', 'Owing'], ['overdue', 'Overdue'], ['lapsed', 'Lapsed'], ['new', 'New'], ['regular', 'Regular'], ['gold', 'Gold'], ['silver', 'Silver'], ['credit', 'Store credit'], ['points', 'Points']];
  const selected = new Set();
  const cards = h('div', { class: 'people-cards' });
  const tools = h('div', { class: 'row people-actions' });
  const more = h('div');
  let filter = 'all', search = '', visible = 12;
  const matches = () => customers.filter((customer) => {
    const balance = balances.get(customer.id);
    const eligible = filter === 'all' || (filter === 'owing' && balance?.due > 0)
      || (filter === 'overdue' && balance?.overdue > 0) || customer.status === filter || String(customer.tier || '').toLowerCase() === filter
      || (filter === 'credit' && customer.credit > 0) || (filter === 'points' && customer.points > 0);
    return eligible && [customer.name, customer.phone, customer.gstin, customer.email].some((value) => String(value || '').toLowerCase().includes(search));
  });
  function exportRows() {
    const rows = matches().filter((customer) => !selected.size || selected.has(customer.id));
    exportCSV('style-customers', ['Name', 'Phone', 'GSTIN', 'Email', 'Outstanding', 'Overdue'],
      rows.map((customer) => [customer.name, customer.phone, customer.gstin, customer.email,
        balances.get(customer.id)?.due || 0, balances.get(customer.id)?.overdue || 0]));
  }
  function paintActions() {
    clear(tools).append(can('sty_manage') ? h('button', { class: 'btn sm', type: 'button', onclick: exportRows },
      icon('download', 16), selected.size ? t('Export selected') + ' (' + selected.size + ')' : t('Export')) : null);
  }
  function paint() {
    const rows = matches();
    clear(cards).append(...rows.slice(0, visible).map((customer) => {
      const balance = balances.get(customer.id);
      const pick = can('sty_manage') ? h('input', { type: 'checkbox', checked: selected.has(customer.id),
        'aria-label': t('Select') + ' ' + customer.name, onchange: (event) => {
          if (event.target.checked) selected.add(customer.id);
          else selected.delete(customer.id);
          paintActions();
        } }) : null;
      return peopleRecordCard({
        name: customer.name, detail: customer.phone || customer.gstin || customer.email || customer.tier || '',
        amount: balance ? inr(balance.due) : inr(0),
        status: balance ? (balance.overdue > 0 ? t('Overdue') : t('To collect')) : t('Settled'),
        tone: balance ? (balance.overdue > 0 ? 'due' : 'open') : 'settled',
        pick, open: () => customerSheet(customer, () => v.refresh()),
      });
    }));
    if (!rows.length) cards.append(empty('users', t('No customers here'), t('Try another search or filter.')));
    clear(more).append(rows.length > visible ? h('button', { class: 'btn sm wide', type: 'button', onclick: () => {
      visible += 12;
      paint();
    } }, t('Show more') + ' · ' + (rows.length - visible)) : null);
    paintActions();
  }
  const change = () => { selected.clear(); visible = 12; paint(); };
  clear(host).append(h('div', { class: 'grid people-workspace' },
    h('div', { class: 'people-total' }, h('div', null, h('strong', null, t('Owed to you')),
      h('small', null, balances.size + ' ' + t('customers'))), h('b', null, inr(totals.due, 0))),
    h('div', { class: 'kpis' }, kpi(t('Overdue'), inr(totals.overdue, 0), t('Past due date')),
      kpi(t('Customers'), overview.total || customers.length, (overview.lapsed || 0) + ' ' + t('lapsed'))),
    searchField(t('Search customers'), (value) => { search = value.trim().toLowerCase(); change(); }),
    seg(modes.map(([key, label]) => [key, t(label)]), filter, (value) => { filter = value; change(); }),
    tools, cards, more,
    customers.length >= limit ? h('p', { class: 'muted small' }, t('This view shows the first 1,000 customers.')) : null));
  paint();
}
function waLink(c, text) { const ph = String(c.phone || '').replace(/\D/g, '').slice(-10); return ph ? 'https://wa.me/91' + ph + (text ? '?text=' + encodeURIComponent(text) : '') : null; }
async function followTab(host, v) {
  let ov; try { ov = await api('sty_crm_overview') || {}; } catch (e) { return fail(e); }
  const shop = (S.ctx && S.ctx.settings && S.ctx.settings.shopName) || '';
  const row = (c, icon_, sub, text) => liRow({ icon: icon_, title: c.name, sub, chevron: !!c.phone, onclick: c.phone ? () => window.open(waLink(c, text), '_blank', 'noopener') : null });
  const up = (ov.upcoming || []).map((c) => row(c, c.kind === 'birthday' ? 'tag' : 'user', (c.kind === 'birthday' ? t('Birthday') : t('Anniversary')) + ' · ' + (c.days === 0 ? t('Today') : c.days + ' ' + t('days')) + (c.phone ? '' : ' · ' + t('no phone')), (c.kind === 'birthday' ? 'Happy birthday ' : 'Happy anniversary ') + String(c.name).split(' ')[0] + '! Wishing you a wonderful day from everyone at ' + shop + '.'));
  const lp = (ov.lapsedList || []).map((c) => row(c, 'user', t('Last') + ' ' + fmtDay(c.lastAt) + ' · ' + inr(c.spent, 0), 'Hi ' + String(c.name).split(' ')[0] + ', it has been a while since your last visit to ' + shop + '. Come and see what is new in store.'));
  clear(host).append(h('div', { class: 'grid' }, banner('info', 'share', t('Tap a person to send a WhatsApp message. Turn on automatic messages in Settings → WhatsApp.')),
    h('div', { class: 'cap' }, t('Birthdays and anniversaries · next 30 days')), h('div', { class: 'list' }, up.length ? up : [empty('tag', t('Nothing coming up'), t('Add birthdays on the customer to see them here.'))]),
    h('div', { class: 'cap' }, t('Lapsed customers · not back in 60 days')), h('div', { class: 'list' }, lp.length ? lp : [empty('users', t('Nobody has lapsed'), '')])));
}
async function duesTab(host, v) {
  let rows = []; try { rows = await api('sty_dues_list') || []; } catch (e) { return fail(e); }
  const tot = rows.reduce((a, r) => a + r.balance, 0), overdue = rows.filter((r) => r.overdue);
  clear(host).append(h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('Customers owe you'), inr(tot, 0), rows.length + ' ' + t('Bills'), null, tot > 0 ? 'neg' : ''), kpi(t('Overdue'), overdue.length, inr(overdue.reduce((a, r) => a + r.balance, 0), 0), null, overdue.length ? 'neg' : '')),
    h('div', { class: 'list' }, rows.length ? rows.map((r) => liRow({ icon: 'wallet', tone: r.overdue ? 'red' : 'gray', title: r.name, sub: [r.number, r.phone, r.dueDate ? (r.overdue ? t('Overdue since') : t('Due')) + ' ' + fmtDay(r.dueDate) : ''].filter(Boolean).join(' · '), value: inr(r.balance), chevron: true, onclick: () => go('bills?customer=' + r.customerId) })) : [empty('check', t('No pending dues'), t('Every credit sale has been collected.'))])));
}
async function customerSheet(c0, done) {
  let c = c0, det = null;
  try { det = await api('sty_customer_detail', { p_id: c0.id }); } catch (e) { /* show what we have */ }
  c = Object.assign({}, c0, det || {});
  const names = (a) => (a || []).map((x) => x.name + ' ×' + x.qty).join(', ');
  const body = h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('Spent'), inr(c.spent, 0), c.visits + ' ' + t('visits')), kpi(t('Points'), c.points || 0), kpi(t('Store credit'), inr(c.credit, 0))),
    h('div', { class: 'muted' }, [c.tier, c.status === 'lapsed' ? t('Lapsed') : '', c.phone, c.email, c.gstin, c.address, c.city, c.usualSize ? t('Usual size') + ' ' + c.usualSize : '', c.birthday ? t('Birthday') + ' ' + fmtDay(c.birthday) : '', c.anniversary ? t('Anniversary') + ' ' + fmtDay(c.anniversary) : '', c.notes].filter(Boolean).join(' · ')),
    det && det.visits ? h('div', { class: 'muted small' }, [t('Average bill') + ' ' + inr(det.avgBill, 0), det.due > 0 ? t('Due') + ' ' + inr(det.due, 0) : '', det.sizes && det.sizes.length ? t('Sizes') + ': ' + names(det.sizes) : '', det.colours && det.colours.length ? t('Colours') + ': ' + names(det.colours) : '', det.likes && det.likes.length ? t('Buys') + ': ' + names(det.likes) : ''].filter(Boolean).join(' · ')) : null,
    det && det.bills && det.bills.length ? h('div', { class: 'list' }, det.bills.slice(0, 5).map((b) => liRow({ icon: 'tag', title: b.number, sub: fmtDay(b.at) + (b.status === 'due' ? ' · ' + t('Balance') + ' ' + inr(b.balance, 0) + (b.dueDate ? ' · ' + t('Due') + ' ' + fmtDay(b.dueDate) : '') : ''), value: inr(b.total, 0), chevron: true, onclick: () => { s.close(); go('bills?customer=' + c.id); } }))) : null,
    det && det.messages && det.messages.length ? h('div', { class: 'muted small' }, t('Messages') + ': ' + det.messages.map((m) => m.template.replace(/_/g, ' ') + ' (' + m.status + ')').join(', ')) : null,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); customerForm(c, done); } }, icon('edit', 18), t('Edit')),
      c.phone ? h('button', { class: 'btn', type: 'button', onclick: () => window.open(waLink(c), '_blank', 'noopener') }, icon('share', 18), 'WhatsApp') : null,
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
