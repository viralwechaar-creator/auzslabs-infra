import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/material.dart' as fw show Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/orderdata.dart';
import '../core/session.dart';
import '../core/site.dart';
import 'account.dart';
import 'cart.dart';
import 'mk.dart' show toast, Sel;
import 'mkt.dart';
import 'site_forms.dart';

part 'nodes.dart';

const supportPhone = '+919251250829';
const supportMail = 'helloauzslab@gmail.com';

/// What every block of a page needs: the session, the prices, the link handler and the section colour.
class _Env extends InheritedWidget {
  const _Env({required this.s, required this.pricing, required this.open, required this.keyFor, required this.dark, this.card = false, this.flat = false, required super.child});
  final HubSession s;
  final PricingData? pricing;
  final void Function(BuildContext, String) open;
  final GlobalKey Function(String) keyFor;
  final bool dark;
  /// Inside a white card (smaller text, always dark ink on white).
  final bool card;
  /// A flat page (no stacked sheets): bigger hero title.
  final bool flat;
  static _Env of(BuildContext c) => c.dependOnInheritedWidgetOfExactType<_Env>()!;
  _Env with_({bool? dark, bool? card, required Widget child}) => _Env(s: s, pricing: pricing, open: open, keyFor: keyFor, dark: dark ?? this.dark, card: card ?? this.card, flat: flat, child: child);
  @override
  bool updateShouldNotify(_Env o) => o.pricing != pricing || o.dark != dark || o.card != card;
}


/// Opens a website link inside the app (a page, the cart, the account) or outside it (phone, mail, other sites).
Future<void> openSiteLink(BuildContext c, HubSession s, String href, {void Function(String)? onAnchor, bool replace = false}) async {
  final known = SiteData.peek()?.pages.keys.toSet() ?? <String>{};
  final l = resolveHref(href, known: known);
  Future<void> go(Widget w) async {
    final r = MaterialPageRoute<void>(builder: (_) => w);
    if (replace) {
      await Navigator.pushReplacement(c, r);
    } else {
      await Navigator.push(c, r);
    }
  }

  switch (l.kind) {
    case 'anchor':
      onAnchor?.call(l.anchor ?? '');
    case 'page':
      if (l.page == 'index') {
        Navigator.of(c).popUntil((r) => r.isFirst);
      } else {
        await go(SitePage(s, l.page, anchor: l.anchor));
      }
    case 'cart':
      await go(CartPage(s));
    case 'account':
      await go(AccountPage(s));
    case 'external':
    case 'web':
      await launchUrl(Uri.parse(l.url), mode: LaunchMode.externalApplication);
    default:
  }
}

/// One page of the website, drawn natively from the extracted page data in the website's own look.
class SitePage extends StatefulWidget {
  const SitePage(this.s, this.name, {this.anchor, this.top = false, super.key});
  final HubSession s;
  final String name;
  final String? anchor;
  /// A page that sits in the bottom bar (no back arrow).
  final bool top;
  @override
  State<SitePage> createState() => _SitePageState();
}

class _SitePageState extends State<SitePage> {
  Map<String, dynamic>? page;
  PricingData? pricing;
  final keys = <String, GlobalKey>{};
  final scroll = ScrollController();
  bool missing = false;

