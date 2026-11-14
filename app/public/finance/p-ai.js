/* AI connector: lets the owner connect an AI app (Claude, ChatGPT, anything that supports MCP connectors) to this
   business and see exactly what it has done -- from inside AUZsFinance, not just the marketing site's Account page.
   Key create/list/revoke and the activity log are owner/manager-only at the database level
   (mcp_create_key/mcp_list_keys/mcp_revoke_key check role='owner'; mcp_audit_list allows owner or manager) --
   this page has no perm of its own, the RPCs themselves refuse a plain staff login. */
'use strict';
const AI_TOOL_LABEL = {
  finance_save_transaction: 'Recorded a transaction',
};
const aiToolLabel = (t) => AI_TOOL_LABEL[t] || (t || '').replace(/^[a-z]+_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
// Plain-text rendering of a tool call's arguments for the activity log detail sheet -- an owner reading
// "what did the AI actually do" should see "Amount: 500, Date: 2026-01-10", never raw JSON with braces and
// quotes. One line per field; a nested line-items array (e.g. ledger_save_document's lines) is summarised
// readably rather than shown as nested code.
const aiLabel = (k) => String(k).replace(/_/g, ' ').replace(/\bid\b/gi, 'ID').replace(/^./, (c) => c.toUpperCase());
function aiValueText(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) {
    if (!v.length) return 'none';
    if (v.every((x) => x == null || typeof x !== 'object')) return v.join(', ');
    return v.length + ' item' + (v.length === 1 ? '' : 's') + ': ' + v.map((item) => aiValueText(item)).join('; ');
  }
  if (typeof v === 'object') {
    const parts = Object.entries(v).filter(([, vv]) => vv != null && vv !== '').map(([kk, vv]) => aiLabel(kk) + ' ' + aiValueText(vv));
    return parts.length ? parts.join(', ') : '—';
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
function aiArgsNode(args) {
  const entries = Object.entries(args || {}).filter(([, v]) => v != null && v !== '');
  if (!entries.length) return h('div', { class: 'small muted' }, 'No details recorded for this action.');
  return h('div', { class: 'card grid', style: { gap: '4px' } }, entries.map(([k, v]) => h('div', { class: 'small' }, h('b', null, aiLabel(k) + ': '), aiValueText(v))));
}


page('ai', {
  title: 'AI connector', icon: 'refresh',
  async render(v) {
    v.header({ title: 'AI connector' });
    const isOwner = S.user.role === 'owner';
    const url = (location.origin.replace(/^https?:\/\/[^.]+\./, 'https://api.') || 'https://api.auzslab.in') + '/mcp';
    let keys = []; if (isOwner) { try { keys = (await api('mcp_list_keys')) || []; } catch (e) { keys = null; } }
    let audit = []; try { audit = (await api('mcp_audit_list', { p_limit: 100 })) || []; } catch (e) { audit = null; }

    v.root.append(
      h('div', { class: 'card grid' },
        h('h3', { class: 'h-2' }, 'Connect an AI app'),
        h('p', { class: 'muted small' }, 'Let Claude, ChatGPT or any AI app that supports MCP connectors read this business’s balances, dues and reports and (if you allow it) record transactions. It uses your own AI subscription; this never costs AUZslab anything, and the AI app never sees your password, only a connector key.'),
        h('div', { class: 'card', style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('code', { style: { fontFamily: 'monospace', fontSize: '13px' } }, url),
          h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Copied'); } catch { toast('Could not copy -- select and copy manually', { err: true }); } } }, 'Copy')),
        h('p', { class: 'muted small' }, 'In your AI app, add a new connector with the URL above, and one of the keys below as the Bearer token / API key.')),
      aiKeysCard(isOwner, keys, v),
      aiAuditCard(audit),
    );
  },
});

function aiKeysCard(isOwner, keys, v) {
  const fmt = (t) => t ? fmtDT(t) : 'never';
  if (!isOwner) return h('div', { class: 'card grid' }, h('h3', { class: 'h-2' }, 'Connector keys'), h('p', { class: 'muted small' }, 'Only the business owner can create or revoke connector keys.'));
  if (keys === null) return h('div', { class: 'card' }, h('p', { class: 'muted small' }, 'Could not load connector keys.'));
  return h('div', { class: 'card grid' },
    h('div', { class: 'row sp' }, h('h3', { class: 'h-2' }, 'Connector keys'), h('button', { class: 'btn sm fill', type: 'button', onclick: () => aiNewKeySheet(() => v.refresh()) }, 'New key')),
    keys.length ? h('div', { class: 'list' }, keys.map((k) => h('div', { class: 'li' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, k.label), h('div', { class: 's' }, (k.scope === 'read' ? 'Read only' : 'Can make changes') + ' · created ' + fmt(k.created_at) + ' · last used ' + fmt(k.last_used_at) + (k.revoked ? ' · revoked' : ''))),
      k.revoked ? badge('Revoked') : h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        if (!(await confirmBox('Revoke "' + k.label + '"?', 'Any AI app using this key stops working immediately.', 'Revoke', true))) return;
        try { await api('mcp_revoke_key', { p_id: k.id }); toast('Revoked'); v.refresh(); } catch (e) { fail(e); }
      } }, 'Revoke'))))
      : empty('bolt', 'No connector keys yet', 'Create one to let an AI app connect.'));
}
function aiNewKeySheet(done) {
  const label = input({ value: '', placeholder: 'e.g. Claude, ChatGPT', label: 'Name this key' });
  let full = false;
  const row = h('label', { class: 'li', style: { cursor: 'pointer' } }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Can make changes'), h('div', { class: 's' }, 'Off: the AI app can only look, never change anything (recommended to start with).')),
    h('input', { type: 'checkbox', role: 'switch', onchange: (e) => { full = e.target.checked; } }));
  const s = sheet({ title: 'New connector key', body: h('div', { class: 'grid' }, field('Name', label), row, h('p', { class: 'muted small' }, 'The key is shown once, right after creation -- copy it immediately, you cannot see it again.')),
    actions: [{ label: 'Create', primary: true, onclick: async (c) => {
      if (!label.value.trim()) { toast('Name is required', { err: true }); return false; }
      let created; try { created = await api('mcp_create_key', { p_label: label.value.trim(), p_scope: full ? 'full' : 'read' }); } catch (e) { fail(e); return false; }
      c(); aiShowNewKey(created.key); done();
    } }] });
  label.focus();
}
function aiShowNewKey(key) {
  const inp = h('input', { class: 'input', readonly: true, value: key, style: { fontFamily: 'monospace', fontSize: '13px' }, onclick: (e) => e.target.select() });
  sheet({ title: 'Copy this key now', body: h('div', { class: 'grid' },
    h('p', { class: 'small' }, 'You will not be able to see it again. Paste it into your AI app’s connector setup as the Bearer token / API key.'),
    inp, h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(key); toast('Copied'); } catch {} } }, 'Copy')),
    closeLabel: 'Done' });
}
function aiAuditCard(audit) {
  if (audit === null) return h('div', { class: 'card' }, h('p', { class: 'muted small' }, 'You do not have access to the activity log.'));
  return h('div', { class: 'card grid' },
    h('h3', { class: 'h-2' }, 'Recent AI activity'),
    h('p', { class: 'muted small' }, 'Every action taken through a connector key -- what it tried, when, and whether it worked.'),
    audit.length ? dataView([
      { key: 'tool', label: 'Action', title: true, render: (a) => h('div', null, h('div', { class: 't' }, aiToolLabel(a.tool)), h('div', { class: 's' }, a.key_label || '')) },
      { key: 'at', label: 'When', sub: true, render: (a) => fmtDT(a.at) },
      { key: 'ok', label: 'Result', badge: true, render: (a) => (a.ok ? badge('OK', 'green') : badge('Failed', 'red')) },
    ], audit, { cards: true, cap: 15, onRow: (a) => aiAuditDetail(a) })
      : empty('bolt', 'Nothing yet', 'Actions an AI app takes through a connector key show up here.'));
}
function aiAuditDetail(a) {
  sheet({ title: aiToolLabel(a.tool), closeLabel: 'Close', body: h('div', { class: 'grid' },
    h('div', { class: 'small muted' }, fmtDT(a.at) + (a.key_label ? ' · ' + a.key_label : '')),
    h('div', { class: 'small muted' }, 'Tool: ' + a.tool),
    a.ok ? h('div', { class: 'small' }, 'Completed successfully.') : h('div', { class: 'banner bad' }, a.error || 'Failed'),
    a.args ? aiArgsNode(a.args) : null) });
}
