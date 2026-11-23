/* AUZsStyle: Overview (the day at a glance) and Analytics (built around variants: what sells, in which size and
   colour, how fast, what to reorder, what is stuck). All numbers come from sty_dashboard / sty_analytics / sty_insights. */
'use strict';
const RU = { k: 'today', from: null, to: null };
function hbars(rows, o = {}) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return h('div', { class: 'hb' }, rows.map((r) => h('div', { class: 'hb-r' }, h('div', { class: 'hb-l' }, r.l), h('div', { class: 'hb-t' }, h('div', { class: 'hb-f' + (r.tone ? ' ' + r.tone : ''), style: { width: Math.max(2, r.v / max * 100) + '%' } })), h('div', { class: 'hb-v num' }, r.txt != null ? r.txt : o.money ? inr(r.v, 0) : nf0.format(r.v)))));
}
// every hour in the shop's busy window gets a bar (even with no sales), so one hour never becomes one giant block
function hourRows(by) {
  const m = new Map(by.map((x) => [Number(x.hour), Number(x.revenue) || 0])); const hs = [...m.keys()];
  const a = Math.min(9, ...hs), z = Math.max(21, ...hs); const out = [];
  for (let i = a; i <= z; i++) out.push({ l: i, v: m.get(i) || 0 });
  return out;
}
function vbars(rows, o = {}) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return h('div', { class: 'vb' }, rows.map((r) => h('div', { class: 'vb-c', title: r.l + ': ' + (o.money ? inr(r.v, 0) : r.v) }, h('div', { class: 'vb-b' }, h('div', { class: 'vb-f', style: { height: Math.max(2, r.v / max * 100) + '%' } })), h('div', { class: 'vb-l' }, r.l))));
}
const delta = (a, b) => { const d = pct(a, b); return h('span', { class: 'dl ' + (d >= 0 ? 'up' : 'dn') }, (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d) + '%'); };

page('home', {
  title: 'Overview', perm: 'sty_reports',
  async render(v) {
    const view = v.q.get('view');
    const sectionId = view === 'analytics' ? 'analytics' : view === 'payments' ? 'payments' : 'overview';
    v.root.append(seg([['overview', t('Overview')], ['payments', t('Payments')], ['analytics', t('Analytics')]], sectionId,
      (id) => go(id === 'overview' ? 'home' : 'home?view=' + id), { full: true }));
    if (sectionId === 'analytics') return PAGES.analytics.render(v);
    if (sectionId === 'payments') return paymentsView(v);
    v.header({ title: t('Overview') });
    Object.assign(RU, rangeFor(RU.k, RU.from ? { from: RU.from, to: RU.to } : null));
    const host = h('div', { class: 'grid' });
    v.root.append(rangePicker(RU, load), host);
    async function load() {
      clear(host).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
      let d, ins; try { [d, ins] = await Promise.all([api('sty_dashboard', { p: { from: RU.from, to: RU.to, branchId: S.branch } }), api('sty_insights', { p: { branchId: S.branch } })]); } catch (e) { return clear(host).append(empty('cloudOff', t('Could not load'), e.message, h('button', { class: 'btn fill', onclick: load }, t('Try again')))); }
      const c = d.current, p = d.previous, inv = d.inventory;
      const showProfit = S.ctx.canSeeCost;
      clear(host).append(
        h('div', { class: 'hero-k' }, h('div', { class: 'cap' }, t('Revenue')), h('div', { class: 'big num' }, inr(c.revenue, 0)), h('div', null, delta(c.revenue, p.revenue), ' ', h('span', { class: 'muted small' }, t('vs the period before')))),
        h('div', { class: 'kpis' }, kpi(t('Bills'), c.bills, '', null), kpi(t('Units'), c.units), kpi(t('Average bill'), inr(c.bills ? c.revenue / c.bills : 0, 0)),
          showProfit ? kpi(t('Profit'), inr(c.profit, 0), c.revenue ? Math.round(c.profit / c.revenue * 100) + '% ' + t('margin') : '') : null, kpi(t('Returns'), d.returns.count, inr(d.returns.amount, 0)), kpi(t('Discount'), inr(d.discount, 0))),
        d.byPayment.length ? section(t('Money received'), h('div', { class: 'card' }, hbars(d.byPayment.map((x) => ({ l: String(x.mode).toUpperCase(), v: x.amount })), { money: true }))) : null,
        d.byHour.length ? section(t('Busy hours'), h('div', { class: 'card' }, vbars(hourRows(d.byHour), { money: true }))) : null,
        d.topStyles.length ? section(t('Best sellers'), h('div', { class: 'list' }, d.topStyles.map((x, i) => liRow({ icon: 'shirt', title: x.name, sub: x.category, value: x.units + ' ' + t('Units'), valueSub: inr(x.revenue, 0) })))) : (c.bills ? null : empty('tag', t('No sales in this period'))),
        section(t('Needs attention'), h('div', { class: 'list' },
          liRow({ icon: 'alert', tone: inv.out ? 'red' : 'gray', title: t('Out of stock'), value: inv.out, sub: t('items you cannot sell right now'), chevron: true, onclick: () => go('analytics?tab=next') }),
          liRow({ icon: 'bolt', tone: ins.reorder.length ? 'orange' : 'gray', title: t('To reorder'), value: ins.reorder.length, sub: t('running low or selling fast'), chevron: true, onclick: () => go('analytics?tab=next') }),
          liRow({ icon: 'clock', tone: 'gray', title: t('Slow stock'), value: ins.slow.length, sub: t('not sold for') + ' ' + S.ctx.settings.slowDays + '+ ' + t('days'), chevron: true, onclick: () => go('analytics?tab=next') }),
          liRow({ icon: 'wallet', tone: 'gray', title: t('Customers owe you'), value: inr(d.receivable, 0) }), can('sty_purchase') ? liRow({ icon: 'truck', tone: 'gray', title: t('You owe suppliers'), value: inr(Math.max(d.payable, 0), 0), chevron: true, onclick: () => go('buy?tab=suppliers') }) : null)),
        section(t('Stock'), h('div', { class: 'kpis' }, kpi(t('Units'), nf0.format(inv.units)), kpi(t('Stock value'), inr(inv.costValue, 0), t('at cost')), kpi(t('Retail value'), inr(inv.retailValue, 0)))));
    }
    load();
  },
});

