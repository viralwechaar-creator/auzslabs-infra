#!/usr/bin/env python3
"""Art-directed marketing pages. Reads the originals from tools/art-src/, writes site/. Idempotent.
Usage: python3 tools/build-art.py [page ...]"""
import re, os, sys, json
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(R, 'tools', 'art-src'); OUT = os.path.join(R, 'site')
VER = {'a-home': 4, 'a-prod': 4, 'a-demo': 5}
def rd(p): return open(os.path.join(SRC, p + '.html'), encoding='utf-8').read()
def wr(p, t): open(os.path.join(OUT, p + '.html'), 'w', encoding='utf-8').write(t)

def put(page, body, cls, css=None, js=True, keep_main=False):
    h = rd(page)
    a = h.index('<main class="content">') + len('<main class="content">')
    b = h.index('</main>')
    c = h.find('<div class="ftwrap"', a, b)
    tail = h[c:b] if c != -1 else ''
    if body is not None: h = h[:a] + body + tail + h[b:]
    h = re.sub(r'<body( class="([^"]*)")?>', lambda m: '<body class="%s%s">' % ((m.group(2) + ' ') if m.group(2) else '', cls), h, 1)
    if css:
        cp = os.path.join(R, 'tools', 'art-css', css + '.css')
        if os.path.exists(cp):
            open(os.path.join(OUT, css + '.css'), 'w').write(open(cp).read().replace('@P', 'html body.' + cls.split()[-1] + ' main.content'))
    links = '<link rel="stylesheet" href="a.css?v=2">' + ('<link rel="stylesheet" href="%s.css?v=%d">' % (css, VER.get(css, 1)) if css else '')
    h = h.replace('</head>', links + '</head>', 1)
    if js: h = h.replace('</body>', '<script src="a.js?v=1" defer></script></body>', 1)
    wr(page, h)

def home():
    tiles = lambda items: ''.join('<a class="ah-t t%d a-rise" href="%s"><i>%s</i><b>%s</b><span>%s</span><em></em></a>' % (i % 4, u, n, t, s) for i, (n, t, s, u) in enumerate(items))
    run = [('01', 'Custom website', 'Looks like your brand, sells for you', 'products.html#slab-web'), ('02', 'POS, billing & CRM', 'Counter, tables, customers', 'products.html#slab-pos'), ('03', 'Website CRM', 'Every enquiry becomes a customer', 'products.html#slab-crm'), ('04', 'Automation', 'WhatsApp bills and reminders', 'products.html#slab-auto')]
    grow = [('05', 'Payroll', 'Clock-ins to payslips', 'products.html#slab-payroll'), ('06', 'Accounting', 'Books that balance', 'products.html#slab-acct'), ('07', 'Your industry', 'Phones, clothing, salons', 'products.html#slab-ind'), ('08', 'Hardware & more', 'Printers, scanners, custom', 'products.html#slab-hw')]
    tiles2 = lambda items: ''.join('<a class="ah-c c%d a-rise" href="%s"><i>%s.</i><b>%s</b><span>%s</span></a>' % (i % 5, u, n, t, s) for i, (n, t, s, u) in enumerate(items))
    idx = ''.join('<li><a href="%s"><i>%s</i>%s</a></li>' % (u, n, t) for n, t, u in [('1.0', 'Custom website', 'products.html#slab-web'), ('2.0', 'POS, billing, CRM', 'products.html#slab-pos'), ('3.0', 'Automation', 'products.html#slab-auto'), ('4.0', 'Payroll', 'products.html#slab-payroll'), ('5.0', 'Accounting', 'products.html#slab-acct')])
    return '''
<div class="ah">
<section class="ah-hero">
<div class="ah-top"><span>AUZslab&trade;<br>Ecosystem<br>Jodhpur, 2026</span><span>Field<br>Every business</span><span class="ah-dot"></span></div>
<h1 class="ah-h"><span class="aw" style="--i:0"><span data-ed="home.h">One ecosystem.</span></span><span class="aw" style="--i:1"><span>Shaped by you.</span></span><span class="aw dim" style="--i:2"><span>Rigid ends here.</span></span></h1>
<ol class="ah-idx">%s</ol>
<p class="ah-sub" data-ed="home.sub">Rigid software ends here.</p>
</section>
<section class="ah-lite">
<div class="ah-lh"><span class="ah-mono">SERVICES &mdash; PICK TODAY, ADD LATER</span>
<h2 class="ah-lt"><span class="g">Run it. Grow it.</span><span>All in one place.</span></h2>
<p class="ah-lp">Start with one part of your business. Everything else snaps on when you are ready.</p></div>
<div class="ah-grid">%s%s</div>
<a class="ah-more" href="products.html">See every service</a>
</section>
<section class="ah-lite2">
<div class="ah-two">
<div class="ah-l2c"><span class="ah-mono">YOUR BUSINESS</span><h2 class="ah-lt left"><span class="g">Shaped,</span><span>not squeezed.</span></h2>
<p class="ah-lp left" data-ed="home.l2s">Every screen, bill, rule and field bends to how you work. One login, one ledger, and every part is yours to shape.</p>
<button class="ah-btn" data-open-contact>Talk to us</button></div>
<div class="ah-l2r">
<a class="ah-fc a-rise" href="products.html#slab-pos"><i>01.</i><b>Services</b><span>Website, POS &amp; CRM, automation, payroll, accounting</span></a>
<a class="ah-fc a-rise" href="products.html#slab-ind"><i>02.</i><b>Businesses</b><span>Cafes, salons, retail, clothing, mobile shops</span></a>
<a class="ah-fc a-rise" href="live-demo.html"><i>03.</i><b>Live demo</b><span>Real working accounts, open to everyone</span></a>
<a class="ah-fc a-rise" href="studio.html"><i>04.</i><b>Studio</b><span>Custom software built with you</span></a>
</div></div>
<div class="ah-end a-rise"><span>Build yours.</span><button class="ah-btn" data-open-contact>Talk to us</button></div>
</section>
</div>''' % (idx, tiles2(run), tiles2(grow))

