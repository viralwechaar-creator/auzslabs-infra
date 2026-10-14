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
import 'guest.dart';
import 'home.dart' show HubHome;
import 'mk.dart' show toast, Sel;
import 'mkt.dart';
import 'site_forms.dart';
import 'sticky.dart';

part 'nodes.dart';

const supportPhone = '+919251250829';
const supportMail = 'helloauzslab@gmail.com';

/// The website stacks its sections as rounded sheets that slide over each other. The app shows them as plain bands that scroll one after
/// the other: no rounded tops, edge lines, shadows, overlap or big tab word, and a normal gap above the section.
Map<String, dynamic> _plainSheet(Map<String, dynamic> root) {
  final st = Map<String, dynamic>.from((root['s'] as Map?) ?? const {});
  // the edge lines stay (they take 1px each from the width the content was measured in) but are made invisible
  final bd = st['bd'];
  if (bd is Map) {
    st['bd'] = {for (final e in bd.entries) e.key: e.value is List && (e.value as List).length >= 3 ? [(e.value as List)[0], '00000000', (e.value as List)[2]] : e.value};
  }
  for (final k in ['r', 'sh', 'mt']) {
    st.remove(k);
  }
  final pad = st['p'];
  if (pad is List && pad.length == 4 && pad[0] is num && (pad[0] as num) > 56) st['p'] = [56, pad[1], pad[2], pad[3]];
  final kids = root['c'];
  return {
    ...root,
    's': st,
    if (kids is List) 'c': [for (final c in kids) if (!(c is Map && c['abs'] != null && c['k'] == 't')) c],
  };
}

/// A stacked sheet of the website: a rounded, shadowed panel (or the plain page behind them).
bool _isSheetRoot(Map<String, dynamic> root) {
  final st = _s(root);
  return st['r'] != null || st['sh'] != null;
}

/// A sheet keeps its look (rounded top, edge lines, shadow, big tab word) and gets the website's grid paper as its background
/// (the website paints the grid with a CSS gradient, which the extractor cannot carry).
Map<String, dynamic> _sheetRoot(Map<String, dynamic> root) {
  final st = Map<String, dynamic>.from(_s(root));
  if (_isSheetRoot(root)) {
    if (st['bg'] == null || '${st['bg']}'.isEmpty) st['bg'] = 'faf9f7';
  }
  st.remove('mt');
  return {...root, 'sheet': _isSheetRoot(root), 's': st};
}

/// The website's stacked pages (home, contact) give every sheet a full screen and start the stack 40px below the bar.
bool _fullScreenSheets(List<Map<String, dynamic>> secs) =>
    secs.any((x) => x['hr'] != 1 && const [76, 128, 150, 160, 190].contains(_padOf(_s((x['n'] as Map).cast<String, dynamic>()))[0].round()));

/// Empty padded boxes are the website's forms and widgets whose insides are not drawn here (the app has its own native forms):
/// they would show as blank cards.
bool _blankBox(dynamic n) {
  if (n is! Map || n['k'] != 'b' || n['h'] != null) return false;
  final c = n['c'];
  if (c is List && c.isNotEmpty) return false;
  final st = n['s'];
  final pad = st is Map ? st['p'] : null;
  return pad is List && pad.any((e) => e is num && e > 0);
}

/// Text of a node tree (to recognise a section that only holds the website's footer word).
String _plainText(dynamic n) {
  if (n is! Map) return '';
  final b = StringBuffer();
  if (n['k'] == 't') {
    for (final r in (n['r'] as List? ?? const [])) {
      b.write(r is Map ? '${r['x'] ?? ''}' : '');
    }
  }
  for (final c in (n['c'] as List? ?? const [])) {
    b.write(_plainText(c));
  }
  for (final k in ['hd', 'bd']) {
    b.write(_plainText(n[k]));
  }
  return b.toString().trim();
}

/// A node without its blank boxes (children are rebuilt only where something was removed).
Map<String, dynamic> _tidy(Map<String, dynamic> n) {
  final c = n['c'];
  if (c is! List || c.isEmpty) return n;
  var changed = false;
  final out = <dynamic>[];
  for (final k in c) {
    if (_blankBox(k)) {
      changed = true;
      continue;
    }
    if (k is Map<String, dynamic>) {
      final t = _tidy(k);
      if (!identical(t, k)) changed = true;
      out.add(t);
    } else {
      out.add(k);
    }
  }
  return changed ? {...n, 'c': out} : n;
}

/// The sections of a page that the app draws: without the website's own footer sheet (the app has its footer) or empty ones.
List<Map<String, dynamic>> _sectionsFor(Map<String, dynamic>? p) {
  final out = <Map<String, dynamic>>[];
  for (final x in ((p?['secs'] as List?) ?? const [])) {
    final sec = x as Map<String, dynamic>;
    if (sec['hr'] == 1) {
      out.add(sec);
      continue;
    }
    final root = (sec['n'] as Map?)?.cast<String, dynamic>();
    if (root == null) continue;
    final kids = root['c'];
    if (kids is! List || kids.isEmpty) continue; // an empty section
    if (_plainText(root) == 'CONNECT') continue; // the website's footer sheet
    if (_plainText(root).isEmpty && !_hasArt(root)) continue;
    out.add({...sec, 'n': _tidy(root)});
  }
  return out;
}

