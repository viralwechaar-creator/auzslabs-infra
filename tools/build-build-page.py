#!/usr/bin/env python3
"""Writes site/build.html: tick the building blocks you want, get a working account for 3 days (db/262)."""
import importlib.util, os
here = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location('btp', os.path.join(here, 'build-tool-pages.py'))
btp = importlib.util.module_from_spec(spec); spec.loader.exec_module(btp)

BODY = '''    <div class="tl">
      <div class="tl-head"><span class="tl-eye">Build your own</span><h1 class="tl-h">Pick the blocks. Try it for 3 days.</h1>
      <p class="tl-sub">Tick what your business needs. We put them together under your own login, ready to use right now. After 3 days it asks you to subscribe; your data stays safe.</p></div>
      <div class="tl-grid two">
        <section class="tl-card">
          <span class="tl-cap">1 &middot; Your blocks</span>
          <div class="tl-pick" id="blocks"><p class="tl-note">Loading&hellip;</p></div>
          <p class="tl-note">Need something that is not here, like hourly rentals or a special workflow? <a href="contact.html">Tell us</a> and we build it as a custom block.</p>
        </section>
        <div class="side">
          <section class="tl-card" id="signedOut" style="display:none">
            <h2>Sign in to start your trial</h2>
            <p class="tl-note">Your ticks are saved. Use your Google account.</p>
            <div class="tl-actions"><a class="tb pri wide" href="signup.html?next=build.html">Sign in or create account</a></div>
          </section>
          <form class="tl-card" id="trialForm" novalidate style="display:none">
            <span class="tl-cap">2 &middot; Your business</span>
            <label class="tf"><span>Your name</span><input id="tName" autocomplete="name" required></label>
            <label class="tf"><span>Mobile / WhatsApp</span><input id="tPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="9876543210" required></label>
            <label class="tf"><span>Business name</span><input id="tBiz" autocomplete="organization" required></label>
            <div class="tl-actions"><button class="tb pri wide" id="tGo" type="submit">Start my 3-day trial</button></div>
            <div class="tl-err" id="tErr"></div>
            <p class="tl-note">No payment now. We will not charge anything during the trial.</p>
          </form>
          <section class="tl-card" id="hasBiz" style="display:none">
            <h2>You already have a business here</h2>
            <p class="tl-note">Open your apps to carry on.</p>
            <div class="tl-actions"><a class="tb pri" id="openApps" href="https://app.auzslab.in/start.html">Open my apps</a></div>
          </section>
          <section class="tl-card" id="done" style="display:none">
            <span class="tl-cap">Your trial is ready</span>
            <h2 style="font-size:20px">It is live. You have 3 days.</h2>
            <p class="tl-note" style="font-size:12.5px;margin-top:8px">Open your software, add your items and staff, and use it like the real thing.</p>
            <div class="tl-actions"><a class="tb pri" id="openNow" href="https://app.auzslab.in/start.html">Open my software</a></div>
          </section>
        </div>
      </div>
    </div>'''

JS = r'''<script>
const sb = supabase.createClient(CFG.url, CFG.key);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'auz_build';
const getSel = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
const setSel = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} };
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function appsUrl() {
  const s = (await sb.auth.getSession()).data.session;
  return 'https://app.auzslab.in/start.html' + (s && s.access_token ? '#auz_gt=' + b64({ t: s.access_token, u: s.user }) : '');
}
const CHECK = '<span class="bx"><svg viewBox="0 0 12 12"><path d="M2 6.5l2.7 2.7L10 3.5"/></svg></span>';
(async function () {
  const bl = await sb.rpc('public_trial_blocks');
  const list = (bl.data || []);
  const sel = getSel();
  $('blocks').innerHTML = list.map((b) => '<label class="tl-opt"><input type="checkbox" data-k="' + esc(b.key) + '"' + (sel.includes(b.key) ? ' checked' : '') + '>' + CHECK + '<span><b>' + esc(b.label) + '</b><small>' + esc(b.blurb) + '</small></span></label>').join('') || '<p class="tl-note">Blocks are not available right now.</p>';
  $('blocks').addEventListener('change', () => setSel([...document.querySelectorAll('#blocks input:checked')].map((i) => i.dataset.k)));
  const sess = (await sb.auth.getSession()).data.session;
  if (!sess) { $('signedOut').style.display = ''; return; }
  const hm = await sb.rpc('hub_me');
  if (hm.data && hm.data.business) { $('hasBiz').style.display = ''; $('openApps').href = await appsUrl(); $('openApps').onclick = async (e) => { e.preventDefault(); location.href = await appsUrl(); }; return; }
  $('trialForm').style.display = '';
  try { const p = await sb.rpc('my_profile'); if (p.data) { $('tName').value = p.data.name || ''; $('tPhone').value = p.data.phone || ''; $('tBiz').value = p.data.business_name || ''; } } catch (e) {}
  $('trialForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('tErr').textContent = '';
    const blocks = getSel();
    if (!blocks.length) { $('tErr').textContent = 'Tick at least one block.'; return; }
    $('tGo').disabled = true;
    const r = await sb.rpc('start_self_trial', { p: { business_name: $('tBiz').value, contact_name: $('tName').value, phone: $('tPhone').value, blocks } });
    $('tGo').disabled = false;
    if (r.error) { $('tErr').textContent = r.error.message; return; }
    try { localStorage.removeItem(KEY); } catch (x) {}
    $('trialForm').style.display = 'none'; $('done').style.display = '';
    $('openNow').href = await appsUrl(); $('openNow').onclick = async (ev) => { ev.preventDefault(); location.href = await appsUrl(); };
  });
})();
</script>'''

if __name__ == '__main__':
    out = btp.page('Build your own — AUZslab', BODY, btp.SCRIPTS_COMMON + '\n' + JS)
    out = out.replace('<link rel="stylesheet" href="fluid.css?v=3">', '<link rel="stylesheet" href="fluid.css?v=3"><link rel="stylesheet" href="c.css?v=6"><link rel="stylesheet" href="menu-old.css?v=2">')
    open(os.path.join(btp.SITE, 'build.html'), 'w').write(out)
    print('build.html written')
