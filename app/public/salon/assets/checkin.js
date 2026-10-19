(async function () {
  let site;
  try {
    const r = await fetch('/api/site');
    if (!r.ok) throw 0;
    site = await r.json();
  } catch {
    document.body.prepend(h('p', { style: 'padding:24px;text-align:center;background:#fff;color:#391D21' }, 'The site could not load. Please refresh the page.'));
    return;
  }
  const S = site.settings;
  document.title = 'Check in, ' + S.salonName;
  $('#ckTitle').textContent = 'Check in to ' + S.salonName;
  const who = g => g === 'female' ? 'Women' : g === 'male' ? 'Men' : 'Women and men';

  const form = $('#ckForm'), picked = new Set(), idxItems = new Map(site.menu.flatMap(c => c.items.map(i => [i.id, i])));

  $('#ckPickList').replaceChildren(...site.menu.flatMap(c => [
    h('div', { class: 'pick-group' }, c.name, ' ', h('small', { text: who(c.gender) })),
    ...c.items.map(i => h('label', { class: 'pick' },
      h('input', { type: 'checkbox', value: i.id, onchange: e => { e.target.checked ? picked.add(i.id) : picked.delete(i.id); syncPick(); } }),
      i.name, h('span', { class: 'p', text: inr(i.price) + (i.price2 != null ? '+' : '') })))
  ]));
  function syncPick() {
    $('#ckPickSummary').textContent = picked.size ? picked.size + ' selected' : 'Choose services';
    $('#ckPickChips').replaceChildren(...[...picked].map(id => h('span', { class: 'chip', text: idxItems.get(id).name })));
  }

  const err = m => { $('#ckError').textContent = m || ''; };
  form.addEventListener('submit', async e => {
    e.preventDefault(); err('');
    const fd = new FormData(form);
    const body = { name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), note: fd.get('note'), website: fd.get('website'), services: [...picked] };
    if (!body.name || body.name.trim().length < 2) return err('Enter your name.');
    if (String(body.phone || '').replace(/\D/g, '').length < 8) return err('Enter a valid phone number.');
    if (!body.services.length) return err('Choose at least one service.');
    const btn = $('#ckBtn'); btn.disabled = true; btn.textContent = 'Checking in...';
    try {
      const r = await fetch('/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not check in.');
      showDone(d.checkin);
    } catch (ex) { err(ex.message); }
    finally { btn.disabled = false; btn.textContent = 'Check in'; }
  });

  function showDone(c) {
    form.hidden = true;
    const done = $('#ckDone');
    done.hidden = false;
    done.replaceChildren(
      h('h3', { text: "You're checked in!" }),
      h('p', { text: 'Thanks ' + c.name + ' -- our team has your request and will come find you shortly.' }),
      h('dl', {},
        h('div', {}, h('dt', { text: 'Services' }), h('dd', { text: c.services.map(s => s.name).join(', ') })),
        c.note ? h('div', {}, h('dt', { text: 'Note' }), h('dd', { text: c.note })) : null,
      ),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: '/salon/checkin/' }, 'Check in again')));
  }
})();
