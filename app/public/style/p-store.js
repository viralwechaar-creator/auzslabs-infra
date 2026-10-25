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
    const tabs = seg(can('sty_manage') ? [['orders', t('Orders')], ['extras', t('Offers & reviews')], ['stats', t('Visitors')], ['edit', t('Store')]] : [['orders', t('Orders')]], OST.tab, (x) => { OST.tab = x; paint(); }, { full: true });
    v.root.append(h('div', { class: 'grid' }, tabs, body));
    async function paint() { clear(body); if (OST.tab === 'edit' && can('sty_manage')) await editor(body); else if (OST.tab === 'extras' && can('sty_manage')) await extras(body); else if (OST.tab === 'stats' && can('sty_manage')) await storeStats(body); else await orders(body); }
    paint();
  },
});

async function orders(host) {
  const list = h('div', { class: 'list' });
  const seg2 = seg([['new', t('New')], ['active', t('In progress')], ['done', t('Done')], ['', t('All')]], OST.status, (x) => { OST.status = x; load(); }, { full: true });
  host.append(alertCard(), seg2, list);
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
  const set = async (p, close) => { const x = await api('sty_web_order_update', { p_id: r.id, p }); if (x && x.billed) toast(t('Saved. Bill made') + ': ' + x.billed); else if (x && x.billError) toast(t('Saved, but the bill could not be made') + ': ' + x.billError, { err: true }); else toast(t('Saved')); changed && changed(); close && close(); };
  const billNow = async (close) => { try { const x = await api('sty_web_order_bill', { p_id: r.id }); toast(t('Bill made') + ': ' + (x.number || '')); changed && changed(); close && close(); } catch (e) { toast(e.message, { err: true }); return false; } };
  const addr = [c.address, c.address2, c.city, c.state, c.pin].filter(Boolean).join(', ');
  const wa = String(c.phone || '').replace(/\D/g, '');
  const COUR = ['', 'Delhivery', 'India Post', 'DTDC', 'Blue Dart', 'Ecom Express', 'XpressBees', 'Shiprocket', 'Other'];
  const courierSel = h('select', { class: 'input' }, COUR.map((x) => h('option', { value: x, selected: x === (r.courier || '') }, x || t('Choose')))); const trackIn = input({ value: r.trackingNo || '', placeholder: t('Tracking number') });
  const body = h('div', { class: 'grid' },
    r.saleId ? banner('ok', 'check', t('Billed automatically') + (r.saleNo ? ': ' + r.saleNo : '') + '. ' + t('No need to bill it again on the till.')) : r.paymentStatus === 'paid' ? null : banner('info', 'alert', t('The bill is made automatically when the payment is confirmed (or when a cash on delivery order is delivered).')),
    r.paymentStatus === 'submitted' ? banner('warn', 'alert', t('The customer says they paid by UPI. Reference') + ': ' + (r.utr || '-') + '. ' + t('Check it in your bank app, then mark it paid.')) : null,
    h('div', { class: 'card grid' }, h('b', null, c.name), h('div', { class: 'muted small' }, c.phone + (c.email ? ' · ' + c.email : '')), h('div', { class: 'small' }, addr), r.note ? h('div', { class: 'muted small' }, t('Note') + ': ' + r.note) : null,
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, c.phone ? h('a', { class: 'btn sm', href: 'tel:' + c.phone }, icon('phone', 16), t('Call')) : null, wa ? h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: 'https://wa.me/' + (wa.length === 10 ? '91' + wa : wa) + '?text=' + encodeURIComponent('Hi ' + c.name.split(' ')[0] + ', about your order ' + r.number + '.') }, icon('share', 16), 'WhatsApp') : null)),
    ['confirmed', 'packed', 'shipped', 'delivered'].includes(r.status) ? h('div', { class: 'card grid' }, h('b', null, t('Courier and tracking')), h('div', { class: 'two' }, field(t('Courier'), courierSel), field(t('Tracking number'), trackIn)), h('button', { class: 'btn sm', type: 'button', onclick: () => set({ courier: courierSel.value, trackingNo: trackIn.value }) }, t('Save tracking'))) : null,
    r.coupon ? h('div', { class: 'muted small' }, t('Coupon') + ': ' + r.coupon + ' (– ' + inr(r.discount) + ')') : null,
    h('div', { class: 'list' }, r.lines.map((l) => liRow({ icon: 'shirt', title: l.name, sub: [l.colour, l.size].filter(Boolean).join(' · ') + ' × ' + l.qty, value: inr(l.price * l.qty) }))),
    h('div', { class: 'card grid' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, t('Subtotal')), inr(r.subtotal)), h('div', { class: 'row' }, h('span', { class: 'grow' }, t('Shipping')), r.shipping ? inr(r.shipping) : t('Free')), h('div', { class: 'row' }, h('b', { class: 'grow' }, t('Total')), h('b', null, inr(r.total))),
      h('div', { class: 'muted small' }, t(PAYL[r.payment] || r.payment) + ' · ' + (r.paymentStatus === 'paid' ? t('Paid') : r.paymentStatus === 'cod' ? t('Collect on delivery') : r.paymentStatus === 'submitted' ? t('Check payment') : t('Waiting for payment')))));
  const sh = sheet({ title: r.number, closeLabel: t('Done'), body, actions: [
    r.status === 'new' ? { label: t('Confirm order'), primary: true, onclick: (close) => set({ status: 'confirmed' }, close) } : null,
    r.paymentStatus !== 'paid' && r.payment !== 'cod' ? { label: t('Mark as paid'), onclick: (close) => set({ paymentStatus: 'paid' }, close) } : null,
    r.status === 'confirmed' ? { label: t('Packed'), onclick: (close) => set({ status: 'packed' }, close) } : null,
    ['confirmed', 'packed'].includes(r.status) ? { label: t('Shipped'), onclick: (close) => set({ status: 'shipped' }, close) } : null,
    r.status === 'shipped' ? { label: t('Delivered'), primary: true, onclick: (close) => set(r.payment === 'cod' ? { status: 'delivered', paymentStatus: 'paid' } : { status: 'delivered' }, close) } : null,
    !r.saleId && r.status !== 'cancelled' && r.paymentStatus !== 'paid' ? { label: t('Make bill now (stock goes out)'), onclick: billNow } : null,
    r.saleId ? { label: t('Share invoice'), primary: !!(c.phone), onclick: async () => { await shareWa({ id: r.saleId, number: r.saleNo, at: r.createdAt, customer: { name: c.name, phone: c.phone }, lines: r.lines.map((l) => ({ qty: l.qty, name: l.name, colour: l.colour, size: l.size, net: l.price * l.qty })), discount: r.discount || 0, total: r.total, payments: [{ mode: r.payment === 'cod' ? 'cash' : r.payment }], balance: 0 }, c.phone); return false; } } : null,
    r.saleId ? { label: t('Copy invoice link'), onclick: async () => { const l = await billLink({ id: r.saleId }); try { await navigator.clipboard.writeText(l); toast(t('Link copied')); } catch { toast(l); } return false; } } : null,
    !['delivered', 'cancelled'].includes(r.status) ? { label: t('Cancel order'), danger: true, onclick: async (close) => { if (!await confirmBox(t('Cancel this order?'), t('The customer is not told automatically.'), t('Cancel order'), true)) return false; await set({ status: 'cancelled' }, close); } } : null] });
}

