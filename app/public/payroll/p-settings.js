/* AUZslab Payroll: settings. One index of plain-language sections; each section is its own page with a few grouped
   rows and one Save button. Everything is written through pay_save_* functions on the server (owner/admin only, audited).
   Statutory values are never typed in here: they come from versioned rules with their source (pay_stat_rules). */
'use strict';
const SETTINGS = [
  { group: 'Business', items: [
    ['company', 'Business details', 'Name, address, PAN, TAN and registrations', 'building', 'pay_admin'],
    ['locations', 'Locations', 'Branches, their state and the clock-in area', 'pin', 'pay_admin'],
    ['lists', 'Departments and lists', 'Departments, designations, grades, claim types', 'list', 'pay_people'],
  ] },
  { group: 'Pay', items: [
    ['pay', 'Pay rules', 'Pay day, unpaid-day maths, salary structures', 'wallet', 'pay_admin'],
    ['statutory', 'Government deductions', 'PF, ESI, professional tax, income tax', 'shield', 'pay_admin'],
    ['accounting', 'Accounting', 'Post payroll to AUZslab Accounting', 'book', 'pay_admin'],
  ] },
  { group: 'Time', items: [
    ['time', 'Attendance', 'How days are counted, late marks, overtime', 'clock', 'pay_admin'],
    ['leave', 'Leave types', 'Paid leave, sick leave, yearly quotas', 'leave', 'pay_admin'],
  ] },
  { group: 'People and access', items: [
    ['access', 'Who can do what', 'Managers, approvals, two-person rule', 'lock', 'pay_admin'],
    ['notices', 'Notices for staff', 'Short messages on everyone’s Today screen', 'chat', 'pay_people'],
    ['import', 'Import people', 'Add many people from a spreadsheet', 'upload', 'pay_people'],
  ] },
  { group: 'Records', items: [
    ['audit', 'Change history', 'Who changed what, and when', 'refresh', 'pay_audit'],
    ['health', 'Books health check', 'Proves payslips, payments and accounts agree', 'shield', 'pay_reports'],
  ] },
];
const settingDef = (k) => SETTINGS.flatMap((g) => g.items).find((x) => x[0] === k);
const settingOk = (x) => can(x[4]) && (x[0] !== 'accounting' || (S.ctx.features || {}).accounting);
const SECTIONS = {};

page('settings', {
  title: 'Settings', icon: 'gear', perm: () => SETTINGS.some((g) => g.items.some(settingOk)),
  async render(v) {
    const k = v.args[0];
    if (k) {
      const def = settingDef(k);
      if (!def || !settingOk(def)) { v.header({ title: 'Settings', back: 'settings' }); v.root.append(empty('lock', 'No access', 'Your role does not include this setting.')); return; }
      v.header({ title: def[1], back: 'settings' });
      await SECTIONS[k](v);
      return;
    }
    v.header({ title: 'Settings' });
    v.root.append(...SETTINGS.map((g) => {
      const items = g.items.filter(settingOk);
      return items.length ? section(g.group, h('div', { class: 'list' }, items.map(([id, t, sub, ic]) => liRow({ icon: ic, title: t, sub, onclick: () => go('settings/' + id) })))) : null;
    }).filter(Boolean));
    if (can('pay_admin')) v.root.append(h('div', { class: 'list' }, liRow({ icon: 'bolt', tone: 'gray', title: 'Run the setup guide again', sub: 'Five questions to set the basics', onclick: () => setupWizard() })));
  },
});

// save a part of the organisation and keep the page's copy in step
async function saveOrg(p, msg) {
  const o = await api('pay_save_org', { p });
  S.ctx.org = o;
  toast(msg || 'Saved');
  return o;
}
// a section page with one Save button at the bottom (and in the header on desktop)
function saveBar(v, onSave, label = 'Save') {
  const run = async (b) => { if (b) b.disabled = true; try { await onSave(); } catch (e) { fail(e); } finally { if (b) b.disabled = false; } };
  v.header({ title: v.root.dataset.title || $('#tb-t').textContent, back: 'settings', actions: [{ label, primary: true, icon: 'check', run }] });
  return h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } }, h('button', { class: 'btn fill', type: 'button', onclick: (e) => run(e.currentTarget) }, label));
}
const numIn = (val, on, o = {}) => input({ type: 'number', mode: o.mode || 'numeric', value: val ?? '', min: o.min, maxv: o.max, step: o.step, oninput: (e) => on(e.target.value) });

// ---------- business details ----------
SECTIONS.company = async (v) => {
  const o = { ...org() };
  const t = (k, label, hint, opt = {}) => field(label, input({ value: o[k] || '', max: opt.max, mode: opt.mode, oninput: (e) => { o[k] = e.target.value; } }), hint);
  v.root.append(
    section('Shown on payslips', h('div', { class: 'card grid' },
      t('legal_name', 'Legal name'), t('display_name', 'Short name', 'Used in the app and on the kiosk'),
      t('address', 'Address'), h('div', { class: 'grid two' }, t('city', 'City'), t('pincode', 'PIN code', null, { mode: 'numeric', max: 6 })),
      field('State', selectEl(stateOptions(), o.state_code || '', { onchange: (e) => { o.state_code = e.target.value; } }), 'The default for people without a location'),
      h('div', { class: 'grid two' }, t('phone', 'Phone', null, { mode: 'tel' }), t('email', 'Email')))),
    section('Tax and registrations', h('div', { class: 'card grid' },
      h('div', { class: 'grid two' }, t('pan', 'PAN', 'Like ABCDE1234F', { max: 10 }), t('tan', 'TAN', 'Needed to deduct income tax', { max: 10 })),
      h('div', { class: 'grid two' }, t('pf_code', 'PF establishment code'), t('esi_code', 'ESI employer code')),
      h('div', { class: 'grid two' }, t('pt_reg', 'Professional tax registration'), t('lwf_reg', 'Labour welfare fund registration')))),
    saveBar(v, async () => {
      const p = {}; ['legal_name', 'display_name', 'address', 'city', 'pincode', 'state_code', 'phone', 'email', 'pan', 'tan', 'pf_code', 'esi_code', 'pt_reg', 'lwf_reg'].forEach((k) => { p[k] = o[k] || ''; });
      await saveOrg(p);
    }));
};

