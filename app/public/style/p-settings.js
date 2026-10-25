/* AUZsStyle: Settings (manager). Shop details, selling rules, tax, loyalty, analytics tuning, branches, day close, health check. */
'use strict';
function installCard() {
  const box = h('div', { class: 'card grid' });
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const draw = async () => {
    clear(box);
    let cached = false;
    try { cached = !!(await caches.match('/style.html')); } catch {}
    box.append(h('p', { class: 'muted small' }, t('Install AUZsStyle on this computer. It opens in its own window like any program and keeps selling when the internet is off. Bills made offline are sent by themselves when the internet is back.')));
    box.append(banner(cached ? 'ok' : 'warn', cached ? 'check' : 'alert', cached ? t('Ready to work offline on this computer') : t('Open this page once with internet so it can get ready for offline use')));
    if (standalone) box.append(h('div', { class: 'cap' }, t('You are using the installed app')));
    else if (window.AUZ_INSTALL) box.append(h('button', { class: 'btn', type: 'button', onclick: async () => { const e = window.AUZ_INSTALL; e.prompt(); try { await e.userChoice; } catch {} window.AUZ_INSTALL = null; draw(); } }, t('Install on this computer')));
    else box.append(h('div', { class: 'cap' }, t('In Chrome or Edge: open the menu (three dots) and choose Install AUZsStyle, or press the install icon at the right end of the address bar.')));
  };
  document.addEventListener('auz:installable', draw);
  draw();
  return box;
}
page('settings', {
  title: 'Settings', perm: 'sty_manage',
  async render(v) {
    v.header({ title: t('Settings') });
    const st = S.ctx.settings;
    const feat = (st.features && typeof st.features === 'object') ? st.features : {};
    const F = {
      upiId: input({ value: feat.upiId || '', placeholder: 'name@bank', mode: 'email' }), upiName: input({ value: feat.upiName || '', placeholder: t('Name shown to the customer') }),
      shopName: input({ value: st.shopName || '' }), address: input({ value: st.address || '' }), phone: input({ value: st.phone || '', mode: 'tel' }), gstin: input({ value: st.gstin || '' }), billFooter: input({ value: st.billFooter || '', placeholder: 'Thank you, visit again' }), billPrefix: input({ value: st.billPrefix || 'AS', max: 6 }),
      maxDiscountPct: input({ type: 'number', mode: 'decimal', value: st.maxDiscountPct }), returnDays: input({ type: 'number', mode: 'numeric', value: st.returnDays }),
      defaultTaxPct: input({ type: 'number', mode: 'decimal', value: st.defaultTaxPct }), loyaltyEarnPct: input({ type: 'number', mode: 'decimal', value: st.loyaltyEarnPct }), loyaltyPointValue: input({ type: 'number', mode: 'decimal', value: st.loyaltyPointValue }),
      leadDays: input({ type: 'number', mode: 'numeric', value: st.leadDays }), coverDays: input({ type: 'number', mode: 'numeric', value: st.coverDays }), slowDays: input({ type: 'number', mode: 'numeric', value: st.slowDays }),
    };
    const sw = (key, label, hint) => { const c = h('input', { type: 'checkbox', checked: !!st[key], onchange: () => { st[key] = c.checked; } }); return h('label', { class: 'swrow' }, h('div', { class: 'grow' }, h('div', null, label), hint ? h('div', { class: 'muted small' }, hint) : null), c); };
    // shop logo: becomes the home-screen icon (the picture is centred on a tile) and is kept on the shop's own bills later
    let logoUrl = st.logoUrl || '';
    const logoImg = h('div', { class: 'logo-prev' }), logoBtns = h('div', { class: 'row', style: { gap: '8px' } });
    const paintLogo = () => {
      clear(logoImg).append(logoUrl ? h('img', { src: logoUrl, alt: '' }) : icon('shirt', 26));
      const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { logoUrl = await uploadPhoto(f); paintLogo(); toast(t('Logo ready, press Save settings')); } catch (er) { fail(er); } } });
      clear(logoBtns).append(file, h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, icon('camera', 16), logoUrl ? t('Change logo') : t('Upload logo')), logoUrl ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { logoUrl = ''; paintLogo(); } }, t('Remove')) : null);
    };
    // separate home-screen icon: used exactly as uploaded, edge to edge (a square picture, 512 x 512 is ideal)
    let appIcon = feat.appIcon || '';
    const iconImg = h('div', { class: 'logo-prev' }), iconBtns = h('div', { class: 'row', style: { gap: '8px' } });
    const paintIcon = () => {
      clear(iconImg).append(appIcon ? h('img', { src: appIcon, alt: '', style: { objectFit: 'cover' } }) : icon('shirt', 26));
      const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { appIcon = await uploadPhoto(f); paintIcon(); toast(t('Icon ready, press Save settings')); } catch (er) { fail(er); } } });
      clear(iconBtns).append(file, h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, icon('camera', 16), appIcon ? t('Change app icon') : t('Upload app icon')), appIcon ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { appIcon = ''; paintIcon(); } }, t('Remove')) : null);
    };
    paintIcon();
    const waCard = () => {
      const host = h('div', { class: 'card grid' }, h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '12px auto' } }));
      const EV = [['invoice_link', t('Bill link after every bill')], ['birthday_greeting', t('Birthday wishes')], ['anniversary_greeting', t('Anniversary wishes')], ['style_winback', t('We miss you (not back in 60 days)')]];
      (async () => {
        let w; try { w = await api('wa_my_status'); } catch (e) { clear(host).append(h('p', { class: 'muted small' }, t('Only the owner or manager can change WhatsApp settings.'))); return; }
        const on = h('input', { type: 'checkbox', checked: !!w.enabled }), ev = {};
        const rows = EV.map(([k, l]) => { const c = h('input', { type: 'checkbox', checked: (w.events || {})[k] !== false }); ev[k] = c; return h('label', { class: 'swrow' }, h('div', { class: 'grow' }, l), c); });
        clear(host).append(
          w.allow_platform ? banner('ok', 'check', t('AUZslab has allowed this shop to send from the AUZslab WhatsApp number.')) : banner('warn', 'alert', t('Ask AUZslab to allow this shop first. Until then nothing is sent.')),
          h('label', { class: 'swrow' }, h('div', { class: 'grow' }, h('b', null, t('Send messages automatically')), h('div', { class: 'muted small' }, t('Needs both: AUZslab allowing the shop, and this switch.'))), on), ...rows,
          h('p', { class: 'muted small' }, t('Messages go only to customers who have a phone number and have not turned messages off.')),
          h('button', { class: 'btn', type: 'button', onclick: async () => { try { const evs = {}; EV.forEach(([k]) => { evs[k] = ev[k].checked; }); await api('wa_save_settings', { p: { enabled: on.checked, events: evs } }); toast(t('Saved')); } catch (e) { fail(e); } } }, t('Save WhatsApp settings')));
      })();
      return host;
    };
    const billTplSel = selectEl(RECEIPT_TEMPLATES.map((d) => [d.id, d.name]), receiptTemplateId());
    const billPrev = h('div', { class: 'tagprev' });
    const paintBillPrev = () => { const sample = { number: 'AS-0001', at: Date.now(), lines: [{ name: 'Classic Shirt', colour: 'Blue', size: 'M', qty: 1, price: 999, net: 999, tax: 47.5 }], subtotal: 999, discount: 0, tax: 47.5, rounding: 0, total: 999, payments: [{ mode: 'cash', amount: 999 }], balance: 0 }; clear(billPrev).append(receiptNode(sample, billTplSel.value)); };
    billTplSel.onchange = paintBillPrev; paintBillPrev();
    const slabs = Array.isArray(st.taxSlabs) ? st.taxSlabs : [];
    const s1 = input({ type: 'number', mode: 'decimal', value: slabs[0] ? slabs[0].upto : '', placeholder: '2500' }), r1 = input({ type: 'number', mode: 'decimal', value: slabs[0] ? slabs[0].rate : '', placeholder: '5' }), r2_ = input({ type: 'number', mode: 'decimal', value: slabs[1] ? slabs[1].rate : '', placeholder: '18' });
    const brHost = h('div', { class: 'list' });
    const paintBr = () => clear(brHost).append(...(S.ctx.branches || []).map((b) => liRow({ icon: 'building', title: b.name, sub: (b.kind === 'warehouse' ? t('Warehouse') : t('Shop')) + (b.isMain ? ' · ' + t('Main') : ''), chevron: true, onclick: () => branchForm(b) })));
    function branchForm(b) {
      const nm = input({ value: b ? b.name : '' }), kd = selectEl([['shop', t('Shop')], ['warehouse', t('Warehouse')]], b ? b.kind : 'shop'), ad = input({ value: b ? b.address || '' : '' });
      sheet({ title: b ? t('Edit branch') : t('New branch'), body: h('div', { class: 'grid' }, field(t('Name'), nm), field(t('Type'), kd), field(t('Address'), ad)), actions: [{ label: t('Save'), primary: true, onclick: async (close) => { S.ctx = await api('sty_save_branch', { p: { id: b && b.id, newId: b ? undefined : uid(), name: nm.value, kind: kd.value, address: ad.value } }); close(); location.reload(); } }] });
    }
    paintBr();
    const dc = input({ type: 'date', value: st.dayCloseDate ? String(st.dayCloseDate).slice(0, 10) : '' });
    const save = h('button', { class: 'btn fill wide', type: 'button', onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        const sl = []; if (N(s1.value) && N(r1.value) >= 0) sl.push({ upto: N(s1.value), rate: N(r1.value) }); if (r2_.value !== '') sl.push({ rate: N(r2_.value) });
        const upi = F.upiId.value.trim(); if (upi && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi)) { toast(t('That UPI id does not look right. It looks like name@bank.'), { err: true }); ev.currentTarget.disabled = false; return; }
        const p = { features: Object.assign({}, feat, { upiId: upi, upiName: F.upiName.value.trim(), appIcon, receiptTemplate: billTplSel.value }), logoUrl, shopName: F.shopName.value, address: F.address.value, phone: F.phone.value, gstin: F.gstin.value, billFooter: F.billFooter.value, billPrefix: F.billPrefix.value, maxDiscountPct: N(F.maxDiscountPct.value), returnDays: Math.round(N(F.returnDays.value)),
          defaultTaxPct: N(F.defaultTaxPct.value), loyaltyEarnPct: N(F.loyaltyEarnPct.value), loyaltyPointValue: N(F.loyaltyPointValue.value), leadDays: Math.round(N(F.leadDays.value)), coverDays: Math.round(N(F.coverDays.value)), slowDays: Math.round(N(F.slowDays.value)),
          allowNegativeStock: st.allowNegativeStock, roundOff: st.roundOff, requireCustomerPhone: st.requireCustomerPhone, staffSeeCost: st.staffSeeCost, priceIncludesTax: st.priceIncludesTax, taxSlabs: sl };
        S.ctx = await api('sty_save_settings', { p }); S.perms = S.ctx.perms; toast(t('Saved')); setTimeout(() => location.reload(), 350);
      } catch (e) { fail(e); } finally { ev.currentTarget && (ev.currentTarget.disabled = false); }
    } }, t('Save settings'));
    v.root.append(h('div', { class: 'grid setg' },
      section(t('Shop'), h('div', { class: 'card grid' }, h('div', { class: 'logo-row' }, logoImg, h('div', { class: 'grow' }, h('div', { class: 'cap' }, t('Shop logo') + ' · ' + t('used for the home-screen icon')), logoBtns)), h('div', { class: 'logo-row' }, iconImg, h('div', { class: 'grow' }, h('div', { class: 'cap' }, t('App icon (home screen)') + ' · ' + t('fills the whole icon')), iconBtns)), field(t('Shop name'), F.shopName), field(t('Address'), F.address), h('div', { class: 'two' }, field(t('Phone'), F.phone), field('GSTIN', F.gstin)), h('div', { class: 'two' }, field(t('Bill prefix'), F.billPrefix), field(t('Bill footer'), F.billFooter)))),
      section(t('Bill template'), h('div', { class: 'card grid' }, h('div', { class: 'muted small' }, t('Switch the look of every printed/shared bill. Turn it on here -- nothing else to install.')), field(t('Design'), billTplSel), billPrev)),
      section(t('Pay by UPI'), h('div', { class: 'card grid' }, h('div', { class: 'muted small' }, t('Your UPI id. At billing, a QR with the exact amount appears so the customer can scan and pay.')), h('div', { class: 'two' }, field(t('UPI id'), F.upiId), field(t('Shown as'), F.upiName)))),
      section(t('Pictures'), h('div', { class: 'card grid' }, h('div', { class: 'mut small' }, t('New pictures are shrunk automatically. Press this once to shrink the old, heavy ones so they load fast on every phone.')), (() => { const out = h('div', { class: 'mut small' }); const b = h('button', { class: 'btn', type: 'button', onclick: async () => { b.disabled = true; try { const r = await lightenPictures((d, n) => { out.textContent = d + ' / ' + n; }); out.textContent = r.changed + ' ' + t('styles lightened') + ' · ' + r.savedKb + ' KB ' + t('saved') + (r.failed ? ' · ' + r.failed + ' ' + t('could not be read') : ''); } catch (e) { toast(e.message || t('Failed'), { err: true }); } b.disabled = false; } }, icon('camera', 16), t('Make old pictures lighter')); return h('div', { class: 'grid' }, b, out); })())),
      section(t('Selling rules'), h('div', { class: 'card grid' }, h('div', { class: 'two' }, field(t('Staff can give discount up to') + ' %', F.maxDiscountPct), field(t('Returns allowed for (days)'), F.returnDays)),
        sw('allowNegativeStock', t('Allow selling with no stock'), t('Useful while stock is not entered yet')), sw('roundOff', t('Round bills to the nearest rupee')), sw('requireCustomerPhone', t('Ask for the customer phone on every bill')), sw('staffSeeCost', t('Let staff see purchase cost and profit')))),
      section(t('Tax (GST)'), h('div', { class: 'card grid' }, sw('priceIncludesTax', t('Prices already include tax')), field(t('Default tax %'), F.defaultTaxPct),
        h('div', { class: 'cap' }, t('Clothing and footwear slabs. Ask your accountant, rates change.')), h('div', { class: 'three' }, field(t('Up to price ₹'), s1), field(t('Tax % up to there'), r1), field(t('Tax % above'), r2_)))),
      section(t('Loyalty'), h('div', { class: 'card grid two' }, field(t('Points earned (% of bill)'), F.loyaltyEarnPct), field(t('1 point is worth ₹'), F.loyaltyPointValue))),
      section(t('Analytics tuning'), h('div', { class: 'card grid' }, h('div', { class: 'three' }, field(t('Supplier delivery (days)'), F.leadDays), field(t('Reorder should cover (days)'), F.coverDays), field(t('Slow if unsold (days)'), F.slowDays)))),
      save,
      section(t('Branches and warehouses'), brHost, h('button', { class: 'btn', type: 'button', onclick: () => branchForm(null) }, icon('plus', 18), t('New branch'))),
      section(t('Day close'), h('div', { class: 'card grid' }, h('p', { class: 'muted small' }, t('Closing a day stops anyone adding or changing bills on or before that date.')), field(t('Closed up to'), dc),
        h('button', { class: 'btn', type: 'button', onclick: async () => { if (!dc.value) return; if (!await confirmBox(t('Close the books?'), t('Bills on or before') + ' ' + dc.value + ' ' + t('cannot be changed after this.'), t('Close day'), true)) return; S.ctx = await api('sty_day_close', { p_date: dc.value }); toast(t('Day closed')); } }, t('Close day')))),
      section(t('Backup'), h('div', { class: 'card grid' },
        h('p', { class: 'muted small' }, t('Download everything -- your inventory, customers and bills -- as one Excel file you can open directly in Excel or Google Sheets. It is a real spreadsheet, not a code file; keep a copy somewhere safe (a pendrive, email, cloud drive).')),
        (() => { const out = h('div', { class: 'muted small' }); const b = h('button', { class: 'btn fill', type: 'button', onclick: async () => { b.disabled = true; out.textContent = t('Preparing…'); try { await backupExcel(); out.textContent = t('Downloaded'); } catch (e) { out.textContent = ''; fail(e); } b.disabled = false; } }, icon('download', 18), t('Download Excel backup')); return h('div', { class: 'grid' }, b, out); })())),
      section(t('Install on this computer'), installCard()),
      section(t('WhatsApp messages'), waCard()),
      section(t('Health check'), h('div', { class: 'card grid' }, h('p', { class: 'muted small' }, t('Checks that bill totals, stock and returns all agree.')), h('div', { id: 'hc' }),
        h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await api('sty_integrity_check'); const el = $('#hc'); clear(el).append(r.ok ? banner('ok', 'check', t('Everything agrees')) : banner('warn', 'alert', r.problems.map((p) => p.check + ' (' + p.count + ')').join('; '))); } }, t('Run check')),
        h('button', { class: 'btn', type: 'button', onclick: async () => { await api('sty_load_sample'); S.catAt = 0; toast(t('Sample added')); } }, t('Add sample styles')))),
    ));
  },
});
