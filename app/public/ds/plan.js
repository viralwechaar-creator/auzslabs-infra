/* Plan & account for every AUZslab app:
   - auzPlan.open(sb)   a sheet with this business's plan, renewal date, products and links to renew / see plans / create an account
   - a floating reminder when the plan ends within 7 days (or has expired), checked once per page load and dismissible for a day
   - sign-in screens get "See plans" and "Create an account" links to the AUZslab site (new accounts become client requests there)
   <script src="/ds/plan.js?v=1" data-app="pos"></script>  (app = pos | payroll | accounts | mob | backoffice | console | builder) */
(function () {
  var SITE = 'https://auzslab.in';
  var me = document.currentScript, APP = (me && me.getAttribute('data-app')) || 'pos';
  var KEY = { pos: 'pos', payroll: 'payroll', accounts: 'accounting', mob: 'mobile', builder: 'website_builder' };
  var LABEL = { pos: 'POS', payroll: 'Payroll', accounts: 'Accounting', mob: 'AUZsMob', builder: 'Website Builder', backoffice: 'Back Office', console: 'Console' };
  function el(tag, props) {
    var n = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    for (var k in props || {}) { if (k === 'style') n.style.cssText = props[k]; else if (k.slice(0, 2) === 'on') n[k] = props[k]; else n.setAttribute(k, props[k]); }
    kids.forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function when(s) { var d = s.days_left; return d == null ? '' : d < 0 ? 'expired ' + (-d) + ' day' + (d === -1 ? '' : 's') + ' ago' : d === 0 ? 'ends today' : d === 1 ? 'ends tomorrow' : 'ends in ' + d + ' days'; }
  function fmt(d) { try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } }
  var btnCss = 'display:block;width:100%;box-sizing:border-box;text-align:center;text-decoration:none;min-height:48px;line-height:48px;margin:10px 0 0;border-radius:14px;border:1px solid var(--sep,#ddd);background:var(--fill,#f2f2f2);color:inherit;font:600 16px var(--font,system-ui);cursor:pointer';
  var pri = btnCss.replace('background:var(--fill,#f2f2f2);color:inherit', 'background:var(--accent,#800020);color:#fff;border-color:transparent');

  function open(sb) {
    var box = el('div', { style: 'background:var(--bg,#fff);color:var(--label,#171717);border-radius:20px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35);max-height:90vh;overflow:auto;font:16px/1.4 var(--font,-apple-system,system-ui,sans-serif)' }, el('p', null, 'Loading...'));
    var ov = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Plan and account', style: 'position:fixed;inset:0;z-index:2147482000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px' }, box);
    function close() { ov.remove(); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    sb.rpc('my_subscription').then(function (r) {
      box.textContent = '';
      var s = r.data;
      if (r.error || !s) { box.append(el('p', null, (r.error && r.error.message) || 'Could not load your plan.'), el('button', { type: 'button', style: btnCss, onclick: close }, 'Close')); return; }
      var late = s.state !== 'active';
      var tone = s.state === 'expired' ? 'var(--red,#c00)' : s.state === 'due_soon' ? 'var(--orange,#b86e00)' : 'var(--green,#1a7f37)';
      var names = (s.products || []).map(function (k) { return ({ pos: 'POS', payroll: 'Payroll', accounting: 'Accounting', mobile: 'AUZsMob', website_builder: 'Website Builder', salon: 'Salon', self_order: 'QR ordering', crm: 'CRM', billing: 'Billing', inventory: 'Inventory' })[k]; }).filter(Boolean);
      box.append(el('h2', { style: 'margin:0 0 4px;font:700 20px var(--font,system-ui)' }, 'Plan & account'),
        el('p', { style: 'margin:0;opacity:.75;font-size:14px' }, s.name + (s.is_demo ? ' (demo)' : '')),
        el('p', { style: 'margin:14px 0 0;font:700 18px var(--font,system-ui);text-transform:capitalize' }, (s.plan || 'plan') + ' plan'),
        el('p', { style: 'margin:2px 0 0;color:' + tone + ';font-weight:600' }, s.renewal_date ? (s.is_demo ? 'Demo account' : 'Renews ' + fmt(s.renewal_date) + ' - ' + when(s)) : 'No renewal date set yet'),
        names.length ? el('p', { style: 'margin:10px 0 0;font-size:14px' }, 'Included: ' + names.join(', ')) : null,
        el('a', { href: SITE + '/account.html', target: '_blank', rel: 'noopener', style: late ? pri : btnCss }, late ? 'Renew now' : 'Manage plan & billing'),
        el('a', { href: SITE + '/pricing.html?from=' + APP, target: '_blank', rel: 'noopener', style: btnCss }, 'See all plans & add apps'),
        el('a', { href: SITE + '/cart.html?add=' + (KEY[APP] || 'pos') + '&from=' + APP, target: '_blank', rel: 'noopener', style: btnCss }, 'Create a new account'),
        el('button', { type: 'button', style: btnCss, onclick: close }, 'Close'));
    });
  }

  var checked = false;
  function reminder(sb) {
    if (checked) return; checked = true;
    var day = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem('auz.planHide') === day) return; } catch (e) {}
    sb.rpc('my_subscription').then(function (r) {
      var s = r.data; if (!s || s.is_demo || s.state === 'active') return;
      var late = s.state === 'expired';
      var bar = el('div', { role: 'status', style: 'position:fixed;left:50%;transform:translateX(-50%);top:max(8px,env(safe-area-inset-top));z-index:2147481000;max-width:calc(100vw - 24px);display:flex;gap:10px;align-items:center;padding:8px 8px 8px 14px;border-radius:999px;background:' + (late ? 'var(--red,#c00)' : 'var(--label,#171717)') + ';color:#fff;font:600 14px var(--font,system-ui);box-shadow:0 6px 24px rgba(0,0,0,.3)' },
        el('span', null, 'Your plan ' + when(s)),
        el('button', { type: 'button', style: 'border:0;border-radius:999px;padding:6px 12px;background:#fff;color:#171717;font:700 13px var(--font,system-ui);cursor:pointer', onclick: function () { bar.remove(); open(sb); } }, 'Renew'),
        el('button', { type: 'button', 'aria-label': 'Dismiss', style: 'border:0;background:none;color:#fff;font:700 18px var(--font,system-ui);cursor:pointer;padding:0 6px', onclick: function () { bar.remove(); try { localStorage.setItem('auz.planHide', day); } catch (e) {} } }, '×'));
      document.body.appendChild(bar);
    }).catch(function () {});
  }

  // sign-in screens: a quiet footer with the two links, added once to whichever card holds the password field
  function loginLinks() {
    var pw = document.querySelector('input[type=password][autocomplete=current-password]');
    if (!pw || document.getElementById('auz-newacct')) return;
    var card = pw.closest('form') || pw.closest('.card') || pw.parentElement.parentElement;
    if (!card) return;
    var a = 'color:var(--accent,#800020);font-weight:600;text-decoration:none';
    card.appendChild(el('p', { id: 'auz-newacct', style: 'margin:14px 0 0;text-align:center;font-size:14px' },
      'New to AUZslab? ',
      el('a', { href: SITE + '/cart.html?add=' + (KEY[APP] || 'pos') + '&from=' + APP, target: '_blank', rel: 'noopener', style: a }, 'Create an account'),
      '  ·  ',
      el('a', { href: SITE + '/pricing.html?from=' + APP, target: '_blank', rel: 'noopener', style: a }, 'See plans')));
  }

  window.auzPlan = { open: open };
  setInterval(function () {
    loginLinks();
    try { if (typeof sb !== 'undefined' && !checked) sb.auth.getSession().then(function (r) { if (r && r.data && r.data.session) reminder(sb); }); } catch (e) {}
  }, 1500);
})();
