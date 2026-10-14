import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/material.dart' as fw show Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/orderdata.dart';
import '../core/session.dart';
import '../core/site.dart';
import 'account.dart';
import 'cart.dart';
import 'i18n.dart';
import 'mk.dart' show toast, Sel;
import 'mkt.dart';
import 'site_forms.dart';

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

Color _fg(bool dark) => dark ? M.onInk : M.ink;
Color _dim(bool dark) => dark ? M.onInkDim : M.dim;

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
        if (x['t'] == 'plan' || x['t'] == 'live') yes = true;
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
      Color prev = Colors.transparent;
      for (var i = 0; i < secs.length; i++) {
        final sec = secs[i];
        final dark = sec['c'] == 'dark';
        final tone = dark ? M.ink : (i.isOdd && stack || (sec['c'] == 'alt') ? M.raised : M.bg);
        if (stack) {
          children.add(_Sheet(sec, first: i == 0, prev: prev, tone: tone, dark: dark, home: widget.name == 'index'));
        } else {
          children.add(_FlatSec(sec, first: i == 0, dark: dark));
        }
        prev = tone;
      }
      if (widget.name == 'contact') children.add(ContactForm(widget.s));
      if (widget.name == 'join-team') children.add(JoinForm(widget.s));
      children.add(SiteFooter(widget.s, prev: stack ? prev : Colors.transparent));
      body = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
    }
    final env = _Env(s: widget.s, pricing: pricing, open: _open, keyFor: keyFor, dark: false, flat: !stack, child: body);
    return Scaffold(
      backgroundColor: M.bg,
      body: DefaultTextStyle(
        style: inter(13.5, color: M.dim),
        child: Stack(children: [
          const Positioned.fill(child: CustomPaint(painter: PaperGrid())),
          SafeArea(
            bottom: false,
            child: Column(children: [
              MktHeader(widget.s, back: !widget.top),
              Expanded(child: ListView(controller: scroll, padding: EdgeInsets.zero, children: [env])),
            ]),
          ),
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
        height: 60,
        padding: EdgeInsets.fromLTRB(back ? 4 : 18, 0, 16, 0),
        decoration: const BoxDecoration(color: Color(0xF2FAF9F7), border: Border(bottom: BorderSide(color: M.lineSoft))),
        child: Row(children: [
          if (back) IconButton(onPressed: () => Navigator.maybePop(context), icon: const Icon(Icons.chevron_left, color: M.ink, size: 28)),
          GestureDetector(onTap: () => Navigator.of(context).popUntil((r) => r.isFirst), child: Image.asset('assets/site/logo.png', height: 30)),
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

/// A stacked sheet: rounded top with a thin ink edge, the big tab word, alternating paper and warm grey.
class _Sheet extends StatelessWidget {
  const _Sheet(this.sec, {required this.first, required this.prev, required this.tone, required this.dark, required this.home});
  final Map<String, dynamic> sec;
  final bool first, dark, home;
  final Color prev, tone;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final id = sec['id'] as String?;
    final tab = sec['tab'] as String?;
    final bl = [for (final b in (sec['b'] as List)) b as Map<String, dynamic>];
    final inner = _Env(
      s: env.s, pricing: env.pricing, open: env.open, keyFor: env.keyFor, dark: dark, flat: false,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (tab != null) Padding(padding: const EdgeInsets.only(bottom: 22), child: fw.Text(tab, style: inter(58, w: 800, color: dark ? M.onInk : M.ink, ls: -2.4, h: 1.0))),
        for (var i = 0; i < bl.length; i++) _gap(bl, i, Block(bl[i], hero: first)),
        if (home && first) ...[
          const SizedBox(height: 26),
          Stack(clipBehavior: Clip.none, children: [Image.asset('assets/site/logo.png', width: 300), Positioned(right: -4, top: -6, child: fw.Text('TM', style: inter(12, color: M.ink)))]),
        ],
      ]),
    );
    return Container(
      key: id == null ? null : env.keyFor(id),
      color: prev,
      child: Container(
        margin: EdgeInsets.only(top: first ? 12 : 0),
        decoration: BoxDecoration(color: M.ink, borderRadius: const BorderRadius.vertical(top: Radius.circular(28))),
        padding: const EdgeInsets.fromLTRB(1, 1, 1, 0),
        child: Container(
          width: double.infinity,
          padding: EdgeInsets.fromLTRB(24, tab != null ? 12 : (first ? 44 : 34), 24, 38),
          decoration: BoxDecoration(color: tone, borderRadius: const BorderRadius.vertical(top: Radius.circular(27))),
          child: inner,
        ),
      ),
    );
  }
}

/// A flat-page section: plain paper with a dashed rule between sections.
class _FlatSec extends StatelessWidget {
  const _FlatSec(this.sec, {required this.first, required this.dark});
  final Map<String, dynamic> sec;
  final bool first, dark;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final id = sec['id'] as String?;
    final bl = [for (final b in (sec['b'] as List)) b as Map<String, dynamic>];
    final col = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (var i = 0; i < bl.length; i++) _gap(bl, i, Block(bl[i], hero: first))]);
    return Container(
      key: id == null ? null : env.keyFor(id),
      width: double.infinity,
      color: dark ? M.ink : Colors.transparent,
      padding: EdgeInsets.fromLTRB(24, first ? 40 : 0, 24, 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (!first) const Padding(padding: EdgeInsets.symmetric(vertical: 26), child: _Dashed()),
        _Env(s: env.s, pricing: env.pricing, open: env.open, keyFor: env.keyFor, dark: dark, flat: true, child: col),
        const SizedBox(height: 4),
      ]),
    );
  }
}

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

