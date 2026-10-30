/* Cash drawer: the notes and coins counted on cash sales and purchases, bank deposits and withdrawals, loans, owner cash and
   opening / closing counts. The server (db/309) keeps the drawer equal to the Cash account of the books. */
'use strict';
const DENOMS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const dnTotal = (n) => DENOMS.reduce((s, d) => s + d * (Number((n || {})[d]) || 0), 0);
const dnClean = (n) => { const o = {}; DENOMS.forEach((d) => { const v = Math.floor(Number((n || {})[d]) || 0); if (v > 0) o[d] = v; }); return o; };
const dnLabel = (d) => (d >= 10 ? '₹' + d + ' note' : '₹' + d + ' coin');

// A grid of notes and coins with + and - buttons. get() = counts, onChange fires on every change.
function denomGrid(initial, onChange, o = {}) {
  const cnt = {}; DENOMS.forEach((d) => { cnt[d] = Math.max(0, Math.floor(Number((initial || {})[d]) || 0)); });
  const subs = {}, ins = {};
  const totEl = h('span', { class: 'num' });
  const upd = () => { DENOMS.forEach((d) => { ins[d].value = cnt[d] ? String(cnt[d]) : ''; subs[d].textContent = cnt[d] ? inr(cnt[d] * d) : ''; }); totEl.textContent = inr(dnTotal(cnt)); onChange && onChange(cnt); };
  const rows = DENOMS.map((d) => {
    ins[d] = h('input', { class: 'input dn-in', inputmode: 'numeric', placeholder: '0', 'aria-label': dnLabel(d) + ' count', oninput: (e) => { cnt[d] = Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)); upd(); } });
    subs[d] = h('span', { class: 'dn-sub muted small' });
    const step = (x) => h('button', { class: 'btn sm dn-b', type: 'button', 'aria-label': (x > 0 ? 'Add one ' : 'Remove one ') + dnLabel(d), onclick: () => { cnt[d] = Math.max(0, cnt[d] + x); upd(); } }, x > 0 ? '+' : '−');
    return h('div', { class: 'dn-row' }, h('span', { class: 'dn-l' }, dnLabel(d)), step(-1), ins[d], step(1), subs[d]);
  });
  const node = h('div', { class: 'dn' }, h('div', { class: 'dn-grid' }, ...rows), h('div', { class: 'dn-tot' }, h('span', { class: 'muted' }, o.totalLabel || 'Total counted'), totEl));
  upd();
  return { node, get: () => dnClean(cnt), total: () => dnTotal(cnt), set: (n) => { DENOMS.forEach((d) => { cnt[d] = Math.max(0, Math.floor(Number((n || {})[d]) || 0)); }); upd(); } };
}

// Change for a given amount using the notes and coins listed (largest first).
function dnChange(amount) { const o = {}; let left = Math.round(amount); DENOMS.forEach((d) => { if (d <= left) { o[d] = Math.floor(left / d); left -= o[d] * d; } }); return o; }

