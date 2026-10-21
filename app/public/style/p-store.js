/* AUZsStyle: Online store. Two tabs: Orders (the inbox of orders placed on the public store) and Store (what the public page shows:
   hero pictures, stores, FAQ, shipping, payments). The public page is /store.html on the shop's own address. */
'use strict';
const OST = { tab: 'orders', status: 'new' };
const PAYL = { cod: 'Cash on delivery', upi: 'UPI', online: 'Card / online' };
const ORD_STATUS = [['new', 'New'], ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
const storeLink = (slug) => 'https://' + slug + '.auzslab.in/store.html';

page('store', {
  title: 'Online store', perm: 'sty_sell',
  async render(v) {
    v.header({ title: t('Online store') });
    const body = h('div', { class: 'grid' });
    const tabs = seg(can('sty_manage') ? [['orders', t('Orders')], ['edit', t('Store')]] : [['orders', t('Orders')]], OST.tab, (x) => { OST.tab = x; paint(); }, { full: true });
    v.root.append(h('div', { class: 'grid' }, tabs, body));
    async function paint() { clear(body); if (OST.tab === 'edit' && can('sty_manage')) await editor(body); else await orders(body); }
    paint();
  },
});

async function orders(host) {
  const list = h('div', { class: 'list' });
  const seg2 = seg([['new', t('New')], ['active', t('In progress')], ['done', t('Done')], ['', t('All')]], OST.status, (x) => { OST.status = x; load(); }, { full: true });
  host.append(seg2, list);
  async function load() {
    clear(list).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
    let rows = []; try { rows = await api('sty_web_orders_list', { p: {} }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
    const f = OST.status === 'new' ? (r) => r.status === 'new' : OST.status === 'active' ? (r) => ['confirmed', 'packed', 'shipped'].includes(r.status) : OST.status === 'done' ? (r) => ['delivered', 'cancelled'].includes(r.status) : () => true;
    rows = rows.filter(f);
    clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: 'box', title: r.number + ' · ' + r.customer.name, sub: fmtDT(r.createdAt) + ' · ' + r.lines.reduce((a, l) => a + l.qty, 0) + ' ' + t('Units') + ' · ' + t(PAYL[r.payment] || r.payment) + (r.paymentStatus === 'submitted' ? ' · ' + t('Check payment') : r.paymentStatus === 'paid' ? ' · ' + t('Paid') : ''), value: inr(r.total), valueSub: t((ORD_STATUS.find((x) => x[0] === r.status) || [0, r.status])[1]), chevron: true, onclick: () => orderSheet(r, load) })) : [empty('box', t('No orders here'), t('Orders from your online store show up here.'))]));
  }
  load();
}

function orderSheet(r, changed) {
  const c = r.customer;
  const set = async (p, close) => { await api('sty_web_order_update', { p_id: r.id, p }); toast(t('Saved')); changed && changed(); close && close(); };
  const addr = [c.address, c.address2, c.city, c.state, c.pin].filter(Boolean).join(', ');
  const wa = String(c.phone || '').replace(/\D/g, '');
  const body = h('div', { class: 'grid' },
    r.paymentStatus === 'submitted' ? banner('warn', 'alert', t('The customer says they paid by UPI. Reference') + ': ' + (r.utr || '-') + '. ' + t('Check it in your bank app, then mark it paid.')) : null,
    h('div', { class: 'card grid' }, h('b', null, c.name), h('div', { class: 'muted small' }, c.phone + (c.email ? ' · ' + c.email : '')), h('div', { class: 'small' }, addr), r.note ? h('div', { class: 'muted small' }, t('Note') + ': ' + r.note) : null,
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, c.phone ? h('a', { class: 'btn sm', href: 'tel:' + c.phone }, icon('phone', 16), t('Call')) : null, wa ? h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: 'https://wa.me/' + (wa.length === 10 ? '91' + wa : wa) + '?text=' + encodeURIComponent('Hi ' + c.name.split(' ')[0] + ', about your order ' + r.number + '.') }, icon('share', 16), 'WhatsApp') : null)),
    h('div', { class: 'list' }, r.lines.map((l) => liRow({ icon: 'shirt', title: l.name, sub: [l.colour, l.size].filter(Boolean).join(' · ') + ' × ' + l.qty, value: inr(l.price * l.qty) }))),
    h('div', { class: 'card grid' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, t('Subtotal')), inr(r.subtotal)), h('div', { class: 'row' }, h('span', { class: 'grow' }, t('Shipping')), r.shipping ? inr(r.shipping) : t('Free')), h('div', { class: 'row' }, h('b', { class: 'grow' }, t('Total')), h('b', null, inr(r.total))),
      h('div', { class: 'muted small' }, t(PAYL[r.payment] || r.payment) + ' · ' + (r.paymentStatus === 'paid' ? t('Paid') : r.paymentStatus === 'cod' ? t('Collect on delivery') : r.paymentStatus === 'submitted' ? t('Check payment') : t('Waiting for payment')))));
  const sh = sheet({ title: r.number, closeLabel: t('Done'), body, actions: [
    r.status === 'new' ? { label: t('Confirm order'), primary: true, onclick: (close) => set({ status: 'confirmed' }, close) } : null,
    r.paymentStatus !== 'paid' && r.payment !== 'cod' ? { label: t('Mark as paid'), onclick: (close) => set({ paymentStatus: 'paid' }, close) } : null,
    r.status === 'confirmed' ? { label: t('Packed'), onclick: (close) => set({ status: 'packed' }, close) } : null,
    ['confirmed', 'packed'].includes(r.status) ? { label: t('Shipped'), onclick: (close) => set({ status: 'shipped' }, close) } : null,
    r.status === 'shipped' ? { label: t('Delivered'), primary: true, onclick: (close) => set(r.payment === 'cod' ? { status: 'delivered', paymentStatus: 'paid' } : { status: 'delivered' }, close) } : null,
    !['delivered', 'cancelled'].includes(r.status) ? { label: t('Make a bill'), onclick: async (close) => { await makeBill(r); close(); } } : null,
    !['delivered', 'cancelled'].includes(r.status) ? { label: t('Cancel order'), danger: true, onclick: async (close) => { if (!await confirmBox(t('Cancel this order?'), t('The customer is not told automatically.'), t('Cancel order'), true)) return false; await set({ status: 'cancelled' }, close); } } : null] });
}

