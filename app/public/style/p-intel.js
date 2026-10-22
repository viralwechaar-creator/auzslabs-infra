/* AUZsStyle: Buying intelligence. Built on the real ledger: every number comes from sty_intel_* (db/234) and tells you what to buy,
   where your money is stuck and what to do next. Estimates are labelled as estimates; with too little data it says so. */
'use strict';
const IN = { tab: 'overview', k: '30', from: null, to: null, cat: '', cls: '', q: '' };
const CONF = { high: ['High confidence', 'green'], medium: ['Medium confidence', 'orange'], low: ['Low confidence', 'gray'], insufficient: ['Not enough data', 'gray'] };
const confTag = (c) => { const x = CONF[c] || CONF.insufficient; return h('span', { class: 'itag ' + x[1] }, t(x[0])); };
const scoreTone = (n) => n == null ? 'gray' : n >= 70 ? 'green' : n >= 45 ? 'orange' : 'red';
const dateS = (s) => s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
const itag = (txt, tone) => h('span', { class: 'itag ' + (tone || 'gray') }, txt);
const CLASS_TONE = { 'High-demand winner': 'green', 'Profitable performer': 'green', 'Potential bestseller': 'green', 'Emerging design': 'blue', 'Newly launched (too early to judge)': 'blue', 'Steady performer': 'gray', 'Insufficient data': 'gray', 'Low-velocity inventory': 'orange', 'Discount-dependent': 'orange', 'Seasonal risk': 'red', 'Clearance candidate': 'red' };
const TREND = { up: '▲', down: '▼', flat: '▬' };

page('intel', {
  title: 'Buying intelligence', perm: 'sty_reports',
  async render(v) {
    IN.tab = v.q.get('tab') || IN.tab;
    if (!IN.from) Object.assign(IN, rangeFor('30'));
    v.header({ title: t('Buying intelligence') });
    const host = h('div', { class: 'grid' });
    const tabs = [['overview', t('Overview')], ['designs', t('Designs')], ['reorder', t('What to buy')], ['capital', t('Money stuck')], ['lost', t('Lost demand')], ['basket', t('Baskets')], ['advice', t('Advice')]].filter((x) => x[0] !== 'capital' || S.ctx.canSeeCost);
    v.root.append(rangePicker(IN, load, ['week', 'month', '30', '60', '90', 'custom']), seg(tabs, IN.tab, (x) => { IN.tab = x; load(); }, { full: true }), host);
    const P = () => ({ p: { from: IN.from, to: IN.to, branchId: S.branch, category: IN.cat || null } });
    async function load() {
      clear(host).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
      try {
        const fn = { overview: ovTab, designs: designsTab, reorder: reorderTab, capital: capitalTab, lost: lostTab, basket: basketTab, advice: adviceTab }[IN.tab] || ovTab;
        const node = await fn(P);
        clear(host).append(...[].concat(node).filter(Boolean));
      } catch (e) { clear(host).append(empty('cloudOff', t('Could not load'), e.message, h('button', { class: 'btn fill', onclick: load }, t('Try again')))); }
    }
    load();
  },
});

const defNote = (txt) => h('p', { class: 'muted small' }, txt);

