# Second batch of art-directed pages (legal, resources, web design, intelligence, careers, sitemap, lead demo).
# exec()'d from build-art.py, so it shares put/rd/reg/PAGES/re/os with it.
import html as _html

def _text(x): return re.sub(r'\s+', ' ', _html.unescape(re.sub(r'<[^>]+>', '', x))).strip()

# ---------------------------------------------------------------- legal
LEGAL = [('terms', 'Terms'), ('privacy', 'Privacy'), ('refund', 'Refunds'), ('cookies', 'Cookies'), ('security', 'Security'),
         ('acceptable-use', 'Acceptable use'), ('hardware-terms', 'Hardware'), ('ip-custom-development', 'Ownership')]

def legal(page):
    h = rd(page)
    m = re.search(r'<main class="content">(.*?)</main>', h, re.S).group(1)
    secs = re.findall(r'<section class="section[^"]*"[^>]*>(.*?)</section>', m, re.S)
    head, rest = secs[0], secs[1:]
    title = re.search(r'<h1[^>]*>(.*?)</h1>', head, re.S).group(1)
    lede = _text(re.search(r'<p class="lede">(.*?)</p>', head, re.S).group(1))
    upd = ''
    mm = re.match(r'(Last updated [^.]+)\.\s*(.*)', lede)
    if mm: upd, lede = mm.group(1), mm.group(2)
    idx = [k for k, _ in LEGAL].index(page) + 1
    shelf = ''.join('<a href="%s.html"%s>%s</a>' % (k, ' class="on" aria-current="page"' if k == page else '', n) for k, n in LEGAL)
    rail, body = '', ''
    for i, s in enumerate(rest, 1):
        t = re.search(r'<div class="h-2"[^>]*>(.*?)</div>', s, re.S)
        if not t: continue
        name = re.sub(r'^\s*\d+\.\s*', '', _text(t.group(1)))
        inner = s[t.end():]
        rail += '<li><a href="#s%d"><i>%02d</i><span>%s</span></a></li>' % (i, i, _html.escape(name))
        body += '<section class="al-sec" id="s%d"><span class="al-n" aria-hidden="true">%02d</span><h2>%s</h2>%s</section>' % (i, i, _html.escape(name), inner)
    out = '''
<div class="al">
<header class="al-hero">
<div class="al-top"><span class="al-mono">LEGAL &middot; %02d / %02d</span>%s</div>
<h1 class="al-h">%s</h1>
<p class="al-lede">%s</p>
<nav class="al-shelf" aria-label="Legal documents">%s</nav>
</header>
<div class="al-body">
<aside class="al-rail" aria-label="On this page"><b>On this page</b><ol>%s</ol><i class="al-bar" aria-hidden="true"></i></aside>
<article class="al-doc">%s</article>
</div>
<div class="al-end"><span class="al-mono">QUESTIONS?</span><p>Write to us and a person will answer.</p><a class="btn" href="contact.html">Contact us</a></div>
</div>''' % (idx, len(LEGAL), ('<span class="al-pill">%s</span>' % upd) if upd else '', title, lede, shelf, rail, body)
    put(page, out, 'a-legal', 'a-legal', js=False)
    # small script (section spy) lives in a2.js
    f = os.path.join(OUT, page + '.html'); t = open(f, encoding='utf-8').read()
    t = t.replace('</body>', '<script src="a2.js?v=1" defer></script></body>', 1); open(f, 'w', encoding='utf-8').write(t)

for _k, _ in LEGAL:
    PAGES[_k] = (lambda p=_k: legal(p))