Widget _gap(List<Map<String, dynamic>> bl, int i, Widget w) {
  final t = bl[i]['t'];
  final prev = i == 0 ? '' : bl[i - 1]['t'];
  double top = 0;
  if (i > 0) {
    top = switch (t) {
      'h' => prev == 'eye' ? 0 : 18,
      'eye' => 18,
      'btn' => prev == 'btn' ? 10 : 22,
      'cards' || 'links' || 'plan' || 'live' || 'faq' || 'table' || 'ul' => 18,
      'chip' => 4,
      _ => prev == 'h' ? 12 : 12,
    };
  }
  return Padding(padding: EdgeInsets.only(top: top), child: w);
}

/// Draws one block (heading, text, list, cards, button, ...). Used inside sections, cards and FAQs.
class Block extends StatelessWidget {
  const Block(this.b, {this.hero = false, super.key});
  final Map<String, dynamic> b;
  final bool hero;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final dark = env.dark && !env.card;
    final id = b['id'] as String?;
    final width = MediaQuery.sizeOf(context).width;
    Widget w;
    switch (b['t']) {
      case 'eye':
        w = Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Container(width: 16, height: 2, color: dark ? M.wineOnInk : M.wine),
            const SizedBox(width: 9),
            Flexible(child: fw.Text((b['x'] as String).toUpperCase(), style: mono(10, color: _dim(dark), ls: 1))),
          ]),
        );
      case 'chip':
        w = Container(padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4), decoration: BoxDecoration(borderRadius: BorderRadius.circular(20), border: Border.all(color: dark ? M.onInkFaint : M.ink.withValues(alpha: .55))), child: fw.Text(b['x'] as String, style: mono(10, color: _fg(dark), ls: .2)));
      case 'h':
        final l = (b['l'] as num).toInt();
        final fs = (b['fs'] as num?)?.toDouble();
        final big = fs != null ? (fs > width * .125 ? width * .125 : fs) : (env.flat ? (width * .118).clamp(34.0, 50.0) : 32.0);
        final st = switch (l) {
          1 => inter(hero || env.flat ? big : 30, w: 700, color: _fg(dark), ls: -.9, h: 1.12),
          2 => inter(26, w: 700, color: _fg(dark), ls: -.4, h: 1.14),
          3 => inter(17, w: 600, color: _fg(dark), ls: -.1, h: 1.3),
          _ => inter(15, w: 600, color: _fg(dark), h: 1.3),
        };
        w = fw.Text(b['x'] as String, style: st);
      case 'p':
        w = RichSpans(b['s'] as List, dark: dark, size: env.card ? 12.5 : 13.5);
      case 'btn':
        w = BtnBlock(b);
      case 'ul':
        w = _Ul(b);
      case 'cards':
        w = _Cards(b);
      case 'links':
        w = Wrap(spacing: 8, runSpacing: 8, children: [for (final x in (b['i'] as List)) _LinkPill((x as Map<String, dynamic>))]);
      case 'faq':
        w = _Faq(b);
      case 'table':
        w = _TableBlock(b);
      case 'plan':
        w = PlanCard(b);
      case 'live':
        w = b['k'] == 'bundles' ? const BundleCards() : const FirstBill();
      case 'img':
        final u = '${b['u']}';
        w = u.endsWith('.svg') ? const SizedBox.shrink() : ClipRRect(borderRadius: BorderRadius.circular(16), child: Image.network(u.startsWith('http') ? u : 'https://auzslab.in/$u', errorBuilder: (_, _, _) => const SizedBox.shrink()));
      case 'quote':
        w = Container(padding: const EdgeInsets.only(left: 14), decoration: const BoxDecoration(border: Border(left: BorderSide(color: M.wine, width: 3))), child: RichSpans(b['s'] as List, dark: dark));
      case 'code':
        w = Container(width: double.infinity, padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: M.ink, borderRadius: BorderRadius.circular(16)), child: fw.Text(b['x'] as String, style: mono(12, color: M.onInk)));
      default:
        w = const SizedBox.shrink();
    }
    return id == null ? w : KeyedSubtree(key: env.keyFor(id), child: w);
  }
}

