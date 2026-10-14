#!/usr/bin/env python3
"""Reads the marketing pages in site/*.html and writes assets/site/pages.json (text, headings, lists, buttons, FAQs,
tables, images, in page order) for the native hub's website screens. Re-run after the website copy changes:
  python3 native/auzshub/tool/make_site_data.py
"""
import json, re, sys, html
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SITE = ROOT / 'site'
OUT = Path(__file__).resolve().parents[1] / 'assets' / 'site' / 'pages.json'

PAGES = ['index', 'products', 'pricing', 'pos', 'qr-ordering', 'payroll', 'accounting', 'scan-and-bill', 'billing', 'crm',
         'inventory', 'intelligence', 'platform', 'studio', 'ip-custom-development', 'creatopz', 'business-cafes',
         'business-clothing', 'business-mobile-repair', 'business-retail', 'business-salons', 'learn',
         'resources-getting-started', 'resources-operations', 'resources-growth', 'contact', 'live-demo', 'security',
         'terms', 'privacy', 'refund', 'cookies', 'acceptable-use', 'hardware-terms', 'join-team', 'sitemap',
         'delete-account']

PAGE_PRODUCT = {'pos': 'pos', 'qr-ordering': 'self_order', 'payroll': 'payroll', 'accounting': 'accounting', 'billing': 'billing',
                'crm': 'crm', 'inventory': 'inventory', 'business-mobile-repair': 'mobile', 'scan-and-bill': 'scan'}
INCLUDED = {'crm', 'billing', 'inventory'}
CUR = {'page': ''}

VOID = {'br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'}
INLINE = {'a', 'b', 'strong', 'i', 'em', 'span', 'u', 'small', 'sup', 'sub', 'br', 'code', 'mark', 'abbr', 'time', 'label'}
SKIP_TAGS = {'script', 'style', 'svg', 'canvas', 'noscript', 'header', 'aside', 'nav', 'footer', 'form', 'select', 'input',
             'textarea', 'template', 'iframe', 'video', 'audio', 'picture', 'source'}
SKIP_CLASS = {'note', 'strip', 'till', 'crumbk', 'ring', 'theme-toggle', 'hamburger', 'uk-breadcrumb', 'fx-field', 'success-view',
              'drawer-overlay', 'page-transition', 'stamp-bg', 'doodle', 'cart-count', 'knock', 'cookie', 'uk-bento-code', 'uk-bento', 'fx-art', 'sk'}


class N:
    def __init__(s, tag, attrs, parent):
        s.tag, s.attrs, s.parent, s.kids = tag, dict(attrs), parent, []

    @property
    def cls(s):
        return set((s.attrs.get('class') or '').split())


class T(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=True)
        s.root = N('root', [], None)
        s.cur = s.root

    def handle_starttag(s, tag, attrs):
        n = N(tag, attrs, s.cur)
        s.cur.kids.append(n)
        if tag not in VOID:
            s.cur = n

    def handle_startendtag(s, tag, attrs):
        s.cur.kids.append(N(tag, attrs, s.cur))

    def handle_endtag(s, tag):
        c = s.cur
        while c is not None and c.tag != tag:
            c = c.parent
        if c is not None and c.parent is not None:
            s.cur = c.parent

    def handle_data(s, d):
        s.cur.kids.append(d)


def parse(path):
    t = T()
    t.feed(Path(path).read_text(encoding='utf-8'))
    return t.root


def find(n, tag):
    for k in n.kids:
        if isinstance(k, N):
            if k.tag == tag:
                return k
            r = find(k, tag)
            if r:
                return r
    return None


def text_of(n):
    out = []
    def go(x):
        if isinstance(x, str):
            out.append(x)
        elif x.tag in ('script', 'style', 'svg'):
            return
        else:
            if x.tag in ('br',):
                out.append(' ')
            for k in x.kids:
                go(k)
    go(n)
    return re.sub(r'\s+', ' ', ''.join(out)).strip()


def skipped(n):
    return n.tag in SKIP_TAGS or bool(n.cls & SKIP_CLASS) or n.attrs.get('aria-hidden') == 'true' and n.tag != 'span' and not text_of(n) \
        or 'hidden' in n.attrs


def is_inline(n):
    return isinstance(n, str) or (n.tag in INLINE and not (n.cls & {'btn'}) and all(is_inline(k) or True for k in n.kids) and not has_block(n))


