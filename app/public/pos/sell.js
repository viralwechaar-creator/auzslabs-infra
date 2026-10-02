/* Sell: categories, items, the ticket, and everything done to an order before payment
   (options and notes, discounts with approval, coupons, customer, delivery details, KOT, cancellations). */
'use strict';
const ORDER_TYPES = [['Dine-in', 'Dine-in'], ['Takeaway', 'Takeaway'], ['Delivery', 'Delivery']];
const DELIVERY_SOURCES = ['Phone', 'Website', 'Zomato', 'Swiggy', 'ONDC'];
const VEG = { veg: 'Veg', nonveg: 'Non-veg', egg: 'Egg' };
const cats = () => L('cat').sort((a, b) => (a.n || 0) - (b.n || 0) || String(a.name).localeCompare(b.name));

function curOrder() { if (!S.cur) S.cur = newOrder(); return S.cur; }
function visibleItems(o) {
  const q = S.q.trim().toLowerCase(), vf = S.vf;
  return menuItems().filter((i) => !itemOff(i, o.type) && (q ? i.name.toLowerCase().includes(q) || (i.short || '').toLowerCase() === q || (i.short || '').toLowerCase().startsWith(q) || (i.barcode && i.barcode === S.q.trim()) || (i.variants || []).some((v) => v.barcode && v.barcode === S.q.trim()) : i.cat === S.cat)
    && (isRetail() || vf === 'all' || (i.veg || 'veg') === vf)).sort((a, b) => a.name.localeCompare(b.name));
}

V.sell = () => {
  const o = curOrder(), cs = cats();
  if (!cs.some((c) => c.id === S.cat)) S.cat = cs[0] && cs[0].id;
  const counts = {}; menuItems().forEach((i) => { if (!itemOff(i, o.type)) counts[i.cat] = (counts[i.cat] || 0) + 1; });
  const inCart = {}; o.lines.forEach((l) => (inCart[l.id] = (inCart[l.id] || 0) + l.qty));
  const grid = h('div', { class: 'items', 'data-items': '1' });
  const drawGrid = () => {
    const its = visibleItems(o);
    grid.replaceChildren(...its.map((i) => itemTile(i, inCart[i.id])));
    if (!its.length) grid.append(h('div', { style: { gridColumn: '1/-1' } }, cs.length ? empty('search', S.q ? 'No matches' : 'Nothing here', S.q ? 'Try another name or code.' : 'Every item in this category is sold out or hidden.') : empty('sell', 'No menu yet', 'Add categories and items in the admin console under Menu.')));
  };
  drawGrid();
  const search = h('div', { class: 'search grow' }, icon('search', 18), h('input', { class: 'input', type: 'search', placeholder: 'Search items or codes', value: S.q, 'aria-label': 'Search items', oninput: (e) => { S.q = e.target.value; drawGrid(); $$('.cats button,.cat-chips .chip').forEach((b) => b.classList.toggle('on', !S.q && b.dataset.cat === S.cat)); } }));
  const catBtn = (c, chip) => h('button', { class: (chip ? 'chip' : '') + (c.id === S.cat && !S.q ? ' on' : ''), 'data-cat': c.id, onclick: () => { S.cat = c.id; S.q = ''; render(); } }, c.name, h('span', { class: 'n' }, String(counts[c.id] || 0)));
  const head = h('div', { class: 'items-head' },
    !isRetail() ? h('div', { class: 'row only-phone' }, h('div', { class: 'grow' }, typeSeg(o)), o.type === 'Dine-in' && isRestaurant() ? h('button', { class: 'chip' + (o.table ? ' on' : ''), onclick: () => tableSheet(o) }, icon('tables', 16), o.table ? tn(o.table) : 'Table') : null) : null,
    h('div', { class: 'row' }, search, !isRetail() ? h('div', { style: { flex: 'none', width: '210px' }, class: 'only-desk' }, seg([['all', 'All'], ['veg', 'Veg'], ['nonveg', 'Non-veg']], S.vf, (v) => { S.vf = v; drawGrid(); })) : null),
    h('div', { class: 'chips cat-chips' }, cs.map((c) => catBtn(c, true))));
  const t = tot(o), n = itemCount(o);
  const cartBar = h('div', { class: 'cart-bar' + (n ? '' : ' empty') }, h('div', { class: 'ct' }, h('b', null, inr(t.total)), h('span', null, plural(n, 'item') + (o.table ? ' · ' + tn(o.table) : ''))),
    h('button', { class: 'btn ghost', onclick: () => openTicketSheet() }, 'View'), h('button', { class: 'btn', onclick: () => payFlow(o) }, 'Pay'));
  return h('div', { class: 'sell' },
    h('div', { class: 'cats-col' }, h('div', { class: 'cats' }, cs.map((c) => catBtn(c, false)))),
    h('div', { class: 'items-col' }, head, h('div', { class: 'items-scroll' }, grid), cartBar),
    h('div', { class: 'ticket-pane' }, ticketView(o)));
};
V.sell.fixed = true;

