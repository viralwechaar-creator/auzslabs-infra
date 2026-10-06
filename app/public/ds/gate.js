/* auzGate(feature, appName, dash, sb): stops a staff app from opening for a business that has not bought it
   (or whose owner switched it off). `dash` is the my_dashboard() reply. Returns true when it blocked the page.
   If the entitlement is unknown (offline, no dashboard) it does not block, so offline-first apps keep working.
   This is the browser half; the apps that keep their data in their own tables (Payroll, Accounting, AUZsMob)
   also refuse on the server. */
(function () {
  const OTHER = [['mobile', 'AUZsMob', '/mob.html'], ['payroll', 'AUZsPay', '/payroll.html'], ['accounting', 'AUZsLedger', '/accounts.html'], ['pos', 'AUZsPOS', '/index.html']];
  window.auzGate = function (feature, appName, dash, sb) {
    const f = dash && dash.features; if (!f) return false;
    const en = dash.enabled_features || {};
    if (f[feature] === true && en[feature] !== false) return false;
    const on = (k) => f[k] === true && en[k] !== false;
    const links = OTHER.filter((o) => o[0] !== feature && on(o[0]));
    if (dash.tenant && dash.tenant.niche === 'salon') links.unshift(['salon', 'AUZslab Salon', '/salon/admin/']);
    const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; };
    const card = el('div', 'max-width:420px;margin:12vh auto 0;padding:24px;border-radius:20px;background:var(--surface,#fff);color:var(--label,#171717);box-shadow:0 1px 3px rgba(0,0,0,.12);font:16px/1.4 system-ui,sans-serif;text-align:center');
    card.append(el('div', 'font-weight:800;font-size:20px;margin-bottom:8px', appName), el('h1', 'font-size:18px;margin:0 0 8px', appName + ' is not part of your plan'),
      el('p', 'margin:0 0 16px;opacity:.7', 'Your business has not been given access to ' + appName + '. Ask AUZslab to add it, or open the app you have.'));
    links.forEach((l) => { const a = el('a', 'display:block;margin:8px 0;padding:12px;border-radius:12px;background:var(--accent,#800020);color:#fff;text-decoration:none;font-weight:600', 'Open ' + l[1]); a.href = l[2]; card.append(a); });
    const out = el('button', 'margin-top:8px;padding:12px;width:100%;border-radius:12px;border:1px solid rgba(0,0,0,.15);background:transparent;color:inherit;font:inherit', 'Sign out');
    out.onclick = async () => { try { await sb.auth.signOut(); } catch (e) { /* ignore */ } try { localStorage.removeItem('u'); } catch (e) { /* ignore */ } location.reload(); };
    card.append(out);
    const host = document.getElementById('app') || document.body;
    host.replaceChildren(card);
    return true;
  };
})();
