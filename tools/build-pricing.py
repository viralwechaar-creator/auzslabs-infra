#!/usr/bin/env python3
"""Writes site/pricing.html (indicative pricing). Header, menu, dock and footer are copied from site/contact.html so they always match
the other marketing pages (the side menu is frozen: see CLAUDE.md). Prices are INDICATIVE, set in PLANS below; the real quote is built in Admin."""
import re, os, html
ROOT = os.path.join(os.path.dirname(__file__), '..'); SITE = os.path.join(ROOT, 'site')
TITLE = 'Pricing | AUZslab'
DESC = 'Indicative AUZslab pricing for POS, accounting, payroll, salon and mobile-shop software. Every business gets a written quote after we review what you need.'

PLANS = [
  ('AUZsPOS', 'Billing, tables, kitchen, CRM and stock for cafes, restaurants and shops.', '1,090', '10,900', 'cart.html?add=pos'),
  ('AUZsPOS + QR ordering', 'Everything in AUZsPOS plus guests ordering from a table QR or your site.', '1,490', '14,900', 'cart.html?add=self_order'),
  ('AUZsLedger', 'Double-entry accounting, GST, bills, banking and reports.', '1,490', '14,900', 'cart.html?add=accounting'),
  ('AUZsPay', 'Payroll, attendance, leave and payslips for your team.', '590', '5,900', 'cart.html?add=payroll'),
  ('AUZslab Salon', 'Bookings, billing, staff and a branded website for salons and studios.', '1,490', '14,900', 'cart.html?add=salon'),
  ('AUZsMob', 'Phone sales, purchases, repairs and IMEI stock for mobile shops. No GST, no setup fee.', '249', '2,490', 'cart.html?add=mobile'),
]
BUNDLES = [
  ('Hospitality Essentials', 'AUZsPOS + AUZsPay', '1,490'),
  ('Digital Restaurant', 'AUZsPOS + QR ordering + AUZsPay', '1,990'),
  ('Retail Operations', 'AUZsLedger + AUZsPay', '1,790'),
]
FAQ = [
  ('Are these the final prices?', 'They are indicative starting prices per business per month, before GST. After you send a request we check your setup and send a written quote. That quote is what you pay.'),
  ('Is there a setup cost?', 'There is a one-time onboarding fee for a new business (currently shown on your quote). AUZsMob and AUZsScan are quoted without GST or a setup fee.'),
  ('Can I pay yearly?', 'Yes. Yearly plans are priced at ten months. Tell us on the request page and your quote will show it.'),
  ('Can I add or remove products later?', 'Yes. Add a product from your account any time and we send an updated quote. Your data stays in place.'),
  ('What about custom software or hardware?', 'Studio projects, website builds, printers and scanners are quoted per project. Contact us and describe what you need.'),
]

def card(n, d, m, y, href):
    return ('<article class="pr-card rv"><h3>%s</h3><p>%s</p><div class="pr-price"><span class="pr-cur">&#8377;</span><b>%s</b><small>/ month</small></div>'
            '<div class="pr-yr">or &#8377;%s a year</div><a class="pr-btn" href="%s">Request this</a></article>') % (html.escape(n), html.escape(d), m, y, href)
def bundle(n, d, m):
    return '<div class="pr-bun rv"><div><b>%s</b><span>%s</span></div><div class="pr-bp">&#8377;%s<small>/ month</small></div></div>' % (html.escape(n), html.escape(d), m)

