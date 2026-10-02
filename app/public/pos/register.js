/* Cash register sessions (records of kind 'register'): opening float, cash in and out (optionally recorded as an
   expense), and a close that counts the notes and compares counted with expected per payment method.
   A session counts every payment at this outlet between opening and closing. */
'use strict';
const REG_KEY = () => 'register.' + outletKey();
function currentRegister() {
  let id = null; try { id = localStorage[REG_KEY()]; } catch {}
  const r = rec(id); if (r && !r.closedAt) return r;
  return L('register').filter((x) => !x.closedAt).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0] || null;
}
const currentRegisterId = () => { const r = currentRegister(); return r ? r.id : null; };
const inWin = (iso, a, b) => iso && iso >= a && iso <= b;

function registerSummary(reg) {
  const a = reg.openedAt, b = reg.closedAt || now(), m = { cash: 0, upi: 0, card: 0, giftcard: 0, other: 0 }, ref = { cash: 0, upi: 0, card: 0, other: 0 };
  let bills = 0, tipsCash = 0, tips = 0, sales = 0;
  for (const o of L('order')) {
    if (o.status !== 'paid' && o.status !== 'due') continue;
    let counted = false;
    for (const p of o.pays || []) { const t = p.at || o.paidAt || o.dueAt; if (!inWin(t, a, b)) continue; m[p.m in m ? p.m : 'other'] += +p.amt || 0; counted = true; }
    if (counted) { bills++; sales += o.t.total; }
    if (o.tip && o.tip.amt && inWin(o.paidAt, a, b)) { tips += o.tip.amt; if (o.tip.m === 'cash') tipsCash += o.tip.amt; }
    for (const r of o.refunds || []) if (inWin(r.at, a, b)) ref[r.m in ref ? r.m : 'cash'] += +r.amt || 0;
  }
  const moves = L('cashmove').filter((x) => x.register === reg.id || (!x.register && inWin(x.at, a, b)));
  const cashIn = moves.filter((x) => x.type === 'in').reduce((s, x) => s + (+x.amt || 0), 0), cashOut = moves.filter((x) => x.type === 'out').reduce((s, x) => s + (+x.amt || 0), 0);
  for (const k in m) m[k] = r2(m[k]);
  const expected = r2((+reg.float || 0) + m.cash + tipsCash - ref.cash + cashIn - cashOut);
  return { methods: m, refunds: ref, bills, sales: r2(sales), tips: r2(tips), tipsCash: r2(tipsCash), cashIn: r2(cashIn), cashOut: r2(cashOut), expected, moves };
}

