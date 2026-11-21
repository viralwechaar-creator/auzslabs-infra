'use strict';
page('team', {
  title: 'Team overview', icon: 'users', manage: true,
  async render(v) {
    const [live, perf, flagged, intel, rule] = await Promise.all([api('sos_live_field'), api('sos_team_performance'), api('sos_flagged_visits'), api('sos_market_intel'), api('sos_incentive_rule_get')]);

    // live field map
    const map = h('div', { class: 'mapcard' });
    const seeded = live.filter((s) => s.lastSample);
    seeded.forEach((s, i) => {
      const pin = h('div', { class: 'pin', 'data-name': s.name + (s.status === 'paused' ? ' (paused)' : ''), style: { left: (15 + (i * 23) % 70) + '%', top: (20 + (i * 31) % 55) + '%', opacity: s.status === 'paused' ? .5 : 1 } });
      map.append(pin);
    });
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Live field map'), h('p', { class: 'muted small' }, live.length ? live.length + ' active session' + (live.length === 1 ? '' : 's') : 'No one is in an active field session right now.'),
      live.length ? map : null,
      live.length ? h('div', { class: 'list' }, live.map((s) => liRow({ avatar: s.name, title: s.name, sub: cap1(s.status) + (s.lastSample ? ' · last seen ' + relTime(s.lastSample.at) : ''), right: s.lastSample ? h('a', { class: 'btn plain sm', href: 'https://maps.google.com/?q=' + s.lastSample.lat + ',' + s.lastSample.lng, target: '_blank', rel: 'noopener' }, 'Map') : null }))) : null));

    // performance
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'This month'), h('div', { class: 'tbl-wrap' },
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', { class: 'r' }, 'Visits'), h('th', { class: 'r' }, 'Leads'), h('th', { class: 'r' }, 'Deals won'))),
        h('tbody', null, perf.map((p) => h('tr', null, h('td', null, p.name), h('td', { class: 'r' }, String(p.visitsDone)), h('td', { class: 'r' }, String(p.leadsDone)), h('td', { class: 'r' }, String(p.dealsWon)))))))));

    // visit integrity
    const unreviewed = flagged.filter((f) => !f.reviewed);
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Visit integrity'), h('p', { class: 'muted small' }, unreviewed.length + ' flagged visit' + (unreviewed.length === 1 ? '' : 's') + ' (checked out under 2 minutes after check-in)'),
      unreviewed.length ? h('div', { class: 'list' }, unreviewed.map((f) => {
        const btn = h('button', { class: 'btn plain sm', type: 'button' }, 'Mark reviewed');
        btn.onclick = async () => { const note = await askText('Review note (optional)', null, 'e.g. confirmed with staff, legitimate'); try { await api('sos_visit_mark_reviewed', { p_id: f.id, p_note: note || null }); toast('Marked reviewed'); v.refresh(); } catch (e) { fail(e); } };
        return liRow({ icon: 'alert', tone: 'orange', title: f.staffName + ' · ' + f.businessName, sub: 'Checked out after ' + Math.round(f.seconds) + 's', right: btn });
      })) : null));

    // incentive rate
    const rateBtn = h('button', { class: 'btn plain sm', type: 'button' }, 'Change rate');
    rateBtn.onclick = async () => {
      const amt = await askText('Incentive per deal won', null, '₹', String(rule.perDealAmount), { mode: 'decimal' });
      if (amt == null) return;
      try { await api('sos_incentive_rule_set', { p_per_deal_amount: Number(amt) }); toast('Incentive rate updated'); v.refresh(); } catch (e) { fail(e); }
    };
    v.root.append(h('div', { class: 'card row sp' }, h('div', { class: 'hero' }, h('span', { class: 'k' }, 'Incentive rate'), h('span', { class: 'n' }, inr(rule.perDealAmount) + ' / deal')), rateBtn));

    // survey market intel
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Market intelligence'), h('p', { class: 'muted small' }, intel.totalResponses + ' survey responses so far — employee-reported, unverified'),
      intel.byCategory.length ? h('div', { class: 'list' }, intel.byCategory.map((c) => liRow({ title: cap1(c.category), value: String(c.count) }))) : null,
      h('button', { class: 'btn plain sm', type: 'button', onclick: () => go('surveys') }, 'Manage survey templates')));

    // team tasks
    const allTasks = await api('sos_all_tasks');
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Team tasks'),
      allTasks.length ? h('div', { class: 'list' }, allTasks.slice(0, 10).map((t) => liRow({ icon: 'checksq', title: t.title, sub: t.assignedToName + (t.dueDate ? ' · due ' + fmtD(t.dueDate) : ''), badge: badge(cap1(t.status), t.status === 'done' ? 'green' : '') }))) : empty('checksq', 'No tasks yet')));

    // expense approvals
    const pendingExp = await api('sos_all_expenses', { p_status: 'pending' });
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Pending expenses'),
      pendingExp.length ? h('div', { class: 'list' }, pendingExp.map((x) => {
        const approve = h('button', { class: 'btn plain sm', type: 'button' }, 'Approve');
        const reject = h('button', { class: 'btn plain sm danger', type: 'button' }, 'Reject');
        approve.onclick = async () => { try { await api('sos_expense_review', { p_id: x.id, p_decision: 'approved', p_reject_reason: null }); toast('Approved'); v.refresh(); } catch (e) { fail(e); } };
        reject.onclick = async () => { const reason = await askText('Reason for rejecting', null, 'optional'); try { await api('sos_expense_review', { p_id: x.id, p_decision: 'rejected', p_reject_reason: reason || null }); toast('Rejected'); v.refresh(); } catch (e) { fail(e); } };
        return liRow({ icon: 'wallet', title: x.staffName + ' · ' + inr(x.amount) + ' · ' + cap1(x.category), sub: x.hasReceipt ? 'Has receipt' : 'No receipt', right: h('div', { class: 'row', style: { gap: '4px' } }, approve, reject) });
      })) : empty('wallet', 'No pending expenses')));
  },
});

page('audit', {
  title: 'Audit log', icon: 'log', manage: true,
  async render(v) {
    const rows = await api('sos_audit_log', { p_limit: 100 });
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Append-only'), h('p', { class: 'muted small' }, 'Every assignment, review and approval is recorded here and can never be changed.'),
      rows.length ? h('div', { class: 'timeline' }, rows.map((a) => h('div', { class: 'ev' }, h('i'), h('div', null, h('div', { class: 't' }, a.actorName + ' ' + a.action + 'd a ' + a.entity), h('div', { class: 's' }, fmtDT(a.createdAt)))))) : empty('log', 'Nothing recorded yet')));
  },
});
