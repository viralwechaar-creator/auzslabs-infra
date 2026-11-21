'use strict';
page('surveys', {
  title: 'Surveys', icon: 'survey', field: true,
  async render(v) {
    const list = h('div', { class: 'list' }, h('div', { class: 'skel', style: { height: '60px' } }));
    v.root.append(h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h3', null, 'Templates'),
      canManage() ? h('button', { class: 'btn fill sm', type: 'button', onclick: () => templateFlow() }, '+ New template') : null), list,
      h('p', { class: 'muted small' }, 'To fill a survey, open a checked-in visit under Field & visits and tap Survey.')));
    async function paint() {
      const rows = await api('sos_survey_templates_list', { p_active_only: false });
      clear(list);
      if (!rows.length) { list.append(empty('survey', 'No templates yet', canManage() ? 'Create one to start collecting market intelligence.' : 'Ask a manager to add one.')); return; }
      rows.forEach((t) => list.append(liRow({ icon: 'survey', title: t.name, sub: (t.category || 'No category') + ' · ' + t.questions.length + ' question' + (t.questions.length === 1 ? '' : 's'), badge: t.active ? null : badge('Inactive', '') })));
    }
    paint();
    async function templateFlow() {
      const nameInput = input({ placeholder: 'Template name' });
      const catInput = input({ placeholder: 'Category, e.g. retail, cafe' });
      const questions = [];
      const qList = h('div', { class: 'grid' });
      function paintQ() {
        clear(qList);
        questions.forEach((q, i) => qList.append(h('div', { class: 'row', style: { gap: '8px' } },
          h('span', { class: 'small muted' }, String(i + 1) + '.'), h('span', { class: 'grow' }, q.label + ' (' + q.kind + (q.required ? ', required' : '') + ')'),
          h('button', { class: 'btn icon plain sm', type: 'button', onclick: () => { questions.splice(i, 1); paintQ(); } }, icon('x', 16)))));
      }
      const addBtn = h('button', { class: 'btn sm', type: 'button' }, '+ Add question');
      addBtn.onclick = async () => {
        const label = await askText('Question', null, 'e.g. What POS software do they currently use?');
        if (!label) return;
        const kind = await alertBox({ title: 'Answer type', actions: [['text', 'Text'], ['number', 'Number'], ['yes_no', 'Yes / No'], ['single_choice', 'Single choice'], ['multiple_choice', 'Multiple choice'], ['dropdown', 'Dropdown'], ['date', 'Date']].map(([val, label2]) => ({ label: label2, value: val, role: val === 'text' ? 'def' : '' })).concat([{ label: 'Cancel', value: null }]) });
        if (!kind) return;
        let options = null;
        if (['single_choice', 'multiple_choice', 'dropdown'].includes(kind)) {
          const raw = await askText('Options', 'Comma-separated, e.g. Tally, Zoho, None');
          options = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
        }
        const required = await confirmBox('Required?', 'Field staff must answer this before submitting.', 'Required');
        questions.push({ label, kind, options, required: !!required });
        paintQ();
      };
      const s = sheet({ title: 'New survey template', wide: true, closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Name', nameInput), field('Category', catInput), section('Questions', qList, addBtn)),
        actions: [{ label: 'Save', primary: true, onclick: async () => {
          if (!nameInput.value.trim()) { toast('Enter a template name', { err: true }); return false; }
          if (!questions.length) { toast('Add at least one question', { err: true }); return false; }
          try { await api('sos_survey_template_save', { p: { name: nameInput.value.trim(), category: catInput.value.trim(), questions } }); s.close(); toast('Template saved'); paint(); } catch (e) { fail(e); return false; }
        } }] });
    }
  },
});
