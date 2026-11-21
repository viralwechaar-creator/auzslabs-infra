'use strict';
const EXP_CAT = [['fuel', 'Fuel'], ['travel', 'Travel'], ['transportation', 'Transportation'], ['food', 'Food'], ['accommodation', 'Accommodation'], ['other', 'Other']];
const EXP_TONE = { pending: 'orange', approved: 'blue', rejected: 'red', reimbursed: 'green' };

page('expenses', {
  title: 'Expenses', icon: 'wallet', field: true,
  async render(v) {
    const incentive = await api('sos_my_incentive');
    v.root.append(h('div', { class: 'card hero' }, h('span', { class: 'k' }, 'Incentive earned this month'),
      h('span', { class: 'n' }, inr(incentive.earned)), h('span', { class: 'muted small' }, incentive.dealsWon + ' deal' + (incentive.dealsWon === 1 ? '' : 's') + ' won × ' + inr(incentive.perDealAmount) + ' per deal')));
    const list = h('div', { class: 'list' }, h('div', { class: 'skel', style: { height: '60px' } }));
    v.root.append(h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h3', null, 'My expenses'), h('button', { class: 'btn fill sm', type: 'button', onclick: () => newExpenseFlow() }, '+ New expense')), list));
    async function paint() {
      const rows = await api('sos_my_expenses');
      clear(list);
      if (!rows.length) { list.append(empty('wallet', 'No expenses filed', 'Submit fuel, travel or other field expenses here.')); return; }
      rows.forEach((x) => {
        const fileInput = h('input', { type: 'file', accept: 'image/*,.pdf', style: { display: 'none' } });
        const attachBtn = h('button', { class: 'btn plain sm', type: 'button', disabled: x.status !== 'pending' }, x.receipt_file ? 'Replace receipt' : 'Add receipt');
        attachBtn.onclick = () => fileInput.click();
        fileInput.onchange = async () => { if (!fileInput.files[0]) return; try { await uploadExpenseReceipt(x.id, fileInput.files[0]); toast('Receipt attached'); paint(); } catch (e) { fail(e); } };
        const viewBtn = x.receipt_file ? h('button', { class: 'btn plain sm', type: 'button', onclick: () => openExpenseReceipt(x.id).catch(fail) }, 'View') : null;
        list.append(liRow({ icon: 'wallet', title: inr(x.amount) + ' · ' + cap1(x.category), sub: (x.purpose || '') + ' · ' + fmtD(x.expense_date), badge: badge(cap1(x.status), EXP_TONE[x.status]), right: h('div', { class: 'row', style: { gap: '4px' } }, viewBtn, attachBtn, fileInput) }));
      });
    }
    paint();
    async function newExpenseFlow() {
      const catSel = selectEl(EXP_CAT, 'fuel');
      const amt = input({ type: 'number', placeholder: '0' });
      const purpose = input({ placeholder: 'Purpose (optional)' });
      const s = sheet({ title: 'New expense', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Category', catSel), field('Amount', amt), field('Purpose', purpose)),
        actions: [{ label: 'Submit', primary: true, onclick: async () => {
          if (!(Number(amt.value) > 0)) { toast('Enter an amount above 0', { err: true }); return false; }
          try { await api('sos_expense_submit', { p: { category: catSel.value, amount: Number(amt.value), purpose: purpose.value.trim() } }); s.close(); toast('Expense submitted'); paint(); } catch (e) { fail(e); return false; }
        } }] });
    }
  },
});

page('tasks', {
  title: 'Tasks', icon: 'checksq', field: true,
  async render(v) {
    const followUpsEl = h('div');
    const list = h('div', { class: 'list' }, h('div', { class: 'skel', style: { height: '60px' } }));
    v.root.append(followUpsEl, h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h3', null, 'My tasks'), h('button', { class: 'btn fill sm', type: 'button', onclick: () => newTaskFlow() }, '+ New task')), list));
    async function paint() {
      const data = await api('sos_my_tasks');
      clear(followUpsEl);
      if (data.leadFollowUps.length) followUpsEl.append(h('div', { class: 'card' }, h('h3', { style: { color: 'var(--red)' } }, 'Follow-ups due'),
        h('div', { class: 'list' }, data.leadFollowUps.map((f) => liRow({ icon: 'target', title: f.businessName, sub: cap1(f.stage) + ' · due ' + fmtD(f.followUpDate), onclick: () => go('leads') })))));
      clear(list);
      if (!data.tasks.length) { list.append(empty('checksq', 'No open tasks', 'Nice and clear.')); return; }
      data.tasks.forEach((t) => {
        const doneBtn = h('button', { class: 'btn plain sm', type: 'button' }, 'Done');
        doneBtn.onclick = async () => { try { await api('sos_task_set', { p_id: t.id, p_status: 'done' }); toast('Marked done'); paint(); } catch (e) { fail(e); } };
        list.append(liRow({ icon: 'checksq', title: t.title, sub: (t.notes || '') + (t.due_date ? ' · due ' + fmtD(t.due_date) : ''), right: doneBtn }));
      });
    }
    paint();
    async function newTaskFlow() {
      const titleInput = input({ placeholder: 'Task title' });
      const due = h('input', { class: 'input', type: 'date' });
      let assigneeSel = null;
      const grid = [field('Title', titleInput), field('Due date (optional)', due)];
      if (canManage()) {
        const team = await api('sos_team_directory');
        assigneeSel = selectEl([['', 'Myself'], ...team.map((p) => [p.id, p.name + ' (' + p.role + ')'])], '');
        grid.push(field('Assign to', assigneeSel));
      }
      const s = sheet({ title: 'New task', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, grid),
        actions: [{ label: 'Create', primary: true, onclick: async () => {
          if (!titleInput.value.trim()) { toast('Enter a task title', { err: true }); return false; }
          try { await api('sos_task_create', { p: { title: titleInput.value.trim(), dueDate: due.value || null, assignedTo: assigneeSel && assigneeSel.value ? assigneeSel.value : null } }); s.close(); toast('Task created'); paint(); } catch (e) { fail(e); return false; }
        } }] });
    }
  },
});