// ---------- locations ----------
SECTIONS.locations = async (v) => {
  const locs = S.ctx.locations || [];
  v.header({ title: 'Locations', back: 'settings', actions: [{ label: 'Add location', icon: 'plus', primary: true, run: () => locationSheet() }] });
  v.root.append(h('p', { class: 'muted' }, 'Each location’s state decides professional tax. Set a clock-in area to check that people are at work when they clock in from their phone.'),
    locs.length ? h('div', { class: 'list' }, locs.map((l) => liRow({ icon: 'pin', title: l.name, sub: [STATES[l.state_code] || 'No state', l.radius_m ? 'Clock-in area ' + l.radius_m + ' m' : 'No clock-in area', l.active ? null : 'Not in use'].filter(Boolean).join(' · '), onclick: () => locationSheet(l) })))
      : empty('pin', 'No locations yet', 'With one place of work you can skip this.', h('button', { class: 'btn fill', onclick: () => locationSheet() }, 'Add location')));
};
function locationSheet(l = {}) {
  const x = { ...l };
  const lat = input({ type: 'number', mode: 'decimal', value: x.lat ?? '', step: 'any', label: 'Latitude', oninput: (e) => { x.lat = e.target.value; } });
  const lng = input({ type: 'number', mode: 'decimal', value: x.lng ?? '', step: 'any', label: 'Longitude', oninput: (e) => { x.lng = e.target.value; } });
  const here = h('button', { class: 'btn', type: 'button', onclick: () => {
    if (!navigator.geolocation) return toast('This device cannot share its location', { err: true });
    here.disabled = true;
    navigator.geolocation.getCurrentPosition((p) => { here.disabled = false; x.lat = lat.value = p.coords.latitude.toFixed(6); x.lng = lng.value = p.coords.longitude.toFixed(6); if (!x.radius_m) { x.radius_m = 150; rad.value = 150; } toast('Location set'); },
      (er) => { here.disabled = false; toast(er.code === 1 ? 'Location permission was refused' : 'Could not read the location', { err: true }); }, { enableHighAccuracy: true, timeout: 15000 });
  } }, icon('pin', 18), 'Use where I am now');
  const rad = numIn(x.radius_m, (val) => { x.radius_m = val; });
  sheet({ title: l.id ? 'Location' : 'New location', body: h('div', { class: 'grid' },
    field('Name', input({ value: x.name || '', oninput: (e) => { x.name = e.target.value; } })),
    field('State', selectEl(stateOptions(), x.state_code || org().state_code || '', { onchange: (e) => { x.state_code = e.target.value; } })),
    field('Address', input({ value: x.address || '', oninput: (e) => { x.address = e.target.value; } })),
    section('Clock-in area (optional)', h('div', { class: 'card grid' }, here, h('div', { class: 'grid two' }, field('Latitude', lat), field('Longitude', lng)), field('Radius in metres', rad, '100 to 300 m works for most shops'))),
    l.id ? h('div', { class: 'list' }, toggleRow('In use', x.active !== false, (on) => { x.active = on; })) : null),
  actions: [{ label: 'Save', primary: true, onclick: async (close) => {
    await api('pay_save_location', { p: { id: x.id, name: x.name, state_code: x.state_code, address: x.address, lat: x.lat, lng: x.lng, radius_m: x.radius_m, active: x.active !== false } });
    await loadCtx(); close(); toast('Saved'); route_();
  } }] });
}

// ---------- lists (masters) ----------
const MASTER_KINDS = [['department', 'Departments'], ['designation', 'Designations'], ['grade', 'Grades'], ['cost_centre', 'Cost centres'], ['claim_type', 'Claim types'], ['doc_type', 'Document types']];
SECTIONS.lists = async (v) => {
  let kind = v.q.get('kind') || 'department';
  const box = h('div');
  const paint = () => {
    const all = (S.ctx.masters || []).filter((m) => m.kind === kind);
    const adminOnly = !['department', 'designation'].includes(kind) && !can('pay_admin');
    clear(box).append(all.length ? h('div', { class: 'list' }, all.map((m) => liRow({ title: m.name, badge: m.active ? null : badge('Hidden'), right: adminOnly ? null : h('button', { class: 'btn sm plain', type: 'button', onclick: async () => {
      try { await api('pay_save_master', { p: { id: m.id, kind, name: m.name, active: !m.active } }); await loadCtx(); paint(); } catch (e) { fail(e); }
    } }, m.active ? 'Hide' : 'Show') }))) : empty('list', 'Nothing yet', 'Add the first one below.'),
    adminOnly ? null : h('div', { class: 'row', style: { gap: '8px', marginTop: '12px' } }, (() => {
      const i = input({ placeholder: 'Add ' + MASTER_KINDS.find((x) => x[0] === kind)[1].toLowerCase().replace(/s$/, ''), label: 'New name' });
      const addIt = async () => { if (!i.value.trim()) return; try { await api('pay_save_master', { p: { kind, name: i.value.trim() } }); await loadCtx(); paint(); toast('Added'); } catch (e) { fail(e); } };
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') addIt(); });
      return [h('div', { class: 'grow' }, i), h('button', { class: 'btn fill', type: 'button', onclick: addIt }, 'Add')];
    })()));
  };
  v.root.append(h('div', { style: { overflowX: 'auto' } }, chips(MASTER_KINDS, kind, (x) => { kind = x; paint(); }, { label: 'List' })), box);
  paint();
};

