/* AUZsMob: Repairs. A job card is created once, then only ever grows with append-only events
   (status/part/payment/note) -- see 080's schema header. Current status = the latest 'status' event. */
'use strict';
page('repairs', { title: 'repairs', perm: 'mob_repair', render: renderRepairs });

function latestStatus(repairId, events) {
  const mine = events.filter((e) => e.repair_id === repairId && e.type === 'status').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return mine[0] ? mine[0].status : 'received';
}
function deviceLabel(r) { return r.device_model || r.imei || t('repairJob'); }

async function renderRepairs(v) {
  if (v.args[0]) return renderRepairDetail(v, v.args[0]);
  // the sheet opens directly from the action, not via a route: a modal rendered as a route's own page content
  // would get silently re-created (stacking a second blank sheet) by any background mob:pulled re-render
  // (fired after every localPush/sync) that lands while the sheet is still open
  v.header({ title: t('repairs'), actions: [{ label: t('newTicket'), icon: 'plus', primary: true, run: () => repairSheet() }] });
  const [repairs, events] = await Promise.all([idbGetAll('repairs'), idbGetAll('repairEvents')]);
  const mine = repairs.filter((r) => can('mob_reports') || r.staff_id === S.user.id);
  const withStatus = mine.map((r) => ({ ...r, _status: latestStatus(r.id, events) })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const open = withStatus.filter((r) => !['delivered', 'cancelled'].includes(r._status));
  const closed = withStatus.filter((r) => ['delivered', 'cancelled'].includes(r._status));
  const cols = [{ key: 'dev', title: true, label: '', render: (r) => deviceLabel(r) }, { key: 'cust', sub: true, label: '', render: (r) => r.customer_name || '' }, { key: 'st', badge: true, label: '', render: (r) => badge(statusLabel(r._status)) }];
  add(v.root, [
    section(t('openJobs'), dataView(cols, open, { onRow: (r) => go('repairs/' + r.id), emptyText: t('noneYet') })),
    closed.length ? section(t('closedJobs'), dataView(cols, closed.slice(0, 20), { onRow: (r) => go('repairs/' + r.id) })) : null,
  ]);
}
function cap1(s) { return String(s || '').replace(/^./, (c) => c.toUpperCase()); }
// statuses are snake_case ('in_repair') but the i18n dict keys are camelCase ('statusInRepair') --
// cap1() alone only capitalizes the first letter, leaving the underscore in, so 'status' + cap1('in_repair')
// built the key 'statusIn_repair', which isn't in STR and fell back to printing that raw key on screen.
const STATUS_KEY = { received: 'statusReceived', in_repair: 'statusInRepair', ready: 'statusReady', delivered: 'statusDelivered', cancelled: 'statusCancelled' };
function statusLabel(st) { return t(STATUS_KEY[st] || st); }

async function renderRepairDetail(v, id) {
  const [repairs, events] = await Promise.all([idbGetAll('repairs'), idbGetAll('repairEvents')]);
  const r = repairs.find((x) => x.id === id);
  if (!r) { v.header({ title: t('repairJob'), back: 'repairs' }); v.root.append(empty('wrench', t('noneYet'))); return; }
  const myEvents = events.filter((e) => e.repair_id === id).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const status = latestStatus(id, events);
  const parts = myEvents.filter((e) => e.type === 'part');
  const payments = myEvents.filter((e) => e.type === 'payment');
  const canAct = can('mob_reports') || r.staff_id === S.user.id;

  v.header({ title: deviceLabel(r), back: 'repairs', actions: canAct ? [
    { label: t('addPart'), icon: 'box', run: () => addPartSheet(id, v) },
    { label: t('addPayment'), icon: 'cash', run: () => addPaymentSheet(id, v) },
  ] : [] });

  add(v.root, [
    h('div', { class: 'row sp' }, badge(statusLabel(status)), h('span', { class: 'muted small' }, fmtDT(r.created_at))),
    canAct ? h('div', { class: 'seg full', style: { marginTop: '10px' } }, ...['received', 'in_repair', 'ready', 'delivered', 'cancelled'].map((st) => h('button', { type: 'button', 'aria-selected': String(st === status), onclick: () => pushStatus(id, st, v) }, statusLabel(st)))) : null,
    section(t('customer'), h('div', { class: 'card' }, h('div', null, r.customer_name || '—'), h('div', { class: 'muted small' }, r.customer_phone))),
    section(t('problem'), h('div', { class: 'card' }, r.problem || '—')),
    parts.length ? section(t('partsUsed'), h('div', { class: 'list' }, parts.map((p) => liRow({ icon: 'box', title: itemNameSync(p.item_id), sub: t('qty') + ' ' + p.qty, value: money(p.cost * p.qty) })))) : null,
    payments.length ? section(t('payments'), h('div', { class: 'list' }, payments.map((p) => liRow({ icon: 'cash', title: money(p.amount), sub: p.method })))) : null,
  ]);
}
let _itemsCache = null;
function itemNameSync(id) { return (_itemsCache || []).find((i) => i.id === id)?.name || id; }
idbGetAll('items').then((x) => { _itemsCache = x; });

async function pushStatus(repairId, status, v) {
  const id = uid();
  await localPush('repairEvents', { id, repair_id: repairId, type: 'status', status, staff_id: S.user.id, created_at: new Date().toISOString() }, 'mob_push_repair_event', { p_id: id, p_repair_id: repairId, p: { type: 'status', status } });
  toast(t('saved')); v.refresh();
}

function repairSheet(v) {
  const custName = input({ label: t('customer'), autofocus: true });
  const custPhone = input({ label: t('phone'), mode: 'tel' });
  const model = input({ label: t('deviceModel') });
  const imei = input({ label: t('serialNo') });
  const problem = h('textarea', { class: 'textarea', placeholder: t('problem') });
  const advance = input({ value: 0, label: t('advance'), mode: 'decimal' });
  const estimate = input({ value: '', label: t('estimate'), mode: 'decimal' });
  const warranty = input({ value: 0, label: t('warrantyDays'), mode: 'decimal' });
  sheet({
    title: t('newTicket'), wide: true,
    body: h('div', { class: 'grid' },
      h('div', { class: 'two' }, field(t('customer'), custName), field(t('phone'), custPhone)),
      h('div', { class: 'two' }, field(t('deviceModel'), model), field(t('serialNo'), imei)),
      field(t('problem'), problem),
      h('div', { class: 'two' }, field(t('advance'), advance), field(t('estimate'), estimate)),
      field(t('warrantyDays'), warranty),
    ),
    actions: [{ label: t('save'), primary: true, onclick: async (close) => {
      const id = uid();
      const p = { customerName: custName.value.trim(), customerPhone: custPhone.value.trim(), deviceModel: model.value.trim(), imei: imei.value.trim(), problem: problem.value.trim(), advance: N(advance.value), estimate: estimate.value ? N(estimate.value) : null, warrantyDays: N(warranty.value) };
      await localPush('repairs', { id, customer_name: p.customerName, customer_phone: p.customerPhone, device_model: p.deviceModel, imei: p.imei, problem: p.problem, advance: p.advance, estimate: p.estimate, warranty_days: p.warrantyDays, staff_id: S.user.id, created_at: new Date().toISOString() }, 'mob_create_repair', { p_id: id, p });
      await idbPut('repairEvents', { id: uid(), repair_id: id, type: 'status', status: 'received', staff_id: S.user.id, created_at: new Date().toISOString() });
      close(); toast(t('saved')); go('repairs/' + id);
    } }],
  });
}

function addPartSheet(repairId, v) {
  const items = _itemsCache || [];
  if (!items.length) { fail(new Error(t('errAtLeastOneItem'))); return; }
  const prod = selectEl(items.map((i) => [i.id, i.name]), items[0].id);
  const qtyI = input({ value: 1, label: t('qty'), mode: 'decimal' });
  sheet({
    title: t('addPart'), body: h('div', { class: 'grid' }, field(t('itemName'), prod), field(t('qty'), qtyI)),
    actions: [{ label: t('add'), primary: true, onclick: async (close) => {
      const item = items.find((i) => i.id === prod.value);
      const id = uid();
      await localPush('repairEvents', { id, repair_id: repairId, type: 'part', item_id: item.id, qty: N(qtyI.value) || 1, cost: item.cost_price, staff_id: S.user.id, created_at: new Date().toISOString() }, 'mob_push_repair_event', { p_id: id, p_repair_id: repairId, p: { type: 'part', itemId: item.id, qty: N(qtyI.value) || 1, cost: item.cost_price } });
      close(); toast(t('saved')); v.refresh();
    } }],
  });
}
function addPaymentSheet(repairId, v) {
  const amount = input({ value: '', label: t('amount'), mode: 'decimal', autofocus: true });
  const method = selectEl([['cash', t('cash')], ['upi', t('upi')], ['card', t('card')]], 'cash');
  sheet({
    title: t('addPayment'), body: h('div', { class: 'grid' }, field(t('amount'), amount), field(t('paymentMode'), method)),
    actions: [{ label: t('add'), primary: true, onclick: async (close) => {
      if (!N(amount.value)) { fail(new Error(t('errNameRequired'))); return false; }
      const id = uid();
      await localPush('repairEvents', { id, repair_id: repairId, type: 'payment', amount: N(amount.value), method: method.value, staff_id: S.user.id, created_at: new Date().toISOString() }, 'mob_push_repair_event', { p_id: id, p_repair_id: repairId, p: { type: 'payment', amount: N(amount.value), method: method.value } });
      close(); toast(t('saved')); v.refresh();
    } }],
  });
}
