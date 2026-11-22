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

    // ---------- job & company (HR-set, read-only here) ----------
    const jobCard = h('div', { class: 'card' }, h('h3', null, 'Job & company'), h('div', { class: 'skel', style: { height: '80px' } }));
    v.root.append(jobCard);
    async function paintJob() {
      const d = await api('sos_staff_profile_get', {});
      clear(jobCard).append(h('h3', null, 'Job & company'),
        h('p', { class: 'muted small' }, 'Set by your manager or admin — ask them to update anything here.'),
        h('div', { class: 'list' },
          liRow({ title: 'Employee ID', sub: d.employee_code || 'Not set' }),
          liRow({ title: 'Department', sub: d.department || 'Not set' }),
          liRow({ title: 'Designation', sub: d.designation || 'Not set' }),
          liRow({ title: 'Employment type', sub: d.employment_type ? cap1(d.employment_type.replace('_', ' ')) : 'Not set' }),
          liRow({ title: 'Work location', sub: d.work_location || 'Not set' }),
          liRow({ title: 'Joining date', sub: d.joining_date ? fmtD(d.joining_date) : 'Not set' }),
          liRow({ title: 'Probation ends', sub: d.probation_end_date ? fmtD(d.probation_end_date) : 'Not set' }),
          liRow({ title: 'Working days', sub: d.working_days || 'Not set' }),
          liRow({ title: 'Shift timing', sub: d.shift_timing || 'Not set' }),
          liRow({ title: 'Weekly off', sub: d.weekly_off || 'Not set' })));
      return d;
    }
    const jobData = await paintJob();

    // ---------- personal, address, education, previous employment, emergency contact ----------
    const f = (k, type) => input({ value: jobData[k] != null ? String(jobData[k]) : '', type: type || 'text' });
    const dob = f('dob', 'date'), gender = f('gender'), fatherName = f('father_name'), motherName = f('mother_name'), maritalStatus = f('marital_status'), nationality = f('nationality');
    const addrCurrent = h('textarea', { class: 'input', rows: 2 }, jobData.addr_current || '');
    const addrPermanent = h('textarea', { class: 'input', rows: 2 }, jobData.addr_permanent || '');
    const city = f('city'), state = f('state'), country = f('country'), pincode = f('pincode');
    const highestQualification = f('highest_qualification'), institution = f('institution'), course = f('course'), specialization = f('specialization'), passingYear = f('passing_year', 'number'), percentage = f('percentage');
    const prevCompany = f('prev_company'), prevDesignation = f('prev_designation'), prevJoiningDate = f('prev_joining_date', 'date'), prevLastWorkingDate = f('prev_last_working_date', 'date'), prevLastSalary = f('prev_last_salary', 'number'), prevExperienceYears = f('prev_experience_years', 'number'), prevReasonLeaving = f('prev_reason_leaving');
    const emgName = f('emg_name'), emgRelation = f('emg_relation'), emgPhone = f('emg_phone', 'tel'), emgAltPhone = f('emg_alt_phone', 'tel');
    const emgAddress = h('textarea', { class: 'input', rows: 2 }, jobData.emg_address || '');
    const detailsSaveBtn = h('button', { class: 'btn fill', type: 'button' }, 'Save details');
    const detailsMsg = h('span', { class: 'small muted' });
    detailsSaveBtn.onclick = async () => {
      detailsSaveBtn.disabled = true; detailsMsg.textContent = '';
      const p = {
        dob: dob.value, gender: gender.value, fatherName: fatherName.value, motherName: motherName.value, maritalStatus: maritalStatus.value, nationality: nationality.value,
        addrCurrent: addrCurrent.value, addrPermanent: addrPermanent.value, city: city.value, state: state.value, country: country.value, pincode: pincode.value,
        highestQualification: highestQualification.value, institution: institution.value, course: course.value, specialization: specialization.value, passingYear: passingYear.value, percentage: percentage.value,
        prevCompany: prevCompany.value, prevDesignation: prevDesignation.value, prevJoiningDate: prevJoiningDate.value, prevLastWorkingDate: prevLastWorkingDate.value, prevLastSalary: prevLastSalary.value, prevExperienceYears: prevExperienceYears.value, prevReasonLeaving: prevReasonLeaving.value,
        emgName: emgName.value, emgRelation: emgRelation.value, emgPhone: emgPhone.value, emgAltPhone: emgAltPhone.value, emgAddress: emgAddress.value,
      };
      try { await api('sos_staff_profile_save_self', { p }); detailsMsg.textContent = 'Saved.'; toast('Details saved'); } catch (e) { fail(e); } finally { detailsSaveBtn.disabled = false; }
    };
    v.root.append(
      h('div', { class: 'card' }, h('h3', null, 'Personal details'),
        h('div', { class: 'grid' }, field('Date of birth', dob), field('Gender', gender), field('Father’s name', fatherName), field('Mother’s name', motherName), field('Marital status', maritalStatus), field('Nationality', nationality))),
      h('div', { class: 'card' }, h('h3', null, 'Address'),
        h('div', { class: 'grid' }, field('Current address', addrCurrent), field('Permanent address', addrPermanent), field('City', city), field('State', state), field('Country', country), field('PIN code', pincode))),
      h('div', { class: 'card' }, h('h3', null, 'Education'),
        h('div', { class: 'grid' }, field('Highest qualification', highestQualification), field('Institution', institution), field('Course', course), field('Specialization', specialization), field('Passing year', passingYear), field('Percentage / CGPA', percentage))),
      h('div', { class: 'card' }, h('h3', null, 'Previous employment'),
        h('div', { class: 'grid' }, field('Company', prevCompany), field('Designation', prevDesignation), field('Joining date', prevJoiningDate), field('Last working date', prevLastWorkingDate), field('Last salary', prevLastSalary), field('Experience (years)', prevExperienceYears), field('Reason for leaving', prevReasonLeaving))),
      h('div', { class: 'card' }, h('h3', null, 'Emergency contact'),
        h('div', { class: 'grid' }, field('Name', emgName), field('Relationship', emgRelation), field('Phone', emgPhone), field('Alternate phone', emgAltPhone), field('Address', emgAddress),
          h('div', { class: 'row' }, h('span', { class: 'grow' }), detailsSaveBtn, detailsMsg))));

    // ---------- identity documents numbers, salary & banking (sensitive) ----------
    const sCard = h('div', { class: 'card' }, h('h3', null, 'Identity & banking'), h('div', { class: 'skel', style: { height: '80px' } }));
    v.root.append(sCard);
    async function paintSensitive() {
      const d = await api('sos_staff_sensitive_get', {});
      const aadhaar = input({ value: d.aadhaar || '' }), pan = input({ value: d.pan || '' }), drivingLicence = input({ value: d.driving_licence || '' }), voterId = input({ value: d.voter_id || '' }), passport = input({ value: d.passport || '' });
      const basicSalary = input({ value: d.basic_salary != null ? String(d.basic_salary) : '', type: 'number' }), hra = input({ value: d.hra != null ? String(d.hra) : '', type: 'number' }), otherAllowances = input({ value: d.other_allowances != null ? String(d.other_allowances) : '', type: 'number' });
      const bankName = input({ value: d.bank_name || '' }), accountHolder = input({ value: d.account_holder || '' }), accountNumber = input({ value: d.account_number || '' }), ifsc = input({ value: d.ifsc || '' }), uan = input({ value: d.uan || '' }), esic = input({ value: d.esic || '' });
      const sBtn = h('button', { class: 'btn fill', type: 'button' }, 'Save'); const sMsg = h('span', { class: 'small muted' });
      sBtn.onclick = async () => {
        sBtn.disabled = true; sMsg.textContent = '';
        const p = { aadhaar: aadhaar.value, pan: pan.value, drivingLicence: drivingLicence.value, voterId: voterId.value, passport: passport.value,
          basicSalary: basicSalary.value, hra: hra.value, otherAllowances: otherAllowances.value,
          bankName: bankName.value, accountHolder: accountHolder.value, accountNumber: accountNumber.value, ifsc: ifsc.value, uan: uan.value, esic: esic.value };
        try { await api('sos_staff_sensitive_save', { p_user: null, p }); sMsg.textContent = 'Saved.'; toast('Saved'); } catch (e) { fail(e); } finally { sBtn.disabled = false; }
      };
      clear(sCard).append(h('h3', null, 'Identity & banking'),
        h('p', { class: 'muted small' }, 'Only you and an Admin can see this — your manager cannot.'),
        h('div', { class: 'grid' }, field('Aadhaar number', aadhaar), field('PAN', pan), field('Driving licence', drivingLicence), field('Voter ID', voterId), field('Passport', passport),
          h('div', { class: 'label' }, 'Salary'), field('Basic salary', basicSalary), field('HRA', hra), field('Other allowances', otherAllowances),
          h('div', { class: 'label' }, 'Bank details'), field('Bank name', bankName), field('Account holder', accountHolder), field('Account number', accountNumber), field('IFSC', ifsc), field('UAN', uan), field('ESIC', esic),
          h('div', { class: 'row' }, h('span', { class: 'grow' }), sBtn, sMsg)));
    }
    paintSensitive();

    // ---------- company assets ----------
    const assetsList = h('div', { class: 'list' }, h('div', { class: 'skel', style: { height: '56px' } }));
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Company assets'), h('p', { class: 'muted small' }, 'Equipment and property assigned to you.'), assetsList));
    async function paintAssets() {
      const rows = await api('sos_staff_assets_list', {});
      clear(assetsList);
      if (!rows.length) { assetsList.append(empty('box', 'No assets assigned')); return; }
      rows.forEach((a) => assetsList.append(liRow({ icon: 'box', title: a.asset_type + (a.asset_detail ? ' — ' + a.asset_detail : ''), sub: (a.status === 'returned' ? 'Returned ' + fmtD(a.return_date) : 'Issued ' + fmtD(a.issue_date)), badge: badge(a.status === 'returned' ? 'Returned' : 'With you', a.status === 'returned' ? '' : 'green') })));
    }
    paintAssets();

    // ---------- documents ----------
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
        list.append(liRow({ icon: 'doc', title: d.label + (d.category ? ' (' + cap1(d.category) + ')' : ''), sub: d.filename ? 'Uploaded ' + fmtD(d.uploaded_at) : 'Not uploaded yet', right: h('div', { class: 'row', style: { gap: '4px' } }, viewBtn, uploadBtn, delBtn, fileInput) }));
      });
    }
    paintDocs();
    const DOC_CHECKLIST = ['Profile photograph', 'Aadhaar card', 'PAN card', 'Address proof', 'Educational certificates', 'Previous experience letter', 'Relieving letter', 'Updated resume', 'Bank account proof', 'Signed offer letter', 'Signed employment agreement', 'Other'];
    async function addDocFlow() {
      const pick = await alertBox({ title: 'Which document?', actions: DOC_CHECKLIST.map((lbl) => ({ label: lbl, value: lbl })).concat([{ label: 'Cancel', value: null }]) });
      if (!pick) return;
      const label = pick === 'Other' ? await askText('Document name', null, 'e.g. Degree certificate') : pick;
      if (!label) return;
      try { await api('sos_document_create', { p_label: label, p_category: pick === 'Other' ? null : pick.toLowerCase().replace(/[^a-z]+/g, '_') }); toast('Added — now upload the file'); paintDocs(); } catch (e) { fail(e); }
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