BODY = '''
<div class="pr">
<section class="pr-hero">
<span class="mk-eye">Pricing</span>
<h1 class="pr-h">Clear starting prices. A quote made for you.</h1>
<p class="pr-lede">Pay only for the parts of the ecosystem your business uses. These prices are indicative, per business, before GST. After you ask, we review your setup and send a written quote.</p>
<div class="pr-note">Indicative pricing &middot; final amount confirmed in your quote</div>
</section>
<section class="pr-sec"><h2 class="pr-h2">Products</h2><div class="pr-grid">%(cards)s</div></section>
<section class="pr-sec"><h2 class="pr-h2">Bundles</h2><p class="pr-sub">Two products together for less than buying them separately.</p><div class="pr-buns">%(buns)s</div></section>
<section class="pr-sec pr-two">
<div class="pr-box rv"><h2 class="pr-h2">One-time</h2><ul><li><b>Onboarding</b><span>We set up your business, import your data and train your team. Shown on your quote.</span></li><li><b>Hardware</b><span>Printers, scanners and cash drawers are quoted separately.</span></li><li><b>Custom work</b><span>Studio projects, websites and integrations are quoted per project.</span></li></ul></div>
<div class="pr-box dark rv"><h2 class="pr-h2">Need something specific?</h2><p>Tell us how your business works. We reply within a day with the right setup and a quote.</p><a class="pr-btn inv" href="contact.html">Talk to us</a><a class="pr-btn ghost" href="cart.html">Start a request</a></div>
</section>
<section class="pr-sec"><h2 class="pr-h2">Questions</h2><div class="pr-faq">%(faq)s</div></section>
</div>
'''

CSS = '''<style id="pr-css">
html body.a-pricing main.content .pr{max-width:1180px;margin:0 auto;padding:clamp(24px,5vw,56px) 0 40px}
html body.a-pricing main.content .pr-hero{padding:clamp(18px,4vw,40px) 0 clamp(18px,3vw,30px)}
html body.a-pricing main.content .pr-h{font-size:clamp(34px,6.4vw,64px)!important;line-height:1.02!important;letter-spacing:-.03em!important;margin:10px 0 14px!important;max-width:16ch;font-weight:650!important}
html body.a-pricing main.content .pr-lede{max-width:56ch;font-size:16px!important;line-height:1.6!important;color:#625d58}
html body.a-pricing main.content .pr-note{display:inline-block;margin-top:16px;padding:7px 13px;border:1px dashed #cfc9c3;border-radius:999px;font:700 10.5px 'Space Mono',monospace;letter-spacing:.08em;text-transform:uppercase}
html body.a-pricing main.content .pr-sec{padding:clamp(18px,3vw,32px) 0}
html body.a-pricing main.content .pr-h2{font-size:clamp(22px,3vw,30px)!important;line-height:1.15!important;letter-spacing:-.02em!important;margin:0 0 6px!important;font-weight:650!important}
html body.a-pricing main.content .pr-sub{margin:0 0 16px!important;color:#625d58;font-size:15px!important}
html body.a-pricing main.content .pr-grid{display:grid!important;gap:14px;grid-template-columns:1fr;margin-top:16px}
@media(min-width:640px){html body.a-pricing main.content .pr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(min-width:1000px){html body.a-pricing main.content .pr-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
html body.a-pricing main.content .pr-grid>*{grid-column:auto!important;grid-row:auto!important;width:auto!important;max-width:none!important;min-width:0!important}
html body.a-pricing main.content .pr-card{display:flex!important;flex-direction:column;gap:8px;padding:22px!important;border:1px solid #e2ddd8!important;border-radius:20px!important;background:#fff!important;box-shadow:none!important;margin:0!important}
html body.a-pricing main.content .pr-card h3{margin:0!important;font-size:18px!important;font-weight:650!important}
html body.a-pricing main.content .pr-card p{margin:0!important;font-size:14px!important;line-height:1.5!important;color:#625d58;flex:1}
html body.a-pricing main.content .pr-price{display:flex;align-items:baseline;gap:4px;margin-top:6px}
html body.a-pricing main.content .pr-price b{font-size:36px;letter-spacing:-.03em;font-weight:700}html body.a-pricing main.content .pr-cur{font-size:18px}html body.a-pricing main.content .pr-price small{font-size:12.5px;color:#625d58}
html body.a-pricing main.content .pr-yr{font-size:13px;color:#625d58}
html body.a-pricing main.content .pr-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border-radius:999px;background:#000;color:#fff!important;font-weight:650;font-size:14px;text-decoration:none;margin-top:8px;align-self:flex-start}
html body.a-pricing main.content .pr-btn.inv{background:#fff;color:#000!important}html body.a-pricing main.content .pr-btn.ghost{background:transparent;color:#fff!important;border:1px solid rgba(255,255,255,.4);margin-left:8px}
html body.a-pricing main.content .pr-buns{display:grid;gap:10px}
html body.a-pricing main.content .pr-bun{display:flex!important;justify-content:space-between;align-items:center;gap:16px;padding:18px 22px!important;border:1px solid #e2ddd8!important;border-radius:16px!important;background:#fff!important;flex-wrap:wrap}
html body.a-pricing main.content .pr-bun b{display:block;font-size:16px}html body.a-pricing main.content .pr-bun span{font-size:13.5px;color:#625d58}
html body.a-pricing main.content .pr-bp{font-size:22px;font-weight:700}html body.a-pricing main.content .pr-bp small{font-size:12px;font-weight:500;color:#625d58}
html body.a-pricing main.content .pr-two{display:grid!important;gap:14px;grid-template-columns:1fr}
@media(min-width:860px){html body.a-pricing main.content .pr-two{grid-template-columns:1.2fr 1fr}}
html body.a-pricing main.content .pr-box{padding:26px!important;border:1px solid #e2ddd8!important;border-radius:22px!important;background:#fff!important}
html body.a-pricing main.content .pr-box ul{list-style:none!important;margin:12px 0 0!important;padding:0!important;display:grid;gap:12px}
html body.a-pricing main.content .pr-box li b{display:block;font-size:15px}html body.a-pricing main.content .pr-box li span{font-size:13.5px;color:#625d58;line-height:1.5}
html body.a-pricing main.content .pr-box.dark{background:#000!important;color:#fff;border-color:#000!important}html body.a-pricing main.content .pr-box.dark h2{color:#fff}html body.a-pricing main.content .pr-box.dark p{color:rgba(255,255,255,.75);font-size:14.5px!important;line-height:1.55!important}
html body.a-pricing main.content .pr-faq details{border-top:1px solid #e2ddd8;padding:16px 0}html body.a-pricing main.content .pr-faq details:last-child{border-bottom:1px solid #e2ddd8}
html body.a-pricing main.content .pr-faq summary{cursor:pointer;font-weight:650;font-size:16px}html body.a-pricing main.content .pr-faq p{margin:8px 0 0;font-size:14px;line-height:1.6;color:#625d58;max-width:70ch}
</style>'''

