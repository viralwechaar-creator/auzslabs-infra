'use strict';
page('profile', {
  title: 'My profile', icon: 'user', any: true,
  async render(v) {
    const profile = await api('sos_my_profile');
    const nameInput = input({ value: profile.name || '' });
    const phoneInput = input({ value: profile.phone || '', type: 'tel' });
    const saveBtn = h('button', { class: 'btn fill', type: 'button' }, 'Save');
    const saveMsg = h('span', { class: 'small muted' });
    saveBtn.onclick = async () => {
      saveBtn.disabled = true; saveMsg.textContent = '';
      try { await api('sos_profile_update', { p_name: nameInput.value, p_phone: phoneInput.value }); saveMsg.textContent = 'Saved.'; toast('Profile updated'); }
      catch (e) { fail(e); } finally { saveBtn.disabled = false; }
    };
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'About you'),
      h('div', { class: 'grid' },
        field('Name', nameInput), field('Phone', phoneInput),
        h('div', { class: 'row' }, h('span', { class: 'muted small' }, profile.email + ' · ' + profile.role), h('span', { class: 'grow' }), saveBtn, saveMsg))));

    // documents
    const list = h('div', { class: 'list' }, h('div', { class: 'skel', style: { height: '56px' } }));
    const manageList = h('div');
    v.root.append(h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h3', null, 'My documents'), h('button', { class: 'btn fill sm', type: 'button', onclick: () => addDocFlow() }, '+ Add document')),
      h('p', { class: 'muted small' }, 'ID proof, resume, certificates — kept private to you and your manager.'), list));
    if (canManage()) v.root.append(h('div', { class: 'card' }, h('h3', null, 'Team documents'), manageList));

    async function paintDocs() {
      const rows = await api('sos_my_documents');
      clear(list);
      if (!rows.length) { list.append(empty('doc', 'No documents yet', 'Add your ID proof, resume or certificates.')); return; }
      rows.forEach((d) => {
        const fileInput = h('input', { type: 'file', style: { display: 'none' } });
        const uploadBtn = h('button', { class: 'btn plain sm', type: 'button' }, d.filename ? 'Replace' : 'Upload');
        uploadBtn.onclick = () => fileInput.click();
        fileInput.onchange = async () => { if (!fileInput.files[0]) return; try { await uploadStaffDoc(d.id, fileInput.files[0]); toast('Uploaded'); paintDocs(); } catch (e) { fail(e); } };
        const viewBtn = d.filename ? h('button', { class: 'btn plain sm', type: 'button', onclick: () => openStaffDoc(d.id).catch(fail) }, 'View') : null;
        const delBtn = h('button', { class: 'btn plain sm danger', type: 'button' }, 'Remove');
        delBtn.onclick = async () => { if (!(await confirmBox('Remove ' + d.label + '?', 'This cannot be undone.', 'Remove', true))) return; try { await api('sos_document_delete', { p_id: d.id }); toast('Removed'); paintDocs(); } catch (e) { fail(e); } };
        list.append(liRow({ icon: 'doc', title: d.label, sub: d.filename ? 'Uploaded ' + fmtD(d.uploaded_at) : 'Not uploaded yet', right: h('div', { class: 'row', style: { gap: '4px' } }, viewBtn, uploadBtn, delBtn, fileInput) }));
      });
    }
    paintDocs();
    async function addDocFlow() {
      const label = await askText('Document name', 'e.g. Aadhaar card, PAN card, resume, degree certificate', 'Document name');
      if (!label) return;
      try { await api('sos_document_create', { p_label: label }); toast('Added — now upload the file'); paintDocs(); } catch (e) { fail(e); }
    }
    async function paintManageDocs() {
      if (!canManage()) return;
      const rows = await api('sos_all_documents');
      clear(manageList);
      if (!rows.length) { manageList.append(empty('doc', 'No team documents yet')); return; }
      manageList.append(h('div', { class: 'list' }, rows.map((d) => liRow({ icon: 'doc', title: d.label, sub: d.staffName, badge: badge(d.uploaded ? 'On file' : 'Pending', d.uploaded ? 'green' : 'orange') }))));
    }
    paintManageDocs();
  },
});