# ---------------------------------------------------------------- magazine pages (resources + learn)
def mag(page, issue):
    h = rd(page)
    m = re.search(r'<main class="content">(.*?)(?:<div class="ftwrap"|</main>)', h, re.S).group(1)
    secs = re.findall(r'<section([^>]*)>(.*?)</section>', m, re.S)
    hat, hin = secs[0]
    label = _text(re.search(r'<div class="label">(.*?)</div>', hin, re.S).group(1))
    title = re.search(r'<h1[^>]*>(.*?)</h1>', hin, re.S).group(1)
    lede = _text(re.search(r'<p class="lede">(.*?)</p>', hin, re.S).group(1))
    acts = ''.join(re.findall(r'<div class="acts"[^>]*>.*?</div>', hin, re.S))
    parts = re.split(r'<br\s*/?>', title)
    if len(parts) == 1:
        w = title.split(' '); k = max(1, len(w) // 2); parts = [' '.join(w[:k]), ' '.join(w[k:])]
    t1 = '<span class="aw" style="--i:0"><span>%s</span></span>' % parts[0] + '<span class="aw" style="--i:1"><span class="am-g">%s</span></span>' % ' '.join(parts[1:])
    chs, idx, tick = '', '', []
    n = 0
    for attrs, inner in secs[1:]:
        lm = re.search(r'<div class="label">(.*?)</div>', inner, re.S)
        if lm: name = _text(lm.group(1)); inner = inner.replace(lm.group(0), '', 1)
        else:
            hm = re.search(r'<(?:h2|div class="h-2")[^>]*>(.*?)</(?:h2|div)>', inner, re.S)
            name = _text(hm.group(1)) if hm else 'More'
            if hm: inner = inner.replace(hm.group(0), '', 1)
        if not _text(inner): continue
        n += 1
        im = re.search(r'id="([^"]+)"', attrs); sid = im.group(1) if im else 'c%d' % n
        idx += '<li><a href="#%s"><i>%d.0</i><b>%s</b></a></li>' % (sid, n, _html.escape(name))
        tick.append(name)
        chs += '<section class="am-ch" id="%s"><div class="am-chh"><span class="am-num">%d.0</span><h2>%s</h2></div><div class="am-chb">%s</div></section>' % (sid, n, _html.escape(name), inner)
    tk = ''.join('<span>%s</span><em>&#10022;</em>' % _html.escape(x) for x in tick)
    body = '''
<div class="am">
<header class="am-cover"><div class="a-grain"></div>
<div class="am-top"><span class="am-mono">%s</span><span class="am-mono">ISSUE %s</span></div>
<h1 class="am-h">%s</h1>
<p class="am-lede">%s</p>
<div class="am-acts">%s</div>
<ol class="am-index">%s</ol>
</header>
<div class="am-tick" aria-hidden="true"><div>%s%s</div></div>
<div class="am-sheet">%s</div>
</div>''' % (_html.escape(label.upper()), issue, t1, lede, acts, idx, tk, tk, chs)
    put(page, body, 'a-dark a-mag', 'a-mag')

for _p, _i in [('resources-getting-started', '01'), ('resources-operations', '02'), ('resources-growth', '03'), ('learn', '00')]:
    PAGES[_p] = (lambda p=_p, i=_i: mag(p, i))

# ---------------------------------------------------------------- web design: a browser that changes what it shows
def webdesign():
    h = rd('web-design')
    m = re.search(r'<main class="content">(.*?)<div class="ftwrap"', h, re.S).group(1)
    secs = re.findall(r'<section([^>]*)>(.*?)</section>', m, re.S)
    title = re.search(r'<h1[^>]*>(.*?)</h1>', secs[0][1], re.S).group(1)
    lede = _text(re.search(r'<p class="lede">(.*?)</p>', secs[0][1], re.S).group(1))
    cards = lambda s: re.findall(r'<div class="card">(.*?)</div>(?=<div class="card">|\s*</div>\s*$)', s, re.S)
    build = re.findall(r'<div class="card"><div class="label">(.*?)</div><h3 class="h-3">(.*?)</h3><p>(.*?)</p></div>', secs[1][1], re.S)
    work = re.findall(r'<div class="card"><div class="label">(.*?)</div><h3 class="h-3">(.*?)</h3><p>(.*?)</p><a class="btn btn-ghost" href="(.*?)"', secs[2][1], re.S)
    steps = re.findall(r'<div class="card"><div class="label">(\d)</div><p><b>(.*?)</b>(.*?)</p></div>', secs[3][1], re.S)
    cta = _text(re.search(r'<h2 class="h-2">(.*?)</h2>', secs[4][1], re.S).group(1))
    ctap = _text(re.search(r'<p class="lede"[^>]*>(.*?)</p>', secs[4][1], re.S).group(1))
    tabs = [('Website', 'yourbrand.in'), ('Online store', 'shop.yourbrand.in'), ('Website + POS', 'orders.yourbrand.in')]
    tb = ''.join('<button type="button" data-s="%d"%s>%s</button>' % (i, ' class="on"' if i == 0 else '', t) for i, (t, _) in enumerate(tabs))
    screens = '''
<div class="wb-scr on" data-s="0"><div class="wb-nav"><b></b><span></span><span></span><span></span><i>Order</i></div>
<div class="wb-hero"><div class="wb-t"><u></u><u></u><u class="s"></u></div><div class="wb-pic"></div></div>
<div class="wb-row3"><div></div><div></div><div></div></div></div>
<div class="wb-scr" data-s="1"><div class="wb-nav"><b></b><span></span><span></span><i class="bag">Bag <em>2</em></i></div>
<div class="wb-grid"><div><s></s><u></u><i>&#8377;&nbsp;&nbsp;&nbsp;&nbsp;</i></div><div><s></s><u></u><i></i></div><div><s></s><u></u><i></i></div><div><s></s><u></u><i></i></div><div><s></s><u></u><i></i></div><div><s></s><u></u><i></i></div></div>
<div class="wb-add">Add to bag</div></div>
<div class="wb-scr" data-s="2"><div class="wb-split"><div class="wb-l"><div class="wb-nav"><b></b><i>Place order</i></div><div class="wb-lines"><u></u><u></u><u class="s"></u></div></div>
<div class="wb-pos"><div class="wb-bell">New order</div><div class="wb-tk"><b>#104</b><u></u><u></u><u class="s"></u></div></div></div></div>'''
    body = '''
<div class="aw3">
<header class="aw3-hero"><div class="a-grain"></div>
<div class="aw3-blob"></div>
<span class="aw3-mono">AUZSLAB WEB &mdash; WEBSITES &amp; ONLINE STORES</span>
<h1 class="aw3-h">%s</h1>
<p class="aw3-sub">%s</p>
<div class="aw3-cta"><button class="btn" data-open-contact>Build my website or store</button><a class="btn" href="#previews">See live work</a></div>
<div class="aw3-stage">
<div class="aw3-tabs" role="tablist">%s</div>
<div class="aw3-win"><div class="aw3-bar"><i></i><i></i><i></i><span id="awAddr">%s</span></div><div class="aw3-view" id="awView">%s</div></div>
</div></header>
<section class="aw3-sec"><span class="aw3-mono">WHAT WE BUILD</span><h2>Three things, one team.</h2>
<div class="aw3-three">%s</div></section>
<section class="aw3-sec aw3-dark" id="previews"><span class="aw3-mono">OUR WORK</span><h2>Open them and try them.</h2><p class="aw3-p">These are live demos. Browse, add to the bag, place a test order.</p>
<div class="aw3-work">%s</div></section>
<section class="aw3-sec"><span class="aw3-mono">HOW IT WORKS</span><h2>From idea to live in three steps.</h2>
<ol class="aw3-steps">%s</ol></section>
<section class="aw3-end"><h2>%s</h2><p>%s</p><button class="btn" data-open-contact>Contact us to build your online store or website</button></section>
</div>''' % (title, lede, tb, tabs[0][1], screens,
    ''.join('<article class="a-rise"><i>%s</i><h3>%s</h3><p>%s</p></article>' % (a, b, c) for a, b, c in build),
    ''.join('<a class="aw3-job a-rise" href="%s" target="_blank" rel="noopener"><span>%s</span><b>%s</b><p>%s</p><em>Open live preview &rarr;</em></a>' % (d, a, b, c) for a, b, c, d in work),
    ''.join('<li class="a-rise"><b>%s</b><p><strong>%s</strong>%s</p></li>' % (a, b, c) for a, b, c in steps), cta, ctap)
    put('web-design', body, 'a-dark a-web', 'a-web', js=False)
    f = os.path.join(OUT, 'web-design.html'); t = open(f, encoding='utf-8').read()
    t = t.replace('<script src="a.js', '<script src="a.js').replace('</body>', '<script src="a2.js?v=1" defer></script></body>', 1)
    t = t.replace('</head>', '<link rel="stylesheet" href="a.css?v=1"></head>', 1) if 'a.css' not in t else t
    open(f, 'w', encoding='utf-8').write(t)
PAGES['web-design'] = webdesign