def block(page, cls):
    m = re.search(r'<(section|div) class="%s[ "].*?(?=<section|<div class="ftwrap"|</main>)' % cls, rd(page), re.S)
    return m.group(0) if m else ''

PAGES = {}
def reg(n):
    def d(f): PAGES[n] = f; return f
    return d
@reg('index')
def _():
    put('index', home(), 'a-dark a-home', 'a-home')

SEC = '''<section class="by" id="bd">
<div class="by-head"><span class="ay-mono">BUILD YOURS &mdash; FREE FOR 3 DAYS</span>
<h2 class="by-h"><span>Say what you do.</span><span class="dim">We build the app.</span></h2>
<p class="by-sub">Pick your kind of business, tick what it needs, shape how it looks. Start a 3-day trial and your app opens, ready to use. No payment now.</p></div>
<div class="by-cols"><div class="by-steps">
<div class="by-s"><p class="by-n">01 &middot; What kind of business</p><div class="bd-types" id="bdTypes"><p class="bd-hint">Loading...</p></div><p class="bd-hint" id="bdNote"></p><p class="bd-cue" id="bdCue" hidden>Next: tick what your business needs, just below.</p></div>
<div class="by-s" id="bdStep2"><p class="by-n">02 &middot; What it needs <span id="bdTally"></span></p><div class="bd-needs" id="bdNeeds"></div></div>
<div class="by-s"><p class="by-n">03 &middot; How it should feel</p><div id="bdDesign"></div></div>
<div class="by-s"><p class="by-n">04 &middot; Start</p><div class="bd-go" id="bdGo"></div><p class="bd-hint">Need something we do not have? <a href="contact.html">Tell us</a>.</p></div>
</div>
<aside class="by-rig"><div class="bd-phone" id="bdPhone" data-nav="bottom" data-card="soft" data-theme="dark"><div class="bd-bar"><i></i><i></i><i></i><span>YOUR APP</span></div><div class="bd-app"><nav class="bd-nav" id="bdNav"></nav><div class="bd-main"><div class="bd-ph"><b>Your business</b><small id="bdCount">0 features</small></div><div class="bd-cards" id="bdCards"></div></div></div></div></aside></div>
</section>
'''