V.register = () => {
  const reg = currentRegister(), hist = L('register').filter((x) => x.closedAt).sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1)).slice(0, 10);
  const histList = hist.length ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Closed registers')), h('div', { class: 'list' }, hist.map((x) => liRow({ ic: 'register', tone: Math.abs(x.variance || 0) < 1 ? 'green' : 'red', title: fmtDay(localDay(x.openedAt)) + ' · ' + fmtTime(x.openedAt) + ' to ' + fmtTime(x.closedAt), sub: (x.openedByName || '') + (x.closeNote ? ' · ' + x.closeNote : ''),
    value: Math.abs(x.variance || 0) < 1 ? 'Balanced' : (x.variance > 0 ? 'Over ' : 'Short ') + inr(Math.abs(x.variance)), chev: true, onclick: () => registerReport(x) })))) : null;
  if (!reg) {
    const fl = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Opening float', style: { fontSize: '22px', textAlign: 'center', fontWeight: '600' } });
    return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Register'), h('div', { class: 'sub' }, 'Closed'))),
      h('div', { class: 'card pad stack s20', style: { maxWidth: '480px' } }, h('div', { class: 'row' }, h('span', { class: 'ic' }, icon('register', 18)), h('div', null, h('h3', null, 'Open the register'), h('div', { class: 'sub small' }, 'Count the cash in the drawer before the first sale.'))),
        field('Opening cash (float)', fl), h('button', { class: 'btn fill lg wide', onclick: () => openRegister(+fl.value || 0) }, 'Open register')), histList);
  }
  const s = registerSummary(reg), m = s.methods;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Register'), h('div', { class: 'sub' }, 'Open since ' + fmtTime(reg.openedAt) + (localDay(reg.openedAt) !== today() ? ' ' + fmtDay(localDay(reg.openedAt)) : '') + ' · ' + (reg.openedByName || ''))),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => cashMoveSheet('in', reg) }, icon('plus', 18), 'Cash in'), h('button', { class: 'btn', onclick: () => cashMoveSheet('out', reg) }, icon('minus', 18), 'Cash out'), h('button', { class: 'btn fill', onclick: () => closeRegister(reg) }, icon('lock', 18), 'Close register'))),
    h('div', { class: 'kpis' }, [['Expected in drawer', inr(s.expected)], ['Cash sales', inr(m.cash)], ['UPI', inr(m.upi)], ['Card', inr(m.card)], ['Gift card / other', inr(m.giftcard + m.other)], ['Bills', String(s.bills)]].map(([k, v]) => h('div', { class: 'kpi' }, h('b', null, v), h('span', null, k)))),
    h('div', { class: 'split2' },
      h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Cash in the drawer')), h('div', { class: 'list' },
        liRow({ title: 'Opening float', value: inr(reg.float || 0) }), liRow({ title: 'Cash sales', value: '+' + inr(m.cash) }), s.tipsCash ? liRow({ title: 'Cash tips', value: '+' + inr(s.tipsCash) }) : null,
        liRow({ title: 'Cash in', value: '+' + inr(s.cashIn) }), liRow({ title: 'Cash out', value: '−' + inr(s.cashOut) }), liRow({ title: 'Cash refunds', value: '−' + inr(s.refunds.cash) }),
        liRow({ title: h('b', null, 'Expected'), value: h('b', null, inr(s.expected)) }))),
      h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Cash movements')), s.moves.length ? h('div', { class: 'list' }, s.moves.sort((a, b) => (a.at < b.at ? 1 : -1)).map((x) => liRow({ ic: x.type === 'in' ? 'plus' : 'minus', tone: x.type === 'in' ? 'green' : 'orange', title: (x.type === 'in' ? 'Cash in' : 'Cash out') + (x.note ? ' · ' + x.note : ''), sub: fmtTime(x.at) + (x.who ? ' · ' + x.who : '') + (x.expense ? ' · recorded as expense' : ''), value: inr(x.amt) }))) : h('div', { class: 'card' }, empty('cash', 'No cash in or out yet')))),
    histList);
};
async function openRegister(float) {
  if (currentRegister()) return render();
  const r = await save('register', { name: localStorage.dev ? 'Till ' + localStorage.dev : 'Till', openedAt: now(), openedBy: S.user.id, openedByName: myName(), float: r2(float), d: today() });
  try { localStorage[REG_KEY()] = r.id; } catch {}
  toast('Register open with ' + inr(float)); render();
}
function cashMoveSheet(type, reg) {
  const a = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Amount', autofocus: true }), note = input({ placeholder: type === 'in' ? 'e.g. change from bank' : 'e.g. milk, auto fare, bank deposit' });
  let asExp = false;
  sheet({ title: type === 'in' ? 'Cash in' : 'Cash out', narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack s20' }, field('Amount', a), field('What for', note),
    type === 'out' ? h('div', { class: 'list' }, liRow({ title: 'Record as an expense', sub: 'Shows under Expenses in the back office', right: switchEl(false, (v) => (asExp = v)) })) : null),
    actions: [{ label: 'Record', primary: true, run: async () => {
      const v = r2(+a.value); if (!(v > 0)) { toast('Enter an amount', { err: true }); return false; }
      await save('cashmove', { d: today(), type, who: myName(), amt: v, note: note.value.trim(), by: S.user.id, at: now(), register: reg.id, expense: asExp || undefined });
      if (asExp) await save('exp', { note: note.value.trim() || 'Paid out from the register', amt: v, d: today(), cat: 'Paid out', by: S.user.id, at: now() });
      toast((type === 'in' ? 'Cash in ' : 'Cash out ') + inr(v)); render();
    } }] });
}
async function closeRegister(reg) {
  const open = openOrders(), pendingKot = open.filter((o) => unsent(o) || o.kstat === 'new' || o.kstat === 'preparing');
  if (open.length && !(await confirmBox(plural(open.length, 'order is', 'orders are') + ' still open', (pendingKot.length ? pendingKot.length + ' of them are still with the kitchen or have items not sent. ' : '') + 'They stay open and will count in the next register. Close anyway?', 'Close anyway', true))) return;
  const s0 = registerSummary(reg), counts = {};
  const totalEl = h('b', { class: 'num' }, inr(0)), varEl = h('div', { class: 'banner' });
  const typed = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: 'Or type the total', 'aria-label': 'Counted total' });
  const card = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: inr(s0.methods.card), 'aria-label': 'Card machine total' }), upi = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: inr(s0.methods.upi), 'aria-label': 'UPI total' });
  const note = input({ placeholder: 'Anything to note about the count' });
  const counted = () => (typed.value !== '' ? r2(+typed.value) : r2(CASH_DENOMS.reduce((a, d) => a + d * (counts[d] || 0), 0)));
  const recalc = () => { const c = counted(), v = r2(c - s0.expected); totalEl.textContent = inr(c); varEl.className = 'banner ' + (Math.abs(v) < 1 ? 'ok' : 'bad'); varEl.replaceChildren(icon(Math.abs(v) < 1 ? 'check' : 'alert', 20), h('div', { class: 'grow' }, h('b', null, Math.abs(v) < 1 ? 'Balanced' : (v > 0 ? 'Over by ' : 'Short by ') + inr(Math.abs(v))), h('span', { class: 'small' }, 'Expected ' + inr(s0.expected)))); };
  typed.oninput = recalc;
  sheet({ title: 'Close register', closeLabel: 'Cancel', body: h('div', { class: 'stack s20' },
    h('div', { class: 'lbl' }, 'Count the cash in the drawer'), h('div', { class: 'list' }, CASH_DENOMS.map((d) => liRow({ title: '₹' + d, right: stepper(0, (v) => { counts[d] = v; typed.value = ''; recalc(); }, 0, 9999) }))),
    typed, h('div', { class: 'row sp' }, h('span', null, 'Counted'), totalEl), varEl,
    h('div', { class: 'lbl' }, 'Card machine and UPI (optional)'), h('div', { class: 'grid2' }, field('Card total', card), field('UPI total', upi)), field('Note', note)),
    actions: [{ label: 'Close register', primary: true, run: async () => {
      const s = registerSummary(reg), c = counted();
      const done = { ...reg, closedAt: now(), closedBy: S.user.id, closedByName: myName(), counted: c, denoms: { ...counts }, expected: s.expected, variance: r2(c - s.expected), methods: s.methods, refunds: s.refunds, bills: s.bills, sales: s.sales, tips: s.tips, cashIn: s.cashIn, cashOut: s.cashOut,
        terminal: { card: card.value !== '' ? r2(+card.value) : null, upi: upi.value !== '' ? r2(+upi.value) : null }, closeNote: note.value.trim() || undefined };
      await save('register', done, reg.id);
      try { delete localStorage[REG_KEY()]; } catch {}
      toast('Register closed'); render(); registerReport(done);
    } }] });
  recalc();
}
function registerReport(x) {
  const m = x.methods || {}, t = x.terminal || {};
  const rows = [['Opening float', x.float], ['Cash sales', m.cash], ['Cash in', x.cashIn], ['Cash out', -x.cashOut], ['Cash refunds', -((x.refunds || {}).cash || 0)], ['Expected cash', x.expected], ['Counted cash', x.counted], ['Difference', x.variance], ['UPI', m.upi], ['Card', m.card], ['Gift card', m.giftcard], ['Other', m.other], ['Bills', null, x.bills], ['Sales', x.sales]];
  const html = '<div class="c"><b>' + esc(cfg().name) + '</b><br>Register summary</div><hr>' + fmtDate(x.openedAt) + ' ' + fmtTime(x.openedAt) + ' to ' + fmtTime(x.closedAt) + '<br>Opened by ' + esc(x.openedByName || '') + '<br>Closed by ' + esc(x.closedByName || '') + '<hr><table style="width:100%">' +
    rows.map(([k, v, raw]) => '<tr><td>' + k + '</td><td class="r">' + (raw != null ? raw : inr(v || 0)) + '</td></tr>').join('') + (t.card != null ? '<tr><td>Card machine</td><td class="r">' + inr(t.card) + '</td></tr>' : '') + (t.upi != null ? '<tr><td>UPI app</td><td class="r">' + inr(t.upi) + '</td></tr>' : '') + '</table>' + (x.closeNote ? '<hr>' + esc(x.closeNote) : '');
  sheet({ title: 'Register summary', narrow: true, body: h('div', { class: 'stack' },
    h('div', { class: 'banner ' + (Math.abs(x.variance || 0) < 1 ? 'ok' : 'bad') }, icon(Math.abs(x.variance || 0) < 1 ? 'check' : 'alert', 20), h('b', null, Math.abs(x.variance || 0) < 1 ? 'Balanced' : (x.variance > 0 ? 'Over by ' : 'Short by ') + inr(Math.abs(x.variance)))),
    h('div', { class: 'list' }, rows.map(([k, v, raw]) => liRow({ title: k, value: raw != null ? String(raw) : inr(v || 0) })), t.card != null ? liRow({ title: 'Card machine said', value: inr(t.card), sub: Math.abs(t.card - (m.card || 0)) >= 1 ? 'Differs from the POS by ' + inr(Math.abs(t.card - (m.card || 0))) : 'Matches' }) : null,
      t.upi != null ? liRow({ title: 'UPI app said', value: inr(t.upi), sub: Math.abs(t.upi - (m.upi || 0)) >= 1 ? 'Differs from the POS by ' + inr(Math.abs(t.upi - (m.upi || 0))) : 'Matches' }) : null)),
    actions: [{ label: 'Print', icon: 'printer', run: () => { prn(html); return false; } }] });
}