  GlobalKey keyFor(String id) => keys.putIfAbsent(id, () => GlobalKey());

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    scroll.dispose();
    super.dispose();
  }

  bool _needsPrices(Map<String, dynamic> p) {
    var yes = false;
    void walk(dynamic x) {
      if (x is Map) {
        if (x['pc'] != null || x['k'] == 'x') yes = true;
        x.values.forEach(walk);
      } else if (x is List) {
        x.forEach(walk);
      }
    }
    walk(p['secs']);
    return yes;
  }

  Future<void> _load() async {
    final d = await SiteData.load();
    final p = d.page(widget.name);
    if (!mounted) return;
    setState(() {
      page = p;
      missing = p == null;
    });
    if (p != null && _needsPrices(p)) {
      try {
        final r = await Future.wait([widget.s.api.rpc('public_product_prices'), widget.s.api.rpc('public_bundles'), widget.s.api.rpc('public_addon_price_overrides')]);
        if (mounted) setState(() => pricing = PricingData.from(r[0], r[1], r[2]));
      } catch (_) {}
    }
    if (widget.anchor != null) WidgetsBinding.instance.addPostFrameCallback((_) => _goto(widget.anchor!));
  }

  void _goto(String id) {
    final c = keys[id]?.currentContext;
    if (c != null) Scrollable.ensureVisible(c, duration: const Duration(milliseconds: 350), curve: Curves.easeOut, alignment: .05);
  }

  void _open(BuildContext c, String href) => openSiteLink(c, widget.s, href, onAnchor: _goto);

  @override
  Widget build(BuildContext context) {
    final p = page;
    final secs = [for (final x in ((p?['secs'] as List?) ?? const [])) x as Map<String, dynamic>];
    final stack = (p?['mode'] ?? 'flat') == 'stack';
    Widget body;
    if (missing) {
      body = Padding(padding: const EdgeInsets.all(32), child: fw.Text('This page is not available in the app yet.', style: inter(15, color: M.dim)));
    } else if (p == null) {
      body = const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator(color: M.wine)));
    } else {
      final children = <Widget>[];
      for (var i = 0; i < secs.length; i++) {
        final sec = secs[i];
        final id = sec['id'] as String?;
        Widget w;
        if (sec['hr'] == 1) {
          w = const Padding(padding: EdgeInsets.symmetric(horizontal: 22, vertical: 4), child: _Dashed());
        } else {
          final root = (sec['n'] as Map).cast<String, dynamic>();
          w = SectionView(root);
          final top = _top(root);
          if (top < 0) w = NegTop(-top, child: w);
        }
        children.add(id == null ? w : KeyedSubtree(key: keyFor(id), child: w));
      }
      if (widget.name == 'contact') children.add(ContactForm(widget.s));
      if (widget.name == 'join-team') children.add(JoinForm(widget.s));
      children.add(SiteFooter(widget.s, prev: stack ? M.bg : Colors.transparent));
      body = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
    }
    final env = _Env(s: widget.s, pricing: pricing, open: _open, keyFor: keyFor, dark: false, flat: !stack, child: body);
    return Scaffold(
      backgroundColor: M.page,
      body: DefaultTextStyle(
        style: inter(13.5, color: M.dim),
        child: Stack(children: [
          const Positioned.fill(child: CustomPaint(painter: PaperGrid())),
          Positioned.fill(child: ListView(controller: scroll, padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top), children: [SizedBox(height: _n(page?['top'])), env])),
          Positioned(top: 0, left: 0, right: 0, child: MktHeader(widget.s, back: !widget.top)),
        ]),
      ),
    );
  }
}

/// The website's top bar: pixel wordmark, GET STARTED and MENU.
class MktHeader extends StatelessWidget {
  const MktHeader(this.s, {this.back = false, super.key});
  final HubSession s;
  final bool back;
  @override
  Widget build(BuildContext context) => Container(
        height: 74 + MediaQuery.paddingOf(context).top,
        padding: EdgeInsets.fromLTRB(back ? 4 : 18, MediaQuery.paddingOf(context).top, 16, 0),
        decoration: const BoxDecoration(color: Color(0xF2F6F4F1), border: Border(bottom: BorderSide(color: M.lineSoft))),
        child: Row(children: [
          if (back) IconButton(onPressed: () => Navigator.maybePop(context), icon: const Icon(Icons.chevron_left, color: M.ink, size: 28)),
          GestureDetector(onTap: () => Navigator.of(context).popUntil((r) => r.isFirst), child: Image.asset('assets/site/logo.png', height: 38)),
          const Spacer(),
          MktPill('GET STARTED', onTap: () => openSiteLink(context, s, 'signup.html'), dim: true),
          const SizedBox(width: 8),
          MktPill('MENU', onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => SiteDrawerPage(s)))),
        ]),
      );
}