function itemTile(i, q) {
  const price = i.sizes && i.sizes.length ? i.sizes.map((s) => inr(s.p)).slice(0, 2).join(' / ') : inr(i.price);
  return h('button', { class: 'tile' + (i.img ? ' has-img' : ''), onclick: () => addItemFlow(i), 'aria-label': i.name },
    i.img ? h('img', { src: i.img, alt: '', loading: 'lazy' }) : null,
    h('div', { class: 'nm' }, i.name, i.combo ? ' ' : null),
    h('div', { class: 'pr' }, h('span', null, isRetail() ? inr(i.price) + ' · ' + variantQty(i) + ' left' : price), !isRetail() ? h('i', { class: 'vmark ' + (i.veg || 'veg'), title: VEG[i.veg || 'veg'] }) : null),
    q ? h('span', { class: 'qty' }, String(q)) : null);
}
function typeSeg(o) {
  return seg(ORDER_TYPES, o.type, async (v) => {
    if (v === o.type) return;
    if (v !== 'Dine-in' && o.table && sentQty(o) && !(await confirmBox('Move this order off ' + tn(o.table) + '?', 'The kitchen already has it. The table will be freed.', 'Change'))) return render();
    o.type = v; if (v !== 'Dine-in') { o.table = null; o.covers = null; }
    if (v === 'Delivery') deliverySheet(o); render();
  });
}

// ---------- ticket ----------
function ticketView(o, inSheet) {
  const t = tot(o), sent = sentQty(o) > 0, c = cfg();
  const title = o.no ? 'Order ' + o.no : 'New order';
  const kst = o.kstat ? { new: ['In kitchen', 'orange'], preparing: ['Preparing', 'orange'], ready: ['Ready', 'green'], served: ['Served', ''], dispatched: ['Out for delivery', 'blue'], done: ['Delivered', ''] }[o.kstat] : null;
  const meta = [];
  if (o.type === 'Dine-in' && isRestaurant()) meta.push(h('button', { class: 'chip' + (o.table ? ' set' : ''), onclick: () => tableSheet(o) }, icon('tables', 16), o.table ? tn(o.table) : 'Choose table'));
  if (o.type === 'Dine-in' && isRestaurant()) meta.push(h('button', { class: 'chip' + (o.covers ? ' set' : ''), onclick: () => coversSheet(o) }, icon('people', 16), o.covers ? plural(o.covers, 'guest') : 'Guests'));
  if (o.type === 'Delivery') meta.push(h('button', { class: 'chip' + (o.addr ? ' set' : ''), onclick: () => deliverySheet(o) }, icon('truck', 16), o.addr ? (o.src ? o.src + ' · ' : '') + (o.eta ? 'by ' + o.eta : 'Address set') : 'Delivery details'));
  if (o.captain) meta.push(h('button', { class: 'chip set', onclick: () => captainSheet(o) }, icon('person', 16), o.captain.name));
  if (o.adv) meta.push(h('button', { class: 'chip set', onclick: () => scheduleSheet(o) }, icon('clock', 16), advLabel(o.adv)));
  if (o.comment) meta.push(h('button', { class: 'chip set', onclick: () => commentSheet(o) }, icon('note', 16), o.comment));
  // loyalty and saved customer details update in place: a full redraw while the cashier taps a button would swallow the tap
  const loyalSlot = h('div', { class: 'loyal-slot' });
  const fillLoyal = () => {
    const ph = digits((o.cust || {}).phone), lo = c.loyaltyOn && ph.length >= 10 ? loyaltyOf(ph, o.id) : null;
    loyalSlot.replaceChildren(lo && (lo.visits || lo.points) ? h('div', { class: 'row small', style: { color: 'var(--accent-text)' } }, icon('star', 16), h('span', { class: 'grow' }, plural(lo.visits, 'visit') + ' · ' + inr(lo.lifetime) + ' · ' + lo.points + ' points'),
      lo.points > 0 && !o.coupon && !o.loyaltyRedeemed ? h('button', { class: 'btn sm tinted', onclick: () => { o.loyaltyRedeemed = lo.points; o.disc = { t: '₹', v: r2(lo.points * (+c.loyaltyRedeemRs || 1)), src: 'loyalty' }; o.coupon = null; render(); } }, 'Redeem ' + inr(r2(lo.points * (+c.loyaltyRedeemRs || 1)))) : null) : '');
  };
  fillLoyal();
  const nameIn = h('input', { class: 'input', placeholder: 'Customer name', value: (o.cust || {}).name || '', 'aria-label': 'Customer name', oninput: (e) => { o.cust.name = e.target.value; } });
  const custInputs = h('div', { class: 'tk-cust' }, nameIn,
    h('input', { class: 'input', type: 'tel', inputmode: 'tel', placeholder: 'Phone' + (c.requirePhone === false ? '' : ' *'), value: (o.cust || {}).phone || '', 'aria-label': 'Phone', oninput: (e) => {
      o.cust.phone = e.target.value; const d = digits(e.target.value);
      if (d.length === 10) { const prof = rec(d); if (prof && prof.name && !o.cust.name) { o.cust.name = prof.name; nameIn.value = prof.name; if (prof.gst) o.cust.gst = prof.gst; } }
      clearTimeout(S.phoneT); S.phoneT = setTimeout(fillLoyal, 400);
    } }));
  const lines = o.lines.length ? o.lines.map((l) => lineRow(o, l)) : [h('div', { class: 'tk-empty' }, icon('sell', 36, 1.4), h('b', null, 'No items yet'), h('span', null, 'Tap an item to add it.'))];
  const sumRow = (label, val, onclick) => h('div', { class: 'r' }, onclick ? h('button', { onclick }, label) : h('span', null, label), h('span', null, val));
  const gstLabel = Object.keys(t.rates || {}).filter((r) => +r > 0).length === 1 ? 'GST ' + Object.keys(t.rates).find((r) => +r > 0) + '%' : 'GST';
  const acts = isRetail()
    ? [h('button', { class: 'btn', disabled: !o.lines.length, onclick: async () => { o.trial = true; await persist(o); S.cur = null; closeTicketSheet(); toast('Moved to the trial room'); render(); } }, 'Trial room'), h('button', { class: 'btn', disabled: !o.lines.length, onclick: () => holdOrder(o) }, 'Hold')]
    : [h('button', { class: 'btn tinted', disabled: !unsent(o), onclick: () => sendKot(o) }, icon('kitchen', 18), 'Send to kitchen'), h('button', { class: 'btn', disabled: !o.lines.length, onclick: () => holdOrder(o) }, 'Hold')];
  return h('div', { class: 'ticket' },
    h('div', { class: 'tk-h' },
      h('div', { class: 'ttl' }, inSheet ? h('span', { class: 'grow' }) : h('b', { class: 'grow ellip' }, title), kst ? pill(kst[0], kst[1]) : null, h('button', { class: 'iconbtn', 'aria-label': 'Order actions', onclick: () => orderMenu(o) }, icon('more', 22))),
      !isRetail() ? h('div', { class: inSheet ? '' : 'only-desk' }, typeSeg(o)) : null,
      meta.length ? h('div', { class: 'tk-meta' }, meta) : null,
      custInputs, loyalSlot),
    h('div', { class: 'tk-lines' }, lines),
    h('div', { class: 'tk-sum' },
      sumRow('Subtotal', inr(t.sub)),
      t.d ? sumRow(o.complimentary ? 'Complimentary' : o.coupon ? 'Coupon ' + o.coupon : o.loyaltyRedeemed ? 'Loyalty points' : 'Discount' + (o.disc && o.disc.t === '%' ? ' ' + o.disc.v + '%' : ''), '−' + inr(t.d), () => (o.complimentary ? compSheet(o) : discountSheet(o))) : (o.lines.length ? sumRow('Add discount', '', () => discountSheet(o)) : null),
      t.svc ? sumRow('Service charge ' + c.serviceChargePct + '%', inr(t.svc), can('m') ? () => { o.noSvc = true; render(); toast('Service charge removed'); } : null) : (o.noSvc && o.type === 'Dine-in' ? sumRow('Add service charge', '', () => { o.noSvc = false; render(); }) : null),
      t.pack ? sumRow('Packing', inr(t.pack)) : null,
      t.deliv ? sumRow('Delivery', inr(t.deliv)) : null,
      t.tax ? sumRow(gstLabel, inr(t.tax)) : null,
      t.round ? sumRow('Round off', (t.round > 0 ? '+' : '−') + inr(Math.abs(t.round))) : null,
      h('div', { class: 'r tot' }, h('span', null, 'Total'), h('span', { class: 'num' }, inr(t.total)))),
    h('div', { class: 'tk-act' }, acts, h('button', { class: 'btn fill lg pay', disabled: !o.lines.length, onclick: () => payFlow(o) }, 'Pay')));
}
function lineRow(o, l) {
  const st = [l.size, l.note, l.variant ? null : null].filter(Boolean).join(' · ');
  return h('div', { class: 'ln' + ((l.sent || 0) >= l.qty ? ' sent' : ''), role: 'group' },
    h('button', { class: 'lt', style: { textAlign: 'left' }, onclick: () => lineSheet(o, l) }, h('b', null, l.name), st || l.sent ? h('span', null, [st, l.sent ? (l.sent >= l.qty ? 'Sent' : l.sent + ' sent') : ''].filter(Boolean).join(' · ')) : null),
    h('span', { class: 'stepper' }, h('button', { 'aria-label': 'One less ' + l.name, onclick: () => changeQty(o, l, -1) }, icon(l.qty === 1 ? 'trash' : 'minus', 17)), h('b', null, String(l.qty)), h('button', { 'aria-label': 'One more ' + l.name, onclick: () => changeQty(o, l, 1) }, icon('plus', 17))),
    h('span', { class: 'lp' }, inr(l.price * l.qty)));
}

