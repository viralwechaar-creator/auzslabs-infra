/* Inventory: a stripped-down stock screen for every staff member (gated on can('inventory'), never on role).
   Shows raw materials (kind='ing') with a low/out-of-stock flag and lets anyone adjust quantity on hand --
   nothing else (no reports, no settings, no other business data). Same record shape, same adjustment-log
   pattern as the admin console's Inventory -> Stock page (console/p-inventory.js's adjustForm): mutate
   g.qty, save('ing', c, c.id), then log a save('adjustment', {...}) record. */
'use strict';
const outOfStockIng = (g) => (g.qty || 0) <= 0;
const lowStockIng = (g) => !outOfStockIng(g) && (g.qty || 0) <= (g.low || 0);
const expSoonIng = (g) => g.expiry && g.expiry <= addDays(today(), 7) && (g.qty || 0) > 0;
const INV_REASONS = ['Count correction', 'Damaged / spoiled', 'Expired', 'Found later', 'Other'];
function invStockTone(g) { return outOfStockIng(g) ? 'red' : lowStockIng(g) ? 'orange' : expSoonIng(g) ? 'orange' : 'green'; }
function invStockLabel(g) { return outOfStockIng(g) ? 'Out of stock' : lowStockIng(g) ? 'Low stock' : expSoonIng(g) ? 'Expiring soon' : 'In stock'; }

V.inventory = () => {
  const q = (S.invQ || '').toLowerCase(), f = S.invF || 'all';
  const all_ = L('ing');
  const list = all_.filter((g) => !q || g.name.toLowerCase().includes(q))
    .filter((g) => f === 'all' || (f === 'low' && lowStockIng(g)) || (f === 'out' && outOfStockIng(g)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const lowN = all_.filter(lowStockIng).length, outN = all_.filter(outOfStockIng).length;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Inventory'),
      h('div', { class: 'sub' }, plural(all_.length, 'item') + (outN ? ' · ' + plural(outN, 'out of stock') : '') + (lowN ? ' · ' + plural(lowN, 'low') : '')))),
    h('div', { class: 'search' }, icon('search', 18), h('input', { class: 'input', placeholder: 'Search stock', value: S.invQ || '', 'aria-label': 'Search stock', onchange: (e) => { S.invQ = e.target.value; render(); } })),
    h('div', { style: { maxWidth: '480px' } }, seg([['all', 'All'], ['low', 'Low (' + lowN + ')'], ['out', 'Out (' + outN + ')']], f, (v) => { S.invF = v; render(); })),
    all_.length
      ? (list.length
        ? h('div', { class: 'list' }, list.map((g) => liRow({
            ic: 'box', tone: invStockTone(g),
            title: g.name,
            sub: r2(g.qty || 0) + ' ' + (g.unit || '') + ' on hand' + (g.low ? ' · low at ' + r2(g.low) + ' ' + (g.unit || '') : ''),
            value: invStockLabel(g),
            chev: true, onclick: () => invAdjustForm(g),
          })))
        : empty('box', 'No matches', 'Try a different search or filter.'))
      : empty('box', 'No stock items yet', 'Ask the owner or manager to add raw materials under the admin console’s Inventory page.'));
};

function invAdjustForm(g) {
  let qv = '', reason = INV_REASONS[0];
  const qInp = input({ type: 'number', mode: 'decimal', placeholder: 'e.g. 5 or -2', focus: true });
  const reasonSel = selectEl(INV_REASONS, reason, (e) => { reason = e.target.value; });
  const s = sheet({
    title: 'Adjust stock — ' + g.name,
    narrow: true,
    body: h('div', { class: 'stack s20' },
      h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'On hand now'), h('div', { class: 's' }, 'Before this adjustment')), h('div', { class: 'v' }, r2(g.qty || 0) + ' ' + (g.unit || ''))),
      field('Adjust by (+ add, − remove) in ' + (g.unit || 'units'), qInp),
      field('Reason', reasonSel)),
    actions: [{ label: 'Save', primary: true, run: async () => {
      const q = +qInp.value;
      if (!q) { toast('Enter a non-zero amount', { err: true }); return false; }
      const c = structuredClone(g);
      c.qty = r2((c.qty || 0) + q);
      await save('ing', c, c.id);
      await save('adjustment', { ing: g.name, q, reason, by: myName(), at: now() });
      toast('Stock adjusted');
    } }],
  });
  return s;
}