// ---------- pay rules + salary structures ----------
SECTIONS.pay = async (v) => {
  const o = org(), p = { pay_day: o.pay_day, proration: o.proration, fy_start_month: o.fy_start_month };
  const ps = { ...((o.settings || {}).payslip || {}) }, fnf = { ...((o.settings || {}).fnf || {}) };
  v.root.append(
    section('When and how', h('div', { class: 'card grid' },
      field('Pay day', selectEl([[0, 'Last day of the month'], ...Array.from({ length: 28 }, (_, i) => [i + 1, (i + 1) + ' of the next month'])], p.pay_day, { onchange: (e) => { p.pay_day = +e.target.value; } }), 'The date printed on payslips'),
      field('Unpaid days are worked out on', optionCards([
        ['calendar', 'calendar', 'Days in the month', 'A day off costs 1/30 in June and 1/31 in July. The usual way.'],
        ['fixed30', 'calendar', 'Always 30 days', 'Every day is 1/30 of the monthly salary.'],
        ['fixed26', 'calendar', 'Always 26 days', 'Common in shops and factories with a weekly day off.'],
        ['working', 'calendar', 'Working days only', 'Weekly offs and holidays are left out of the count.']], p.proration, (x) => { p.proration = x; })))),
    section('Payslips', h('div', { class: 'list' },
      toggleRow('Show employer contributions', !!ps.show_employer, (on) => { ps.show_employer = on; }, 'Employer PF and ESI printed under the salary'),
      h('div', { class: 'li' }, h('div', { class: 'grow' }, field('Note at the bottom', input({ value: ps.note || '', placeholder: 'For example: This is a computer-generated payslip', oninput: (e) => { ps.note = e.target.value; } })))))),
    section('When someone leaves', h('div', { class: 'card grid' },
      field('Leave encashment is paid on', seg([['basic', 'Basic pay'], ['gross', 'Full salary']], fnf.encash_basis || 'basic', (x) => { fnf.encash_basis = x; }, { full: true, label: 'Encashment basis' })),
      field('Days in a month for encashment', numIn(fnf.encash_divisor ?? 26, (x) => { fnf.encash_divisor = x; }, { min: 1, max: 31 }), 'Usually 26 or 30'),
      field('Financial year starts in', selectEl(Array.from({ length: 12 }, (_, i) => [i + 1, monthName('2026-' + pad(i + 1), { noYear: true })]), p.fy_start_month, { onchange: (e) => { p.fy_start_month = +e.target.value; } }), 'April in India'))),
    saveBar(v, () => saveOrg({ ...p, settings: { payslip: ps, fnf } })));
  if (can('pay_admin')) {
    const ss = S.ctx.structures || [];
    v.root.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Salary structures'), h('button', { class: 'btn sm', type: 'button', onclick: () => structureSheet() }, icon('plus', 16), 'New')),
      h('p', { class: 'small muted', style: { marginBottom: '8px' } }, 'How one salary amount is split into basic, house rent and allowances. Changing a structure changes the pay of everyone on it from the next payroll.'),
      h('div', { class: 'list' }, ss.map((s) => liRow({ icon: 'layers', title: s.name, sub: (s.basis === 'ctc' ? 'Yearly cost to company · ' : 'Monthly salary · ') + (s.description || s.lines.map((l) => l.code).join(', ')), badge: s.is_default ? badge('Default', 'blue') : s.active ? null : badge('Not in use'), onclick: () => structureSheet(s) })))),
    section(h('div', { class: 'row sp' }, h('h3', null, 'Pay components'), h('button', { class: 'btn sm', type: 'button', onclick: () => componentSheet() }, icon('plus', 16), 'New')),
      h('p', { class: 'small muted', style: { marginBottom: '8px' } }, 'The lines on a payslip. Built-in ones (PF, ESI, tax, overtime) are worked out automatically.'),
      h('div', { class: 'list' }, (S.ctx.components || []).map((c) => liRow({ title: c.name, sub: c.code + ' · ' + ({ earning: 'Earning', deduction: 'Deduction', employer: 'Paid by you', reimbursement: 'Reimbursement' })[c.kind] + (c.system ? ' · automatic' : ''), badge: c.active ? null : badge('Not in use'), onclick: () => componentSheet(c) })))));
  }
};
const CALC = [['formula', 'Formula'], ['fixed', 'Fixed amount'], ['balance', 'The rest']];
function structureSheet(s = {}) {
  const x = { name: s.name || '', description: s.description || '', basis: s.basis || 'monthly', is_default: !!s.is_default, active: s.active !== false, lines: JSON.parse(JSON.stringify(s.lines || [{ code: 'BASIC', calc: 'formula', formula: 'GROSS * 0.5' }, { code: 'SPECIAL', calc: 'balance' }])) };
  const comps = (S.ctx.components || []).filter((c) => c.active && (!c.system || ['PF_ER'].includes(c.code)));
  const linesBox = h('div', { class: 'grid' }), prev = h('div');
  let sample = x.basis === 'ctc' ? 600000 : 30000;
  const preview = debounce(async () => {
    try {
      const b = await api('pay_preview_structure', { p: { lines: x.lines, basis: x.basis, amount: sample } });
      clear(prev).append(h('div', { class: 'list' }, (b.order || []).map((k) => liRow({ title: (b.names || {})[k] || k, sub: ({ earning: 'Earning', deduction: 'Deduction', employer: 'Paid by you', reimbursement: 'Reimbursement' })[b.kinds[k]], value: inr(b.lines[k]) })),
        liRow({ title: 'Monthly gross', value: h('b', null, inr(b.gross)) }), x.basis === 'ctc' ? liRow({ title: 'Monthly cost to you', value: inr(b.ctc) }) : null));
    } catch (e) { clear(prev).append(banner('red', 'alert', e.message)); }
  }, 300);
  const paintLines = () => {
    clear(linesBox).append(...x.lines.map((l, i) => h('div', { class: 'card grid', style: { gap: '8px' } },
      h('div', { class: 'row', style: { gap: '8px' } },
        h('div', { class: 'grow' }, selectEl(comps.map((c) => [c.code, c.name + ' (' + c.code + ')']), l.code, { label: 'Component', onchange: (e) => { l.code = e.target.value; preview(); } })),
        h('button', { class: 'btn icon plain', type: 'button', 'aria-label': 'Remove', onclick: () => { x.lines.splice(i, 1); paintLines(); preview(); } }, icon('trash', 18))),
      seg(CALC, l.calc || 'fixed', (c) => { l.calc = c; paintLines(); preview(); }, { full: true, label: 'How it is worked out' }),
      l.calc === 'formula' ? field('Formula', input({ value: l.formula || '', placeholder: 'GROSS * 0.5', oninput: (e) => { l.formula = e.target.value; preview(); } }), 'Use GROSS' + (x.basis === 'ctc' ? ', CTC (monthly)' : '') + ', other codes above, PF_CEILING, DAYS; and min(), max(), round(), if()')
        : l.calc === 'fixed' ? field('Amount a month', numIn(l.value, (val) => { l.value = val; preview(); }, { mode: 'decimal' }))
          : h('p', { class: 'small muted' }, 'Takes whatever is left so the total matches the salary. Only one line can do this.'))),
    h('button', { class: 'btn', type: 'button', onclick: () => { const used = x.lines.map((l) => l.code); const c = comps.find((y) => !used.includes(y.code)); if (!c) return toast('Every component is already used'); x.lines.splice(Math.max(0, x.lines.findIndex((l) => l.calc === 'balance')) || x.lines.length, 0, { code: c.code, calc: 'fixed', value: 0 }); paintLines(); preview(); } }, icon('plus', 18), 'Add a line'));
  };
  paintLines(); preview();
  sheet({ title: s.id ? 'Salary structure' : 'New salary structure', wide: true, body: h('div', { class: 'grid' },
    field('Name', input({ value: x.name, oninput: (e) => { x.name = e.target.value; } })),
    field('Description', input({ value: x.description, placeholder: 'For example: basic half, the rest allowance', oninput: (e) => { x.description = e.target.value; } })),
    field('The amount people are given is', seg([['monthly', 'Monthly salary'], ['ctc', 'Yearly cost to company']], x.basis, (b) => { x.basis = b; sample = b === 'ctc' ? 600000 : 30000; samp.value = sample; paintLines(); preview(); }, { full: true, label: 'Basis' })),
    section('Lines', linesBox),
    section('Try it', h('div', { class: 'card grid' }, field(x.basis === 'ctc' ? 'Yearly cost to company' : 'Monthly salary', (samp = numIn(sample, (val) => { sample = N(val); preview(); }, { mode: 'decimal' }))), prev)),
    h('div', { class: 'list' }, toggleRow('Default for new people', x.is_default, (on) => { x.is_default = on; }), s.id ? toggleRow('In use', x.active, (on) => { x.active = on; }) : null)),
  actions: [{ label: 'Save', primary: true, onclick: async (close) => {
    await api('pay_save_structure', { p: { id: s.id, ...x } }); await loadCtx(); close(); toast('Saved'); route_();
  } }] });
  var samp;
}
function componentSheet(c = {}) {
  const x = { code: c.code || '', name: c.name || '', kind: c.kind || 'earning', taxable: c.taxable !== false, pf_wage: !!c.pf_wage, esi_wage: c.esi_wage !== false, pt_wage: c.pt_wage !== false,
    prorate: c.prorate !== false, is_basic: !!c.is_basic, on_payslip: c.on_payslip !== false, active: c.active !== false, gl_key: c.gl_key || '' };
  const sys = !!c.system;
  sheet({ title: c.id ? c.name : 'New pay component', body: h('div', { class: 'grid' },
    sys ? banner('info', 'info', 'This line is worked out automatically. You can rename it or hide it from payslips.') : null,
    field('Name', input({ value: x.name, oninput: (e) => { x.name = e.target.value; } })),
    sys ? null : field('Code', input({ value: x.code, placeholder: 'FOOD_ALLOW', oninput: (e) => { x.code = e.target.value.toUpperCase(); } }), 'Short, used in formulas'),
    sys ? null : field('Type', seg([['earning', 'Earning'], ['deduction', 'Deduction'], ['employer', 'Paid by you'], ['reimbursement', 'Reimbursement']], x.kind, (k) => { x.kind = k; }, { full: true, label: 'Type' })),
    h('div', { class: 'list' },
      sys ? null : toggleRow('Reduced for unpaid days', x.prorate, (on) => { x.prorate = on; }),
      sys ? null : toggleRow('Taxable', x.taxable, (on) => { x.taxable = on; }),
      sys ? null : toggleRow('Counts as basic pay', x.is_basic, (on) => { x.is_basic = on; }, 'Basic and DA: used for gratuity, bonus and leave encashment'),
      sys ? null : toggleRow('Counts for PF', x.pf_wage, (on) => { x.pf_wage = on; }, 'Basic, DA and retaining allowance'),
      sys ? null : toggleRow('Counts for ESI', x.esi_wage, (on) => { x.esi_wage = on; }),
      sys ? null : toggleRow('Counts for professional tax', x.pt_wage, (on) => { x.pt_wage = on; }),
      toggleRow('Show on payslips', x.on_payslip, (on) => { x.on_payslip = on; }),
      c.id && !sys ? toggleRow('In use', x.active, (on) => { x.active = on; }) : null)),
  actions: [{ label: 'Save', primary: true, onclick: async (close) => { await api('pay_save_component', { p: { id: c.id, ...x } }); await loadCtx(); close(); toast('Saved'); route_(); } }] });
}

