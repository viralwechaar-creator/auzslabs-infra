/* Settings: organisation, financial years and locks, branches and warehouses, GST rates, numbering, rules, access. */
'use strict';
const SERIES = [['INV', 'Invoices'], ['CN', 'Credit notes'], ['PB', 'Purchase bills'], ['DN', 'Debit notes'], ['EXP', 'Expenses'], ['QT', 'Quotations'], ['SO', 'Sales orders'], ['DC', 'Delivery challans'], ['PRQ', 'Purchase requests'], ['PO', 'Purchase orders'], ['GRN', 'Goods receipts'], ['RCT', 'Receipts'], ['PAY', 'Payments'], ['JV', 'Journal vouchers']];
const PERM_LABEL = { acc_view: 'See everything in Accounting', acc_sales: 'Create invoices, quotes and receipts', acc_purchase: 'Create bills, expenses and payments', acc_inventory: 'Manage products and stock', acc_banking: 'Import statements and reconcile', acc_post: 'Journals, transfers, assets', acc_approve: 'Approve documents held for approval', acc_cancel: 'Cancel and reverse', acc_reports: 'Reports and GST', acc_import: 'Import and bulk changes', acc_admin: 'Settings, financial years, locks', acc_audit: 'See the audit log' };

// AUZsScan runs this same shell (window.AUZ_SCAN) with a short menu that has no room for
// the full Settings page, but still needs to change the invoice layout without opening
// AUZsLedger -- so it gets this one lightweight page, built from the exact same picker +
// preview code the Organisation page uses below (invoiceLayoutField/previewInvoiceLayout).
// Both read and write the same acc_org.settings.brand.invoiceStyle: one business, one setting.
page('invoicelayout', {
  title: 'Invoice layout', icon: 'doc', perm: 'acc_admin',
  render(v) {
    const o = S.org, br = JSON.parse(JSON.stringify((o.settings && o.settings.brand) || {}));
    const previewData = () => Object.assign({}, o, { terms: o.invoice_terms, brand: br });
    const f = invoiceLayoutField(br.invoiceStyle, previewData);
    v.header({ title: 'Invoice layout' });
    v.root.append(h('div', { class: 'card grid' }, h('p', { class: 'muted small' }, 'Choose how invoices, bills and receipts look for this business. This is shared with AUZsLedger if you use it too.'), f.row, f.previewBtn),
      h('div', { class: 'dock' }, h('button', { class: 'btn fill', onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; try { br.invoiceStyle = f.lay.value; const r = await api('acc_save_org', { p: { settings: { brand: br } } }); S.org = r; toast('Saved'); } catch (x) { fail(x); } btn.disabled = false; } }, 'Save')));
  },
});

page('settings', {
  title: 'Settings', icon: 'gear', perm: 'acc_view',
  async render(v) {
    const sec = v.args[0];
    const admin = can('acc_admin');
    const SECS = [['organisation', 'Organisation', 'building', 'Name, GSTIN, address, invoice terms', 'acc_admin'], ['years', 'Financial years and locks', 'calendar', 'Open and close years, lock past periods', 'acc_admin'], ['branches', 'Branches and warehouses', 'layers', 'Locations for sales and stock', 'acc_admin'], ['gst', 'GST rates', 'percent', 'Rates available on documents', 'acc_admin'],
      ['numbering', 'Numbering', 'list', 'Prefixes for document numbers', 'acc_admin'], ['rules', 'Rules and approvals', 'shield', 'Approval limit, negative stock, round-off, e-invoice', 'acc_admin'], ['sales', 'Sales from POS and shop app', 'repeat', 'Post POS and AUZsMob sales into the books', 'acc_admin'], ['access', 'Your access', 'lock', 'What your role can do', null]];
    if (!sec) {
      v.header({ title: 'Settings' });
      v.root.append(h('div', { class: 'list' }, SECS.filter((s) => !s[4] || can(s[4])).map(([k, t, i, sub]) => liRow({ icon: i, title: t, sub, chevron: true, onclick: () => go('settings/' + k) }))),
        h('div', { class: 'list' }, liRow({ icon: 'repeat', tone: 'gray', title: 'Recurring invoices and bills', chevron: true, onclick: () => go('sales?tab=recurring') }), can('acc_audit') ? liRow({ icon: 'shield', tone: 'gray', title: 'Audit log', chevron: true, onclick: () => go('reports/audit') }) : null, liRow({ icon: 'check', tone: 'gray', title: 'Books health check', sub: 'Proves the books balance', chevron: true, onclick: () => go('reports/health') }), can('acc_admin') ? liRow({ icon: 'users', tone: 'gray', title: 'Staff and roles', sub: 'Managed on your AUZslab account page', chevron: true, onclick: () => window.open('https://auzslab.in/account.html#roles', '_blank') }) : null));
      return;
    }
    const meta = SECS.find((s) => s[0] === sec); if (!meta) throw new Error('Unknown settings page');
    v.header({ title: meta[1], back: 'settings' });
    if (meta[4] && !can(meta[4])) { v.root.append(empty('lock', 'No access', 'Only the owner can change this.')); return; }
    const F = { organisation: setOrg, years: setYears, branches: setBranches, gst: setGst, numbering: setNumbering, rules: setRules, sales: setSalesSync, access: setAccess }[sec];
    return F(v);
  },
});