async function ovTab(P) {
  const o = await api('sty_intel_overview', P()); const fresh = o.lastSale ? fmtDT(o.lastSale) : t('no sales yet');
  if (!o.units && !o.stockUnits) return empty('chart', t('Nothing to analyse yet'), t('Add styles with stock and make some sales. These numbers come only from your real bills and stock.'));
  const gp = o.grossProfit;
  return [
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, confTag(o.confidence), h('span', { class: 'muted small' }, t('Period') + ': ' + dateS(o.from) + ' – ' + dateS(o.to) + ' · ' + t('last sale') + ': ' + fresh)),
    h('div', { class: 'kpis' }, kpi(t('Net sales'), inr(o.netSales, 0), t('before tax')), kpi(t('Units sold'), o.units, o.returnRate != null ? o.returnRate + '% ' + t('returned') : ''),
      gp != null ? kpi(t('Gross profit'), inr(gp, 0), o.margin != null ? o.margin + '% ' + t('margin') : '') : null,
      o.gmroi != null ? kpi('GMROI', o.gmroi, t('profit ÷ stock at cost')) : null,
      kpi(t('Sold with a discount'), o.markdownShare != null ? o.markdownShare + '%' : '—', t('of units'))),
    section(t('Needs a decision'), h('div', { class: 'list' },
      liRow({ icon: 'alert', tone: o.outButSelling ? 'red' : 'gray', title: t('Out of stock but selling'), value: o.outButSelling, sub: t('sizes customers want that you cannot sell'), chevron: true, onclick: () => go('intel?tab=reorder') }),
      liRow({ icon: 'bolt', tone: o.atRisk ? 'orange' : 'gray', title: t('Will run out before delivery'), value: o.atRisk, sub: t('stock lasts less than your delivery time'), chevron: true, onclick: () => go('intel?tab=reorder') }),
      o.slowValue != null ? liRow({ icon: 'clock', tone: o.slowVariants ? 'orange' : 'gray', title: t('Money stuck in slow stock'), value: inr(o.slowValue, 0), sub: o.slowVariants + ' ' + t('variants not sold for a long time'), chevron: true, onclick: () => go('intel?tab=capital') }) : null,
      liRow({ icon: 'box', tone: 'gray', title: t('Stock now'), value: o.stockUnits + ' ' + t('Units'), sub: o.stockCost != null ? inr(o.stockCost, 0) + ' ' + t('at cost') : '' }))),
    o.byCategory.length ? section(t('By category'), h('div', { class: 'list' }, o.byCategory.map((c) => liRow({ icon: 'tag', title: c.category, sub: c.units + ' ' + t('Units') + ' · ' + c.stockUnits + ' ' + t('in stock') + (c.margin != null ? ' · ' + c.margin + '% ' + t('margin') : ''), value: inr(c.netSales, 0), valueSub: c.grossProfit != null ? inr(c.grossProfit, 0) + ' ' + t('profit') : '', chevron: true, onclick: () => { IN.cat = c.category; go('intel?tab=designs'); } })))) : null,
    defNote(t('Net sales and profit are before tax and after returns. GMROI is profit in this period divided by what the stock you hold now cost you (past stock values are not stored). Return costs other than refunds are not recorded.'))];
}

function scoreRing(n) { return h('div', { class: 'sring ' + scoreTone(n) }, n == null ? '—' : String(n)); }
const fg = (l, v) => h('div', { class: 'fg' }, h('div', { class: 'fv num' }, v), h('div', { class: 'fl' }, l));

async function designsTab(P) {
  const d = await api('sty_intel_designs', P()); const rows = d.designs;
  if (!rows.length) return empty('shirt', t('No designs yet'), t('Add styles and sell some to see how each one performs.'));
  const classes = [...new Set(rows.map((x) => x.class))];
  const wrap = h('div', { class: 'grid' }); const listHost = h('div', { class: 'grid' });
  const q = input({ value: IN.q, placeholder: t('Search designs'), oninput: () => { IN.q = q.value; paint(); } });
  const chips = h('div', { class: 'chips' });
  const chipsPaint = () => clear(chips).append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!IN.cls), onclick: () => { IN.cls = ''; paint(); chipsPaint(); } }, t('All')), ...classes.map((c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(IN.cls === c), onclick: () => { IN.cls = IN.cls === c ? '' : c; paint(); chipsPaint(); } }, c)));
  chipsPaint();
  const cs = IN.cat ? h('div', { class: 'row', style: { gap: '8px' } }, itag(t('Category') + ': ' + IN.cat, 'blue'), h('button', { class: 'btn sm', type: 'button', onclick: () => { IN.cat = ''; go('intel?tab=designs'); } }, t('Clear'))) : null;
  function designCard(x) {
    return h('button', { class: 'dcard', type: 'button', onclick: () => designSheet(x.id, x.name) },
      scoreRing(x.score), h('div', { class: 'grow' }, h('div', { class: 't' }, x.name, ' ', x.trend ? h('span', { class: 'trend ' + x.trend }, TREND[x.trend]) : null),
        h('div', { class: 's' }, [x.category, x.lifecycle].filter(Boolean).join(' · ')),
        h('div', { class: 'dc-t' }, itag(x.class, CLASS_TONE[x.class] || 'gray'), confTag(x.confidence)),
        h('div', { class: 'dc-g' }, fg(t('Sold'), x.units), fg(t('In stock'), x.stock), fg(t('Cover'), x.coverDays != null ? x.coverDays + 'd' : '—'), fg(t('Full price'), x.fullPricePct != null ? x.fullPricePct + '%' : '—'),
          x.margin != null ? fg(t('Margin'), x.margin + '%') : null, x.sellThrough != null ? fg(t('Sold of received'), x.sellThrough + '%') : null)));
  }
  function paint() {
    const f = rows.filter((x) => (!IN.cls || x.class === IN.cls) && (!IN.q || x.name.toLowerCase().includes(IN.q.toLowerCase())));
    clear(listHost).append(...(f.length ? f.map(designCard) : [empty('shirt', t('No designs match'), t('Change the filter or the period.'))]));
  }
  wrap.append(cs, field(t('Search'), q), chips, listHost, defNote(t('The score (0 to 100) mixes demand and trend, profit, full-price sales, availability, returns and stock age using the weights in Settings. Tap a design for the reasons. "Not enough data" means fewer than 3 sales or 7 days: nothing is judged yet.')),
    S.ctx.canSeeCost && can('sty_manage') ? h('button', { class: 'btn', type: 'button', onclick: () => weightsSheet(d.weights, () => go('intel?tab=designs')) }, t('Change score weights')) : null);
  paint(); return wrap;
}