// Count the notes for one cash payment. kind 'sale': notes received and change given; 'purchase': notes paid out (and change back).
// Resolves {notes_in, notes_out} or null when skipped.
function notePad(o) {
  const bill = Number(o.amount) || 0, sale = o.kind !== 'purchase';
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    let first = null, second = null, msg = null;
    first = denomGrid(o.initial && (sale ? o.initial.notes_in : o.initial.notes_out), () => upd(), { totalLabel: sale ? 'Received from the customer' : 'Paid out' });
    second = denomGrid(o.initial && (sale ? o.initial.notes_out : o.initial.notes_in), () => upd(), { totalLabel: sale ? 'Change given back' : 'Change received back' });
    msg = h('div', { class: 'banner' }); const sugg = h('button', { class: 'btn sm', type: 'button', onclick: () => { const need = first.total() - bill; if (need > 0) second.set(dnChange(need)); } }, 'Fill the change for me');
    function upd() {
      if (!first || !second || !msg) return;
      const a = first.total(), b = second.total(), net = a - b;
      const okk = Math.abs(net - bill) < 0.005;
      msg.className = 'banner ' + (okk ? 'info' : '');
      msg.textContent = okk ? 'Matches the cash of ' + inr(bill) + '.' : (sale ? 'Received ' + inr(a) + ' minus change ' + inr(b) + ' = ' + inr(net) + '. It must be ' + inr(bill) + (a - bill > 0 && net !== bill ? ' (change due ' + inr(Math.max(a - bill, 0)) + ').' : '.') : 'Paid ' + inr(a) + ' minus change ' + inr(b) + ' = ' + inr(net) + '. It must be ' + inr(bill) + '.');
    }
    upd();
    sheet({ title: o.title || (sale ? 'Count the cash' : 'Count the cash paid'), closeLabel: 'Skip', onClose: () => fin(null),
      body: h('div', { class: 'grid', style: { gap: '12px' } },
        h('div', { class: 'row sp' }, h('div', { class: 'muted' }, sale ? 'Cash to receive' : 'Cash to pay'), h('div', { class: 'num', style: { fontSize: '22px', fontWeight: 700 } }, inr(bill))),
        h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, sale ? 'Notes and coins received' : 'Notes and coins paid out')), first.node),
        h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, sale ? 'Change given back' : 'Change received back (if any)'), sale ? sugg : null), second.node),
        msg),
      actions: [{ label: 'Save count', primary: true, onclick: (c) => {
        const a = first.total(), b = second.total();
        if (Math.abs(a - b - bill) >= 0.005) { toast('The notes do not match the cash amount yet', { err: true }); return false; }
        const nin = sale ? first.get() : second.get(), nout = sale ? second.get() : first.get();
        fin({ notes_in: nin, notes_out: nout }); c();
      } }] });
  });
}

// Saves the counted notes against a posted document. Never blocks the sale: a failure only shows a message.
async function drawerSave(docId, pad, op) {
  if (!pad || !docId) return;
  try { await api('acc_drawer_record', { p: { doc_id: docId, notes_in: pad.notes_in || {}, notes_out: pad.notes_out || {}, op: op || null } }); }
  catch (e) { toast('The sale is saved, but the cash count was not: ' + (e.message || e), { err: true }); }
}
const isCashAcc = (id) => { const a = (S.accounts || []).find((x) => x.id === id); return !!(a && a.is_cash && !a.is_bank); };

// ---------- the Cash drawer page ----------
const DKIND = {
  sale: ['Cash sale', 'green', 'in'], purchase: ['Cash purchase', 'red', 'out'], deposit: ['Deposit to bank', 'blue', 'out'], withdraw: ['Withdrawal from bank', 'blue', 'in'],
  loan_given: ['Loan given', 'orange', 'out'], loan_collected: ['Loan repaid to you', 'green', 'in'], loan_taken: ['Loan taken', 'green', 'in'], loan_repaid: ['Loan repaid by you', 'red', 'out'],
  owner_in: ['Owner put in cash', 'green', 'in'], owner_out: ['Owner took out cash', 'red', 'out'],
};
const MOVES = [
  { kind: 'deposit', label: 'Deposit to bank', icon: 'bank', bank: true }, { kind: 'withdraw', label: 'Withdraw from bank', icon: 'bank', bank: true },
  { kind: 'loan_given', label: 'Lend money', icon: 'user', who: 'Lent to' }, { kind: 'loan_collected', label: 'Loan paid back to you', icon: 'user', who: 'Paid back by' },
  { kind: 'loan_taken', label: 'Borrow money', icon: 'user', who: 'Borrowed from' }, { kind: 'loan_repaid', label: 'Repay a loan', icon: 'user', who: 'Paid back to' },
  { kind: 'owner_in', label: 'Owner puts in cash', icon: 'plus', who: 'By' }, { kind: 'owner_out', label: 'Owner takes out cash', icon: 'minus', who: 'By' },
];