class MktPill extends StatelessWidget {
  const MktPill(this.label, {required this.onTap, this.dim = false, this.onInk = false, this.fill = false, super.key});
  final String label;
  final VoidCallback onTap;
  final bool dim, onInk, fill;
  @override
  Widget build(BuildContext context) {
    final fg = fill ? M.onInk : (onInk ? M.onInk : (dim ? M.dim : M.ink));
    return Row(mainAxisSize: MainAxisSize.min, children: [
      InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(30),
        child: Container(
          height: 44,
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          decoration: BoxDecoration(color: fill ? M.wine : Colors.transparent, borderRadius: BorderRadius.circular(30), border: Border.all(color: fill ? M.wine : (onInk ? const Color(0x66FFFFFF) : (dim ? M.line : M.ink)), width: 1)),
          child: fw.Text(label, style: mono(10.5, color: fg, ls: .6)),
        ),
      ),
    ]);
  }
}

/// A flat-page section: plain paper with a dashed rule between sections.
class _Dashed extends StatelessWidget {
  const _Dashed();
  @override
  Widget build(BuildContext context) => SizedBox(height: 2, width: double.infinity, child: CustomPaint(painter: _DashPainter()));
}

class _DashPainter extends CustomPainter {
  @override
  void paint(Canvas c, Size s) {
    final p = Paint()
      ..color = const Color(0x3D2E2C2A)
      ..strokeWidth = 2;
    for (double x = 0; x < s.width; x += 10) {
      c.drawLine(Offset(x, 1), Offset(x + 5, 1), p);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter o) => false;
}

BoxDecoration _cardDeco() => BoxDecoration(color: Colors.white, border: Border.all(color: M.line), borderRadius: BorderRadius.circular(22), boxShadow: const [M.shadow]);
/// The bundle cards, from the database (the website builds the same cards from the same functions).
class BundleCards extends StatelessWidget {
  const BundleCards({super.key});
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final pr = env.pricing;
    if (pr == null) return const Padding(padding: EdgeInsets.all(16), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: M.wine))));
    if (pr.bundles.isEmpty) return fw.Text('Bundle prices are not available right now.', style: inter(13, color: M.dim));
    return LayoutBuilder(builder: (_, cs) {
      final cols = cs.maxWidth >= 700 ? 2 : 1;
      final w = cols == 1 ? cs.maxWidth : (cs.maxWidth - 12) / cols;
      return Wrap(spacing: 12, runSpacing: 12, children: [
        for (final bd in pr.bundles)
          Builder(builder: (_) {
            final m = pr.n(bd['monthly_price']), list = pr.n(bd['list_price']), y = pr.n(bd['yearly_price']);
            final keys = [for (final k in (bd['feature_keys'] as List? ?? const [])) '$k'];
            final badge = '${bd['badge'] ?? ''}';
            final hot = badge.toLowerCase().contains('popular');
            return Container(
              width: w,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: Colors.white, border: Border.all(color: hot ? M.wine : M.line, width: hot ? 2 : 1), borderRadius: BorderRadius.circular(22), boxShadow: hot ? const [BoxShadow(color: M.wine, offset: Offset(5, 5))] : const [M.shadow]),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [for (final k in keys) if (planIcons[k] != null) Padding(padding: const EdgeInsets.only(right: 8), child: ClipRRect(borderRadius: BorderRadius.circular(9), child: Image.asset(planIcons[k]!, width: 36, height: 36)))]),
                if (badge.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Container(padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4), decoration: BoxDecoration(color: (hot ? M.wine : M.ink).withValues(alpha: .1), borderRadius: BorderRadius.circular(20)), child: fw.Text(badge, style: mono(10, color: hot ? M.wine : M.ink, ls: .2)))),
                Padding(padding: const EdgeInsets.only(top: 10), child: fw.Text('${bd['label']}', style: inter(17, w: 600, color: M.ink))),
                const SizedBox(height: 6),
                fw.Text.rich(TextSpan(children: [
                  if (list > m) TextSpan(text: '${inr(list)} ', style: inter(15, color: M.faint).copyWith(decoration: TextDecoration.lineThrough)),
                  TextSpan(text: inr(m), style: inter(30, w: 700, color: M.ink, ls: -.8, h: 1.1)),
                  TextSpan(text: '/month + GST', style: mono(11, color: M.dim, ls: .2)),
                ])),
                if ('${bd['blurb'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: fw.Text('${bd['blurb']}', style: inter(12.5, color: M.dim, h: 1.6))),
                if (list > m) Padding(padding: const EdgeInsets.only(top: 4), child: fw.Text('Save ${inr(list - m)}/month vs. buying separately.', style: inter(12.5, color: M.dim, h: 1.6))),
                if (y > 0) Padding(padding: const EdgeInsets.only(top: 4), child: fw.Text('Or pay ${inr(y)} for the whole year${y < m * 12 ? ' (save ${inr(m * 12 - y)})' : ''}.', style: inter(12.5, color: M.dim, h: 1.6))),
                const SizedBox(height: 16),
                _CartBtn('Get ${badge.isEmpty ? bd['label'] : badge}', keys),
              ]),
            );
          }),
      ]);
    });
  }
}

