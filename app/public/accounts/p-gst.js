/* GST centre: period summary, registers, exceptions, GSTR-2B reconciliation and return-period locking. */
'use strict';
const REG_TYPES = [['b2b', 'B2B sales'], ['b2c', 'B2C sales'], ['cdn', 'Credit/debit notes'], ['hsn', 'HSN summary'], ['exempt', 'Nil / exempt'], ['purchases', 'Purchases'], ['itc', 'Input credit'], ['rcm', 'Reverse charge']];
const REG_COLS = {
  b2b: [['gstin', 'GSTIN'], ['party_name', 'Customer'], ['number', 'Invoice'], ['doc_date', 'Date', 'd'], ['place_of_supply', 'Place of supply'], ['rate', 'Rate %', 'r'], ['taxable', 'Taxable', 'm'], ['igst', 'IGST', 'm'], ['cgst', 'CGST', 'm'], ['sgst', 'SGST', 'm'], ['cess', 'Cess', 'm'], ['total', 'Invoice value', 'm']],
  b2c: [['place_of_supply', 'Place of supply'], ['supply_type', 'Supply'], ['rate', 'Rate %', 'r'], ['taxable', 'Taxable', 'm'], ['igst', 'IGST', 'm'], ['cgst', 'CGST', 'm'], ['sgst', 'SGST', 'm'], ['cess', 'Cess', 'm']],
  cdn: [['doc_type', 'Type'], ['number', 'Note'], ['doc_date', 'Date', 'd'], ['gstin', 'GSTIN'], ['party_name', 'Party'], ['against', 'Against'], ['taxable', 'Taxable', 'm'], ['igst', 'IGST', 'm'], ['cgst', 'CGST', 'm'], ['sgst', 'SGST', 'm'], ['total', 'Value', 'm']],
  hsn: [['hsn', 'HSN/SAC'], ['unit', 'Unit'], ['qty', 'Quantity', 'q'], ['value', 'Value', 'm'], ['taxable', 'Taxable', 'm'], ['igst', 'IGST', 'm'], ['cgst', 'CGST', 'm'], ['sgst', 'SGST', 'm'], ['cess', 'Cess', 'm']],
  exempt: [['supply', 'Supply'], ['buyer', 'Buyer'], ['taxable', 'Value', 'm']],
  purchases: [['doc_type', 'Type'], ['number', 'Bill'], ['doc_date', 'Date', 'd'], ['supplier_ref', 'Supplier invoice'], ['party_name', 'Supplier'], ['gstin', 'GSTIN'], ['itc_eligible', 'ITC', 'b'], ['reverse_charge', 'RCM', 'b'], ['taxable', 'Taxable', 'm'], ['igst', 'IGST', 'm'], ['cgst', 'CGST', 'm'], ['sgst', 'SGST', 'm'], ['total', 'Total', 'm']],
};
REG_COLS.itc = REG_COLS.purchases; REG_COLS.rcm = REG_COLS.purchases;
const fmtCell = (v, t) => (t === 'm' ? Number(v || 0) : t === 'q' ? Number(v || 0) : t === 'd' ? v : t === 'b' ? (v ? 'Yes' : 'No') : t === 'r' ? Number(v) : v ?? '');

