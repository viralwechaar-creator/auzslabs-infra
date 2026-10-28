/* AUZsFinance: Accounts (where money sits) and Settings (books health). */
'use strict';
page('accounts', { title: 'Accounts', async render(v) {
  v.header({ title: 'Accounts', actions: [can('admin') ? { label: 'Add account', icon: 'plus', primary: true, run: () => accountSheet() } : null] });
  await reloadCtx();
  const tot = S.ctx.accounts.filter((a) => a.active).reduce((x, a) => x + Number(a.balance), 0);
  v.root.append(h('div', { class: 'hero-n' }, h('div', { class: 'k' }, 'Total in all accounts'), h('div', { class: 'n num' }, inr(tot))),
    h('div', { class: 'list' }, S.ctx.accounts.map((a) => liRow({ icon: a.kind === 'cash' ? 'cash' : 'building', tone: 'gray', title: a.name, value: inr(a.balance), onclick: () => accountDetail(a) }))));
  if (can('write') && S.ctx.accounts.length > 1) v.root.append(h('button', { class: 'btn', onclick: () => addTxn({ kind: 'transfer' }) }, icon('swap', 18), 'Move money between accounts'),
    h('button', { class: 'btn', onclick: () => withdrawCash() }, icon('cash', 18), 'Withdraw cash from bank'), h('button', { class: 'btn', onclick: () => go('withdrawals') }, icon('swap', 18), 'Cash withdrawals'));
} });
// Cash withdrawal = a transfer from a bank/UPI/card account into a cash account (nothing is a cost; only the place the money sits changes)
function withdrawCash() {
  const acs = S.ctx.accounts.filter((a) => a.active), cash = acs.find((a) => a.kind === 'cash'), bank = acs.find((a) => a.kind !== 'cash');
  if (!cash || !bank) return toast('You need a bank account and a cash account first', { err: true });
  addTxn({ kind: 'transfer', account_id: bank.id, to_account_id: cash.id, purpose: 'Cash withdrawal' });
}
const isWithdrawal = (r) => { const k = (n) => (S.ctx.accounts.find((a) => a.name === n) || {}).kind; return r.kind === 'transfer' && r.status === 'posted' && k(r.to_account) === 'cash' && !!k(r.account) && k(r.account) !== 'cash'; };
page('withdrawals', { title: 'Cash withdrawals', async render(v) {
  const per = LS.get('per', 'month'); const [f, to] = periodDates(per);
  v.header({ title: 'Cash withdrawals', back: 'tools', actions: [can('write') ? { label: 'Withdraw cash', icon: 'plus', primary: true, run: () => withdrawCash() } : null] });
  v.root.append(seg(PERIODS, per, (x) => { LS.set('per', x); v.refresh(); }, { full: true }));
  const all = await api('fin_txn_list', { p: { kind: 'transfer', from: f, to, limit: 500 } });
  const rows = all.filter(isWithdrawal), tot = rows.reduce((x, r) => x + Number(r.amount), 0);
  v.root.append(h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, 'Cash taken from the bank'), h('div', { class: 'n num' }, inr(tot)), h('div', { class: 'small muted' }, rows.length + (rows.length === 1 ? ' withdrawal' : ' withdrawals'))),
    rows.length ? h('div', { class: 'list' }, rows.map((r) => txnRow(r, () => txnSheet(r.id, rows)))) : empty('cash', 'No withdrawals', 'Use Withdraw cash when you take money out of the bank.'));
} });
async function accountDetail(a) {
  const txns = await api('fin_txn_list', { p: { account_id: a.id, limit: 100 } });
  const body = h('div', { class: 'grid' }, h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, a.name), h('div', { class: 'n num' }, inr(a.balance))),
    h('div', { class: 'list' }, liRow({ title: 'Kind', value: a.kind }), liRow({ title: 'Shown', value: a.active ? 'Yes' : 'Hidden' })),
    h('button', { class: 'btn', onclick: () => { s.close(); reconSheet(a); } }, icon('check', 18), 'Match with statement'),
    can('admin') ? h('button', { class: 'btn', onclick: () => { s.close(); accountSheet(a); } }, 'Rename or hide') : null,
    section('Entries', txns.length ? h('div', { class: 'list' }, txns.map((x) => txnRow(x, () => { s.close(); txnSheet(x.id, txns); }))) : empty('swap', 'Nothing yet')));
  const s = sheet({ title: a.name, closeLabel: 'Done', body });
}
function accountSheet(a) {
  const nm = input({ value: a ? a.name : '', placeholder: 'e.g. HDFC current account' });
  const kind = a ? null : selectEl([['bank', 'Bank account'], ['cash', 'Cash'], ['upi', 'UPI or wallet'], ['card', 'Card']], 'bank');
  const open = a ? null : input({ type: 'number', mode: 'decimal', step: '0.01', placeholder: '0' });
  const od = a ? null : input({ type: 'date', value: todayISO() });
  const act = a ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.active }), h('span', null, 'Show this account')) : null;
  sheet({ title: a ? 'Edit account' : 'Add account', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Name', nm), kind ? field('Kind', kind) : null, open ? field('Money in it today', open, 'Counted as the opening balance.') : null, od ? field('As on', od) : null, act),
    actions: [{ label: 'Save', primary: true, onclick: async (close) => { if (!nm.value.trim()) { toast('Enter a name', { err: true }); return false; }
      await api('fin_save_account', { p: a ? { id: a.id, name: nm.value.trim(), active: act.querySelector('input').checked } : { name: nm.value.trim(), kind: kind.value, opening: N(open.value), opening_date: od.value } });
      close(); await reloadCtx(); route_(); } }] });
}
page('settings', { title: 'Settings', async render(v) {
  v.header({ title: 'Settings' });
  const [ic, bp, me] = await Promise.all([api('fin_integrity_check'), api('fin_profile_get'), api('my_profile').catch(() => ({ profile: null }))]);
  const mp = (me && me.profile) || {};
  const canEdit = !!bp.can_edit;
  // Business details (its own record, kept inside AUZsFinance)
  const B = {
    business_name: input({ value: bp.business_name || '', label: 'Business name', placeholder: 'Name on your bills' }),
    legal_name: input({ value: bp.legal_name || '', label: 'Legal name', placeholder: 'If different (optional)' }),
    business_type: input({ value: bp.business_type || '', label: 'Kind of business', placeholder: 'e.g. Cafe, Shop, Clinic' }),
    gstin: input({ value: bp.gstin || '', label: 'GST number', placeholder: '15 letters and numbers' }),
    pan: input({ value: bp.pan || '', label: 'PAN', placeholder: 'ABCDE1234F' }),
    phone: input({ value: bp.phone || '', label: 'Business phone', mode: 'tel' }),
    email: input({ value: bp.email || '', label: 'Business email', type: 'email' }),
    address: input({ value: bp.address || '', label: 'Address' }),
    city: input({ value: bp.city || '', label: 'City' }),
    state: input({ value: bp.state || '', label: 'State' }),
    pincode: input({ value: bp.pincode || '', label: 'PIN code', mode: 'numeric', max: 6 }),
  };
  if (!canEdit) Object.values(B).forEach((x) => { x.disabled = true; });
  const saveBiz = h('button', { class: 'btn primary', onclick: async () => {
    const p = {}; Object.keys(B).forEach((k) => { p[k] = B[k].value.trim(); });
    try { await api('fin_profile_save', { p }); toast('Business details saved'); S.ctx.tenant = { ...S.ctx.tenant, name: p.business_name }; } catch (e) { fail(e); } } }, 'Save business details');
  // My profile (the person signed in)
  const M = {
    name: input({ value: mp.name || '', label: 'Your name' }),
    phone: input({ value: mp.phone || '', label: 'Your phone', mode: 'tel' }),
    contact_email: input({ value: mp.contact_email || '', label: 'Contact email', type: 'email' }),
  };
  const saveMe = h('button', { class: 'btn primary', onclick: async () => {
    if (!M.name.value.trim()) return toast('Enter your name', { err: true });
    try { await api('save_my_profile', { p: { ...mp, name: M.name.value.trim(), phone: M.phone.value.trim(), contact_email: M.contact_email.value.trim(), products: mp.products || [] } }); toast('Profile saved'); } catch (e) { fail(e); } } }, 'Save my profile');
  // Lock date
  const lockIn = input({ type: 'date', value: bp.lock_date ? String(bp.lock_date).slice(0, 10) : '', label: 'Lock books up to' });
  if (!canEdit) lockIn.disabled = true;
  const saveLock = h('button', { class: 'btn', onclick: async () => {
    if (lockIn.value && !await confirmBox('Lock the books?', 'Nothing on or before ' + fmtD(lockIn.value) + ' can be added or changed afterwards. You can move or clear this date later.', 'Lock')) return;
    try { await api('fin_set_lock_date', { p_date: lockIn.value || null }); S.ctx.lock_date = lockIn.value || null; toast(lockIn.value ? 'Books locked' : 'Lock removed'); } catch (e) { fail(e); } } }, 'Save');
  v.root.append(
    section('My profile', h('div', { class: 'grid' }, h('div', { class: 'small muted' }, 'Signed in as ' + (me.login_email || S.ctx.email || '')), field('Your name', M.name), field('Your phone', M.phone), field('Contact email', M.contact_email), saveMe)),
    section('Business details', h('div', { class: 'grid' }, canEdit ? null : h('div', { class: 'small muted' }, 'Only the owner can change these.'),
      field('Business name', B.business_name), field('Legal name', B.legal_name), field('Kind of business', B.business_type), field('GST number', B.gstin), field('PAN', B.pan),
      field('Business phone', B.phone), field('Business email', B.email), field('Address', B.address), field('City', B.city), field('State', B.state), field('PIN code', B.pincode), canEdit ? saveBiz : null)),
    section('Locked up to', h('div', { class: 'grid' }, h('div', { class: 'small muted' }, 'Entries on or before this date are refused. Leave empty to keep the books open.'), field('Lock books up to', lockIn), canEdit ? saveLock : null)),
    section('Your files', h('div', { class: 'list' }, liRow({ title: 'Kept separately', sub: 'Photos and PDFs you attach live in AUZsFinance\'s own storage, apart from AUZsLedger. Photos are made small automatically. A PDF can be up to 10 KB.' }))),
    section('Books health', h('div', { class: 'list' }, liRow({ icon: ic.ok ? 'check' : 'alert', tone: ic.ok ? 'green' : 'orange', title: ic.ok ? 'Everything adds up' : 'Something needs a look', sub: ic.txns + ' entries · debits ' + inr(ic.debit) + ' = credits ' + inr(ic.credit) }),
      liRow({ title: 'Nothing is ever deleted', sub: 'A wrong entry is cancelled and stays in history, so your books always have a trail.' }))));
} });

