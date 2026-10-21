/* AUZsStyle: Sell (the till). Left/top: styles grid with category chips + barcode/search. Right (desktop) or a bottom bar
   (phone): the bill. Pick a style -> choose colour + size (stock shown) -> it joins the bill. */
'use strict';
const BILL = { lines: [], customer: null, custName: '', custPhone: '', billDiscPct: 0, billDiscAmt: 0, redeem: 0, holdId: null, note: '', exchange: 0 };
const UI = { q: '', cat: 'All' };
const newBill = () => { Object.assign(BILL, { lines: [], customer: null, custName: '', custPhone: '', billDiscPct: 0, billDiscAmt: 0, redeem: 0, holdId: null, note: '', exchange: 0 }); };
const billCalc = () => calcBill(BILL.lines.map((l) => ({ unit: l.price, qty: l.qty, discPct: l.discPct, discAmt: l.discAmt, taxPct: l.taxPct })), { billDiscPct: BILL.billDiscPct, billDiscAmt: BILL.billDiscAmt });
const unitCount = () => BILL.lines.reduce((a, l) => a + l.qty, 0);

function addLine(style, v, q = 1) {
  const have = BILL.lines.find((l) => l.variantId === v.id && !l.custom);
  const inCart = (have ? have.qty : 0) + q;
  if (!S.ctx.settings.allowNegativeStock && inCart > v.stock) { toast(`${style.name} ${v.colour} ${v.size}: ${t('only')} ${Math.max(v.stock, 0)} ${t('in stock')}`, { err: true }); beep(false); return false; }
  if (have) have.qty = inCart;
  else BILL.lines.push({ variantId: v.id, styleId: style.id, name: style.name, colour: v.colour, size: v.size, barcode: v.barcode, price: v.price, mrp: style.mrp, taxPct: style.taxPct, qty: q, discPct: 0, discAmt: 0, stock: v.stock });
  beep(true); return true;
}
let actx;
function beep(ok) {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
    o.frequency.value = ok ? 1040 : 220; g.gain.value = .06; o.start(); o.stop(actx.currentTime + (ok ? .07 : .22)); } catch { /* no audio */ }
}

