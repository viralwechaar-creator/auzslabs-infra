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
      const answers = {};
      const fields = tpl.questions.map((q) => {
        let ctl;
        if (q.kind === 'yes_no') ctl = selectEl([['', 'Choose…'], ['yes', 'Yes'], ['no', 'No']], '');
        else if (q.kind === 'single_choice' || q.kind === 'dropdown') ctl = selectEl([['', 'Choose…'], ...(q.options || []).map((o) => [o, o])], '');
        else if (q.kind === 'number') ctl = input({ type: 'number' });
        else if (q.kind === 'date') ctl = input({ type: 'date' });
        else ctl = input({});
        answers[q.id] = ctl;
        return field(q.label + (q.required ? ' *' : ''), ctl);
      });
      const s = sheet({ title: tpl.name, closeLabel: 'Cancel', body: h('div', { class: 'grid' }, fields),
        actions: [{ label: 'Submit', primary: true, onclick: async () => {
          const out = {}; Object.keys(answers).forEach((k) => { out[k] = answers[k].value; });
          try { await api('sos_survey_submit', { p_template: tpl.id, p_business: businessId, p_visit: visitId, p_answers: out }); s.close(); toast('Survey submitted'); } catch (e) { fail(e); return false; }
        } }] });
    }
  },
});