/// A section with no words may still be art (an image or drawing).
bool _hasArt(dynamic n) {
  if (n is! Map) return false;
  if (n['k'] == 'v' || n['k'] == 'i') return true;
  for (final c in (n['c'] as List? ?? const [])) {
    if (_hasArt(c)) return true;
  }
  return false;
}

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
      if (s.signedIn) {
        await go(AccountPage(s));
      } else {
        await openLogin(c, s, tab: href.contains('signup') ? 1 : 0);
      }
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
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(valueListenable: MktDark.on, builder: (ctx, _, _) => _page(ctx));

  Widget _page(BuildContext context) {
    final p = page;
    final secs = _sectionsFor(p);
    final flatMode = (p?['mode'] ?? 'flat') != 'stack';
    final sheets = secs.where((x) => x['hr'] != 1 && _isSheetRoot((x['n'] as Map).cast<String, dynamic>())).length;
    final stacked = sheets >= 2;
    final mq = MediaQuery.of(context);
    final scale = ResponsivePage.scaleFor(mq.size.width);
    final lw = (mq.size.width / scale).clamp(0.0, 600.0).toDouble();
    Widget body;
    if (missing) {
      body = Padding(padding: const EdgeInsets.all(32), child: fw.Text('This page is not available in the app yet.', style: inter(15, color: M.dim)));
    } else if (p == null) {
      body = const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator(color: Color(0xFF800020))));
    } else {
      final children = <Widget>[];
      for (var i = 0; i < secs.length; i++) {
        final sec = secs[i];
        final id = sec['id'] as String?;
        Widget w;
        var mt = 0.0;
        var sticky = true;
        if (sec['hr'] == 1) {
          sticky = false;
          w = const Padding(padding: EdgeInsets.symmetric(horizontal: 22, vertical: 4), child: _Dashed());
        } else {
          var root = (sec['n'] as Map).cast<String, dynamic>();
          if (stacked) {
            mt = _n(_s(root)['mt']);
            root = _sheetRoot(root);
          } else {
            root = _plainSheet(root);
          }
          w = SectionView(root);
        }
        if (id != null) w = KeyedSubtree(key: keyFor(id), child: w);
        children.add(stacked ? StickyChild(mt: mt, sticky: sticky, child: RepaintBoundary(child: w)) : w);
      }
      if (widget.name == 'contact') children.add(stacked ? StickyChild(mt: 0, sticky: false, child: ContactForm(widget.s)) : ContactForm(widget.s));
      if (widget.name == 'join-team') children.add(stacked ? StickyChild(mt: 0, sticky: false, child: JoinForm(widget.s)) : JoinForm(widget.s));
      children.add(stacked ? StickyChild(mt: 0, sticky: false, child: SiteFooter(widget.s)) : SiteFooter(widget.s));
      if (stacked) {
        // the website gives each of these sheets a full screen (min-height: 100svh)
        final full = _fullScreenSheets(secs);
        final head = (74 + mq.padding.top) / scale;
        body = ResponsivePage(
          child: StickySheets(repaint: scroll, pinBase: head + 30, step: (lw * .068).clamp(24.0, 55.0).toDouble(), minH: full ? mq.size.height / scale : 0, children: children),
        );
      } else {
        body = ResponsivePage(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children));
      }
    }
    final env = _Env(s: widget.s, pricing: pricing, open: _open, keyFor: keyFor, dark: false, flat: flatMode, child: body);
    return Theme(
      data: marketingTheme(),
      child: Scaffold(
        backgroundColor: M.page,
        body: DefaultTextStyle(
          style: inter(13.5, color: M.dim),
          child: Stack(children: [
            Positioned.fill(child: CustomPaint(painter: PaperGrid())),
            Positioned.fill(child: ListView(controller: scroll, padding: EdgeInsets.only(top: mq.padding.top), children: [SizedBox(height: _n(page?['top']) + (stacked && _fullScreenSheets(secs) ? 40 : 0)), env])),
            Positioned(top: 0, left: 0, right: 0, child: MktHeader(widget.s, back: !widget.top)),
            if (widget.name != 'contact' && widget.name != 'join-team') Positioned(right: 20, bottom: 22 + mq.padding.bottom, child: KnockButton(widget.s)),
          ]),
        ),
      ),
    );
  }
}

