/* "My data": Backup, Export and Clear all data for the signed-in business owner. One script for every staff app.
   Call auzMyData(sb) from a settings/more screen. The server (my_data_export / my_data_clear) only allows the
   business OWNER, refuses demo businesses for Clear, and never includes passwords, PINs or secrets. No innerHTML. */
(function () {
  function el(tag, props) {
    var n = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    for (var k in props || {}) { if (k === 'style') n.style.cssText = props[k]; else if (k.slice(0, 2) === 'on') n[k] = props[k]; else n.setAttribute(k, props[k]); }
    kids.forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function save(name, text, type) {
    var blob = new Blob([type === 'text/csv' ? '﻿' + text : text], { type: type + ';charset=utf-8' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function cell(v) { if (v == null) return ''; if (typeof v === 'object') v = JSON.stringify(v); v = String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv(d) {
    var out = ['AUZslab export - ' + d.business.name + ' - ' + d.exported_at];
    Object.keys(d.tables).forEach(function (t) {
      var rows = d.tables[t], cols = [];
      rows.forEach(function (r) { Object.keys(r).forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
      out.push('', '## ' + t + ' (' + rows.length + ' rows)', cols.map(cell).join(','));
      rows.forEach(function (r) { out.push(cols.map(function (c) { return cell(r[c]); }).join(',')); });
    });
    return out.join('\r\n');
  }
  window.auzMyData = function (sb) {
    var msg = el('p', { style: 'margin:12px 0 0;min-height:20px;font-size:14px' });
    var box = el('div', { style: 'background:var(--bg,#fff);color:var(--label,#171717);border-radius:20px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35);max-height:90vh;overflow:auto;font:16px/1.4 var(--font,-apple-system,system-ui,sans-serif)' });
    var ov = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'My data', style: 'position:fixed;inset:0;z-index:2147482000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px' }, box);
    function close() { ov.remove(); }
    function say(t, bad) { msg.textContent = t; msg.style.color = bad ? 'var(--red,#c00)' : 'var(--green,#1a7f37)'; }
    function btn(label, fn, danger) {
      return el('button', { type: 'button', style: 'display:block;width:100%;min-height:48px;margin:10px 0 0;border-radius:14px;border:1px solid var(--sep,#ddd);background:' + (danger ? 'var(--red,#c00)' : 'var(--fill,#f2f2f2)') + ';color:' + (danger ? '#fff' : 'inherit') + ';font:600 16px var(--font,system-ui);cursor:pointer', onclick: fn }, label);
    }
    async function fetchAll() {
      say('Preparing... this can take a few seconds for a big business.');
      var r = await sb.rpc('my_data_export');
      if (r.error) { say(r.error.message || 'Could not export. Only the business owner can do this.', true); return null; }
      return r.data;
    }
    var stamp = new Date().toISOString().slice(0, 10);
    async function backup() { var d = await fetchAll(); if (!d) return; save('auzslab-backup-' + d.business.slug + '-' + stamp + '.json', JSON.stringify(d, null, 1), 'application/json'); say('Backup downloaded. Keep the file safe.'); }
    async function exportCsv() { var d = await fetchAll(); if (!d) return; save('auzslab-export-' + d.business.slug + '-' + stamp + '.csv', toCsv(d), 'text/csv'); say('Export downloaded. Open it in Excel or Google Sheets.'); }
    function clearAll() {
      box.textContent = '';
      var slug = el('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Business address name', style: 'width:100%;min-height:48px;margin-top:10px;padding:0 12px;border:1px solid var(--sep,#ddd);border-radius:12px;font:16px var(--font,system-ui);box-sizing:border-box' });
      var done = false, go = btn('Clear all data now', async function () {
        if (!done) { say('Download the backup first (button above).', true); return; }
        var r = await sb.rpc('my_data_clear', { p_confirm: slug.value.trim() });
        if (r.error) { say(r.error.message || 'Could not clear', true); return; }
        say('All data cleared. Reloading...'); setTimeout(function () { location.reload(); }, 1200);
      }, true);
      box.append(el('h2', { style: 'margin:0 0 6px;font:700 20px var(--font,system-ui)' }, 'Clear all data'),
        el('p', { style: 'margin:0' }, 'This permanently deletes your orders, bills, customers, stock, staff attendance, payroll runs and accounting entries in every AUZslab app. Your logins, settings, plan and menu setup stay. It cannot be undone.'),
        btn('1. Download backup first', async function () { await backup(); done = true; }),
        el('p', { style: 'margin:14px 0 0;font-size:14px' }, 'Then type your business address name to confirm:'), slug, go, msg,
        btn('Cancel', close));
    }
    box.append(el('h2', { style: 'margin:0 0 6px;font:700 20px var(--font,system-ui)' }, 'My data'),
      el('p', { style: 'margin:0;font-size:14px;opacity:.75' }, 'Only the business owner can use these. Passwords and secrets are never included.'),
      btn('Backup (full copy, .json)', backup), btn('Export to Excel (.csv)', exportCsv),
      btn('Clear all data...', clearAll, true), msg, btn('Close', close));
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  };
})();