page('sell', {
  title: 'Sell', perm: 'sty_sell', pos: true,
  async render(v) {
    v.header({ title: t('Sell'), noLarge: true, actions: [{ label: t('Held bills'), icon: 'clock', run: heldSheet }, { label: t('Shift'), icon: 'cash', run: shiftSheet }] });
    const root = v.root; root.classList.add('sellpage');
    clear(root).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '40px auto' } }));
    try { await loadCatalog(); } catch (e) { return clear(root).append(empty('cloudOff', t('Could not load the catalogue'), e.message, h('button', { class: 'btn fill', onclick: () => v.refresh() }, t('Try again')))); }
    const cats = ['All', ...[...new Set(S.cat.filter((s) => s.active !== false).map((s) => s.category))].sort()];
    const grid = h('div', { class: 'sgrid' });
    const cartHost = h('aside', { class: 'cartpane' });
    const bar = h('button', { class: 'cartbar', type: 'button', onclick: () => cartSheet() });
    const scanBtn = window.auzScanner ? h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Scan'), onclick: () => scanWith((c) => { onCode(c); }) }, icon('camera', 20)) : null;
    const sf = searchField(t('Search or scan a tag'), (val) => { UI.q = val; paintGrid(); }, UI.q);
    sf.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const val = sf.input.value.trim(); if (val && onCode(val, true)) { sf.input.value = ''; UI.q = ''; paintGrid(); } } });
    const chips = h('div', { class: 'chips' });
    const filterHost = h('span');
    const paintFilter = () => { clear(filterHost).append(filterButton(() => { paintFilter(); paintGrid(); })); };
    function paintChips() { clear(chips).append(...cats.map((c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(UI.cat === c), onclick: () => { UI.cat = c; paintChips(); paintGrid(); } }, c === 'All' ? t('All') : c))); }
    function onCode(code, fromEnter) {
      const f = findBarcode(code);
      if (f) { if (addLine(f.style, f.variant)) { paintCart(); } return true; }
      const sc = findStyleCode(code); if (sc) { pickVariant(sc); return true; }
      if (fromEnter) return false;
      toast(t('No item with that code'), { err: true }); beep(false); return false;
    }
    function priceRange(s) { const ps = s.variants.map((x) => x.price); const a = Math.min(...ps), b = Math.max(...ps); return a === b ? inr(a) : inr(a) + '+'; }
    function paintGrid() {
      const q = UI.q.trim().toLowerCase();
      let list = S.cat.filter((s) => s.active !== false && (UI.cat === 'All' || s.category === UI.cat) && styleMatches(s));
      if (q) list = list.filter((s) => (s.name + ' ' + (s.brand || '') + ' ' + s.category + ' ' + (s.code || '') + ' ' + (s.subcategory || '') + ' ' + (s.fabric || '') + ' ' + (s.collection || '')).toLowerCase().includes(q) || s.variants.some((x) => x.barcode === q || (x.sku || '').toLowerCase() === q));
      clear(grid);
      if (!list.length) { grid.append(empty('shirt', S.cat.length ? t('No match') : t('No styles yet'), S.cat.length ? '' : t('Add your first style in Stock.'), !S.cat.length && can('sty_manage') ? h('button', { class: 'btn fill', onclick: () => go('stock') }, t('Go to Stock')) : null)); return; }
      list.slice(0, 160).forEach((s) => {
        const st = styleStock(s); const pics = [s.photoUrl, ...(s.photos || [])].filter(Boolean);
        grid.append(h('div', { class: 'scard' + (st <= 0 ? ' out' : '') },
          h('button', { class: 'pic', type: 'button', 'aria-label': s.name, onclick: () => pickVariant(s) },
            pics.length ? h('img', { src: pics[0], alt: '', loading: 'lazy' }) : h('span', { class: 'nopic' }, icon('shirt', 34)),
            st <= 0 ? h('span', { class: 'pill' }, t('Sold out')) : null,
            pics.length > 1 ? h('span', { class: 'pdots' }, pics.slice(0, 3).map((_, i) => h('i', { class: i === 0 ? 'on' : '' }))) : null),
          h('div', { class: 'meta' }, h('div', { class: 'mt' }, h('div', { class: 'nm' }, s.name), h('button', { class: 'plus', type: 'button', 'aria-label': t('Add') + ' ' + s.name, onclick: () => pickVariant(s) }, icon('plus', 18))),
            h('div', { class: 'pr' }, h('span', { class: 'num' }, priceRange(s)), st > 0 && st <= 3 ? h('span', { class: 'stk lo' }, st + ' ' + t('left')) : null))));
      });
    }
    function pickVariant(s) {
      const cols = [...new Set(s.variants.filter((x) => x.active !== false).map((x) => x.colour))];
      if (s.variants.filter((x) => x.active !== false).length === 1) { const only = s.variants.find((x) => x.active !== false); if (addLine(s, only)) { paintCart(); } return; }
      let col = cols.find((c) => s.variants.some((x) => x.colour === c && x.stock > 0)) ?? cols[0];
      const body = h('div', { class: 'grid' });
      const paint = () => {
        const vs = s.variants.filter((x) => x.colour === col && x.active !== false).sort(byRank);
        clear(body).append(
          (s.photos || []).length ? h('div', { class: 'gal' }, [s.photoUrl, ...s.photos].filter(Boolean).map((u) => h('img', { src: u, alt: '', loading: 'lazy' }))) : null,
          h('div', { class: 'vp-h' }, h('div', { class: 'ph sm' }, s.photoUrl ? h('img', { src: s.photoUrl, alt: '' }) : icon('shirt', 24)), h('div', null, h('b', null, s.name), h('div', { class: 'muted small' }, [s.brand, s.category, s.fabric].filter(Boolean).join(' · ')), h('div', { class: 'num' }, inr(s.price), s.mrp > s.price ? h('s', { class: 'muted small', style: { marginLeft: '6px' } }, inr(s.mrp)) : null))),
          cols.length > 1 || (cols[0] || '') ? h('div', null, h('div', { class: 'cap' }, t('Colour')), h('div', { class: 'chips wrap' }, cols.map((c) => { const n = s.variants.filter((x) => x.colour === c).reduce((a, x) => a + x.stock, 0); return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(c === col), onclick: () => { col = c; paint(); } }, colourDot(c, 14), c || '—', h('span', { class: 'muted small' }, n)); }))) : null,
          h('div', null, h('div', { class: 'cap' }, t('Size')), h('div', { class: 'sizes' }, vs.map((x) => {
            const dis = x.stock <= 0 && !S.ctx.settings.allowNegativeStock;
            return h('button', { class: 'sz' + (dis ? ' dis' : '') + (x.stock > 0 && x.stock <= (x.reorderAt || 2) ? ' lo' : ''), type: 'button', disabled: dis, onclick: () => { if (addLine(s, x)) { paintCart(); ps.close(); } } }, h('b', null, x.size || '—'), h('span', null, x.stock));
          }))));
      };
      const ps = sheet({ title: s.name, closeLabel: t('Done'), body }); paint();
    }
    // ---- the bill pane ----
    function paintCart() {
      const c = billCalc();
      clear(cartHost).append(billPanel(c));
      bar.replaceChildren(h('span', { class: 'bc' }, icon('tag', 18), unitCount() + ' ' + t('Units')), h('span', { class: 'grow' }), h('b', { class: 'num' }, inr(c.total)), h('span', { class: 'go' }, t('Bill'), icon('chevU', 16)));
      bar.classList.toggle('hidden', !BILL.lines.length);
    }
    function billPanel(c, inSheet) {
      const lines = BILL.lines.map((l, i) => h('div', { class: 'bl' },
        h('div', { class: 'grow', onclick: () => lineSheet(i) }, h('div', { class: 't' }, l.name), h('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + (l.discPct ? ' · -' + l.discPct + '%' : l.discAmt ? ' · -' + inr(l.discAmt) : ''))),
        h('div', { class: 'stp' }, h('button', { type: 'button', 'aria-label': '-', onclick: () => { if (l.qty > 1) l.qty--; else BILL.lines.splice(i, 1); paintCart(); inSheet && inSheet(); } }, icon('minus', 16)), h('b', { class: 'num' }, l.qty),
          h('button', { type: 'button', 'aria-label': '+', onclick: () => { const vv = allVariants().find((x) => x.id === l.variantId); if (vv && addLine(vv.style, vv)) { paintCart(); inSheet && inSheet(); } } }, icon('plus', 16))),
        h('div', { class: 'amt num' }, inr(c.lines[i].net))));
      return h('div', { class: 'bill' },
        BILL.exchange > 0 ? h('div', { class: 'exbar' }, icon('swap', 16), t('Exchange credit') + ' ' + inr(BILL.exchange)) : null,
        h('div', { class: 'bill-h' }, h('b', null, t('Bill')), h('span', { class: 'muted small' }, unitCount() + ' ' + t('Units')), h('span', { class: 'grow' }), BILL.lines.length ? h('button', { class: 'btn plain sm', type: 'button', onclick: async () => { if (await confirmBox(t('Clear'), t('Remove everything from this bill?'), t('Clear'), true)) { newBill(); paintCart(); inSheet && inSheet(true); } } }, t('Clear')) : null),
        BILL.customer
          ? h('button', { class: 'cust', type: 'button', onclick: () => customerPicker((cu) => { BILL.customer = cu; paintCart(); inSheet && inSheet(); }) }, icon('user', 18), h('span', { class: 'grow' }, BILL.customer.name + (BILL.customer.phone ? ' · ' + BILL.customer.phone : '')), h('span', { class: 'muted small' }, (BILL.customer.points || 0) + ' ' + t('Points')), h('span', { class: 'cust-x', role: 'button', 'aria-label': t('Clear'), onclick: (e) => { e.stopPropagation(); BILL.customer = null; paintCart(); inSheet && inSheet(); } }, icon('x', 14)))
          : h('div', { class: 'custrow' },
            h('input', { class: 'input cin', placeholder: t('Customer name'), value: BILL.custName, 'aria-label': t('Customer name'), autocomplete: 'off', oninput: (e) => { BILL.custName = e.target.value; } }),
            h('input', { class: 'input cin', placeholder: t('Phone'), value: BILL.custPhone, inputmode: 'tel', 'aria-label': t('Phone'), autocomplete: 'off', oninput: (e) => { BILL.custPhone = e.target.value; } }),
            h('button', { class: 'btn icon sm', type: 'button', 'aria-label': t('Customer'), title: t('Find a customer'), onclick: () => customerPicker((cu) => { BILL.customer = cu; paintCart(); inSheet && inSheet(); }) }, icon('search', 16))),
        BILL.lines.length ? h('div', { class: 'blines' }, lines, inSheet ? null : quickAdd()) : h('div', { class: 'bempty' }, icon('tag', 26), h('div', null, t('Cart is empty')), h('div', { class: 'small' }, t('Tap a style or scan a tag'))),
        BILL.lines.length ? h('div', { class: 'tots' },
          trow(t('Subtotal'), inr(c.subtotal)), c.discount > 0 ? trow(t('Discount'), '-' + inr(c.discount), 'g') : null, trow(t('Tax') + ' (incl.)', inr(c.tax)), c.rounding ? trow(t('Round off'), inr(c.rounding)) : null,
          h('button', { class: 'btn wide sm', type: 'button', onclick: () => discountSheet(() => { paintCart(); inSheet && inSheet(); }) }, icon('tag', 16), t('Discount'))) : null,
        BILL.lines.length ? h('div', { class: 'payrow' }, h('div', { class: 'tot' }, h('span', null, t('Total')), h('b', { class: 'num' }, inr(c.total))),
          h('div', { class: 'row', style: { gap: '8px' } }, h('button', { class: 'btn', type: 'button', onclick: () => holdBill(() => { paintCart(); inSheet && inSheet(true); }) }, t('Hold')), h('button', { class: 'btn fill grow', type: 'button', onclick: async () => { await resolveTypedCustomer(); inSheet && inSheet('close'); paySheet(billCalc(), () => { paintCart(); }); } }, t('Pay') + ' ' + inr(c.total)))) : null);
    }
    // fills the free space under the lines with a few styles to add next
    function quickAdd() {
      const picks = (S.cat || []).filter((x) => x.active !== false && styleStock(x) > 0).slice(0, 8);
      if (!picks.length) return null;
      return h('div', { class: 'quick' }, h('div', { class: 'cap' }, t('Add more')), h('div', { class: 'chips wrap' }, picks.map((x) => h('button', { class: 'chip', type: 'button', onclick: () => pickVariant(x) }, x.name))));
    }
    const trow = (a, b, cls) => h('div', { class: 'tr' + (cls ? ' ' + cls : '') }, h('span', null, a), h('span', { class: 'num' }, b));
    function cartSheet() {
      let sh; const body = h('div');
      const rerender = (flag) => { if (flag === 'close' || flag === true) { sh.close(); return; } clear(body).append(billPanel(billCalc(), rerender)); };
      const rr = () => { if (body.isConnected) rerender(); };
      window.addEventListener('sty:cartchanged', rr);
      sh = sheet({ title: t('Bill'), closeLabel: t('Done'), full: true, body, onClose: () => window.removeEventListener('sty:cartchanged', rr) }); rerender();
    }
    function lineSheet(i) {
      const l = BILL.lines[i]; if (!l) return;
      const pr = input({ type: 'number', value: l.price, mode: 'decimal' }), dp = input({ type: 'number', value: l.discPct || '', mode: 'decimal', placeholder: '%' }), da = input({ type: 'number', value: l.discAmt || '', mode: 'decimal', placeholder: '₹' });
      const sh = sheet({ title: l.name, body: h('div', { class: 'grid' }, h('div', { class: 'muted' }, [l.colour, l.size].filter(Boolean).join(' · ')),
        can('sty_manage') ? field(t('Price'), pr) : null, h('div', { class: 'two' }, field(t('Discount') + ' %', dp), field(t('Discount') + ' ₹', da)),
        h('button', { class: 'btn danger wide', type: 'button', onclick: () => { BILL.lines.splice(i, 1); sh.close(); window.dispatchEvent(new Event('sty:cartchanged')); } }, icon('trash', 18), t('Remove'))),
        actions: [{ label: t('Save'), primary: true, onclick: (close) => { if (can('sty_manage')) l.price = N(pr.value) || l.price; l.discPct = N(dp.value); l.discAmt = l.discPct ? 0 : N(da.value); close(); window.dispatchEvent(new Event('sty:cartchanged')); } }] });
    }
    window.addEventListener('sty:cartchanged', paintCart);
    cleanupHook(v, () => window.removeEventListener('sty:cartchanged', paintCart));
    paintChips(); paintFilter(); paintGrid(); paintCart();
    clear(root).append(h('div', { class: 'sell-l', 'data-title': t('All Products') }, h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'grow' }, sf), filterHost, scanBtn), chips, grid), cartHost, bar);
    if (isDesk()) setTimeout(() => sf.input.focus(), 50);
    // hardware barcode scanners type the code fast and press Enter, even when the search box is not focused
    let buf = '', last = 0;
    const key = (e) => {
      if (e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const now = Date.now(); if (now - last > 80) buf = ''; last = now;
      if (e.key === 'Enter') { if (buf.length >= 4) { if (onCode(buf, true)) paintCart(); } buf = ''; } else if (e.key.length === 1) buf += e.key;
    };
    document.addEventListener('keydown', key); cleanupHook(v, () => document.removeEventListener('keydown', key));
  },
});
function cleanupHook(v, f) { v.onLeave(f); }

