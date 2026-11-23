// Bring-your-own-domain, verification half only (db/372) -- the owner proves they control a hostname by
// publishing a TXT record, checked over real public DNS by the server (server/src/routes/sites.js's
// /site/sfx-domain-verify, the exact same node:dns check Codex's own preview used, not a mock). Actually
// SERVING the storefront on that domain -- a Caddy site block and a real TLS certificate for an arbitrary
// external hostname -- is phase 2 (see this file's own header comment in the PR): until then, a verified
// domain is marked as such but the "point your domain here" final step stays an honestly-labeled
// "Coming soon", never implied as already live.
import { $, badge, button, close, dialog, esc, flash, pathFor, rerender, save, state } from './ecosystem.js';
import { api, apiPost, refreshDomains } from './api.js';

const hostnameRe = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const panel = (title, content) => '<section class="panel"><div class="panel-title"><h2>' + title + '</h2></div><div class="panel-body">' + content + '</div></section>';
const recordTable = (rows) => '<div class="table-scroll"><table><tbody>' + rows.map((r) => '<tr><td><strong>' + esc(r.hostname) + '</strong>' + (r.id ? '' : ' <small>(default)</small>') + '</td><td>' + badge(r.status === 'verified' ? 'Ownership verified' : 'Awaiting DNS', r.status === 'verified' ? '' : 'warn') + '</td><td>' + (r.id ? button('Manage', 'domain-record:' + r.id, 'compact') : '') + '</td></tr>').join('') + '</tbody></table></div>';

export function domainPage() {
  const canWrite = !!state.perms?.sfx_manage;
  const rows = state.domains || [];
  const defaultHost = state.tenant?.slug ? state.tenant.slug + '.auzslab.in' : '';
  return '<div class="page-head"><div><a class="trail" href="' + pathFor('website') + '">Online store</a><h1>Domains</h1><p>Connect a domain you already own.</p></div><div class="actions">' + (canWrite ? button('Connect a domain', 'domain-connect') : '') + '</div></div>' +
    panel('Store domains', recordTable([{ hostname: defaultHost, status: 'verified', id: null }, ...rows])) +
    panel('How domain setup works', '<div class="stack"><p>Add the TXT record shown below at your domain’s DNS provider, then press Verify. We check this over public DNS ourselves — we never ask for anything that could let someone else claim a domain they don’t own.</p>' +
      '<p>Once verified, point the domain at your store address (' + esc(defaultHost || 'auzslab.in') + ') and your storefront opens there, with a secure padlock added automatically the first time someone visits. Your store must be switched on.</p></div>');
}

function loadDnsExtra(record) {
  if (record.status !== 'verified' || !state.tenant?.slug) return;
  fetch(CFG.url.replace(/\/$/, '') + '/site/dns-target?slug=' + encodeURIComponent(state.tenant.slug)).then((r) => r.json()).then((t) => {
    const el = $('#dns-extra'); if (!el) return;
    el.textContent = t.ip ? 'Bare domain (no www)? Instead of a CNAME, add an A record for ' + record.hostname + ' pointing to ' + t.ip + '.' : '';
  }).catch(() => {});
}
function openRecord(record) {
  dialog(record.hostname, '<div class="stack"><p>' + badge(record.status === 'verified' ? 'Ownership verified' : 'Awaiting DNS', record.status === 'verified' ? '' : 'warn') + '</p>' +
    (record.status === 'verified' ? '<p>Last step: at your DNS provider add a <strong>CNAME</strong> record. Host: <strong>' + esc(record.hostname) + '</strong> &nbsp; Points to: <strong>' + esc(defaultHost) + '</strong>. (A bare domain like example.com cannot use a CNAME: use a subdomain such as www, or your provider\'s ALIAS/ANAME record.) The first visit can take a minute while the padlock is issued. Your store must be switched on under Online store.</p><div class="actions">' + (record.isPrimary ? button('Stop forwarding my store address here', 'domain-primary:' + record.id + ':off') : button('Make this my main address', 'domain-primary:' + record.id + ':on')) + button('Disconnect domain', 'domain-remove:' + record.id) + '</div><p class="compact-copy" id="dns-extra"></p>' :
      '<p>Add this TXT record at your domain provider to prove you control it:</p><div class="muted-box"><small>TXT host</small><br><strong>_auzslab-verify.' + esc(record.hostname) + '</strong><br><small>TXT value</small><br><strong>' + esc(record.token) + '</strong></div>' +
      '<div class="actions">' + button('Verify TXT record', 'domain-verify:' + record.id) + button('Disconnect domain', 'domain-remove:' + record.id) + '</div>') +
    '<output id="domain-feedback" role="status"></output></div>');
  loadDnsExtra(record);
}

export function domainDispatch(type, target) {
  if (type === 'submit' && target.dataset.form === 'domains') {
    const fields = new FormData(target); const name = String(fields.get('hostname') || '').trim().toLowerCase().replace(/\.$/, '');
    const output = target.querySelector('output');
    if (!hostnameRe.test(name)) { output.textContent = 'Enter a hostname such as example.com.'; return true; }
    const submit = target.querySelector('button[type=submit], button.primary'); if (submit) submit.disabled = true;
    api('sfx_domain_connect', { p_hostname: name }).then((record) => {
      refreshDomains().then(() => { save('Domain added.'); close(); rerender(); openRecord(record); });
    }).catch((e) => { output.textContent = e.message; if (submit) submit.disabled = false; });
    return true;
  }
  if (type !== 'click' || !target.dataset.action?.startsWith('domain-')) return false;
  const [action, id] = target.dataset.action.split(':');
  const record = (state.domains || []).find((item) => item.id === id);
  if (action === 'domain-connect') dialog('Connect a domain', '<form data-form="domains"><label>Domain name<input name="hostname" required maxlength="253" placeholder="example.com" autocomplete="off"></label><div class="actions"><button class="btn primary">Get DNS instructions</button></div><output role="status"></output></form>');
  else if (action === 'domain-record' && record) openRecord(record);
  else if (action === 'domain-primary' && record) {
    const on = target.dataset.action.split(':')[2] === 'on';
    api('sfx_domain_set_primary', { p_id: record.id, p_on: on }).then(async () => { await refreshDomains(); save(on ? 'Your store address now forwards to this domain.' : 'Forwarding turned off.'); rerender(); close(); }).catch((e) => { const o = $('#domain-feedback'); if (o) o.textContent = e.message; });
  } else if (action === 'domain-remove' && record) {
    api('sfx_domain_remove', { p_id: record.id }).then(async () => { await refreshDomains(); close(); save('Domain disconnected.'); rerender(); }).catch((e) => { const o = $('#domain-feedback'); if (o) o.textContent = e.message; });
  } else if (action === 'domain-verify' && record) {
    const output = $('#domain-feedback'); target.disabled = true; output.textContent = 'Checking public DNS…';
    apiPost('/site/sfx-domain-verify', { id: record.id }).then(async (result) => {
      if (!result.verified) { output.textContent = 'The TXT record is not visible yet. Check the value at your provider and try again (DNS changes can take a few minutes).'; return; }
      await refreshDomains(); save('Domain ownership verified.'); rerender();
      openRecord((state.domains || []).find((r) => r.id === id) || record);
    }).catch((e) => { output.textContent = e.message; }).finally(() => { target.disabled = false; });
  } else return false;
  return true;
}
