// Follow-up notes: what to chase, by when, and who does it. Shown on a customer's page (tab) and as one list.
async function teamList() { if (!S.team) { try { S.team = (await api('acc_team_list')).rows; } catch (e) { S.team = []; } } return S.team; }

async function followupSheet(party, f, done) {
  const team = await teamList();
  const note = h('textarea', { class: 'textarea', placeholder: 'e.g. Call on Monday, promised to pay half', style: { minHeight: '80px' } }, f ? f.note : '');
  const due = dateInput(f && f.due_on ? f.due_on : '');
  const who = selectEl(team.map((t) => [t.id, t.name]), (f && f.assigned_to) || (S.ctx && S.ctx.user_id) || (team[0] && team[0].id) || '', {});
  sheet({ title: f ? 'Edit follow-up' : 'New follow-up', body: h('div', { class: 'grid' }, h('div', { class: 'muted small' }, party.party_name || party.name), field('What to follow up', note), field('By when', due), team.length ? field('Who follows up', who) : null),
    actions: [{ label: 'Save', primary: true, onclick: async (c) => {
      if (!note.value.trim()) { note.classList.add('err'); note.focus(); return false; }
      await api('acc_followup_save', { p: { id: f ? f.id : null, party_id: party.party_id || party.id, note: note.value, due_on: due.value || null, assigned_to: team.length ? who.value : null } });
      c(); toast('Saved'); done && done();
    } }] });
}

function followupRows(rows, onChange, showParty) {
  if (!rows.length) return empty('clock', 'No follow-ups', 'Add one to remember who to chase and when.');
  return dataView([
    { key: 'note', label: 'Follow-up', title: true, render: (x) => x.note },
    { key: 'party_name', label: 'Customer', sub: true, render: (x) => [showParty ? x.party_name : '', x.due_on ? 'by ' + fmtD(x.due_on) : 'no date', x.assignee].filter(Boolean).join(' · ') },
    { key: 'status', label: 'Status', badge: true, render: (x) => (x.status === 'done' ? badge('Done', 'green') : x.late ? badge('Late', 'red') : badge('Open')) },
    { key: 'owed', label: 'Owes', r: true, value: true, render: (x) => money(x.owed), sortVal: (x) => Number(x.owed) },
  ], rows, { onRow: (x) => sheet({ title: x.party_name, closeLabel: 'Close', body: h('div', { class: 'grid' }, h('p', null, x.note), h('div', { class: 'muted small' }, [x.due_on ? 'By ' + fmtD(x.due_on) : 'No date', x.assignee ? 'for ' + x.assignee : ''].join(' · '))),
    actions: [{ label: x.status === 'done' ? 'Open again' : 'Mark done', primary: true, onclick: async (c) => { await api('acc_followup_done', { p_id: x.id, p_done: x.status !== 'done' }); c(); onChange(); } },
      { label: 'Edit', onclick: (c) => { c(); followupSheet(x, x, onChange); } }] }) });
}

async function followupsTab(host, party, refresh) {
  const rows = (await api('acc_followup_list', { p: { party_id: party.id, status: 'all' } })).rows;
  host.append(h('div', { class: 'row' }, h('button', { class: 'btn fill', onclick: () => followupSheet(party, null, refresh) }, icon('plus', 18), 'New follow-up')), followupRows(rows, refresh, false));
}

page('followups', {
  title: 'Follow-ups', icon: 'clock', perm: 'acc_view',
  async render(v) {
    v.header({ title: 'Follow-ups' });
    const filter = v.q.get('f') || 'mine';
    v.root.append(seg([['mine', 'Mine'], ['all', 'Everyone'], ['done', 'Done']], filter, (t) => go('followups?f=' + t)));
    const rows = (await api('acc_followup_list', { p: { status: filter === 'done' ? 'done' : 'open', mine: filter === 'mine' } })).rows;
    v.root.append(h('div', { class: 'kpis k3' }, kpi('Open', String(rows.filter((x) => x.status === 'open').length), ''), kpi('Late', String(rows.filter((x) => x.late).length), rows.some((x) => x.late) ? 'Chase these first' : 'None late'), kpi('Money behind them', inr(rows.reduce((s, x) => s + Number(x.owed || 0), 0), 0), '')), followupRows(rows, () => v.refresh(), true));
  },
});
