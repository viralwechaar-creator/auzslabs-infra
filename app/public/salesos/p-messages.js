'use strict';
page('messages', {
  title: 'Messages', icon: 'chat', any: true,
  async render(v) {
    v.header({ title: 'Messages', actions: canManage() ? [{ label: 'Announcement', icon: 'plus', run: () => announceFlow() }] : [] });
    const annList = h('div', { class: 'list' }, h('div', { class: 'skel', style: { height: '50px' } }));
    v.root.append(h('div', { class: 'card' }, h('h3', null, 'Team announcements'), annList));
    async function paintAnn() {
      const rows = await api('sos_announcements');
      clear(annList);
      if (!rows.length) { annList.append(empty('chat', 'No announcements yet')); return; }
      rows.slice(0, 15).forEach((a) => annList.append(liRow({ icon: 'chat', title: a.senderName, sub: a.body + ' · ' + relTime(a.createdAt) })));
    }
    paintAnn();
    async function announceFlow() {
      const body = await askText('Team announcement', 'Sent to everyone on the team.', 'Write your announcement…', '', { multi: true });
      if (!body) return;
      try { await api('sos_message_send', { p_recipient: null, p_body: body }); toast('Announcement sent'); paintAnn(); } catch (e) { fail(e); }
    }

    const convWrap = h('div');
    v.root.append(convWrap);
    async function paintConversations() {
      const [rows, team] = await Promise.all([api('sos_my_conversations'), api('sos_team_directory')]);
      const list = h('div', { class: 'list' },
        rows.length ? rows.map((c) => h('button', { class: 'convrow li', type: 'button', onclick: () => openThread(c.withId, c.withName) }, avatar(c.withName, 36),
          h('div', { class: 'grow' }, h('div', { class: 't' }, c.withName), h('div', { class: 's' }, c.lastBody || '')), h('span', { class: 'small muted' }, relTime(c.lastAt))))
          : [empty('chat', 'No conversations yet')],
        h('button', { class: 'li', type: 'button', style: { color: 'var(--tint-text)' }, onclick: (ev) => pickTeammate(team, ev.currentTarget) }, icon('plus', 18), '  Message a teammate'));
      clear(convWrap).append(h('div', { class: 'card' }, h('h3', null, 'Direct messages'), list));
    }
    paintConversations();
    function pickTeammate(team, anchor) {
      if (!team.length) { toast('No other teammates yet', { err: true }); return; }
      menu(anchor, team.map((p) => ({ label: p.name + ' (' + p.role + ')', run: () => openThread(p.id, p.name) })));
    }
    function openThread(withId, withName) {
      const bodyEl = h('div', { class: 'threadbody' });
      const inputEl = h('input', { class: 'input', placeholder: 'Message ' + withName });
      async function refresh() {
        const rows = await api('sos_conversation', { p_with: withId });
        clear(bodyEl);
        rows.forEach((m) => bodyEl.append(h('div', { class: 'bubblewrap' + (m.mine ? ' mine' : '') }, h('div', null, h('div', { class: 'bubble ' + (m.mine ? 'mine' : 'theirs') }, m.body), h('div', { class: 'bubbletime' }, fmtT(m.createdAt))))));
        bodyEl.scrollTop = bodyEl.scrollHeight;
      }
      const sendBtn = h('button', { class: 'btn fill', type: 'button' }, 'Send');
      const send = async () => { if (!inputEl.value.trim()) return; try { await api('sos_message_send', { p_recipient: withId, p_body: inputEl.value.trim() }); inputEl.value = ''; await refresh(); paintConversations(); } catch (e) { fail(e); } };
      sendBtn.onclick = send; inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      const s = sheet({ title: withName, closeLabel: 'Close', body: h('div', { class: 'grid' }, bodyEl), actions: null });
      s.body.append(h('div', { class: 'row', style: { marginTop: '10px' } }, inputEl, sendBtn));
      refresh();
    }
  },
});