def main():
    s = open(os.path.join(SITE, 'contact.html')).read()
    # head: replace meta, drop contact's own css/links
    s = re.sub(r'<title>.*?</title>', '<title>%s</title>' % TITLE, s, count=1, flags=re.S)
    s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % html.escape(DESC, quote=True), s, count=1)
    s = s.replace('https://auzslab.in/contact.html', 'https://auzslab.in/pricing.html')
    s = re.sub(r'(<meta property="og:title" content=")[^"]*', r'\g<1>' + TITLE, s, count=1)
    s = re.sub(r'(<meta property="og:description" content=")[^"]*', r'\g<1>' + html.escape(DESC, quote=True), s, count=1)
    s = s.replace('<meta name="twitter:card" content="summary">', '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="%s"><meta name="twitter:description" content="%s">' % (TITLE, html.escape(DESC, quote=True)))
    s = re.sub(r'<style(?! id="topbar-nav-css")[^>]*>.*?</style>', '', s, flags=re.S)
    s = re.sub(r'<link rel="stylesheet" href="a-contact\.css[^>]*>', '', s)
    s = s.replace('</head>', CSS + '</head>', 1)
    s = s.replace('<a href="contact.html" class="on">', '<a href="contact.html">').replace('<a href="contact.html" class="nav-link active">', '<a href="contact.html" class="nav-link">')
    s = s.replace('<body class="mk-page a-dark a-contact">', '<body class="mk-page a-pricing">')
    body = BODY % dict(cards=''.join(card(*p) for p in PLANS), buns=''.join(bundle(*b) for b in BUNDLES),
                       faq=''.join('<details><summary>%s</summary><p>%s</p></details>' % (html.escape(q), html.escape(a)) for q, a in FAQ))
    a = s.index('<main class="content">') + len('<main class="content">')
    b = s.index('<div class="ftwrap"')
    s = s[:a] + body + s[b:]
    s = re.sub(r'<script src="contact-hub\.js[^>]*></script>', '', s)
    open(os.path.join(SITE, 'pricing.html'), 'w').write(s)
    print('wrote site/pricing.html', len(s))
main()