function weightsSheet(w, done) {
  const LBL = { velocity: 'Demand speed and trend', profit: 'Profit contribution', fullPrice: 'Sold at full price', availability: 'Sizes available', returns: 'Few returns', age: 'Stock age and season' };
  const ins = {}; const body = h('div', { class: 'grid' }, h('div', { class: 'muted small' }, t('These are starting points, not rules. They are used as shares of 100, so only the proportion matters.')), Object.keys(LBL).map((k) => { ins[k] = input({ value: w[k], type: 'number', mode: 'numeric', min: 0, step: 5 }); return field(t(LBL[k]), ins[k]); }));
  sheet({ title: t('Score weights'), closeLabel: t('cancel'), body, actions: [{ label: t('Save'), primary: true, onclick: async (close) => { const nw = {}; Object.keys(LBL).forEach((k) => { nw[k] = Number(ins[k].value) || 0; }); try { await api('sty_intel_set_settings', { p: { weights: nw } }); toast(t('Saved')); close(); done(); } catch (e) { toast(e.message, { err: true }); return false; } } }] });
}

async function designSheet(id, name) {
  const body = h('div', { class: 'grid' }, h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
  const sh = sheet({ title: name, closeLabel: t('Done'), body, actions: [] });
  let d, st; try { [d, st] = await Promise.all([api('sty_intel_design', { p: { from: IN.from, to: IN.to, branchId: S.branch, styleId: id } }), api('sty_intel_designs', { p: { from: IN.from, to: IN.to, branchId: S.branch } })]); } catch (e) { return clear(body).append(empty('cloudOff', t('Could not load'), e.message)); }
  const dz = st.designs.find((x) => x.id === id) || {};
  const sizes = [...new Set(d.variants.map((x) => x.size))].sort((a, b) => sizeRank(a) - sizeRank(b)), cols = [...new Set(d.variants.map((x) => x.colour))];
  const mx = Math.max(1, ...d.variants.map((x) => x.units));
  const cell = (x) => !x ? h('td', null, '·') : h('td', { class: x.stock <= 0 && x.units > 0 ? 'mx-out' : '' }, h('span', { class: 'heat', style: { '--a': (.08 + .8 * x.units / mx).toFixed(2) } }, x.units), h('div', { class: 'mx-s' }, x.stock + ' ' + t('left')), x.stockoutDays > 0 ? h('div', { class: 'mx-o' }, x.stockoutDays + 'd ' + t('out')) : null);
  const comp = dz.components || {}; const cLbl = { velocity: t('Demand and trend'), profit: t('Profit'), fullPrice: t('Full-price sales'), availability: t('Availability'), returns: t('Returns'), age: t('Stock age') };
  clear(body).append(
    dz.id ? h('div', { class: 'card grid' }, h('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } }, scoreRing(dz.score), h('div', { class: 'grow' }, itag(dz.class || '', CLASS_TONE[dz.class] || 'gray'), h('div', { class: 'muted small' }, (dz.lifecycle || '') + ' · ' + (dz.units || 0) + ' ' + t('sold') + ' · ' + t((CONF[dz.confidence] || CONF.insufficient)[0])))),
      dz.score != null ? h('div', { class: 'hb' }, Object.keys(cLbl).filter((k) => comp[k] != null).map((k) => h('div', { class: 'hb-r' }, h('div', { class: 'hb-l' }, cLbl[k]), h('div', { class: 'hb-t' }, h('div', { class: 'hb-f ' + scoreTone(comp[k]), style: { width: Math.max(2, comp[k]) + '%' } })), h('div', { class: 'hb-n num' }, comp[k])))) : h('div', { class: 'muted small' }, t('Not enough sales yet to score this design.'))) : null,
    section(t('Colour × size: sold, stock left, days out of stock'), d.variants.length ? h('div', { class: 'mxw card' }, h('table', { class: 'mx' }, h('thead', null, h('tr', null, h('th'), sizes.map((z) => h('th', null, z)))), h('tbody', null, cols.map((c) => h('tr', null, h('th', { class: 'rl' }, h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, colourDot(c, 12), c || '—')), sizes.map((z) => cell(d.variants.find((x) => x.colour === c && x.size === z)))))))) : empty('shirt', t('No variants'))),
    section(t('Size curve') + (d.sizeCurveBasis === 'category' ? ' (' + t('category average: this design has no sales yet') + ')' : d.sizeCurveBasis === 'blend' ? ' (' + t('own sales plus category, few sales so far') + ')' : ''),
      h('div', { class: 'card' }, h('div', { class: 'hb' }, [...d.sizeCurve].sort((a, b) => sizeRank(a.size) - sizeRank(b.size)).map((z) => h('div', { class: 'hb-r' }, h('div', { class: 'hb-l' }, z.size), h('div', { class: 'hb-t' }, h('div', { class: 'hb-f', style: { width: Math.max(2, z.ownShare || 0) + '%' } })), h('div', { class: 'hb-n num' }, (z.ownShare != null ? z.ownShare + '%' : '—') + ' · ' + (z.categoryShare != null ? z.categoryShare + '% ' + t('category') : '')))))), h('div', { class: 'muted small' }, t('Bar = this design’s share of sales by size. The second number is the category’s share.'))),
    d.variants.some((x) => x.estLostUnits != null) ? section(t('Estimated lost sales (not recorded sales)'), h('div', { class: 'list' }, d.variants.filter((x) => x.estLostUnits != null).map((x) => liRow({ icon: 'alert', tone: 'orange', title: [x.colour, x.size].filter(Boolean).join(' '), sub: x.stockoutDays + ' ' + t('days out of stock') + ' · ' + t('sold') + ' ' + x.units, value: '~' + x.estLostUnits, valueSub: t('units (estimate)') })))) : null,
    d.newDesignEstimate ? section(t('Starting estimate for a new design'), h('div', { class: 'card grid' }, d.newDesignEstimate.basis === 'none' ? h('div', { class: 'muted' }, t('Insufficient data') + ': ' + d.newDesignEstimate.note) : h('div', null, h('b', null, d.newDesignEstimate.perDayLow + ' – ' + d.newDesignEstimate.perDayHigh + ' ' + t('units a day')), h('div', { class: 'muted small' }, d.newDesignEstimate.note)))) : null,
    d.comparables.length ? section(t('Similar designs'), h('div', { class: 'list' }, d.comparables.map((c) => liRow({ icon: 'shirt', title: c.name, sub: t('same') + ': ' + c.matchedOn.join(', '), value: c.units + ' ' + t('sold'), valueSub: c.perDay + ' ' + t('per day') })))) : null,
    can('sty_manage') ? section(t('Buying rules for this design'), policyForm(d, sh)) : null,
    h('button', { class: 'btn', type: 'button', onclick: () => { sh.close(); IN.styleOnly = id; go('intel?tab=reorder'); } }, t('See reorder suggestion for this design')));
}

function policyForm(d, sh) {
  const s = d.style; const POL = [['', t('Not set (treated as evergreen)')], ['evergreen', t('Evergreen basic: keep replenishing')], ['seasonal', t('Seasonal: stop when the season ends')], ['fashion', t('Fashion trend')], ['limited', t('Limited edition: never reorder')]];
  const pol = h('select', { class: 'input' }, POL.map(([k, l]) => h('option', { value: k, selected: k === (s.policy || '') }, l)));
  const end = input({ type: 'date', value: s.seasonEnd ? String(s.seasonEnd).slice(0, 10) : '' }), lead = input({ value: s.leadDays ?? '', type: 'number', mode: 'numeric', placeholder: t('shop default') }), pack = input({ value: s.packSize ?? '', type: 'number', mode: 'numeric' }), min = input({ value: s.minOrder ?? '', type: 'number', mode: 'numeric' });
  const sup = h('select', { class: 'input' }, h('option', { value: '' }, t('None')));
  api('sty_intel_settings').then((c) => { clear(sup).append(h('option', { value: '' }, t('None')), ...c.suppliers.map((x) => h('option', { value: x.id, selected: x.id === s.supplierId }, x.name))); }).catch(() => {});
  return h('div', { class: 'card grid' }, field(t('Type of design'), pol), field(t('Season ends on'), end), h('div', { class: 'two' }, field(t('Delivery time (days)'), lead), field(t('Pieces per pack'), pack)), field(t('Supplier minimum order (pieces)'), min), field(t('Supplier'), sup),
    h('button', { class: 'btn fill', type: 'button', onclick: async (ev) => { ev.currentTarget.disabled = true; try { await api('sty_intel_set_policy', { p_style: s.id, p: { policy: pol.value, seasonEnd: end.value || null, leadDays: lead.value === '' ? null : Number(lead.value), packSize: pack.value === '' ? null : Number(pack.value), minOrder: min.value === '' ? null : Number(min.value), supplierId: sup.value || null } }); toast(t('Saved')); sh.close(); go('intel?tab=designs'); } catch (e) { toast(e.message, { err: true }); ev.currentTarget.disabled = false; } } }, t('Save')));
}

async function reorderTab(P) {
  const args = P(); const only = IN.styleOnly; if (only) args.p.styleId = only; IN.styleOnly = null;
  const r = await api('sty_intel_reorder', args); const items = r.items;
  const back = only ? h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => go('intel?tab=reorder') }, t('Show all designs'))) : null;
  if (!items.length) return [back, empty('check', t('Nothing needs ordering'), t('No size is selling fast enough to run out before a delivery could arrive, based on this period.'))];
  const sel = new Map(items.filter((i) => i.suggestQty > 0).map((i) => [i.variantId, i.suggestQty]));
  const byStyle = new Map(); items.forEach((i) => { if (!byStyle.has(i.styleId)) byStyle.set(i.styleId, { name: i.name, rows: [] }); byStyle.get(i.styleId).rows.push(i); });
  const total = h('div', { class: 'num' });
  const upd = () => { const q = [...sel.values()].reduce((a, b) => a + b, 0); const c = items.reduce((a, i) => a + (sel.has(i.variantId) && i.estCost != null && i.suggestQty ? sel.get(i.variantId) * (i.estCost / i.suggestQty) : 0), 0); total.textContent = q + ' ' + t('pieces') + (r.costHidden ? '' : ' · ~' + inr(c, 0) + ' ' + t('at cost')); };
  const blocks = [...byStyle.values()].map((g) => section(g.name, h('div', { class: 'list' }, g.rows.map((i) => {
    const qin = input({ value: sel.get(i.variantId) ?? 0, type: 'number', mode: 'numeric', min: 0, oninput: () => { const n = Math.max(0, Math.floor(Number(qin.value) || 0)); if (n) sel.set(i.variantId, n); else sel.delete(i.variantId); upd(); } }); qin.style.width = '72px';
    return h('div', { class: 'li rrow' }, h('span', { class: 'tile ' + (i.stock <= 0 ? 'red' : 'orange') }, icon(i.stock <= 0 ? 'alert' : 'bolt', 18)), h('div', { class: 'grow' }, h('div', { class: 't' }, [i.colour, i.size].filter(Boolean).join(' · ') || i.name), h('div', { class: 's' }, i.reason),
      h('div', { class: 'dc-t' }, confTag(i.confidence), i.basis !== 'own' ? itag(t('estimate') + ': ' + i.basis, 'gray') : null, i.stockoutDate ? itag(t('runs out') + ' ' + dateS(i.stockoutDate), i.stock <= 0 ? 'red' : 'orange') : null)),
      i.suggestQty > 0 ? h('div', { class: 'rq' }, h('div', { class: 'fl' }, t('Buy')), qin) : h('div', { class: 'itag red' }, t('Hold')));
  }))));
  const csv = () => csvDownload('reorder-plan.csv', [['Design', 'Colour', 'Size', 'Stock', 'Per day', 'Delivery days', 'Run-out date', 'Buy', 'Basis', 'Confidence'], ...items.filter((i) => sel.has(i.variantId)).map((i) => [i.name, i.colour, i.size, i.stock, i.perDay, i.leadDays, i.stockoutDate || '', sel.get(i.variantId), i.basis, i.confidence])]);
  upd();
  return [back, banner('info', 'alert', t('Incoming purchase orders are not tracked yet, so incoming stock counts as 0. Check what is already on its way before you order.')),
    ...blocks, h('div', { class: 'card row', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, h('div', { class: 'grow' }, h('b', null, t('Your plan')), total), h('button', { class: 'btn', type: 'button', onclick: csv }, icon('download', 16), t('Download plan (CSV)')), can('sty_purchase') ? h('button', { class: 'btn fill', type: 'button', onclick: () => go('buy') }, t('Go to Buy')) : null),
    defNote(t('Edit any quantity above before you order. Reorder point = demand during delivery time + safety stock. Quantities are rounded to the pack size and split by the design’s own size curve. Nothing is ordered for you.'))];
}

