#!/usr/bin/env python3
"""Art-directed marketing pages. Reads the originals from tools/art-src/, writes site/. Idempotent.
Usage: python3 tools/build-art.py [page ...]"""
import re, os, sys, json
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(R, 'tools', 'art-src'); OUT = os.path.join(R, 'site')
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
    links = '<link rel="stylesheet" href="a.css?v=1">' + ('<link rel="stylesheet" href="%s.css?v=1">' % css if css else '')
    h = h.replace('</head>', links + '</head>', 1)
    if js: h = h.replace('</body>', '<script src="a.js?v=1" defer></script></body>', 1)
    wr(page, h)

def home():
    tiles = lambda items: ''.join('<a class="ah-t t%d a-rise" href="%s"><i>%s</i><b>%s</b><span>%s</span><em></em></a>' % (i % 4, u, n, t, s) for i, (n, t, s, u) in enumerate(items))
    run = [('01', 'AUZsPOS', 'Counter, kitchen, tables', 'products.html#slab-pos'), ('02', 'AUZsPay', 'Clock-ins to payslips', 'products.html#slab-payroll'), ('03', 'AUZsLedger', 'Books that balance', 'products.html#slab-accounting'), ('04', 'AUZsScan', 'Scan, bill, share', 'products.html#slab-scan')]
    grow = [('05', 'QR ordering', 'Guests order at the table', 'products.html#slab-qr'), ('06', 'AUZsMob', 'Phones, repairs, stock', 'products.html#slab-mobile'), ('07', 'Salon', 'Bookings and clients', 'products.html#slab-salon'), ('08', 'Websites', 'Your own online store', 'web-design.html')]
    idx = ''.join('<li><a href="%s"><i>%s</i>%s</a></li>' % (u, n, t) for n, t, u in [('1.0', 'Sell', 'products.html#slab-pos'), ('2.0', 'Account', 'products.html#slab-accounting'), ('3.0', 'Pay people', 'products.html#slab-payroll'), ('4.0', 'Scan', 'products.html#slab-scan'), ('5.0', 'Sell online', 'web-design.html')])
    return '''
<div class="ah">
<section class="ah-hero">
<div class="ah-top"><span>AUZslab&trade;<br>Ecosystem<br>Jodhpur, 2026</span><span>Field<br>Every business</span><span class="ah-dot"></span></div>
<h1 class="ah-h"><span class="aw" style="--i:0"><span data-ed="home.h">One ecosystem.</span></span><span class="aw" style="--i:1"><span>Shaped by you.</span></span><span class="aw dim" style="--i:2"><span>Rigid ends here.</span></span></h1>
<ol class="ah-idx">%s</ol>
<p class="ah-sub" data-ed="home.sub">Rigid software ends here.</p>
</section>
<section class="ah-grey">
<div class="ah-head"><span>Selected systems</span><span>Pick today &middot; add later</span><span>2026</span></div>
<h2 class="ah-big a-slide" style="--from:14%%;--to:-4%%">Run</h2>
<div class="ah-row">%s</div>
<h2 class="ah-big a-slide" style="--from:-14%%;--to:4%%">Grow</h2>
<div class="ah-row">%s</div>
</section>
<section class="ah-white">
<div class="ah-case"><i>2.5</i><b>YOUR BUSINESS<small>Shaped, not squeezed</small></b></div>
<div class="ah-spec">
<div class="ah-pic a-rise"><div class="ph r45" data-ed-img="home.a"></div></div>
<dl>
<div class="a-rise"><dt>Overview</dt><dd data-ed="home.l2s">Every screen, bill, rule and field bends to how you work. One login, one ledger, and every part is yours to shape.</dd></div>
<div class="a-rise"><dt>Systems</dt><dd><a href="products.html#slab-pos">Sell</a><a href="products.html#slab-accounting">Account</a><a href="products.html#slab-payroll">Pay</a><a href="products.html#slab-scan">Scan</a><a href="products.html#slab-mobile">Mobile</a></dd></div>
<div class="a-rise"><dt>Businesses</dt><dd><a href="business-cafes.html">Cafes</a><a href="business-salons.html">Salons</a><a href="business-retail.html">Retail</a><a href="business-clothing.html">Clothing</a><a href="business-mobile-repair.html">Mobile shops</a></dd></div>
<div class="a-rise"><dt>See it run</dt><dd><a href="live-demo.html">Live demo</a><a href="download-apps.html">Apps</a><a href="studio.html">Studio</a></dd></div>
</dl></div>
<div class="ah-cta a-rise"><span>Build yours.</span><button class="btn" data-open-contact>Talk to us</button></div>
</section>
</div>''' % (idx, tiles(run), tiles(grow))

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
<div class="ay-ecowrap">%s</div>
%s
</div>''' % (eco, bl)
    put('platform', body, 'a-dark a-why', 'a-why')

@reg('products')
def _():
    h = rd('products')
    wrap = re.search(r'<div class="pr-wrap">.*', h[h.index('<main'):h.index('<div class="ftwrap"')], re.S).group(0)
    intro = '''