async function moveSheet(m, st, done) {
  const incoming = DKIND[m.kind][2] === 'in';
  const amt = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount' });
  const dt = dateInput(today()), who = m.who ? input({ placeholder: m.who + ' (name)', label: m.who }) : null, memo = input({ placeholder: 'Note (optional)', label: 'Note' });
  const bank = m.bank ? selectEl((st.banks || []).map((b) => [b.id, b.name]), (st.banks[0] || {}).id) : null;
  let pad = null; const padBtn = h('button', { class: 'btn sm', type: 'button' }, 'Count notes (optional)');
  const padTxt = h('span', { class: 'muted small' }, 'Tick which notes ' + (incoming ? 'came into' : 'left') + ' the drawer, or leave empty.');
  padBtn.onclick = async () => {
    const a = Number(amt.value); if (!(a > 0)) { toast('Enter the amount first', { err: true }); return; }
    const r = await notePad({ amount: a, kind: incoming ? 'sale' : 'purchase', title: m.label, initial: pad });
    if (r) { pad = r; padTxt.textContent = 'Notes counted: ' + inr(dnTotal(incoming ? r.notes_in : r.notes_out)); }
  };
  sheet({ title: m.label, body: h('div', { class: 'grid' },
    st.banks && m.bank && !st.banks.length ? h('div', { class: 'banner' }, 'Add a bank account in Settings first.') : null,
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Amount', amt), field('Date', dt)),
    bank ? field('Bank account', bank) : null, who ? field(m.who, who) : null, field('Note', memo),
    h('div', { class: 'row sp' }, padTxt, padBtn)),
    actions: [{ label: 'Save', primary: true, onclick: async (c) => {
      const a = Number(amt.value); if (!(a > 0)) { amt.classList.add('err'); amt.focus(); return false; }
      if (m.bank && !(bank && bank.value)) { toast('Choose a bank account', { err: true }); return false; }
      if (pad && Math.abs(dnTotal(incoming ? pad.notes_in : pad.notes_out) - a) > 0.005) { toast('The counted notes do not match the amount. Count again or clear.', { err: true }); return false; }
      await api('acc_drawer_move', { p: { kind: m.kind, amount: a, date: dt.value, bank_account_id: bank ? bank.value : null, who: who ? who.value : null, memo: memo.value, notes_in: pad ? pad.notes_in : {}, notes_out: pad ? pad.notes_out : {}, op: 'dm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) } });
      bust('accounts'); c(); toast('Saved'); done();
    } }] });
}

async function countSheet(st, done) {
  let g = null, diffEl = null;
  g = denomGrid(st.notes && Object.fromEntries(DENOMS.map((d) => [d, Math.max(0, Number(st.notes[d]) || 0)])), () => upd(), { totalLabel: 'Counted in the drawer' });
  const kindSel = selectEl([['spot', 'Check now'], ['open', 'Opening count'], ['close', 'Closing count']], 'spot'), note = input({ placeholder: 'Note (optional)', label: 'Note' });
  const adj = checkbox('Put any shortage or excess in the books (Cash short and excess)', false);
  diffEl = h('div', { class: 'banner' });
  function upd() { if (!g || !diffEl) return; const d = g.total() - Number(st.balance); diffEl.className = 'banner ' + (Math.abs(d) < 0.005 ? 'info' : ''); diffEl.textContent = Math.abs(d) < 0.005 ? 'Matches the books (' + inr(st.balance) + ').' : (d < 0 ? 'Short by ' + inr(-d) : 'Excess of ' + inr(d)) + ' compared with the books (' + inr(st.balance) + ').'; }
  upd();
  sheet({ title: 'Count the drawer', body: h('div', { class: 'grid', style: { gap: '12px' } }, field('What is this count', kindSel), g.node, diffEl, adj, field('Note', note)),
    actions: [{ label: 'Save count', primary: true, onclick: async (c) => {
      const r = await api('acc_drawer_count', { p: { kind: kindSel.value, counted: g.get(), adjust: !!(adj.querySelector ? adj.querySelector('input').checked : adj.checked), note: note.value } });
      bust('accounts'); c(); toast(Math.abs(Number(r.diff)) < 0.005 ? 'Counted: matches the books' : (r.diff < 0 ? 'Counted: short by ' + inr(-r.diff) : 'Counted: excess of ' + inr(r.diff))); done();
    } }] });
}

page('drawer', {
  title: 'Cash drawer', icon: 'wallet', perm: 'acc_view',
  async render(v) {
    const kd = v.q.get('k') || '';
    const st = await api('acc_drawer_status', { p: { kind: kd || null, limit: 300 } });
    const canPost = can('acc_post');
    v.header({ title: 'Cash drawer', actions: [canPost ? { label: 'Count drawer', icon: 'check', primary: true, run: () => countSheet(st, () => v.refresh()) } : null].filter(Boolean) });
    const un = Number(st.uncounted);
    v.root.append(h('div', { class: 'kpis', 'data-kg': 'drawer' },
      kpi('Cash in the books', money(st.balance), st.last_count ? 'Last count ' + fmtD(st.last_count.at.slice(0, 10)) + (Math.abs(Number(st.last_count.diff)) < 0.005 ? ', matched' : st.last_count.diff < 0 ? ', short ' + inr(-st.last_count.diff) : ', excess ' + inr(st.last_count.diff)) : 'Not counted yet'),
      kpi('Notes and coins counted', money(st.counted_total), 'By denomination'),
      kpi(un < 0 ? 'Below the books' : 'Not counted by note', money(Math.abs(un)), Math.abs(un) < 0.005 ? 'Everything is counted' : 'Count the drawer to set the note-wise balance')));
    if (canPost) v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Move cash')), h('div', { class: 'dr-moves' }, ...MOVES.map((m) => h('button', { class: 'btn', type: 'button', onclick: () => moveSheet(m, st, () => v.refresh()) }, icon(m.icon, 18), m.label)))));
    v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Balance by note and coin')),
      h('div', { class: 'dr-notes' }, ...DENOMS.map((d) => { const n = Number(st.notes[d]) || 0; return h('div', { class: 'dr-n' + (n < 0 ? ' neg' : n === 0 ? ' zero' : '') }, h('div', { class: 'muted small' }, dnLabel(d)), h('div', { class: 'num dr-c' }, String(n)), h('div', { class: 'small muted' }, inr(n * d))); }))));
    v.root.append(seg([['', 'All'], ['sale', 'Sales'], ['purchase', 'Purchases'], ['deposit', 'Bank'], ['loan_given', 'Loans'], ['owner_in', 'Owner']], kd, (k) => go('drawer' + (k ? '?k=' + k : '')), { full: true, label: 'Show' }));
    let act = st.activity || [];
    if (kd === 'deposit') act = act.filter((a) => a.kind === 'deposit' || a.kind === 'withdraw');
    if (kd === 'loan_given') act = act.filter((a) => /^loan_/.test(a.kind));
    if (kd === 'owner_in') act = act.filter((a) => /^owner_/.test(a.kind));
    if (!act.length) { v.root.append(empty('wallet', 'No cash movements yet', 'Cash sales, purchases, deposits, withdrawals, loans and owner cash appear here.')); return; }
    v.root.append(dataView([
      { key: 'kind', label: 'What', title: true, render: (a) => (DKIND[a.kind] || [a.kind])[0] + (a.status === 'cancelled' ? ' (cancelled)' : '') },
      { key: 'who', label: 'Details', sub: true, render: (a) => [fmtD(String(a.at).slice(0, 10)), a.doc, a.who, a.bank, a.memo, a.counted === false ? 'notes not counted' : ''].filter(Boolean).join(' · ') },
      { key: 'amount', label: 'Amount', r: true, value: true, render: (a) => h('span', { class: a.status === 'cancelled' ? 'muted' : (a.dir > 0 ? 'dr-g' : 'dr-r') }, (a.dir > 0 ? '+' : '−') + inr(a.amount)), sortVal: (a) => Number(a.amount) * a.dir }],
      act, { onRow: (a) => (a.manual && a.status !== 'cancelled' && canPost ? sheet({ title: (DKIND[a.kind] || [a.kind])[0], closeLabel: 'Close', body: h('div', { class: 'grid' }, h('div', { class: 'num', style: { fontSize: '24px', fontWeight: 700 } }, inr(a.amount)), h('div', { class: 'muted' }, [fmtD(String(a.at).slice(0, 10)), a.who, a.bank, a.memo].filter(Boolean).join(' · '))),
        actions: [{ label: 'Cancel this entry', danger: true, onclick: async (c) => { if (!(await confirmBox('Cancel this entry?', 'The cash and the books go back as before. This is recorded.', 'Cancel entry'))) return false; await api('acc_drawer_void', { p_id: a.id, p_reason: 'Cancelled from the Cash drawer' }); bust('accounts'); c(); v.refresh(); } }] }) : null) }));
  },
});
