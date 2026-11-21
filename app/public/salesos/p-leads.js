'use strict';
const STAGES = ['new_prospect', 'contacted', 'qualified', 'interested', 'demo_scheduled', 'demo_completed', 'trial_activated', 'negotiation', 'won', 'lost'];
const STAGE_TONE = { new_prospect: '', contacted: 'blue', qualified: 'blue', interested: 'purple', demo_scheduled: 'orange', demo_completed: 'orange', trial_activated: 'purple', negotiation: 'orange', won: 'green', lost: 'red' };
function stageBadge(s) { return badge(cap1(s), STAGE_TONE[s] || ''); }

page('leads', {
  title: 'Leads', icon: 'target', field: true,
  async render(v) {
    let all = [], q = '';
    const search = glassSearch('Search leads by business or product', (val) => { q = val; paintFiltered(); });
    const list = h('div', { class: 'list' }, h('div', { class: 'skel', style: { height: '60px' } }));
    v.root.append(h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h3', null, 'My pipeline'), h('button', { class: 'btn fill sm', type: 'button', onclick: () => newLeadFlow() }, '+ New lead')), search, list));
    function paintFiltered() {
      const rows = q ? all.filter((l) => l.businessName.toLowerCase().includes(q) || (l.product || '').toLowerCase().includes(q)) : all;
      clear(list);
      if (!rows.length) { list.append(empty('target', all.length ? 'No matches' : 'No leads yet', all.length ? 'Try a different search.' : 'Create one from a visited business.')); return; }
      rows.forEach((l) => list.append(liRow({
        icon: 'target', title: l.businessName, sub: (l.product || 'No product') + (l.dealValue ? ' · ' + inr(l.dealValue) : ''),
        badge: stageBadge(l.stage), onclick: () => leadDetail(l),
      })));
    }
    async function paint() { all = await api('sos_my_leads'); paintFiltered(); }
    paint();

    async function newLeadFlow() {
      const bizInput = input({ placeholder: 'Business name' });
      const prodInput = input({ placeholder: 'Product, e.g. AUZsPOS (optional)' });
      const s = sheet({ title: 'New lead', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Business', bizInput), field('Product', prodInput), h('p', { class: 'muted small' }, 'This creates a new business record and a lead for it. To attach a lead to a business you already visited, use Field & visits.')),
        actions: [{ label: 'Create', primary: true, onclick: async () => {
          if (!bizInput.value.trim()) { toast('Enter the business name', { err: true }); return false; }
          try {
            const biz = await api('sos_business_save', { p: { name: bizInput.value.trim() } });
            await api('sos_lead_create', { p_business: biz.id, p_product: prodInput.value.trim() || null });
            s.close(); toast('Lead created'); paint();
          } catch (e) { fail(e); return false; }
        } }] });
    }
    async function leadDetail(l) {
      let notes = []; try { notes = await api('sos_lead_notes', { p_id: l.id }); } catch { /* ignore */ }
      const stageSel = selectEl(STAGES.map((s) => [s, cap1(s)]), l.stage);
      const followUp = h('input', { class: 'input', type: 'date', value: l.followUpDate || '' });
      const dealValue = input({ type: 'number', placeholder: 'Deal value ₹', value: l.dealValue || '' });
      const s = sheet({ title: l.businessName, wide: true, closeLabel: 'Close', body: h('div', { class: 'grid' },
        field('Stage', stageSel), field('Follow-up date', followUp), field('Deal value', dealValue),
        notes.length ? section('History', h('div', { class: 'timeline' }, notes.map((n) => h('div', { class: 'ev' }, h('i'), h('div', null, h('div', { class: 't' }, n.body), h('div', { class: 's' }, fmtDT(n.createdAt))))))) : null,
        canField() ? h('button', { class: 'btn fill', type: 'button', onclick: async () => { s.close(); await demoFlow(l); } }, 'Schedule a demo') : null,
        canField() ? h('button', { class: 'btn', type: 'button', onclick: async () => { s.close(); await trialFlow(l); } }, 'Start a trial') : null),
        actions: [{ label: 'Save', primary: true, onclick: async () => {
          const p = {};
          if (stageSel.value !== l.stage) p.stage = stageSel.value;
          if (followUp.value !== (l.followUpDate || '')) p.followUpDate = followUp.value;
          if (String(dealValue.value) !== String(l.dealValue || '')) p.dealValue = dealValue.value;
          if (Object.keys(p).length) { try { await api('sos_lead_update', { p_id: l.id, p }); } catch (e) { fail(e); return false; } }
          s.close(); toast('Saved'); paint();
        } }] });
    }
    async function demoFlow(l) {
      const dateInput = h('input', { class: 'input', type: 'datetime-local' });
      const modeInput = selectEl([['in_person', 'In person'], ['video_call', 'Video call'], ['phone', 'Phone']], 'in_person');
      const s = sheet({ title: 'Schedule a demo', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('When', dateInput), field('Mode', modeInput)),
        actions: [{ label: 'Schedule', primary: true, onclick: async () => {
          if (!dateInput.value) { toast('Pick a date and time', { err: true }); return false; }
          try { await api('sos_demo_create', { p_lead: l.id, p_date: new Date(dateInput.value).toISOString(), p_mode: modeInput.value }); s.close(); toast('Demo scheduled'); paint(); } catch (e) { fail(e); return false; }
        } }] });
    }
    async function trialFlow(l) {
      const days = input({ type: 'number', value: 14 });
      const s = sheet({ title: 'Start a trial', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Trial length (days)', days)),
        actions: [{ label: 'Start trial', primary: true, onclick: async () => { try { await api('sos_trial_start', { p_lead: l.id, p_days: Number(days.value) || 14 }); s.close(); toast('Trial started'); paint(); } catch (e) { fail(e); return false; } } }] });
    }
  },
});