/// "See exactly what you pay on day one": same sums as the website's calculator and the quote.
class FirstBill extends StatefulWidget {
  const FirstBill({super.key});
  @override
  State<FirstBill> createState() => _FirstBillState();
}

class _FirstBillState extends State<FirstBill> {
  String? key;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final pr = env.pricing;
    final list = pr == null ? <String>[] : [for (final k in planIcons.keys) if (pr.monthlyOf(k) > 0) k];
    if (pr == null || list.isEmpty) return const SizedBox.shrink();
    final k = list.contains(key) ? key! : list.first;
    final sub = pr.monthlyOf(k);
    final gst = pr.gstExempt(k) ? 0.0 : (sub * 18).round() / 100;
    final setup = pr.setupExempt(k) ? 0 : 2190;
    const onboarding = 1460;
    Widget row(String a, String b, {bool bold = false}) => Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(children: [Expanded(child: fw.Text(a, style: inter(13, w: bold ? 700 : 400, color: bold ? M.ink : M.dim))), fw.Text(b, style: mono(12.5, bold: bold, color: M.ink, ls: 0))]));
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: _cardDeco(),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        fw.Text('See exactly what you pay on day one', style: inter(17, w: 600, color: M.ink)),
        const SizedBox(height: 12),
        Sel('Product', k, [for (final x in list) (x, '${productLabels[x] ?? x} (${inr(pr.monthlyOf(x))}/month)')], (v) => setState(() => key = v)),
        const SizedBox(height: 8),
        row('Subscription, first month', inr(sub)),
        if (gst > 0) row('GST (18%)', inr(gst)),
        row('Onboarding fee (no GST)', inr(onboarding)),
        if (setup > 0) row('Setup fee (no GST)', inr(setup)),
        const Divider(),
        row('Pay today', inr(sub + gst + setup + onboarding), bold: true),
        row('Every month after that', inr(sub + gst)),
        fw.Text('GST is 18% on the subscription only. The onboarding fee and setup fee have no GST.', style: inter(12, color: M.dim, h: 1.6)),
      ]),
    );
  }
}