async function editor(host) {
  let C; try { C = await api('sty_store_get'); } catch (e) { return host.append(empty('cloudOff', t('Could not load'), e.message)); }
  const a = C.about || (C.about = {}), sh = C.shipping || (C.shipping = {}), pay = C.pay || (C.pay = { cod: true, upi: true }), soc = C.social || (C.social = {}), pol = C.policies || (C.policies = {});
  C.blogs = C.blogs || []; C.media = C.media || []; C.jobs = C.jobs || []; const hire = C.hiring || (C.hiring = {}); C.heroImages = C.heroImages || []; C.stores = C.stores || []; C.founders = C.founders || []; C.faqs = C.faqs || [];
  const st = S.ctx.settings, feat = st.features || {};
  const link = storeLink(C.slug);
  const pickImg = (cb) => { const i = h('input', { type: 'file', accept: 'image/*', class: 'hidden' }); document.body.append(i); i.onchange = async () => { const f = i.files[0]; i.remove(); if (!f) return; try { await cb(await uploadPhoto(f)); } catch (e) { fail(e); } }; i.click(); };
  const sw = (label, hint, get, set) => { const c = h('input', { type: 'checkbox', checked: !!get(), onchange: () => set(c.checked) }); return h('label', { class: 'swrow' }, h('div', { class: 'grow' }, h('div', null, label), hint ? h('div', { class: 'muted small' }, hint) : null), c); };
  const tx = (get, set, o) => { const i = input(Object.assign({ value: get() || '' }, o || {})); i.oninput = () => set(i.value); return i; };
  const ta = (get, set, ph) => { const e = h('textarea', { class: 'input', rows: 4, placeholder: ph || '' }); e.value = get() || ''; e.oninput = () => set(e.value); return e; };
  const rzpId = input({ placeholder: 'rzp_live_...', value: C.rzpKey || '' }), rzpSec = input({ placeholder: C.payOnline ? t('Saved. Type to change') : '', type: 'password', autocomplete: 'off' });
  const sg0 = C.sizeGuide || {}; const sgNote = { v: sg0.note || '' }; const sgRows = (sg0.rows || []).map((r) => ({ size: r[0], chest: r[1], waist: r[2] }));
  const hero = h('div', { class: 'pe-grid' }), repaintHero = () => clear(hero).append(...C.heroImages.map((u, i) => h('div', { class: 'pe-t' }, h('img', { src: u, alt: '' }), h('div', { class: 'pe-a' }, h('button', { type: 'button', title: t('Remove'), onclick: () => { C.heroImages.splice(i, 1); repaintHero(); } }, icon('x', 14))))), h('button', { class: 'pe-add', type: 'button', onclick: () => pickImg((u) => { C.heroImages.push(u); repaintHero(); }) }, icon('plus', 22)));
  repaintHero();
  const aboutImg = h('div', { class: 'row', style: { gap: '8px' } }); const repaintAbout = () => clear(aboutImg).append(a.image ? h('img', { src: a.image, alt: '', style: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '12px' } }) : null, h('button', { class: 'btn sm', type: 'button', onclick: () => pickImg((u) => { a.image = u; repaintAbout(); }) }, icon('camera', 16), a.image ? t('Change') : t('Add picture')), a.image ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { a.image = ''; repaintAbout(); } }, t('Remove')) : null); repaintAbout();

  // lists of small records edited in a sheet
  const listEditor = (arr, fields, title, rowTitle, rowSub) => {
    const box = h('div', { class: 'list' });
    const paint = () => clear(box).append(...arr.map((x, i) => liRow({ icon: 'edit', title: rowTitle(x) || t('Untitled'), sub: rowSub ? rowSub(x) : '', chevron: true, onclick: () => form(x, i) })), h('button', { class: 'btn', type: 'button', onclick: () => form(null, -1) }, icon('plus', 18), t('Add')));
    function form(x, i) {
      const cur = Object.assign({}, x || {}); const ctl = {};
      const rows = fields.map(([k, label, kind]) => { let el; if (kind === 'date') el = tx(() => cur[k], (v) => { cur[k] = v; }, { type: 'date' }); else if (kind === 'area') el = ta(() => cur[k], (v) => { cur[k] = v; }); else if (kind === 'img') { const wrap = h('div', { class: 'row', style: { gap: '8px' } }); const pn = () => clear(wrap).append(cur[k] ? h('img', { src: cur[k], alt: '', style: { width: '56px', height: '56px', objectFit: 'cover', borderRadius: '10px' } }) : null, h('button', { class: 'btn sm', type: 'button', onclick: () => pickImg((u) => { cur[k] = u; pn(); }) }, icon('camera', 16), cur[k] ? t('Change') : t('Add picture')), cur[k] ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { cur[k] = ''; pn(); } }, t('Remove')) : null); pn(); el = wrap; } else el = tx(() => cur[k], (v) => { cur[k] = v; }); ctl[k] = el; return kind === 'img' ? h('div', { class: 'field' }, h('label', null, label), el) : field(label, el); });
      sheet({ title: title, body: h('div', { class: 'grid' }, rows), actions: [{ label: t('Done'), primary: true, onclick: (close) => { if (i >= 0) arr[i] = cur; else arr.push(cur); paint(); close(); } }, i >= 0 ? { label: t('Remove'), danger: true, onclick: (close) => { arr.splice(i, 1); paint(); close(); } } : null] });
    }
    paint(); return box;
  };

  const save = h('button', { class: 'btn fill wide', type: 'button', onclick: async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      const num = (x) => (x === '' || x == null ? 0 : Number(x) || 0);
      sh.fee = num(sh.fee); sh.freeOver = num(sh.freeOver);
      const p = { on: !!C.on, tagline: C.tagline || '', announce: C.announce || '', heroImages: C.heroImages, heroTitle: C.heroTitle || '', heroCta: C.heroCta || '', about: a, founders: C.founders, stores: C.stores, faqs: C.faqs, policies: pol, shipping: sh, blogs: C.blogs, media: C.media, jobs: C.jobs, hiring: hire, sizeGuide: { note: sgNote.v, head: ['Size', 'Chest (in)', 'Waist (in)'], rows: sgRows.filter((x) => x.size).map((x) => [x.size, x.chest || '', x.waist || '']) }, waOrder: C.waOrder !== false, abandonWa: !!C.abandonWa, pay, social: soc, email: C.email || '', phone: C.phone || '', brandName: C.brandName || '', showSale: !!C.showSale };
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
    section(t('Card payments (your own Razorpay)'), h('div', { class: 'card grid' }, C.payOnline ? banner('ok', 'check', t('Card, UPI and net banking are on. The money goes straight to your Razorpay account.')) : h('div', { class: 'muted small' }, t('Create a free Razorpay account, then paste the Key ID and Key Secret here. Customers pay you directly. AUZslab never holds your money.')),
      h('div', { class: 'two' }, field(t('Key ID'), rzpId), field(t('Key Secret'), rzpSec)),
      h('div', { class: 'row', style: { gap: '8px' } }, h('button', { class: 'btn sm primary', type: 'button', onclick: async (ev) => { ev.currentTarget.disabled = true; try { await api('sty_store_set_razorpay', { p: { keyId: rzpId.value, secret: rzpSec.value } }); C.payOnline = true; toast(t('Saved')); rzpSec.value = ''; } catch (e) { fail(e); } ev.currentTarget.disabled = false; } }, t('Save keys')), C.payOnline ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { await api('sty_store_set_razorpay', { p: { clear: true } }); C.payOnline = false; toast(t('Card payments turned off')); } }, t('Turn off')) : null),
      h('div', { class: 'muted small' }, t('In Razorpay use "Test" keys first. Paid orders still need your tap on Confirm to make the bill.')))),
    section(t('Size guide'), h('div', { class: 'card grid' }, h('div', { class: 'muted small' }, t('Shown on every product. Customers can type their chest size to find their size. Use ranges like 36-38. A product line starting with "Fit:" in its details is shown as the fit note.')), listEditor(sgRows, [['size', t('Size')], ['chest', t('Chest in inches, e.g. 36-38')], ['waist', t('Waist in inches')]], t('Size'), (x) => x.size, (x) => x.chest), field(t('Note under the chart'), tx(() => sgNote.v, (v) => { sgNote.v = v; })))),
    section(t('WhatsApp messages to customers'), h('div', { class: 'card grid' },
      sw(t('Order confirmed and shipped'), t('Two messages per order. Each message may cost you a small fee from Meta. Off to save cost.'), () => C.waOrder !== false, (x) => { C.waOrder = x; }),
      sw(t('Abandoned bag reminder'), t('One reminder to people who left items in the bag after typing their phone. Costs a small fee per message.'), () => C.abandonWa, (x) => { C.abandonWa = x; }))),
    section(t('Journal (blogs and news)'), h('div', { class: 'grid' }, h('div', { class: 'muted small' }, t('Articles shown on your Journal page. Leave empty to hide the page.')), listEditor(C.blogs, [['title', t('Title')], ['excerpt', t('Short summary')], ['body', t('Article'), 'area'], ['image', t('Cover picture'), 'img'], ['date', t('Date'), 'date']], t('Article'), (x) => x.title, (x) => x.date))),
    section(t('Media and gallery'), h('div', { class: 'grid' }, h('div', { class: 'muted small' }, t('Press, collaborations, events and campaigns. Each is a big card with a picture, date, place and an optional button.')), listEditor(C.media, [['title', t('Title')], ['image', t('Picture or logo'), 'img'], ['date', t('Date'), 'date'], ['place', t('Place')], ['cta', t('Button text, e.g. View collection')], ['link', t('Button link (a page of your store or a web address)')]], t('Media'), (x) => x.title, (x) => x.place))),
    section(t('Careers'), h('div', { class: 'card grid' }, field(t('Hiring message'), ta(() => hire.text, (v) => { hire.text = v; }, t('If you see yourself growing with us...'))), field(t('Where to send applications (email)'), tx(() => hire.email, (v) => { hire.email = v; }, { type: 'email', placeholder: 'jobs@yourshop.com' })),
      listEditor(C.jobs, [['title', t('Role')], ['exp', t('Experience, e.g. 0 - 2 years')], ['tags', t('Tags, comma separated, e.g. Full-time, Core team')], ['location', t('Location')], ['desc', t('About the role'), 'area']], t('Job'), (x) => x.title, (x) => x.location))),
    section(t('Our stores'), listEditor(C.stores, [['name', t('Store name')], ['address', t('Address'), 'area'], ['phone', t('Phone')], ['hours', t('Opening hours')], ['mapUrl', t('Google Maps link (optional)')], ['photo', t('Picture'), 'img']], t('Store'), (x) => x.name || x.address, (x) => x.address)),
    section(t('About us'), h('div', { class: 'card grid' }, field(t('Heading'), tx(() => a.title, (v) => { a.title = v; }, { placeholder: t('About us') })), field(t('Story'), ta(() => a.text, (v) => { a.text = v; })), h('div', { class: 'field' }, h('label', null, t('Picture')), aboutImg))),
    section(t('Founders'), listEditor(C.founders, [['name', t('Name')], ['role', t('Role')], ['bio', t('A few words'), 'area'], ['photo', t('Picture'), 'img']], t('Founder'), (x) => x.name, (x) => x.role)),
    section(t('Questions and answers (FAQ)'), listEditor(C.faqs, [['cat', t('Group, e.g. Orders, Shipping')], ['q', t('Question')], ['a', t('Answer'), 'area']], t('Question'), (x) => x.q, (x) => x.cat)),
    section(t('Contact and social'), h('div', { class: 'card grid' }, h('div', { class: 'two' }, field(t('Phone (also used for WhatsApp)'), tx(() => C.phone, (v) => { C.phone = v; }, { mode: 'tel', placeholder: st.phone || '' })), field(t('Email'), tx(() => C.email, (v) => { C.email = v; }, { type: 'email' }))), h('div', { class: 'two' }, field('Instagram', tx(() => soc.instagram, (v) => { soc.instagram = v; }, { placeholder: 'instagram.com/yourshop' })), field('Facebook', tx(() => soc.facebook, (v) => { soc.facebook = v; }))))),
    section(t('Policies (optional)'), h('div', { class: 'card grid' }, h('div', { class: 'muted small' }, t('Leave empty to show our simple standard text.')), field(t('Shipping'), ta(() => pol.shipping, (v) => { pol.shipping = v; })), field(t('Returns and exchanges'), ta(() => pol.returns, (v) => { pol.returns = v; })), field(t('Terms'), ta(() => pol.terms, (v) => { pol.terms = v; })), field(t('Privacy'), ta(() => pol.privacy, (v) => { pol.privacy = v; })))),
    save);
}