// ---------- government deductions ----------
const SCHEME_NAMES = { PF: 'Provident fund', ESI: 'ESI', PT: 'Professional tax', LWF: 'Labour welfare fund', TDS: 'Income tax', GRATUITY: 'Gratuity', BONUS: 'Statutory bonus' };
SECTIONS.statutory = async (v) => {
  const o = org(), st = o.settings || {};
  const g = (k) => ({ ...(st[k] || {}) });
  const pf = g('pf'), esi = g('esi'), pt = g('pt'), lwf = g('lwf'), tds = g('tds'), flat = { pf: 12, esi: 0.75, pt: 200, tds: 0, ...(st.flat || {}) };
  let mode = o.stat_mode;
  const flatBox = h('div');
  const paintFlat = () => {
    clear(flatBox);
    if (mode !== 'flat') return;
    flatBox.append(banner('orange', 'alert', h('b', null, 'Simple rates are on. '), 'These are the flat percentages the old Payroll used. They ignore the PF wage ceiling, ESI eligibility and the state professional tax slabs, so they are often wrong. Switch to the official rules when you are ready.'),
      h('div', { class: 'card grid' }, h('div', { class: 'grid two' }, field('PF, % of gross', numIn(flat.pf, (x) => { flat.pf = N(x); }, { mode: 'decimal', step: '0.01' })), field('ESI, % of gross', numIn(flat.esi, (x) => { flat.esi = N(x); }, { mode: 'decimal', step: '0.01' }))),
        h('div', { class: 'grid two' }, field('Professional tax, ₹ a month', numIn(flat.pt, (x) => { flat.pt = N(x); }, { mode: 'decimal' })), field('Income tax, % of gross', numIn(flat.tds, (x) => { flat.tds = N(x); }, { mode: 'decimal', step: '0.01' })))));
  };
  paintFlat();
  v.root.append(
    section('How deductions are worked out', h('div', { class: 'card grid' }, seg([['rules', 'Official rules'], ['flat', 'Simple rates']], mode, (x) => { mode = x; paintFlat(); }, { full: true, label: 'Mode' }),
      h('p', { class: 'small muted' }, 'Official rules follow each act: ceilings, eligibility, state slabs and income-tax projection, each from a dated rule with its source.')), flatBox),
    section('Provident fund', h('div', { class: 'list' },
      toggleRow('Deduct PF', !!pf.enabled, (on) => { pf.enabled = on; }, o.pf_code ? 'Code ' + o.pf_code : 'Add your PF code under Business details'),
      toggleRow('Employee share on full basic', !!pf.on_actual, (on) => { pf.on_actual = on; }, 'Off: capped at the PF wage ceiling'),
      toggleRow('Your share on full basic', !!pf.er_on_actual, (on) => { pf.er_on_actual = on; }),
      toggleRow('Add insurance (EDLI) charges', pf.edli !== false, (on) => { pf.edli = on; }),
      toggleRow('Add admin charges', pf.admin !== false, (on) => { pf.admin = on; }))),
    section('ESI', h('div', { class: 'list' }, toggleRow('Deduct ESI', !!esi.enabled, (on) => { esi.enabled = on; }, 'For people whose wages are under the ESI ceiling'))),
    section('Professional tax', h('div', { class: 'list' }, toggleRow('Deduct professional tax', !!pt.enabled, (on) => { pt.enabled = on; }, 'By the slab of each person’s work state; states without it deduct nothing'))),
    section('Labour welfare fund', h('div', { class: 'list' }, toggleRow('Deduct labour welfare fund', !!lwf.enabled, (on) => { lwf.enabled = on; }, 'Needs a rule for your state (add one below)'))),
    section('Income tax', h('div', { class: 'list' }, toggleRow('Deduct income tax (TDS)', tds.enabled !== false, (on) => { tds.enabled = on; }, 'Projected over the year from each person’s salary and declarations'))),
    saveBar(v, () => saveOrg({ stat_mode: mode, settings: { pf, esi, pt, lwf, tds, flat } })));
  const rules = await api('pay_list_rules');
  const box = h('div');
  const byScheme = {};
  rules.forEach((r) => { (byScheme[r.scheme] = byScheme[r.scheme] || []).push(r); });
  Object.entries(byScheme).forEach(([sc, rs]) => box.append(section(SCHEME_NAMES[sc] || sc, h('div', { class: 'list' }, rs.map((r) => liRow({
    title: ({ IN: 'All India', new: 'New regime', old: 'Old regime' }[r.region] || STATES[r.region] || r.region) + ' · from ' + fmtD(r.eff_from) + (r.eff_to ? ' to ' + fmtD(r.eff_to) : ''),
    sub: r.source + (r.verified_on ? ' · checked ' + fmtD(r.verified_on) : ''), badge: r.own ? badge('Yours', 'blue') : null, onclick: () => ruleSheet(r) }))))));
  v.root.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Rules in use'), h('button', { class: 'btn sm', type: 'button', onclick: () => ruleSheet() }, icon('plus', 16), 'Add your own')),
    h('p', { class: 'small muted', style: { marginBottom: '8px' } }, 'Each rate comes from a dated rule with the notification it came from. A new rule takes over from its start date; old payrolls keep the rule they used.'), box));
};
function ruleSheet(r = {}) {
  const own = !r.id || r.own;
  const x = { scheme: r.scheme || 'LWF', region: r.region || org().state_code || 'IN', eff_from: r.eff_from || today(), eff_to: r.eff_to || '', source: r.source || '', note: r.note || '', params: JSON.stringify(r.params || {}, null, 2) };
  const ta = h('textarea', { class: 'textarea mono', rows: 10, 'aria-label': 'Values', disabled: !own, oninput: (e) => { x.params = e.target.value; } }, x.params);
  sheet({ title: r.id ? (SCHEME_NAMES[r.scheme] || r.scheme) : 'Add a rule', wide: true, body: h('div', { class: 'grid' },
    own ? null : banner('info', 'info', 'Kept up to date by AUZslab. To use different values, add your own rule with a later start date.'),
    own && !r.id ? field('Scheme', selectEl(Object.entries(SCHEME_NAMES), x.scheme, { onchange: (e) => { x.scheme = e.target.value; } })) : null,
    field('Applies to', selectEl([['IN', 'All India'], ...stateOptions().slice(1)], x.region, { onchange: (e) => { x.region = e.target.value; } })),
    h('div', { class: 'grid two' }, field('From', dateInput(x.eff_from, { onchange: (e) => { x.eff_from = e.target.value; } })), field('Until (optional)', dateInput(x.eff_to, { onchange: (e) => { x.eff_to = e.target.value; } }))),
    field('Source', input({ value: x.source, placeholder: 'Act, notification or circular, with its date', oninput: (e) => { x.source = e.target.value; } }), 'Required: say where these values come from'),
    field('Values', ta, own ? 'Copy an existing rule of the same scheme and change only the numbers' : null),
    field('Note', input({ value: x.note, oninput: (e) => { x.note = e.target.value; } }))),
  actions: own ? [{ label: 'Save', primary: true, onclick: async (close) => {
    let params; try { params = JSON.parse(x.params); } catch { throw new Error('The values are not valid. Check commas and quotes.'); }
    await api('pay_save_rule', { p: { id: r.id, scheme: x.scheme, region: x.region, eff_from: x.eff_from, eff_to: x.eff_to, source: x.source, note: x.note, params } }); close(); toast('Saved'); route_();
  } }] : [] });
  [...$$('input,select', ta.closest('.sheet'))].forEach((i) => { if (!own) i.disabled = true; });
}