function discountSheet(done) {
  const st = S.ctx.settings;
  const dp = input({ type: 'number', value: BILL.billDiscPct || '', mode: 'decimal', placeholder: '%' }), da = input({ type: 'number', value: BILL.billDiscAmt || '', mode: 'decimal', placeholder: '₹' });
  const pts = BILL.customer && BILL.customer.points > 0 ? input({ type: 'number', value: BILL.redeem || '', mode: 'numeric', placeholder: '0' }) : null;
  sheet({ title: t('Discount'), body: h('div', { class: 'grid' }, h('div', { class: 'two' }, field(t('Bill discount') + ' %', dp), field(t('Bill discount') + ' ₹', da)),
    can('sty_manage') ? null : h('div', { class: 'muted small' }, t('Above') + ' ' + st.maxDiscountPct + '% ' + t('needs a manager')),
    pts ? field(t('Use points') + ' (' + BILL.customer.points + ' ' + t('available') + ', ₹' + st.loyaltyPointValue + ' ' + t('each') + ')', pts) : null),
    actions: [{ label: t('Apply'), primary: true, onclick: (close) => { BILL.billDiscPct = N(dp.value); BILL.billDiscAmt = BILL.billDiscPct ? 0 : N(da.value); BILL.redeem = pts ? Math.min(Math.floor(N(pts.value)), BILL.customer.points) : 0; close(); done(); } }] });
}

