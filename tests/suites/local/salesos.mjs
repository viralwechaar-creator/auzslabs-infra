// AUZslab SalesOS: drives every sos_* module through the real API (as an admin, a manager, a
// sales executive, and nobody), checking permission guards and business-rule invariants --
// mirroring the project's own RPC-level pattern (see payroll.mjs's header comment) rather than
// adding a screen-driving browser pass, since salesos.html has no desktop/phone layout split yet.
import { suite, assert } from '../../lib/harness.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ stack }) {
  const s = suite('SalesOS: recruitment, field tracking, CRM, surveys, demos/trials, expenses, tasks, notifications, audit, incentives', 'Runs the internal sales tenant through hire-to-field-work end to end, checking every sos_guard permission boundary and the real anti-fraud/validation rules.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [platformAdmin, sosAdmin, manager, exec, exec2] = await Promise.all([USERS.admin, USERS.sosAdmin, USERS.sosManager, USERS.sosExec, USERS.sosExec2].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn} refused with the wrong reason: ${r.error}`); return r; };

  // ---------- recruitment ----------
  let appId;
  await s.check('Anyone can apply (no auth); a pending application is created', async () => {
    const r = await call(null, 'submit_job_application', { p_name: 'Priya Sharma', p_email: 'priya-applicant@test.local', p_phone: '9988776655', p_note: 'Keen on field sales', p_hp: '' });
    assert(r.ok, r.error); appId = r.data.id;
  }, 'critical');
  await s.check('A filled honeypot field is silently refused (bot defence)', async () => {
    const r = await call(null, 'submit_job_application', { p_name: 'Bot', p_email: 'bot@test.local', p_phone: '0', p_note: '', p_hp: 'filled' });
    assert(!r.ok || !r.data || !r.data.id, 'honeypot did not block the submission');
  }, 'major');
  await s.check('Job applications are reviewed by a real platform admin -- an internal sos_admin role is not enough', async () => {
    await fails(exec, 'admin_list_job_applications', { p_status: 'pending' });
    await fails(manager, 'admin_list_job_applications', { p_status: 'pending' });
    await fails(sosAdmin, 'admin_list_job_applications', { p_status: 'pending' }, /not authorized/i);
    const list = await ok(platformAdmin, 'admin_list_job_applications', { p_status: 'pending' });
    assert(list.some((a) => a.id === appId), 'new application missing from admin list');
  }, 'critical');
  await s.check('Approving an application assigns a post and creates a real login', async () => {
    const r = await ok(platformAdmin, 'admin_review_job_application', { p_id: appId, p_decision: 'approve', p_post: 'Sales Executive', p_reject_reason: null });
    assert(r.ok !== false, JSON.stringify(r));
    const row = (await q(`select app_metadata->>'role' as role, app_metadata->>'role_id' as role_id from auth_users where email = 'priya-applicant@test.local'`))[0];
    assert(row && row.role === 'Sales Executive' && row.role_id, 'no real login created with the assigned post');
  }, 'critical');

  // ---------- field sessions + GPS ----------
  let sessionId;
  await s.check('Only field roles can start a field session; a manager cannot', async () => {
    await fails(manager, 'sos_field_session_start', {});
    sessionId = (await ok(exec, 'sos_field_session_start', {})).id;
    assert(sessionId, 'no session id returned');
  }, 'critical');
  await s.check('Starting a second session while one is already open is refused', async () => {
    await fails(exec, 'sos_field_session_start', {}, /already|open/i);
  }, 'major');
  await s.check('Location batches land, and the manager sees the live feed', async () => {
    await ok(exec, 'sos_location_batch', { p_session: sessionId, p_points: [{ lat: 26.2389, lng: 73.0243, at: new Date().toISOString() }] });
    const live = await ok(manager, 'sos_live_field', {});
    assert(live.some((x) => x.lastSample), 'no live sample visible to the manager');
    await fails(exec, 'sos_live_field', {}, /sos_manage/i);
  }, 'major');

  // ---------- businesses + visits ----------
  let bizId, visitId;
  await s.check('A field exec creates a business and checks in', async () => {
    bizId = (await ok(exec, 'sos_business_save', { p: { name: 'Jodhpur General Store', category: 'retail' } })).id;
    visitId = (await ok(exec, 'sos_visit_start', { p_business: bizId, p_type: 'in_person', p_lat: 26.28, p_lng: 73.02 })).id;
    assert(bizId && visitId, 'business/visit not created');
  }, 'critical');
  await s.check('An immediate checkout is flagged for the manager to review', async () => {
    await ok(exec, 'sos_visit_complete', { p_id: visitId, p: { outcome: 'interested' } });
    const flagged = await ok(manager, 'sos_flagged_visits', {});
    const row = flagged.find((f) => f.id === visitId);
    assert(row && !row.reviewed, 'the near-instant checkout was not flagged');
    assert(await ok(manager, 'sos_visit_mark_reviewed', { p_id: visitId, p_note: 'Confirmed with exec, legitimate' }), 'mark-reviewed returned false');
    const after = await ok(manager, 'sos_flagged_visits', {});
    assert(after.find((f) => f.id === visitId).reviewed, 'flag still showing unreviewed after review');
  }, 'major');

  // ---------- leads + demos + trials (anti-fraud conversion) ----------
  let leadId;
  await s.check('A lead is created against the business; a duplicate active lead for the same product is refused', async () => {
    leadId = (await ok(exec, 'sos_lead_create', { p_business: bizId, p_product: 'AUZsPOS' })).id;
    await fails(exec, 'sos_lead_create', { p_business: bizId, p_product: 'AUZsPOS' }, /already.*active lead/i);
  }, 'critical');
  const exec2Id = (await q(`select id from auth_users where email = $1`, [USERS.sosExec2]))[0].id;
  await s.check('Manager assigns the lead to a different exec; a field exec cannot reassign it', async () => {
    await ok(manager, 'sos_lead_assign', { p_id: leadId, p_owner: exec2Id });
    await fails(exec, 'sos_lead_assign', { p_id: leadId, p_owner: exec2Id });
    await ok(manager, 'sos_lead_assign', { p_id: leadId, p_owner: (await q(`select id from auth_users where email = $1`, [USERS.sosExec]))[0].id }); // reassign back to exec for the rest of the flow
  }, 'major');
  let demoId, trialId;
  await s.check('A demo is scheduled and completed; a trial is started', async () => {
    demoId = (await ok(exec, 'sos_demo_create', { p_lead: leadId, p_date: new Date().toISOString() })).id;
    await ok(exec, 'sos_demo_set', { p_id: demoId, p_status: 'completed' });
    trialId = (await ok(exec, 'sos_trial_start', { p_lead: leadId, p_days: 14 })).id;
    const lead = (await ok(exec, 'sos_my_leads', {})).find((l) => l.id === leadId);
    assert(lead.stage === 'trial_activated', 'lead stage ' + (lead && lead.stage));
  }, 'critical');
  await s.check('A self-reported conversion against a slug with no real, active tenant is refused', async () => {
    await fails(exec, 'sos_trial_verify_conversion', { p_id: trialId, p_tenant_slug: 'no-such-tenant-xyz' }, /no .*client found/i);
  }, 'critical');
  await s.check('A conversion against a real, active tenant slug is accepted and moves the lead to won', async () => {
    await ok(exec, 'sos_trial_verify_conversion', { p_id: trialId, p_tenant_slug: 'testcafe' });
    const lead = (await ok(manager, 'sos_all_leads', {})).find((l) => l.id === leadId);
    assert(lead.stage === 'won', 'lead did not move to won after a verified conversion: ' + (lead && lead.stage));
  }, 'critical');

  // ---------- targets + performance ----------
  await s.check('A manager sets a target; an exec cannot set their own', async () => {
    await fails(exec, 'sos_target_set', { p_staff: null, p_month: null, p_visits: 20, p_leads: 10, p_demos: 5 });
    const month = new Date().toISOString().slice(0, 8) + '01';
    await ok(manager, 'sos_target_set', { p_staff: (await q(`select id from auth_users where email = $1`, [USERS.sosExec]))[0].id, p_month: month, p_visits: 20, p_leads: 10, p_demos: 5 });
    const perf = await ok(exec, 'sos_my_performance', {});
    assert(perf.visitsTarget === 20, 'target not visible to the exec: ' + JSON.stringify(perf));
  }, 'major');

  // ---------- survey engine ----------
  let templateId;
  await s.check('A manager builds a survey template with a required question; an exec cannot', async () => {
    await fails(exec, 'sos_survey_template_save', { p: { name: 'Shop intel', questions: [] } });
    templateId = (await ok(manager, 'sos_survey_template_save', { p: { name: 'Shop intel ' + Date.now(), category: 'retail', questions: [{ label: 'Current POS used?', kind: 'text', required: true }] } })).id;
  }, 'major');
  await s.check('Submitting a survey with the required question blank is refused; filled in, it is accepted', async () => {
    await fails(exec, 'sos_survey_submit', { p_template: templateId, p_business: bizId, p_visit: visitId, p_answers: {} }, /Please answer/i);
    const qid = (await ok(exec, 'sos_survey_templates_list', { p_active_only: true })).find((t) => t.id === templateId).questions[0].id;
    await ok(exec, 'sos_survey_submit', { p_template: templateId, p_business: bizId, p_visit: visitId, p_answers: { [qid]: 'Legacy billing software' } });
    const intel = await ok(manager, 'sos_market_intel', {});
    assert(intel.totalResponses >= 1, 'survey response not counted in market intel');
  }, 'major');

  // ---------- expenses ----------
  let expId;
  await s.check('An expense with no amount is refused; a valid one is pending for the manager', async () => {
    await fails(exec, 'sos_expense_submit', { p: { category: 'fuel' } }, /amount/i);
    expId = (await ok(exec, 'sos_expense_submit', { p: { category: 'fuel', amount: 150, purpose: 'field visits' } })).id;
    const pending = await ok(manager, 'sos_all_expenses', { p_status: 'pending' });
    assert(pending.some((x) => x.id === expId), 'new expense missing from the manager pending list');
    await fails(exec, 'sos_all_expenses', { p_status: 'pending' }, /sos_manage/i);
  }, 'major');
  await s.check('Manager approves the expense; the exec is notified', async () => {
    await ok(manager, 'sos_expense_review', { p_id: expId, p_decision: 'approved', p_reject_reason: null });
    const notifs = await ok(exec, 'sos_my_notifications', { p_unread_only: false });
    assert(notifs.some((n) => n.kind === 'expense_approved'), 'no expense_approved notification delivered');
  }, 'major');

  // ---------- tasks ----------
  let taskId;
  await s.check('An exec cannot assign a task to someone else; a manager can', async () => {
    await fails(exec, 'sos_task_create', { p: { title: 'Sneaky assign', assignedTo: (await q(`select id from auth_users where email = $1`, [USERS.sosExec2]))[0].id } });
    taskId = (await ok(manager, 'sos_task_create', { p: { title: 'Follow up on demo', assignedTo: (await q(`select id from auth_users where email = $1`, [USERS.sosExec]))[0].id } })).id;
  }, 'major');
  await s.check('The assignee sees the task and can mark it done', async () => {
    const mine = await ok(exec, 'sos_my_tasks', {});
    assert(mine.tasks.some((t) => t.id === taskId), 'assigned task missing from my_tasks');
    await ok(exec, 'sos_task_set', { p_id: taskId, p_status: 'done' });
    await fails(exec, 'sos_all_tasks', {}, /sos_manage/i);
  }, 'major');

  // ---------- audit log (append-only) ----------
  await s.check('The manager-only audit log recorded the actions above; an exec cannot read it', async () => {
    const log = await ok(manager, 'sos_audit_log', { p_limit: 50 });
    assert(log.some((a) => a.entity === 'task') && log.some((a) => a.entity === 'expense'), 'expected task/expense audit rows missing');
    await fails(exec, 'sos_audit_log', { p_limit: 10 }, /sos_manage/i);
    const row = (await q(`select id from sos_audit limit 1`))[0];
    await q(`do $$ begin update sos_audit set action = 'tampered' where id = ${row.id}; exception when others then null; end $$`);
    const unchanged = (await q(`select action from sos_audit where id = ${row.id}`))[0];
    assert(unchanged.action !== 'tampered', 'sos_audit is not actually append-only');
  }, 'critical');

  // ---------- incentives ----------
  await s.check('Manager sets an incentive rate; an exec cannot', async () => {
    await fails(exec, 'sos_incentive_rule_set', { p_per_deal_amount: 500 });
    await fails(manager, 'sos_incentive_rule_set', { p_per_deal_amount: -1 }, /0 or more/i);
    await ok(manager, 'sos_incentive_rule_set', { p_per_deal_amount: 500 });
  }, 'major');
  await s.check('The deal won above (real tenant conversion) is correctly reflected in the owner\'s incentive this month', async () => {
    const after = await ok(exec, 'sos_my_incentive', {});
    assert(after.dealsWon >= 1 && after.earned === after.dealsWon * 500, 'incentive not reflecting the won deal: ' + JSON.stringify(after));
  }, 'critical');

  // ---------- auth boundary ----------
  await s.check('Logged out, every sos_* call is refused', async () => {
    for (const fn of ['sos_my_leads', 'sos_my_performance', 'sos_field_session_current', 'sos_my_tasks']) { const r = await call(null, fn, {}); assert(r.status === 401, fn + ' status ' + r.status); }
  }, 'critical');
  await s.check('Admin downloads one PDF with a staff member\'s profile and documents; nobody else can', async () => {
    const get = (tok) => fetch(stack.apiBase + '/admin/sos-staff-pdf/' + exec2Id + '?name=Exec', { headers: { authorization: 'Bearer ' + tok, origin: 'http://localhost:5173' } });
    const r = await get(platformAdmin); assert(r.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'no CORS header on the pdf: the browser would block it'); assert(r.status === 200 && /pdf/.test(r.headers.get('content-type') || ''), 'admin pdf status ' + r.status);
    const b = Buffer.from(await r.arrayBuffer()); assert(b.slice(0, 5).toString() === '%PDF-' && b.length > 800, 'not a pdf');
    assert((await get(manager)).status === 403, 'a sales manager must not get the staff pdf');
    assert((await fetch(stack.apiBase + '/admin/sos-staff-pdf/' + exec2Id)).status === 401, 'anonymous allowed');
  }, 'critical');
  await s.check('A contact-page job application becomes a SalesOS login in one step; other leads and non-admins are refused', async () => {
    const mk = async (kind, email) => (await q("insert into leads (name, contact, message, kind, details) values ($1, $2, 'I want to sell', $3, '{\"phone\":\"9000000001\"}') returning id", ['Lead ' + kind, email + ' \u00b7 9000000001', kind]))[0].id;
    const career = await mk('career', 'newhire.lead@test.local'), biz = await mk('business', 'bizlead@test.local');
    await fails(manager, 'admin_lead_make_salesos', { p_lead: career, p_post: 'Sales Executive' }, /not authorized/i);
    await fails(platformAdmin, 'admin_lead_make_salesos', { p_lead: biz, p_post: 'Sales Executive' }, /job application/i);
    const r = await ok(platformAdmin, 'admin_lead_make_salesos', { p_lead: career, p_post: 'Sales Executive' });
    assert(r.status === 'approved' && r.email === 'newhire.lead@test.local', JSON.stringify(r));
    assert((await q("select count(*)::int n from auth_users where email='newhire.lead@test.local'"))[0].n === 1, 'login not created');
    assert((await q('select status from leads where id=$1', [career]))[0].status === 'converted', 'lead not marked converted');
    await fails(platformAdmin, 'admin_lead_make_salesos', { p_lead: career, p_post: 'Sales Executive' }, /already/i);
  }, 'major');
  await s.check('A login from an unrelated tenant cannot call any sos_* function', async () => {
    const outsider = await login(USERS.cafeOwner);
    await fails(outsider, 'sos_my_leads', {}, /salesos|not a tenant member|not enabled/i);
  }, 'critical');
}