// ---------- attendance ----------
SECTIONS.time = async (v) => {
  const o = org(), a = { ...((o.settings || {}).att || {}) };
  const p = { attendance_mode: o.attendance_mode, weekly_off: [...(o.weekly_off || [])] };
  const d = (k, def) => (a[k] === undefined ? def : a[k]);
  v.root.append(
    section('How attendance is tracked', optionCards([
      ['punch', 'clock', 'Staff clock in', 'Phone, shared kiosk or the POS. No clock-in on a work day means absent.'],
      ['manual', 'edit', 'I mark who was away', 'Everyone is present unless you mark an absence or leave.'],
      ['none', 'cash', 'No attendance', 'A fixed salary. Only unpaid leave reduces it.']], p.attendance_mode, (x) => { p.attendance_mode = x; })),
    section('Weekly day off', h('div', { class: 'card grid' }, chips(WEEKDAYS.map((w, i) => [i, w]), p.weekly_off, (x, on) => { p.weekly_off = on ? [...new Set([...p.weekly_off, x])] : p.weekly_off.filter((y) => y !== x); }, { wrap: true, label: 'Weekly day off' }),
      h('p', { class: 'small muted' }, 'Pick none if staff take turns: give each person their own day off on their profile or the roster.'))),
    section('Late and short days', h('div', { class: 'card grid' },
      h('div', { class: 'grid two' }, field('Late after (minutes)', numIn(d('late_grace', 15), (x) => { a.late_grace = N(x); }, { min: 0, max: 240 }), 'Grace after the shift starts'),
        field('Half day below (% of shift)', numIn(d('half_pct', 55), (x) => { a.half_pct = N(x); }, { min: 1, max: 100 }))),
      h('div', { class: 'grid two' }, field('Every so many late marks', numIn(d('late_lop_every', 0), (x) => { a.late_lop_every = N(x); }, { min: 0 }), '0 = late marks cost nothing'),
        field('…cut this many days', numIn(d('late_lop_days', 0.5), (x) => { a.late_lop_days = N(x); }, { mode: 'decimal', step: '0.5', min: 0 }))),
      field('Clocked in but never out', selectEl([['present', 'Count as present, and flag it'], ['half', 'Count as half day'], ['absent', 'Count as absent']], d('missing_out', 'present'), { onchange: (e) => { a.missing_out = e.target.value; } })),
      field('Working minutes in a day without a shift', numIn(d('day_mins', 480), (x) => { a.day_mins = N(x); }, { min: 60, max: 1440 }), '480 = 8 hours'),
      h('div', { class: 'list' }, toggleRow('People without a shift are present whenever they clock in', d('noshift_full', true) !== false && d('noshift_full', true) !== 'false', (on) => { a.noshift_full = on; })))),
    section('Overtime', h('div', { class: 'list' },
      toggleRow('Count overtime', d('ot', true) !== false && d('ot', true) !== 'false', (on) => { a.ot = on; }, 'Paid at each person’s overtime rate (set with their salary)'),
      toggleRow('Also for people without a shift', d('ot_noshift', false) === true || d('ot_noshift', false) === 'true', (on) => { a.ot_noshift = on; }),
      h('div', { class: 'li' }, h('div', { class: 'grow' }, field('Ignore overtime under (minutes)', numIn(d('ot_min', 0), (x) => { a.ot_min = N(x); }, { min: 0 })))),
      h('div', { class: 'li' }, h('div', { class: 'grow' }, field('Work on a day off or holiday', selectEl([['ot', 'All of it is overtime'], ['none', 'Normal day, no extra pay']], d('holiday_work', 'ot'), { onchange: (e) => { a.holiday_work = e.target.value; } })))))),
    section('Clocking in', h('div', { class: 'list' },
      h('div', { class: 'li' }, h('div', { class: 'grow' }, field('Away from the workplace', selectEl([['off', 'Don’t check'], ['flag', 'Allow, but flag it'], ['block', 'Don’t allow']], d('geofence', 'flag'), { onchange: (e) => { a.geofence = e.target.value; } }), 'Needs a clock-in area on the location'))),
      toggleRow('Kiosk needs a PIN', d('kiosk_pin', true) !== false && d('kiosk_pin', true) !== 'false', (on) => { a.kiosk_pin = on; }, 'Stops people clocking in for each other'))),
    saveBar(v, async () => { await saveOrg({ attendance_mode: p.attendance_mode, weekly_off: p.weekly_off.map(Number).sort(), settings: { att: a } }); }),
    section('Shifts and holidays', h('div', { class: 'list' }, liRow({ icon: 'clock', title: 'Shifts', sub: (S.ctx.shifts || []).length + ' set up', onclick: () => go('time?v=shifts') }), liRow({ icon: 'calendar', title: 'Holidays', sub: (S.ctx.holidays || []).length + ' this year and next', onclick: () => go('time?v=shifts') }))));
};

