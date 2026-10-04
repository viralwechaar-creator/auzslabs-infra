/* AUZsMob: Settings -- shop details, the staff-visibility switch, language, staff list, the integrity
   check (section 6: "A built-in integrity check ... shown in Settings"), and the owner's full export. */
'use strict';
page('settings', { title: 'settings', perm: 'mob_view', render: renderSettings });

async function renderSettings(v) {
  v.header({ title: t('settings') });
  const s = S.ctx.settings;
  const isOwner = S.user.role === 'owner';

  const root = v.root;
  add(root, [
    section(t('language'), seg([['en', 'English'], ['hi', 'हिंदी']], S_LANG, (val) => saveLang(val), { full: true })),
    isOwner ? shopDetailsCard(s, v) : null,
    isOwner ? featuresCard(v) : null,
    isOwner ? h('div', { class: 'list' }, liRow({ icon: 'gear', title: t('staffSeeRates'), right: h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!s.staffSeePurchaseRates, onchange: async (e) => { await api('mob_save_settings', { p: { staffSeePurchaseRates: e.target.checked } }); S.ctx = await api('mob_context'); toast(t('saved')); } })) })) : null,
    can('mob_reports') ? h('div', { id: 'staff-box' }, h('div', { class: 'skel', style: { height: '80px' } })) : null,
    can('mob_reports') ? h('div', { id: 'integrity-box' }) : null,
    isOwner ? h('button', { class: 'btn wide', type: 'button', onclick: async () => { const data = await api('mob_export_all'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'auzsmob-export.json' }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); } }, icon('download', 18), t('exportData')) : null,
  ]);

  if (can('mob_reports')) {
    try {
      const names = await api('mob_staff_list');
      if (root.isConnected) clear($('#staff-box')).append(section(t('staff'), h('div', { class: 'list' }, names.map((n) => liRow({ icon: 'user', title: n.name, sub: n.role })))));
    } catch (e) { if (root.isConnected) clear($('#staff-box')).append(banner('bad', 'alert', e.message)); }
    try {
      const integ = await api('mob_integrity_check');
      if (root.isConnected) clear($('#integrity-box')).append(section(t('integrityCheck'),
        banner(integ.ok ? 'ok' : 'bad', integ.ok ? 'check' : 'alert', integ.ok ? t('allGood') : t('problemsFound')),
        h('div', { class: 'list' }, integ.checks.map((c) => liRow({ icon: c.ok ? 'check' : 'alert', tone: c.ok ? '' : 'red', title: c.name, sub: c.ok ? null : c.detail })))));
    } catch (e) { /* non-owner-visible tenants etc: quietly skip */ }
  }
}

function shopDetailsCard(s, v) {
  const shopName = input({ value: s.shopName, label: t('shopName') });
  const address = input({ value: s.address, label: t('address') });
  const phone = input({ value: s.phone, label: t('phone'), mode: 'tel' });
  const footer = input({ value: s.billFooter, label: t('billFooter') });
  return section(t('shopDetails'), h('div', { class: 'grid' },
    field(t('shopName'), shopName), field(t('address'), address), field(t('phone'), phone), field(t('billFooter'), footer),
    h('button', { class: 'btn fill', type: 'button', onclick: async () => {
      await api('mob_save_settings', { p: { shopName: shopName.value.trim(), address: address.value.trim(), phone: phone.value.trim(), billFooter: footer.value.trim() } });
      S.ctx = await api('mob_context'); toast(t('saved'));
    } }, t('save')),
  ));
}

// Shop feature switches (db/093). Saved as one object; the server enforces every one of them (MB010), so turning
// something off here also stops it for anyone calling the API directly, not just hides a button.
const SIMPLE_PRESET = { sell: true, purchase: true, repairs: 'simple', stock: false, serials: false, customers: false, vendors: false, dayclose: false };
const FULL_PRESET = { sell: true, purchase: true, repairs: 'full', stock: true, serials: true, customers: true, vendors: true, dayclose: true };
function featuresCard(v) {
  const cur = feats();
  const save = async (next, keepRates) => {
    try {
      const body = { features: next };
      if (keepRates) body.staffSeePurchaseRates = true;
      await api('mob_save_settings', { p: body });
      S.ctx = await api('mob_context');
      buildShell(); toast(t('saved')); v.refresh();
    } catch (e) { fail(e); }
  };
  const sw = (key, label, hint) => liRow({ icon: 'gear', title: label, sub: hint,
    right: h('span', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: cur[key] !== false && cur[key] !== 'off', onchange: (e) => save({ ...cur, [key]: e.target.checked }) })) });
  return section(t('featuresTitle'),
    h('div', { class: 'row', style: { gap: '8px', marginBottom: '10px' } },
      h('button', { class: 'btn', type: 'button', onclick: () => save(SIMPLE_PRESET, true) }, t('presetSimple')),
      h('button', { class: 'btn', type: 'button', onclick: () => save(FULL_PRESET) }, t('presetFull'))),
    h('div', { class: 'list' },
      sw('sell', t('featSell'), t('featSellHint')),
      sw('purchase', t('featPurchase'), t('featPurchaseHint')),
      sw('stock', t('featStock'), t('featStockHint')),
      sw('serials', t('featSerials'), t('featSerialsHint')),
      sw('customers', t('featCustomers'), t('featCustomersHint')),
      sw('vendors', t('featVendors'), t('featVendorsHint')),
      sw('dayclose', t('featDayclose'), t('featDaycloseHint'))),
    section(t('featRepairs'), seg([['off', t('repairsOff')], ['simple', t('repairsSimple')], ['full', t('repairsFull')]], repairsMode(), (val) => save({ ...cur, repairs: val }), { full: true }),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, t('featRepairsHint'))));
}