def has_block(n):
    for k in n.kids:
        if isinstance(k, N):
            if k.tag not in INLINE or k.cls & {'btn'} or has_block(k):
                return True
    return False


def spans(n):
    """inline content -> list of {x, b?, h?}"""
    out = []
    def add(t, b, h):
        if not t:
            return
        out.append({'x': t, **({'b': 1} if b else {}), **({'h': h} if h else {})})
    def go(x, b, h):
        if isinstance(x, str):
            add(re.sub(r'\s+', ' ', x), b, h)
        elif x.tag in ('script', 'style', 'svg'):
            return
        elif x.tag == 'br':
            add('\n', b, h)
        else:
            nb = b or x.tag in ('b', 'strong')
            nh = h
            if x.tag == 'a' and x.attrs.get('href'):
                nh = x.attrs['href']
            for k in x.kids:
                go(k, nb, nh)
    go(n, False, None)
    # tidy: merge same-style neighbours, trim
    m = []
    for s in out:
        if m and m[-1].get('b') == s.get('b') and m[-1].get('h') == s.get('h'):
            m[-1]['x'] += s['x']
        else:
            m.append(dict(s))
    txt = ''.join(s['x'] for s in m)
    if not txt.strip():
        return []
    m[0]['x'] = m[0]['x'].lstrip()
    m[-1]['x'] = m[-1]['x'].rstrip()
    m = [s for s in m if s['x']]
    for s in m:
        s['x'] = re.sub(r' *\n *', '\n', s['x'])
    return m


def sig(n):
    return (n.tag, tuple(sorted(n.cls - {'reveal', 'in'})))


def action_of(n):
    a = n.attrs
    if 'data-add' in a or 'data-product' in a:
        return 'add'
    if 'data-open-contact' in a:
        return 'contact'
    return ''


def btn(n):
    label = text_of(n)
    if not label:
        return None
    href = n.attrs.get('href', '')
    b = {'t': 'btn', 'x': label}
    if href and not href.startswith('javascript'):
        b['h'] = href
    act = action_of(n)
    m = re.search(r'[?&]add=([a-z_,]+)', href)
    if m:
        act = 'add'
        b['p'] = m.group(1)
        b.pop('h', None)
    if n.attrs.get('data-add-plan'):
        act = 'add'
        b['p'] = n.attrs['data-add-plan']
    if act:
        b['a'] = act
        if 'p' not in b:
            a = n
            while a is not None and not isinstance(a, str):
                if a.attrs.get('data-product'):
                    b['p'] = a.attrs['data-product']
                    break
                a = a.parent
            if 'p' not in b and PAGE_PRODUCT.get(CUR['page']):
                b['p'] = PAGE_PRODUCT[CUR['page']]
        if act == 'add' and b.get('p') in INCLUDED:
            return {'t': 'p', 's': [{'x': 'Included with AUZsPOS: nothing separate to buy.', 'b': 1}]}
    if 'btn-primary' in n.cls:
        b['k'] = 'primary'
    return b


def heading_level(n):
    if re.fullmatch(r'h[1-6]', n.tag):
        return int(n.tag[1])
    c = n.cls
    if c & {'h-hero', 'fx-h1'}:
        return 1
    if c & {'h-2', 'fx-h2', 'dh', 'h2'}:
        return 2
    if c & {'h-3', 'h3'}:
        return 3
    return 0


def blocks(n, out, seen_ids):
    """append blocks for node n"""
    if isinstance(n, str):
        t = re.sub(r'\s+', ' ', n).strip()
        if t:
            out.append({'t': 'p', 's': [{'x': t}]})
        return
    if skipped(n):
        return
    if 'data-price-card' in n.attrs:
        keys = []
        for b in iter_tags(n, 'button'):
            if b.attrs.get('data-add-plan'):
                keys = b.attrs['data-add-plan'].split(',')
        nm = next((text_of(x) for x in iter_tags(n, 'div') if 'price-card-name' in x.cls), '')
        pr = next((text_of(x) for x in iter_tags(n, 'div') if 'price-card-price' in x.cls), '')
        sub = [text_of(x) for x in iter_tags(n, 'p') if 'price-card-sub' in x.cls]
        bd = next((text_of(x) for x in iter_tags(n, 'div') if 'price-card-badge' in x.cls), '')
        det = next((x.attrs.get('href') for x in iter_tags(n, 'a') if 'btn' in x.cls), '')
        out.append({'t': 'plan', 'keys': keys, 'x': nm, 'price': re.sub(r'\s*/mo.*$', '', pr), 'sub': sub, 'badge': bd, 'h': det or ''})
        return
    if n.attrs.get('id') == 'bundleGrid':
        out.append({'t': 'live', 'k': 'bundles'})
        return
    if n.attrs.get('id') == 'firstBill':
        out.append({'t': 'live', 'k': 'calc'})
        return
    bid = n.attrs.get('id')
    start = len(out)
    handle(n, out, seen_ids)
    if bid and len(out) > start and 'id' not in out[start]:
        out[start]['id'] = bid