// put the order on the till so staff can take payment / print the bill; stock moves when the bill is made
async function makeBill(r) {
  await loadCatalog(true);
  newBill();
  let missed = 0;
  for (const l of r.lines) {
    const s = S.cat.find((x) => x.id === l.styleId); const vr = s && s.variants.find((x) => x.id === l.variantId);
    if (!vr || !addLine(s, vr, l.qty)) missed++;
  }
  BILL.custName = r.customer.name; BILL.custPhone = r.customer.phone; BILL.note = 'Online order ' + r.number;
  if (r.status === 'new') { try { await api('sty_web_order_update', { p_id: r.id, p: { status: 'confirmed' } }); } catch (e) { /* the till still works */ } }
  if (missed) toast(t('Some items could not be added (stock). Check the bill.'), { err: true });
  go('sell');
}

async function editor(host) {
  let C; try { C = await api('sty_store_get'); } catch (e) { return host.append(empty('cloudOff', t('Could not load'), e.message)); }
  const a = C.about || (C.about = {}), sh = C.shipping || (C.shipping = {}), pay = C.pay || (C.pay = { cod: true, upi: true }), soc = C.social || (C.social = {}), pol = C.policies || (C.policies = {});
  C.heroImages = C.heroImages || []; C.stores = C.stores || []; C.founders = C.founders || []; C.faqs = C.faqs || [];
  const st = S.ctx.settings, feat = st.features || {};
  const link = storeLink(C.slug);
  const pickImg = (cb) => { const i = h('input', { type: 'file', accept: 'image/*', class: 'hidden' }); document.body.append(i); i.onchange = async () => { const f = i.files[0]; i.remove(); if (!f) return; try { await cb(await uploadPhoto(f)); } catch (e) { fail(e); } }; i.click(); };
  const sw = (label, hint, get, set) => { const c = h('input', { type: 'checkbox', checked: !!get(), onchange: () => set(c.checked) }); return h('label', { class: 'swrow' }, h('div', { class: 'grow' }, h('div', null, label), hint ? h('div', { class: 'muted small' }, hint) : null), c); };
  const tx = (get, set, o) => { const i = input(Object.assign({ value: get() || '' }, o || {})); i.oninput = () => set(i.value); return i; };
  const ta = (get, set, ph) => { const e = h('textarea', { class: 'input', rows: 4, placeholder: ph || '' }); e.value = get() || ''; e.oninput = () => set(e.value); return e; };
  const hero = h('div', { class: 'pe-grid' }), repaintHero = () => clear(hero).append(...C.heroImages.map((u, i) => h('div', { class: 'pe-t' }, h('img', { src: u, alt: '' }), h('div', { class: 'pe-a' }, h('button', { type: 'button', title: t('Remove'), onclick: () => { C.heroImages.splice(i, 1); repaintHero(); } }, icon('x', 14))))), h('button', { class: 'pe-add', type: 'button', onclick: () => pickImg((u) => { C.heroImages.push(u); repaintHero(); }) }, icon('plus', 22)));
  repaintHero();
  const aboutImg = h('div', { class: 'row', style: { gap: '8px' } }); const repaintAbout = () => clear(aboutImg).append(a.image ? h('img', { src: a.image, alt: '', style: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '12px' } }) : null, h('button', { class: 'btn sm', type: 'button', onclick: () => pickImg((u) => { a.image = u; repaintAbout(); }) }, icon('camera', 16), a.image ? t('Change') : t('Add picture')), a.image ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { a.image = ''; repaintAbout(); } }, t('Remove')) : null); repaintAbout();

  // lists of small records edited in a sheet
  const listEditor = (arr, fields, title, rowTitle, rowSub) => {
    const box = h('div', { class: 'list' });
    const paint = () => clear(box).append(...arr.map((x, i) => liRow({ icon: 'edit', title: rowTitle(x) || t('Untitled'), sub: rowSub ? rowSub(x) : '', chevron: true, onclick: () => form(x, i) })), h('button', { class: 'btn', type: 'button', onclick: () => form(null, -1) }, icon('plus', 18), t('Add')));
    function form(x, i) {
      const cur = Object.assign({}, x || {}); const ctl = {};
      const rows = fields.map(([k, label, kind]) => { let el; if (kind === 'area') el = ta(() => cur[k], (v) => { cur[k] = v; }); else if (kind === 'img') { const wrap = h('div', { class: 'row', style: { gap: '8px' } }); const pn = () => clear(wrap).append(cur[k] ? h('img', { src: cur[k], alt: '', style: { width: '56px', height: '56px', objectFit: 'cover', borderRadius: '10px' } }) : null, h('button', { class: 'btn sm', type: 'button', onclick: () => pickImg((u) => { cur[k] = u; pn(); }) }, icon('camera', 16), cur[k] ? t('Change') : t('Add picture')), cur[k] ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { cur[k] = ''; pn(); } }, t('Remove')) : null); pn(); el = wrap; } else el = tx(() => cur[k], (v) => { cur[k] = v; }); ctl[k] = el; return kind === 'img' ? h('div', { class: 'field' }, h('label', null, label), el) : field(label, el); });
      sheet({ title: title, body: h('div', { class: 'grid' }, rows), actions: [{ label: t('Done'), primary: true, onclick: (close) => { if (i >= 0) arr[i] = cur; else arr.push(cur); paint(); close(); } }, i >= 0 ? { label: t('Remove'), danger: true, onclick: (close) => { arr.splice(i, 1); paint(); close(); } } : null] });
    }
    paint(); return box;
  };

  const save = h('button', { class: 'btn fill wide', type: 'button', onclick: async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      const num = (x) => (x === '' || x == null ? 0 : Number(x) || 0);
      sh.fee = num(sh.fee); sh.freeOver = num(sh.freeOver);
      const p = { on: !!C.on, tagline: C.tagline || '', announce: C.announce || '', heroImages: C.heroImages, heroTitle: C.heroTitle || '', heroCta: C.heroCta || '', about: a, founders: C.founders, stores: C.stores, faqs: C.faqs, policies: pol, shipping: sh, pay, social: soc, email: C.email || '', phone: C.phone || '', brandName: C.brandName || '', showSale: !!C.showSale };
      C = await api('sty_store_save', { p }); toast(t('Saved'));
    } catch (e) { fail(e); } finally { b.disabled = false; }
  } }, t('Save store'));
  const reqState = C.payReq === 'live' ? banner('ok', 'check', t('Online card payments are switched on for your store.')) : C.payReq === 'requested' ? banner('', 'clock', t('You asked for online card payments. AUZslab will contact you.')) : null;

  host.append(
    section(t('Your store'), h('div', { class: 'card grid' },
      sw(t('Open the online store'), t('When off, visitors see a "not open yet" page.'), () => C.on, (x) => { C.on = x; }),
      sw(t('Show discounts on the website'), t('Off: no sale price or % off is shown. Switch on only when you have approved a sale.'), () => C.showSale, (x) => { C.showSale = x; }),
      h('div', { class: 'field' }, h('label', null, t('Store link')), h('div', { class: 'row', style: { gap: '8px' } }, h('input', { class: 'input grow', readonly: true, value: link, 'aria-label': t('Store link') }), h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(link); toast(t('Copied')); } catch (e) { toast(link); } } }, t('Copy')), h('a', { class: 'btn sm', href: link, target: '_blank', rel: 'noopener' }, t('Open')))),
      field(t('Top bar message (optional)'), tx(() => C.announce, (v) => { C.announce = v; }, { placeholder: t('Free shipping above ₹2,999') })))),
    section(t('Home page'), h('div', { class: 'card grid' }, h('div', { class: 'cap' }, t('Big hero pictures (they change one by one)')), hero,
      h('div', { class: 'two' }, field(t('Hero text'), tx(() => C.heroTitle, (v) => { C.heroTitle = v; })), field(t('Hero button'), tx(() => C.heroCta, (v) => { C.heroCta = v; }, { placeholder: t('Shop now') }))))),
    section(t('Shipping and payment'), h('div', { class: 'card grid' }, h('div', { class: 'two' }, field(t('Shipping charge ₹'), tx(() => sh.fee, (v) => { sh.fee = v; }, { type: 'number', mode: 'decimal' })), field(t('Free shipping above ₹'), tx(() => sh.freeOver, (v) => { sh.freeOver = v; }, { type: 'number', mode: 'decimal' }))),
      field(t('Delivery note'), tx(() => sh.note, (v) => { sh.note = v; }, { placeholder: t('Delivery in 3 to 7 days') })),
      sw(t('Cash on delivery'), '', () => pay.cod !== false, (x) => { pay.cod = x; }),
      sw(t('Pay by UPI QR'), feat.upiId ? t('Uses your UPI id') + ': ' + feat.upiId : t('Add your UPI id in Settings first'), () => pay.upi !== false, (x) => { pay.upi = x; }),
      reqState, C.payReq === 'live' || C.payReq === 'requested' ? null : h('div', { class: 'grid' }, h('div', { class: 'muted small' }, t('Want customers to pay by card and net banking? Ask AUZslab to switch on online payments for your store.')), h('button', { class: 'btn', type: 'button', onclick: async () => { try { C = await api('sty_store_request_payments'); toast(t('Request sent')); OST.tab = 'edit'; go('store'); } catch (e) { fail(e); } } }, t('Ask for online payments'))))),
    section(t('Our stores'), listEditor(C.stores, [['name', t('Store name')], ['address', t('Address'), 'area'], ['phone', t('Phone')], ['hours', t('Opening hours')], ['mapUrl', t('Google Maps link (optional)')], ['photo', t('Picture'), 'img']], t('Store'), (x) => x.name || x.address, (x) => x.address)),
    section(t('About us'), h('div', { class: 'card grid' }, field(t('Heading'), tx(() => a.title, (v) => { a.title = v; }, { placeholder: t('About us') })), field(t('Story'), ta(() => a.text, (v) => { a.text = v; })), h('div', { class: 'field' }, h('label', null, t('Picture')), aboutImg))),
    section(t('Founders'), listEditor(C.founders, [['name', t('Name')], ['role', t('Role')], ['bio', t('A few words'), 'area'], ['photo', t('Picture'), 'img']], t('Founder'), (x) => x.name, (x) => x.role)),
    section(t('Questions and answers (FAQ)'), listEditor(C.faqs, [['cat', t('Group, e.g. Orders, Shipping')], ['q', t('Question')], ['a', t('Answer'), 'area']], t('Question'), (x) => x.q, (x) => x.cat)),
    section(t('Contact and social'), h('div', { class: 'card grid' }, h('div', { class: 'two' }, field(t('Phone (also used for WhatsApp)'), tx(() => C.phone, (v) => { C.phone = v; }, { mode: 'tel', placeholder: st.phone || '' })), field(t('Email'), tx(() => C.email, (v) => { C.email = v; }, { type: 'email' }))), h('div', { class: 'two' }, field('Instagram', tx(() => soc.instagram, (v) => { soc.instagram = v; }, { placeholder: 'instagram.com/yourshop' })), field('Facebook', tx(() => soc.facebook, (v) => { soc.facebook = v; }))))),
    section(t('Policies (optional)'), h('div', { class: 'card grid' }, h('div', { class: 'muted small' }, t('Leave empty to show our simple standard text.')), field(t('Shipping'), ta(() => pol.shipping, (v) => { pol.shipping = v; })), field(t('Returns and exchanges'), ta(() => pol.returns, (v) => { pol.returns = v; })), field(t('Terms'), ta(() => pol.terms, (v) => { pol.terms = v; })), field(t('Privacy'), ta(() => pol.privacy, (v) => { pol.privacy = v; })))),
    save);
}