/// The website's top bar: pixel wordmark, the light / dark switch, GET STARTED (MY APPS once signed in) and MENU.
class MktHeader extends StatelessWidget {
  const MktHeader(this.s, {this.back = false, super.key});
  final HubSession s;
  final bool back;
  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
        valueListenable: MktDark.on,
        builder: (context, dark, _) => Container(
          height: 74 + MediaQuery.paddingOf(context).top,
          padding: EdgeInsets.fromLTRB(back ? 0 : 16, MediaQuery.paddingOf(context).top, 14, 0),
          decoration: BoxDecoration(color: M.bar, border: Border(bottom: BorderSide(color: M.lineSoft))),
          child: Row(children: [
            if (back) IconButton(onPressed: () => Navigator.maybePop(context), icon: Icon(Icons.chevron_left, color: M.ink, size: 28)),
            Flexible(
              child: GestureDetector(
                onTap: () => Navigator.of(context).popUntil((r) => r.isFirst),
                child: Image.asset('assets/site/logo.png', height: 34, fit: BoxFit.contain, alignment: Alignment.centerLeft, color: dark ? M.ink : null, colorBlendMode: dark ? BlendMode.srcIn : null),
              ),
            ),
            const SizedBox(width: 6),
            const MktSwitch(),
            const SizedBox(width: 4),
            ListenableBuilder(
              listenable: s,
              builder: (_, _) => s.signedIn
                  ? Padding(padding: const EdgeInsets.only(right: 6), child: MktPill(s.kind == Kind.customer ? 'ACCOUNT' : 'MY APPS', onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => HubHome(s))), dim: true))
                  : Padding(padding: const EdgeInsets.only(right: 6), child: MktPill('GET STARTED', onTap: () => openLogin(context, s, tab: 1), dim: true)),
            ),
            MktPill('MENU', onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => SiteDrawerPage(s)))),
          ]),
        ),
      );
}

/// The website's round light / dark switch.
class MktSwitch extends StatelessWidget {
  const MktSwitch({super.key});
  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
        valueListenable: MktDark.on,
        builder: (context, on, _) => Semantics(
          button: true,
          toggled: on,
          label: 'Dark mode',
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: MktDark.toggle,
            child: SizedBox(
              width: 54,
              height: 44,
              child: Center(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: 42,
                  height: 24,
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(20), border: Border.all(color: M.ink, width: 1.4), color: on ? M.ink.withValues(alpha: .12) : Colors.transparent),
                  child: AnimatedAlign(
                    duration: const Duration(milliseconds: 200),
                    curve: Curves.easeOut,
                    alignment: on ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(width: 16, height: 16, decoration: BoxDecoration(shape: BoxShape.circle, color: M.ink)),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
}

/// "Knock, we'll answer": the floating button of the website; it opens the contact form.
class KnockButton extends StatelessWidget {
  const KnockButton(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => Material(
        color: M.wine,
        elevation: 6,
        shadowColor: const Color(0x66000000),
        borderRadius: BorderRadius.circular(40),
        child: InkWell(
          borderRadius: BorderRadius.circular(40),
          onTap: () => showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            useSafeArea: true,
            backgroundColor: M.page,
            shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
            builder: (ctx) => Theme(
              data: marketingTheme(),
              child: DraggableScrollableSheet(
                expand: false,
                initialChildSize: .92,
                maxChildSize: .96,
                builder: (_, c) => ListView(controller: c, padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom + 24), children: [
                  Padding(padding: const EdgeInsets.fromLTRB(24, 22, 24, 0), child: fw.Text("TELL US HOW YOUR BUSINESS WORKS", style: mono(10.5, color: M.dim, ls: 1))),
                  ContactForm(s),
                ]),
              ),
            ),
          ),
          child: Container(
            height: 52,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.back_hand_outlined, color: M.onInk, size: 18),
              const SizedBox(width: 10),
              fw.Text("KNOCK, WE'LL ANSWER", style: mono(11, color: M.onInk, ls: .6)),
            ]),
          ),
        ),
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

BoxDecoration _cardDeco() => BoxDecoration(color: M.card, border: Border.all(color: M.line), borderRadius: BorderRadius.circular(22), boxShadow: const [M.shadow]);
/// The bundle cards, from the database (the website builds the same cards from the same functions).
class BundleCards extends StatelessWidget {
  const BundleCards({super.key});
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final pr = env.pricing;
    if (pr == null) return Padding(padding: const EdgeInsets.all(16), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: M.wine))));
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
              decoration: BoxDecoration(color: M.card, border: Border.all(color: hot ? M.wine : M.line, width: hot ? 2 : 1), borderRadius: BorderRadius.circular(22), boxShadow: hot ? [BoxShadow(color: M.wine, offset: const Offset(5, 5))] : const [M.shadow]),
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
      color: prev,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(24, 36, 24, 40),
        decoration: const BoxDecoration(color: M.inkBg),
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
      color: M.inkBg,
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
  Widget build(BuildContext context) => Theme(data: marketingTheme(), child: Scaffold(backgroundColor: M.inkBg, body: DefaultTextStyle(style: inter(14, color: M.onInk), child: SiteMenu(s, onClose: () => Navigator.pop(context)))));
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
