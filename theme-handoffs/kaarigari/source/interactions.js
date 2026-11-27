const welcomeKey = 'kaarigari-welcome-seen';
let welcomeSeen = false;
let welcomeReady = false;
try { welcomeSeen = localStorage.getItem(welcomeKey) === '1'; } catch { /* Dismissal still works for this page session. */ }

const welcomePopup = document.querySelector('#welcome-popup');
const cookieNoticeButton = document.querySelector('#cookie-notice-button');
const isOrderPage = () => /^#\/(checkout|orders)(?:\/|$)/.test(location.hash);

function maybeShowWelcome() {
  if (!welcomeReady || welcomeSeen || drawer.open || isOrderPage()) return;
  welcomePopup.hidden = false;
}

if (!welcomeSeen) {
  setTimeout(() => {
    welcomeReady = true;
    maybeShowWelcome();
  }, 5000);
}
drawer.addEventListener('close', maybeShowWelcome);
cookieNoticeButton.addEventListener('click', () => {
  welcomePopup.hidden = false;
  welcomePopup.querySelector('button').focus({ preventScroll: true });
});
welcomePopup.addEventListener('click', (event) => {
  const dismiss = event.target.closest('[data-welcome-dismiss]');
  if (!dismiss) return;
  welcomePopup.hidden = true;
  welcomeSeen = true;
  try { localStorage.setItem(welcomeKey, '1'); } catch { /* Dismissal is already recorded for this page. */ }
  if (dismiss.tagName === 'BUTTON') {
    const target = cookieNoticeButton.getBoundingClientRect();
    (target.top >= 0 && target.bottom <= window.innerHeight ? cookieNoticeButton : main).focus({ preventScroll: true });
  }
});
window.addEventListener('hashchange', () => {
  if (isOrderPage()) welcomePopup.hidden = true;
  else maybeShowWelcome();
});

const siteHeader = document.querySelector('.site-head');
let lastScrollY = Math.max(0, window.scrollY);
window.addEventListener('scroll', () => {
  const currentY = Math.max(0, window.scrollY);
  const atTop = currentY <= siteHeader.offsetHeight;
  const atBottom = document.documentElement.scrollHeight - window.innerHeight - currentY <= 12;
  if (!atTop && !atBottom && Math.abs(currentY - lastScrollY) < 4) return;
  siteHeader.classList.toggle('is-scrolled-away', !atTop && !atBottom && currentY > lastScrollY);
  lastScrollY = currentY;
}, { passive: true });

document.querySelector('#footer-art').src = asset('footer');
document.querySelector('#footer-mark').src = asset('rangoli');
document.documentElement.style.setProperty('--rangoli-image', 'url("' + asset('rangoli') + '")');
document.querySelector('#newsletter-form').addEventListener('submit', (event) => {
  event.preventDefault();
  event.currentTarget.reset();
  event.currentTarget.querySelector('[data-newsletter-status]').textContent = 'Signup preview complete. Your email was not stored.';
});

let pressing;
let displayed;
let ignoreReleaseClick;

function showProductPeek(card) {
  displayed?.classList.remove('is-peeking');
  displayed = card;
  displayed?.classList.add('is-peeking');
}

function cancelPress() {
  clearTimeout(pressing?.timer);
  pressing = null;
}

main.addEventListener('pointerover', (event) => {
  if (event.pointerType !== 'mouse') return;
  const card = event.target.closest('.product-card');
  if (card && !card.contains(event.relatedTarget)) showProductPeek(card);
});
main.addEventListener('pointerout', (event) => {
  if (event.pointerType !== 'mouse') return;
  const card = event.target.closest('.product-card');
  if (card === displayed && !card?.contains(event.relatedTarget)) showProductPeek(null);
});
document.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary) return;
  ignoreReleaseClick = null;
  const card = event.target.closest('.product-card');
  if (card !== displayed) showProductPeek(null);
  if (!card || event.pointerType !== 'touch') return;
  pressing = { card, id: event.pointerId, x: event.clientX, y: event.clientY };
  pressing.timer = setTimeout(() => {
    if (!card.isConnected) return;
    showProductPeek(card);
    ignoreReleaseClick = card;
  }, 2000);
});
document.addEventListener('pointermove', (event) => {
  if (pressing?.id === event.pointerId && Math.hypot(event.clientX - pressing.x, event.clientY - pressing.y) > 10) cancelPress();
});
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, (event) => {
    if (pressing?.id === event.pointerId) cancelPress();
  });
}
main.addEventListener('contextmenu', (event) => {
  if (pressing?.card === event.target.closest('.product-card') || (event.pointerType === 'touch' && event.target.closest('.product-card'))) event.preventDefault();
});
main.addEventListener('click', (event) => {
  if (ignoreReleaseClick && ignoreReleaseClick === event.target.closest('.product-card') && event.detail > 0) {
    event.preventDefault();
    ignoreReleaseClick = null;
  }
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') showProductPeek(null);
});
window.addEventListener('hashchange', () => {
  cancelPress();
  showProductPeek(null);
  ignoreReleaseClick = null;
});
