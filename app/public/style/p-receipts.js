/* Money received: collections against existing AUZsStyle bills. */
'use strict';

page('receipts', {
  title: 'Money received', perm: 'sty_view',
  async render(v) {
    const root = v.root;
    const list = h('div', { class: 'grid' });
    const history = h('div', { class: 'people-cards' });
    const search = searchField(t('Search customers or bills'), paintCustomers);
    const years = S.ctx.fys || [];
    const today = new Date();
    const dateKey = [today.getFullYear(), today.getMonth() + 1, today.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
    let year = years.find((entry) => entry.startDate <= dateKey && entry.endDate >= dateKey) || null;
    let groups = [], balancesLoaded = false, historyRequest = 0;

    function header() {
      v.header({ title: t('Collect'), actions: [
        can('sty_sell') ? { label: t('Receive money'), icon: 'plus', primary: true, run: () => pickCustomer(collectCustomer) } : null,
        { label: t('Ageing report'), icon: 'clock', run: showAgeing },
        years.length ? { label: year ? t('FY') + ' ' + year.label : t('All receipts'), icon: 'calendar', run: pickYear } : null,
        { label: t('Search'), icon: 'search', run: () => search.input.focus() },
      ] });
    }
    function pickYear() {
      const dialog = sheet({ title: t('Receipt financial year'), body: h('div', { class: 'list' },
        [null, ...years].map((entry) => liRow({ title: entry ? entry.label : t('All years'),
          onclick: () => { year = entry; dialog.close(); header(); loadHistory(); } }))) });
    }
    function pickCustomer(action) {
      const dialog = sheet({ title: t('Receive money'), body: h('div', { class: 'list' },
        groups.length ? groups.map((customer) => liRow({ title: customer.name, sub: customer.phone, value: inr(customer.total),
          chevron: true, onclick: () => { dialog.close(); action(customer); } })) : empty('cash', balancesLoaded ? t('No pending dues') : t('Balances are not available'), '')) });
    }
    function collectCustomer(customer) {
      const dialog = sheet({ title: customer.name, body: h('div', { class: 'list' }, customer.bills.map((bill) => liRow({
        title: bill.number, sub: bill.dueDate ? t('Due') + ' ' + fmtDay(bill.dueDate) : '', value: inr(bill.balance),
        chevron: true, onclick: () => { dialog.close(); collectDue({ ...bill, id: bill.billId }, () => v.refresh()); },
      }))) });
    }
    function showAgeing() {
      const buckets = [['Not yet due', 0], ['1–30 days overdue', 0], ['31–60 days overdue', 0], ['61–90 days overdue', 0], ['Over 90 days overdue', 0]];
      for (const customer of groups) for (const bill of customer.bills) {
        const days = bill.overdue ? Math.round((Date.parse(dateKey) - Date.parse(bill.dueDate)) / 86400000) : 0;
        buckets[days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4][1] += Number(bill.balance);
      }
      sheet({ title: t('Ageing report'), body: h('div', { class: 'list' },
        balancesLoaded ? buckets.map(([label, amount]) => liRow({ title: t(label), value: inr(amount) })) : empty('cash', t('Balances are not available'), '')) });
    }
    function showReminders() {
      const overdue = groups.filter((customer) => customer.overdue > 0 && customer.phone);
      sheet({ title: t('Payment reminders'), body: h('div', { class: 'list' },
        overdue.length ? overdue.map((customer) => {
          const link = waLink(customer, t('Payment reminder') + ': ' + inr(customer.overdue) + ' · ' +
            customer.bills.filter((bill) => bill.overdue).map((bill) => bill.number).join(', '));
          return liRow({ title: customer.name, value: inr(customer.overdue), chevron: !!link,
            onclick: link ? () => window.open(link, '_blank', 'noopener') : null });
        }) : empty('users', t('No overdue customers with a phone number'), '')) });
    }
    function paintCustomers() {
      if (!balancesLoaded) return;
      const query = search.input.value.trim().toLowerCase();
      const visible = groups.filter((customer) => [customer.name, customer.phone, ...customer.bills.map((bill) => bill.number)]
        .some((value) => String(value || '').toLowerCase().includes(query)));
      const cards = visible.map((customer) => h('div', { class: 'card receipt-customer' },
        h('div', null, h('strong', null, customer.name), customer.overdue ? h('div', { class: 'muted small' }, inr(customer.overdue) + ' ' + t('overdue')) : null),
        h('div', { class: 'receipt-amount' }, h('strong', null, inr(customer.total)),
          can('sty_sell') ? h('button', { class: 'btn sm', type: 'button', onclick: () => collectCustomer(customer) }, t('Collect')) : null)));
      clear(list).append(...(cards.length ? cards : [empty('check', t(query ? 'No matching customers' : 'No pending dues'), '')]));
    }
    async function loadHistory() {
      const request = ++historyRequest;
      clear(history).append(h('div', { class: 'spin' }));
      let rows;
      try { rows = await api('sty_recent_receipts', { p: year ? { from: year.startDate, to: year.endDate } : {} }); }
      catch (error) {
        if (request === historyRequest) clear(history).append(empty('cloudOff', t('Could not load receipts'), error.message));
        return;
      }
      if (request !== historyRequest) return;
      clear(history).append(...((rows || []).length ? rows.map((payment) => h('article', { class: 'people-card' },
        h('button', { type: 'button', class: 'people-open', onclick: () => billSheet(payment.id, () => v.refresh()) },
          h('span', { class: 'people-identity' }, h('strong', null, payment.number),
            h('small', null, [payment.customer || t('Walk-in'), payment.mode, fmtDay(payment.at)].join(' · '))),
          h('span', { class: 'people-balance' }, h('strong', null, inr(payment.amount)), h('small', null, t('Posted')))))) :
        [empty('cash', t('No receipts in this period'), '')]));
    }
    header();
    const summary = h('div', { class: 'grid' });
    root.append(h('div', { class: 'grid' }, summary, search,
      h('div', { class: 'row receipt-heading' }, h('span', { class: 'cap' }, t('Who owes you')),
        h('button', { type: 'button', class: 'btn sm plain', onclick: showReminders }, t('Send reminders'))),
      list, h('div', { class: 'cap' }, t('Recent receipts')), history));
    const historyLoad = loadHistory();
    try {
      const byCustomer = new Map();
      for (const bill of await api('sty_dues_list') || []) {
        const balance = Number(bill.balance) || 0;
        if (balance <= 0) continue;
        const customer = byCustomer.get(bill.customerId) || { name: bill.name, phone: bill.phone, total: 0, overdue: 0, bills: [] };
        customer.total += balance;
        if (bill.overdue) customer.overdue += balance;
        customer.bills.push(bill);
        byCustomer.set(bill.customerId, customer);
      }
      groups = [...byCustomer.values()].sort((a, b) => b.total - a.total);
      balancesLoaded = true;
      const total = groups.reduce((sum, customer) => sum + customer.total, 0);
      const overdue = groups.reduce((sum, customer) => sum + customer.overdue, 0);
      summary.append(h('div', { class: 'people-total' }, h('strong', null, t('To collect')), h('b', null, inr(total, 0))),
        h('div', { class: 'kpis' }, kpi(t('Overdue'), inr(overdue, 0), t('Past the due date')), kpi(t('Not yet due'), inr(total - overdue, 0))));
      paintCustomers();
    } catch (error) {
      list.append(empty('cloudOff', t('Could not load balances'), error.message,
        h('button', { class: 'btn', type: 'button', onclick: () => v.refresh() }, t('Try again'))));
    }
    await historyLoad;
  },
});