// POS and AUZsMob sales into the books (db/288): switch the daily automation on, or post a period now
async function setSalesSync(v) {
  const st = await api('acc_sales_sync_status');
  if (!st.has_pos && !st.has_mob) { v.root.append(empty('repeat', 'Nothing to post', 'This business does not use AUZsPOS or AUZsMob.')); return; }
  const pos = { on: !!(st.settings && st.settings.pos) }, mob = { on: !!(st.settings && st.settings.mob) }, out = h('div', { class: 'grid' });
  const save = async () => { try { await api('acc_sales_sync_settings', { p: { pos: pos.on, mob: mob.on } }); toast('Saved'); } catch (e) { toast(e.message, { error: true }); } };
  const from = dateInput(addDays(today(), -30), { label: 'From' }), to = dateInput(today(), { label: 'To' });
  const run = async (source) => { try { const r = await api('acc_sales_sync_run', { p: { source, from: from.value, to: to.value } }); const rows = Object.entries(r.result).map(([k, x]) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, k === 'pos' ? 'AUZsPOS' : 'AUZsMob'), h('div', { class: 's' }, x.posted + ' posted · ' + x.reversed + ' reversed · ' + x.refunds + ' refunds · ' + x.skipped + ' skipped' + (x.errors.length ? ' · ' + x.errors.length + ' could not post: ' + x.errors[0].error : '') + (x.more ? ' · more remain, run again' : ''))))); clear(out).append(h('div', { class: 'list' }, rows)); } catch (e) { toast(e.message, { error: true }); } };
  v.root.append(h('div', { class: 'card grid' }, h('h3', null, 'What is posted'), h('p', { class: 'muted small' }, 'Each finished bill becomes one entry in the books: cash or bank received, sales, and the tax collected (kept in "GST on POS and shop sales"). A voided bill is reversed and POS refunds are posted. Each bill is posted once. Stock and cost of goods are not posted: those apps keep their own stock.')),
    h('div', { class: 'card grid' }, h('h3', null, 'Post automatically every day'),
      st.has_pos ? toggleRow('AUZsPOS bills', pos.on, (c) => { pos.on = c; save(); }) : null, st.has_mob ? toggleRow('AUZsMob bills', mob.on, (c) => { mob.on = c; save(); }) : null),
    h('div', { class: 'card grid' }, h('h3', null, 'Post now'), h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, from), h('div', { class: 'grow' }, to)),
      h('div', { class: 'row wrap' }, st.has_pos ? h('button', { class: 'btn primary', type: 'button', onclick: () => run('pos') }, 'Post AUZsPOS bills') : null, st.has_mob ? h('button', { class: 'btn primary', type: 'button', onclick: () => run('mob') }, 'Post AUZsMob bills') : null), out),
    h('div', { class: 'muted small' }, (st.counts.pos || 0) + ' POS and ' + (st.counts.mob || 0) + ' shop bills are in the books' + (st.last ? ' · last posted ' + fmtDT(st.last) : '') + '.'));
}

