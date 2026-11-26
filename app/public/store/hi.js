// Hindi for the shop's own interface labels. Exact-text swap: anything not listed stays as the owner wrote it.
// Switched on per shop (Markets, Languages in the dashboard); the visitor chooses with the button in the footer.
// The wording needs a Hindi speaker's review before a shop relies on it.
(function () {
  const HI = {
    'Add to bag': 'बैग में डालें', 'Buy it now': 'अभी खरीदें', 'Buy now': 'अभी खरीदें', 'Bag': 'बैग', 'Place order': 'ऑर्डर करें', 'Shipping': 'शिपिंग', 'Shipping method': 'शिपिंग का तरीका',
    'Total': 'कुल', 'Subtotal': 'उप-योग', 'Free': 'मुफ़्त', 'Order summary': 'ऑर्डर का सार', 'Payment': 'भुगतान', 'Cash on delivery': 'डिलीवरी पर नकद', 'Pay by UPI': 'UPI से भुगतान',
    'Apply': 'लागू करें', 'Remove': 'हटाएँ', 'Qty': 'मात्रा', 'Size': 'साइज़', 'Colour': 'रंग', 'Sort': 'क्रमबद्ध करें', 'Type': 'प्रकार', 'Share': 'शेयर करें', 'Saved': 'सेव किया',
    'Shop': 'दुकान', 'Shop now': 'अभी खरीदें', 'Collections': 'कलेक्शन', 'Contact': 'संपर्क', 'About us': 'हमारे बारे में', 'Our stores': 'हमारी दुकानें', 'Sitemap': 'साइटमैप', 'More': 'और',
    'My orders': 'मेरे ऑर्डर', 'My details': 'मेरी जानकारी', 'Email': 'ईमेल', 'Phone': 'फ़ोन', 'City': 'शहर', 'State': 'राज्य', 'Country': 'देश', 'Address': 'पता', 'Search': 'खोजें',
    'Your bag is empty.': 'आपका बैग खाली है।', 'Your bag is empty': 'आपका बैग खाली है', 'Sold Out': 'स्टॉक खत्म', 'Sold out': 'स्टॉक खत्म', 'Notify me': 'मुझे बताएँ',
    'Products you may like': 'आपको ये भी पसंद आ सकते हैं', 'Discover more': 'और देखें', 'Shop by colour': 'रंग से खरीदें', 'Reviews': 'समीक्षाएँ', 'Return or exchange': 'वापसी या बदलाव',
    'Track my parcel': 'मेरा पार्सल ट्रैक करें', 'Order support': 'ऑर्डर सहायता', 'View items': 'सामान देखें', 'View invoice': 'बिल देखें', 'Details & Description': 'विवरण',
    'Washcare': 'धुलाई की देखभाल', 'Size guide': 'साइज़ गाइड', 'Continue shopping': 'खरीदारी जारी रखें', 'No products found.': 'कोई उत्पाद नहीं मिला।', 'Page not found': 'पेज नहीं मिला',
    'Order not found': 'ऑर्डर नहीं मिला', 'Piece not found': 'उत्पाद नहीं मिला', 'Pieces you add will wait here.': 'आप जो जोड़ेंगे वह यहाँ रहेगा।', 'Thank you for your review.': 'आपकी समीक्षा के लिए धन्यवाद।',
    'Visit us': 'हमसे मिलें', 'We are hiring': 'हम भर्ती कर रहे हैं', 'Stores across India': 'पूरे भारत में दुकानें', 'Popular searches': 'लोकप्रिय खोज', 'Nothing matches': 'कुछ नहीं मिला',
    'Coupon code': 'कूपन कोड', 'Free shipping': 'मुफ़्त शिपिंग', 'Place another order': 'एक और ऑर्डर करें', 'Order placed': 'ऑर्डर हो गया',
  };
  const KEY = 'st.lang'; const get = () => { try { return localStorage.getItem(KEY) || 'en'; } catch { return 'en'; } };
  const orig = new WeakMap(); let busy = false, on = false;
  const walk = (root) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const out = []; while (w.nextNode()) out.push(w.currentNode); return out; };
  const swap = (root) => { if (busy) return; busy = true; try {
    for (const n of walk(root)) { const t = n.nodeValue.trim(); if (!t) continue; const o = orig.get(n); const base = o !== undefined ? o : t;
      if (on && HI[base]) { if (o === undefined) orig.set(n, t); const v = n.nodeValue.replace(t, HI[base]); if (v !== n.nodeValue) n.nodeValue = v; }
      else if (!on && o !== undefined && n.nodeValue.trim() !== o) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), o); }
    root.querySelectorAll && root.querySelectorAll('[placeholder],[aria-label]').forEach((el) => { for (const a of ['placeholder', 'aria-label']) { const v = el.getAttribute(a); if (v && on && HI[v]) { el.setAttribute('data-en-' + a, v); el.setAttribute(a, HI[v]); } else if (!on && el.hasAttribute('data-en-' + a)) el.setAttribute(a, el.getAttribute('data-en-' + a)); } });
  } finally { busy = false; } };
  const button = () => { let b = document.getElementById('st-lang'); if (!b) { b = document.createElement('button'); b.id = 'st-lang'; b.type = 'button'; b.style.cssText = 'position:fixed;left:12px;bottom:76px;z-index:60;padding:6px 12px;border-radius:999px;border:1px solid #ccc;background:#fff;color:#111;font:600 12px system-ui,sans-serif;cursor:pointer'; b.addEventListener('click', () => { try { localStorage.setItem(KEY, on ? 'en' : 'hi'); } catch {} on = !on; document.documentElement.lang = on ? 'hi' : 'en'; b.textContent = on ? 'English' : 'हिंदी'; swap(document.body); }); document.body.append(b); } b.textContent = on ? 'English' : 'हिंदी'; };
  let started = false;
  window.stHindi = { enable() { if (started) return; started = true; on = get() === 'hi'; document.documentElement.lang = on ? 'hi' : 'en'; button(); swap(document.body); new MutationObserver(() => { if (on) swap(document.body); }).observe(document.body, { childList: true, subtree: true }); } };
})();