// A received return/exchange whose order was paid online (r.rzpPaid, db/248) is refunded through the
// shop's own Razorpay account for real, not just a status change -- sb.styRefund.start() calls the
// server (server/src/routes/payments.js /payments/sty/refund/start), which validates everything again
// itself, calls Razorpay with the shop's own keys, and only then moves the request to 'refunded'
// (sty_web_return_set) -- so nothing here needs to trust the amount typed in beyond what the server
// re-checks. `onDone` repaints the returns list once the sheet closes on success.
function styRazorpayRefundSheet(r, onDone) {
  const amt = input({ type: 'number', inputmode: 'decimal', value: r.total, placeholder: t('Amount') });
  const s = sheet({ title: t('Refund via Razorpay'), closeLabel: t('Cancel'), body: h('div', { class: 'grid' },
    h('div', { class: 'muted small' }, r.number + ' · ' + r.customer.name),
    h('div', { class: 'muted small' }, t('This sends the money back to the customer through your own Razorpay account.')),
    field(t('Amount') + ' (' + t('up to') + ' ₹' + r.total + ')', amt)),
    actions: [{ label: t('Refund'), primary: true, onclick: async (close) => {
      const n = Number(amt.value);
      if (!(n > 0) || n > r.total) { toast(t('Enter an amount up to') + ' ₹' + r.total); return false; }
      try { await sb.styRefund.start(r.id, n); toast(t('Refunded')); close(); onDone(); }
      catch (e) { fail(e); return false; }
    } }] });
  return s;
}