async function capitalTab() {
  const c = await api('sty_intel_capital', { p: { branchId: S.branch } });
  if (!c.designs.length && !c.totalCost) return empty('wallet', t('No stock to analyse'), t('Receive stock first.'));
  const TONE = { 'Seasonal risk': 'red', Stagnant: 'red', Excess: 'orange', Slow: 'gray' };
  return [h('div', { class: 'kpis' }, kpi(t('Stock at cost'), inr(c.totalCost, 0)), kpi(t('Money stuck'), inr(c.tiedCost, 0), c.totalCost ? Math.round(c.tiedCost * 100 / c.totalCost) + '% ' + t('of your stock') : ''), kpi(t('Same stock at selling price'), inr(c.tiedRetail, 0))),
    c.byTag.length ? section(t('Why it is stuck'), h('div', { class: 'card' }, h('div', { class: 'hb' }, c.byTag.map((x) => h('div', { class: 'hb-r' }, h('div', { class: 'hb-l' }, t(x.tag)), h('div', { class: 'hb-t' }, h('div', { class: 'hb-f ' + (TONE[x.tag] || ''), style: { width: Math.max(2, x.cost * 100 / Math.max(c.tiedCost, 1)) + '%' } })), h('div', { class: 'hb-n num' }, inr(x.cost, 0) + ' · ' + x.units)))))) : null,
    section(t('Designs holding the most money'), c.designs.length ? h('div', { class: 'list' }, c.designs.map((d) => liRow({ icon: 'clock', tone: TONE[d.tag] || 'gray', title: d.name, sub: t(d.tag) + ' · ' + d.units + ' ' + t('Units') + ' · ' + t('idle') + ' ' + d.maxIdle + 'd' + (d.clearMonths ? ' · ~' + d.clearMonths + ' ' + t('months to clear') : ''), value: inr(d.cost, 0), valueSub: d.action }))) : empty('check', t('Nothing is stuck'), t('Every design with stock has sold recently.'))),
    section(t('Oldest stock'), h('div', { class: 'list' }, c.oldest.map((o) => liRow({ title: o.name, sub: [o.colour, o.size].filter(Boolean).join(' · ') + ' · ' + o.stock + ' ' + t('Units'), value: o.idle + 'd', valueSub: inr(o.cost, 0) })))),
    defNote(c.note)];
}