// shrink a picked image to a small data URL so it can travel inside the organisation record (and the public invoice link)
function shrinkImage(file, maxW, maxH) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { const k = Math.min(1, maxW / img.width, maxH / img.height), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); const out = c.toDataURL('image/png'); out.length > 250000 ? rej(new Error('That image is too detailed. Use a simpler or smaller one.')) : res(out); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
    img.src = url;
  });
}
function imageField(label, hint, br, key, maxW, maxH) {
  const prev = h('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } }), file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const draw = () => { clear(prev); if (br[key]) prev.append(h('img', { src: br[key], alt: label, style: { maxHeight: '64px', maxWidth: '160px', background: '#fff', borderRadius: '8px', border: '1px solid var(--line, #0002)' } }), h('button', { class: 'btn sm', type: 'button', onclick: () => { delete br[key]; draw(); } }, 'Remove')); prev.append(h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, icon('upload', 16), br[key] ? 'Change' : 'Upload')); };
  file.addEventListener('change', async () => { const f = file.files[0]; file.value = ''; if (!f) return; try { br[key] = await shrinkImage(f, maxW, maxH); draw(); } catch (e) { toast(e.message, { err: true }); } });
  draw();
  return h('div', { class: 'grid', style: { gap: '6px' } }, h('div', { class: 'lbl' }, label), prev, file, h('div', { class: 'hint' }, hint));
}
// Shared by the Organisation page (below) and AUZsScan's own lightweight Invoice layout
// page (above) -- exactly one implementation of the picker + "Preview with sample data",
// behind two entry points onto the same acc_org.settings.brand.invoiceStyle.
const INVOICE_LAYOUTS = [['', 'Standard'], ['classic', 'Classic tax invoice (logo box, MRP, Billed to / Shipped to)'], ['noir', 'Noir (dark, minimalist)'], ['playful', 'Playful (cream & blue, friendly)'], ['bold', 'Bold (red, graphic, thick rules)'], ['minimal', 'Minimal (clean, corporate, pill info boxes)'], ['stamped', 'Stamped (perforated receipt, typewriter)'], ['auzslab', 'AUZslab (big Invoice title, logo top right, PAID stamp)']];
function invoiceLayoutField(value, getPreviewData) {
  const lay = selectEl(INVOICE_LAYOUTS, value || '');
  const previewBtn = h('button', { class: 'btn sm', type: 'button', style: { justifySelf: 'start' }, onclick: () => previewInvoiceLayout(lay.value, getPreviewData()) }, icon('eye', 16), 'Preview with sample data');
  return { lay, row: field('Invoice layout', lay), previewBtn };
}
function setOrg(v) {
  const o = S.org, br = JSON.parse(JSON.stringify((o.settings && o.settings.brand) || {})); br.bank = br.bank || {}; br.regs = br.regs || [];
  const bf = { upi: input({ value: br.upi || '', placeholder: 'name@bank', label: 'UPI ID' }), web: input({ value: br.website || '', placeholder: 'www.example.com' }), hold: input({ value: br.bank.holder || '' }), bname: input({ value: br.bank.name || '' }), acno: input({ value: br.bank.account || '', mode: 'numeric' }), ifsc: input({ value: br.bank.ifsc || '', max: 11 }), brn: input({ value: br.bank.branch || '' }) };
  const regHost = h('div', { class: 'grid' });
  const drawRegs = () => { clear(regHost); br.regs.forEach((r, i) => regHost.append(h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'grow' }, (() => { const e = input({ value: r.k, placeholder: 'e.g. Udyam, CIN, FSSAI' }); e.addEventListener('input', () => { r.k = e.value; }); return e; })()), h('div', { class: 'grow' }, (() => { const e = input({ value: r.v, placeholder: 'Number' }); e.addEventListener('input', () => { r.v = e.value; }); return e; })()), h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Remove', onclick: () => { br.regs.splice(i, 1); drawRegs(); } }, icon('x', 16))))); regHost.append(h('button', { class: 'btn sm', type: 'button', onclick: () => { br.regs.push({ k: '', v: '' }); drawRegs(); } }, icon('plus', 16), 'Add registration number')); };
  drawRegs();
  const gst = input({ value: o.gstin || '', max: 15, placeholder: '15-character GSTIN' }), msg = h('div', { class: 'hint' }, 'Needed on invoices if you are GST-registered.');
  const val = () => { const g = gst.value.trim().toUpperCase(); gst.value = g; gst.classList.remove('err'); if (!g) { msg.textContent = 'Needed on invoices if you are GST-registered.'; return; } if (g.length < 15) { msg.textContent = g.length + ' of 15 characters'; return; } if (gstinValid(g)) { msg.textContent = 'Valid · ' + (STATES[g.slice(0, 2)] || ''); if (!st.value) st.value = g.slice(0, 2); } else { gst.classList.add('err'); msg.textContent = 'Not a valid GSTIN. Check the characters and the last check digit.'; } };
  const st = selectEl([['', 'Choose state'], ...Object.keys(STATES).map((c) => [c, stateName(c)])], o.state_code || ''); gst.addEventListener('input', val);
  const f = { legal: input({ value: o.legal_name || '' }), trade: input({ value: o.trade_name || '' }), pan: input({ value: o.pan || '', max: 10 }), addr: h('textarea', { class: 'textarea', style: { minHeight: '70px' } }, o.address || ''), city: input({ value: o.city || '' }), pin: input({ value: o.pincode || '', mode: 'numeric', max: 6 }), ph: input({ value: o.phone || '' }), em: input({ value: o.email || '', type: 'email' }),
    reg: selectEl([['regular', 'Regular (charges GST)'], ['composition', 'Composition scheme (no GST on invoices)'], ['unregistered', 'Not registered (no GST on invoices)']], o.reg_type), terms: h('textarea', { class: 'textarea' }, o.invoice_terms || ''), bank: h('textarea', { class: 'textarea', style: { minHeight: '70px' } }, o.bank_details || ''), foot: input({ value: o.invoice_footer || '' }), numst: selectEl([['', 'INV/2026-27/00001'], ['plain', '1/2026-27']], (o.settings && o.settings.number_style) || '') };
  const fetchBtn = gstFetchBtn(gst, msg, (d) => {
    if (!f.legal.value.trim()) f.legal.value = d.legal_name;
    if (!f.trade.value.trim()) f.trade.value = d.trade_name || d.legal_name;
    if (!f.addr.value.trim()) f.addr.value = d.address;
    if (!f.city.value.trim()) f.city.value = d.city;
    if (!f.pin.value.trim()) f.pin.value = d.pincode;
    if (!f.pan.value.trim()) f.pan.value = d.pan;
    if (d.state_code && STATES[d.state_code]) st.value = d.state_code;
    f.reg.value = d.reg_type === 'composition' ? 'composition' : 'regular';
  });
  const lf = invoiceLayoutField(br.invoiceStyle, () => ({ legal_name: f.legal.value, trade_name: f.trade.value, name: f.trade.value || f.legal.value, gstin: gst.value, state_code: st.value, address: f.addr.value, city: f.city.value, pincode: f.pin.value, phone: f.ph.value, email: f.em.value, terms: f.terms.value, bank_details: f.bank.value, brand: Object.assign({}, br, { upi: bf.upi.value.trim(), bank: { holder: bf.hold.value.trim(), name: bf.bname.value.trim(), account: bf.acno.value.trim(), ifsc: bf.ifsc.value.trim().toUpperCase(), branch: bf.brn.value.trim() } }) }));
  f.lay = lf.lay;
  v.root.append(h('div', { class: 'card grid' }, field('Legal name', f.legal), field('Trade name (shown on documents)', f.trade), field(window.lbl ? lbl('GSTIN', 'gstin') : 'GSTIN', gst), fetchBtn, msg, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('State', st), field('Registration', f.reg)), field('PAN', f.pan), field('Address', f.addr), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('City', f.city), field('Pincode', f.pin)), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Phone', f.ph), field('Email', f.em))),
    h('div', { class: 'card grid' }, h('h3', null, 'On invoices'), field('Terms and conditions', f.terms), field('Bank details', f.bank), field('Footer line', f.foot),
      lf.row, lf.previewBtn,
      field('Invoice number style', f.numst)),
    h('div', { class: 'card grid' }, h('h3', null, 'Business identity'), h('p', { class: 'muted small' }, 'Shown on every printed and shared invoice.'),
      imageField('Logo', 'Appears at the top left. A simple PNG works best.', br, 'logo', 360, 160), imageField('Signature', 'Appears above "Authorised signatory".', br, 'signature', 300, 120), imageField('Stamp or seal', 'Optional. Appears next to the signature.', br, 'stamp', 240, 240),
      field('Website', bf.web), h('div', { class: 'lbl' }, 'Other registration numbers'), regHost),
    h('div', { class: 'card grid' }, h('h3', null, 'Bank and UPI'), h('p', { class: 'muted small' }, 'Customers see these on the invoice. A UPI ID adds a pay-now QR with the balance filled in.'),
      field('Account name', bf.hold), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Bank', bf.bname), field('Branch', bf.brn)), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Account number', bf.acno), field('IFSC', bf.ifsc)), field('UPI ID', bf.upi)),
    h('div', { class: 'dock' }, h('button', { class: 'btn fill', onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; try { br.upi = bf.upi.value.trim(); br.website = bf.web.value.trim(); br.bank = { holder: bf.hold.value.trim(), name: bf.bname.value.trim(), account: bf.acno.value.trim(), ifsc: bf.ifsc.value.trim().toUpperCase(), branch: bf.brn.value.trim() }; br.regs = br.regs.filter((r) => r.k.trim() && r.v.trim()); br.invoiceStyle = f.lay.value; const r = await api('acc_save_org', { p: { settings: { brand: br, number_style: f.numst.value }, legal_name: f.legal.value, trade_name: f.trade.value, gstin: gst.value, pan: f.pan.value, state_code: st.value, reg_type: f.reg.value, address: f.addr.value, city: f.city.value, pincode: f.pin.value, phone: f.ph.value, email: f.em.value, invoice_terms: f.terms.value, bank_details: f.bank.value, invoice_footer: f.foot.value } }); S.org = r; toast('Saved'); } catch (x) { fail(x); } btn.disabled = false; } }, 'Save')));
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

