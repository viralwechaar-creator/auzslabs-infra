/* Notification centre + settings, shared by AUZsLedger, AUZsScan and AUZsFinance (db/295).
   auzAlerts.render(root): draws into `root`. Reads inbox_list and alerts_settings_get, saves with alerts_settings_save.
   Plain DOM, textContent only, colours from the shared tokens (ds/auz.css). */
(function () {
  'use strict';
  var API = (window.CFG && window.CFG.url) || window.AUZ_API || 'https://api.auzslab.in';
  var TYPES = [
    ['Payments', 'payment', [['pay_in', 'Payment received'], ['pay_in_part', 'Part payment received'], ['pay_out', 'Payment sent'], ['pay_out_part', 'Part payment made'], ['txn_new', 'New bill or expense recorded'], ['txn_edited', 'Payment details changed'], ['txn_deleted', 'Entry cancelled or reversed'], ['fin_entry', 'New AUZsFinance entry']]],
    ['Customers', 'receivable', [['cust_due_soon', 'Payment reminder before the due date'], ['cust_due_today', 'Payment due today'], ['cust_overdue', 'Payment overdue'], ['cust_credit', 'Credit limit reached'], ['cust_cleared', 'Customer cleared all dues'], ['cust_inactive', 'Customer has not bought for a long time'], ['commit_due', 'Follow-up due'], ['commit_missed', 'Promised date missed']]],
    ['Suppliers', 'payable', [['sup_due_soon', 'Supplier payment due soon'], ['sup_due_today', 'Supplier payment due today'], ['sup_overdue', 'Supplier payment overdue'], ['sup_credit', 'Supplier credit limit reached'], ['sup_cleared', 'Supplier fully paid'], ['loan_due', 'Loan due soon'], ['loan_overdue', 'Loan past its date']]],
    ['Cash and spending', 'cash', [['low_cash', 'Low cash balance'], ['low_bank', 'Low bank balance'], ['neg_cf', 'More money out than in'], ['large_in', 'Large payment received'], ['large_out', 'Large payment made'], ['unusual', 'Unusual transaction'], ['budget_warn', 'Budget nearly used'], ['budget_over', 'Budget exceeded'], ['rec_upcoming', 'Repeating entry coming up'], ['rec_missed', 'Repeating entry not recorded']]],
    ['Books and GST', 'recon', [['dup', 'Possible duplicate'], ['recon_due', 'Bank lines not matched'], ['recon_done', 'Reconciliation completed'], ['missing_proof', 'Large payments without a bill'], ['gst_due', 'GST return due'], ['gst_pay_due', 'GST payment due'], ['gst_overdue', 'GST return overdue'], ['tax_summary', 'GST summary ready'], ['tax_closing', 'GST month closing'], ['gst_filed', 'GST period marked filed']]],
    ['Team and security', 'activity', [['party_new', 'New customer or supplier'], ['acct_new', 'New cash or bank account'], ['approval_needed', 'Approval needed'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['staff_added', 'New staff member'], ['perm_changed', 'Staff role changed'], ['new_login', 'New sign-in on your account'], ['password_changed', 'Password changed']]],
    ['Summaries and tips', 'smart', [['daily_summary', 'Daily summary'], ['weekly_summary', 'Weekly summary'], ['monthly_summary', 'Monthly summary'], ['cust_risk', 'Customer who pays late'], ['cash_predict', 'Cash may run short'], ['exp_anom', 'Expense higher than usual'], ['collect_reco', 'Money due this week'], ['pay_reco', 'Payments due tomorrow'], ['trend', 'Expense trend'], ['health', 'Dues growing faster than collections']]]
  ];
  var ALWAYS = { test: 1 };

  function session() { try { return JSON.parse(localStorage.getItem('auz_session') || 'null'); } catch (e) { return null; } }
  function rpc(fn, body) {
    var s = session(); if (!s || !s.access_token) return Promise.reject(new Error('Please sign in again.'));
    return fetch(API + '/rpc/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.error) || 'Something went wrong'); return j && j.data !== undefined ? j.data : j; }); });
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function ago(t) {
    var m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; if (m < 1440) return Math.round(m / 60) + ' h ago'; var d = Math.round(m / 1440); return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function css() {
    if (document.getElementById('auz-alerts-css')) return;
    var s = el('style'); s.id = 'auz-alerts-css';
    s.textContent = '.al{display:grid;gap:14px;max-width:760px;margin:0 auto}@media(min-width:1000px){.al{max-width:1180px;margin:0;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);align-items:start;column-gap:22px}.al>*{grid-column:1}.al>.al-sum,.al>.al-set{grid-column:2}.al>.al-sum{grid-row:1}.al>.al-set{grid-row:2/span 3}.al>.al-tabs,.al>.al-list{grid-column:1}.al-sum{grid-template-columns:repeat(3,1fr)}}.al h3{margin:0;font-size:15px}.al .muted{color:var(--label2,#777);font-size:12px}'
      + '.al-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.al-sum div{background:var(--bg2,#fff);border:1px solid var(--sep,rgba(0,0,0,.1));border-radius:14px;padding:10px 12px}.al-sum b{display:block;font-size:22px;line-height:1.1}.al-sum span{font-size:11px;color:var(--label2,#777)}'
      + '.al-sum .c b{color:var(--red,#c62828)}.al-sum .w b{color:var(--orange,#e08a00)}'
      + '.al-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.al-tabs button,.al-btn{border:1px solid var(--sep,rgba(0,0,0,.14));background:var(--bg2,#fff);color:inherit;border-radius:999px;padding:7px 13px;font:600 12px var(--font,system-ui);cursor:pointer;min-height:34px}'
      + '.al-tabs button.on,.al-btn.fill{background:var(--accent,#111);border-color:var(--accent,#111);color:#fff}.al-tabs .sp{flex:1}'
      + '.al-list{display:grid;gap:8px}.al-n{display:grid;gap:3px;text-align:left;background:var(--bg2,#fff);border:1px solid var(--sep,rgba(0,0,0,.1));border-left:4px solid transparent;border-radius:14px;padding:11px 13px;color:inherit;width:100%}'
      + '.al-n.critical{border-left-color:#c62828}.al-n.warning{border-left-color:#e08a00}.al-n.success{border-left-color:#2e7d32}.al-n.u b:before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent,#111);margin-right:6px}'
      + '.al-n b{font-size:13px}.al-n p{margin:0;font-size:12.5px;color:var(--label2,#666);line-height:1.35}.al-n .row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px}.al-n small{color:var(--label2,#888);font-size:11px}'
      + '.al-n .go{border:1px solid currentColor;border-radius:999px;background:none;color:var(--accent,#111);font:600 11px var(--font,system-ui);padding:5px 12px;cursor:pointer;min-height:30px}'
      + '.al-set{background:var(--bg2,#fff);border:1px solid var(--sep,rgba(0,0,0,.1));border-radius:16px;overflow:hidden}.al-set>summary{list-style:none;cursor:pointer;padding:13px 14px;font-weight:700;font-size:14px;display:flex;justify-content:space-between;min-height:44px;align-items:center}.al-set>summary::-webkit-details-marker{display:none}'
      + '.al-set>summary:after{content:"+";font-weight:400;font-size:18px}.al-set[open]>summary:after{content:"-"}.al-body{display:grid;gap:14px;padding:4px 14px 14px}'
      + '.al-f{display:grid;gap:4px}.al-f label{font-size:12px;font-weight:600}.al-f input,.al-f select{border:1px solid var(--sep,rgba(0,0,0,.18));border-radius:10px;background:var(--bg,#fff);color:inherit;padding:9px 10px;font:14px var(--font,system-ui);min-height:40px;width:100%;box-sizing:border-box}'
      + '.al-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.al-g{border-top:1px solid var(--sep,rgba(0,0,0,.1));padding-top:10px;display:grid;gap:2px}.al-g h4{margin:0 0 4px;font-size:12px;text-transform:none}'
      + '.al-t{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;font-size:13px;min-height:36px}.al-t input{width:20px;height:20px;accent-color:var(--accent,#111)}'
      + '.al-ro{opacity:.6;pointer-events:none}.al-err{color:var(--red,#c62828);font-size:12px}.al-ok{color:#2e7d32;font-size:12px}';
    document.head.appendChild(s);
  }

  function kind(n) { return n.severity === 'critical' ? 'critical' : n.severity === 'warning' ? 'warning' : 'info'; }

  function render(root) {
    css(); root.textContent = '';
    var box = el('div', 'al'); root.appendChild(box);
    box.appendChild(el('div', 'muted', 'Loading...'));
    Promise.all([rpc('inbox_list', { p_limit: 100 }), rpc('alerts_settings_get')]).then(function (r) { draw(box, r[0], r[1]); })
      .catch(function (e) { box.textContent = ''; box.appendChild(el('div', 'al-err', e.message || 'Could not load notifications')); });
  }

  function draw(box, inbox, cfg) {
    box.textContent = '';
    var items = (inbox.items || []).filter(function (n) { return n.severity || n.app; });
    var counts = { critical: 0, warning: 0, info: 0 };
    items.forEach(function (n) { if (!n.read) counts[kind(n)]++; });
    var sum = el('div', 'al-sum');
    [['c', counts.critical, 'Critical'], ['w', counts.warning, 'Warnings'], ['', counts.info, 'Updates']].forEach(function (x) { var d = el('div', x[0]); d.appendChild(el('b', '', String(x[1]))); d.appendChild(el('span', '', x[2] + ' unread')); sum.appendChild(d); });
    box.appendChild(sum);

    var filt = 'all', tabs = el('div', 'al-tabs'), list = el('div', 'al-list');
    function paintList() {
      list.textContent = '';
      var shown = items.filter(function (n) { return filt === 'all' || kind(n) === filt; });
      if (!shown.length) list.appendChild(el('div', 'muted', 'Nothing here yet. Notices about payments, due dates, cash and your books will appear here.'));
      shown.forEach(function (n) {
        var c = el('div', 'al-n ' + (n.severity || 'info') + (n.read ? '' : ' u'));
        c.appendChild(el('b', '', n.title)); if (n.body) c.appendChild(el('p', '', n.body));
        var row = el('div', 'row'); row.appendChild(el('small', '', ago(n.created_at)));
        if (n.action && n.link) { var g = el('button', 'go', n.action); g.type = 'button'; g.onclick = function () { rpc('inbox_mark_read', { p_ids: [n.id] }).catch(function () {}); location.href = n.link; }; row.appendChild(g); }
        c.appendChild(row); list.appendChild(c);
      });
      Array.prototype.forEach.call(tabs.querySelectorAll('button[data-k]'), function (b) { b.className = b.getAttribute('data-k') === filt ? 'on' : ''; });
    }
    [['all', 'All'], ['critical', 'Critical'], ['warning', 'Warnings'], ['info', 'Updates']].forEach(function (k) {
      var b = el('button', '', k[1] + ' ' + items.filter(function (n) { return k[0] === 'all' || kind(n) === k[0]; }).length); b.type = 'button'; b.setAttribute('data-k', k[0]);
      b.onclick = function () { filt = k[0]; paintList(); }; tabs.appendChild(b);
    });
    tabs.appendChild(el('span', 'sp'));
    var mr = el('button', 'al-btn', 'Mark all read'); mr.type = 'button'; mr.onclick = function () { rpc('inbox_mark_read', { p_ids: null }).then(function () { render(box.parentNode); }); };
    tabs.appendChild(mr);
    box.appendChild(tabs); box.appendChild(list); paintList();
    box.appendChild(settings(cfg));
  }

  function settings(cfg) {
    var d = el('details', 'al-set' + (cfg.can_edit ? '' : ''));
    d.appendChild(el('summary', '', 'Notification settings'));
    var body = el('div', 'al-body'); d.appendChild(body);
    if (!cfg.can_edit) body.appendChild(el('div', 'muted', 'Only the owner or a manager can change these.'));
    var off = {}; (cfg.off || []).forEach(function (t) { off[t] = true; });
    var fields = {};
    function num(label, key, hint, min) { var f = el('div', 'al-f'); f.appendChild(el('label', '', label)); var i = el('input'); i.type = 'number'; i.inputMode = 'decimal'; i.min = String(min || 0); i.value = cfg[key] ? String(cfg[key]) : (key.indexOf('low_') === 0 || key.indexOf('large_') === 0 ? '' : String(cfg[key] != null ? cfg[key] : '')); f.appendChild(i); if (hint) f.appendChild(el('span', 'muted', hint)); fields[key] = i; return f; }
    var grid = el('div', 'al-grid');
    grid.appendChild(num('Low cash balance (Rs)', 'low_cash', '0 = off. Alert when cash falls below this.'));
    grid.appendChild(num('Low bank balance (Rs)', 'low_bank', '0 = off. Checked for each bank account.'));
    grid.appendChild(num('Large payment received (Rs)', 'large_in', '0 = off.'));
    grid.appendChild(num('Large payment made (Rs)', 'large_out', '0 = off.'));
    grid.appendChild(num('Repeat overdue notice every (days)', 'overdue_repeat', '1 to 60.', 1));
    grid.appendChild(num('Customer inactive after (days)', 'inactive_days', '7 to 730.', 7));
    grid.appendChild(num('Budget warning at (%)', 'budget_warn', '10 to 100.', 10));
    body.appendChild(grid);

    var rd = el('div', 'al-f'); rd.appendChild(el('label', '', 'Remind before the due date'));
    var rrow = el('div', 'al-tabs'), rsel = {}; (cfg.remind_days || []).forEach(function (x) { rsel[x] = true; });
    [1, 2, 3, 5, 7, 10, 15].forEach(function (x) { var b = el('button', rsel[x] ? 'on' : '', x + (x === 1 ? ' day' : ' days')); b.type = 'button'; b.onclick = function () { rsel[x] = !rsel[x]; b.className = rsel[x] ? 'on' : ''; }; rrow.appendChild(b); });
    rd.appendChild(rrow); body.appendChild(rd);

    var g2 = el('div', 'al-grid');
    var rec = el('div', 'al-f'); rec.appendChild(el('label', '', 'Who gets notices')); var rs = el('select');
    [['owner', 'Owner only'], ['managers', 'Owner and managers'], ['all', 'Everyone with a login']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; if (cfg.recipients === o[0]) op.selected = true; rs.appendChild(op); }); rec.appendChild(rs); g2.appendChild(rec);
    function hourSel(label, key) { var f = el('div', 'al-f'); f.appendChild(el('label', '', label)); var s = el('select'); for (var h = 0; h < 24; h++) { var op = el('option', '', (h % 12 || 12) + (h < 12 ? ' am' : ' pm')); op.value = String(h); if (Number(cfg[key]) === h) op.selected = true; s.appendChild(op); } f.appendChild(s); fields[key] = s; return f; }
    g2.appendChild(hourSel('Daily summary after', 'summary_hour')); g2.appendChild(hourSel('Quiet hours start (no phone buzz)', 'quiet_from')); g2.appendChild(hourSel('Quiet hours end', 'quiet_to'));
    body.appendChild(g2);

    function sw(label, checked, onchange) { var r = el('label', 'al-t'); r.appendChild(el('span', '', label)); var i = el('input'); i.type = 'checkbox'; i.checked = checked; i.onchange = function () { onchange(i.checked); }; r.appendChild(i); return r; }
    var flags = { push: cfg.push !== false, weekly: cfg.weekly !== false, monthly: cfg.monthly !== false };
    var tg = el('div', 'al-g'); tg.appendChild(el('h4', '', 'Delivery'));
    tg.appendChild(sw('Alerts on this phone or computer for critical and warning notices', flags.push, function (v) { flags.push = v; }));
    tg.appendChild(sw('Weekly summary (Monday)', flags.weekly, function (v) { flags.weekly = v; }));
    tg.appendChild(sw('Monthly summary (1st)', flags.monthly, function (v) { flags.monthly = v; }));
    body.appendChild(tg);

    var cats = el('div', 'al-grid');
    TYPES.forEach(function (g) {
      var c = el('div', 'al-g'); c.appendChild(el('h4', '', g[0]));
      g[2].forEach(function (t) { c.appendChild(sw(t[1], !off[t[0]], function (v) { if (v) delete off[t[0]]; else off[t[0]] = true; })); });
      cats.appendChild(c);
    });
    body.appendChild(el('div', 'muted', 'Choose which notices you want:')); body.appendChild(cats);

    var msg = el('div', 'muted'), act = el('div', 'al-tabs');
    var save = el('button', 'al-btn fill', 'Save settings'); save.type = 'button';
    save.onclick = function () {
      var p = { recipients: rs.value, push: flags.push, weekly: flags.weekly, monthly: flags.monthly, off: Object.keys(off), remind_days: Object.keys(rsel).filter(function (k) { return rsel[k]; }).map(Number).sort(function (a, b) { return b - a; }) };
      Object.keys(fields).forEach(function (k) { var v = fields[k].value; p[k] = v === '' ? (k.indexOf('low_') === 0 || k.indexOf('large_') === 0 ? 0 : cfg[k]) : Number(v); });
      msg.className = 'muted'; msg.textContent = 'Saving...';
      rpc('alerts_settings_save', { p: p }).then(function () { msg.className = 'al-ok'; msg.textContent = 'Saved.'; }).catch(function (e) { msg.className = 'al-err'; msg.textContent = e.message; });
    };
    var test = el('button', 'al-btn', 'Send me a test notice'); test.type = 'button';
    test.onclick = function () { rpc('alerts_send_test').then(function () { msg.className = 'al-ok'; msg.textContent = 'Sent. Open the bell to see it.'; }).catch(function (e) { msg.className = 'al-err'; msg.textContent = e.message; }); };
    if (cfg.can_edit) act.appendChild(save); act.appendChild(test); body.appendChild(act); body.appendChild(msg);
    if (!cfg.can_edit) { Array.prototype.forEach.call(body.querySelectorAll('input,select,.al-tabs button'), function (x) { if (x !== test) x.disabled = true; }); test.disabled = false; }
    return d;
  }

  window.auzAlerts = { render: render, TYPES: TYPES, ALWAYS: ALWAYS };
})();