async function lostTab(P) {
  const l = await api('sty_intel_lost', P());
  return [h('div', { class: 'kpis' }, kpi(t('Estimated lost units'), l.estLostUnits ? '~' + Math.round(l.estLostUnits) : '0', t('an estimate, not sales')), kpi(t('Estimated lost revenue'), '~' + inr(l.estLostRevenue, 0), t('never added to your sales')), kpi(t('Customer requests'), l.requestCount, t('asked for things you did not have'))),
    section(t('Sizes that were out of stock'), l.variants.length ? h('div', { class: 'list' }, l.variants.map((v) => liRow({ icon: 'alert', tone: v.estLostUnits != null ? 'orange' : 'gray', title: v.name + ' · ' + [v.colour, v.size].filter(Boolean).join(' '), sub: v.stockoutDays + ' ' + t('of') + ' ' + v.windowDays + ' ' + t('days out of stock') + ' · ' + t('sold') + ' ' + v.units, value: v.estLostUnits != null ? '~' + v.estLostUnits : t('Insufficient data'), valueSub: v.estLostUnits != null ? '~' + inr(v.estLostRevenue, 0) : '' }))) : empty('check', t('No stockouts'), t('Every size was available all through this period.'))),
    l.requests.length ? section(t('What customers asked for'), h('div', { class: 'list' }, l.requests.map((r) => liRow({ icon: 'users', title: r.name + ([r.colour, r.size].some(Boolean) ? ' · ' + [r.colour, r.size].filter(Boolean).join(' ') : ''), value: r.asks + '×', valueSub: r.units + ' ' + t('pieces') })))) : null,
    h('button', { class: 'btn', type: 'button', onclick: () => go('requests') }, t('Open customer requests')), defNote(l.note)];
}