@reg('platform')
def _():
    h = rd('platform')
    eco = re.search(r'<section class="eco">.*?</section>', h, re.S).group(0)
    bl = re.search(r'<section class="bl">.*?</section>', h, re.S).group(0)
    body = '''
<div class="aw-y">
<section class="ay-duel">
<div class="ay-blob"><i></i><i></i><i></i></div><div class="a-grain"></div>
<div class="ay-head">
<span class="ay-mono">WHY AUZSLAB &mdash; TRY IT YOURSELF</span>
<h1 class="ay-h"><span class="aw" style="--i:0"><span data-ed="why.h">Others make you fit.</span></span><span class="aw" style="--i:1"><span class="ay-us">We fit you.</span></span></h1>
<p class="ay-sub" data-ed="why.sub">Left is every other software. Right is AUZslab. Try to change something on each.</p>
</div>
<div class="ay-stage">
<div class="ay-pane ay-rigid" id="ayRigid"><div class="ay-tag"><b>OTHER SOFTWARE</b><span>Changes allowed: <i id="ayNo">0</i></span></div>
<div class="ay-ui"><div class="ay-ui-top">New sale<small>Template 01</small></div>
<div class="ay-f"><small>Customer</small>Fixed label</div><div class="ay-f"><small>Item</small>One list</div>
<div class="ay-f lock"><small>Field 7</small>Not used</div><div class="ay-f lock"><small>Field 8</small>Cannot remove</div>
<div class="ay-btn">Save</div></div>
<div class="ay-toast" id="ayToast">Tap anything. Try to change it.</div>
<span class="ay-lock">&#128274;</span></div>
<div class="ay-vs">VS</div>
<div class="ay-pane ay-flex" id="ayFlex"><div class="ay-tag"><b>AUZSLAB</b><span>Changes made: <i id="ayYes">0</i></span></div>
<div class="ay-ui"><div class="ay-ui-top"><span contenteditable="true" spellcheck="false">New sale</span><small>Made for you</small></div>
<div class="ay-fl" id="ayFields"></div>
<div class="ay-tools"><button type="button" id="ayAdd">+ Add a field</button><span class="ay-sw" id="aySw"><i data-c="#800020"></i><i data-c="#1f6f5c"></i><i data-c="#2b4cc7"></i><i data-c="#c26a00"></i></span></div>
<div class="ay-btn" contenteditable="true" spellcheck="false">Confirm and share</div></div>
<div class="ay-toast" id="ayHint">Rename it. Move it. Add one. Recolour it.</div></div>
</div>
</section>
%s<div class="ay-ecowrap">%s</div>
%s
</div>''' % (SEC, eco, bl)
    put('platform', body, 'a-dark a-why', 'a-why')
    t = open(os.path.join(OUT, 'platform.html'), encoding='utf-8').read()
    t = t.replace('</body>', '<script src="build-inline.js?v=2" defer></script></body>', 1)
    open(os.path.join(OUT, 'platform.html'), 'w', encoding='utf-8').write(t)

