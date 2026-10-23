#!/usr/bin/env python3
"""Writes the makeover page bodies (Products, Why AUZslab, Live demo, Download apps, Contact, Studio)
into site-next/. Header, menu, footer and scripts of each page are kept; only <main> content changes.
Re-run after editing copy here. Usage: python3 tools/build-makeover.py"""
import re, json, html, os, shutil
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site-next')
def rd(n): return open(os.path.join(D, n), encoding='utf-8').read()
def wr(n, t): open(os.path.join(D, n), 'w', encoding='utf-8').write(t)
e = html.escape

def swap_main(page, body, title=None, desc=None, canon=None, active=None):
    h = rd(page)
    h = re.sub(r'<main class="content[^"]*">', '<main class="content">', h, 1)
    a = h.index('<main class="content">') + len('<main class="content">')
    b = h.index('</main>')
    c = h.find('<div class="ftwrap"', a, b)          # footer lives inside <main>: keep it
    keep = h[c:b] if c != -1 else ''
    h = h[:a] + body + keep + h[b:]
    if '/x.css' not in h and 'x.css?' not in h:
        h = h.replace('<link rel="stylesheet" href="e.css?v=5">', '<link rel="stylesheet" href="e.css?v=5"><link rel="stylesheet" href="x.css?v=1">', 1)
    if 'x.js?' not in h:
        h = h.replace('</body>', '<script src="x.js?v=1" defer></script></body>', 1)
    if '<body' in h and 'mk-page' not in h:
        h = re.sub(r'<body( class="([^"]*)")?>', lambda m: '<body class="%smk-page">' % ((m.group(2) + ' ') if m.group(2) else ''), h, 1)
    if title:
        h = re.sub(r'<title>.*?</title>', '<title>%s</title>' % e(title), h, 1, flags=re.S)
        h = re.sub(r'(<meta property="og:title" content=")[^"]*', r'\g<1>' + e(title), h, 1)
    if desc:
        h = re.sub(r'(<meta name="description" content=")[^"]*', r'\g<1>' + e(desc), h, 1)
        h = re.sub(r'(<meta property="og:description" content=")[^"]*', r'\g<1>' + e(desc), h, 1)
    if canon:
        h = re.sub(r'(<link rel="canonical" href=")[^"]*', r'\g<1>' + canon, h, 1)
        h = re.sub(r'(<meta property="og:url" content=")[^"]*', r'\g<1>' + canon, h, 1)
    if active:
        h = re.sub(r'(<nav class="u-nav"[^>]*>)(.*?)(</nav>)', lambda m: m.group(1) + re.sub(r' class="on"', '', m.group(2)).replace('href="%s"' % active, 'href="%s" class="on"' % active) + m.group(3), h, 1, flags=re.S)
    return h

def strip_tags(s): return html.unescape(re.sub(r'<[^>]+>', '', s))