// ---------- leave types ----------
SECTIONS.leave = async (v) => {
  const o = org();
  let lys = o.leave_year_start;
  v.header({ title: 'Leave types', back: 'settings', actions: [{ label: 'Add leave type', icon: 'plus', primary: true, run: () => leaveTypeSheet() }] });
  v.root.append(h('div', { class: 'list' }, (S.ctx.leave_types || []).map((t) => liRow({ icon: 'leave', title: t.name, sub: [t.code, t.paid ? (+t.quota ? qty(t.quota) + ' days a year' + (t.accrual === 'monthly' ? ', added monthly' : '') : 'No quota') : 'Unpaid', t.encashable ? 'paid out when leaving' : null].filter(Boolean).join(' · '), badge: t.active ? null : badge('Not in use'), onclick: () => leaveTypeSheet(t) }))),
    section('Leave year', h('div', { class: 'card grid' }, field('Starts in', selectEl(Array.from({ length: 12 }, (_, i) => [i + 1, monthName('2026-' + pad(i + 1), { noYear: true })]), lys, { onchange: async (e) => { lys = +e.target.value; try { await saveOrg({ leave_year_start: lys }); } catch (er) { fail(er); } } }), 'Quotas are given and unused days carried forward at the start'))));
};
function leaveTypeSheet(t = {}) {
  const x = { code: t.code || '', name: t.name || '', paid: t.paid !== false, quota: t.quota ?? 12, accrual: t.accrual || 'yearly', carry_max: t.carry_max ?? '', encashable: !!t.encashable, half_day: t.half_day !== false, allow_negative: !!t.allow_negative, count_offdays: !!t.count_offdays, gender: t.gender || '', active: t.active !== false };
  const paidBox = h('div', { class: 'grid' });
  const paint = () => { clear(paidBox); if (!x.paid) return; paidBox.append(
    h('div', { class: 'grid two' }, field('Days a year', numIn(x.quota, (val) => { x.quota = val; }, { mode: 'decimal', step: '0.5', min: 0 })), field('Given', selectEl([['yearly', 'All at the start of the year'], ['monthly', 'A share every month'], ['none', 'Only when I add it']], x.accrual, { onchange: (e) => { x.accrual = e.target.value; } }))),
    field('Unused days carried to next year', input({ type: 'number', mode: 'decimal', value: x.carry_max, placeholder: 'All of them', oninput: (e) => { x.carry_max = e.target.value; } }), '0 = they lapse; empty = all carry forward'),
    h('div', { class: 'list' }, toggleRow('Paid out when someone leaves', x.encashable, (on) => { x.encashable = on; }), toggleRow('Can go below zero', x.allow_negative, (on) => { x.allow_negative = on; }))); };
  paint();
  sheet({ title: t.id ? t.name : 'New leave type', body: h('div', { class: 'grid' },
    h('div', { class: 'grid two' }, field('Name', input({ value: x.name, oninput: (e) => { x.name = e.target.value; } })), field('Short code', input({ value: x.code, max: 12, placeholder: 'CL', oninput: (e) => { x.code = e.target.value.toUpperCase(); } }))),
    h('div', { class: 'list' }, toggleRow('Paid', x.paid, (on) => { x.paid = on; paint(); }, 'Unpaid leave reduces the salary')),
    paidBox,
    h('div', { class: 'list' }, toggleRow('Half days allowed', x.half_day, (on) => { x.half_day = on; }), toggleRow('Days off inside the leave count too', x.count_offdays, (on) => { x.count_offdays = on; }, 'Usually off: a Sunday in the middle is not leave'), t.id ? toggleRow('In use', x.active, (on) => { x.active = on; }) : null),
    field('Only for', seg([['', 'Everyone'], ['female', 'Women'], ['male', 'Men']], x.gender, (g) => { x.gender = g; }, { full: true, label: 'Only for' }))),
  actions: [{ label: 'Save', primary: true, onclick: async (close) => { await api('pay_save_leave_type', { p: { id: t.id, ...x } }); await loadCtx(); close(); toast('Saved'); route_(); } }] });
}