async function holdBill(done) {
  const label = await promptLabel();
  if (label === null) return;
  const id = BILL.holdId || uid();
  try {
    await api('sty_hold_save', { p: { id, branchId: S.branch, label: label || (BILL.customer ? BILL.customer.name : 'Trial room'), lines: BILL.lines } });
    toast(t('Bill held')); newBill(); done();
  } catch (e) { fail(e); }
}
function promptLabel() {
  return new Promise((res) => {
    const i = input({ placeholder: t('Name or note, e.g. Trial room 2') });
    const s = sheet({ title: t('Hold this bill'), onClose: (v) => { if (v === undefined) res(null); }, body: h('div', { class: 'grid' }, field(t('Label'), i)), actions: [{ label: t('Hold'), primary: true, onclick: (close) => { res(i.value.trim()); close('ok'); } }] });
  });
}
async function heldSheet() {
  let list = []; try { list = await api('sty_hold_list') || []; } catch (e) { return fail(e); }
  const body = h('div', { class: 'list' }, list.length ? list.map((x) => liRow({ icon: 'clock', title: x.label || t('Held bill'), sub: (x.lines || []).reduce((a, l) => a + l.qty, 0) + ' ' + t('Units') + ' · ' + fmtDT(x.at), chevron: true,
    onclick: () => { if (BILL.lines.length) { toast(t('Finish or hold the current bill first'), { err: true }); return; } BILL.lines = x.lines || []; BILL.holdId = x.id; s.close(); window.dispatchEvent(new Event('sty:cartchanged')); toast(t('Bill resumed')); } })) : [empty('clock', t('No held bills'))]);
  const s = sheet({ title: t('Held bills'), closeLabel: t('Done'), body });
}