async function reconSheet(a) {
  const r = await api('fin_recon_list', { p_account: a.id });
  const stmt = input({ type: 'number', mode: 'decimal', placeholder: 'Balance on the statement' });
  const diff = h('div', { class: 'preview' });
  const paintDiff = () => { const d = N(stmt.value) - Number(r.cleared_balance); diff.textContent = stmt.value === '' ? 'Enter the statement balance to compare.' : Math.abs(d) < 0.01 ? 'Matches. Everything ticked agrees with the statement.' : 'Difference ' + inr(d) + ' - look at what is not ticked.'; };
  stmt.oninput = paintDiff; paintDiff();
  const list = h('div', { class: 'list' }, r.rows.map((x) => { const row = liRow({ title: (x.title || x.kind) + ' · ' + fmtShort(x.date), value: h('span', { class: 'money num ' + (Number(x.amount) > 0 ? 'up' : 'down') }, (Number(x.amount) > 0 ? '+' : '-') + inr(Math.abs(x.amount))), right: h('span', { class: 'chk', 'aria-hidden': 'true' }, x.cleared ? '✓' : '') });
    row.onclick = async () => { if (!can('write')) return; try { await api('fin_recon_set', { p_txn: x.id, p_account: a.id, p_cleared: !x.cleared }); x.cleared = !x.cleared; row.querySelector('.chk').textContent = x.cleared ? '✓' : ''; r.cleared_balance = Number(r.cleared_balance) + (x.cleared ? 1 : -1) * Number(x.amount); paintDiff(); } catch (e) { fail(e); } };
    return row; }));
  sheet({ title: a.name + ' · match', closeLabel: 'Done', body: h('div', { class: 'grid' }, h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, 'Ticked so far'), h('div', { class: 'n num' }, inr(r.cleared_balance))), field('Statement balance', stmt), diff, list) });
}