// phones: the ticket opens as a sheet from the cart bar
function openTicketSheet() {
  const o = curOrder();
  S.ticketSheet = sheet({ title: o.no ? 'Order ' + o.no : 'New order', closeLabel: 'Done', body: ticketView(o, true), onClose: () => { S.ticketSheet = null; render(); }, cls: 'tk-sheet' });
  S.ticketSheet.body.style.padding = '0';
}
function refreshTicketSheet() { if (S.ticketSheet && S.cur) S.ticketSheet.setBody(ticketView(S.cur, true)); }
function closeTicketSheet() { if (S.ticketSheet) { const s = S.ticketSheet; S.ticketSheet = null; s.close(); } }

// ---------- adding items ----------
function addItemFlow(i) {
  if (isRetail() && i.variants && i.variants.length) return variantSheet(i);
  const groups = (i.addonGroups || []).map(rec).filter(Boolean);
  const own = groups.length ? i.ownMods || [] : i.mods || [];
  if ((i.sizes && i.sizes.length) || groups.length || own.length || i.askNote) return optionSheet(i, groups, own);
  addLine(i, '', i.price);
}
const parseMods = (list) => (Array.isArray(list) ? list : String(list || '').split(',')).map((m) => { const [n, v] = String(m).split(':'); return { n: (n || '').trim(), v: +v || 0 }; }).filter((m) => m.n);
function optionSheet(i, groups, own) {
  const sizes = i.sizes || [];
  let size = sizes[0] || null, qty = 1;
  const picked = new Map(); // group index -> Set of mod names
  const allGroups = [...groups.map((g) => ({ name: g.name, min: +g.min || 0, max: +g.max || 0, mods: parseMods(g.mods) })), ...(own.length ? [{ name: groups.length ? 'Extras' : 'Add-ons', min: 0, max: 0, mods: parseMods(own) }] : [])];
  const note = h('input', { class: 'input', placeholder: 'e.g. less spicy, no onion', 'aria-label': 'Note for the kitchen' });
  const priceNow = () => r2(((size ? size.p : i.price) + allGroups.reduce((a, g, gi) => a + g.mods.filter((m) => (picked.get(gi) || new Set()).has(m.n)).reduce((x, m) => x + m.v, 0), 0)) * qty);
  const addBtn = { label: 'Add', primary: true, run: () => {
    for (const [gi, g] of allGroups.entries()) { const n = (picked.get(gi) || new Set()).size; if (g.min && n < g.min) { toast('Choose at least ' + g.min + ' in ' + g.name, { err: true }); return false; } }
    const mods = allGroups.flatMap((g, gi) => g.mods.filter((m) => (picked.get(gi) || new Set()).has(m.n)));
    const unit = r2((size ? size.p : i.price) + mods.reduce((a, m) => a + m.v, 0));
    const noteTxt = [mods.map((m) => m.n).join(', '), note.value.trim()].filter(Boolean).join(' · ') || undefined;
    addLine(i, size ? size.l : '', unit, noteTxt, null, qty);
  } };
  const body = h('div', { class: 'stack s20' });
  const draw = () => {
    body.replaceChildren(
      sizes.length ? h('div', { class: 'sec' }, h('div', { class: 'lbl' }, 'Size'), h('div', { class: 'list' }, sizes.map((s) => liRow({ title: s.l, value: inr(s.p), right: size === s ? h('span', { style: { color: 'var(--accent-text)' } }, icon('check', 20)) : h('span', { style: { width: '20px' } }), onclick: () => { size = s; draw(); } })))) : null,
      ...allGroups.map((g, gi) => {
        const set = picked.get(gi) || new Set(); picked.set(gi, set);
        const rule = g.min && g.max ? 'Choose ' + (g.min === g.max ? g.min : g.min + ' to ' + g.max) : g.min ? 'Choose at least ' + g.min : g.max ? 'Up to ' + g.max : 'Optional';
        return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('div', { class: 'lbl' }, g.name), h('span', { class: 'small sub' }, rule)), h('div', { class: 'list' }, g.mods.map((m) => liRow({ title: m.n, value: m.v ? '+' + inr(m.v) : '', right: h('span', { style: { color: 'var(--accent-text)', width: '20px' } }, set.has(m.n) ? icon('check', 20) : null), onclick: () => {
          if (set.has(m.n)) set.delete(m.n);
          else { if (g.max === 1) set.clear(); else if (g.max && set.size >= g.max) { toast('Up to ' + g.max + ' in ' + g.name, { err: true }); return; } set.add(m.n); }
          draw();
        } }))));
      }),
      h('div', { class: 'sec' }, h('div', { class: 'lbl' }, 'Note for the kitchen'), note),
      h('div', { class: 'row sp' }, h('span', { class: 'lbl' }, 'Quantity'), stepper(qty, (v) => { qty = v; addBtn.el.textContent = 'Add ' + qty + ' · ' + inr(priceNow()); }, 1, 99)));
    if (addBtn.el) addBtn.el.textContent = 'Add ' + qty + ' · ' + inr(priceNow());
  };
  draw();
  sheet({ title: i.name, body, closeLabel: 'Cancel', actions: [addBtn] });
  addBtn.el.textContent = 'Add ' + qty + ' · ' + inr(priceNow());
}
function variantSheet(i) {
  const s = sheet({ title: i.name, narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'list' }, (i.variants || []).map((v) => liRow({ title: v.size + (v.color ? ' / ' + v.color : ''), sub: v.qty > 0 ? v.qty + ' in stock' : 'Out of stock', value: inr(i.price), onclick: async () => {
    if (v.qty <= 0 && !(await confirmBox('Out of stock', 'This variant shows 0 in stock. Add it anyway?', 'Add'))) return;
    s.close(); addLine(i, v.size + (v.color ? ' / ' + v.color : ''), i.price, undefined, { size: v.size, color: v.color });
  } }))) });
}
function addLine(i, size, price, note, variant, qty = 1) {
  const o = curOrder();
  // a dish cancelled from another order in the last 15 minutes may still be sitting in the kitchen
  const recent = L('waste').find((w) => w.itemId === i.id && w.at && Date.now() - new Date(w.at) < 15 * 60000);
  if (recent && !(S._dupWarned || (S._dupWarned = {}))[i.id]) { S._dupWarned[i.id] = true; toast(i.name + ' was cancelled from another order ' + Math.max(1, minsSince(recent.at)) + ' min ago. Check the kitchen before cooking a new one.', { ms: 6000 }); }
  const same = o.lines.find((x) => x.id === i.id && (x.size || '') === (size || '') && x.price === price && (x.note || '') === (note || '') && (x.variant ? x.variant.size + '/' + (x.variant.color || '') : '') === (variant ? variant.size + '/' + (variant.color || '') : ''));
  if (same) same.qty += qty; else o.lines.push({ id: i.id, name: i.name, size: size || '', price, qty, sent: 0, st: i.st || 'Kitchen', note: note || undefined, variant: variant || undefined });
  render();
}
async function changeQty(o, l, d) {
  if (d < 0 && l.qty - 1 < (l.sent || 0)) return cancelSent(o, l, 1);
  l.qty += d; if (l.qty <= 0) o.lines = o.lines.filter((x) => x !== l);
  render();
}
function lineSheet(o, l) {
  const sent = l.sent || 0, open = l.qty - sent;
  const note = h('input', { class: 'input', value: l.note || '', placeholder: 'e.g. less spicy', disabled: sent > 0, 'aria-label': 'Note' });
  let q = l.qty;
  const s = sheet({ title: l.name + (l.size ? ' (' + l.size + ')' : ''), narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack s20' },
    h('div', { class: 'list' }, liRow({ title: 'Price', value: inr(l.price) }), liRow({ title: 'Kitchen', value: sent ? (sent >= l.qty ? 'All sent' : sent + ' of ' + l.qty + ' sent') : 'Not sent yet' }), l.st ? liRow({ title: 'Prepared at', value: l.st }) : null),
    h('div', { class: 'row sp' }, h('span', { class: 'lbl' }, 'Quantity'), stepper(q, (v) => { q = v; }, sent ? 0 : 1, 99)),
    field('Note for the kitchen', note, sent ? 'Already in the kitchen. Add a new line for changes.' : null),
    sent ? h('button', { class: 'btn danger wide', onclick: () => { s.close(); cancelSent(o, l, sent); } }, icon('x', 18), 'Cancel ' + (sent > 1 ? sent + ' ' : '') + 'sent item' + (sent > 1 ? 's' : '')) : null,
    h('button', { class: 'btn danger wide', onclick: () => { s.close(); if (sent) cancelSent(o, l, l.qty); else { o.lines = o.lines.filter((x) => x !== l); render(); } } }, icon('trash', 18), 'Remove from order')),
    actions: [{ label: 'Save', primary: true, run: () => {
      if (q < sent) { setTimeout(() => cancelSent(o, l, sent - q), 50); return; }
      l.qty = q; if (!sent) l.note = note.value.trim() || undefined; if (l.qty <= 0) o.lines = o.lines.filter((x) => x !== l); render();
    } }] });
  return open;
}
// cutting an item the kitchen already has: reason, manager approval, wastage, a cancellation slip for the kitchen
async function cancelSent(o, l, q) {
  q = Math.min(q, l.sent || 0); if (q <= 0) return;
  const reason = await pickReason('Why cancel ' + l.name + '?'); if (!reason) return;
  const ap = await approve('cancel', o.id, 'Cancel ' + q + ' × ' + l.name + '. The kitchen already has it.'); if (!ap) return;
  freshCur();
  l.qty -= q; l.sent = Math.min(l.sent || 0, l.qty); if (l.qty <= 0) o.lines = o.lines.filter((x) => x !== l);
  const item = { n: l.name + (l.size ? ' (' + l.size + ')' : ''), q: -q, s: l.st || 'Kitchen', note: l.note };
  o.lastCancelReason = reason; o.lastCancelApprovedBy = ap;
  o.kotBatches = (o.kotBatches || []).concat([{ time: now(), items: [item], cancel: true }]); o.kcx = now();
  await save('voidlog', { order: o.id, no: o.no, item: l.name, qty: q, reason, by: S.user.email || S.user.id, approvedBy: ap.name, at: now() });
  await deduAndWasteLine(l, q, reason);
  await persist(o);
  if (cfg().autoKot !== false) prn(kotHtml(o, [item], { head: 'Cancelled', cancel: true }));
  toast('Cancelled ' + q + ' × ' + l.name); render();
}