// ---------- invoice layout preview (sample data, nothing saved or posted) ----------
function sampleInvoiceDoc(org) {
  const lines = [
    { n: 1, description: 'Notebook A5 (200 pages)', hsn: '4820', qty: 3, mrp: 60, rate: 50, taxable: 150, tax_rate: 18, tax: 27, total: 177, unit: 'Nos' },
    { n: 2, description: 'Gel Pen (Blue, pack of 5)', hsn: '9608', qty: 10, mrp: 12, rate: 10, taxable: 100, tax_rate: 18, tax: 18, total: 118, unit: 'Nos' },
  ];
  return { org, doc: { type: 'invoice', number: 'INV/2026-27/00001', date: new Date().toISOString().slice(0, 10), party_name: 'Rahul Sharma', party_phone: '98765 43210', billing_address: '123, MG Road, Jodhpur', place_of_supply: org.state_code || '08', reverse_charge: false, discount: 20, total: 275, cgst: 22.5, sgst: 22.5, igst: 0, roundoff: 0, terms: org.terms }, lines };
}
function previewInvoiceLayout(style, orgLike) {
  const data = sampleInvoiceDoc(orgLike);
  let node;
  if (style === 'classic' && window.auzTaxInvoice) node = auzTaxInvoice.build(data);
  else if (style && window.auzInvoiceTemplates && auzInvoiceTemplates[style]) node = auzInvoiceTemplates[style](data);
  else node = h('p', { class: 'muted' }, 'The standard layout is the default invoice view shown elsewhere in the app -- there is nothing extra to preview here.');
  sheet({ title: 'Preview (sample data, not saved)', full: true, body: h('div', { style: { display: 'flex', justifyContent: 'center', padding: '12px' } }, node) });
}