// ---------- access ----------
SECTIONS.access = async (v) => {
  const ac = { ...((org().settings || {}).access || {}) };
  const on = (k) => ac[k] === true || ac[k] === 'true';
  v.root.append(
    section('Roles', h('div', { class: 'list' },
      liRow({ icon: 'key', title: 'Owner', sub: 'Everything, including settings and payments' }),
      liRow({ icon: 'users', title: 'Managers', sub: on('manager_salary') ? 'People, time, leave, salaries and payroll' : 'People, time, leave and reports. No salaries, bank details or PAN' }),
      liRow({ icon: 'user', title: 'Staff with a login', sub: 'Only their own day, leave, payslips and profile' }),
      liRow({ icon: 'lock', title: 'Custom roles', sub: 'Exactly the Payroll rights ticked on the account page', onclick: () => { location.href = '/account.html'; } }))),
    section('Managers', h('div', { class: 'list' }, toggleRow('Managers can see and run payroll', on('manager_salary'), (x) => { ac.manager_salary = x; }, 'Off: managers never see salaries, bank accounts or PAN'))),
    section('Approvals', h('div', { class: 'list' },
      toggleRow('Payroll needs a review step', on('require_review'), (x) => { ac.require_review = x; }, 'Someone sends it for approval before it can be approved'),
      toggleRow('Two different people', on('two_person'), (x) => { ac.two_person = x; }, 'The person who calculates a payroll cannot approve it'))),
    saveBar(v, () => saveOrg({ settings: { access: ac } }).then(() => loadCtx())));
};

// ---------- accounting ----------
SECTIONS.accounting = async (v) => {
  const acc = { post: 'auto', ...((org().settings || {}).accounting || {}) };
  v.root.append(h('p', { class: 'muted' }, 'A finalised payroll books salary expense, what you owe staff and the government, and advances recovered. Payments clear what you owe.'),
    optionCards([['auto', 'bolt', 'Automatically', 'Posted the moment a payroll is finalised or paid.'], ['manual', 'edit', 'When I press Post', 'Each payroll shows a Post to accounts button.'], ['off', 'x', 'Don’t post', 'Keep payroll and accounts separate.']], acc.post, (x) => { acc.post = x; }),
    saveBar(v, () => saveOrg({ settings: { accounting: acc } })));
};

