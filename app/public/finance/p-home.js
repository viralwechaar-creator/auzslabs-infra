/* AUZsFinance: Today. One big number (money you have), three quiet figures, what needs a look, owed both ways, recent. */
'use strict';
const PERIODS = [['month', 'This month'], ['week', 'This week'], ['year', 'This year']];
function periodDates(k) {
  const d = new Date(todayISO() + 'T00:00:00'), iso = (x) => x.toISOString().slice(0, 10), to = todayISO();
  if (k === 'week') { const f = new Date(d); f.setDate(f.getDate() - 6); return [iso(f), to]; }
  if (k === 'year') return [d.getFullYear() + '-01-01', to];
  return [to.slice(0, 8) + '01', to];
}
page('home', { title: 'Today', async render(v) {
  const per = LS.get('per', 'month');
  v.header({ title: 'Today', actions: [can('write') ? { label: 'Add entry', icon: 'plus', primary: true, run: () => addTxn() } : null] });
  const host = h('div', { class: 'grid' }); v.root.append(host);
  const load = async () => {
    const [f, to] = periodDates(per);
    const since = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    const [d, flow] = await Promise.all([api('fin_dashboard', { p_from: f, p_to: to }), api('fin_txn_list', { p: { from: since, limit: 500, with_reversed: false } }).catch(() => [])]);
    clear(host);
    const net = Number(d.money_in) - Number(d.money_out);
    host.append(
      moneyHero(d, flow),
      seg(PERIODS, per, (x) => { LS.set('per', x); v.refresh(); }, { full: true }),
      h('div', { class: 'trio' },
        h('div', null, h('div', { class: 'k' }, 'In'), h('div', { class: 'n num up' }, inr(d.money_in))),
        h('div', null, h('div', { class: 'k' }, 'Out'), h('div', { class: 'n num down' }, inr(d.money_out))),
        h('div', null, h('div', { class: 'k' }, 'Left'), h('div', { class: 'n num ' + (net < 0 ? 'down' : '') }, inr(net)))),
      (d.needs_review || d.no_evidence) ? h('div', { class: 'list' },
        d.needs_review ? liRow({ icon: 'alert', tone: 'orange', title: d.needs_review + ' entr' + (d.needs_review === 1 ? 'y' : 'ies') + ' to check', chevron: true, onclick: () => go('activity?review=needs_review') }) : null,
        d.no_evidence ? liRow({ icon: 'camera', tone: 'gray', title: d.no_evidence + ' without a bill or proof', chevron: true, onclick: () => go('activity?evidence=none') }) : null) : null,
      h('div', { class: 'duo' },
        kpi('To receive', inr(d.dues_in), 'Customers owe you', () => go('dues')),
        kpi('To pay', inr(d.dues_out), 'You owe suppliers', () => go('dues'))),
      (Number(d.capital) || Number(d.drawings) || Number(d.loans_taken) || Number(d.loans_given)) ? section('Owner and loans', h('div', { class: 'list' },
        liRow({ icon: 'wallet', tone: 'gray', title: 'Owner capital', value: inr(Number(d.capital) - Number(d.drawings)), chevron: true, onclick: () => go('owner') }),
        Number(d.loans_taken) ? liRow({ icon: 'download', tone: 'gray', title: 'Loans you owe', value: inr(d.loans_taken), chevron: true, onclick: () => go('owner') }) : null,
        Number(d.loans_given) ? liRow({ icon: 'upload', tone: 'gray', title: 'Loans given', value: inr(d.loans_given), chevron: true, onclick: () => go('owner') }) : null)) : null,
      d.by_category.length ? section('Where it went', spendStrip(d.by_category), h('div', { class: 'list' }, d.by_category.slice(0, 6).map((c) => liRow({ title: c.name, value: inr(c.amount), badge: h('div', { class: 'bar' }, h('i', { style: { width: Math.max(4, c.amount / d.by_category[0].amount * 100) + '%' } })) })))) : null,
      section('Recent', d.recent.length ? h('div', { class: 'list' }, d.recent.map((r) => txnRow(r, () => txnSheet(r.id)))) : empty('swap', 'Nothing yet', 'Tap the + button to record your first money in or out.', can('write') ? h('button', { class: 'btn fill', onclick: () => addTxn() }, 'Add entry') : null)));
  };
  await load();
} });