def handle(n, out, seen_ids):
    tag = n.tag
    lvl = heading_level(n)
    if lvl and not has_block(n):
        t = text_of(n)
        if t:
            out.append({'t': 'h', 'l': lvl, 'x': t})
        return
    if lvl:
        t = text_of(n)
        if t and len(t) < 160:
            out.append({'t': 'h', 'l': lvl, 'x': t})
            return
    if tag == 'a' and (n.cls & {'btn', 'pair', 'uk-linklist-item'} or 'data-magnet' in n.attrs or not has_block(n)) and (n.cls & {'btn', 'pair'} or 'data-magnet' in n.attrs or not text_of(n.parent) != text_of(n)):
        b = btn(n)
        if b:
            out.append(b)
        return
    if tag == 'button':
        if n.cls & {'btn'} or action_of(n):
            b = btn(n)
            if b:
                out.append(b)
        return
    if tag == 'img':
        src = n.attrs.get('src', '')
        if src and not src.startswith('data:') and 'logo' not in src:
            out.append({'t': 'img', 'u': src, 'alt': n.attrs.get('alt', '')})
        return
    if tag in ('ul', 'ol'):
        items = []
        for li in n.kids:
            if isinstance(li, N) and li.tag == 'li' and not skipped(li):
                if has_block(li):
                    sub = []
                    for k in li.kids:
                        blocks(k, sub, seen_ids)
                    if sub:
                        items.append({'b': sub})
                else:
                    s = spans(li)
                    if s:
                        items.append({'s': s})
        if items:
            out.append({'t': 'ul', 'o': 1 if tag == 'ol' else 0, 'i': items})
        return
    if tag == 'details':
        summ = next((k for k in n.kids if isinstance(k, N) and k.tag == 'summary'), None)
        sub = []
        for k in n.kids:
            if k is not summ:
                blocks(k, sub, seen_ids)
        q = text_of(summ) if summ else ''
        out.append({'t': 'faq', 'q': q, 'b': sub})
        return
    if tag == 'table':
        rows = []
        for tr in iter_tags(n, 'tr'):
            cells = [text_of(c) for c in tr.kids if isinstance(c, N) and c.tag in ('td', 'th')]
            if any(cells):
                rows.append(cells)
        if rows:
            out.append({'t': 'table', 'r': rows})
        return
    if tag == 'blockquote':
        s = spans(n)
        if s:
            out.append({'t': 'quote', 's': s})
        return
    if tag == 'pre' or (tag == 'code' and has_block(n)):
        out.append({'t': 'code', 'x': text_of(n)})
        return
    if tag == 'hr':
        return
    # text-only container
    if not has_block(n) and tag in ('p', 'div', 'span', 'li', 'section', 'label', 'small', 'b', 'strong', 'em', 'i', 'td', 'th', 'dd', 'dt', 'figcaption', 'summary', 'sup', 'u', 'code'):
        s = spans(n)
        if s:
            if n.cls & {'eye', 'label', 'kicker', 'eyebrow', 'stamp'}:
                out.append({'t': 'eye', 'x': text_of(n)})
            else:
                out.append({'t': 'p', 's': s})
        return
    # container: repeated children become cards
    kids = [k for k in n.kids if isinstance(k, N) and not skipped(k)]
    sigs = {}
    for k in kids:
        sigs.setdefault(sig(k), []).append(k)
    rep = [g for g in sigs.values() if len(g) >= 2 and g[0].tag not in INLINE and g[0].tag not in ('li', 'br')]
    if rep and not (n.cls & {'stack'}) and tag != 'main':
        grp = max(rep, key=len)
        cards = []
        for k in grp:
            sub = []
            blocks(k, sub, seen_ids)
            if sub:
                cards.append(sub)
        multi = sum(1 for c in cards if len(c) >= 2 or (c and c[0]['t'] in ('ul', 'cards')))
        if cards and multi >= max(2, len(cards) // 2) and len(cards) == len(grp):
            # anything not in the group is handled in DOM order
            for k in n.kids:
                if isinstance(k, N) and k in grp:
                    if k is grp[0]:
                        out.append({'t': 'cards', 'i': [{'b': c} for c in cards]})
                else:
                    blocks(k, out, seen_ids)
            return
        if cards and all(len(c) == 1 and c[0]['t'] == 'btn' for c in cards) and len(cards) == len(grp):
            for k in n.kids:
                if isinstance(k, N) and k in grp:
                    if k is grp[0]:
                        out.append({'t': 'links', 'i': [c[0] for c in cards]})
                else:
                    blocks(k, out, seen_ids)
            return
    if tag == 'section':
        sub = []
        for k in n.kids:
            blocks(k, sub, seen_ids)
        if sub:
            cls = n.cls
            tone = 'dark' if cls & {'stack-panel-dark', 'dark'} else ('alt' if 'alt' in cls else '')
            out.append({'t': 'sec', 'c': tone, 'b': sub})
        return
    inline_run = []
    def flush():
        if inline_run:
            wrapper = N('span', [], None)
            wrapper.kids = list(inline_run)
            s = spans(wrapper)
            if s:
                out.append({'t': 'p', 's': s})
            inline_run.clear()
    for k in n.kids:
        if isinstance(k, str) or (k.tag in INLINE and not has_block(k) and not (k.cls & {'btn'}) and not skipped(k) and not action_of(k)):
            if isinstance(k, N) and k.tag == 'a' and k.attrs.get('href') and not text_of(k):
                continue
            inline_run.append(k)
        else:
            flush()
            blocks(k, out, seen_ids)
    flush()


def iter_tags(n, tag):
    for k in n.kids:
        if isinstance(k, N):
            if k.tag == tag:
                yield k
            yield from iter_tags(k, tag)


def flatten(bl):
    """lift nested sections so the page is a flat list of sections"""
    out = []
    def go(b, into):
        if b['t'] == 'sec':
            cur = {'t': 'sec', 'c': b['c'], 'b': []}
            if 'id' in b:
                cur['id'] = b['id']
            into.append(cur)
            for x in b['b']:
                if x['t'] == 'sec':
                    go(x, into)
                    into.append({'t': 'sec', 'c': b['c'], 'b': []})
                else:
                    cur['b'].append(x)
                    if x['t'] == 'cards':
                        for c in x['i']:
                            c['b'] = [y for y in c['b']]
        else:
            if not into or into[-1]['t'] != 'sec':
                into.append({'t': 'sec', 'c': '', 'b': []})
            into[-1]['b'].append(b)
    for b in bl:
        go(b, out)
    return [s for s in out if s['b']]


def dedupe(bl):
    seen = set()
    out = []
    for b in bl:
        k = json.dumps(b, sort_keys=True)
        if b['t'] in ('btn',) and k in seen:
            continue
        if b['t'] == 'btn':
            seen.add(k)
        out.append(b)
    return out


def demote(secs):
    for s in secs:
        b = s['b']
        for i in range(len(b) - 1):
            if b[i]['t'] == 'h' and b[i]['l'] == 1 and b[i + 1]['t'] == 'h' and b[i + 1]['l'] == 1:
                b[i] = {'t': 'eye', 'x': b[i]['x']}
    return secs


def clean(secs):
    out = []
    for s in secs:
        b = dedupe(s['b'])
        # drop consecutive identical blocks
        r = []
        for x in b:
            if r and r[-1] == x:
                continue
            r.append(x)
        if r:
            s['b'] = r
            out.append(s)
    return out


def main():
    data = {}
    for name in PAGES:
        p = SITE / f'{name}.html'
        if not p.exists():
            print('missing', name, file=sys.stderr)
            continue
        root = parse(p)
        CUR['page'] = name
        title = text_of(find(root, 'title') or N('t', [], None))
        title = re.sub(r'\s*[|—–-]\s*AUZslab.*$', '', title).strip() or name
        m = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', p.read_text(encoding='utf-8'))
        desc = html.unescape(m.group(1)) if m else ''
        main_n = find(root, 'main')
        out = []
        if main_n:
            for k in main_n.kids:
                blocks(k, out, set())
        secs = demote(clean(flatten(out)))
        data[name] = {'title': title, 'desc': desc, 'secs': secs}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('wrote', OUT, OUT.stat().st_size, 'bytes,', len(data), 'pages')


if __name__ == '__main__':
    main()