// ---------- order actions ----------
async function holdOrder(o) { if (!o.lines.length) return; await persist(o); S.cur = null; closeTicketSheet(); toast('Order held' + (o.table ? ' on ' + tn(o.table) : '')); render(); }
async function sendKot(o = S.cur) {
  freshCur();
  if (!unsent(o)) return toast('Nothing new to send');
  if (o.type === 'Dine-in' && isRestaurant() && !o.table && L('table').length) { const t = await pickTableFor(o, 'Which table?'); if (t === undefined) return; }
  if (!o.no) o.no = await nextNo();
  if (cfg().hwToken && o.type !== 'Dine-in' && !o.token) { o.token = nextToken(); o.tokenDay = today(); }
  const kno = await nextKot(), n = mk(o, kno);
  await persist(o);
  await save('kotlog', { orderId: o.id, orderNo: o.no, kotNo: kno, type: o.type, table: o.table, cust: o.cust, items: n, createdAt: now() }, uid());
  if (cfg().autoKot !== false) prn(kotHtml(o, n, { no: kno }));
  toast('Sent to kitchen · KOT #' + kno); render();
}
function orderMenu(o) {
  const t = tot(o), sent = sentQty(o) > 0, dine = o.type === 'Dine-in' && isRestaurant();
  const s = sheet({ title: o.no ? 'Order ' + o.no : 'This order', narrow: true, body: h('div', { class: 'stack' },
    h('div', { class: 'list' },
      liRow({ ic: 'percent', title: o.disc && !o.complimentary ? 'Change discount' : 'Discount', chev: true, onclick: () => { s.close(); discountSheet(o); } }),
      liRow({ ic: 'tag', tone: 'orange', title: o.coupon ? 'Coupon ' + o.coupon : 'Apply a coupon', chev: true, onclick: () => { s.close(); couponSheet(o); } }),
      liRow({ ic: 'gift', tone: 'purple', title: o.complimentary ? 'Complimentary (on)' : 'Complimentary bill', chev: true, onclick: () => { s.close(); compSheet(o); } })),
    h('div', { class: 'list' },
      liRow({ ic: 'person', tone: 'blue', title: 'Customer details', sub: (o.cust || {}).name || null, chev: true, onclick: () => { s.close(); customerSheet(o); } }),
      liRow({ ic: 'note', tone: 'gray', title: o.comment ? 'Order note' : 'Add a note', sub: o.comment || null, chev: true, onclick: () => { s.close(); commentSheet(o); } }),
      !isRetail() ? liRow({ ic: 'clock', tone: 'teal', title: 'Schedule for later', sub: o.adv ? advLabel(o.adv) : null, chev: true, onclick: () => { s.close(); scheduleSheet(o); } }) : null,
      dine ? liRow({ ic: 'staff', tone: 'green', title: o.captain ? 'Served by ' + o.captain.name : 'Assign captain', chev: true, onclick: () => { s.close(); captainSheet(o); } }) : null,
      o.type === 'Delivery' ? liRow({ ic: 'truck', tone: 'blue', title: 'Delivery details', chev: true, onclick: () => { s.close(); deliverySheet(o); } }) : null),
    dine && o.lines.length ? h('div', { class: 'list' },
      liRow({ ic: 'move', tone: 'gray', title: o.table ? 'Move to another table' : 'Choose a table', chev: true, onclick: () => { s.close(); pickTableFor(o, o.table ? 'Move ' + tn(o.table) + ' to' : 'Choose a table', o.table && rec(o.id) ? 'move' : 'assign'); } }),
      o.table ? liRow({ ic: 'merge', tone: 'gray', title: 'Merge another table into this', chev: true, onclick: () => { s.close(); mergeIntoSheet(o); } }) : null,
      liRow({ ic: 'split', tone: 'gray', title: 'Split bill', chev: true, onclick: () => { s.close(); splitSheet(o); } })) : !dine && o.lines.length && o.no ? h('div', { class: 'list' }, liRow({ ic: 'split', tone: 'gray', title: 'Split bill', chev: true, onclick: () => { s.close(); splitSheet(o); } })) : null,
    o.lines.length ? h('div', { class: 'list' },
      liRow({ ic: 'printer', tone: 'gray', title: 'Print bill for the guest', sub: 'Provisional, before payment', chev: true, onclick: () => { s.close(); o.t = t; prnInv(rcpt(o, false, true)); } }),
      sent ? liRow({ ic: 'kot', tone: 'orange', title: 'Reprint kitchen ticket', chev: true, onclick: () => { s.close(); reprintKot(o); } }) : null) : null,
    h('div', { class: 'list' }, liRow({ ic: 'trash', tone: 'red', title: o.no ? 'Cancel order' : 'Clear order', onclick: () => { s.close(); cancelOrder(o); } }))) });
}
async function cancelOrder(o) {
  if (!o.no || !rec(o.id)) { if (o.lines.length && !(await confirmBox('Clear this order?', 'Nothing has been saved for it yet.', 'Clear', true))) return; S.cur = null; closeTicketSheet(); return render(); }
  const sent = sentQty(rec(o.id) || o) > 0;
  if (!(await confirmBox('Cancel order ' + o.no + '?', sent ? 'The kitchen already has items from it. They will be logged as cancelled.' : 'It will be marked as cancelled.', 'Cancel order', true))) return;
  const reason = await pickReason('Why cancel this order?'); if (!reason) return;
  let ap = null;
  if (sent) { ap = await approve('void', o.id, 'Cancel order ' + o.no + ' after it reached the kitchen'); if (!ap) return; }
  freshCur();
  const c = structuredClone(rec(o.id) || o); c.status = 'void'; c.voidReason = reason; if (ap) c.voidApprovedBy = ap; c.voidAt = now();
  await save('order', c, c.id); await save('voidlog', { order: c.id, no: c.no, reason, by: S.user.email || S.user.id, approvedBy: ap ? ap.name : null, at: now() });
  if (sent && cfg().autoKot !== false) { const items = c.lines.filter((l) => l.sent).map((l) => ({ n: l.name + (l.size ? ' (' + l.size + ')' : ''), q: -l.sent, s: l.st || 'Kitchen' })); if (items.length) prn(kotHtml(c, items, { head: 'Order cancelled', cancel: true })); }
  if (c.table) { const tb = L('table').find((x) => x.id === c.table); if (tb && sent) await save('table', { ...tb, cleaned: false }, tb.id); }
  S.cur = null; closeTicketSheet(); toast('Order cancelled'); render();
}
function reprintKot(o) {
  const b = (o.kotBatches || []).filter((x) => !x.cancel);
  if (!b.length) return toast('No kitchen ticket on this order yet', { err: true });
  const items = b.flatMap((x) => x.items);
  prn(kotHtml(o, items, { head: 'Reprint', no: b.map((x) => x.no).filter(Boolean).join(', ') }));
}