page('demos', {
  title: 'Demos & trials', icon: 'calendar', field: true,
  async render(v) {
    const [demos, trials] = await Promise.all([api('sos_my_demos'), api('sos_my_trials')]);
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Demos'),
      demos.length ? h('div', { class: 'list' }, demos.map((d) => liRow({ icon: 'calendar', title: d.businessName, sub: fmtDT(d.demoDate), badge: badge(cap1(d.status), d.status === 'completed' ? 'green' : d.status === 'missed' ? 'red' : 'orange'),
        onclick: d.status === 'scheduled' ? () => demoOutcome(d) : null })))
        : empty('calendar', 'No demos scheduled', 'Schedule one from a lead in Leads.')));
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Trials'),
      trials.length ? h('div', { class: 'list' }, trials.map((t) => h('div', { style: {} }, liRow({ icon: 'target', title: t.businessName, sub: 'Expires ' + fmtD(t.trialExpiry), badge: badge(cap1(t.status), t.status === 'converted' ? 'green' : t.status === 'active' ? 'blue' : '') }),
        t.status === 'active' ? h('div', { style: { padding: '0 16px 12px' } }, verifyRow(t)) : null)))
        : empty('target', 'No trials active', 'Start one from a lead in Leads.')));

    function verifyRow(t) {
      const slugInput = input({ placeholder: 'client’s-tenant-slug' });
      const btn = h('button', { class: 'btn plain sm', type: 'button' }, 'Verify & mark won');
      btn.onclick = async () => {
        if (!slugInput.value.trim()) { toast('Enter the client’s AUZslab address', { err: true }); return; }
        try { await api('sos_trial_verify_conversion', { p_id: t.id, p_tenant_slug: slugInput.value.trim() }); toast('Conversion verified'); v.refresh(); } catch (e) { fail(e); }
      };
      return h('div', { class: 'row' }, slugInput, btn);
    }
    async function demoOutcome(d) {
      const status = await alertBox({ title: 'Demo outcome', actions: [{ label: 'Completed', value: 'completed', role: 'def' }, { label: 'Missed', value: 'missed' }, { label: 'Cancelled', value: 'cancelled' }, { label: 'Close', value: null }] });
      if (!status) return;
      try { await api('sos_demo_set', { p_id: d.id, p_status: status }); toast('Updated'); v.refresh(); } catch (e) { fail(e); }
    }
  },
});
