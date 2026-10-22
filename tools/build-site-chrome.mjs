// Rebuilds the shared chrome (header, menu sheet, dock, footer) of every public marketing page in site/.
// Idempotent: run it again after changing a link or the footer. Page content (<main>) is not touched.
import fs from 'fs'; import path from 'path';
const dir = path.resolve(process.argv[2] || 'site');
const I = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  ship: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.500 0 18M12 3c-3 3.5-3 14.500 0 18"/>',
  moon: '<path d="M20 14.500A8 8 0 0 1 9.500 4 8 8 0 1 0 20 14.500Z"/>',
  menu: '',
};
const svg = (n, s = 17) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${I[n]}</svg>`;
const NAV = [['index.html', 'Home'], ['products.html', 'Products'], ['live-demo.html', 'Live demo'], ['studio.html', 'Studio'], ['contact.html', 'Contact']];
const BIZ = [['business-cafes.html', 'Caf&eacute;s &amp; restaurants'], ['business-salons.html', 'Salons &amp; studios'], ['business-retail.html', 'Retail &amp; bookstores'], ['business-clothing.html', 'Clothing &amp; apparel'], ['business-mobile-repair.html', 'Mobile retail &amp; repair'], ['studio.html', 'Custom software (Studio)'], ['web-design.html', 'Websites &amp; online stores']];
const RES = [['resources-getting-started.html', 'Getting started'], ['learn.html', 'Learn: beginner manual'], ['resources-operations.html', 'Operations &amp; workflows'], ['resources-growth.html', 'Growth &amp; scaling']];
const TEL = '+919251250829', WA = '919251250829', MAIL = 'helloauzslab@gmail.com';
const IG = 'https://www.instagram.com/auzslab.in', FB = 'https://www.facebook.com/share/1FMd3FoFyZ/?mibextid=wwXIfr';

function header(cur) {
  const a = (h, t) => `<a href="${h}"${h === cur ? ' class="on"' : ''}>${t}</a>`;
  return `<header class="u-top">
    <a href="index.html" class="u-logo" aria-label="AUZslab home"><img src="logo.png" alt="AUZslab"></a>
    <nav class="u-nav" aria-label="Main">${[['products.html', 'Products'], ['live-demo.html', 'Live demo'], ['studio.html', 'Studio'], ['platform.html', 'Why AUZslab'], ['contact.html', 'Contact']].map(([h, t]) => a(h, t)).join('')}</nav>
    <div class="u-r">
      <button type="button" class="u-ic" data-theme-toggle aria-label="Dark mode">${svg('moon', 15)}</button>
      <a href="signup.html" class="u-pill" data-signin-link>Get started</a>
      <button class="u-menu" id="menuToggle" aria-label="Open menu" aria-expanded="false"><i></i><span class="menu-btn-label">Menu</span></button>
    </div>
  </header>`;
}
function sheet(cur) {
  const link = (h, t) => `<a href="${h}" class="nav-link${h === cur ? ' active' : ''}">${t}</a>`;
  const grp = (t, n, items) => `<div class="nav-group"><button class="nav-link nav-group-toggle" aria-expanded="false"><span>${t} <sup class="nav-group-count">(+${n})</sup></span><span class="nav-group-indicator" aria-hidden="true"></span></button><div class="nav-submenu"><div class="nav-submenu-inner">${items.map(([h, x]) => `<a href="${h}" class="nav-sublink"><span>${x}</span></a>`).join('')}</div></div></div>`;
  return `<div class="drawer-overlay" id="drawerOverlay"></div>
  <aside class="u-sheet sidebar" id="sidebarDrawer" aria-label="Menu">
    <div class="u-sheet-top"><a href="index.html"><img src="logo.png" alt="AUZslab"></a><button id="drawerClose" aria-label="Close menu">Close</button></div>
    <nav class="sidebar-nav" aria-label="Primary">
      ${link('index.html', 'Home')}${link('products.html', 'Products')}${grp('Business types', BIZ.length, BIZ)}${link('platform.html', 'Why AUZslab')}${link('live-demo.html', 'Live demo')}${link('download-apps.html', 'Download apps')}${link('cart.html', 'Cart <span class="cart-count"></span>')}${grp('Resources', RES.length, RES)}${link('contact.html', 'Contact')}
    </nav>
    <div class="foot"><div class="row"><a href="signup.html" class="btn btn-ghost" data-signin-link>Get started</a><button class="btn" data-open-contact>Let's talk</button></div><div class="copy">&copy; 2026 AUZslab</div></div>
  </aside>`;
}
function dock(cur) {
  const a = (h, n, l) => `<a href="${h}" aria-label="${l}"${h === cur ? ' class="on"' : ''}>${svg(n)}</a>`;
  return `<nav class="u-dock" aria-label="Quick"><div class="pill">${a('index.html', 'home', 'Home')}${a('products.html', 'box', 'Products')}${a('live-demo.html', 'play', 'Live demo')}${a('signup.html', 'user', 'Sign in')}</div><button class="chat" data-open-contact aria-label="Talk to us">${svg('chat', 18)}</button></nav>`;
}
function footer() {
  const perk = (n, t, d) => `<div class="perk">${svg(n, 17)}<div><b>${t}</b><span>${d}</span></div></div>`;
  const tabs = [['Products', [['products.html#slab-pos', 'AUZsPOS'], ['products.html#slab-payroll', 'AUZsPay'], ['products.html#slab-accounting', 'AUZsLedger'], ['products.html#slab-scan', 'AUZsScan'], ['products.html#slab-mobile', 'AUZsMob'], ['products.html#slab-salon', 'AUZslab Salon'], ['products.html#slab-qr', 'QR ordering']]],
    ['Business types', BIZ.map(([h, t]) => [h, t.replace(/&amp;/g, '&').replace(/&eacute;/g, 'e')])],
    ['Resources', RES.map(([h, t]) => [h, t.replace(/&amp;/g, '&')])],
    ['Company', [['platform.html', 'Why AUZslab'], ['live-demo.html', 'Live demo'], ['download-apps.html', 'Download apps'], ['join-team.html', 'Join our team'], ['sitemap.html', 'Sitemap']]]];
  return `<div class="ftwrap" id="ftwrap">
    <button class="ftt" aria-expanded="false"><span class="ftti">${svg('ship', 15)}${svg('tag', 15)}${svg('chat', 15)}${svg('globe', 15)}</span><span class="ftl">Setup, support and help</span><i class="pl">+</i></button>
    <div class="ftinfo">
      <div class="perks">${perk('tag', 'Set up with you', 'Shaped to your workflow')}${perk('ship', 'Works offline', 'POS and AUZsMob keep selling')}${perk('globe', 'Your data is yours', 'Back up or export any time')}${perk('chat', 'Talk to a person', 'Call or WhatsApp us')}</div>
      <div class="ftstrip"><div class="ftfold" id="ftfold"><p>AUZslab builds connected business software: point of sale, accounting, payroll, scanning and shop apps that you shape to the way you work. One login, one picture of your business, set up for you and looked after.</p><button class="ftmore" id="ftmore">Read more...</button></div>
        <div class="ftabs">${tabs.map((t, i) => `<button class="ftab" data-i="${i}">${t[0]}</button>`).join('')}</div><div class="ftpanel" id="ftpanel" data-tabs='${JSON.stringify(tabs.map((t) => t[1]))}'></div></div>
    </div>
    <footer><div class="cols">
      <div class="col"><span class="lbl">Connect with us</span><a href="tel:${TEL}">Call</a><a href="https://wa.me/${WA}" target="_blank" rel="noopener">Text (WhatsApp)</a><a href="${IG}" target="_blank" rel="noopener">Instagram</a><a href="${FB}" target="_blank" rel="noopener">Facebook</a><a href="mailto:${MAIL}">Email</a></div>
      <div class="col"><span class="lbl">Explore</span><a href="products.html">Products</a><a href="live-demo.html">Live demo</a><a href="download-apps.html">Download apps</a><a href="studio.html">Studio</a><a href="web-design.html">Websites &amp; stores</a><a href="platform.html">Why AUZslab</a></div>
      <div class="col"><span class="lbl">Company</span><a href="contact.html">Contact</a><a href="join-team.html">Join our team</a><a href="signup.html">Sign in</a><a href="terms.html">Terms</a><a href="privacy.html">Privacy</a><a href="refund.html">Refunds</a></div>
      <div class="ftbrand"><div class="big">AUZslab</div></div></div>
      <div class="fin"><span>&copy; 2026 AUZslab. All rights reserved</span><a href="sitemap.html">Sitemap</a></div></footer>
  </div>`;
}
let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const p = path.join(dir, f); let s = fs.readFileSync(p, 'utf8');
  if (!/class="topbar"|class="u-top"/.test(s) || !/footer-dark|class="ftwrap"/.test(s)) continue;
  // head: only our stylesheet
  s = s.replace(/<link rel="stylesheet"[^>]*>\s*/g, '').replace(/<link rel="stylesheet" href="min\.css[^>]*>\s*/g, '');
  s = s.replace(/<script[^>]*src="(?:kept\/)?(?:sketch|fx|fx-art|fx-canvas|fx-stack|fx-phys)\.js[^"]*"[^>]*><\/script>\s*/g, '').replace(/<script[^>]*src="min\.js[^"]*"[^>]*><\/script>\s*/g, '').replace(/<script id="topbar-nav-js">[\s\S]*?<\/script>\s*/, '');
  if (!/href="u\.css/.test(s)) s = s.replace('</head>', '<link rel="stylesheet" href="u.css?v=2"><link rel="stylesheet" href="e.css?v=3">\n<meta name="theme-color" content="#efeeed">\n</head>');
  if (!/src="u\.js/.test(s)) s = s.replace('</body>', '<script src="ed.js?v=1" defer></script><script src="u.js?v=1" defer></script>\n</body>');
  // body chrome
  const cur = f;
  s = s.replace(/<div id="pageTransition"[^>]*><\/div>\s*/, '');
  s = s.replace(/<header class="(?:topbar|u-top)">[\s\S]*?<\/header>/, header(cur));
  s = s.replace(/<div class="drawer-overlay" id="drawerOverlay"><\/div>\s*<aside class="[^"]*" id="sidebarDrawer"[\s\S]*?<\/aside>(?:\s*<div class="drawer-social">[\s\S]*?<\/div>\s*(?=<main|<\/div>\s*<main|\n))?/, sheet(cur));
  s = s.replace(/<footer class="footer-dark">[\s\S]*?<\/footer>/, footer() + '\n' + dock(cur));
  s = s.replace(/<div class="ftwrap" id="ftwrap">[\s\S]*?<\/div>\s*<nav class="u-dock"[\s\S]*?<\/nav>/, (m) => m); // idempotent no-op marker
  fs.writeFileSync(p, s); n++;
}
console.log('rebuilt chrome on', n, 'pages');
