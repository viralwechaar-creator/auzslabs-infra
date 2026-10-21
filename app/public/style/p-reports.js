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
page('analytics', {
  title: 'Analytics', perm: 'sty_reports',
  async render(v) {
    AU.tab = v.q.get('tab') || AU.tab; if (!v.q.get('tab')) AU.tab = AU.tab || 'sells';
    if (!AU.from) Object.assign(AU, rangeFor('30'));
    v.header({ title: t('Analytics'), actions: [{ label: 'CSV', icon: 'download', run: () => exportCsv() }] });
    let data = null, ins = null, grp = null;
    const host = h('div', { class: 'grid' });
    v.root.append(rangePicker(AU, load, ['week', 'month', '30', 'custom']),
      seg([['sells', t('What sells')], ['sizes', t('Sizes & colours')], ['groups', t('Fabric & collection')], ['variants', t('Fast & slow')], ['next', t('What to buy')], ['staff', t('Staff')]], AU.tab, (x) => { AU.tab = x; paint(); }), host);
    async function load() {
      clear(host).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
      try { [data, ins, grp] = await Promise.all([api('sty_analytics', { p: { from: AU.from, to: AU.to, branchId: S.branch } }), api('sty_insights', { p: { branchId: S.branch } }), api('sty_analytics_groups', { p: { from: AU.from, to: AU.to, branchId: S.branch } })]); } catch (e) { return clear(host).append(empty('cloudOff', t('Could not load'), e.message, h('button', { class: 'btn fill', onclick: load }, t('Try again')))); }
      paint();
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