page('gst', {
  title: 'GST', icon: 'percent', perm: 'acc_view',
  async render(v) {
    if (!can('acc_reports')) { v.header({ title: 'GST' }); v.root.append(empty('lock', 'No access', 'GST reports need the reports permission.')); return; }
    const tab = v.q.get('tab') || 'summary', month = v.q.get('m') || today().slice(0, 7);
    const from = month + '-01', to = monthEnd(from);
    v.header({ title: 'GST', actions: [] });
    const mi = input({ type: 'month', value: month, label: 'Period', onchange: () => go('gst?tab=' + tab + '&m=' + mi.value + (v.q.get('type') ? '&type=' + v.q.get('type') : '')) });
    v.root.append(h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('Return period', mi))), seg([['summary', 'Summary'], ['registers', 'Registers'], ['checks', 'Checks'], ['2b', 'GSTR-2B match'], ['filing', 'Filing lock']], tab, (t) => go('gst?tab=' + t + '&m=' + month)));
    v.root.append(h('div', { class: 'banner info' }, icon('info', 18), 'These are working papers built from your books. AUZslab does not file returns or call the GST portal. Have your CA confirm figures and rates before filing.'));
    const host = h('div', { class: 'grid' }); v.root.append(host);
    if (tab === 'summary') {
      const g = await api('acc_gst_summary', { p_from: from, p_to: to });
      const out = g.output, itc = g.itc;
      host.append(g.locked ? h('div', { class: 'banner ok' }, icon('lock', 18), 'This return period is marked filed and locked. Documents in it cannot be posted or cancelled.') : null,
        h('div', { class: 'kpis' }, kpi('Output tax', inr(Number(out.cgst) + Number(out.sgst) + Number(out.igst) + Number(out.cess), 0), 'On sales of ' + inr(out.taxable, 0)), kpi('Input tax credit', inr(Number(itc.cgst) + Number(itc.sgst) + Number(itc.igst) + Number(itc.cess), 0), Number(itc.blocked) ? inr(itc.blocked, 0) + ' blocked' : 'Eligible purchases'), kpi('Reverse charge', inr(Number(g.rcm.cgst) + Number(g.rcm.sgst) + Number(g.rcm.igst) + Number(g.rcm.cess), 0), 'Payable in cash'), kpi('Net payable', inr(Number(g.payable.igst) + Number(g.payable.cgst) + Number(g.payable.sgst) + Number(g.payable.cess), 0), 'After set-off (indicative)')),
        headTable(g, out, itc),
        h('div', { class: 'two' }, rateTable('Sales by rate', g.output_by_rate), rateTable('Input credit by rate', g.itc_by_rate)));
    } else if (tab === 'registers') {
      const type = v.q.get('type') || 'b2b';
      const r = await api('acc_gst_register', { p: { type, from, to } });
      const cols = REG_COLS[type];
      host.append(chips(REG_TYPES, type, (t) => go('gst?tab=registers&m=' + month + '&type=' + t)),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'gst-' + type + '-' + month, cols.map((c) => c[1]), r.rows.map((x) => cols.map((c) => fmtCell(x[c[0]], c[2])))) }, icon('download', 18), 'Export'), h('span', { class: 'muted small' }, r.rows.length + ' rows')),
        dataView(cols.map((c, i) => ({ key: c[0], label: c[1], r: ['m', 'q', 'r'].includes(c[2]), title: i === 0 || (type === 'b2b' && c[0] === 'number'), sub: i === 1, render: (x) => (c[2] === 'm' ? money(x[c[0]]) : c[2] === 'd' ? fmtD(x[c[0]]) : c[2] === 'q' ? qty(x[c[0]]) : fmtCell(x[c[0]], c[2])), hideMobile: i > 4 })), r.rows.map((x, i) => ({ ...x, id: i })), { sortKey: null, empty: empty('percent', 'Nothing in this register for the period') }));
    } else if (tab === 'checks') {
      const r = (await api('acc_gst_exceptions', { p_from: from, p_to: to })).rows;
      host.append(r.length ? h('div', { class: 'list' }, r.map((x) => liRow({ icon: 'alert', tone: 'orange', title: x.kind + ' · ' + x.number, sub: x.message, chevron: true, onclick: () => go('doc/' + x.doc_id) }))) : empty('check', 'No exceptions', 'Missing GSTINs, HSN codes, tax-type mismatches and unposted drafts show up here.'));
    } else if (tab === '2b') {
      const rec = await api('acc_gst_recon_list', { p_period: month });
      const imp = can('acc_import') ? h('button', { class: 'btn fill', onclick: () => gst2bImport(month, () => v.refresh()) }, icon('upload', 18), 'Import GSTR-2B file') : null;
      const cnt = (s) => rec.rows.filter((x) => x.status === s).length;
      host.append(h('div', { class: 'row sp wrap' }, h('p', { class: 'muted small grow' }, 'Match what suppliers reported (GSTR-2B) with your purchase bills to confirm the input credit you can claim.'), imp),
        rec.rows.length ? [h('div', { class: 'kpis' }, kpi('Matched', String(cnt('matched')), ''), kpi('Amount differs', String(cnt('mismatch')), ''), kpi('Not in your books', String(cnt('missing_in_books')), 'Supplier reported it'), kpi('Not on portal', String(cnt('missing_in_portal')), 'Credit at risk')),
          dataView([{ key: 'supplier_name', label: 'Supplier', title: true, render: (x) => x.supplier_name || x.supplier_gstin || '' }, { key: 'inv_no', label: 'Invoice', sub: true, render: (x) => x.inv_no + (x.inv_date ? ' · ' + fmtD(x.inv_date) : '') }, { key: 'supplier_gstin', label: 'GSTIN', render: (x) => x.supplier_gstin || '' }, { key: 'taxable', label: 'Taxable', r: true, render: (x) => money(x.taxable) }, { key: 'tax', label: 'Tax', r: true, value: true, render: (x) => money(x.tax) },
            { key: 'status', label: 'Result', badge: true, render: (x) => badge(cap1(x.status), x.status === 'matched' ? 'green' : x.status === 'mismatch' ? 'orange' : 'red') }, { key: 'note', label: 'Note', render: (x) => x.note || '' }], rec.rows.map((x) => ({ ...x })), { onRow: (x) => x.match_doc_id && go('doc/' + x.match_doc_id) })] : empty('percent', 'No GSTR-2B data for ' + month, 'Import the file downloaded from the GST portal.'));
    } else {
      const g = await api('acc_gst_recon_list', { p_period: month });
      host.append(h('div', { class: 'card grid' }, h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 't', style: { fontWeight: 600 } }, fmtD(from).replace(/^\d+ /, '')), h('div', { class: 'small muted' }, g.filed ? 'Marked filed. No GST document can be posted or cancelled in this month.' : 'Open. Documents can still be posted.')), badge(g.filed ? 'Filed and locked' : 'Open', g.filed ? 'green' : '')),
        can('acc_admin') ? h('button', { class: 'btn ' + (g.filed ? '' : 'fill'), onclick: async () => {
          if (g.filed) { if (!(await confirmBox('Unlock ' + month + '?', 'Documents in this period can be posted or cancelled again. This is recorded in the audit log.', 'Unlock', true))) return; await api('acc_mark_gst_filed', { p_period: month, p_filed: false }); }
          else { const ref = await askText('Mark ' + month + ' as filed?', 'This locks the month for GST documents. Add the ARN or filing reference (optional).', 'ARN'); if (ref == null) return; await api('acc_mark_gst_filed', { p_period: month, p_filed: true, p_ref: ref || null }); }
          toast(g.filed ? 'Unlocked' : 'Locked'); v.refresh();
        } }, g.filed ? 'Unlock period' : 'Mark as filed and lock') : h('p', { class: 'muted small' }, 'Only the owner can lock or unlock a return period.')));
    }
  },
});
function headTable(g, out, itc) {
  const row = (l, k) => h('tr', null, h('td', null, l), h('td', { class: 'r' }, money(out[k])), h('td', { class: 'r' }, money(g.rcm[k])), h('td', { class: 'r' }, money(itc[k])), h('td', { class: 'r' }, money(g.payable[k])), h('td', { class: 'r' }, k === 'cess' ? '–' : money(g.carry_forward_itc[k])));
  const head = h('thead', null, h('tr', null, ['Head', 'Output', 'Reverse charge', 'Credit available', 'Payable', 'Credit carried forward'].map((x, i) => h('th', { class: i ? 'r' : '' }, x))));
  const table = h('table', { class: 'tbl' }, head, h('tbody', null, row('IGST', 'igst'), row('CGST', 'cgst'), row('SGST', 'sgst'), row('Cess', 'cess')));
  return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'By tax head')), h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, table)),
    h('p', { class: 'cap' }, 'Set-off order: IGST credit against IGST, CGST, SGST; CGST credit against CGST then IGST; SGST credit against SGST then IGST.'));
}
function rateTable(title, rows) {
  return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, title)), h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Rate', 'Taxable', 'IGST', 'CGST', 'SGST'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))), h('tbody', null, rows.length ? rows.map((r) => h('tr', null, h('td', null, r.tax_rate + '%'), h('td', { class: 'r' }, money(r.taxable)), h('td', { class: 'r' }, money(r.igst)), h('td', { class: 'r' }, money(r.cgst)), h('td', { class: 'r' }, money(r.sgst)))) : [h('tr', null, h('td', { colspan: 5, class: 'muted' }, 'Nothing in this period'))])))));
}
function gst2bImport(period, done) {
  const file = h('input', { type: 'file', accept: '.csv,.xlsx', class: 'input' }), out = h('div', { class: 'grid' });
  let table = null, hdr = [], map = {};
  const FIELDS = [['gstin', 'Supplier GSTIN'], ['name', 'Supplier name'], ['inv_no', 'Invoice number'], ['inv_date', 'Invoice date'], ['taxable', 'Taxable value'], ['igst', 'IGST'], ['cgst', 'CGST'], ['sgst', 'SGST']];
  const guess = (names) => { const f = (re) => names.findIndex((n) => re.test(String(n).toLowerCase())); return { gstin: f(/gstin/), name: f(/trade|name|supplier/), inv_no: f(/invoice (no|num)|inv.*no|document number|bill/), inv_date: f(/invoice date|inv.*date|date/), taxable: f(/taxable/), igst: f(/integrated|igst/), cgst: f(/central|cgst/), sgst: f(/state|sgst/) }; };
  file.onchange = async () => { try { table = await readTable(file.files[0]); const hi = table.findIndex((r) => r.some((c) => /gstin/i.test(c))); table = table.slice(Math.max(hi, 0)); hdr = table[0]; map = guess(hdr); clear(out).append(...FIELDS.map(([k, l]) => { const s = selectEl([['-1', 'Not used'], ...hdr.map((n, i) => [String(i), String(n || 'Column ' + (i + 1))])], String(map[k]), { label: l, onchange: () => { map[k] = Number(s.value); } }); return field(l, s); })); } catch (e) { fail(e); } };
  sheet({ title: 'Import GSTR-2B (' + period + ')', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Upload the B2B sheet from the GSTR-2B Excel or CSV you downloaded. Previous matching for this month is replaced.'), field('File', file), out), actions: [{ label: 'Match', primary: true, onclick: async (c) => {
    if (!table) { toast('Choose a file', { err: true }); return false; }
    const num = (x) => N(x); const rows = table.slice(1).filter((r) => r[map.inv_no] !== '' && r[map.inv_no] != null).map((r) => ({ gstin: String(r[map.gstin] || '').trim(), name: map.name >= 0 ? r[map.name] : '', inv_no: String(r[map.inv_no]), inv_date: map.inv_date >= 0 ? toISO(r[map.inv_date]) : '', taxable: num(r[map.taxable]), tax: (map.igst >= 0 ? num(r[map.igst]) : 0) + (map.cgst >= 0 ? num(r[map.cgst]) : 0) + (map.sgst >= 0 ? num(r[map.sgst]) : 0) }));
    if (!rows.length) { toast('No invoice rows found', { err: true }); return false; }
    const r = await api('acc_gst2b_import', { p_period: period, p_rows: rows }); c(); toast(r.matched + ' matched, ' + r.mismatch + ' differ, ' + r.missing_in_books + ' missing in books'); done();
  } }] });
}
