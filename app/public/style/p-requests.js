/* AUZsStyle: Customer requests (on demand). A customer asks for something the shop does not have. Staff note it at the till,
   the owner is told straight away, the customer is told when it is ordered and when it is in stock. */
'use strict';
const RQ = { st: 'active' };
const RQ_LABEL = { open: 'Asked', ordered: 'Ordered', arrived: 'In stock', fulfilled: 'Given', cancelled: 'Cancelled' };

// prefill: { description, styleId, variantId, size, colour, name, phone }
function requestSheet(prefill, done) {
  const p = Object.assign({ qty: 1 }, prefill || {});
  const name = input({ value: p.name || '', placeholder: t('Customer name'), auto: 'off' }), phone = input({ value: p.phone || '', type: 'tel', mode: 'tel', placeholder: t('Phone (to tell them)'), max: 14 });
  const desc = h('textarea', { class: 'input', rows: 2, placeholder: t('What do they want? e.g. black linen shirt, size 40') }); desc.value = p.description || '';
  const size = input({ value: p.size || '', placeholder: t('Size'), max: 20 }), colour = input({ value: p.colour || '', placeholder: t('Colour'), max: 40 }), qty = input({ value: p.qty, type: 'number', mode: 'numeric', min: 1 });
  const linked = p.variantId ? h('div', { class: 'note' }, t('Linked to an item you already stock. The customer is told when it is back in stock.')) : null;
  sheet({ title: t('Customer request'), closeLabel: t('cancel'), body: h('div', { class: 'grid' },
    h('div', { class: 'muted small' }, t('Note what the customer wants but you do not have. You will be alerted, and they get a message when it is ordered and when it arrives (if you gave a phone and WhatsApp is on).')),
    linked, field(t('Item wanted'), desc), h('div', { class: 'two' }, field(t('Size'), size), field(t('Colour'), colour)), field(t('How many'), qty), field(t('Name'), name), field(t('Phone'), phone)),
    actions: [{ label: t('Save request'), primary: true, onclick: async (close) => {
      try { await api('sty_request_save', { p: { name: name.value, phone: phone.value, description: desc.value, size: size.value, colour: colour.value, qty: Number(qty.value) || 1, styleId: p.styleId || null, variantId: p.variantId || null } }); toast(t('Request saved. The owner has been told.')); close(); done && done(); } catch (e) { toast(e.message, { err: true }); return false; }
    } }] });
}

page('requests', {
  title: 'Requests', perm: 'sty_sell',
  async render(v) {
    v.header({ title: t('Customer requests'), actions: [{ label: t('New request'), icon: 'plus', primary: true, run: () => requestSheet(null, () => v.refresh()) }] });
    const list = h('div', { class: 'list' });
    v.root.append(seg([['active', t('Open')], ['fulfilled', t('Given')], ['cancelled', t('Cancelled')], ['', t('All')]], RQ.st, (x) => { RQ.st = x; load(); }, { full: true }), list);
    async function load() {
      clear(list).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
      let rows = []; try { rows = await api('sty_requests_list', { p: { status: RQ.st } }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: r.status === 'arrived' ? 'check' : 'bolt', tone: r.status === 'arrived' ? 'green' : r.status === 'open' ? 'orange' : 'gray', title: r.description, sub: [r.name, r.phone, [r.colour, r.size].filter(Boolean).join(' '), r.qty > 1 ? '× ' + r.qty : '', fmtDT(r.createdAt)].filter(Boolean).join(' · '), value: t(RQ_LABEL[r.status] || r.status), chevron: true, onclick: () => open(r) }))
        : [empty('bolt', t('No requests'), t('When a customer asks for something you do not have, note it here from the Sell screen.'))]));
    }
    function open(r) {
      const note = input({ value: r.staffNote || '', placeholder: t('Note') }); const wa = String(r.phone || '').replace(/\D/g, '');
      const set = (st) => async (close) => { await api('sty_request_set', { p_id: r.id, p: { status: st, staffNote: note.value } }); toast(t('Saved')); close(); load(); };
      sheet({ title: r.description, closeLabel: t('Done'), body: h('div', { class: 'grid' },
        h('div', { class: 'card grid' }, h('b', null, r.name || t('Customer')), h('div', { class: 'muted small' }, r.phone || t('No phone given')), r.styleName ? h('div', { class: 'small' }, t('Linked item') + ': ' + r.styleName) : null,
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, r.phone ? h('a', { class: 'btn sm', href: 'tel:' + r.phone }, icon('phone', 16), t('Call')) : null, wa ? h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: 'https://wa.me/' + (wa.length === 10 ? '91' + wa : wa) }, icon('share', 16), 'WhatsApp') : null)),
        field(t('Note'), note), h('div', { class: 'muted small' }, t('Marking Ordered or In stock sends the customer one message (if WhatsApp is on for your shop). Stock you receive for a linked item marks it In stock by itself.'))),
        actions: [r.status === 'open' ? { label: t('Mark as ordered'), primary: true, onclick: set('ordered') } : null, ['open', 'ordered'].includes(r.status) ? { label: t('It is in stock'), onclick: set('arrived') } : null,
          r.status === 'arrived' ? { label: t('Given to customer'), primary: true, onclick: set('fulfilled') } : null, !['fulfilled', 'cancelled'].includes(r.status) ? { label: t('Cancel request'), danger: true, onclick: set('cancelled') } : null] });
    }
    load();
  },
});