/// Bottom of every page: the dark CONNECT sheet.
class SiteFooter extends StatelessWidget {
  const SiteFooter(this.s, {this.prev = Colors.transparent, super.key});
  final HubSession s;
  final Color prev;
  @override
  Widget build(BuildContext context) {
    Widget link(String label, String page) => InkWell(onTap: () => openSiteLink(context, s, '$page.html'), child: Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: fw.Text(label, style: inter(13, color: M.onInk))));
    Widget col(String title, List<(String, String)> items) => Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [fw.Text(title.toUpperCase(), style: mono(10, color: M.onInkFaint, ls: 1)), const SizedBox(height: 8), for (final i in items) link(i.$1, i.$2)]));
    return Container(
      margin: const EdgeInsets.only(top: 14),
      color: prev,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(24, 10, 24, 40),
        decoration: const BoxDecoration(color: M.ink, borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          fw.Text('CONNECT', style: inter(58, w: 800, color: M.onInk, ls: -2.4, h: 1.0)),
          const SizedBox(height: 44),
          fw.Text('AUZslab', style: inter(20, color: M.onInk, w: 500)),
          const SizedBox(height: 8),
          fw.Text('Business software built around the way you work.', style: inter(13, color: M.onInkDim, h: 1.6)),
          const SizedBox(height: 14),
          InkWell(onTap: () => launchUrl(Uri.parse('tel:$supportPhone')), child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: fw.Text('+91 92512 50829', style: mono(13, bold: true, color: M.onInk, ls: .3)))),
          InkWell(onTap: () => launchUrl(Uri.parse('mailto:$supportMail')), child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: fw.Text(supportMail, style: inter(13, color: M.onInk)))),
          const SizedBox(height: 18),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            col('Products', const [('AUZsPOS', 'pos'), ('AUZsPay', 'payroll'), ('AUZsLedger', 'accounting'), ('AUZsScan', 'scan-and-bill'), ('AUZsMob', 'products'), ('All products', 'products')]),
            col('Company', const [('Pricing', 'pricing'), ('Live demo', 'live-demo'), ('Contact', 'contact'), ('Join our team', 'join-team'), ('Sign in', 'signup')]),
          ]),
          const SizedBox(height: 16),
          Container(height: 1, color: const Color(0x1FFFFFFF)),
          const SizedBox(height: 10),
          Wrap(spacing: 18, children: [
            for (final i in const [('Terms', 'terms'), ('Privacy', 'privacy'), ('Refunds', 'refund'), ('Sitemap', 'sitemap')]) InkWell(onTap: () => openSiteLink(context, s, '${i.$2}.html'), child: Padding(padding: const EdgeInsets.symmetric(vertical: 10), child: fw.Text(i.$1, style: inter(12, color: M.onInkDim)))),
            InkWell(onTap: () => launchUrl(Uri.parse('https://www.instagram.com/auzslab.in'), mode: LaunchMode.externalApplication), child: Padding(padding: const EdgeInsets.symmetric(vertical: 10), child: fw.Text('Instagram', style: inter(12, color: M.onInkDim)))),
            InkWell(onTap: () => launchUrl(Uri.parse('https://www.facebook.com/share/1FMd3FoFyZ/?mibextid=wwXIfr'), mode: LaunchMode.externalApplication), child: Padding(padding: const EdgeInsets.symmetric(vertical: 10), child: fw.Text('Facebook', style: inter(12, color: M.onInkDim)))),
          ]),
          fw.Text('© 2026 AUZslab', style: mono(10, color: M.onInkFaint, ls: .2)),
        ]),
      ),
    );
  }
}

/// The website's dark drawer menu (Home, Products (+8), Business types (+5), ...), as the Menu tab and as a page opened by MENU.
class SiteMenu extends StatefulWidget {
  const SiteMenu(this.s, {this.onClose, super.key});
  final HubSession s;
  final VoidCallback? onClose;
  @override
  State<SiteMenu> createState() => _SiteMenuState();
}