// ---- offers and reviews: coupons, returns requested from the website, reviews from real buyers ----
async function extras(host) {
  const box = h('div', { class: 'grid' }); host.append(box);
  async function paint() {
    clear(box);
    let cps = [], rets = [], revs = [];
    try { [cps, rets, revs] = await Promise.all([api('sty_coupons_list'), api('sty_web_returns_list'), api('sty_reviews_list')]); } catch (e) { return box.append(empty('cloudOff', t('Could not load'), e.message)); }
    // A request only ever moves forward one step at a time -- requested -> approved/rejected -> received ->
    // refunded -- and the server (sty_web_return_set, db/248) refuses any other move or a change to an
    // already-decided request outright. The buttons here only ever offer the real next step(s), matching
    // the server exactly, instead of letting someone pick any of the 5 statuses at any time.
    const RETURN_NEXT = { requested: [['approved', t('Approve')], ['rejected', t('Reject')]], approved: [['received', t('Mark received')]], received: [['refunded', t('Finish') + ' ' + t('refund')]], rejected: [], refunded: [] };
    // When the order was actually paid online, "Finish refund" sends the money back through the shop's own
    // Razorpay account (db/248) instead of only changing the status label -- see styRazorpayRefundSheet().
    box.append(
      section(t('Returns and exchanges asked online'), h('div', { class: 'list' }, (rets && rets.length ? rets : []).map((r) => liRow({ icon: 'box', title: r.number + ' · ' + r.customer.name, sub: t(r.kind === 'return' ? 'Return' : 'Exchange') + ': ' + r.reason, value: t(r.status), chevron: true, onclick: () => {
          const note = input({ value: r.staffNote || '', placeholder: t('Note for the customer') });
          const next = RETURN_NEXT[r.status] || [];
          const refundedLine = r.status === 'refunded' && r.refundAmount != null
            ? h('div', { class: 'muted small' }, r.rzpRefundId ? t('Refunded') + ' ₹' + r.refundAmount + ' ' + t('via Razorpay') + ' (' + r.rzpRefundId + ')' : t('Refunded') + ' ₹' + r.refundAmount)
            : null;
          sheet({ title: r.number, closeLabel: t('Done'), body: h('div', { class: 'grid' }, h('div', { class: 'card grid' }, h('b', null, r.customer.name), h('div', { class: 'muted small' }, r.customer.phone), h('div', null, r.reason), (r.items || []).map((x) => h('div', { class: 'muted small' }, x.name + ' · ' + [x.colour, x.size].filter(Boolean).join(' ') + ' × ' + x.qty)), refundedLine, !next.length && !refundedLine ? h('div', { class: 'muted small' }, t('status') + ': ' + t(r.status) + ' · ' + t('this cannot be changed')) : null), field(t('Note'), note)),
            actions: next.map(([x, label]) => ({
              label: x === 'refunded' && r.rzpPaid ? t('Refund via Razorpay') : label, primary: x === 'approved' || x === 'refunded',
              onclick: async (close) => {
                if (x === 'refunded' && r.rzpPaid) { close(); return styRazorpayRefundSheet(r, paint); }
                await api('sty_web_return_set', { p_id: r.id, p: { status: x, staffNote: note.value } }); toast(t('Saved')); close(); paint();
              },
            })) });
        } })).concat(rets && rets.length ? [] : [empty('box', t('No requests'), t('Return and exchange requests from your online customers show here.'))]))),
      section(t('Coupon codes'), h('div', { class: 'list' }, cps.map((c) => liRow({ icon: 'tag', title: c.code, sub: (c.kind === 'pct' ? c.value + '% off' : c.kind === 'flat' ? '₹' + c.value + ' off' : t('Free shipping')) + (c.minOrder ? ' · ' + t('min') + ' ₹' + c.minOrder : '') + (c.firstOnly ? ' · ' + t('first order only') : ''), value: c.used + (c.maxUses ? '/' + c.maxUses : ''), valueSub: c.active ? t('On') : t('Off'), chevron: true, onclick: () => couponSheet(c) })).concat([h('button', { class: 'btn', type: 'button', onclick: () => couponSheet(null) }, t('Add a coupon'))]))),
      section(t('Reviews from buyers'), h('div', { class: 'list' }, (revs && revs.length ? revs : []).map((r) => liRow({ icon: 'star', title: '★'.repeat(r.rating) + ' ' + r.style, sub: (r.name || '') + (r.body ? ': ' + r.body : ''), value: r.status === 'hidden' ? t('Hidden') : t('Shown'), chevron: true, onclick: async () => { await api('sty_review_set', { p_id: r.id, p_status: r.status === 'hidden' ? 'published' : 'hidden' }); toast(t('Saved')); paint(); } })).concat(revs && revs.length ? [] : [empty('star', t('No reviews yet'), t('Customers can review a piece after their order is delivered.'))]))));
  }
  function couponSheet(c) {
    const cur = Object.assign({ kind: 'pct', value: 10, active: true }, c || {});
    const code = input({ value: cur.code || '', placeholder: 'WELCOME10' }); const kind = h('select', { class: 'input' }, [['pct', '% off'], ['flat', '₹ off'], ['ship', t('Free shipping')]].map(([k, l]) => h('option', { value: k, selected: k === cur.kind }, l)));
    const val = input({ value: cur.value || '', type: 'number', mode: 'decimal' }), min = input({ value: cur.minOrder || '', type: 'number', mode: 'decimal' }), max = input({ value: cur.maxUses || '', type: 'number', mode: 'numeric' }), ends = input({ value: cur.endsOn || '', type: 'date' });
    const first = h('input', { type: 'checkbox', checked: !!cur.firstOnly }), act = h('input', { type: 'checkbox', checked: cur.active !== false });
    sheet({ title: c ? c.code : t('New coupon'), closeLabel: t('Cancel'), body: h('div', { class: 'grid' }, field(t('Code'), code), h('div', { class: 'two' }, field(t('Type'), kind), field(t('Value'), val)), h('div', { class: 'two' }, field(t('Minimum order ₹'), min), field(t('Max uses'), max)), field(t('Ends on (optional)'), ends),
      h('label', { class: 'swrow' }, h('div', { class: 'grow' }, t('First order only')), first), h('label', { class: 'swrow' }, h('div', { class: 'grow' }, t('Active')), act)),
      actions: [{ label: t('Save'), primary: true, onclick: async (close) => { try { await api('sty_coupon_save', { p: { id: cur.id, newId: cur.id ? undefined : uid(), code: code.value, kind: kind.value, value: +val.value || 0, minOrder: +min.value || 0, maxUses: max.value ? +max.value : null, endsOn: ends.value || null, firstOnly: first.checked, active: act.checked } }); toast(t('Saved')); close(); paint(); } catch (e) { toast(e.message, { err: true }); return false; } } },
        c ? { label: t('Delete'), danger: true, onclick: async (close) => { await api('sty_coupon_delete', { p_id: c.id }); close(); paint(); } } : null] });
  }
  paint();
}

