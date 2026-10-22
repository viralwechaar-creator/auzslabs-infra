/* AUZsStyle: collections. A named group of styles ("Summer 2026"). Made and filled in Stock; used as a filter on the till. */
'use strict';
const COL = { list: [], at: 0 };
async function loadCollections(force) {
  if (!force && COL.at && Date.now() - COL.at < 60000) return COL.list;
  try { COL.list = await api('sty_collections_list') || []; COL.at = Date.now(); } catch (e) { /* keep the old list */ }
  return COL.list;
}
function collectionsOf(styleId) { return COL.list.filter((c) => (c.styleIds || []).includes(styleId)); }
// all collections: open one to see and change what is in it
async function collectionsSheet(done) {
  const host = h('div', { class: 'list' });
  const paint = async (force) => {
    const rows = await loadCollections(force);
    clear(host).append(...(rows.length ? rows.map((c) => liRow({ icon: 'tag', title: c.name, sub: (c.styleIds || []).length + ' ' + t('styles') + (c.note ? ' · ' + c.note : ''), chevron: true, onclick: () => { sh.close(); collectionSheet(c, done); } }))
      : [empty('tag', t('No collections yet'), t('Make one, then add styles to it.'))]));
  };
  const sh = sheet({ title: t('Collections'), closeLabel: t('Done'), body: h('div', { class: 'grid' }, host),
    actions: can('sty_manage') ? [{ label: t('New collection'), primary: true, onclick: (close) => { close(); collectionForm(null, done); return false; } }] : [], onClose: () => done && done() });
  paint(true);
}
function collectionForm(c, done) {
  const nm = input({ value: c ? c.name : '', placeholder: t('Summer 2026') }), note = input({ value: c && c.note ? c.note : '', placeholder: t('Note (optional)') });
  let img = (c && c.image) || ''; const imgHost = h('div', { class: 'pe-row' });
  const paintImg = () => clear(imgHost).append(h('div', { class: 'pe-main' }, img ? h('img', { src: img, alt: '' }) : icon('camera', 28)),
    h('div', { class: 'grid', style: { gap: '6px', alignContent: 'start' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => { const i = h('input', { type: 'file', accept: 'image/*', class: 'hidden' }); document.body.append(i); i.onchange = async () => { const f = i.files[0]; i.remove(); if (!f) return; try { img = await uploadPhoto(f); paintImg(); } catch (e) { toast(e.message || t('Failed'), { err: true }); } }; i.click(); } }, icon('camera', 16), img ? t('Change') : t('Add picture')),
      img ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { img = ''; paintImg(); } }, t('Remove')) : null));
  paintImg();
  sheet({ title: c ? t('Edit collection') : t('New collection'), body: h('div', { class: 'grid' }, field(t('Name'), nm), field(t('Note'), note), h('div', { class: 'field' }, h('label', null, t('Collection picture')), h('div', { class: 'hint' }, t('Shown on the store for this collection. Without one, a picture of a style in it is used.')), imgHost)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => {
      if (!nm.value.trim()) { toast(t('Enter a name'), { err: true }); return false; }
      try { const r = await api('sty_collection_save', { p: { id: c && c.id, name: nm.value, note: note.value, image: img } }); COL.at = 0; close(); const list = await loadCollections(true); const made = list.find((x) => x.id === r.id); toast(t('Saved')); made ? collectionSheet(made, done) : collectionsSheet(done); }
      catch (e) { toast(e.message || t('Failed'), { err: true }); return false; }
    } }] });
}
// one collection: its styles, add more, remove, rename, delete
function collectionSheet(c, done) {
  const ids = new Set(c.styleIds || []);
  const host = h('div', { class: 'list' });
  const paint = () => {
    const rows = S.cat.filter((s) => ids.has(s.id));
    clear(host).append(...(rows.length ? rows.map((s) => liRow({ icon: 'shirt', title: s.name, sub: [s.category, inr(s.price)].filter(Boolean).join(' · '),
      right: can('sty_manage') ? h('button', { class: 'btn sm plain', type: 'button', onclick: async () => { try { await api('sty_collection_members', { p_id: c.id, p_remove: [s.id] }); ids.delete(s.id); COL.at = 0; paint(); } catch (e) { toast(e.message || t('Failed'), { err: true }); } } }, t('Remove')) : null }))
      : [empty('shirt', t('Nothing here yet'), t('Add styles to this collection.'))]));
  };
  paint();
  const sh = sheet({ title: c.name, closeLabel: t('Done'), body: h('div', { class: 'grid' }, c.note ? h('p', { class: 'muted small' }, c.note) : null, host,
    can('sty_manage') ? h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn fill', type: 'button', onclick: () => { sh.close(); stylePicker(c, ids, () => collectionSheet(Object.assign({}, c, { styleIds: [...ids] }), done)); } }, icon('plus', 18), t('Add styles')),
      h('button', { class: 'btn', type: 'button', onclick: () => { sh.close(); collectionForm(c, done); } }, icon('edit', 18), t('Rename')),
      h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!await confirmBox(t('Delete this collection?'), t('The styles stay. Only the group is removed.'), t('Delete'), true)) return; try { await api('sty_collection_delete', { p_id: c.id }); COL.at = 0; sh.close(); toast(t('Deleted')); collectionsSheet(done); } catch (e) { toast(e.message || t('Failed'), { err: true }); } } }, t('Delete'))) : null),
    onClose: () => done && done() });
}
// choose styles to put into a collection
function stylePicker(c, ids, back) {
  const chosen = new Set(); let q = '';
  const host = h('div', { class: 'list' });
  const paint = () => {
    const ql = q.trim().toLowerCase();
    const rows = S.cat.filter((s) => s.active !== false && !ids.has(s.id) && (!ql || (s.name + ' ' + (s.category || '') + ' ' + (s.code || '')).toLowerCase().includes(ql))).slice(0, 200);
    clear(host).append(...(rows.length ? rows.map((s) => { const on = chosen.has(s.id); return liRow({ icon: on ? 'check' : 'shirt', title: s.name, sub: [s.category, inr(s.price)].filter(Boolean).join(' · '), sel: on, onclick: () => { on ? chosen.delete(s.id) : chosen.add(s.id); paint(); } }); })
      : [empty('shirt', t('No more styles'), '')]));
  };
  paint();
  sheet({ title: t('Add styles'), closeLabel: t('Cancel'), body: h('div', { class: 'grid' }, searchField(t('Search styles'), (x) => { q = x; paint(); }), host), onClose: () => back && back(),
    actions: [{ label: t('Add'), primary: true, onclick: async (close) => {
      if (!chosen.size) { close(); return; }
      try { await api('sty_collection_members', { p_id: c.id, p_add: [...chosen] }); chosen.forEach((x) => ids.add(x)); COL.at = 0; toast(chosen.size + ' ' + t('added')); close(); }
      catch (e) { toast(e.message || t('Failed'), { err: true }); return false; }
    } }] });
}
// from one style: tick the collections it belongs to
async function styleCollectionsSheet(s, done) {
  const list = await loadCollections(true);
  const mine = new Set(list.filter((c) => (c.styleIds || []).includes(s.id)).map((c) => c.id)); const before = new Set(mine);
  const host = h('div', { class: 'list' });
  const paint = () => clear(host).append(...(list.length ? list.map((c) => { const on = mine.has(c.id); return liRow({ icon: on ? 'check' : 'tag', title: c.name, sub: (c.styleIds || []).length + ' ' + t('styles'), sel: on, onclick: () => { on ? mine.delete(c.id) : mine.add(c.id); paint(); } }); })
 : [empty('tag', t('No collections yet'), t('Make one first.'))]));
  paint();
  sheet({ title: t('Add to collection'), closeLabel: t('Cancel'), body: h('div', { class: 'grid' }, h('p', { class: 'muted small' }, s.name), host,
    h('button', { class: 'btn', type: 'button', onclick: () => { const nm = input({ placeholder: t('Summer 2026') });
      sheet({ title: t('New collection'), body: h('div', { class: 'grid' }, field(t('Name'), nm)), actions: [{ label: t('Create and add'), primary: true, onclick: async (close) => {
        if (!nm.value.trim()) { toast(t('Enter a name'), { err: true }); return false; }
        try { const r = await api('sty_collection_save', { p: { name: nm.value } }); await api('sty_collection_members', { p_id: r.id, p_add: [s.id] }); COL.at = 0; close(); toast(t('Saved')); done && done(); }
        catch (e) { toast(e.message || t('Failed'), { err: true }); return false; } } }] }); } }, icon('plus', 18), t('New collection'))),
    actions: can('sty_manage') ? [{ label: t('Save'), primary: true, onclick: async (close) => {
      try {
        for (const c of list) { const was = before.has(c.id), now = mine.has(c.id); if (was !== now) await api('sty_collection_members', { p_id: c.id, p_add: now ? [s.id] : null, p_remove: now ? null : [s.id] }); }
        COL.at = 0; close(); toast(t('Saved')); done && done();
      } catch (e) { toast(e.message || t('Failed'), { err: true }); return false; }
    } }] : [] });
}
