import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/material.dart' as fw show Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/orderdata.dart';
import '../core/session.dart';
import '../core/site.dart';
import 'account.dart';
import 'cart.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'site_forms.dart';
import 'theme.dart';

const _ink = Color(0xFF171717);
const supportPhone = '+919251250829';
const supportMail = 'helloauzslab@gmail.com';

/// What every block of a page needs: the session, the prices, the link handler and the section colour.
class _Env extends InheritedWidget {
  const _Env({required this.s, required this.pricing, required this.open, required this.keyFor, required this.dark, required super.child});
  final HubSession s;
  final PricingData? pricing;
  final void Function(BuildContext, String) open;
  final GlobalKey Function(String) keyFor;
  final bool dark;
  static _Env of(BuildContext c) => c.dependOnInheritedWidgetOfExactType<_Env>()!;
  @override
  bool updateShouldNotify(_Env o) => o.pricing != pricing || o.dark != dark;
}

Color _fg(bool dark) => dark ? Colors.white : Tk.label;
Color _fg2(bool dark) => dark ? const Color(0xB3FFFFFF) : Tk.label2;
Color _acc(bool dark) => dark ? const Color(0xFFFF8FA3) : Tk.accentText;

/// Opens a website link inside the app (a page, the cart, the account) or outside it (phone, mail, other sites).
Future<void> openSiteLink(BuildContext c, HubSession s, String href, {void Function(String)? onAnchor}) async {
  final known = SiteData.peek()?.pages.keys.toSet() ?? <String>{};
  final l = resolveHref(href, known: known);
  switch (l.kind) {
    case 'anchor':
      onAnchor?.call(l.anchor ?? '');
    case 'page':
      if (l.page == 'index') {
        Navigator.of(c).popUntil((r) => r.isFirst);
      } else {
        Navigator.push(c, MaterialPageRoute<void>(builder: (_) => SitePage(s, l.page, anchor: l.anchor)));
      }
    case 'cart':
      Navigator.push(c, MaterialPageRoute<void>(builder: (_) => CartPage(s)));
    case 'account':
      Navigator.push(c, MaterialPageRoute<void>(builder: (_) => AccountPage(s)));
    case 'external':
      await launchUrl(Uri.parse(l.url), mode: LaunchMode.externalApplication);
    case 'web':
      await launchUrl(Uri.parse(l.url), mode: LaunchMode.externalApplication);
    default:
  }
}

/// One page of the website, drawn natively from the extracted page data.
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
    final k = keys[id];
    final c = k?.currentContext;
    if (c != null) Scrollable.ensureVisible(c, duration: const Duration(milliseconds: 350), curve: Curves.easeOut, alignment: .05);
  }

  void _open(BuildContext c, String href) => openSiteLink(c, widget.s, href, onAnchor: _goto);

  @override
  Widget build(BuildContext context) {
    final p = page;
    final secs = (p?['secs'] as List?) ?? const [];
    final body = missing
        ? const Padding(padding: EdgeInsets.all(32), child: Note('This page is not available in the app yet.'))
        : p == null
            ? const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
            : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (var i = 0; i < secs.length; i++) _Sec(secs[i] as Map<String, dynamic>, first: i == 0),
                if (widget.name == 'contact') ContactForm(widget.s),
                if (widget.name == 'join-team') JoinForm(widget.s),
                SiteFooter(widget.s),
              ]);
    final env = _Env(s: widget.s, pricing: pricing, open: _open, keyFor: keyFor, dark: false, child: Builder(builder: (_) => body));
    final list = ListView(controller: scroll, padding: EdgeInsets.zero, children: [
      if (widget.top) _TopBar(widget.s),
      env,
    ]);
    return Scaffold(
      backgroundColor: Tk.bg,
      appBar: widget.top ? null : AppBar(title: Text((p?['title'] as String?) ?? '')),
      body: SafeArea(top: widget.top, bottom: false, child: list),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar(this.s);
  final HubSession s;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 8, 0),
        child: Row(children: [
          ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.asset('assets/icon.png', height: 34)),
          const SizedBox(width: 10),
          const Text('AUZslab', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const Spacer(),
          IconButton(tooltip: 'Cart', onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => CartPage(s))), icon: Icon(Icons.shopping_bag_outlined, color: Tk.accent)),
        ]),
      );
}