// ---- payment ----
function paySheet(c, done) {
  const st = S.ctx.settings; const cust = BILL.customer;
  const redeemVal = cust ? Math.min(r2(BILL.redeem * st.loyaltyPointValue), c.total) : 0;
  const due0 = r2(c.total - redeemVal);
  const MODES = [['cash', t('Cash')], ['upi', t('UPI')], ['card', t('Card')]];
  if (BILL.exchange > 0) MODES.unshift(['exchange', t('Exchange credit')]);
  if (cust && cust.credit > 0) MODES.push(['credit', t('Store credit')]);
  const pay = {}; MODES.forEach(([m]) => pay[m] = 0);
  if (BILL.exchange > 0) { pay.exchange = Math.min(BILL.exchange, due0); }
  pay.cash = r2(due0 - (pay.exchange || 0));
  const rows = h('div', { class: 'grid' }), sum = h('div', { class: 'tot2' });
  const inputs = {};
  const sumNow = () => MODES.reduce((a, [m]) => a + (pay[m] || 0), 0);
  const upd = () => {
    const s = sumNow(), bal = r2(due0 - s);
    clear(sum).append(h('span', null, bal > 0.005 ? t('Due') : bal < -0.005 ? t('Change') : t('Paid in full')), h('b', { class: 'num ' + (bal > 0.005 ? 'neg' : '') }, inr(Math.abs(bal))));
    ok.disabled = false;
  };
  MODES.forEach(([m, l]) => {
    const i = input({ type: 'number', value: pay[m] || '', mode: 'decimal', placeholder: '0', oninput: () => { pay[m] = N(i.value); upd(); } }); inputs[m] = i;
    rows.append(h('div', { class: 'payl' }, h('label', null, l), i, h('button', { class: 'btn sm', type: 'button', onclick: () => { MODES.forEach(([x]) => { pay[x] = 0; inputs[x].value = ''; }); pay[m] = m === 'credit' ? Math.min(due0, cust.credit) : due0; inputs[m].value = pay[m]; upd(); } }, t('Exact'))));
  });
  const note = input({ placeholder: t('Note (optional)') });
  const ok = h('button', { class: 'btn fill', type: 'button' }, t('Complete sale') + ' · ' + inr(c.total));
  const sh = sheet({ title: t('Pay'), body: h('div', { class: 'grid' },
    h('div', { class: 'paytot' }, h('span', null, t('Total')), h('b', { class: 'num' }, inr(c.total))), redeemVal > 0 ? h('div', { class: 'muted small' }, t('Points used') + ': -' + inr(redeemVal)) : null,
    cust ? h('div', { class: 'muted small' }, cust.name + (cust.phone ? ' · ' + cust.phone : '')) : h('div', { class: 'muted small' }, t('Walk-in') + ' — ' + t('add a customer to leave a balance due')),
    rows, sum, field(t('Note'), note)), actions: [] });
  sh.el.querySelector('.sheet-f') || sh.el.append(h('div', { class: 'sheet-f' }));
  sh.el.querySelector('.sheet-f').append(ok);
  upd();
  ok.onclick = async () => {
    ok.disabled = true;
    const payments = MODES.map(([m]) => ({ mode: m, amount: pay[m] })).filter((p) => p.amount > 0);
    const p = { id: uid(), branchId: S.branch, customerId: cust ? cust.id : null, note: note.value || undefined, redeemPoints: BILL.redeem || 0,
      billDiscPct: BILL.billDiscPct || undefined, billDiscAmt: BILL.billDiscAmt || undefined, holdId: BILL.holdId || undefined, payments,
      lines: BILL.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, discPct: l.discPct || undefined, discAmt: l.discAmt || undefined, price: l.price })) };
    // a changed price is only sent when it differs from the catalogue (the server refuses it for non-managers)
    p.lines.forEach((l, i) => { const vv = allVariants().find((x) => x.id === l.variantId); if (vv && Math.abs(vv.price - l.price) < .005) delete l.price; });
    if (BILL.lines.some((l, i) => p.lines[i].price != null) && !can('sty_manage')) { ok.disabled = false; return toast(t('Changing a price needs a manager'), { err: true }); }
    if (navigator.onLine === false) p.offline = true, p.at = new Date().toISOString();
    try {
      const r = await sendOrQueue('sty_sell', { p });
      const snapshot = r.done ? r.data : provisional(p, c);
      sh.close(); newBill(); S.catAt = 0;
      if (r.done) { await loadCatalog(true).catch(() => {}); } else applyQueueToCatalog();
      done(); successSheet(snapshot, !r.done);
    } catch (e) { ok.disabled = false; fail(e); }
  };
}
// a name and/or phone typed on the bill becomes a customer (found by phone, else created) before paying; offline it is skipped
async function resolveTypedCustomer() {
  if (BILL.customer) return;
  const name = (BILL.custName || '').trim(), phone = (BILL.custPhone || '').trim();
  if (!name && !phone) return;
  if (navigator.onLine === false) return;
  try { BILL.customer = await api('sty_save_customer', { p: { name: name || phone, phone: phone || undefined } }); } catch { /* the bill can still go through as walk-in */ }
}
function provisional(p, c) {
  return { number: 'WAITING', at: new Date().toISOString(), customer: BILL.customer, lines: c.lines.map((l, i) => ({ name: BILL.lines[i].name, colour: BILL.lines[i].colour, size: BILL.lines[i].size, qty: l.qty, price: l.unit, net: l.net })),
    subtotal: c.subtotal, discount: c.discount, tax: c.tax, rounding: c.rounding, total: c.total, payments: p.payments, balance: Math.max(0, c.total - p.payments.reduce((a, x) => a + x.amount, 0)) };
}
function successSheet(sale, queued) {
  const s = sheet({ title: queued ? t('Saved on this device') : t('Sale complete'), closeLabel: t('New bill'), body: h('div', { class: 'grid' },
    queued ? banner('warn', 'cloudOff', t('No connection. This bill is saved here and will be sent automatically.')) : h('div', { class: 'okmark' }, icon('check', 34), h('div', null, sale.number), h('b', { class: 'num' }, inr(sale.total))),
    receiptNode(sale),
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn', type: 'button', onclick: () => printReceipt(sale) }, icon('print', 18), t('Print')),
      h('button', { class: 'btn', type: 'button', onclick: () => shareWa(sale) }, icon('share', 18), t('WhatsApp')))) });
}

