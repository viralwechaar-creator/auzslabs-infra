'use strict';
let watchId = null;
function stopWatch() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
function startWatch(sessionId) {
  if (watchId != null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition((pos) => {
    api('sos_location_batch', { p_session: sessionId, p_points: [{ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: new Date().toISOString() }] }).catch(() => {});
  }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}
window.addEventListener('hashchange', stopWatch);

page('field', {
  title: 'Field & visits', icon: 'pin', field: true, tabLabel: 'Field',
  async render(v) {
    let fs; try { fs = await api('sos_field_session_current'); } catch { fs = null; }
    const statusEl = h('p', { class: 'muted' }, fs ? 'Status: ' + cap1(fs.status) : 'No open field session.');
    const actions = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
    async function paintActions() {
      clear(actions);
      if (!fs || fs.status === 'ended') {
        const b = h('button', { class: 'btn fill', type: 'button' }, 'Start field session');
        b.onclick = async () => { try { const r = await api('sos_field_session_start'); fs = { id: r.id, status: 'active' }; startWatch(r.id); statusEl.textContent = 'Status: Active'; paintActions(); } catch (e) { fail(e); } };
        actions.append(b);
      } else if (fs.status === 'active') {
        startWatch(fs.id);
        const pause = h('button', { class: 'btn sm', type: 'button' }, 'Pause');
        pause.onclick = async () => { try { await api('sos_field_session_set', { p_id: fs.id, p_status: 'paused' }); fs.status = 'paused'; stopWatch(); statusEl.textContent = 'Status: Paused'; paintActions(); } catch (e) { fail(e); } };
        const end = h('button', { class: 'btn sm danger', type: 'button' }, 'End session');
        end.onclick = async () => { if (!(await confirmBox('End field session?', 'Your location will stop being tracked.'))) return; try { await api('sos_field_session_set', { p_id: fs.id, p_status: 'ended' }); fs.status = 'ended'; stopWatch(); statusEl.textContent = 'No open field session.'; paintActions(); } catch (e) { fail(e); } };
        actions.append(pause, end);
      } else if (fs.status === 'paused') {
        const resume = h('button', { class: 'btn fill sm', type: 'button' }, 'Resume');
        resume.onclick = async () => { try { await api('sos_field_session_set', { p_id: fs.id, p_status: 'active' }); fs.status = 'active'; startWatch(fs.id); statusEl.textContent = 'Status: Active'; paintActions(); } catch (e) { fail(e); } };
        const end = h('button', { class: 'btn sm danger', type: 'button' }, 'End session');
        end.onclick = async () => { if (!(await confirmBox('End field session?', 'Your location will stop being tracked.'))) return; try { await api('sos_field_session_set', { p_id: fs.id, p_status: 'ended' }); fs.status = 'ended'; statusEl.textContent = 'No open field session.'; paintActions(); } catch (e) { fail(e); } };
        actions.append(resume, end);
      }
    }
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Field session'), statusEl, actions));
    paintActions();
    v.onLeave(stopWatch);

    const visitsList = h('div', { class: 'list' }, h('div', { class: 'skel', style: { height: '60px' } }));
    v.root.append(h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h3', null, 'My visits'), h('button', { class: 'btn fill sm', type: 'button', onclick: () => newVisitFlow() }, '+ New visit')), visitsList));
    async function paintVisits() {
      const rows = await api('sos_my_visits', { p_status: 'all' });
      clear(visitsList);
      if (!rows.length) { visitsList.append(empty('pin', 'No visits yet', 'Start by checking in to a business.')); return; }
      rows.forEach((r) => {
        const checkoutBtn = r.status === 'checked_in' ? h('button', { class: 'btn plain sm', type: 'button', onclick: () => checkoutFlow(r) }, 'Check out') : null;
        const surveyBtn = h('button', { class: 'btn plain sm', type: 'button', onclick: () => surveyFlow(r.businessId, r.id) }, 'Survey');
        visitsList.append(liRow({ icon: 'pin', title: r.businessName, sub: cap1(r.status) + (r.outcome ? ' · ' + cap1(r.outcome) : '') + ' · ' + fmtDT(r.checkInAt || r.scheduledAt), right: h('div', { class: 'row', style: { gap: '4px' } }, checkoutBtn, surveyBtn) }));
      });
    }
    paintVisits();

    async function newVisitFlow() {
      const nameInput = input({ placeholder: 'Business name' });
      const catInput = input({ placeholder: 'Category, e.g. retail, cafe (optional)' });
      const s = sheet({ title: 'New visit', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Business', nameInput), field('Category', catInput), h('p', { class: 'muted small' }, 'Your current location will be used as the check-in point.')),
        actions: [{ label: 'Check in', primary: true, onclick: async () => {
          if (!nameInput.value.trim()) { toast('Enter the business name', { err: true }); return false; }
          const biz = await api('sos_business_save', { p: { name: nameInput.value.trim(), category: catInput.value.trim() } });
          const pos = await new Promise((res) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res(p), () => res(null), { enableHighAccuracy: true, timeout: 10000 }) : res(null));
          await api('sos_visit_start', { p_business: biz.id, p_type: 'in_person', p_lat: pos ? pos.coords.latitude : null, p_lng: pos ? pos.coords.longitude : null });
          s.close(); toast('Checked in'); paintVisits();
        } }] });
    }
    async function checkoutFlow(r) {
      const outcome = selectEl([['interested', 'Interested'], ['not_interested', 'Not interested'], ['converted', 'Converted'], ['follow_up', 'Needs follow-up']], 'interested');
      const notes = h('textarea', { class: 'textarea', placeholder: 'Notes (optional)' });
      const s = sheet({ title: 'Check out', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Outcome', outcome), field('Notes', notes)),
        actions: [{ label: 'Check out', primary: true, onclick: async () => { await api('sos_visit_complete', { p_id: r.id, p: { outcome: outcome.value, notes: notes.value.trim() } }); s.close(); toast('Checked out'); paintVisits(); } }] });
    }
    async function surveyFlow(businessId, visitId) {
      let templates; try { templates = await api('sos_survey_templates_list', { p_active_only: true }); } catch (e) { fail(e); return; }
      if (!templates.length) { toast('No survey templates yet', { err: true }); return; }
      let tpl = templates[0];
      if (templates.length > 1) {
        const pick = selectEl(templates.map((t) => [t.id, t.name]), tpl.id);
        const ok = await alertBox({ title: 'Which survey?', body: pick, confirm: 'Continue' });
        if (!ok) return;
        tpl = templates.find((t) => t.id === pick.value);
      }
      // group questions into sections (tabs) in the order they first appear; untagged
      // questions (older templates with no section set) share one trailing section, so this
      // degrades gracefully to a single-page form when a template has no sections at all.
      const sectionOrder = []; const bySection = {};
      tpl.questions.forEach((q) => { const sec = q.section || 'Survey'; if (!bySection[sec]) { bySection[sec] = []; sectionOrder.push(sec); } bySection[sec].push(q); });
      const values = {}; let idx = 0;
      function ctlFor(q) {
        const v = values[q.id];
        if (q.kind === 'yes_no') return selectEl([['', 'Choose…'], ['yes', 'Yes'], ['no', 'No']], v || '');
        if (q.kind === 'single_choice' || q.kind === 'dropdown') return selectEl([['', 'Choose…'], ...(q.options || []).map((o) => [o, o])], v || '');
        if (q.kind === 'multiple_choice') {
          const wrap = h('div', { class: 'grid', style: { gap: '6px' } });
          const selected = new Set(Array.isArray(v) ? v : []);
          (q.options || []).forEach((o) => {
            const cb = h('input', { type: 'checkbox', checked: selected.has(o) });
            cb.onchange = () => { if (cb.checked) selected.add(o); else selected.delete(o); values[q.id] = [...selected]; };
            wrap.append(h('label', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, cb, h('span', null, o)));
          });
          wrap.dataset.multi = '1';
          return wrap;
        }
        if (q.kind === 'number') return input({ type: 'number', value: v || '' });
        if (q.kind === 'date') return input({ type: 'date', value: v || '' });
        return input({ value: v || '' });
      }
      const body = h('div', { class: 'grid' });
      function renderSection() {
        clear(body);
        const sec = sectionOrder[idx], qs = bySection[sec];
        if (sectionOrder.length > 1) body.append(h('p', { class: 'muted small' }, 'Section ' + (idx + 1) + ' of ' + sectionOrder.length + ' — ' + sec));
        qs.forEach((q) => {
          const ctl = ctlFor(q);
          if (!(ctl.dataset && ctl.dataset.multi)) ctl.oninput = ctl.onchange = () => { values[q.id] = ctl.value; };
          body.append(field(q.label + (q.required ? ' *' : ''), ctl));
        });
        const nav = h('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } });
        if (idx > 0) nav.append(h('button', { class: 'btn', type: 'button', onclick: () => { idx--; renderSection(); } }, 'Back'));
        nav.append(h('span', { class: 'grow' }));
        if (idx < sectionOrder.length - 1) nav.append(h('button', { class: 'btn fill', type: 'button', onclick: () => { idx++; renderSection(); } }, 'Next section'));
        else nav.append(h('button', { class: 'btn fill', type: 'button', onclick: submit }, 'Submit'));
        body.append(nav);
      }
      async function submit() {
        const missing = tpl.questions.find((q) => q.required && (values[q.id] == null || values[q.id] === '' || (Array.isArray(values[q.id]) && !values[q.id].length)));
        if (missing) { toast('Please answer: ' + missing.label, { err: true }); const i = sectionOrder.indexOf(missing.section || 'Survey'); idx = i < 0 ? 0 : i; renderSection(); return; }
        try { await api('sos_survey_submit', { p_template: tpl.id, p_business: businessId, p_visit: visitId, p_answers: values }); s.close(); toast('Survey submitted'); } catch (e) { fail(e); }
      }
      const s = sheet({ title: tpl.name, closeLabel: 'Cancel', body });
      renderSection();
    }
  },
});