/// A paragraph made of runs: normal, bold and tappable links.
class RichSpans extends StatefulWidget {
  const RichSpans(this.spans, {this.dark = false, this.size = 13.5, super.key});
  final List spans;
  final bool dark;
  final double size;
  @override
  State<RichSpans> createState() => _RichSpansState();
}

class _RichSpansState extends State<RichSpans> {
  final _rec = <TapGestureRecognizer>[];
  @override
  void dispose() {
    for (final r in _rec) {
      r.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    for (final r in _rec) {
      r.dispose();
    }
    _rec.clear();
    final env = _Env.of(context);
    final spans = <InlineSpan>[];
    for (final x in widget.spans) {
      final m = x as Map;
      final href = m['h'] as String?;
      TapGestureRecognizer? rec;
      if (href != null && href.isNotEmpty) {
        rec = TapGestureRecognizer()..onTap = () => env.open(context, href);
        _rec.add(rec);
      }
      final bold = m['b'] == 1;
      spans.add(TextSpan(
        text: m['x'] as String,
        recognizer: rec,
        style: inter(widget.size, w: bold ? 700 : 400, color: rec != null ? (widget.dark ? M.wineOnInk : M.wine) : (bold ? _fg(widget.dark) : _dim(widget.dark)), h: widget.size > 13 ? 1.65 : 1.7).copyWith(decoration: rec != null ? TextDecoration.underline : TextDecoration.none),
      ));
    }
    return fw.Text.rich(TextSpan(children: spans));
  }
}

/// A button on the page: add to cart, ask us, or go to another page.
class BtnBlock extends StatefulWidget {
  const BtnBlock(this.b, {super.key});
  final Map<String, dynamic> b;
  @override
  State<BtnBlock> createState() => _BtnBlockState();
}

class _BtnBlockState extends State<BtnBlock> {
  bool added = false;
  Future<void> _tap() async {
    final env = _Env.of(context);
    final b = widget.b;
    if (b['a'] == 'add') {
      final keys = '${b['p'] ?? ''}'.split(',').where((e) => e.isNotEmpty).toList();
      if (keys.isEmpty) {
        env.open(context, 'cart.html');
        return;
      }
      await Cart.add(keys);
      if (!mounted) return;
      setState(() => added = true);
      toast(context, 'Added to your cart.');
      return;
    }
    if (b['a'] == 'contact') {
      env.open(context, 'contact.html');
      return;
    }
    env.open(context, '${b['h'] ?? ''}');
  }

  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final b = widget.b;
    final primary = b['k'] == 'primary' || b['a'] == 'add';
    final label = added ? 'Added. View cart' : (b['x'] as String);
    final dark = env.dark && !env.card;
    final tap = added ? () => env.open(context, 'cart.html') : _tap;
    final fg = primary ? M.onInk : _fg(dark);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Flexible(
        child: InkWell(
          onTap: tap,
          borderRadius: BorderRadius.circular(30),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
            decoration: BoxDecoration(color: primary ? M.wine : Colors.transparent, borderRadius: BorderRadius.circular(30), border: Border.all(color: primary ? M.wine : (dark ? const Color(0x66FFFFFF) : const Color(0x4D2E2C2A)))),
            child: fw.Text(tr(label).toUpperCase(), style: mono(11, color: fg, ls: .55), textAlign: TextAlign.center),
          ),
        ),
      ),
    ]);
  }
}