const AU = { tab: 'sells', k: '30', from: null, to: null };
const GU = { sub: 'period', year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function periodGstTab(host) {
  host.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
  let sub = 'summary', request = 0;
  async function load() {
    const version = ++request;
    const period = { year: GU.year, month: GU.month };
    const from = period.year + '-' + String(period.month).padStart(2, '0') + '-01';
    const to = from.slice(0, 8) + new Date(period.year, period.month, 0).getDate();
    let summary, checks, purchases, salesRegister;
    try {
      [summary, checks, purchases, salesRegister] = await Promise.all([
        api('sty_gst_period_summary', { p: period }),
        api('sty_gst_period_checks', { p: period }),
        sub === 'registers' && can('sty_purchase') ? api('sty_purchase_register', { p: { from, to } }) : null,
        sub === 'registers' ? api('sty_gst_sales_register', { p: period }).then(data => ({ data }), error => ({ error })) : null,
      ]);
    } catch (error) {
      if (version === request) clear(host).append(empty('cloudOff', t('Could not load'), error.message,
        h('button', { class: 'btn', type: 'button', onclick: load }, t('Try again'))));
      return;
    }
    if (version === request) paint(summary, checks, purchases, salesRegister, { ...period, from });
  }
  function paint(p, c, purchases, salesRegister, period) {
    const filed = p.status === 'filed';
    const monthSel = selectEl(MONTHS.map((m, i) => [i + 1, t(m)]), GU.month, { onchange: (e) => { GU.month = Number(e.target.value); load(); } });
    const yearSel = selectEl([GU.year - 1, GU.year, GU.year + 1].map((y) => [y, String(y)]), GU.year, { onchange: (e) => { GU.year = Number(e.target.value); load(); } });
    const netPayable = Math.max(r2(p.output.tax - p.input.tax), 0);
    clear(host).append(h('div', { class: 'grid' },
      h('div', { class: 'row', style: { gap: '8px' } }, monthSel, yearSel, h('span', { class: 'chip', style: { pointerEvents: 'none' } }, filed ? t('Filed') : t('Open'))),
      h('p', { class: 'muted small' }, t('These are working papers built from your bills -- AUZsStyle does not file returns or call the GST portal. Have your accountant confirm figures and rates before filing.')),
      seg([['summary', t('Summary')], ['registers', t('Registers')], ['checks', t('Checks')], ['filing', t('Filing lock')]], sub, (x) => { sub = x; load(); }),
      sub === 'summary' ? h('div', { class: 'grid' },
        h('div', { class: 'kpis' }, kpi(t('Output tax'), inr(p.output.tax, 0), t('On sales of') + ' ' + inr(p.output.taxable, 0)),
          kpi(t('Input tax credit'), inr(p.input.tax, 0), t('Eligible purchases') + ' ' + inr(p.input.taxable, 0)),
          kpi(t('Net payable'), inr(netPayable, 0), t('indicative'))),
        section(t('By tax head'), h('div', { class: 'card' }, isDesk() ? dataView([
            { label: t('Head'), render: (r) => r.head }, { label: t('Output'), r: true, render: (r) => inr(r.output, 0) },
            { label: t('Credit available'), r: true, render: (r) => inr(r.credit, 0) }, { label: t('Payable'), r: true, render: (r) => inr(Math.max(r.output - r.credit, 0), 0) }],
            [{ head: 'IGST', output: p.output.igst, credit: p.input.igst }, { head: 'CGST', output: p.output.cgst, credit: p.input.cgst }, { head: 'SGST', output: p.output.sgst, credit: p.input.sgst }])
          : h('div', { class: 'list' }, ['igst', 'cgst', 'sgst'].map((k) => liRow({ title: k.toUpperCase(), sub: t('Credit available') + ' ' + inr(p.input[k], 0), value: inr(p.output[k], 0), valueSub: t('Output') }))))),
        p.byRate.length ? section(t('Sales by rate'), h('div', { class: 'list' }, p.byRate.map((r) => liRow({ title: r.rate + '% GST', sub: t('Taxable') + ' ' + inr(r.taxable, 0), value: inr(r.tax, 0), valueSub: t('Tax') })))) : null,
        null)
        : sub === 'registers' ? styleGstRegisters(p, purchases, salesRegister, period.from.slice(0, 7))
        : sub === 'filing' ? h('div', { class: 'card grid' },
          h('strong', null, filed ? t('Filed and locked') : t('Open')),
          h('p', { class: 'muted small' }, filed ? t('Bills and purchases in this month are locked.') : t('Bills and purchases can still be recorded for this month.')),
          can('sty_manage') ? h('div', null, h('button', { class: 'btn' + (filed ? '' : ' fill'), type: 'button', onclick: async () => {
            const label = filed ? t('Unlock period') : t('Mark as filed and lock');
            const prompt = filed ? t('Bills and purchases can be changed in this month again.') : t('Bills and purchases in this month will be locked until it is reopened.');
            if (!await confirmBox(label, prompt, label, filed)) return;
            try { await api(filed ? 'sty_gst_period_reopen' : 'sty_gst_period_file', { p: { year: period.year, month: period.month } }); }
            catch (error) { return fail(error); }
            load();
          } }, filed ? t('Unlock period') : t('Mark as filed and lock'))) : null)
        : h('div', { class: 'grid' },
          c.noShopGstin ? banner('warn', 'alert', t('No GSTIN set for your shop (Settings -> Shop).')) : null,
          c.salesMissingHsn > 0 ? banner('warn', 'alert', c.salesMissingHsn + ' ' + t('taxed sale lines this month have no HSN code')) : null,
          c.purchasesMissingHsn > 0 ? banner('warn', 'alert', c.purchasesMissingHsn + ' ' + t('taxed purchase lines this month have no HSN code')) : null,
          c.salesNoGstinInterstate > 0 ? banner('warn', 'alert', c.salesNoGstinInterstate + ' ' + t('inter-state sales this month have no customer GSTIN on record')) : null,
          (!c.noShopGstin && !c.salesMissingHsn && !c.purchasesMissingHsn && !c.salesNoGstinInterstate) ? banner('ok', 'check', t('Nothing needs attention')) : null)));
  }
  load();
}
function styleGstRegisters(summary, purchases, salesRegister, month) {
  const sales = summary.byRate || [];
  const bills = purchases?.bills || [];
  const table = (head, fields, rows) => h('div', { class: 'card' }, dataView(head.map(([label, money], index) => ({
    label: t(label), r: money, render: (row) => money ? inr(row[fields[index]]) : row[fields[index]],
  })), rows));
  const details = h('div', { class: 'grid' });
  const registers = [
    ['registered', 'Registered sales', ['Date', 'Invoice', 'Customer', 'GSTIN', 'Place of supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
      ['at', 'number', 'customer', 'gstin', 'placeOfSupply', 'taxable', 'cgst', 'sgst', 'igst', 'total']],
    ['unregistered', 'Unregistered sales', ['Date', 'Invoice', 'Customer', 'Place of supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
      ['at', 'number', 'customer', 'placeOfSupply', 'taxable', 'cgst', 'sgst', 'igst', 'total']],
    ['hsn', 'HSN summary', ['HSN', 'Rate', 'Lines', 'Taxable', 'CGST', 'SGST', 'IGST'],
      ['hsn', 'rate', 'lines', 'taxable', 'cgst', 'sgst', 'igst']],
  ];
  const paintDetails = (key) => {
    const [, label, columns, fields] = registers.find(([id]) => id === key);
    const rows = salesRegister?.data?.[key] || [];
    const values = (row) => fields.map((field) => row[field] ?? (field === 'hsn' ? t('Missing HSN') : ''));
    clear(details).append(
      h('p', { class: 'muted small' }, t('Sales are grouped using the current customer GSTIN. Review this register before filing.')),
      rows.length ? h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => exportCSV('gst-' + key + '-' + month, columns, rows.map(values)) }, t('Export CSV'))) : null,
      rows.length ? h('div', { class: 'people-cards' }, rows.map((row) => peopleRecordCard({
        name: key === 'hsn' ? (row.hsn || t('Missing HSN')) : row.number,
        detail: key === 'hsn' ? row.rate + '% · ' + row.lines + ' ' + t('lines')
          : [row.customer || t('Walk-in'), row.gstin, fmtDay(row.at)].filter(Boolean).join(' · '),
        amount: inr(row.taxable), status: t('Taxable'), tone: 'open',
        open: () => key === 'hsn' ? sheet({ title: row.hsn || t('Missing HSN'), body: h('div', { class: 'list' },
          [['CGST', row.cgst], ['SGST', row.sgst], ['IGST', row.igst]].map(([title, amount]) => liRow({ title, value: inr(amount) }))) })
          : billSheet(row.id),
      }))) : empty('tag', t('Nothing in this register'), t(label)));
  };
  if (salesRegister?.data) paintDetails('registered');
  const detailTabs = salesRegister?.data ? h('div', { class: 'grid' },
    seg(registers.map(([id, label]) => [id, t(label)]), 'registered', paintDetails), details)
    : empty('cloudOff', t('Could not load detailed sales registers'), salesRegister?.error?.message || '');
  return h('div', { class: 'grid' },
    detailTabs,
    section(t('Sales by tax rate'), sales.length ? h('div', { class: 'grid' },
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => exportCSV('gst-sales-' + month,
        ['Rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'Tax'], sales.map((row) => [row.rate, row.taxable, row.cgst, row.sgst, row.igst, row.tax])) }, t('Export sales CSV'))),
      table([['Rate'], ['Taxable', true], ['CGST', true], ['SGST', true], ['IGST', true]], ['rate', 'taxable', 'cgst', 'sgst', 'igst'], sales))
      : empty('tag', t('No sales in this period'))),
    can('sty_purchase') ? section(t('Purchase register'), bills.length ? h('div', { class: 'grid' },
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => exportCSV('gst-purchases-' + month,
        ['Date', 'Invoice', 'Supplier', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
        bills.map((row) => [row.at, row.invoiceNo, row.supplier, row.taxableValue, row.cgst, row.sgst, row.igst, row.total])) }, t('Export purchases CSV'))),
      h('div', { class: 'list' }, bills.map((row) => liRow({ title: row.supplier || t('No supplier'), sub: [row.invoiceNo, fmtDay(row.at)].filter(Boolean).join(' · '),
        value: inr(row.total), chevron: true, onclick: () => purchaseSheet({ id: row.id }) }))))
      : empty('box', t('No purchases in this period'))) : null);
}
page('gst', {
  title: 'GST', perm: 'sty_reports',
  render(v) {
    v.header({ title: t('GST') });
    const host = h('div', { class: 'grid' });
    v.root.append(host);
    periodGstTab(host);
  },
});
page('analytics', {
  title: 'Analytics', perm: 'sty_reports',
  async render(v) {
    AU.tab = v.q.get('tab') || AU.tab; if (!v.q.get('tab')) AU.tab = AU.tab || 'sells';
    if (!AU.from) Object.assign(AU, rangeFor('30'));
    v.header({ title: t('Analytics'), actions: [{ label: 'CSV', icon: 'download', run: () => exportCsv() }] });
    let data = null, ins = null, grp = null, gst = null;
    const host = h('div', { class: 'grid' });
    v.root.append(rangePicker(AU, load, ['week', 'month', '30', 'custom']),
      seg([['sells', t('What sells')], ['sizes', t('Sizes & colours')], ['groups', t('Fabric & collection')], ['variants', t('Fast & slow')], ['next', t('What to buy')], ['staff', t('Staff')], ['gst', t('GST')]], AU.tab, (x) => { AU.tab = x; paint(); }), host);
    async function load() {
      clear(host).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
      try { [data, ins, grp, gst] = await Promise.all([api('sty_analytics', { p: { from: AU.from, to: AU.to, branchId: S.branch } }), api('sty_insights', { p: { branchId: S.branch } }), api('sty_analytics_groups', { p: { from: AU.from, to: AU.to, branchId: S.branch } }), api('sty_gst_summary', { p: { from: AU.from, to: AU.to } })]); } catch (e) { return clear(host).append(empty('cloudOff', t('Could not load'), e.message, h('button', { class: 'btn fill', onclick: load }, t('Try again')))); }
      paint();
    }
    function exportGstCsv() {
      if (!gst) return;
      csvDownload('gst-summary-' + AU.from + '-' + AU.to + '.csv', [['Rate %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total tax']].concat(gst.byRate.map((x) => [x.rate, x.taxable, x.cgst, x.sgst, x.igst, x.tax])));
    }
    function exportCsv() {
      if (!data) return;
      csvDownload('variants-' + AU.from + '-' + AU.to + '.csv', [['Style', 'Category', 'Colour', 'Size', 'Barcode', 'Units sold', 'Revenue', 'Profit', 'Stock', 'Received', 'Sell-through %', 'Per day', 'Cover days', 'Days to first sale', 'Days to sell out']].concat(data.variants.map((x) => [x.name, x.category, x.colour, x.size, x.barcode, x.units, x.revenue, x.profit, x.stock, x.received, x.sell_through, x.per_day, x.cover_days, x.days_to_first_sale, x.days_to_sell_out])));
    }
    function paint() {
      if (!data) return; clear(host);
      const empt = !data.byStyle.length;
      if (AU.tab === 'sells') {
        if (empt) return host.append(empty('chart', t('No sales in this period'), t('Sell something and this fills in.')));
        host.append(
          section(t('Sales by category'), h('div', { class: 'card' }, hbars(data.byCategory.map((x) => ({ l: x.category, v: x.units, txt: x.units + ' · ' + inr(x.revenue, 0) }))))),
          section(t('Best selling styles'), h('div', { class: 'list' }, data.byStyle.slice(0, 15).map((x, i) => liRow({ title: (i + 1) + '. ' + x.name, sub: [x.category, x.best_size ? t('best size') + ' ' + x.best_size : '', x.best_colour ? x.best_colour : ''].filter(Boolean).join(' · '), value: x.units + ' ' + t('Units'), valueSub: inr(x.revenue, 0) + (S.ctx.canSeeCost ? ' · ' + t('profit') + ' ' + inr(x.profit, 0) : '') })))),
          section(t('Busy days'), h('div', { class: 'card' }, vbars(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => ({ l: d, v: Number((data.byWeekday.find((x) => x.dow === i) || {}).revenue || 0) })), { money: true }))),
          section(t('Busy hours'), h('div', { class: 'card' }, vbars(hourRows(data.byHour), { money: true }))));
      } else if (AU.tab === 'sizes') {
        if (empt) return host.append(empty('chart', t('No sales in this period')));
        const sizes = [...new Set(data.catSize.map((x) => x.size))].sort((a, b) => sizeRank(a) - sizeRank(b)), cats = [...new Set(data.catSize.map((x) => x.category))];
        const mx = Math.max(1, ...data.catSize.map((x) => x.units));
        host.append(
          section(t('Sales by size'), h('div', { class: 'card' }, hbars([...data.bySize].sort((a, b) => sizeRank(a.size) - sizeRank(b.size)).map((x) => ({ l: x.size, v: x.units })))), h('div', { class: 'muted small' }, t('Your most asked-for size is') + ' ' + (data.bySize[0] || {}).size)),
          section(t('Category × size'), h('div', { class: 'mxw card' }, h('table', { class: 'mx' }, h('thead', null, h('tr', null, h('th'), sizes.map((z) => h('th', null, z)))), h('tbody', null, cats.map((c) => h('tr', null, h('th', { class: 'rl' }, c), sizes.map((z) => { const u = (data.catSize.find((x) => x.category === c && x.size === z) || {}).units || 0; return h('td', null, u ? h('span', { class: 'heat', style: { '--a': (.12 + .75 * u / mx).toFixed(2) } }, u) : '·'); }))))))),
          section(t('Sales by colour'), h('div', { class: 'card' }, hbars(data.byColour.map((x) => ({ l: h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, colourDot(x.colour, 12), x.colour), v: x.units }))))),
          data.returnsBySize.some((x) => x.returned > 0) ? section(t('Returns by size'), h('div', { class: 'card' }, hbars(data.returnsBySize.filter((x) => x.sold > 0).map((x) => ({ l: x.size, v: Number(x.rate || 0), tone: 'red', txt: x.rate + '% (' + x.returned + '/' + x.sold + ')' }))), h('div', { class: 'muted small' }, t('A size that comes back a lot may run small or large.')))) : null);
      } else if (AU.tab === 'groups') {
        if (empt) return host.append(empty('chart', t('No sales in this period')));
        const blk = (title, rows) => rows.length && !(rows.length === 1 && rows[0].name === 'Not set') ? section(title, h('div', { class: 'card' }, hbars(rows.map((x) => ({ l: x.name, v: x.units, txt: x.units + ' · ' + inr(x.revenue, 0) + (x.stock != null ? ' · ' + x.stock + ' ' + t('in stock') : '') }))))) : null;
        host.append(blk(t('Sales by type'), grp.type), blk(t('Sales by fabric'), grp.fabric), blk(t('Sales by collection'), grp.collection), blk(t('Sales by brand'), grp.brand), blk(t('Sales by gender'), grp.gender),
          section(t('Sales by colour'), h('div', { class: 'card' }, hbars(data.byColour.map((x) => ({ l: h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, colourDot(x.colour, 12), x.colour), v: x.units }))))),
          h('p', { class: 'muted small' }, t('Fill in type, fabric and collection when you add a style to see them here.')));
      } else if (AU.tab === 'variants') {
        if (empt) return host.append(empty('chart', t('No sales in this period')));
        const fig = (l, v) => h('div', { class: 'fg' }, h('div', { class: 'fv num' }, v), h('div', { class: 'fl' }, l));
        host.append(h('p', { class: 'muted small' }, t('Each row is one colour and size. "Sold of received" is how much of what arrived has sold; "first sale after" counts from the day it arrived.')),
          isDesk() ? dataView([{ label: t('Item'), title: true, render: (r) => r.name + ' · ' + [r.colour, r.size].filter(Boolean).join(' ') }, { label: t('Category'), render: (r) => r.category },
            { label: t('Sold'), r: true, value: true, render: (r) => r.units }, { label: t('Per day'), r: true, render: (r) => r.per_day }, { label: t('In stock'), r: true, render: (r) => r.stock },
            { label: t('Sold of received'), r: true, sub: true, render: (r) => r.sell_through != null ? r.sell_through + '%' : '—' }, { label: t('Cover'), r: true, render: (r) => r.cover_days != null ? r.cover_days + ' ' + t('days') : '—' },
            { label: t('First sale after'), r: true, render: (r) => r.days_to_first_sale != null ? r.days_to_first_sale + ' ' + t('days') : '—' }, { label: t('Sold out in'), r: true, render: (r) => r.days_to_sell_out != null ? r.days_to_sell_out + ' ' + t('days') : '—' }], data.variants)
          : h('div', { class: 'vcards' }, data.variants.map((r) => h('div', { class: 'vcard' },
              h('div', { class: 'vc-h' }, colourDot(r.colour, 12), h('div', { class: 'grow' }, h('div', { class: 't' }, r.name), h('div', { class: 's' }, [r.colour, r.size && t('Size') + ' ' + r.size, r.category].filter(Boolean).join(' · '))), h('div', { class: 'vc-n num' }, r.units, h('span', null, t('sold')))),
              h('div', { class: 'vc-g' }, fig(t('Per day'), r.per_day), fig(t('In stock'), r.stock), fig(t('Sold of received'), r.sell_through != null ? r.sell_through + '%' : '—'),
                fig(t('Cover'), r.cover_days != null ? r.cover_days + 'd' : '—'), fig(t('First sale after'), r.days_to_first_sale != null ? r.days_to_first_sale + 'd' : '—'), fig(t('Sold out in'), r.days_to_sell_out != null ? r.days_to_sell_out + 'd' : '—')),
              S.ctx.canSeeCost ? h('div', { class: 'vc-f' }, t('Revenue') + ' ' + inr(r.revenue, 0) + ' · ' + t('profit') + ' ' + inr(r.profit, 0)) : null))));
      } else if (AU.tab === 'next') {
        host.append(
          ins.stockOutSelling.length ? section(t('Out of stock but selling'), h('div', { class: 'list' }, ins.stockOutSelling.map((x) => liRow({ icon: 'alert', tone: 'red', title: x.name, sub: [x.colour, x.size].filter(Boolean).join(' · ') + ' · ' + x.per_day + ' ' + t('per day'), value: t('Out of stock') })))) : null,
          section(t('Reorder suggestions'), ins.reorder.length ? h('div', { class: 'list' }, ins.reorder.map((x) => liRow({ icon: 'bolt', tone: 'orange', title: x.name, sub: [x.colour, x.size].filter(Boolean).join(' · ') + ' · ' + t('have') + ' ' + x.stock + (x.cover_days != null ? ' · ' + x.cover_days + ' ' + t('days left') : ''), value: '+' + x.suggest, valueSub: t('suggested') }))) : empty('check', t('Nothing to reorder'))),
          ins.sizeCurve.length ? section(t('Size mix: selling vs holding'), h('div', { class: 'card' }, sizeCurveNode(ins.sizeCurve))) : null,
          section(t('Slow stock'), ins.slow.length ? h('div', { class: 'list' }, ins.slow.map((x) => liRow({ icon: 'clock', title: x.name, sub: [x.colour, x.size].filter(Boolean).join(' · ') + ' · ' + x.stock + ' ' + t('pcs') + ' · ' + x.days_idle + ' ' + t('days idle'), value: inr(x.value, 0), valueSub: t('tied up') }))) : empty('check', t('No slow stock'))),
          ins.overstock.length ? section(t('More than 4 months of stock'), h('div', { class: 'list' }, ins.overstock.map((x) => liRow({ title: x.name, sub: [x.colour, x.size].filter(Boolean).join(' · '), value: x.stock + ' ' + t('pcs'), valueSub: x.cover_days + ' ' + t('days of cover') })))) : null);
      } else if (AU.tab === 'gst') {
        if (!gst) return;
        const gsub = h('div');
        host.append(seg([['period', t('Return period')], ['range', t('Custom range')]], GU.sub, (x) => { GU.sub = x; paintGst(); }), gsub);
        paintGst();
        function paintGst() {
          if (GU.sub === 'period') return periodGstTab(gsub);
          clear(gsub).append(
            h('div', { class: 'kpis' }, kpi(t('Taxable value'), inr(gst.totals.taxable, 0)), kpi('CGST', inr(gst.totals.cgst, 0)), kpi('SGST', inr(gst.totals.sgst, 0)), kpi('IGST', inr(gst.totals.igst, 0)), kpi(t('Total tax'), inr(gst.totals.tax, 0), gst.totals.bills + ' ' + t('Bills'))),
            h('button', { class: 'btn', type: 'button', onclick: exportGstCsv }, icon('download', 18), t('Export CSV')),
            gst.byRate.length ? section(t('By tax rate') + ' — ' + t('working papers for your accountant, not a GST-portal filing'), isDesk() ? dataView([
              { label: t('Rate'), render: (r) => r.rate + '%' }, { label: t('Taxable'), r: true, value: true, render: (r) => inr(r.taxable, 0) },
              { label: 'CGST', r: true, render: (r) => inr(r.cgst, 0) }, { label: 'SGST', r: true, render: (r) => inr(r.sgst, 0) }, { label: 'IGST', r: true, render: (r) => inr(r.igst, 0) },
              { label: t('Total tax'), r: true, render: (r) => inr(r.tax, 0) }], gst.byRate)
              : h('div', { class: 'list' }, gst.byRate.map((r) => liRow({ title: r.rate + '% GST', sub: t('Taxable') + ' ' + inr(r.taxable, 0) + ' · CGST ' + inr(r.cgst, 0) + ' · SGST ' + inr(r.sgst, 0) + (r.igst > 0 ? ' · IGST ' + inr(r.igst, 0) : ''), value: inr(r.tax, 0), valueSub: t('Total tax') })))) : empty('tag', t('No sales in this period')));
        }
      } else {
        host.append(data.staff.length ? h('div', { class: 'list' }, data.staff.map((x) => liRow({ icon: 'user', title: x.name, sub: x.bills + ' ' + t('Bills') + ' · ' + x.units + ' ' + t('Units') + ' · ' + t('avg') + ' ' + inr(x.avg_bill, 0) + (x.target ? ' · ' + Math.round(x.revenue / x.target * 100) + '% ' + t('of target') : ''), value: inr(x.revenue, 0), valueSub: x.commission ? t('Commission') + ' ' + inr(x.commission) : S.ctx.canSeeCost ? t('profit') + ' ' + inr(x.profit, 0) : '' }))) : empty('users', t('No sales in this period')));
      }
    }
    load();
  },
});
// For each size in a category: how much of what you sold was that size, versus how much of what you hold is that size.
function sizeCurveNode(rows) {
  const cats = [...new Set(rows.map((r) => r.category))];
  return h('div', { class: 'grid' }, cats.map((c) => h('div', null, h('b', null, c), h('div', { class: 'sc' }, rows.filter((r) => r.category === c).sort((a, b) => sizeRank(a.size) - sizeRank(b.size)).map((r) => {
    const gap = Number(r.sold_pct) - Number(r.stock_pct || 0);
    return h('div', { class: 'sc-r' }, h('span', { class: 'sc-z' }, r.size), h('div', { class: 'sc-b' }, h('div', { class: 'sc-s', style: { width: Math.min(100, r.sold_pct) + '%' } }), h('div', { class: 'sc-k', style: { width: Math.min(100, r.stock_pct || 0) + '%' } })),
      h('span', { class: 'sc-n num' }, r.sold_pct + '% / ' + (r.stock_pct || 0) + '%'), gap > 8 ? h('span', { class: 'dl dn' }, t('buy more')) : gap < -8 ? h('span', { class: 'dl up' }, t('enough')) : null);
  })))), h('div', { class: 'muted small' }, t('Top bar = share of sales. Bottom bar = share of stock held.')));
}


