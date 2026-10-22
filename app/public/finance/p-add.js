/* AUZsFinance: the one "Add entry" screen. Pick what happened, fill in a few plain fields, see what will change, save. */
'use strict';
function kindPicker(onPick) {
  const s = sheet({ title: 'What happened?', closeLabel: 'Close', body: h('div', { class: 'grid' }, GROUPS.map(([g, ks]) => section(g, h('div', { class: 'list' }, ks.map((k) => liRow({ icon: KINDS[k].ic, tone: 'gray', title: KINDS[k].label, sub: KINDS[k].hint, chevron: true, onclick: () => { s.close(); onPick(k); } })))))) });
}
function addTxn(preset) {
  if (!can('write')) return toast('Your role cannot add entries', { err: true });
  if (!preset || !preset.kind) return kindPicker((k) => addTxn({ ...(preset || {}), kind: k }));
  const K = KINDS[preset.kind], accounts = S.ctx.accounts.filter((a) => a.active);
  const op = preset.op || uid();
  const amount = input({ type: 'number', mode: 'decimal', step: '0.01', min: '0', value: preset.amount || '', placeholder: '0', cls: 'bigamt', label: 'Amount', autofocus: true });
  const date = input({ type: 'date', value: preset.date || todayISO() });
  const acc = K.acc ? selectEl(accounts.map((a) => [a.id, a.name]), preset.account_id || (accounts[0] || {}).id, { label: K.acc }) : null;
  const to = K.to ? selectEl(accounts.map((a) => [a.id, a.name]), preset.to_account_id || (accounts[1] || accounts[0] || {}).id, { label: K.to }) : null;
  const cats = K.cat ? S.ctx.categories[K.cat] : null;
  const cat = cats ? selectEl([['', K.cat === 'income' ? 'Other income' : 'General expenses'], ...cats.map((c) => [c.id, c.name])], preset.category_id || '', { label: K.catLabel }) : null;
  const purpose = input({ placeholder: 'e.g. Shop rent for October', value: preset.purpose || '', label: 'Note' });
  const interest = K.interest ? input({ type: 'number', mode: 'decimal', step: '0.01', min: '0', value: preset.interest || '', placeholder: '0', label: 'Interest' }) : null;
  const dueDate = K.due ? input({ type: 'date', value: preset.due_date || '' }) : null;
  const people = K.person ? pickOrNew(S.ctx.people.map((p) => ({ id: p.id, name: p.name })), { value: preset.person_id, placeholder: 'Choose…', newPlaceholder: 'Name', label: K.personLabel }) : null;
  const partners = K.partner ? pickOrNew(S.ctx.partners.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name + (p.kind === 'owner' ? ' (owner)' : '') })), { value: preset.partner_id || (S.ctx.partners[0] || {}).id, newPlaceholder: 'Name of owner or partner', label: K.partnerLabel }) : null;
  let rate; const loans = K.loan ? pickOrNew(S.ctx.loans.filter((l) => l.direction === K.loan && l.status === 'open').map((l) => ({ id: l.id, name: l.counterparty })), { value: preset.loan_id, newPlaceholder: K.loan === 'taken' ? 'Who lent you the money' : 'Who you lent to', label: 'Loan', extra: () => (rate = input({ type: 'number', mode: 'decimal', step: '0.01', placeholder: 'Interest rate % a year (optional)', label: 'Rate' })) }) : null;
  const evid = selectEl([['have', 'I have the bill or proof'], ['pending', 'Bill will come later'], ['none', 'No bill']], preset.evidence || 'none', { label: 'Proof' });
  const review = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: preset.review === 'needs_review' }), h('span', null, 'Not sure about this one. Ask a manager to check it.'));
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', capture: null, multiple: true, style: { display: 'none' } });
  const fileNote = h('div', { class: 'small muted' });
  file.onchange = () => { fileNote.textContent = file.files.length ? file.files.length + ' file(s) will be attached. Pictures are made small automatically.' : ''; if (file.files.length) evid.value = 'have'; };
  const pdfIn = h('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' } });
  pdfIn.onchange = () => {
    const f = pdfIn.files[0]; pdfIn.value = ''; if (!f) return;
    if (f.size > PDF_MAX) { toast('A PDF can be up to 10 KB. Use a photo instead, it is made small automatically.', { err: true }); return; }
    const dt = new DataTransfer(); [...file.files].forEach((x) => dt.items.add(x)); dt.items.add(f); file.files = dt.files; file.onchange();
  };
  // How it was paid, and the details that mode needs
  const defMode = (a) => ({ cash: 'cash', upi: 'upi', card: 'card', bank: 'online', wallet: 'upi' }[(accounts.find((x) => x.id === a) || {}).kind] || 'cash');
  const mode = K.acc && preset.kind !== 'transfer' ? selectEl(PAYMODES, preset.method || defMode(acc && acc.value), { label: 'How was it paid' }) : null;
  const utr = input({ placeholder: 'e.g. 4123 8890 1234', value: preset.reference || '', label: 'UTR / transaction ID' });
  const cardRef = input({ placeholder: 'Last 4 digits or slip number', value: preset.reference || '', label: 'Card details' });
  const chqNo = input({ placeholder: '6 digit cheque number', value: preset.cheque_no || '', label: 'Cheque number', mode: 'numeric' });
  const chqDate = input({ type: 'date', value: preset.cheque_date || '', label: 'Cheque date' });
  const chqBank = input({ placeholder: 'Bank on the cheque', value: preset.cheque_bank || '', label: 'Cheque bank' });
  const modeBox = h('div', { class: 'grid' });
  const paintMode = () => {
    const m = mode && mode.value;
    clear(modeBox).append(...(m === 'upi' || m === 'online' ? [field('UTR / transaction ID', utr, 'Required. The reference you see in the bank or UPI app.')]
      : m === 'card' ? [field('Card details', cardRef, 'Last 4 digits or the slip number (optional).')]
      : m === 'cheque' ? [field('Cheque number', chqNo), field('Cheque date', chqDate), field('Cheque bank', chqBank)] : []));
  };
  if (mode) { mode.addEventListener('change', paintMode); if (acc) acc.addEventListener('change', () => { mode.value = defMode(acc.value); paintMode(); }); paintMode(); }
  // Who paid / who was paid, with GST number
  const partyOn = GSTK.includes(preset.kind);
  const inbound = ['money_in', 'credit_sale', 'dues_in'].includes(preset.kind);
  const partyName = input({ placeholder: inbound ? 'Name of who paid you' : 'Name of who you paid', value: preset.party_name || '', label: inbound ? 'Who paid' : 'Paid to' });
  const partyGst = input({ placeholder: '15 letters and numbers', value: preset.party_gstin || '', label: 'GST number', autocapitalize: 'characters' });
  const earlyWhy = K.early ? selectEl(EARLY, preset.early_reason || 'before_bank', { label: 'Why not from the books' }) : null;
  const TAXK = ['money_in', 'expense', 'credit_sale', 'credit_purchase', 'asset_buy'], TDSK = ['money_in', 'expense', 'credit_sale', 'credit_purchase', 'dues_in', 'dues_out'];
  const gst = TAXK.includes(preset.kind) ? selectEl([['', 'None'], ['5', '5%'], ['12', '12%'], ['18', '18%'], ['28', '28%']], preset.tax_rate ? String(preset.tax_rate) : '', { label: 'GST in this amount' }) : null;
  const tds = TDSK.includes(preset.kind) ? input({ type: 'number', mode: 'decimal', step: '0.01', min: '0', value: preset.tds_amt || '', placeholder: '0', label: 'TDS cut' }) : null;
  const taxBox = gst || tds ? h('details', { class: 'taxbox' }, h('summary', null, 'Tax (optional)'), h('div', { class: 'grid', style: { paddingTop: '10px' } }, gst ? field('GST in this amount', gst, 'The amount above is taken as including GST.') : null, tds ? field('TDS cut', tds, 'Tax cut at source from this payment, if any.') : null)) : null;
  const preview = h('div', { class: 'preview' });
  const accName = (id) => (accounts.find((a) => a.id === id) || {}).name || '';
  const upd = () => {
    const a = N(amount.value), i = interest ? N(interest.value) : 0; const tot = a + (K.interest ? i : 0);
    const L = [];
    if (acc && K.sign > 0) L.push(accName(acc.value) + ' goes up by ' + inr(tot));
    if (acc && K.sign < 0) L.push(accName(acc.value) + ' goes down by ' + inr(tot));
    if (preset.kind === 'transfer' && acc && to) L.push(accName(acc.value) + ' down, ' + accName(to.value) + ' up, by ' + inr(a));
    if (preset.kind === 'early_expense') L.push('Counts as an expense, and as money you put in. No bank or cash account changes.');
    if (preset.kind === 'credit_sale') L.push('They owe you ' + inr(a) + ' more. No cash moves yet.');
    if (preset.kind === 'credit_purchase') L.push('You owe them ' + inr(a) + ' more. No cash moves yet.');
    if (K.interest && i) L.push(preset.kind === 'loan_repay' ? inr(a) + ' reduces the loan, ' + inr(i) + ' is interest cost' : inr(a) + ' reduces what they owe, ' + inr(i) + ' is interest income');
    clear(preview).append(...(a > 0 ? L.map((x) => h('div', null, x)) : [h('div', { class: 'muted' }, 'Enter an amount to see what changes')]));
  };
  [amount, interest, acc, to].filter(Boolean).forEach((x) => { x.addEventListener('input', upd); x.addEventListener('change', upd); }); upd();
  const body = h('div', { class: 'grid addform' },
    h('div', { class: 'amtbox' }, h('div', { class: 'small muted' }, K.label), h('div', { class: 'row amtrow' }, h('span', { class: 'rs' }, '₹'), amount)),
    field('Date', date),
    acc ? field(K.acc, acc) : null, to ? field(K.to, to) : null, mode ? field('How was it paid', mode) : null, mode ? modeBox : null,
    earlyWhy ? field('Why not from the books', earlyWhy, 'Counted as money you put into the business, so the books stay true.') : null,
    people ? field(K.personLabel, people.el) : null, partners ? field(K.partnerLabel, partners.el) : null, loans ? field('Loan', loans.el) : null,
    interest ? field(preset.kind === 'loan_repay' ? 'Interest part of this payment' : 'Interest part', interest, 'Leave empty if there is no interest.') : null,
    cat ? field(K.catLabel, cat) : null, dueDate ? field('Due date (optional)', dueDate) : null,
    partyOn ? field(inbound ? 'Who paid' : 'Paid to', partyName) : null, partyOn ? field('GST number', partyGst, 'Of the ' + (inbound ? 'person who paid' : 'seller or person you paid') + ' (optional).') : null,
    field('Note', purpose), field('Proof', evid), h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, icon('camera', 16), 'Add photo'), h('button', { class: 'btn sm', type: 'button', onclick: () => pdfIn.click() }, icon('download', 16), 'Attach PDF (up to 10 KB)'), file, pdfIn, fileNote),
    taxBox, review, preview);
  sheet({ title: K.label, closeLabel: 'Cancel', full: true, body, actions: [{ label: 'Save', primary: true, onclick: async (close) => {
    const a = N(amount.value); if (a <= 0) { toast('Enter an amount above zero', { err: true }); amount.focus(); return false; }
    const p = { op, kind: preset.kind, amount: a, date: date.value, purpose: purpose.value.trim(), evidence: evid.value, review: review.querySelector('input').checked ? 'needs_review' : 'confirmed' };
    if (mode) {
      p.method = mode.value; const m = mode.value;
      if ((m === 'upi' || m === 'online')) { if (!utr.value.trim()) { toast('Enter the UTR / transaction ID', { err: true }); utr.focus(); return false; } p.reference = utr.value.trim(); }
      else if (m === 'card' && cardRef.value.trim()) p.reference = cardRef.value.trim();
      else if (m === 'cheque') { if (!chqNo.value.trim()) { toast('Enter the cheque number', { err: true }); chqNo.focus(); return false; } p.cheque_no = chqNo.value.trim(); if (chqDate.value) p.cheque_date = chqDate.value; if (chqBank.value.trim()) p.cheque_bank = chqBank.value.trim(); }
    }
    if (partyOn) { const gs = partyGst.value.trim().toUpperCase(); if (gs && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gs)) { toast('That GST number does not look right (15 letters and numbers)', { err: true }); partyGst.focus(); return false; } if (gs) p.party_gstin = gs; if (partyName.value.trim()) p.party_name = partyName.value.trim(); }
    if (earlyWhy) p.early_reason = earlyWhy.value;
    if (gst && gst.value) p.tax_rate = N(gst.value); if (tds && tds.value) p.tds_amt = N(tds.value);
    if (acc) p.account_id = acc.value; if (to) p.to_account_id = to.value; if (cat && cat.value) p.category_id = cat.value; if (interest) p.interest = N(interest.value); if (dueDate && dueDate.value) p.due_date = dueDate.value;
    if (people) { const g = people.get(); if (K.person === 'req' && !g) { toast('Choose who this is with', { err: true }); return false; } if (g && g.name !== undefined) { if (!g.name) { toast('Type the name', { err: true }); return false; } const r = await api('fin_save_person', { p: { name: g.name, kind: preset.kind.indexOf('purchase') >= 0 || preset.kind === 'dues_out' ? 'supplier' : 'customer' } }); p.person_id = r.id; } else if (g) p.person_id = g.id; }
    if (partners) { const g = partners.get(); if (!g) { toast('Choose who', { err: true }); return false; } if (g.name !== undefined) { if (!g.name) { toast('Type the name', { err: true }); return false; } const r = await api('fin_save_partner', { p: { name: g.name, kind: 'partner' } }); p.partner_id = r.id; } else p.partner_id = g.id; }
    if (loans) { const g = loans.get(); if (!g) { toast('Choose the loan', { err: true }); return false; } if (g.name !== undefined) { if (!g.name) { toast('Type who the loan is with', { err: true }); return false; } const r = await api('fin_save_loan', { p: { direction: K.loan, counterparty: g.name, rate_pct: rate && rate.value ? N(rate.value) : null, start_date: date.value } }); p.loan_id = r.id; } else p.loan_id = g.id; }
    const saved = await api('fin_save_txn', { p });
    let failed = 0; for (const f of [...file.files]) { try { await uploadEvidence(saved.id, f); } catch (e) { failed++; } }
    if (failed) toast('Saved, but ' + failed + ' file(s) could not be attached', { err: true }); else toast('Saved');
    close(); await reloadCtx(); route_();
  } }] });
}
