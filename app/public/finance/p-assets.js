/* AUZsFinance: Assets (things the business owns that wear out) and Budget (a monthly limit per kind of expense). */
'use strict';
page('assets', { title: 'Assets', async render(v) {
  v.header({ title: 'Assets', actions: [can('write') ? { label: 'Add asset', icon: 'plus', primary: true, run: () => assetSheet() } : null] });
  const rows = await api('fin_asset_list');
  const worth = rows.filter((a) => a.status === 'active').reduce((x, a) => x + Number(a.book_value), 0);
  v.root.append(h('div', { class: 'hero-n' }, h('div', { class: 'k' }, 'Worth today'), h('div', { class: 'n num' }, inr(worth))));
  v.root.append(rows.length ? h('div', { class: 'list' }, rows.map((a) => liRow({ icon: 'building', tone: 'gray', title: a.name, value: inr(a.book_value), onclick: () => assetDetail(a) })))
    : empty('building', 'No assets yet', 'Add a machine, vehicle or furniture to see its value fall month by month.', can('write') ? h('button', { class: 'btn fill', onclick: () => assetSheet() }, 'Add asset') : null));
  if (can('write') && rows.length) v.root.append(h('button', { class: 'btn', onclick: async () => { try { const r = await api('fin_run_depreciation', { p_to: todayISO() }); toast(r.assets ? 'Wear posted: ' + inr(r.amount) : 'Nothing new to post'); v.refresh(); } catch (e) { fail(e); } } }, icon('refresh', 18), 'Post this month\'s wear'));
} });
function assetDetail(a) {
  sheet({ title: a.name, closeLabel: 'Done', body: h('div', { class: 'grid' }, h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, 'Worth today'), h('div', { class: 'n num' }, inr(a.book_value))),
    h('div', { class: 'list' }, liRow({ title: 'Bought for', value: inr(a.cost) }), liRow({ title: 'Bought on', value: fmtD(a.buy_date) }), liRow({ title: 'Lasts', value: a.life_years + ' years' }), liRow({ title: 'Value at the end', value: inr(a.salvage) }),
      liRow({ title: 'Lost so far', value: inr(a.accumulated) }), liRow({ title: 'Loses each month', value: inr(a.monthly) }), a.note ? liRow({ title: 'Note', value: a.note }) : null),
    can('write') ? h('button', { class: 'btn', onclick: () => { assetSheet(a); } }, 'Edit') : null) });
}
function assetSheet(a) {
  const nm = input({ value: a ? a.name : '', placeholder: 'e.g. Coffee machine' }), cost = input({ type: 'number', mode: 'decimal', value: a ? a.cost : '', placeholder: '0' }), date = input({ type: 'date', value: a ? String(a.buy_date).slice(0, 10) : todayISO() });
  const life = input({ type: 'number', mode: 'decimal', value: a ? a.life_years : 5 }), salv = input({ type: 'number', mode: 'decimal', value: a ? a.salvage : 0 });
  sheet({ title: a ? 'Edit asset' : 'Add asset', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Name', nm), a ? null : field('Price paid', cost, 'Record the payment itself with "Bought an asset" in Add entry.'), a ? null : field('Bought on', date), field('Lasts (years)', life), field('Worth at the end', salv)),
    actions: [{ label: 'Save', primary: true, onclick: async (close) => { if (!nm.value.trim() || (!a && N(cost.value) <= 0)) { toast('Enter a name and price', { err: true }); return false; }
      await api('fin_asset_save', { p: a ? { id: a.id, name: nm.value.trim(), life_years: N(life.value), salvage: N(salv.value) } : { name: nm.value.trim(), cost: N(cost.value), buy_date: date.value, life_years: N(life.value), salvage: N(salv.value) } }); close(); route_(); } }] });
}
page('budget', { title: 'Budget', async render(v) {
  v.header({ title: 'Budget', actions: [] });
  const r = await api('fin_budget_status', { p_month: null });
  const left = r.rows.reduce((x, b) => x + Number(b.budget) - Number(b.spent), 0);
  v.root.append(h('div', { class: 'hero-n' }, h('div', { class: 'k' }, 'Left this month'), h('div', { class: 'n num ' + (left < 0 ? 'down' : '') }, inr(left))));
  v.root.append(r.rows.length ? h('div', { class: 'list' }, r.rows.map((b) => liRow({ icon: 'tag', tone: Number(b.spent) > Number(b.budget) ? 'orange' : 'gray', title: b.name, value: inr(Number(b.budget) - Number(b.spent)), onclick: () => budgetSheet(r, b) })))
    : empty('tag', 'No budget yet', 'Set a monthly limit for rent, stock or salary and watch it.'));
  if (can('admin')) v.root.append(h('button', { class: 'btn', onclick: () => budgetSheet(r, null) }, icon('plus', 18), 'Set a limit'));
} });
function budgetSheet(r, b) {
  const sel = selectEl([['', 'Choose a kind of expense'], ...r.categories.map((c) => [c.id, c.name])], b ? b.category_id : '');
  const amt = input({ type: 'number', mode: 'decimal', value: b ? b.budget : '', placeholder: 'Limit for a month' });
  const info = b ? h('div', { class: 'list' }, liRow({ title: 'Limit', value: inr(b.budget) }), liRow({ title: 'Spent', value: inr(b.spent) }), liRow({ title: 'Likely by month end', value: inr(b.forecast) })) : null;
  sheet({ title: b ? b.name : 'Set a limit', closeLabel: 'Close', body: h('div', { class: 'grid' }, info, can('admin') ? [field('Kind of expense', sel), field('Monthly limit', amt, 'Set 0 to remove it.')] : null),
    actions: can('admin') ? [{ label: 'Save', primary: true, onclick: async (close) => { if (!sel.value) { toast('Choose a kind of expense', { err: true }); return false; } await api('fin_budget_save', { p_category: sel.value, p_monthly: N(amt.value) }); close(); route_(); } }] : [] });
}