/// One section of the page: its own colour band, like the website's stacked sheets.
class _Sec extends StatelessWidget {
  const _Sec(this.sec, {required this.first});
  final Map<String, dynamic> sec;
  final bool first;
  @override
  Widget build(BuildContext context) {
    final tone = (sec['c'] as String?) ?? '';
    final dark = tone == 'dark';
    final env = _Env.of(context);
    final id = sec['id'] as String?;
    final bg = dark ? _ink : (tone == 'alt' ? Tk.card2 : Colors.transparent);
    final bl = [for (final b in (sec['b'] as List)) b as Map<String, dynamic>];
    return Container(
      key: id == null ? null : env.keyFor(id),
      margin: EdgeInsets.only(top: first ? 0 : 6),
      padding: EdgeInsets.fromLTRB(20, first ? 14 : 26, 20, 26),
      decoration: BoxDecoration(color: bg, borderRadius: first || bg == Colors.transparent ? null : const BorderRadius.vertical(top: Radius.circular(26))),
      child: _Env(
        s: env.s,
        pricing: env.pricing,
        open: env.open,
        keyFor: env.keyFor,
        dark: dark,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (var i = 0; i < bl.length; i++) _gap(bl, i, Block(bl[i], hero: first))]),
      ),
    );
  }
}

Widget _gap(List<Map<String, dynamic>> bl, int i, Widget w) {
  final t = bl[i]['t'];
  final prev = i == 0 ? '' : bl[i - 1]['t'];
  double top = 0;
  if (i > 0) {
    top = switch (t) {
      'h' => prev == 'eye' ? 6 : 18,
      'eye' => 20,
      'btn' => prev == 'btn' ? 10 : 16,
      'cards' || 'links' || 'plan' || 'live' || 'faq' || 'table' || 'ul' => 14,
      _ => 10,
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
    final dark = env.dark;
    final id = b['id'] as String?;
    Widget w;
    switch (b['t']) {
      case 'eye':
        w = Text((b['x'] as String).toUpperCase(), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, letterSpacing: 1.1, color: _acc(dark)));
      case 'h':
        final l = (b['l'] as num).toInt();
        final size = l == 1 ? (hero ? 36.0 : 30.0) : (l == 2 ? 26.0 : (l == 3 ? 19.0 : 16.5));
        w = Text(b['x'] as String, style: TextStyle(fontSize: size, fontWeight: l <= 2 ? FontWeight.w800 : FontWeight.w700, letterSpacing: l <= 2 ? -.8 : -.2, height: 1.12, color: _fg(dark)));
      case 'p':
        w = RichSpans(b['s'] as List, dark: dark);
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
        w = Container(padding: const EdgeInsets.only(left: 14), decoration: BoxDecoration(border: Border(left: BorderSide(color: _acc(dark), width: 3))), child: RichSpans(b['s'] as List, dark: dark));
      case 'code':
        w = Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Tk.fill2, borderRadius: BorderRadius.circular(12)), child: Text(b['x'] as String, style: TextStyle(fontFamily: 'monospace', fontSize: 14, color: _fg(dark))));
      default:
        w = const SizedBox.shrink();
    }
    return id == null ? w : KeyedSubtree(key: env.keyFor(id), child: w);
  }
}

/// A paragraph made of runs: normal, bold and tappable links.
class RichSpans extends StatefulWidget {
  const RichSpans(this.spans, {this.dark = false, this.size = 16.5, super.key});
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
      spans.add(TextSpan(
        text: m['x'] as String,
        recognizer: rec,
        style: TextStyle(fontWeight: m['b'] == 1 ? FontWeight.w700 : null, color: rec != null ? _acc(widget.dark) : (m['b'] == 1 ? _fg(widget.dark) : null), decoration: rec != null ? TextDecoration.underline : null),
      ));
    }
    return fw.Text.rich(TextSpan(children: spans, style: TextStyle(fontSize: widget.size, height: 1.45, color: _fg2(widget.dark))));
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
    final dark = env.dark;
    final tap = added ? () => env.open(context, 'cart.html') : _tap;
    return Align(
      alignment: Alignment.centerLeft,
      child: primary
          ? FilledButton(onPressed: tap, style: FilledButton.styleFrom(backgroundColor: dark ? Colors.white : Tk.accent, foregroundColor: dark ? _ink : Colors.white, minimumSize: const Size(0, 48), shape: const StadiumBorder(), padding: const EdgeInsets.symmetric(horizontal: 22)), child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)))
          : OutlinedButton(onPressed: tap, style: OutlinedButton.styleFrom(foregroundColor: _fg(dark), side: BorderSide(color: dark ? const Color(0x66FFFFFF) : Tk.line2), minimumSize: const Size(0, 48), shape: const StadiumBorder(), padding: const EdgeInsets.symmetric(horizontal: 20)), child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
    );
  }
}