// discount, coupon, complimentary
function discountSheet(o) {
  if (o.complimentary) return compSheet(o);
  let kind = o.disc && o.disc.src === 'manual' ? o.disc.t : '%', reason = (o.disc && o.disc.reason) || '';
  const lim = +cfg().maxDiscountPct || 0;
  const val = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 0, value: o.disc && o.disc.src === 'manual' ? o.disc.v : '', placeholder: '0', 'aria-label': 'Discount', autofocus: true });
  const quick = h('div', { class: 'chips' });
  const drawQuick = () => quick.replaceChildren(...(kind === '%' ? [5, 10, 15, 20, 25] : [50, 100, 200, 500]).map((v) => h('button', { class: 'chip', onclick: () => { val.value = v; } }, kind === '%' ? v + '%' : inr(v))));
  drawQuick();
  const reasons = L('reason').map((r) => r.name).filter(Boolean);
  const rsn = h('input', { class: 'input', value: reason, placeholder: 'e.g. Regular guest', list: 'dreasons', 'aria-label': 'Reason' });
  const body = h('div', { class: 'stack s20' },
    seg([['%', 'Percent'], ['₹', 'Amount']], kind, (v) => { kind = v; drawQuick(); }),
    field(kind === '%' ? 'Discount' : 'Discount', val), quick,
    field('Reason', rsn), h('datalist', { id: 'dreasons' }, reasons.map((r) => h('option', { value: r }))),
    !can('m') ? h('div', { class: 'hint' }, lim > 0 ? 'Up to ' + lim + '% without a manager.' : 'A manager approves discounts.') : null);
  sheet({ title: 'Discount', narrow: true, closeLabel: 'Cancel', body, actions: [
    o.disc ? { label: 'Remove', danger: true, run: () => { o.disc = null; o.coupon = null; o.loyaltyRedeemed = 0; render(); } } : null,
    { label: 'Apply', primary: true, run: async () => {
      const v = +val.value; if (!(v > 0)) { toast('Enter a discount', { err: true }); return false; }
      if (kind === '%' && v > 100) { toast('Up to 100%', { err: true }); return false; }
      let ap = null;
      if (discNeedsManager(o, v, kind)) { ap = await approve('discount', o.id, (kind === '%' ? v + '%' : inr(v)) + ' off ' + inr(tot(o).sub)); if (!ap) return false; }
      o.disc = { t: kind, v, src: 'manual', reason: rsn.value.trim() || undefined, by: S.user.id, approvedBy: ap || undefined };
      o.coupon = null; o.loyaltyRedeemed = 0; render();
    } }] });
}
function couponSheet(o) {
  const code = h('input', { class: 'input', placeholder: 'Coupon code', value: o.coupon || '', autocapitalize: 'characters', 'aria-label': 'Coupon code', autofocus: true });
  const msg = h('div', { class: 'hint' });
  sheet({ title: 'Coupon', narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack' }, code, msg), actions: [
    o.coupon ? { label: 'Remove', danger: true, run: () => { o.coupon = null; o.disc = null; render(); } } : null,
    { label: 'Apply', primary: true, run: () => {
      const r = couponCheck(code.value, o); if (r.err) { msg.className = 'hint err'; msg.textContent = r.err; return false; }
      o.coupon = r.c.code; o.disc = { t: r.c.type, v: +r.c.value, src: 'coupon' }; o.loyaltyRedeemed = 0; o.complimentary = false; render(); toast('Coupon ' + r.c.code + ' applied');
    } }] });
}
async function compSheet(o) {
  if (o.complimentary) { if (await confirmBox('Remove complimentary?', 'The bill goes back to its normal amount.', 'Remove')) { o.complimentary = false; o.compReason = null; o.compApprovedBy = null; render(); } return; }
  const reason = await pickReason('Why is this bill complimentary?'); if (!reason) return;
  const ap = await approve('comp', o.id, 'Complimentary bill of ' + inr(tot(o).sub)); if (!ap) return;
  o.complimentary = true; o.compReason = reason; o.compApprovedBy = ap; o.disc = null; o.coupon = null; o.loyaltyRedeemed = 0; render();
}