class _LinkPill extends StatelessWidget {
  const _LinkPill(this.b);
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final dark = env.dark && !env.card;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: () => env.open(context, '${b['h'] ?? ''}'),
        child: Container(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13), decoration: BoxDecoration(border: Border.all(color: dark ? const Color(0x66FFFFFF) : const Color(0x4D2E2C2A)), borderRadius: BorderRadius.circular(22)), child: fw.Text((b['x'] as String).replaceAll(RegExp(r'\s*[→>]+\s*$'), ''), style: mono(10.5, color: _fg(dark), ls: .3))),
      ),
    ]);
  }
}

class _Ul extends StatelessWidget {
  const _Ul(this.b);
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final dark = env.dark && !env.card;
    final items = b['i'] as List;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (var i = 0; i < items.length; i++)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 22, child: b['o'] == 1 ? fw.Text('${i + 1}.', style: inter(13, w: 600, color: _fg(dark), h: 1.7)) : Padding(padding: const EdgeInsets.only(top: 9, left: 2), child: Container(width: 5, height: 5, decoration: BoxDecoration(color: dark ? M.wineOnInk : M.wine, shape: BoxShape.circle)))),
            Expanded(child: (items[i] as Map).containsKey('s') ? RichSpans((items[i] as Map)['s'] as List, dark: dark, size: env.card ? 12.5 : 13.5) : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (final x in ((items[i] as Map)['b'] as List)) Block(x as Map<String, dynamic>)])),
          ]),
        ),
    ]);
  }
}

BoxDecoration _cardDeco() => BoxDecoration(color: Colors.white, border: Border.all(color: M.line), borderRadius: BorderRadius.circular(22), boxShadow: const [M.shadow]);

class _Cards extends StatelessWidget {
  const _Cards(this.b);
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final items = [for (final c in (b['i'] as List)) [for (final x in ((c as Map)['b'] as List)) x as Map<String, dynamic>]];
    return LayoutBuilder(builder: (_, cs) {
      final cols = cs.maxWidth >= 900 ? 3 : (cs.maxWidth >= 600 ? 2 : 1);
      const gapW = 12.0;
      final w = cols == 1 ? cs.maxWidth : (cs.maxWidth - gapW * (cols - 1)) / cols;
      return Wrap(spacing: gapW, runSpacing: 12, children: [
        for (final c in items)
          Container(
            width: w,
            padding: const EdgeInsets.all(20),
            decoration: _cardDeco(),
            child: _Env(
              s: env.s, pricing: env.pricing, open: env.open, keyFor: env.keyFor, dark: false, card: true, flat: env.flat,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (var i = 0; i < c.length; i++) _gap(c, i, Block(c[i]))]),
            ),
          ),
      ]);
    });
  }
}

class _Faq extends StatelessWidget {
  const _Faq(this.b);
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final dark = env.dark && !env.card;
    final body = [for (final x in (b['b'] as List)) x as Map<String, dynamic>];
    return Container(
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: dark ? M.onInkFaint : M.line))),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: b['o'] == 1,
          tilePadding: EdgeInsets.zero,
          childrenPadding: const EdgeInsets.only(bottom: 14),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          iconColor: dark ? M.wineOnInk : M.wine,
          collapsedIconColor: _dim(dark),
          title: fw.Text(b['q'] as String, style: inter(14, w: 600, color: _fg(dark), h: 1.35)),
          children: [for (var i = 0; i < body.length; i++) _gap(body, i, Block(body[i]))],
        ),
      ),
    );
  }
}