async function basketTab(P) {
  const b = await api('sty_intel_basket', P());
  if (!b.bills) return empty('tag', t('No bills in this period'));
  const maxBand = Math.max(1, ...b.priceBands.map((x) => x.units));
  return [h('div', { class: 'kpis' }, kpi(t('Bills'), b.bills), kpi(t('Pieces per bill'), b.avgBasket ?? '—'), kpi(t('Repeat customers'), b.repeat.customers ? Math.round(b.repeat.repeat * 100 / b.repeat.customers) + '%' : '—', b.repeat.customers ? b.repeat.repeat + ' ' + t('of') + ' ' + b.repeat.customers : t('Insufficient data'))),
    section(t('Bought together'), b.pairs.length ? h('div', { class: 'list' }, b.pairs.map((x) => liRow({ icon: 'swap', title: x.a + ' + ' + x.b, sub: t('together in') + ' ' + x.together + ' ' + t('bills') + ' · ' + x.confidence + '% ' + t('of buyers of the first also bought the second'), value: x.together + '×' }))) : empty('swap', t('No clear pairs yet'), t('A pair needs at least 3 bills together before it is shown.'))),
    section(t('Price bands'), h('div', { class: 'card' }, h('div', { class: 'hb' }, b.priceBands.map((x) => h('div', { class: 'hb-r' }, h('div', { class: 'hb-l' }, x.band), h('div', { class: 'hb-t' }, h('div', { class: 'hb-f', style: { width: Math.max(2, x.units * 100 / maxBand) + '%' } })), h('div', { class: 'hb-n num' }, x.units + ' · ' + inr(x.revenue, 0))))))),
    defNote(b.note)];
}