// ---- cash shift ----
async function shiftSheet() {
  let cur = null; try { cur = await api('sty_shift_current', { p_branch: S.branch }); } catch (e) { return fail(e); }
  if (!cur) {
    const oc = input({ type: 'number', mode: 'decimal', placeholder: '0' });
    sheet({ title: t('Open shift'), body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, t('Count the cash in the drawer and start your shift.')), field(t('Opening cash'), oc)), actions: [{ label: t('Open shift'), primary: true, onclick: async (close) => { await api('sty_shift_open', { p: { branchId: S.branch, openingCash: N(oc.value) } }); close(); toast(t('Shift started')); } }] });
  } else {
    const cc = input({ type: 'number', mode: 'decimal', placeholder: '0' }), nt = input({ placeholder: t('Note (optional)') });
    sheet({ title: t('Close shift'), body: h('div', { class: 'grid' }, h('div', { class: 'kv' }, h('span', null, t('Opening cash')), h('b', { class: 'num' }, inr(cur.openingCash))), h('div', { class: 'kv' }, h('span', null, t('Cash sales')), h('b', { class: 'num' }, inr(cur.cashSales))),
      h('div', { class: 'kv' }, h('span', null, t('Expected in drawer')), h('b', { class: 'num' }, inr(cur.expectedCash))), field(t('Counted cash'), cc), field(t('Note'), nt)),
      actions: [{ label: t('Close shift'), primary: true, onclick: async (close) => {
        const r = await api('sty_shift_close', { p: { countedCash: cc.value, note: nt.value } }); close();
        alertBox({ title: Math.abs(r.difference) < 1 ? t('Drawer matches') : (r.difference > 0 ? t('Over by') : t('Short by')) + ' ' + inr(Math.abs(r.difference)), actions: [{ label: t('Done'), value: true, role: 'def' }] });
      } }] });
  }
}