class _SiteMenuState extends State<SiteMenu> {
  final open = <String>{};
  void _go(NavEntry e) {
    final href = e.cart ? 'cart.html' : '${e.page}.html${e.anchor == null ? '' : '#${e.anchor}'}';
    openSiteLink(context, widget.s, href, replace: widget.onClose != null);
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    return Container(
      color: M.ink,
      child: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(22, 10, 22, 30), children: [
          Row(children: [
            if (widget.onClose != null) InkWell(onTap: widget.onClose, borderRadius: BorderRadius.circular(30), child: Container(constraints: const BoxConstraints(minHeight: 44), alignment: Alignment.center, padding: const EdgeInsets.symmetric(horizontal: 16), decoration: BoxDecoration(border: Border.all(color: const Color(0x66FFFFFF)), borderRadius: BorderRadius.circular(30)), child: fw.Text('× CLOSE', style: mono(10.5, color: M.onInk, ls: .6)))),
            const Spacer(),
            Image.asset('assets/site/logo.png', height: 28, color: M.onInk, colorBlendMode: BlendMode.srcIn),
          ]),
          const SizedBox(height: 18),
          for (final e in siteNav) ...[
            if (e.kids.isEmpty)
              InkWell(onTap: () => _go(e), child: Container(constraints: const BoxConstraints(minHeight: 52), alignment: Alignment.centerLeft, decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x1FFFFFFF)))), child: fw.Text(e.label, style: inter(16, w: 600, color: M.onInk, ls: -.1))))
            else ...[
              InkWell(
                onTap: () => setState(() => open.contains(e.label) ? open.remove(e.label) : open.add(e.label)),
                child: Container(
                  constraints: const BoxConstraints(minHeight: 52),
                  alignment: Alignment.centerLeft,
                  decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x1FFFFFFF)))),
                  child: Row(children: [
                    Expanded(child: fw.Text.rich(TextSpan(children: [TextSpan(text: e.label, style: inter(16, w: 600, color: M.onInk, ls: -.1)), TextSpan(text: '  (+${e.kids.length})', style: inter(11, color: M.onInkFaint))]))),
                    fw.Text(open.contains(e.label) ? '−' : '+', style: inter(20, color: M.onInkFaint)),
                  ]),
                ),
              ),
              if (open.contains(e.label))
                for (final k in e.kids) InkWell(onTap: () => _go(k), child: Container(constraints: const BoxConstraints(minHeight: 46), alignment: Alignment.centerLeft, padding: const EdgeInsets.only(left: 14), child: fw.Text(k.label, style: inter(14.5, w: 500, color: M.onInkDim)))),
            ],
          ],
          const SizedBox(height: 22),
          Row(children: [
            Expanded(child: MktPill('GET STARTED', onInk: true, onTap: () => openSiteLink(context, s, 'signup.html', replace: widget.onClose != null))),
            const SizedBox(width: 10),
            Expanded(child: MktPill("LET'S TALK", onInk: true, onTap: () => openSiteLink(context, s, 'contact.html', replace: widget.onClose != null))),
          ]),
          const SizedBox(height: 18),
          InkWell(onTap: () => openSiteLink(context, s, 'creatopz.html', replace: widget.onClose != null), child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: fw.Text('Marketing partner: Creatopz', style: inter(12, color: M.onInkDim).copyWith(decoration: TextDecoration.underline)))),
          fw.Text('© 2026 AUZslab', style: mono(10, color: M.onInkFaint, ls: .2)),
        ]),
      ),
    );
  }
}

/// The menu opened from the MENU button on a page.
class SiteDrawerPage extends StatelessWidget {
  const SiteDrawerPage(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => Scaffold(backgroundColor: M.ink, body: DefaultTextStyle(style: inter(14, color: M.onInk), child: SiteMenu(s, onClose: () => Navigator.pop(context))));
}


/// "Add to cart" pill used by the live bundle cards.
class _CartBtn extends StatefulWidget {
  const _CartBtn(this.label, this.keys);
  final String label;
  final List<String> keys;
  @override
  State<_CartBtn> createState() => _CartBtnState();
}

class _CartBtnState extends State<_CartBtn> {
  bool added = false;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      GestureDetector(
        onTap: () async {
          if (added) return env.open(context, 'cart.html');
          await Cart.add(widget.keys);
          if (!mounted) return;
          setState(() => added = true);
          toast(context, 'Added to your cart.');
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 13),
          decoration: BoxDecoration(color: M.wine, borderRadius: BorderRadius.circular(999), border: Border.all(color: M.wine)),
          child: fw.Text((added ? 'Added. View cart' : widget.label).toUpperCase(), style: mono(11, color: M.onInk, ls: .44)),
        ),
      ),
    ]);
  }
}
