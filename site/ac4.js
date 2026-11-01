/* Welcome screen for the account dashboard: shown once per browser session, nothing else changes. */
(function () {
  try { if (sessionStorage.getItem('ac4.w') || /#(privacy|cart|notifications)/.test(location.hash)) return; } catch (e) {}
  var w = document.createElement('div'); w.id = 'a4w'; w.style.backgroundImage = 'url(/account-cover.jpg)';
  w.innerHTML = '<img src="/logo.png" alt="AUZslab"><div class="a4c"><p>Continue your journey and check your account.</p><div class="a4b"><button type="button" id="a4back">Back</button><button type="button" class="k" id="a4go">Explore your account</button></div></div>';
  document.body.appendChild(w);
  function close() { try { sessionStorage.setItem('ac4.w', '1'); } catch (e) {} w.classList.add('out'); setTimeout(function () { w.remove(); }, 450); }
  document.getElementById('a4go').onclick = close;
  document.getElementById('a4back').onclick = function () { if (history.length > 1) history.back(); else location.href = 'index.html'; };
})();