// ---- visitor behaviour: who comes, what they look at, how far they scroll, where they drop off ----
OST.days = 30;
const PAGEN = { home: 'Home', shop: 'Shop', p: 'Product page', bag: 'Bag', checkout: 'Checkout', order: 'Order page', stores: 'Stores', about: 'About', faq: 'FAQ', contact: 'Contact', collections: 'Collections', orders: 'My orders', saved: 'Saved' };
const pageName = (p) => { const k = String(p || '').split('/')[0]; return PAGEN[k] || k || '-'; };
const hbar = (label, n, max, sub) => h('div', { class: 'hbar' }, h('div', { class: 'hb-l' }, label), h('div', { class: 'hb-t' }, h('div', { class: 'hb-f', style: { width: Math.max(2, n / Math.max(1, max) * 100) + '%' } })), h('div', { class: 'hb-n num' }, String(n), sub ? h('span', { class: 'mut' }, ' ' + sub) : null));
async function storeStats(host) {
  const box = h('div', { class: 'grid' });
  const per = seg([['7', t('7 days')], ['30', t('30 days')], ['90', t('90 days')]], String(OST.days), (x) => { OST.days = +x; load(); }, { full: true });
  host.append(per, box);
  async function load() {
    clear(box).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
    let r; try { r = await api('sty_store_analytics', { p_days: OST.days }); } catch (e) { return clear(box).append(empty('cloudOff', t('Could not load'), e.message)); }
    clear(box);
    if (!r.visitors) { box.append(empty('chart', t('No visitors yet'), t('Visits are counted from now on. Share your store link and check back.'))); return; }
    const f = r.funnel || {}; const conv = f.v ? Math.round((f.o || 0) / f.v * 1000) / 10 : 0;
    box.append(h('div', { class: 'kpis' }, kpi(t('Visitors'), r.visitors, r.returning + ' ' + t('came back')), kpi(t('Time on site'), (Math.floor(r.avgSeconds / 60) ? Math.floor(r.avgSeconds / 60) + 'm ' : '') + (r.avgSeconds % 60) + 's', t('per page')), kpi(t('Orders'), r.orders, inr(r.revenue, 0)), kpi(t('Buying rate'), conv + '%', t('of visitors ordered'))));
    const fm = f.v || 1;
    box.append(section(t('Where visitors drop off'), h('div', { class: 'card' }, [[t('Visited the store'), f.v], [t('Looked at a product'), f.p], [t('Added to bag'), f.b], [t('Started checkout'), f.c], [t('Placed an order'), f.o]].map(([l, n], i, a) => hbar(l, n || 0, fm, i ? '(' + (a[i - 1][1] ? Math.round((n || 0) / a[i - 1][1] * 100) : 0) + '% of previous)' : '')))));
    box.append(section(t('How far people scroll'), h('div', { class: 'card' }, (r.scroll || []).length ? (r.scroll || []).map((x) => h('div', { class: 'sd' }, h('div', { class: 'hb-l' }, pageName(x.page), h('span', { class: 'mut' }, ' · ' + x.n + ' ' + t('visits') + ' · ' + t('avg') + ' ' + (x.avg_s || 0) + 's')),
      h('div', { class: 'sd-b' }, [['25%', x.a25], ['50%', x.a50], ['75%', x.a75], ['End', x.a100]].map(([l, n]) => h('div', { class: 'sd-c' }, h('div', { class: 'sd-f', style: { height: Math.max(3, Math.round(n / Math.max(1, x.n) * 100)) + '%' } }), h('div', { class: 'sd-l' }, l, h('br'), Math.round(n / Math.max(1, x.n) * 100) + '%'))))) ) : h('div', { class: 'mut' }, t('Not enough data yet')))));
    const pm = Math.max(1, ...(r.products || []).map((x) => +x.views));
    box.append(section(t('Most viewed products'), h('div', { class: 'card' }, (r.products || []).map((x) => hbar(x.name || x.sid, +x.views, pm, (((r.adds || []).find((a) => a.sid === x.sid) || {}).adds || 0) + ' ' + t('added to bag'))))));
    if ((r.searches || []).length) box.append(section(t('What people search for'), h('div', { class: 'card' }, r.searches.map((x) => hbar(x.q, +x.n, +r.searches[0].n)))));
    if ((r.clicks || []).length) box.append(section(t('Buttons used'), h('div', { class: 'card' }, r.clicks.map((x) => hbar(x.what, +x.n, +r.clicks[0].n)))));
    box.append(section(t('Devices'), h('div', { class: 'card' }, (r.devices || []).map((x) => hbar(x.device, +x.n, r.visitors)))));
    box.append(section(t('Where visitors come from'), h('div', { class: 'card' }, (r.sources || []).map((x) => hbar(x.ref === 'Direct' ? t('Direct / link shared') : x.ref, +x.n, r.visitors)))));
    box.append(section(t('Visitors per day'), h('div', { class: 'card' }, vbars((r.daily || []).map((x) => ({ l: String(x.day).slice(8, 10), v: +x.n }))))));
    box.append(section(t('Busy hours'), h('div', { class: 'card' }, vbars(Array.from({ length: 24 }, (_, i) => ({ l: i, v: +(((r.hours || []).find((x) => +x.h === i) || {}).n || 0) }))))));
  }
  load();
}