# ------------------------------------------------------------------ PRODUCTS
def sketch(k):
    bars = lambda hs, hi=None: '<div class="sk-bars">' + ''.join('<i%s style="--h:%d%%"></i>' % (' class="hi"' if i == hi else '', v) for i, v in enumerate(hs)) + '</div>'
    rows = lambda items: ''.join('<div class="sk-r"><span>%s</span><i%s style="--w:%d%%"></i></div>' % (a, ' class="hi"' if hi else '', w) for a, w, hi in items)
    top = '<div class="sk-bar"><i></i><i></i><i></i></div>'
    if k == 'pos':
        return '<div class="sk">%s<div class="sk-t">Table 4 &middot; open</div>%s<div class="sk-tot"><span>Bill ready</span><span class="sk-pill on">Send to kitchen</span></div></div>' % (top, rows([('Cappuccino', 40, 0), ('Club sandwich', 70, 0), ('Fries', 30, 0), ('Cold coffee', 52, 1)]))
    if k == 'crm':
        av = lambda n, p, on=0: '<div class="sk-av"><b></b><span>%s</span><span class="sk-pill%s">%s</span></div>' % (n, ' on' if on else '', p)
        return '<div class="sk">%s<div class="sk-t">Customers</div>%s%s%s%s</div>' % (top, av('Regular guest', 'Regular'), av('New this week', 'New'), av('Not seen in 60 days', 'At risk'), av('Best customer', 'VIP', 1))
    if k == 'billing':
        return '<div class="sk">%s<div class="sk-t">Invoice &middot; GST</div>%s<div class="sk-tot"><span>Tax split worked out</span><span class="sk-pill on">Share on WhatsApp</span></div></div>' % (top, rows([('Line item one', 60, 0), ('Line item two', 38, 0), ('CGST + SGST', 24, 1), ('Balance due', 44, 0)]))
    if k == 'inventory':
        return '<div class="sk">%s<div class="sk-t">Stock levels</div>%s<div class="sk-tot"><span>Reorder suggested</span><span class="sk-pill on">Make purchase</span></div></div>' % (top, bars([80, 62, 70, 24, 54, 90, 38], 3))
    if k == 'qr':
        cells = ''.join('<i class="%s"></i>' % ('' if (i * 7 + i // 9 * 3) % 5 in (0, 2, 3) else 'o') for i in range(81))
        return '<div class="sk">%s<div class="sk-t">Table 4 &middot; scan to order</div><div class="sk-qr">%s</div><div class="sk-tot"><span>Straight to the kitchen</span><span class="sk-pill on">Guest order</span></div></div>' % (top, cells)
    if k == 'payroll':
        return '<div class="sk">%s<div class="sk-t">This week &middot; hours</div>%s<div class="sk-tot"><span>Clocked in on a phone</span><span class="sk-pill on">Run payroll</span></div></div>' % (top, bars([60, 72, 66, 80, 54, 30, 0], 3))
    if k == 'salon':
        g = ''.join('<i class="%s"></i>' % ('on' if i in (1, 5, 6, 10) else '') for i in range(12))
        return '<div class="sk">%s<div class="sk-t">Today &middot; booking slots</div><div class="sk-grid">%s</div><div class="sk-tot"><span>Online booking form</span><span class="sk-pill on">Confirmed</span></div></div>' % (top, g)
    if k == 'accounting':
        return '<div class="sk">%s<div class="sk-t">Ledger &middot; debit / credit</div>%s<div class="sk-tot"><span>Trial balance matches</span><span class="sk-pill on">Posted</span></div></div>' % (top, rows([('Sales', 74, 0), ('Purchases', 48, 0), ('GST input', 22, 1), ('Bank', 58, 0)]))
    if k == 'mobile':
        return '<div class="sk">%s<div class="sk-t">Handsets &middot; by IMEI</div>%s<div class="sk-tot"><span>Repair ticket open</span><span class="sk-pill on">In repair</span></div></div>' % (top, rows([('IMEI ending 4821', 66, 0), ('IMEI ending 0937', 50, 0), ('IMEI ending 7712', 36, 1), ('Accessories', 70, 0)]))
    if k == 'scan':
        return '<div class="sk">%s<div class="sk-t">Scan to bill</div><div class="sk-bc"></div>%s<div class="sk-tot"><span>GST invoice</span><span class="sk-pill on">Send on WhatsApp</span></div></div>' % (top, rows([('Scanned item', 44, 0)]))
    return ''

def products():
    src = rd('products.html')
    arts = re.findall(r'<article class="pe" id="(slab-[a-z]+)" data-product="([a-z_]+)">(.*?)</article>', src, re.S)
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'makeover-products.json')
    items = []
    for sid, prod, inner in arts:
        name = strip_tags(re.search(r'<h2>(.*?)</h2>', inner, re.S).group(1))
        summ = strip_tags(re.search(r'<p>(.*?)</p>', inner, re.S).group(1))
        feats = [re.sub(r'\s+', ' ', x).strip() for x in re.findall(r'<li>(.*?)</li>', inner, re.S)]
        items.append((sid, prod, name, summ, feats))
    if items: json.dump(items, open(cache, 'w'), indent=1)
    else: items = json.load(open(cache))
    nav = ''.join('<a href="#%s"><i>%02d</i>%s</a>' % (s, i + 1, e(n)) for i, (s, p, n, su, f) in enumerate(items))
    out = ['<div class="mk pr">',
           '<header class="pr-hero"><span class="mk-eye rv">Products &middot; %d connected systems</span>' % len(items),
           '<h1 class="mk-h1 rv" data-ed="products.h">Built around <em>you.</em></h1>',
           '<p class="mk-lede rv" data-ed="products.sub">Connected systems for every part of your business. Pick what you need today; add the rest when you grow.</p>',
           '<div class="pr-meta rv"><span><b>One</b>login</span><span><b>One</b>ledger</span><span><b>Yours</b>to shape</span></div></header>',
           '<div class="pr-wrap"><nav class="pr-idx" aria-label="Products">%s</nav><div class="pr-list">' % nav]
    for i, (sid, prod, name, summ, feats) in enumerate(items):
        li = ''.join('<li>%s</li>' % f for f in feats)
        out.append('<article class="pc rv" id="%s" data-product="%s"><div class="pc-n">%02d</div><div class="pc-main"><h2>%s</h2><p class="pc-s">%s</p><ul class="pc-f">%s</ul><div class="pc-a"><button class="mk-btn solid" data-cart-btn>Add to cart</button><a class="mk-link" href="live-demo.html">Try the demo</a></div></div><figure class="pc-art">%s<div class="ph r32 mk-ph" data-ed-img="products.%s"></div></figure></article>'
                   % (sid, prod, i + 1, name, summ, li, sketch({'self_order': 'qr', 'salon': 'salon'}.get(prod, prod)), 'qr' if prod == 'self_order' else prod))
    out.append('</div></div><div class="mk-end rv"><b>Not sure what fits?</b><span class="mk-row"><button class="mk-btn solid" data-open-contact>Let\'s talk</button><a class="mk-btn" href="live-demo.html">Live demo</a></span></div></div>')
    h = swap_main('products.html', ''.join(out), canon=None)
    # the old product page ships its own <style>; keep it, our .pc/.pr rules load after and win on specificity
    wr('products.html', h)

# ------------------------------------------------------------------ WHY
def why():
    nodes = [('AUZsPOS', 'Sell at the counter, run the kitchen, take table orders.'),
             ('AUZsPay', 'Clock-ins flow straight into the pay run.'),
             ('AUZsLedger', 'Every sale lands in real double-entry books.'),
             ('AUZsScan', 'Scan a barcode, bill it, update stock.'),
             ('AUZsMob', 'Phones by IMEI, repairs and staff ledgers.'),
             ('AUZsStyle', 'Clothing and shoes: sizes, colours, tags, analytics.')]
    import math
    ns, ls = [], []
    for i, (t, d) in enumerate(nodes):
        a = -math.pi / 2 + i * 2 * math.pi / len(nodes)
        x, y = 50 + 38 * math.cos(a), 50 + 38 * math.sin(a)
        ns.append('<button class="eco-n" style="left:%.1f%%;top:%.1f%%" data-t="%s" data-d="%s">%s</button>' % (x, y, t, e(d), t))
        ls.append('<line x1="50" y1="50" x2="%.1f" y2="%.1f"/>' % (x, y))
    body = '''<div class="mk wy">
<section class="wy-hero"><span class="mk-eye rv">Why AUZslab</span>
<h1 class="mk-h1 rv" data-ed="why.h">Software never fit. <em>We changed that.</em></h1>
<p class="mk-lede rv" data-ed="why.sub">A complete ecosystem for business, shaped to you.</p></section>
<section class="wy-stage rv"><div><div class="wy-seg" role="tablist"><button data-v="r" class="on">A rigid system</button><button data-v="y">Yours</button></div>
<p class="wy-note" data-r="Same screens for everyone. Fields you never use, names you cannot change, a layout you must live with." data-y="Rename fields, add the ones you need, reshape the layout and the look. The software moves, not you.">Same screens for everyone. Fields you never use, names you cannot change, a layout you must live with.</p></div>
<div class="wy-screen" data-m="r"><div class="wy-top"><span data-r="New sale" data-y="New booking">New sale</span><span data-r="Template 01" data-y="Made for you">Template 01</span></div>
<div class="wy-fields">
<div class="wy-f"><small data-r="Customer" data-y="Guest name">Customer</small><span data-r="Fixed label" data-y="Your own word">Fixed label</span></div>
<div class="wy-f"><small data-r="Item" data-y="Service">Item</small><span data-r="One list" data-y="Your menu">One list</span></div>
<div class="wy-f lock"><small>Field 7</small><span>Not used</span></div>
<div class="wy-f lock"><small>Field 8</small><span>Cannot remove</span></div>
<div class="wy-f add"><small>Stylist</small><span>Added by you</span></div>
<div class="wy-f add"><small>Size</small><span>Added by you</span></div>
<div class="wy-f add"><small>WhatsApp</small><span>Bill link</span></div></div>
<div class="wy-btn"><span data-r="Save" data-y="Confirm and share">Save</span></div></div></section>
<section class="eco"><div class="eco-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none">%s</svg><div class="eco-c">One<br>login</div>%s</div>
<div><span class="mk-eye">One connected whole</span><h2 class="mk-h2" style="margin-top:12px">Sell, stock, accounts, people, online.</h2><div class="eco-cap" aria-live="polite"></div></div></section>
<section class="bl"><div class="rv"><i>01</i><div><b>Old systems are rigid</b><span>One template. You adapt to it.</span></div></div>
<div class="rv"><i>02</i><div><b>Ours bends</b><span>Screens, bills, rules, fields: all yours to shape.</span></div></div>
<div class="rv"><i>03</i><div><b>One connected whole</b><span>Sell, stock, accounts, people, online. One login.</span></div></div>
<div class="rv"><i>04</i><div><b>Set up with you</b><span>We start it with you. Your data stays yours.</span></div></div></section>
<div class="mk-end rv"><b>Make it yours.</b><span class="mk-row"><button class="mk-btn solid" data-open-contact>Talk to us</button><a class="mk-btn" href="products.html">See products</a></span></div></div>''' % (''.join(ls), ''.join(ns))
    wr('platform.html', swap_main('platform.html', body))

# ------------------------------------------------------------------ LIVE DEMO
def demo():
    data = {
        'salon': {'tag': 'Salons & spas', 'name': 'AUZslab Salon', 'text': 'Your salon website, online booking, billing and clients. Sign in as the owner, or as a staff member to see the limited view your team gets. Resets every 12 hours.',
                  'rows': [['Website', 'showoffsalon.auzslab.in', 'showoffsalon.auzslab.in'], ['Owner console', 'showoffsalon.auzslab.in/salon/admin/', 'showoffsalon.auzslab.in/salon/admin/'], ['Owner login', 'showoffsalon-demo@auzslab.in', 'showoffsalon-demo@auzslab.in'], ['Password', 'Auzslab@Demo', 'Auzslab@Demo'], ['Staff sign in', 'priya.showoffsalon · PIN 1234', 'priya.showoffsalon']],
                  'links': [['Open the console', 'https://showoffsalon.auzslab.in/salon/admin/'], ['Salon website', 'https://showoffsalon.auzslab.in/']]},
        'pos': {'tag': 'One account, everything', 'name': 'POS, Payroll & Accounting', 'text': 'Tables, kitchen tickets, billing, CRM, inventory, QR self-order, staff payroll and full accounting, all live on one login.',
                'rows': [['Address', 'demo.auzslab.in', 'demo.auzslab.in'], ['Email', 'demo@auzslab.in', 'demo@auzslab.in'], ['Password', 'Auzslab@Demo', 'Auzslab@Demo']],
                'links': [['Launch the demo', 'https://demo.auzslab.in/'], ['Open Payroll', 'https://demo.auzslab.in/payroll.html'], ['Open Accounting', 'https://demo.auzslab.in/accounts.html']]},
        'style': {'tag': 'Clothing & footwear', 'name': 'AUZsStyle', 'text': 'Point of sale for clothing and shoe shops: colours and sizes, tag printing, scan to bill, returns and exchanges, and analytics on which style, size and colour sells first.',
                  'rows': [['Address', 'demo.auzslab.in/style.html', 'demo.auzslab.in/style.html'], ['Email', 'demo@auzslab.in', 'demo@auzslab.in'], ['Password', 'Auzslab@Demo', 'Auzslab@Demo']],
                  'links': [['Launch AUZsStyle', 'https://demo.auzslab.in/style.html']]},
        'finance': {'tag': 'Money and control', 'name': 'AUZsFinance', 'text': 'Money in and out, cash and bank, owner capital and loans, who owes you, repeating entries, bank statement matching, GST notes and a view of where the money is going.',
                    'rows': [['Address', 'demo.auzslab.in/finance.html', 'demo.auzslab.in/finance.html'], ['Email', 'demo@auzslab.in', 'demo@auzslab.in'], ['Password', 'Auzslab@Demo', 'Auzslab@Demo']],
                    'links': [['Launch AUZsFinance', 'https://demo.auzslab.in/finance.html']]},
    }
    for v in data.values(): v['note'] = 'For evaluation only: please do not scrape or copy the software. Nothing here touches your own business.'
    btn = lambda i, t, n: '<button type="button" data-id="%s"><small>%s</small><b>%s</b></button>' % (i, t, n)
    body = '''<div class="mk dm">
<header style="padding-top:22px"><span class="mk-eye rv">Live demo</span><h1 class="mk-h1 rv">Try AUZslab <em>before you buy.</em></h1>
<p class="mk-lede rv">A real, working account, open to everyone. Pick one, copy the login, click around. Nothing here touches your own business.</p></header>
<section class="dm-wrap rv"><div class="dm-list">%s</div><div class="dm-card mk-sheet" aria-live="polite"></div></section>
<script type="application/json" id="dm-data">%s</script>
<div class="mk-end rv"><b>Not sure which one?</b><span class="mk-row"><button class="mk-btn solid" data-open-contact>We will walk you through it</button><a class="mk-btn" href="products.html">See all products</a></span></div></div>''' % (
        ''.join(btn(k, v['tag'], v['name']) for k, v in data.items()), json.dumps(data).replace('</', '<\\/'))
    # live-demo.html was left on the old design: rebuild it from a current page's chrome
    h = rd('platform.html')
    h = swap_main('platform.html', body, title='Live demo — try AUZslab before you buy', desc='A real, working AUZslab account open to everyone. Sign in, click around and see how sales, stock, accounts and people connect.', canon='https://auzslab.in/live-demo.html', active='live-demo.html')
    wr('live-demo.html', h)

# ------------------------------------------------------------------ DOWNLOAD
def download():
    src = rd('download-apps.html')
    apps = [(n, strip_tags(d).strip(), u) for n, d, u in re.findall(r'<h3>(AUZs[A-Za-z]+)</h3>\s*</div>\s*</div>\s*<p>(.*?)</p>\s*<a [^>]*href="(https://github[^"]+\.apk)"', src, re.S)]
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'makeover-apps.json')
    if len(apps) >= 5: json.dump(apps, open(cache, 'w'), indent=1)
    else: apps = json.load(open(cache))
    rowhtml = ''
    for n, d, u in apps:
        d = strip_tags(d).strip()
        rowhtml += '<div><span class="dl-ic">%s</span><div class="t"><h3>%s</h3><p>%s</p></div><a class="mk-btn solid js-dl" data-app="%s" href="%s" download="%s">Download</a></div>' % (n[4:6].upper(), n, e(d), n, u, u.rsplit('/',1)[1])
    body = '''<div class="mk dl">
<header style="padding-top:22px"><span class="mk-eye rv">Apps</span><h1 class="mk-h1 rv">Take AUZslab <em>with you.</em></h1>
<p class="mk-lede rv">Every AUZslab app opens the real, live website inside the app, so you always see the newest version the moment it ships.</p></header>
<div class="wy-seg dl-seg rv" role="tablist"><button data-v="and">Android phone</button><button data-v="ios">iPhone</button><button data-v="pc">Computer</button></div>
<section class="dl-panel" data-p="and"><ol class="dl-steps rv"><li><div><b>Download</b><span>Choose the app below. Your phone saves a small file.</span></div></li><li><div><b>Allow once</b><span>Android warns &ldquo;Install blocked&rdquo;. Tap Settings, allow your browser to install apps, then try again.</span></div></li><li><div><b>Open</b><span>Install, open the app and sign in with your AUZslab login.</span></div></li></ol>
<div class="dl-apps rv">%s</div>
<p class="dl-warn rv">These are direct files, not from the Play Store, and they are test builds: expect the odd rough edge, and update whenever a newer build is released. Fully native versions are in development; ask us if you would like an early test build.</p></section>
<section class="dl-panel" data-p="ios"><ol class="dl-steps rv"><li><div><b>Open in Safari</b><span>Go to your AUZslab address, for example app.auzslab.in, and sign in.</span></div></li><li><div><b>Share</b><span>Tap the Share button at the bottom of Safari.</span></div></li><li><div><b>Add to Home Screen</b><span>It opens like an app, full screen, with its own icon.</span></div></li></ol><p class="dl-warn rv">If an old icon is already on your home screen, delete it first and add it again so the new icon is used.</p></section>
<section class="dl-panel" data-p="pc"><ol class="dl-steps rv"><li><div><b>Open in Chrome or Edge</b><span>Go to your AUZslab address, for example app.auzslab.in.</span></div></li><li><div><b>Install</b><span>Click the install icon at the right of the address bar, then Install.</span></div></li><li><div><b>Use it like a program</b><span>It gets its own window and works offline where the app supports it (POS, AUZsMob, AUZsStyle).</span></div></li></ol></section>
</div>''' % rowhtml
    wr('download-apps.html', swap_main('download-apps.html', body))
    return len(apps)

# ------------------------------------------------------------------ CONTACT
def contact():
    ic = {'call': '<path d="M5 4h4l2 5-2.5 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
          'wa': '<path d="M4 20l1.200-4A8 8 0 1 1 8 19Z"/>', 'mail': '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 8l9 6 9-6"/>'}
    chan = lambda i, k, t, h: '<a href="%s"><svg viewBox="0 0 24 24">%s</svg><div><small>%s</small><b>%s</b></div></a>' % (h, ic[i], k, t)
    chips = [('cafe', 'Café or restaurant'), ('salon', 'Salon'), ('retail', 'Retail shop'), ('mobile', 'Mobile shop'), ('clothing', 'Clothing or shoes'), ('custom', 'Something custom')]
    body = '''<div class="mk ct">
<header style="padding-top:22px"><span class="mk-eye rv">Contact</span><h1 class="mk-h1 rv">Tell us how your <em>business works.</em></h1>
<p class="mk-lede rv">We will help you find the right setup, from ready-to-use software to a system shaped around your workflow. We reply within a day.</p></header>
<section class="ct-wrap"><div>
<div class="ct-ch rv">%s%s%s</div>
<div class="ct-three rv"><div><i>01</i><span><b>You write in</b>A few lines about your business is enough.</span></div><div><i>02</i><span><b>We reply within a day</b>Usually sooner, by phone or email.</span></div><div><i>03</i><span><b>We suggest a setup</b>Ready-made, or shaped around how you work.</span></div></div></div>
<div class="ct-form mk-sheet rv"><div class="ct-prog"><i></i></div>
<form id="formView" data-contact-form>
<div class="ct-q on"><label for="c-name">What should we call you?</label><input id="c-name" name="name" type="text" placeholder="Your name" required autocomplete="name"></div>
<div class="ct-q"><label for="c-business">What is your business called?</label><div class="sub">Optional. Skip if you are still deciding.</div><input id="c-business" name="business" type="text" placeholder="Business name" autocomplete="organization"></div>
<div class="ct-q"><label>What are you running?</label><div class="ct-chips">%s</div><select id="c-niche" name="niche" hidden><option value=""></option><option value="cafe">cafe</option><option value="salon">salon</option><option value="retail">retail</option><option value="mobile">mobile</option><option value="clothing">clothing</option><option value="custom">custom</option></select></div>
<div class="ct-q"><label for="c-contact">How can we reach you?</label><input id="c-contact" name="contact" type="text" placeholder="Phone or email" required autocomplete="tel"></div>
<div class="ct-q"><label for="c-message">Anything we should know?</label><div class="sub">What you use today, what annoys you about it.</div><textarea id="c-message" name="message" placeholder="Tell us in a few lines"></textarea></div>
<div style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true"><label for="c-hp">Leave this field empty</label><input id="c-hp" name="hp" type="text" tabindex="-1" autocomplete="off"></div>
<div class="ct-nav"><button type="button" class="back">Back</button><button type="submit" class="go">Next</button></div></form>
<div class="ct-done success-view" id="successView"><b>Got it.</b><p class="p">We will reach out to <span class="success-contact" id="successContact">you</span> shortly.</p></div></div></section>
<section class="ct-faq rv"><span class="mk-eye" style="margin-bottom:14px">Before you write in</span>
<details><summary>Can I run more than one outlet on this?</summary><p>Yes. Every outlet shares one account, one login and one customer list. No separate sign-ups per branch.</p></details>
<details><summary>Is my business data actually mine?</summary><p>We look after it for you, and your data stays yours.</p></details>
<details><summary>We already use another POS. Can we switch?</summary><p>Tell us what you are on today. We will map out the switch before you commit to anything.</p></details>
<details><summary>How fast do you reply?</summary><p>Within a day, usually sooner.</p></details></section></div>''' % (
        chan('call', 'Call', '+91 92512 50829', 'tel:+919251250829'), chan('wa', 'WhatsApp', 'Text us', 'https://wa.me/919251250829'), chan('mail', 'Email', 'helloauzslab@gmail.com', 'mailto:helloauzslab@gmail.com'),
        ''.join('<button type="button" data-v="%s">%s</button>' % (v, t) for v, t in chips))
    wr('contact.html', swap_main('contact.html', body))

# ------------------------------------------------------------------ STUDIO
def studio():
    steps = [('Tell us what feels wrong', 'A call or message about how you run, and what no software does for you.'),
             ('Scope and quote', 'We write down what we will build and what it costs, before any work starts.'),
             ('Sketch it together', 'You see how it looks and flows, and change it freely before we build.'),
             ('Build in pieces', 'You try working pieces as they are finished, not one big reveal at the end.'),
             ('Live in your workspace', 'It opens at your own address with your staff signed in and your data in place.')]
    canvas = ['<div class="s1"><div class="sk-t">A rough idea</div><div class="st-line w" style="--w:80%"></div><div class="st-line w" style="--w:55%"></div><div class="st-line w" style="--w:68%"></div></div>',
              '<div class="s2"><div class="sk-t">Scope &middot; written down</div><div class="sk-r"><span>Screens</span><i style="--w:70%"></i></div><div class="sk-r"><span>Reports</span><i style="--w:44%"></i></div><div class="sk-r"><span>Quote agreed first</span><i class="hi" style="--w:30%"></i></div></div>',
              '<div class="s3"><div class="sk-t">Sketch</div><div class="sk-grid"><i class="on"></i><i></i><i></i><i></i><i></i><i class="on"></i><i></i><i></i></div></div>',
              '<div class="s4"><div class="sk-t">Build &middot; piece by piece</div><div class="sk-bars"><i style="--h:90%"></i><i style="--h:90%"></i><i class="hi" style="--h:60%"></i><i style="--h:20%"></i></div></div>',
              '<div class="s5"><div class="sk-t">Your workspace</div><div class="st-line w" style="--w:100%"></div><div class="sk-tot"><span>yourname.auzslab.in</span><span class="sk-pill on">Live</span></div></div>']
    body = '''<div class="mk stu">
<header class="st-hero"><span class="mk-eye rv">AUZslab Studio &middot; Premium</span><h1 class="mk-h1 rv">Design it the way <em>you love.</em></h1>
<p class="mk-lede rv">We do not hand you a rigid system and ask you to fit into it. We start from a blank page and shape the software around your business: your screens, your flow, your look, in your own private workspace.</p>
<div class="mk-row rv" style="margin-top:22px"><a class="mk-btn solid" href="contact.html">Describe what you love</a><a class="mk-link" href="#how">How it works</a></div></header>
<section class="st-cmp"><div class="a rv"><small>The rigid system</small><b>Same screens for everyone.</b><p>You change how you work to match the software.</p></div><div class="b rv"><small>Your Studio build</small><b>The software changes to match you.</b><p>Screens, steps, reports and branding decided with you, scoped and quoted per project.</p></div></section>
<section class="st-story" id="how"><div class="st-canvas" data-s="1"><div class="sk"><div class="sk-bar"><i></i><i></i><i></i></div>%s</div></div>
<div class="st-steps">%s</div></section>
<section class="st-own"><div><span class="mk-eye rv">You decide</span><h2 class="mk-h2 rv" style="margin:12px 0 16px">Everything here is yours to shape.</h2><div class="st-chipcloud rv"><span>Screens</span><span>Steps &amp; flow</span><span>Colours</span><span>Logo &amp; name</span><span>Reports</span><span>The words you use</span><span>Staff roles</span><span>Receipts &amp; bills</span><span>Your public site</span></div></div>
<div class="st-ws mk-sheet rv"><span class="mk-eye">Your own workspace</span><code>yourname.auzslab.in</code><ul><li>Its own address, name, logo and colours.</li><li>Its own data, separate from every other business.</li><li>Its own owner and staff logins.</li><li>Hosting, backups and updates are looked after by us.</li><li>Can connect to AUZsPay payroll and AUZsLedger accounting when you add them.</li><li>WhatsApp bill sharing where it fits your workflow.</li></ul></div></section>
<section class="st-case rv"><span class="mk-eye">It has been done</span><h2 class="mk-h2">Showoff Salon wanted something different.</h2><p>Showoff Salon, Jodhpur: their own look, a 67-service menu, online booking, WhatsApp invoices and an admin console for the team, in their own private workspace. It runs live today and became the base of our Salon product.</p><div class="mk-row"><a class="mk-btn" href="https://showoffsalon.auzslab.in" target="_blank" rel="noopener">Visit Showoff Salon</a></div></section>
<section class="st-two"><div class="rv"><b>Studio fits if&hellip;</b><ul><li>Your process does not match any standard product.</li><li>You want a look and workflow that is yours.</li><li>You plan to run it for years and want it built properly.</li></ul></div><div class="rv"><b>A ready-made product is better if&hellip;</b><ul><li>You run a cafe, salon, retail or mobile shop the usual way.</li><li>You need to be live today.</li><li>See <a href="products.html" style="text-decoration:underline">products</a> for ready-made plans.</li></ul></div></section>
<section class="st-case rv" style="margin-top:12px"><span class="mk-eye">Billing</span><h2 class="mk-h2">Billed separately, based on the work.</h2><p>Each project is priced from its own scope. There is no price list and nothing to add to a cart. Scope, price and payment milestones are written down and agreed before work starts. Studio work is billed on its own, apart from any standard AUZslab subscription you also use.</p></section>
<section class="ct-faq rv"><span class="mk-eye" style="margin-bottom:14px">Questions</span>
<details><summary>How much does it cost?</summary><p>It depends on the work. We scope your project, give you a written quote, and bill it separately.</p></details>
<details><summary>Do I own my data?</summary><p>Yes. Your data sits in your own private workspace, kept apart from other businesses, and you can export it.</p></details>
<details><summary>Can you add to it later?</summary><p>Yes. New features are scoped and quoted the same way, as separate work.</p></details></section>
<div class="mk-end rv"><b>Tell us what you would love.</b><span class="mk-row"><a class="mk-btn solid" href="contact.html">Describe what you love</a></span></div></div>''' % (
        ''.join(canvas), ''.join('<div class="st-step%s" data-s="%d"><i>%02d</i><b>%s</b><span>%s</span></div>' % (' on' if i == 0 else '', i + 1, i + 1, e(t), e(d)) for i, (t, d) in enumerate(steps)))
    wr('studio.html', swap_main('studio.html', body))

if __name__ == '__main__':
    products(); why(); demo(); n = download(); contact(); studio()
    print('done; download apps found:', n)