class _LinkPill extends StatelessWidget {
  const _LinkPill(this.b);
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final dark = env.dark;
    return InkWell(
      borderRadius: BorderRadius.circular(22),
      onTap: () => env.open(context, '${b['h'] ?? ''}'),
      child: Container(constraints: const BoxConstraints(minHeight: 44), padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10), decoration: BoxDecoration(color: dark ? const Color(0x1FFFFFFF) : Tk.card, border: Border.all(color: dark ? const Color(0x33FFFFFF) : Tk.line), borderRadius: BorderRadius.circular(22)), child: Text(b['x'] as String, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: _fg(dark)))),
    );
  }
}

class _Ul extends StatelessWidget {
  const _Ul(this.b);
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final dark = _Env.of(context).dark;
    final items = b['i'] as List;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (var i = 0; i < items.length; i++)
        Padding(
          padding: const EdgeInsets.only(top: 7),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 24, child: Padding(padding: const EdgeInsets.only(top: 1), child: b['o'] == 1 ? Text('${i + 1}.', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: _acc(dark))) : Padding(padding: const EdgeInsets.only(top: 8, left: 3), child: Container(width: 6, height: 6, decoration: BoxDecoration(color: _acc(dark), shape: BoxShape.circle))))),
            Expanded(child: (items[i] as Map).containsKey('s') ? RichSpans((items[i] as Map)['s'] as List, dark: dark) : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (final x in ((items[i] as Map)['b'] as List)) Block(x as Map<String, dynamic>)])),
          ]),
        ),
    ]);
  }
}