async function adviceTab(P) {
  const a = await api('sty_intel_assistant', P());
  const ICON = { reorder: 'bolt', hold: 'lock', capital: 'wallet', lost: 'alert', winner: 'check', discount: 'tag' }, TONE = { reorder: 'orange', hold: 'red', capital: 'red', lost: 'orange', winner: 'green', discount: 'orange' };
  if (!a.items.length) return empty('check', t('No advice yet'), t('Advice appears when there are enough real sales and stock records to support it.'));
  return [banner('info', 'info', a.note),
    ...a.items.map((i) => h('div', { class: 'card grid advice' }, h('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-start' } }, h('span', { class: 'tile ' + (TONE[i.kind] || '') }, icon(ICON[i.kind] || 'info', 18)), h('div', { class: 'grow' }, h('b', null, i.title), h('div', null, i.text))),
      h('div', { class: 'dc-t' }, i.confidence ? confTag(i.confidence) : null, i.impact ? itag(i.impact, 'blue') : null, itag(t('Data') + ': ' + i.period, 'gray')),
      i.assumptions ? h('div', { class: 'muted small' }, t('Assumes') + ': ' + i.assumptions) : null, i.alternative ? h('div', { class: 'muted small' }, t('Instead') + ': ' + i.alternative) : null))];
}
