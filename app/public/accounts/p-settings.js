/* Settings: organisation, financial years and locks, branches and warehouses, GST rates, numbering, rules, access. */
'use strict';
const SERIES = [['INV', 'Invoices'], ['CN', 'Credit notes'], ['PB', 'Purchase bills'], ['DN', 'Debit notes'], ['EXP', 'Expenses'], ['QT', 'Quotations'], ['SO', 'Sales orders'], ['DC', 'Delivery challans'], ['PRQ', 'Purchase requests'], ['PO', 'Purchase orders'], ['GRN', 'Goods receipts'], ['RCT', 'Receipts'], ['PAY', 'Payments'], ['JV', 'Journal vouchers']];
const PERM_LABEL = { acc_view: 'See everything in Accounting', acc_sales: 'Create invoices, quotes and receipts', acc_purchase: 'Create bills, expenses and payments', acc_inventory: 'Manage products and stock', acc_banking: 'Import statements and reconcile', acc_post: 'Journals, transfers, assets', acc_approve: 'Approve documents held for approval', acc_cancel: 'Cancel and reverse', acc_reports: 'Reports and GST', acc_import: 'Import and bulk changes', acc_admin: 'Settings, financial years, locks', acc_audit: 'See the audit log' };

page('settings', {
  title: 'Settings', icon: 'gear', perm: 'acc_view',
  async render(v) {
    const sec = v.args[0];
    const admin = can('acc_admin');
    const SECS = [['organisation', 'Organisation', 'building', 'Name, GSTIN, address, invoice terms', 'acc_admin'], ['years', 'Financial years and locks', 'calendar', 'Open and close years, lock past periods', 'acc_admin'], ['branches', 'Branches and warehouses', 'layers', 'Locations for sales and stock', 'acc_admin'], ['gst', 'GST rates', 'percent', 'Rates available on documents', 'acc_admin'],
      ['numbering', 'Numbering', 'list', 'Prefixes for document numbers', 'acc_admin'], ['rules', 'Rules and approvals', 'shield', 'Approval limit, negative stock, round-off, e-invoice', 'acc_admin'], ['access', 'Your access', 'lock', 'What your role can do', null]];
    if (!sec) {
      v.header({ title: 'Settings' });
      v.root.append(h('div', { class: 'list' }, SECS.filter((s) => !s[4] || can(s[4])).map(([k, t, i, sub]) => liRow({ icon: i, title: t, sub, chevron: true, onclick: () => go('settings/' + k) }))),
        h('div', { class: 'list' }, liRow({ icon: 'repeat', tone: 'gray', title: 'Recurring invoices and bills', chevron: true, onclick: () => go('sales?tab=recurring') }), can('acc_audit') ? liRow({ icon: 'shield', tone: 'gray', title: 'Audit log', chevron: true, onclick: () => go('reports/audit') }) : null, liRow({ icon: 'check', tone: 'gray', title: 'Books health check', sub: 'Proves the books balance', chevron: true, onclick: () => go('reports/health') }), can('acc_admin') ? liRow({ icon: 'users', tone: 'gray', title: 'Staff and roles', sub: 'Managed on your AUZslab account page', chevron: true, onclick: () => window.open('https://auzslab.in/account.html#roles', '_blank') }) : null));
      return;
    }
    const meta = SECS.find((s) => s[0] === sec); if (!meta) throw new Error('Unknown settings page');
    v.header({ title: meta[1], back: 'settings' });
    if (meta[4] && !can(meta[4])) { v.root.append(empty('lock', 'No access', 'Only the owner can change this.')); return; }
    const F = { organisation: setOrg, years: setYears, branches: setBranches, gst: setGst, numbering: setNumbering, rules: setRules, access: setAccess }[sec];
    return F(v);
  },
});

