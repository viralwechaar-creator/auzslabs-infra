'use strict';
page('dashboard', {
  title: 'Dashboard', icon: 'home', any: true, tabLabel: 'Home',
  async render(v) {
    v.root.append(h('div', { class: 'kpis', id: 'kpis' }, h('div', { class: 'skel', style: { height: '80px' } }), h('div', { class: 'skel', style: { height: '80px' } })));
    const kpisEl = $('#kpis', v.root);
    const two = h('div', { class: 'two' });
    v.root.append(two);

    if (canField()) {
      const [perf, report, incentive] = await Promise.all([api('sos_my_performance'), api('sos_daily_report'), api('sos_my_incentive')]);
      clear(kpisEl).append(
        kpi('Visits this month', perf.visitsDone + (perf.visitsTarget ? '/' + perf.visitsTarget : ''), perf.visitsTarget ? Math.round((perf.visitsDone / perf.visitsTarget) * 100) + '% of target' : null),
        kpi('Leads this month', perf.leadsDone + (perf.leadsTarget ? '/' + perf.leadsTarget : '')),
        kpi('Deals won', String(perf.dealsWon)),
        kpi('Incentive earned', inr(incentive.earned), incentive.dealsWon + ' deal' + (incentive.dealsWon === 1 ? '' : 's') + ' × ' + inr(incentive.perDealAmount)));
      const followCard = h('div', { class: 'card' }, h('h3', null, 'Today'),
        h('div', { class: 'list' },
          report.plannedVisits != null ? liRow({ icon: 'pin', title: report.completedVisits + ' of ' + report.plannedVisits + ' planned visits done' }) : null,
          liRow({ icon: 'target', title: report.newLeads + ' new leads today' }),
          liRow({ icon: 'calendar', title: report.demosToday + ' demo' + (report.demosToday === 1 ? '' : 's') + ' today' }),
          liRow({ icon: 'checksq', title: report.followUpsDue + ' follow-up' + (report.followUpsDue === 1 ? '' : 's') + ' due', onclick: () => go('leads') })));
      let fs; try { fs = await api('sos_field_session_current'); } catch { fs = null; }
      const fieldCard = h('div', { class: 'card' }, h('h3', null, 'Field session'),
        h('p', { class: 'muted' }, fs && fs.status === 'active' ? 'Active — your location is being tracked.' : fs && fs.status === 'paused' ? 'Paused.' : 'No open session.'),
        h('button', { class: 'btn fill sm', type: 'button', onclick: () => go('field') }, 'Open Field & visits'));
      two.append(followCard, fieldCard);
    } else if (canManage()) {
      const [perf, flagged, allLeads] = await Promise.all([api('sos_team_performance'), api('sos_flagged_visits'), api('sos_all_leads')]);
      const dealsWon = perf.reduce((a, p) => a + p.dealsWon, 0);
      const pipeline = allLeads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').reduce((a, l) => a + Number(l.dealValue || 0), 0);
      clear(kpisEl).append(
        kpi('Team members', String(perf.length)),
        kpi('Deals won this month', String(dealsWon)),
        kpi('Open pipeline value', inr(pipeline)),
        kpi('Visit flags to review', String(flagged.filter((f) => !f.reviewed).length), null, () => go('team')));
      two.append(h('div', { class: 'card' }, h('h3', null, 'Team'),
        h('div', { class: 'list' }, perf.slice(0, 6).map((p) => liRow({ avatar: p.name, title: p.name, sub: p.visitsDone + ' visits · ' + p.leadsDone + ' leads · ' + p.dealsWon + ' won' }))),
        h('button', { class: 'btn plain sm', type: 'button', onclick: () => go('team') }, 'See team overview')));
    } else {
      clear(kpisEl);
    }
  },
});