// ---- the money line: last 30 days, drag a finger (or the mouse) along it to read any day
const MOVES = ['money_in', 'expense', 'capital_in', 'drawing', 'loan_taken', 'loan_given', 'loan_repay', 'loan_collect', 'dues_in', 'dues_out', 'asset_buy'];
function balanceSeries(flow, nowBal, days) {
  const out = [], today = new Date(todayISO() + 'T00:00:00');
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today); day.setDate(day.getDate() - i); const iso = day.toISOString().slice(0, 10);
    const later = flow.filter((r) => r.status === 'posted' && MOVES.includes(r.kind) && String(r.txn_date).slice(0, 10) > iso).reduce((a, r) => a + signed(r), 0);
    out.push({ iso, v: Number(nowBal) - later });
  }
  return out;
}
function countUp(el, to) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; if (reduce || !isFinite(to)) { el.textContent = inr(to); return; }
  const t0 = performance.now(), dur = 650;
  const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = inr(Math.round(to * e)); if (k < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = inr(to); };
  requestAnimationFrame(step);
}
function moneyHero(d, flow) {
  const k = h('div', { class: 'k' }, 'Money you have'), n = h('div', { class: 'n num' }, inr(0));
  const sub = h('div', { class: 'small muted' }, d.accounts.map((a) => a.name + ' ' + inr(a.balance)).join(' · '));
  const box = h('div', { class: 'hero-n' }, k, n, sub);
  countUp(n, Number(d.cash_total));
  const ser = balanceSeries(flow || [], d.cash_total, 30);
  if (ser.length > 1 && ser.some((x) => x.v !== ser[0].v)) {
    const W = 320, H = 64, pad = 4, lo = Math.min(...ser.map((x) => x.v)), hi = Math.max(...ser.map((x) => x.v)), span = hi - lo || 1;
    const X = (i) => pad + (W - 2 * pad) * i / (ser.length - 1), Y = (v) => pad + (H - 2 * pad) * (1 - (v - lo) / span);
    const pts = ser.map((x, i) => X(i).toFixed(1) + ',' + Y(x.v).toFixed(1)).join(' ');
    const NS = 'http://www.w3.org/2000/svg', el = (t, a) => { const e = document.createElementNS(NS, t); for (const q in a) e.setAttribute(q, a[q]); return e; };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'flow', role: 'img', 'aria-label': 'Money over the last 30 days' });
    svg.append(el('polygon', { points: `${X(0)},${H} ${pts} ${X(ser.length - 1)},${H}`, class: 'flow-a' }), el('polyline', { points: pts, class: 'flow-l', pathLength: '1' }));
    const dot = el('circle', { r: 4, cx: X(ser.length - 1), cy: Y(ser[ser.length - 1].v), class: 'flow-d' }); svg.append(dot);
    const rule = el('line', { x1: 0, x2: 0, y1: 0, y2: H, class: 'flow-r' }); rule.style.display = 'none'; svg.append(rule);
    const base = k.textContent;
    const at = (ev) => {
      const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(ser.length - 1, Math.round(((ev.clientX - r.left) / r.width) * (ser.length - 1)))), x = ser[i];
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(x.v)); rule.setAttribute('x1', X(i)); rule.setAttribute('x2', X(i)); rule.style.display = '';
      k.textContent = fmtD(x.iso); n.textContent = inr(x.v);
    };
    const end = () => { rule.style.display = 'none'; dot.setAttribute('cx', X(ser.length - 1)); dot.setAttribute('cy', Y(ser[ser.length - 1].v)); k.textContent = base; n.textContent = inr(d.cash_total); };
    svg.addEventListener('pointerdown', (ev) => { svg.setPointerCapture(ev.pointerId); at(ev); });
    svg.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'mouse') at(ev); });
    svg.addEventListener('pointerup', end); svg.addEventListener('pointerleave', end); svg.addEventListener('pointercancel', end);
    box.append(svg, h('div', { class: 'flow-cap small muted' }, h('span', null, fmtShort(ser[0].iso)), h('span', null, 'Drag to see any day'), h('span', null, fmtShort(ser[ser.length - 1].iso))));
  }
  return box;
}
// one rounded strip showing how the spending splits, biggest first; darker = bigger
function spendStrip(cats) {
  const top = cats.slice(0, 6), tot = top.reduce((a, c) => a + Number(c.amount), 0) || 1;
  return h('div', { class: 'strip', role: 'img', 'aria-label': 'How spending splits' }, top.map((c, i) => h('i', { style: { flexGrow: String(Math.max(1, Math.round(Number(c.amount) / tot * 100))), opacity: String(1 - i * 0.15) }, title: c.name + ' ' + inr(c.amount) })));
}
