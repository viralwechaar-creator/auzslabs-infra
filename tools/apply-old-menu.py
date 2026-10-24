#!/usr/bin/env python3
"""Puts the ORIGINAL side-menu markup (from the pre-redesign site) into every page, with today's links. Owner rule: never change the menu unless asked."""
import re, glob, subprocess
R = '/home/user/auzslabs-infra'
old = subprocess.run(['git', 'show', 'eb7be68^:site/index.html'], capture_output=True, text=True, cwd=R).stdout
aside = old[old.index('<aside'):old.index('</aside>') + 8]
aside = aside.replace('<a href="index.html" class="nav-link active">Home</a>', '<a href="index.html" class="nav-link">Home</a>\n      <a href="products.html" class="nav-link">Services</a>')
for f in glob.glob(R + '/site/*.html') + glob.glob(R + '/tools/art-src/*.html'):
    h = open(f, encoding='utf-8').read()
    if 'id="sidebarDrawer"' not in h: continue
    n = re.sub(r'<aside class="u-sheet sidebar" id="sidebarDrawer".*?</aside>', lambda m: aside, h, 1, flags=re.S)
    n = n.replace('<link rel="stylesheet" href="m.css?v=2">', '').replace('<link rel="stylesheet" href="m.css?v=1">', '')
    if 'menu-old.css' not in n: n = n.replace('</head>', '<link rel="stylesheet" href="menu-old.css?v=1"></head>', 1)
    # mark the current page in the menu
    name = f.split('/')[-1]
    n = re.sub(r'(<nav class="sidebar-nav".*?</nav>)', lambda m: re.sub(r' class="nav-link active"', ' class="nav-link"', m.group(1)).replace('href="%s" class="nav-link"' % name, 'href="%s" class="nav-link active"' % name, 1), n, 1, flags=re.S)
    open(f, 'w', encoding='utf-8').write(n)
print('done')