class _TableBlock extends StatelessWidget {
  const _TableBlock(this.b);
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final dark = env.dark && !env.card;
    final rows = [for (final r in (b['r'] as List)) [for (final c in (r as List)) '$c']];
    final cols = rows.fold<int>(0, (m, r) => r.length > m ? r.length : m);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Table(
        defaultColumnWidth: const IntrinsicColumnWidth(),
        border: TableBorder(horizontalInside: BorderSide(color: dark ? M.onInkFaint : M.line)),
        children: [
          for (var i = 0; i < rows.length; i++)
            TableRow(children: [
              for (var j = 0; j < cols; j++)
                Padding(padding: const EdgeInsets.fromLTRB(0, 10, 18, 10), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 240), child: fw.Text(j < rows[i].length ? rows[i][j] : '', style: i == 0 ? mono(10.5, color: _fg(dark), ls: .6) : inter(13, color: _dim(dark))))),
            ]),
        ],
      ),
    );
  }
}

/// A product price card (live price when the database has one, the website's static price otherwise).
class PlanCard extends StatelessWidget {
  const PlanCard(this.b, {super.key});
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final keys = [for (final k in (b['keys'] as List? ?? const [])) '$k'];
    final pr = env.pricing;
    final live = pr?.monthly(keys);
    final single = keys.length == 1 ? keys.first : '';
    final mob = single == 'mobile';
    final price = live != null && live > 0 ? inr(live) : '${b['price']}';
    final subs = [for (final s in (b['sub'] as List? ?? const [])) '$s'];
    final icon = keys.isEmpty ? null : (keys.length > 1 ? planIcons[keys.last] : planIcons[keys.first]);
    String? sub;
    if (mob && pr != null && pr.yearlyOf('mobile') > 0) {
      final save = pr.monthlyOf('mobile') * 12 - pr.yearlyOf('mobile');
      sub = 'Or ${inr(pr.yearlyOf('mobile'))} for the first year${save > 0 ? ' (save ${inr(save)})' : ''}${pr.renewalYearlyOf('mobile') > 0 ? ', then ${inr(pr.renewalYearlyOf('mobile'))} a year from year two' : ''}. No GST, no setup fee.';
    }
    final gst = mob || (single.isNotEmpty && pr != null && pr.gstExempt(single)) ? '' : ' + GST';
    final badge = '${b['badge'] ?? ''}';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.white, border: Border.all(color: badge.isEmpty ? M.line : M.wine, width: badge.isEmpty ? 1 : 2), borderRadius: BorderRadius.circular(22), boxShadow: badge.isEmpty ? const [M.shadow] : const [BoxShadow(color: M.wine, offset: Offset(5, 5))]),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (badge.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 10), child: Container(padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4), decoration: BoxDecoration(color: M.wine.withValues(alpha: .1), borderRadius: BorderRadius.circular(20)), child: fw.Text(badge, style: mono(10, color: M.wine, ls: .2)))),
        if (icon != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.asset(icon, width: 44, height: 44))),
        fw.Text(b['x'] as String, style: inter(17, w: 600, color: M.ink)),
        const SizedBox(height: 6),
        fw.Text.rich(TextSpan(children: [
          TextSpan(text: price, style: inter(30, w: 700, color: M.ink, ls: -.8, h: 1.1)),
          TextSpan(text: '/month$gst', style: mono(11, color: M.dim, ls: .2)),
        ])),
        for (final t in (sub != null ? [sub] : subs)) Padding(padding: const EdgeInsets.only(top: 8), child: fw.Text(t, style: inter(12.5, color: M.dim, h: 1.6))),
        const SizedBox(height: 16),
        Wrap(spacing: 10, runSpacing: 8, children: [
          if ((b['h'] as String? ?? '').isNotEmpty) BtnBlock({'t': 'btn', 'x': 'Details', 'h': b['h']}),
          if (keys.isNotEmpty) BtnBlock({'t': 'btn', 'x': 'Get it', 'a': 'add', 'p': keys.join(','), 'k': 'primary'}),
        ]),
      ]),
    );
  }
}

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
                BtnBlock({'t': 'btn', 'x': 'Get ${badge.isEmpty ? bd['label'] : badge}', 'a': 'add', 'p': keys.join(','), 'k': 'primary'}),
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