function setOrg(v) {
  const o = S.org, gst = input({ value: o.gstin || '', max: 15, placeholder: '15-character GSTIN' }), msg = h('div', { class: 'hint' }, 'Needed on invoices if you are GST-registered.');
  const val = () => { const g = gst.value.trim().toUpperCase(); gst.value = g; gst.classList.remove('err'); if (!g) { msg.textContent = 'Needed on invoices if you are GST-registered.'; return; } if (g.length < 15) { msg.textContent = g.length + ' of 15 characters'; return; } if (gstinValid(g)) { msg.textContent = 'Valid · ' + (STATES[g.slice(0, 2)] || ''); if (!st.value) st.value = g.slice(0, 2); } else { gst.classList.add('err'); msg.textContent = 'Not a valid GSTIN. Check the characters and the last check digit.'; } };
  const st = selectEl([['', 'Choose state'], ...Object.keys(STATES).map((c) => [c, stateName(c)])], o.state_code || ''); gst.addEventListener('input', val);
  const f = { legal: input({ value: o.legal_name || '' }), trade: input({ value: o.trade_name || '' }), pan: input({ value: o.pan || '', max: 10 }), addr: h('textarea', { class: 'textarea', style: { minHeight: '70px' } }, o.address || ''), city: input({ value: o.city || '' }), pin: input({ value: o.pincode || '', mode: 'numeric', max: 6 }), ph: input({ value: o.phone || '' }), em: input({ value: o.email || '', type: 'email' }),
    reg: selectEl([['regular', 'Regular (charges GST)'], ['composition', 'Composition scheme (no GST on invoices)'], ['unregistered', 'Not registered (no GST on invoices)']], o.reg_type), terms: h('textarea', { class: 'textarea' }, o.invoice_terms || ''), bank: h('textarea', { class: 'textarea', style: { minHeight: '70px' } }, o.bank_details || ''), foot: input({ value: o.invoice_footer || '' }) };
  v.root.append(h('div', { class: 'card grid' }, field('Legal name', f.legal), field('Trade name (shown on documents)', f.trade), field('GSTIN', gst), msg, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('State', st), field('Registration', f.reg)), field('PAN', f.pan), field('Address', f.addr), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('City', f.city), field('Pincode', f.pin)), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Phone', f.ph), field('Email', f.em))),
    h('div', { class: 'card grid' }, h('h3', null, 'On invoices'), field('Terms and conditions', f.terms), field('Bank details', f.bank), field('Footer line', f.foot)),
    h('div', { class: 'dock' }, h('button', { class: 'btn fill', onclick: async (e) => { e.currentTarget.disabled = true; try { const r = await api('acc_save_org', { p: { legal_name: f.legal.value, trade_name: f.trade.value, gstin: gst.value, pan: f.pan.value, state_code: st.value, reg_type: f.reg.value, address: f.addr.value, city: f.city.value, pincode: f.pin.value, phone: f.ph.value, email: f.em.value, invoice_terms: f.terms.value, bank_details: f.bank.value, invoice_footer: f.foot.value } }); S.org = r; toast('Saved'); } catch (x) { fail(x); } e.currentTarget.disabled = false; } }, 'Save')));
}
function setYears(v) {
  const o = S.org;
  v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Financial years'), h('button', { class: 'btn sm', onclick: addYear }, icon('plus', 16), 'Add year')),
    h('div', { class: 'list' }, S.fys.map((f) => liRow({ icon: 'calendar', tone: f.status === 'open' ? '' : 'gray', title: f.label, sub: fmtD(f.start_date) + ' to ' + fmtD(f.end_date), badge: badge(cap1(f.status), f.status === 'open' ? 'green' : ''), chevron: f.status === 'open', onclick: f.status === 'open' ? () => closeYear(f) : null })))),
    h('p', { class: 'cap' }, 'Tap an open year to close it. Closing checks for unposted drafts and unbalanced journals, locks the year, and opens the next. Balances carry forward automatically.'),
    h('div', { class: 'card grid' }, h('h3', null, 'Lock the books'), h('p', { class: 'muted small' }, o.lock_date ? 'Nothing can be posted, changed or cancelled on or before ' + fmtD(o.lock_date) + '.' : 'No lock. Any open date can be posted.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: lockSheet }, o.lock_date ? 'Change lock date' : 'Set a lock date'), o.lock_date ? h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Remove the lock?', 'Past periods can be changed again. This is recorded in the audit log.', 'Remove', true)) { await api('acc_set_lock', { p_date: null }); S.org.lock_date = null; v.refresh(); } } }, 'Remove lock') : null)));
  async function addYear() {
    const l = fy0(); const s = input({ value: l[0], type: 'date' }), e = input({ value: l[1], type: 'date' });
    sheet({ title: 'Add financial year', body: h('div', { class: 'grid' }, field('Starts', s), field('Ends', e)), actions: [{ label: 'Add', primary: true, onclick: async (c) => { await api('acc_save_fy', { p: { start_date: s.value, end_date: e.value } }); await loadCtx(); c(); v.refresh(); } }] });
  }
  function fy0() { const last = S.fys.slice().sort((a, b) => a.end_date.localeCompare(b.end_date)).pop(); const s = addDays(last.end_date, 1); const e = new Date(s + 'T12:00'); e.setFullYear(e.getFullYear() + 1); e.setDate(e.getDate() - 1); return [s, isoDate(e)]; }
  async function closeYear(f) {
    if (!(await confirmBox('Close ' + f.label + '?', 'This locks all dates up to ' + fmtD(f.end_date) + ' and opens the next year. You can unlock later from this page.', 'Close year', true))) return;
    try { const r = await api('acc_close_fy', { p_fy: f.id }); await loadCtx(); toast('Closed ' + r.closed); v.refresh(); } catch (e) { fail(e); }
  }
  function lockSheet() { const d = dateInput(o.lock_date || addDays(monthStart(), -1)); sheet({ title: 'Lock the books', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Pick the last date that should be frozen, usually the end of a month you have closed.'), field('Locked up to and including', d)), actions: [{ label: 'Lock', primary: true, onclick: async (c) => { await api('acc_set_lock', { p_date: d.value }); S.org.lock_date = d.value; c(); toast('Books locked'); v.refresh(); } }] }); }
}
function setBranches(v) {
  const draw = () => { clear(v.root).append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Branches'), h('button', { class: 'btn sm', onclick: () => branchSheet(null) }, icon('plus', 16), 'Add branch')),
    h('div', { class: 'list' }, S.branches.map((b) => liRow({ icon: 'building', tone: b.active ? '' : 'gray', title: b.name, sub: b.code + (b.state_code ? ' · ' + stateName(b.state_code) : '') + (b.gstin ? ' · ' + b.gstin : ''), chevron: true, onclick: () => branchSheet(b) })))),
    h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Warehouses'), h('button', { class: 'btn sm', onclick: () => warehousesSheet(() => draw()) }, 'Manage')), h('div', { class: 'list' }, S.warehouses.map((w) => liRow({ icon: 'layers', tone: 'gray', title: w.name, sub: w.code + (w.is_default ? ' · default' : '') })))),
    h('p', { class: 'cap' }, 'A branch with its own GSTIN or state decides CGST/SGST vs IGST for sales made from it.')); };
  const branchSheet = (b) => { const code = input({ value: b ? b.code : '' }), nm = input({ value: b ? b.name : '' }), gst = input({ value: b ? b.gstin || '' : '', max: 15 }), st = selectEl([['', 'Same as organisation'], ...Object.keys(STATES).map((c) => [c, stateName(c)])], b ? b.state_code || '' : ''), ad = input({ value: b ? b.address || '' : '' }); let act = b ? b.active : true;
    sheet({ title: b ? 'Edit branch' : 'New branch', body: h('div', { class: 'grid' }, field('Code', code), field('Name', nm), field('GSTIN (if different)', gst), field('State', st), field('Address', ad), b ? toggleRow('Active', act, (x) => { act = x; }) : null), actions: [{ label: 'Save', primary: true, onclick: async (c) => { await api('acc_save_branch', { p: { id: b ? b.id : null, code: code.value, name: nm.value, gstin: gst.value, state_code: st.value, address: ad.value, active: act } }); await loadCtx(); c(); draw(); } }] }); };
  draw();
}
function setGst(v) {
  const toggle = (t) => h('span', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: t.active, 'aria-label': t.name + ' active', onchange: async (e) => {
    try { await api('acc_save_taxcode', { p: { id: t.id, code: t.code, name: t.name, rate: t.rate, active: e.target.checked } }); await loadCtx(); } catch (x) { fail(x); e.target.checked = !e.target.checked; }
  } }));
  const rowOf = (t) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, t.name), h('div', { class: 's' }, t.code + ' · ' + cap1(t.kind) + (Number(t.cess) ? ' · cess ' + t.cess + '%' : ''))), toggle(t));
  const draw = () => {
    const list = h('div', { class: 'list' }, S.taxcodes.map(rowOf));
    const head = h('div', { class: 'sec-h' }, h('h3', null, 'GST rates'), h('button', { class: 'btn sm', onclick: add }, icon('plus', 16), 'Add rate'));
    clear(v.root).append(h('div', { class: 'banner info' }, icon('info', 18), 'Rates are configuration. A document line stores the rate it used, so changing this list never rewrites history. Check current rates with your CA.'), h('div', { class: 'sec' }, head, list));
  };
  const add = () => {
    const code = input({ placeholder: 'e.g. GST40' }), nm = input({ placeholder: 'GST 40%' }), r = input({ mode: 'decimal', placeholder: '0' }), cess = input({ mode: 'decimal', placeholder: '0' });
    sheet({ title: 'New GST rate', body: h('div', { class: 'grid' }, field('Code', code), field('Name', nm), field('Rate %', r), field('Cess %', cess)), actions: [{ label: 'Add', primary: true, onclick: async (c) => { await api('acc_save_taxcode', { p: { code: code.value, name: nm.value, kind: 'taxable', rate: N(r.value), cess: N(cess.value) } }); await loadCtx(); c(); draw(); } }] });
  };
  draw();
}
function setNumbering(v) {
  const cur = (S.org.settings && S.org.settings.series) || {}, ins = {};
  const fy = curFY();
  v.root.append(h('div', { class: 'banner info' }, icon('info', 18), 'Numbers look like PREFIX/' + fy.label + '/00001, restart each financial year, and have no gaps: a number is only taken when a document is posted. Changing a prefix affects future documents only.'),
    h('div', { class: 'card grid' }, SERIES.map(([k, l]) => field(l, ins[k] = input({ value: cur[k] || k, max: 12, placeholder: k })))),
    h('div', { class: 'dock' }, h('button', { class: 'btn fill', onclick: async (e) => { const series = {}; SERIES.forEach(([k]) => { const x = ins[k].value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, ''); if (x && x !== k) series[k] = x; }); try { const r = await api('acc_save_org', { p: { settings: { series } } }); S.org = r; toast('Saved'); } catch (x) { fail(x); } } }, 'Save')));
}
function setRules(v) {
  const o = S.org, st = o.settings || {};
  const thr = input({ value: st.approval_threshold || '', mode: 'decimal', placeholder: '0 = no approval needed' }), dt = selectEl(taxRates().map((r) => [String(r), r + '%']), String(st.default_tax_rate ?? 18)), ew = input({ value: st.eway_threshold || 50000, mode: 'decimal' });
  let neg = !!o.allow_negative_stock, ro = o.round_off_sales !== false, ei = !!st.einvoice_enabled;
  v.root.append(h('div', { class: 'list' }, toggleRow('Round sales invoices to the nearest rupee', ro, (x) => { ro = x; }), toggleRow('Allow selling below zero stock', neg, (x) => { neg = x; }, 'Off is safer: the invoice is refused if stock is short.'), toggleRow('Flag B2B invoices without an IRN', ei, (x) => { ei = x; }, 'Adds “E-invoice pending” to the GST checks. Turn on once you are above the e-invoicing threshold.')),
    h('div', { class: 'card grid' }, field('Approval limit for bills and expenses (₹)', thr, 'Staff without approval rights can save documents above this amount but a manager must post them.'), field('Default GST rate on new lines', dt), field('E-way bill threshold (₹)', ew)),
    h('div', { class: 'dock' }, h('button', { class: 'btn fill', onclick: async () => { try { const r = await api('acc_save_org', { p: { round_off_sales: ro, allow_negative_stock: neg, settings: { approval_threshold: N(thr.value), default_tax_rate: N(dt.value), eway_threshold: N(ew.value), einvoice_enabled: ei } } }); S.org = r; toast('Saved'); } catch (x) { fail(x); } } }, 'Save')));
}
function setAccess() {
  const v = arguments[0];
  v.root.append(h('div', { class: 'card grid' }, h('div', null, h('div', { class: 'cap' }, 'Signed in as'), h('div', { class: 't', style: { fontWeight: 600 } }, S.user.email), h('div', { class: 'small muted' }, cap1(S.user.role) + ' · ' + S.ctx.tenant.name))),
    h('div', { class: 'list' }, Object.entries(PERM_LABEL).map(([k, l]) => liRow({ icon: can(k) ? 'check' : 'x', tone: can(k) ? 'green' : 'gray', title: l, sub: can(k) ? 'Allowed' : 'Not allowed' }))),
    h('p', { class: 'cap' }, 'The owner has every permission. Managers have all except settings. A custom role gets exactly the accounting permissions ticked on it. Change roles on your AUZslab account page.'));
}