// Overview > Payments: what came in as cash and what came in online (UPI, card, bank / online), shown apart.
// Credit and store credit are not money received, so they sit in their own line under "Not received yet".
function paymentsView(v) {
  v.header({ title: t('Overview') });
  Object.assign(RU, rangeFor(RU.k, RU.from ? { from: RU.from, to: RU.to } : null));
  const host = h('div', { class: 'grid' });
  v.root.append(rangePicker(RU, load), host);
  const ONLINE = ['upi', 'card', 'online', 'bank', 'razorpay', 'netbanking', 'wallet'];
  async function load() {
    clear(host).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
    let d; try { d = await api('sty_dashboard', { p: { from: RU.from, to: RU.to, branchId: S.branch } }); } catch (e) { clear(host).append(h('p', { class: 'muted' }, e.message || t('Could not load.'))); return; }
    const rows = (d.byPayment || []).map((x) => ({ mode: String(x.mode || '').toLowerCase(), amount: Number(x.amount) || 0 }));
    const cash = rows.filter((x) => x.mode === 'cash');
    const online = rows.filter((x) => ONLINE.includes(x.mode));
    const other = rows.filter((x) => x.mode !== 'cash' && !ONLINE.includes(x.mode));
    const sum = (a) => a.reduce((n, x) => n + x.amount, 0);
    const cashT = sum(cash), onT = sum(online), total = cashT + onT;
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    const label = (m) => ({ cash: t('Cash'), upi: 'UPI', card: t('Card'), online: t('Online'), bank: t('Bank transfer') }[m] || m.toUpperCase());
    const list = (a) => a.length ? h('div', { class: 'list' }, ...a.map((x) => liRow({ icon: 'cash', title: label(x.mode), right: h('b', { class: 'num' }, inr(x.amount, 0)) }))) : h('p', { class: 'muted small' }, t('Nothing received this way in this period.'));
    clear(host).append(
      h('div', { class: 'hero-k' }, h('div', { class: 'cap' }, t('Received in this period')), h('div', { class: 'big num' }, inr(total, 0)),
        h('div', { class: 'muted small' }, t('Cash') + ' ' + pct(cashT) + '% · ' + t('Online') + ' ' + pct(onT) + '%')),
      h('div', { class: 'kpis' }, kpi(t('Cash'), inr(cashT, 0), pct(cashT) + '%', null), kpi(t('Online'), inr(onT, 0), pct(onT) + '%', null)),
      section(t('Cash'), h('div', { class: 'card' }, list(cash))),
      section(t('Online (UPI, card, bank)'), h('div', { class: 'card' }, list(online))),
      other.length ? section(t('Not received yet (credit, store credit)'), h('div', { class: 'card' }, list(other))) : null);
  }
  load();
}
