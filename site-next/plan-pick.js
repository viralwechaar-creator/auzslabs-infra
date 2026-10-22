// Live plan tiers + add-ons for the niche pricing pages (salon, cafe).
// Prices come from Admin -> Pricing. Choosing a plan or add-on saves it in
// localStorage 'auz_plan' and adds the product to the cart; the request sends
// it, and the admin quote starts from it (the admin can still change it).
(function () {
  var niche = window.PLAN_NICHE; if (!niche) return;
  var KEY = 'auz_plan';
  var sb; try { sb = supabase.createClient(CFG.url, CFG.key); } catch (e) { return; }
  var inr = function () { return 'Custom quote'; };
  function load() { try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.niche === niche ? s : null; } catch (e) { return null; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function period() { var b = document.querySelector('#salon-plans .sp-toggle button.on'); return b && b.getAttribute('data-period') === 'y' ? 'year' : 'month'; }
  var tiers = [], addons = [];

  function wireTiers() {
    document.querySelectorAll('#salon-plans .sp-grid .sp-card').forEach(function (card, i) {
      var t = tiers[i], cta = card.querySelector('.sp-cta'); if (!t || !cta) return;
      cta.removeAttribute('data-open-contact');
      cta.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var s = load() || { niche: niche, addons: [] };
        s.tier_key = t.tier_key; s.period = period(); save(s);
        try { window.AUZcart.add(t.product_key || 'pos'); } catch (x) {}
        location.href = 'cart.html';
      };
    });
  }
  function paintAddons() {
    var s = load(), chosen = (s && s.addons) || [];
    document.querySelectorAll('#salon-addons .sp-addon[data-addon]').forEach(function (card) {
      var a = addons.filter(function (x) { return x.addon_key === card.getAttribute('data-addon'); })[0];
      if (!a) { card.hidden = true; return; }
      card.hidden = false;
      var pr = card.querySelector('.sp-addon-pr'), sub = card.querySelector('.sp-addon-sub'), nm = card.querySelector('b'), bl = card.querySelector('p');
      if (nm) nm.textContent = a.name; if (bl) bl.textContent = a.blurb;
      var priced = Number(a.monthly_price) > 0;
      if (pr) pr.textContent = 'Custom quote';
      if (sub) sub.textContent = 'Agreed with you';
      var btn = card.querySelector('.sp-addon-add');
      if (!btn) { btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-ghost sp-addon-add'; btn.style.cssText = 'margin-top:10px;padding:9px 14px;font-size:12px'; card.appendChild(btn); }
      var on = chosen.indexOf(a.addon_key) >= 0;
      btn.textContent = on ? 'Added ✓ (tap to remove)' : 'Add to my request';
      btn.onclick = function () {
        var cur = load() || { niche: niche, addons: [] }, i = cur.addons.indexOf(a.addon_key);
        if (i >= 0) cur.addons.splice(i, 1); else cur.addons.push(a.addon_key);
        save(cur);
        if (i < 0 && a.product_key) { try { window.AUZcart.add(a.product_key); } catch (x) {} }
        paintAddons();
      };
    });
    var bar = document.getElementById('planPickBar'), sec = document.getElementById('salon-addons');
    if (!sec) return;
    if (!bar) { bar = document.createElement('p'); bar.id = 'planPickBar'; bar.className = 'sp-note'; bar.style.marginTop = '14px'; sec.appendChild(bar); }
    bar.innerHTML = chosen.length ? chosen.length + ' add-on' + (chosen.length > 1 ? 's' : '') + ' in your request. <a href="cart.html" style="color:var(--accent)">Open my request &rarr;</a>' : '';
  }

  sb.rpc('public_plan_tiers', { p_niche: niche }).then(function (r) {
    tiers = (r && r.data) || [];
    if (tiers.length && typeof window.planApply === 'function') window.planApply(tiers);
    wireTiers();
  }).catch(function () {});
  sb.rpc('public_niche_addons', { p_niche: niche }).then(function (r) { addons = (r && r.data) || []; paintAddons(); }).catch(function () {});
})();