@reg('products')
def _():
    def sk(title, rows, pill):
        r = ''.join('<div class="sk-r"><span>%s</span><i%s style="--w:%d%%"></i></div>' % (a, ' class="hi"' if hi else '', w) for a, w, hi in rows)
        return '<div class="sk"><div class="sk-bar"><i></i><i></i><i></i></div><div class="sk-t">%s</div>%s<div class="sk-tot"><span>%s</span><span class="sk-pill on">Live</span></div></div>' % (title, r, pill)
    S = [
     ('web', 'Custom website & online store', 'A website that looks like your brand and sells for you, designed with you and connected to your business.',
      ['Designed around your brand, not a template', 'Online store with cart, checkout and order tracking', 'QR table-ordering and takeaway pages for restaurants', 'You edit the words and pictures yourself', 'Orders land straight in your POS and CRM'],
      ('addon_website', 'Request a website'), ('web-design.html', 'See the website work'), sk('Your website', [('Home page', 80, 0), ('Online store', 62, 1), ('Order tracking', 45, 0)], 'Orders reach your till')),
     ('pos', 'POS, billing & CRM', 'Sell at the counter and the table, bill with GST, and know every customer, all in one place.',
      ['Counter, tables, kitchen tickets and kitchen display', 'GST invoices, split bills, due and credit tracking', 'Customer profiles, loyalty points, coupons and feedback', 'Stock levels, vendors, purchases and reorder alerts', 'Custom staff roles and permissions'],
      ('pos', 'Request POS, billing & CRM'), ('live-demo.html', 'Try the demo'), sk('Table 4 · open', [('Cappuccino', 40, 0), ('Club sandwich', 70, 0), ('Cold coffee', 52, 1)], 'Bill ready')),
     ('crm', 'Website-integrated CRM', 'Every enquiry, order and booking from your website becomes a customer record you can follow up.',
      ['Website orders and bookings create customer profiles', 'Segments: new, regular, at risk, VIP', 'Follow-ups by WhatsApp in one tap', 'Full visit and spend history per customer', 'One customer list across counter, website and QR'],
      ('pos', 'Request the CRM'), ('contact.html', 'Talk to us'), sk('Customers', [('Website order · new', 55, 0), ('Regular guest', 75, 0), ('Not seen in 60 days', 35, 1)], 'Follow-up sent')),
     ('auto', 'Business automation', 'The routine messages and chasing that eat your day, done automatically.',
      ['Bill links on WhatsApp the moment a sale completes', 'Order ready, booking and payment reminders', 'Birthday, win-back and renewal messages', 'Daily summary of sales and dues to the owner', 'Low-stock and overdue alerts'],
      ('addon_whatsapp', 'Request automation'), ('contact.html', 'Talk to us'), sk('Today', [('Bill sent on WhatsApp', 80, 0), ('Reminder sent', 60, 1), ('Daily summary ready', 50, 0)], 'No one had to remember')),
     ('payroll', 'Payroll & attendance', 'Clock-ins from a phone to payslips, with leave, advances and statutory deductions handled.',
      ['Clock in and out from a phone, with location', 'Leave, loans, advances and expense claims', 'PF, ESI, professional tax and TDS rules kept current', 'Payslips and bank transfer files', 'Staff see their own time and pay'],
      ('payroll', 'Request payroll'), ('live-demo.html', 'Try the demo'), sk('This week · hours', [('Mon', 70, 0), ('Tue', 82, 1), ('Wed', 64, 0)], 'Run payroll')),
     ('acct', 'Accounting & finance', 'Real double-entry books for the business, and a simple money app for owners and partners.',
      ['Sales, purchases, GST, banking and reports that balance', 'Scan a bill, post it, and share the invoice', 'Owner capital, loans, dues and cash in one view', 'Budgets, approvals and a full audit trail', 'Works with your POS and payroll'],
      ('accounting', 'Request accounting'), ('live-demo.html', 'Try the demo'), sk('Ledger', [('Debit', 66, 0), ('Credit', 66, 1), ('Trial balance', 50, 0)], 'Books balance')),
     ('ind', 'Systems for your kind of business', 'Ready-made setups for shops, salons, phone stores and clothing and footwear retailers.',
      ['Mobile shops: IMEI stock, repairs and staff profit', 'Clothing and footwear: sizes, colours, barcode tags, online store', 'Salons: bookings, billing, clients and staff logins', 'Scan to bill: barcode to GST invoice in seconds', 'Each one still shaped to how you work'],
      ('mobile', 'Request a setup'), ('contact.html', 'Tell us your business'), sk('Your business', [('Phones and repairs', 70, 0), ('Sizes and colours', 60, 1), ('Bookings', 45, 0)], 'Set up with you')),
     ('hw', 'Hardware & integrations', 'Printers, scanners and the tools you already use, connected so nothing is typed twice.',
      ['Receipt and label printers, barcode scanners', 'Tag and barcode printing for stock', 'Connect to the software you already run', 'Set up on site or remotely', 'Quoted for your shop'],
      ('addon_hardware', 'Request integration'), ('contact.html', 'Talk to us'), sk('Counter', [('Scanner paired', 60, 0), ('Printer paired', 60, 1), ('Drawer ready', 40, 0)], 'Ready to sell')),
     ('studio', 'Custom software, and more', 'If it does not exist yet, we build it with you. Tell us what you need.',
      ['Designed from a blank page around your workflow', 'Your own private workspace and logins', 'Scoped and quoted before work starts', 'New pieces added whenever you grow', 'Anything not listed here: just ask'],
      ('', 'Tell us what you need'), ('studio.html', 'See Studio'), sk('Your idea', [('Describe it', 70, 0), ('We scope it', 55, 1), ('We build it', 45, 0)], 'Shaped to you')),
    ]
    short = {'web':'Website','pos':'POS','crm':'CRM','auto':'Automation','payroll':'Payroll','acct':'Accounts','ind':'Your industry','hw':'Hardware','studio':'Custom'}
    nodes = ''.join('<button type="button" class="bp-n" data-k="%s" data-c="%s" aria-pressed="false"><i>%02d</i><b>%s</b></button>' % (k, ck, n + 1, short[k]) for n, (k, t, sm, feats, (ck, cl), *_r) in enumerate(S))
    cards = ''
    for n, (k, t, sm, feats, (ck, cl), (lu, ll), art) in enumerate(S):
        li = ''.join('<li>%s</li>' % f for f in feats)
        cards += ('<article class="bc rv" id="slab-%s" data-k="%s" data-c="%s"><div class="bc-top"><i class="bc-n">%02d</i><button type="button" class="bc-add" data-k="%s" aria-pressed="false"><span>Add</span><em>+</em></button></div>'
                  '<h2>%s</h2><p class="bc-s">%s</p><div class="bc-art">%s</div>'
                  '<details class="bc-d"><summary>What you get</summary><ul>%s</ul></details>'
                  '<a class="bc-l" href="%s">%s &rarr;</a></article>') % (k, k, ck, n + 1, k, t, sm, art, li, lu, ll)
    body = ('<div class="bp">'
      '<header class="bp-hero"><div class="bp-dots" aria-hidden="true"></div><span class="bp-mono">SERVICES &mdash; 09</span>'
      '<h1 class="bp-h"><span class="aw" style="--i:0"><span class="bp-g" data-ed="products.h">Pick what you need.</span></span><span class="aw" style="--i:1"><span>We connect the rest.</span></span></h1>'
      '<p class="bp-p" data-ed="products.sub">Tap the parts of your business you want help with. They snap onto one login and one customer list.</p>'
      '<a class="bp-btn" href="#bpCards">Browse services</a></header>'
      '<section class="bp-cards" id="bpCards">%s</section>'
      '<aside class="bp-tray" id="bpTray" hidden><div class="bp-tray-t"><b id="bpTrayN">0 services</b><span>one login, one customer list</span></div><button type="button" class="bp-go" id="bpGo">Request these <i>&rarr;</i></button></aside>'
      '</div>') % cards
    put('products', body, 'a-prod', 'a-prod')
    t = open(os.path.join(OUT, 'products.html'), encoding='utf-8').read()
    t = t.replace('</body>', '<script src="a3.js?v=3" defer></script></body>', 1)
    open(os.path.join(OUT, 'products.html'), 'w', encoding='utf-8').write(t)