<section class="ap-intro">
<div class="ap-slide light"><span class="ap-pill">WELCOME</span><p class="ap-big">Everything your business touches, <em>connected and yours to shape.</em></p><a class="ap-go" href="#slab-pos">Get to know us <i>&searr;</i></a><span class="ap-deco d1"></span><span class="ap-deco d2"></span></div>
<div class="ap-slide dark"><span class="ap-pill">SECTION 1</span><b class="ap-num">01</b><h1 class="ap-h" data-ed="products.h">Built around you.</h1><p class="ap-p" data-ed="products.sub">Connected systems for every part of your business. Pick what you need today; add the rest when you grow.</p><i class="ap-arrow">&swarr;</i></div>
<div class="ap-bento">
<div class="b1"><b data-count="10">10</b><span>connected systems</span></div>
<div class="b2"><i></i></div>
<div class="b3"><i></i></div>
<div class="b4"><b>1</b><span>login</span><em>&#9678;</em></div>
<div class="b5"><b>1</b><span>ledger</span><em>&#9711;</em></div>
</div>
</section>'''
    put('products', intro + wrap, 'a-prod', 'a-prod')


def strip(x): return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', x)).strip()

@reg('live-demo')
def _():
    h = rd('live-demo')
    wrap = re.search(r'<section class="dm-wrap.*?</section>', h, re.S).group(0)
    data = re.search(r'<script type="application/json" id="dm-data">.*?</script>', h, re.S).group(0)
    end = re.search(r'<div class="mk-end rv">.*?</div></div>', h[h.index('<main'):], re.S)
    body = '''
<div class="ad">
<header class="ad-hero"><span class="ad-mono">LIVE DEMO &mdash; 4 VARIANTS</span><h1 class="ad-h"><span class="aw" style="--i:0"><span>Try it</span></span><span class="aw" style="--i:1"><span>before you buy.</span></span></h1>
<p class="ad-p">Real working accounts, open to everyone. Pick a card, copy the login, click around. Nothing here touches your business.</p></header>
%s%s
<div class="ad-end"><b>Not sure which one?</b><button class="btn" data-open-contact>We will walk you through it</button><a class="btn btn-ghost" href="products.html">See all products</a></div>
</div>''' % (wrap, data)
    put('live-demo', body, 'a-demo', 'a-demo')

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
<div class="adl-kit"><div class="adl-bar">%s</div><div class="adl-toggles"><span class="tg on"></span><span class="tg"></span><span class="ck"></span></div></div>
<div class="adl-panels">%s</div>
</div>''' % (seg, panels)
    put('download-apps', body, 'a-dl', 'a-dl')

def biz(page, accent):
    h = rd(page)
    m = h[h.index('<main'):h.index('<div class="ftwrap"')]
    img = re.search(r'data-ed-img="(biz\.[a-z-]+)"', m).group(1)
    hk = re.search(r'<h1 data-ed="([^"]+)">(.*?)</h1>', m, re.S)
    sk = re.search(r'<span data-ed="([^"]+)">(.*?)</span>', m, re.S)
    rows = re.findall(r'<b style="font-weight:400[^>]*>(.*?)</b>', m, re.S)
    tail = m[m.index('<section class="section tight" id="quote">'):]
    tail = tail[:tail.rindex('</section>') + 10] if '<div class="stack">' not in tail else tail[:tail.index('<div class="stack">')]
    cells = ''.join('<div class="ab-c a-rise"><i>%02d</i><b>%s</b><em></em></div>' % (i + 1, r) for i, r in enumerate(rows))
    body = '''
<div class="ab" style="--ac:%s">
<span class="ab-mono">%s</span>
<div class="ab-frame">
<div class="ab-top"><div class="ab-title"><h1 data-ed="%s">%s</h1></div><div class="ab-metal"></div></div>
<div class="ab-sub"><span>&larr;</span><code>business: %s</code><span>&rarr;</span></div>
<div class="ab-grid">%s</div>
</div>
<div class="ab-band a-rise"><div><h2>Tell us how your business works.</h2><p data-ed="%s">%s</p><button class="btn" data-open-contact>Let's talk</button></div><div class="ab-dots"></div></div>
</div>
<div class="ab-tail">%s</div>''' % (accent, page.replace('business-', '').replace('-', ' ').upper(), hk.group(1), hk.group(2), page.replace('business-', '').replace('-repair', ''), cells, sk.group(1), sk.group(2), tail)
    put(page, body, 'a-biz', 'a-biz')

for _p, _a in [('business-cafes', '#800020'), ('business-salons', '#7a2e5a'), ('business-retail', '#0f5a56'), ('business-clothing', '#a24a14'), ('business-mobile-repair', '#2a3f9a')]:
    PAGES[_p] = (lambda p=_p, a=_a: biz(p, a))

if __name__ == '__main__':
    for n in (sys.argv[1:] or list(PAGES)): PAGES[n]()