// customer, note, schedule, captain, guests, delivery
function customerSheet(o) {
  const ph = digits((o.cust || {}).phone), prof = (ph && rec(ph)) || {};
  const f = { name: input({ value: (o.cust || {}).name || prof.name || '', placeholder: 'Name' }), phone: input({ value: (o.cust || {}).phone || '', placeholder: '10-digit mobile', type: 'tel', mode: 'tel' }),
    gst: input({ value: (o.cust || {}).gst || prof.gst || '', placeholder: '15-character GSTIN (business bills)', max: 15 }), email: input({ value: prof.email || '', placeholder: 'Email', type: 'email' }),
    dob: input({ value: prof.dob || '', type: 'date' }), ann: input({ value: prof.anniversary || '', type: 'date' }), tags: input({ value: (prof.tags || []).join(', '), placeholder: 'Regular, VIP' }) };
  let optOut = !!prof.optOut, fav = !!prof.favorite;
  const hist = ph.length >= 10 ? loyaltyOf(ph, o.id) : null;
  sheet({ title: 'Customer', closeLabel: 'Cancel', body: h('div', { class: 'stack s20' },
    hist && hist.visits ? h('div', { class: 'kpis' }, h('div', { class: 'kpi' }, h('b', null, String(hist.visits)), h('span', null, 'Visits')), h('div', { class: 'kpi' }, h('b', null, inr(hist.lifetime)), h('span', null, 'Spent')), h('div', { class: 'kpi' }, h('b', null, String(hist.points)), h('span', null, 'Points'))) : null,
    h('div', { class: 'grid2 stack-phone' }, field('Name', f.name), field('Phone', f.phone)), field('GSTIN', f.gst),
    h('div', { class: 'grid2 stack-phone' }, field('Email', f.email), field('Tags', f.tags)), h('div', { class: 'grid2' }, field('Birthday', f.dob), field('Anniversary', f.ann)),
    h('div', { class: 'list' }, liRow({ title: 'Favourite guest', right: switchEl(fav, (v) => (fav = v)) }), liRow({ title: 'No marketing messages', right: switchEl(optOut, (v) => (optOut = v)) }))),
    actions: [{ label: 'Save', primary: true, run: async () => {
      const gst = f.gst.value.trim().toUpperCase(); if (gst && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gst)) { toast('A GSTIN has 15 characters, starting with the 2-digit state code', { err: true }); return false; }
      o.cust = { name: f.name.value.trim(), phone: f.phone.value.trim(), gst: gst || undefined };
      const p = digits(o.cust.phone);
      if (p.length >= 10) await save('customer', { ...prof, phone: p, name: o.cust.name || prof.name, gst: gst || null, email: f.email.value.trim(), dob: f.dob.value || null, anniversary: f.ann.value || null, tags: f.tags.value.split(',').map((x) => x.trim()).filter(Boolean), optOut, favorite: fav }, p);
      render();
    } }] });
}
async function commentSheet(o) { const v = await promptBox('Order note', { value: o.comment || '', placeholder: 'Printed on the kitchen ticket and the bill' }); if (v == null) return; o.comment = v.trim() || undefined; render(); }
const advLabel = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const localIso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function scheduleSheet(o) {
  const dt = h('input', { class: 'input', type: 'datetime-local', value: o.adv ? localIso(new Date(o.adv)) : localIso(new Date(Date.now() + 3600000)), min: localIso(new Date()), 'aria-label': 'When' });
  sheet({ title: 'Schedule for later', narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack' }, h('p', { class: 'sub' }, 'Advance orders wait under Orders until their time. Hold the order after scheduling it.'), dt),
    actions: [o.adv ? { label: 'Clear', danger: true, run: () => { o.adv = null; render(); } } : null, { label: 'Save', primary: true, run: () => { if (!dt.value) return false; o.adv = new Date(dt.value).toISOString(); render(); } }] });
}
function captainSheet(o) {
  const s = sheet({ title: 'Served by', narrow: true, body: h('div', { class: 'list' }, STAFF_LIST.length ? STAFF_LIST.map((p) => liRow({ ic: 'person', tone: 'gray', title: p.name || p.email, right: o.captain && o.captain.id === p.id ? h('span', { style: { color: 'var(--accent-text)' } }, icon('check', 20)) : null, onclick: () => { o.captain = { id: p.id, name: p.name || p.email }; s.close(); render(); } })) : liRow({ title: 'No staff found' }),
    o.captain ? liRow({ title: 'Nobody', onclick: () => { o.captain = null; s.close(); render(); } }) : null) });
}
function coversSheet(o, then) {
  let n = o.covers || 2;
  const chips = h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, [1, 2, 3, 4, 5, 6, 8, 10, 12].map((v) => h('button', { class: 'chip', onclick: () => { o.covers = v; s.close(); render(); then && then(); } }, String(v))));
  const s = sheet({ title: 'How many guests?', narrow: true, closeLabel: 'Skip', onClose: () => {}, body: h('div', { class: 'stack s20' }, chips, h('div', { class: 'row sp' }, h('span', { class: 'lbl' }, 'Or'), stepper(n, (v) => (n = v), 1, 60))),
    actions: [{ label: 'Done', primary: true, run: () => { o.covers = n; render(); then && then(); } }] });
}
function deliverySheet(o) {
  const addr = textarea({ value: o.addr || '', placeholder: 'House, street, area, landmark' }), eta = input({ type: 'time', value: o.eta || '' });
  let src = o.src || 'Phone', rider = o.rider ? o.rider.id || '' : '';
  const riderSel = selectEl([['', 'Not assigned'], ...STAFF_LIST.map((p) => [p.id, p.name || p.email])], rider, (e) => (rider = e.target.value));
  sheet({ title: 'Delivery details', closeLabel: 'Cancel', body: h('div', { class: 'stack s20' },
    field('Order from', seg(DELIVERY_SOURCES.map((x) => [x, x]), src, (v) => (src = v))), field('Address', addr), h('div', { class: 'grid2' }, field('Promised by', eta), field('Rider', riderSel)),
    h('div', { class: 'hint' }, cfg().deliveryCharge ? 'Delivery charge ' + inr(cfg().deliveryCharge) + ' is added to the bill.' : '')),
    actions: [{ label: 'Save', primary: true, run: () => { o.addr = addr.value.trim() || undefined; o.eta = eta.value || undefined; o.src = src; o.rider = rider ? { id: rider, name: staffName(rider) } : undefined; render(); } }] });
}

// barcode scanners type the code and press Enter (Settings -> Hardware -> Barcode scanner)
let scanBuf = '', scanAt = 0;
addEventListener('keydown', (e) => {
  if (S.tab !== 'sell' || !cfg().hwBarcode || document.querySelector('.ov')) return;
  if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
  const t = Date.now(); if (t - scanAt > 300) scanBuf = ''; scanAt = t;
  if (e.key === 'Enter') {
    e.preventDefault(); const code = scanBuf; scanBuf = ''; if (code.length < 3) return;
    let it = L('item').find((x) => x.barcode && x.barcode === code), vr = null;
    if (!it) for (const x of L('item')) { const f = (x.variants || []).find((v) => v.barcode && v.barcode === code); if (f) { it = x; vr = f; break; } }
    if (!it) return toast('No item with barcode ' + code, { err: true });
    if (itemOff(it)) return toast(it.name + ' is sold out', { err: true });
    if (vr) addLine(it, vr.size + (vr.color ? ' / ' + vr.color : ''), it.price, undefined, { size: vr.size, color: vr.color }); else addItemFlow(it);
  } else if (e.key.length === 1) scanBuf += e.key;
});