def strip(x): return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', x)).strip()

@reg('live-demo')
def _():
    h = rd('live-demo')
    wrap = re.search(r'<section class="dm-wrap.*?</section>', h, re.S).group(0)
    data = re.search(r'<script type="application/json" id="dm-data">.*?</script>', h, re.S).group(0)
    end = re.search(r'<div class="mk-end rv">.*?</div></div>', h[h.index('<main'):], re.S)
    body = '''
<div class="ad">
<header class="ad-hero"><span class="ad-mono">LIVE DEMO &mdash; 8 FULLY BUILT APPS</span><h1 class="ad-h"><span class="aw" style="--i:0"><span>Try it</span></span><span class="aw" style="--i:1"><span>before you buy.</span></span></h1>
<p class="ad-p">Real working accounts, open to everyone. Pick a card, copy the login, click around. Nothing here touches your business.</p></header>
%s%s
<div class="ad-end"><b>Not sure which one?</b><button class="btn" data-open-contact>We will walk you through it</button><a class="btn btn-ghost" href="products.html">See all products</a></div>
</div>''' % (wrap, data)
    put('live-demo', body, 'a-demo', 'a-demo')
    t = open(os.path.join(OUT, 'live-demo.html'), encoding='utf-8').read()
    t = t.replace('</body>', '<script src="a4.js?v=1" defer></script></body>', 1)
    open(os.path.join(OUT, 'live-demo.html'), 'w', encoding='utf-8').write(t)