// ---------- notices ----------
SECTIONS.notices = async (v) => {
  const list = await api('pay_list_announcements');
  v.header({ title: 'Notices for staff', back: 'settings', actions: [{ label: 'New notice', icon: 'plus', primary: true, run: () => noticeSheet() }] });
  v.root.append(h('p', { class: 'muted' }, 'The latest five show on everyone’s Today screen.'),
    list.length ? h('div', { class: 'list' }, list.map((n) => liRow({ icon: 'chat', title: n.title, sub: (n.body ? n.body.slice(0, 80) + ' · ' : '') + fmtD(n.created_at || n.at), badge: n.active ? null : badge('Hidden'), onclick: () => noticeSheet(n) })))
      : empty('chat', 'No notices', 'Tell everyone about a holiday, a new rule or pay day.', h('button', { class: 'btn fill', onclick: () => noticeSheet() }, 'New notice')));
};
function noticeSheet(n = {}) {
  const x = { title: n.title || '', body: n.body || '', active: n.active !== false };
  sheet({ title: n.id ? 'Notice' : 'New notice', body: h('div', { class: 'grid' },
    field('Title', input({ value: x.title, max: 120, oninput: (e) => { x.title = e.target.value; } })),
    field('Message', h('textarea', { class: 'textarea', rows: 5, oninput: (e) => { x.body = e.target.value; } }, x.body)),
    n.id ? h('div', { class: 'list' }, toggleRow('Show to staff', x.active, (on) => { x.active = on; })) : null),
  actions: [{ label: n.id ? 'Save' : 'Post', primary: true, onclick: async (close) => { await api('pay_save_announcement', { p: { id: n.id, ...x } }); close(); toast('Saved'); route_(); } }] });
}

// ---------- import ----------
SECTIONS.import = async (v) => {
  v.root.append(h('p', { class: 'muted' }, 'Add or update many people at once from an Excel or CSV file. Nothing is saved until the check passes.'),
    h('div', { class: 'list' }, liRow({ icon: 'upload', title: 'Import from a spreadsheet', sub: 'Name, phone, joining date and salary are enough', onclick: () => importSheet() })),
    S.ctx.legacy ? section('Old Payroll', banner('green', 'check', 'Staff, clock-ins, leave, advances and old payslips from the old Payroll app were moved here automatically. Anything added there later is picked up before each payroll is calculated.')) : null);
};

// ---------- change history ----------
const ENTITY = { org: 'Settings', employee: 'Person', job: 'Job', salary: 'Salary', bank: 'Bank account', run: 'Payroll', item: 'Payslip', leave: 'Leave', regularization: 'Attendance correction',
  attendance: 'Attendance', punch: 'Clock-in', loan: 'Loan', claim: 'Claim', batch: 'Payment', structure: 'Structure', component: 'Pay component', leave_type: 'Leave type', shift: 'Shift',
  holiday: 'Holiday', location: 'Location', stat_rule: 'Government rule', document: 'Document', tax: 'Income tax', asset: 'Asset' };
SECTIONS.audit = async (v) => {
  const ent = v.q.get('entity') || '';
  const rows = await api('pay_list_audit', { p: { entity: ent, limit: 300 } });
  v.header({ title: 'Change history', back: 'settings', actions: rows.length ? [{ label: 'Download', icon: 'download', run: (b) => exportMenu(b, 'Payroll-change-history', ['When', 'Who', 'Role', 'Action', 'What', 'Person', 'Reason'], rows.map((r) => [fmtDT(r.at), r.actor || '', r.role || '', r.action, ENTITY[r.entity] || r.entity, r.employee || '', r.reason || ''])) }] : [] });
  v.root.append(h('div', { style: { overflowX: 'auto' } }, chips([['', 'Everything'], ['run', 'Payroll'], ['salary', 'Salary'], ['bank', 'Bank'], ['employee', 'People'], ['attendance', 'Attendance'], ['leave', 'Leave'], ['org', 'Settings']], ent, (x) => go('settings/audit' + (x ? '?entity=' + x : '')), { label: 'Filter' })),
    h('p', { class: 'small muted' }, 'Kept for good: entries cannot be edited or deleted.'),
    rows.length ? h('div', { class: 'list' }, rows.map((r) => liRow({ icon: 'refresh', tone: 'gray', title: cap1(r.action) + ' · ' + (ENTITY[r.entity] || cap1(r.entity)) + (r.employee ? ': ' + r.employee : ''),
      sub: fmtDT(r.at) + ' · ' + (r.actor || 'System') + (r.reason ? ' · ' + r.reason : ''), onclick: (r.before || r.after) ? () => auditSheet(r) : null }))) : empty('refresh', 'No changes yet'));
};
function auditSheet(r) {
  const keys = [...new Set([...Object.keys(r.before || {}), ...Object.keys(r.after || {})])].filter((k) => !/^(tenant_id|updated_at|created_at|id)$/.test(k) && JSON.stringify((r.before || {})[k]) !== JSON.stringify((r.after || {})[k]));
  const show = (x) => x == null ? '—' : typeof x === 'object' ? JSON.stringify(x) : String(x);
  sheet({ title: ENTITY[r.entity] || r.entity, closeLabel: 'Done', wide: true, body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, fmtDT(r.at) + ' · ' + (r.actor || 'System')),
    keys.length ? h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Field'), h('th', null, 'Before'), h('th', null, 'After'))),
      h('tbody', null, keys.map((k) => h('tr', null, h('td', null, cap1(k)), h('td', { class: 'small', style: { wordBreak: 'break-all' } }, show((r.before || {})[k])), h('td', { class: 'small', style: { wordBreak: 'break-all' } }, show((r.after || {})[k])))))))) : h('p', { class: 'muted' }, 'No field-level details.')) });
}

// ---------- health check ----------
SECTIONS.health = async (v) => {
  const d = await api('pay_integrity_check');
  const checks = d.checks || d;
  const bad = checks.filter((c) => !c.ok);
  v.root.append(bad.length ? banner('red', 'alert', h('b', null, bad.length + ' check' + (bad.length === 1 ? '' : 's') + ' failed. '), 'Payroll figures that do not agree. Contact AUZslab support with this screen.') : banner('green', 'check', h('b', null, 'Everything agrees. '), 'Every payslip, payroll total, payment and accounting entry adds up.'),
    h('div', { class: 'list' }, checks.map((c) => liRow({ icon: c.ok ? 'check' : 'alert', tone: c.ok ? 'green' : 'red', title: c.name, sub: c.ok ? null : c.detail }))),
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', type: 'button', onclick: () => v.refresh() }, icon('refresh', 18), 'Check again')));
};