class _Cards extends StatelessWidget {
  const _Cards(this.b);
  final Map<String, dynamic> b;
  @override
  Widget build(BuildContext context) {
    final env = _Env.of(context);
    final dark = env.dark;
    final items = [for (final c in (b['i'] as List)) [for (final x in ((c as Map)['b'] as List)) x as Map<String, dynamic>]];
    return LayoutBuilder(builder: (_, cs) {
      final cols = cs.maxWidth >= 900 ? 3 : (cs.maxWidth >= 600 ? 2 : 1);
      const gapW = 12.0;
      final w = cols == 1 ? cs.maxWidth : (cs.maxWidth - gapW * (cols - 1)) / cols;
      return Wrap(spacing: gapW, runSpacing: gapW, children: [
        for (final c in items)
          Container(
            width: w,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: dark ? const Color(0x14FFFFFF) : Tk.card, border: Border.all(color: dark ? const Color(0x26FFFFFF) : Tk.line), borderRadius: BorderRadius.circular(20), boxShadow: dark ? null : Tk.sh1),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (var i = 0; i < c.length; i++) _gap(c, i, Block(c[i]))]),
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
    final dark = _Env.of(context).dark;
    final body = [for (final x in (b['b'] as List)) x as Map<String, dynamic>];
    return Container(
      decoration: BoxDecoration(color: dark ? const Color(0x14FFFFFF) : Tk.card, border: Border.all(color: dark ? const Color(0x26FFFFFF) : Tk.line), borderRadius: BorderRadius.circular(16)),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          iconColor: _acc(dark),
          collapsedIconColor: _fg2(dark),
          title: Text(b['q'] as String, style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700, color: _fg(dark))),
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
    final dark = _Env.of(context).dark;
    final rows = [for (final r in (b['r'] as List)) [for (final c in (r as List)) '$c']];
    final cols = rows.fold<int>(0, (m, r) => r.length > m ? r.length : m);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Table(
        defaultColumnWidth: const IntrinsicColumnWidth(),
        border: TableBorder(horizontalInside: BorderSide(color: dark ? const Color(0x33FFFFFF) : Tk.line)),
        children: [
          for (var i = 0; i < rows.length; i++)
            TableRow(children: [
              for (var j = 0; j < cols; j++)
                Padding(padding: const EdgeInsets.fromLTRB(0, 10, 18, 10), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 240), child: Text(j < rows[i].length ? rows[i][j] : '', style: TextStyle(fontSize: 15, fontWeight: i == 0 ? FontWeight.w700 : FontWeight.w500, color: i == 0 ? _fg(dark) : _fg2(dark))))),
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
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Tk.card, border: Border.all(color: (b['badge'] as String? ?? '').isEmpty ? Tk.line : Tk.accent, width: (b['badge'] as String? ?? '').isEmpty ? 1 : 2), borderRadius: BorderRadius.circular(20), boxShadow: Tk.sh1),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if ((b['badge'] as String? ?? '').isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 8), child: Pill(b['badge'] as String, tone: Tk.accent)),
        Row(children: [
          if (icon != null) ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.asset(icon, width: 44, height: 44)),
          if (icon != null) const SizedBox(width: 12),
          Expanded(child: Text(b['x'] as String, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800))),
        ]),
        const SizedBox(height: 8),
        fw.Text.rich(TextSpan(children: [
          TextSpan(text: price, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -.6)),
          TextSpan(text: '/month$gst', style: TextStyle(fontSize: 14.5, color: Tk.label2)),
        ])),
        for (final t in (sub != null ? [sub] : subs)) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t, style: TextStyle(fontSize: 15, height: 1.4, color: Tk.label2))),
        const SizedBox(height: 12),
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
    if (pr == null) return const Padding(padding: EdgeInsets.all(16), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))));
    if (pr.bundles.isEmpty) return Text('Bundle prices are not available right now.', style: TextStyle(color: Tk.label2));
    return LayoutBuilder(builder: (_, cs) {
      final cols = cs.maxWidth >= 700 ? 2 : 1;
      final w = cols == 1 ? cs.maxWidth : (cs.maxWidth - 12) / cols;
      return Wrap(spacing: 12, runSpacing: 12, children: [
        for (final bd in pr.bundles)
          Builder(builder: (_) {
            final m = pr.n(bd['monthly_price']), list = pr.n(bd['list_price']), y = pr.n(bd['yearly_price']);
            final keys = [for (final k in (bd['feature_keys'] as List? ?? const [])) '$k'];
            final badge = '${bd['badge'] ?? ''}';
            return Container(
              width: w,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Tk.card, border: Border.all(color: badge.toLowerCase().contains('popular') ? Tk.accent : Tk.line, width: badge.toLowerCase().contains('popular') ? 2 : 1), borderRadius: BorderRadius.circular(20), boxShadow: Tk.sh1),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [for (final k in keys) if (planIcons[k] != null) Padding(padding: const EdgeInsets.only(right: 8), child: ClipRRect(borderRadius: BorderRadius.circular(9), child: Image.asset(planIcons[k]!, width: 38, height: 38)))]),
                if (badge.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Pill(badge, tone: Tk.accent)),
                Padding(padding: const EdgeInsets.only(top: 8), child: Text('${bd['label']}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800))),
                const SizedBox(height: 6),
                fw.Text.rich(TextSpan(children: [
                  if (list > m) TextSpan(text: '${inr(list)} ', style: TextStyle(fontSize: 16, color: Tk.label3, decoration: TextDecoration.lineThrough)),
                  TextSpan(text: inr(m), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -.6)),
                  TextSpan(text: '/month + GST', style: TextStyle(fontSize: 14.5, color: Tk.label2)),
                ])),
                if ('${bd['blurb'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('${bd['blurb']}', style: TextStyle(fontSize: 15, color: Tk.label2, height: 1.4))),
                if (list > m) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Save ${inr(list - m)}/month vs. buying separately.', style: TextStyle(fontSize: 15, color: Tk.label2))),
                if (y > 0) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Or pay ${inr(y)} for the whole year${y < m * 12 ? ' (save ${inr(m * 12 - y)})' : ''}.', style: TextStyle(fontSize: 15, color: Tk.label2))),
                const SizedBox(height: 12),
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
    Widget row(String a, String b, {bool bold = false}) => Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(children: [Expanded(child: Text(a, style: TextStyle(fontSize: 16, fontWeight: bold ? FontWeight.w800 : FontWeight.w500))), Text(b, style: TextStyle(fontSize: 16, fontWeight: bold ? FontWeight.w800 : FontWeight.w600))]));
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Tk.card, border: Border.all(color: Tk.line), borderRadius: BorderRadius.circular(20), boxShadow: Tk.sh1),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('See exactly what you pay on day one', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
        const SizedBox(height: 10),
        Sel('Product', k, [for (final x in list) (x, '${productLabels[x] ?? x} (${inr(pr.monthlyOf(x))}/month)')], (v) => setState(() => key = v)),
        const SizedBox(height: 8),
        row('Subscription, first month', inr(sub)),
        if (gst > 0) row('GST (18%)', inr(gst)),
        row('Onboarding fee (no GST)', inr(onboarding)),
        if (setup > 0) row('Setup fee (no GST)', inr(setup)),
        const Divider(),
        row('Pay today', inr(sub + gst + setup + onboarding), bold: true),
        row('Every month after that', inr(sub + gst)),
        Text('GST is 18% on the subscription only. The onboarding fee and setup fee have no GST.', style: TextStyle(fontSize: 14, color: Tk.label2, height: 1.4)),
      ]),
    );
  }
}

/// Bottom of every page: the contact line and the main links.
class SiteFooter extends StatelessWidget {
  const SiteFooter(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) {
    Widget link(String label, String page) => InkWell(onTap: () => openSiteLink(context, s, '$page.html'), child: Padding(padding: const EdgeInsets.symmetric(vertical: 9), child: Text(label, style: const TextStyle(fontSize: 15.5, color: Color(0xCCFFFFFF)))));
    Widget col(String title, List<(String, String)> items) => Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1, color: Color(0x99FFFFFF))), const SizedBox(height: 6), for (final i in items) link(i.$1, i.$2)]));
    return Container(
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 36),
      decoration: const BoxDecoration(color: _ink, borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('AUZslab', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Colors.white)),
        const SizedBox(height: 6),
        const Text('Business software built around the way you work.', style: TextStyle(fontSize: 15.5, color: Color(0xB3FFFFFF), height: 1.4)),
        const SizedBox(height: 14),
        InkWell(onTap: () => launchUrl(Uri.parse('tel:$supportPhone')), child: const Padding(padding: EdgeInsets.symmetric(vertical: 6), child: Text('+91 92512 50829', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)))),
        InkWell(onTap: () => launchUrl(Uri.parse('mailto:$supportMail')), child: const Padding(padding: EdgeInsets.symmetric(vertical: 6), child: Text(supportMail, style: TextStyle(fontSize: 15.5, color: Color(0xCCFFFFFF))))),
        const SizedBox(height: 18),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          col('Products', const [('AUZsPOS', 'pos'), ('AUZsPay', 'payroll'), ('AUZsLedger', 'accounting'), ('AUZsScan', 'scan-and-bill'), ('All products', 'products')]),
          col('Company', const [('Pricing', 'pricing'), ('Live demo', 'live-demo'), ('Contact', 'contact'), ('Join our team', 'join-team'), ('Sitemap', 'sitemap')]),
        ]),
        const SizedBox(height: 14),
        Wrap(spacing: 18, children: [
          for (final i in const [('Terms', 'terms'), ('Privacy', 'privacy'), ('Refunds', 'refund'), ('Cookies', 'cookies')]) InkWell(onTap: () => openSiteLink(context, s, '${i.$2}.html'), child: Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(i.$1, style: const TextStyle(fontSize: 14.5, color: Color(0x99FFFFFF))))),
        ]),
        const Text('© 2026 AUZslab', style: TextStyle(fontSize: 13.5, color: Color(0x80FFFFFF))),
      ]),
    );
  }
}

/// The menu tab: every page of the website, grouped like the website's menu.
class SiteMenu extends StatelessWidget {
  const SiteMenu(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 32), children: [
        const PageHead('Menu', sub: 'Everything on the AUZslab website.'),
        for (final g in siteMenu) ...[
          SectionLabel(g.title),
          Group([for (final l in g.links) Li(l.label, sub: l.sub.isEmpty ? null : l.sub, icon: _groupIcon[g.title], tone: _groupTone(g.title), onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => SitePage(s, l.page, anchor: l.anchor))))]),
        ],
      ]);
}

const _groupIcon = <String, IconData>{
  'Products': Icons.apps_rounded,
  'Business types': Icons.storefront_outlined,
  'Discover': Icons.explore_outlined,
  'Resources': Icons.menu_book_outlined,
  'Company': Icons.business_outlined,
  'Legal': Icons.gavel_outlined,
};

Color _groupTone(String g) => switch (g) {
      'Products' => Tk.accent,
      'Business types' => Tk.teal,
      'Discover' => Tk.orange,
      'Resources' => Tk.blue,
      'Company' => Tk.purple,
      _ => Tk.label2,
    };