@reg('studio')
def _():
    h = rd('studio')
    steps = [(strip(i), strip(b), strip(sp)) for i, b, sp in re.findall(r'<div class="st-step[^"]*" data-s="\d"><i>(.*?)</i><b>(.*?)</b><span>(.*?)</span>', h)]
    rest = h[h.index('<section class="st-own">'):h.index('<div class="ftwrap"')]
    cmp_ = re.search(r'<section class="st-cmp">.*?</section>', h, re.S).group(0)
    js = json.dumps(steps).replace('&', '&amp;').replace("'", '&#39;')
    body = '''
<div class="as">
<section class="as-hero"><span class="as-mono">AUZSLAB STUDIO &middot; PREMIUM</span>
<div class="as-frame" data-cyc='%s'>
<div class="as-c as-title"><h1>Studio<b>.</b></h1><small>Software designed the way you love</small></div>
<div class="as-c as-metal"></div>
<div class="as-c as-num"><i class="as-hatch"></i><div class="as-n"><span data-cyc-n>01</span><em>/05</em></div></div>
<div class="as-c as-panel"><div class="as-nav"><button type="button" data-cyc-prev aria-label="Previous">&larr;</button><code>step: <span data-cyc-k>tell us</span></code><button type="button" data-cyc-next aria-label="Next">&rarr;</button></div><div class="as-body"><h2 data-cyc-t></h2><p data-cyc-d></p></div></div>
</div>
<div class="as-cta"><a class="btn" href="contact.html">Describe what you love</a><a class="as-link" href="#own">What you decide &darr;</a></div>
</section>
<div id="own"></div>
%s
%s
</div>''' % (js, cmp_, rest)
    put('studio', body, 'a-studio', 'a-studio')

@reg('contact')
def _():
    h = rd('contact')
    ch = re.search(r'<div class="ct-ch rv">.*?</div>(?=\s*<div class="ct-three)', h, re.S).group(0)
    three = re.search(r'<div class="ct-three rv">.*?</div></div>(?=\s*<div class="ct-form)', h, re.S)
    three = three.group(0) if three else re.search(r'<div class="ct-three rv">.*?</span></div></div>', h, re.S).group(0)
    form = re.search(r'<div class="ct-form mk-sheet rv">.*?</div></div>(?=</section>)', h, re.S).group(0)
    faq = re.search(r'<section class="ct-faq rv">.*?</section>', h, re.S).group(0)
    body = '''
<div class="ac">
<section class="ac-tablet">
<div class="ac-notch"></div>
<aside class="ac-rail"><span class="ac-star">&#10022;</span>%s</aside>
<div class="ac-main"><span class="ac-mono">CONTACT</span><h1 class="ac-h">Tell us how your business works.</h1>%s</div>
<aside class="ac-side">%s</aside>
</section>
%s
</div>''' % (ch, form, three, faq)
    put('contact', body, 'a-dark a-contact', 'a-contact')

@reg('download-apps')
def _():
    h = rd('download-apps')
    seg = re.search(r'<div class="wy-seg dl-seg.*?</div>', h, re.S).group(0)
    panels = h[h.index('<section class="dl-panel"'):h.index('<div class="ftwrap"')]
    body = '''
<div class="adl">
<header class="adl-hero"><span class="adl-mono">APPS</span><h1 class="adl-h">Take AUZslab <em>with you.</em></h1>
<p>Every AUZslab app opens the real, live website inside the app, so you always see the newest version the moment it ships.</p></header>
<div class="dl-plans" role="tablist" aria-label="Choose your plan">
<button data-plan="base"><i>1</i><b>Base</b><em>Works completely offline</em><span>Data stays on one computer in your shop. Other devices join over the shop Wi-Fi. No internet, no account: a licence code opens it. Everything is by hand: bills go out through your own WhatsApp, GST details are typed in.</span></button>
<button data-plan="pro"><i>2</i><b>Pro</b><em>Offline, with sync</em><span>Data is stored on your own devices and works offline. Internet is used only for automation, API features and keeping your devices up to date with each other. You sign in with your AUZslab account.</span></button>
<button data-plan="cloud"><i>3</i><b>Cloud</b><em>Nothing to keep</em><span>Everything lives on AUZslab\'s servers and opens on any device with internet. You sign in with your AUZslab account; staff use a name and PIN.</span></button>
</div>
<p class="dl-hint">1. Choose your plan, then 2. choose your device.</p>
<div class="adl-flow" data-plan="">
<div class="adl-kit"><div class="adl-bar">%s</div></div>
<div class="adl-panels">%s</div>
</div>
</div>''' % (seg, panels)
    put('download-apps', body, 'a-dl', 'a-dl')

exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'art2.py'), encoding='utf-8').read())

if __name__ == '__main__':
    for n in (sys.argv[1:] or list(PAGES)): PAGES[n]()