// ---- order alerts on this device (browser push); the same push_subs table the POS uses ----
const OVAPID = 'BFQTtl3U3YPPl7qBOO00GjCNsW4N-T5jyq4UGs2Mk9s3lHoichGl0_B4yYrPCmCfscnw63XbHtpOp2Iy1nWMmZA';
const b64arr = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
async function enableAlerts(ask) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, msg: t('This browser cannot show alerts when the app is closed. On iPhone, add the app to the Home Screen first.') };
  if (Notification.permission !== 'granted') { if (!ask) return { ok: false }; const perm = await Notification.requestPermission(); if (perm !== 'granted') return { ok: false, msg: t('Allow notifications for this site in the phone settings.') }; }
  const reg = await navigator.serviceWorker.ready, want = b64arr(OVAPID);
  let sub = await reg.pushManager.getSubscription();
  const have = sub && sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && !(have && have.length === want.length && have.every((b, i) => b === want[i]))) { try { await sb.from('push_subs').delete().eq('endpoint', sub.endpoint); } catch {} await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  const j = sub.toJSON(); const { error } = await sb.from('push_subs').upsert({ user_id: S.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
  return error ? { ok: false, msg: error.message } : { ok: true };
}
function alertCard() {
  const box = h('div');
  const paint = (on) => { clear(box); if (on) return; box.append(h('div', { class: 'card row', style: { gap: '10px', alignItems: 'center' } }, h('div', { class: 'grow' }, h('b', null, t('Get an alert for every new online order')), h('div', { class: 'muted small' }, t('Works when the app is closed. On iPhone it needs the app added to the Home Screen.'))), h('button', { class: 'btn sm primary', onclick: async () => { const r = await enableAlerts(true); if (r.ok) { toast(t('Order alerts are on for this device')); paint(true); } else toast(r.msg || t('Could not turn on alerts'), { err: true }); } }, t('Turn on'))));
  };
  paint(false);
  enableAlerts(false).then((r) => { if (r.ok) paint(true); }).catch(() => {});
  return box;
}
