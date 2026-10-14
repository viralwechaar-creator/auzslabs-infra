part of 'site.dart';

// Draws the node trees written by tool/extract_site.mjs: every box, text and picture of a website section with the
// computed look (font, size, colour, borders, radius, shadow, padding, tilt) the browser gave it at phone width.

Color? _hx(dynamic v) {
  if (v is! String || v.isEmpty) return null;
  if (v.length == 8) return Color(int.parse('${v.substring(6)}${v.substring(0, 6)}', radix: 16));
  return Color(int.parse('FF$v', radix: 16));
}

double _n(dynamic v, [double d = 0]) => v is num ? v.toDouble() : d;
Map<String, dynamic> _s(Map n) => ((n['s'] as Map?) ?? const {}).cast<String, dynamic>();
List<Map<String, dynamic>> _kids(Map n) => [for (final x in ((n['c'] as List?) ?? const [])) (x as Map).cast<String, dynamic>()];
bool _isAbs(Map n) => n['abs'] != null;
double _ml(Map n) => n['k'] == 't' ? _n(n['ml']) : (n['k'] == 'b' ? _n(_s(n)['ml']) : 0);
Widget _indent(Map n, Widget w) => _ml(n) > 0 ? Padding(padding: EdgeInsets.only(left: _ml(n)), child: w) : w;
double _coll(double a, double b) => (a >= 0 && b >= 0) ? (a > b ? a : b) : ((a < 0 && b < 0) ? (a < b ? a : b) : a + b);

List<double> _padOf(Map s) => s['p'] is List ? [for (final x in (s['p'] as List)) _n(x)] : const [0, 0, 0, 0];
double _bw(Map s, String side) {
  final b = s['bd'];
  if (b is! Map) return 0;
  final x = b[side];
  return x is List ? _n(x[0]) : 0;
}

bool _block(Map n) => _s(n)['d'] == null;
bool _hoistTop(Map n) => _block(n) && _padOf(_s(n))[0] == 0 && _bw(_s(n), 't') == 0;
bool _hoistBot(Map n) => _block(n) && _padOf(_s(n))[2] == 0 && _bw(_s(n), 'b') == 0;

Map<String, dynamic>? _firstFlow(Map n) {
  for (final k in _kids(n)) {
    if (!_isAbs(k)) return k;
  }
  return null;
}

Map<String, dynamic>? _lastFlow(Map n) {
  final l = _kids(n).where((k) => !_isAbs(k)).toList();
  return l.isEmpty ? null : l.last;
}

double _top(Map n) {
  switch (n['k']) {
    case 't':
      final m = n['m'];
      return m is List ? _n(m[0]) : 0;
    case 'b':
      var v = _n(_s(n)['mt']);
      if (_hoistTop(n)) {
        final f = _firstFlow(n);
        if (f != null) v = _coll(v, _top(f));
      }
      return v;
    case 'a':
      return _n(n['mt']);
  }
  return 0;
}

double _bot(Map n) {
  switch (n['k']) {
    case 't':
      final m = n['m'];
      return m is List ? _n(m[1]) : 0;
    case 'b':
      var v = _n(_s(n)['mb']);
      if (_hoistBot(n)) {
        final l = _lastFlow(n);
        if (l != null) v = _coll(v, _bot(l));
      }
      return v;
    case 'a':
      return _n(n['mb']);
  }
  return 0;
}

/// Pulls a widget up over the one above it (a negative top margin) without clipping it.
class NegTop extends SingleChildRenderObjectWidget {
  const NegTop(this.px, {required Widget child, super.key}) : super(child: child);
  final double px;
  @override
  RenderObject createRenderObject(BuildContext context) => _RenderNegTop(px);
  @override
  void updateRenderObject(BuildContext context, covariant _RenderNegTop r) => r.px = px;
}

class _RenderNegTop extends RenderProxyBox {
  _RenderNegTop(this._px);
  double _px;
  set px(double v) {
    if (v != _px) {
      _px = v;
      markNeedsLayout();
    }
  }

  @override
  void performLayout() {
    final c = child!;
    c.layout(constraints, parentUsesSize: true);
    size = Size(c.size.width, (c.size.height - _px).clamp(0, double.infinity));
  }

  @override
  void paint(PaintingContext context, Offset offset) => context.paintChild(child!, offset + Offset(0, -_px));

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      result.addWithPaintOffset(offset: Offset(0, -_px), position: position, hitTest: (r, p) => child!.hitTest(r, position: p));

  @override
  void applyPaintTransform(RenderObject child, Matrix4 transform) => transform.translate(0.0, -_px);
}

TextStyle _tstyle(Map s) {
  final fs = _n(s['fs'], 14);
  final fw = (_n(s['fw'], 400)).round();
  final col = _hx(s['col']) ?? M.ink;
  final ls = _n(s['ls']);
  final lh = _n(s['lh'], 1.4);
  final deco = <TextDecoration>[if (s['ul'] == 1) TextDecoration.underline, if (s['st'] == 1) TextDecoration.lineThrough];
  TextStyle base;
  if (s['ff'] == 'm') {
    base = mono(fs, bold: fw >= 600, color: col, ls: ls, h: lh);
  } else if (s['ff'] == 's') {
    base = TextStyle(fontFamily: 'Georgia', fontFamilyFallback: const ['Times New Roman', 'serif'], fontSize: fs, fontWeight: FontWeight.values[((fw ~/ 100).clamp(1, 9)) - 1], color: col, letterSpacing: ls, height: lh, decoration: TextDecoration.none);
  } else {
    base = inter(fs, w: fw, color: col, ls: ls, h: lh);
  }
  final sk = s['sk'];
  final outline = s['nf'] == 1 && sk is List;
  final paint = outline
      ? (Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = _n(sk[0])
        ..color = _hx(sk[1]) ?? col)
      : null;
  final decoration = deco.isEmpty ? TextDecoration.none : TextDecoration.combine(deco);
  if (paint != null) {
    return TextStyle(
      inherit: false,
      fontFamily: base.fontFamily,
      fontFamilyFallback: base.fontFamilyFallback,
      fontSize: base.fontSize,
      fontWeight: base.fontWeight,
      fontVariations: base.fontVariations,
      foreground: paint,
      letterSpacing: base.letterSpacing,
      height: base.height,
      leadingDistribution: TextLeadingDistribution.even,
      fontStyle: s['it'] == 1 ? FontStyle.italic : FontStyle.normal,
      decoration: decoration,
    );
  }
  return base.copyWith(
    leadingDistribution: TextLeadingDistribution.even,
    fontStyle: s['it'] == 1 ? FontStyle.italic : FontStyle.normal,
    decoration: decoration,
    decorationColor: col,
  );
}

class NodeCx {
  const NodeCx({this.pc = '', this.added, this.inc = false});
  final String pc;
  final ValueNotifier<bool>? added;
  final bool inc;
  NodeCx with_({String? pc, ValueNotifier<bool>? added, bool? inc}) => NodeCx(pc: pc ?? this.pc, added: added ?? this.added, inc: inc ?? this.inc);
}

/// One node of a section, `iw` = width available for it.
Widget nodeView(BuildContext c, Map<String, dynamic> n, double iw, {NodeCx cx = const NodeCx(), bool inRow = false}) {
  switch (n['k']) {
    case 't':
      return NText(n, cx: cx);
    case 'b':
      return _BoxNode(n, iw, cx: cx, inRow: inRow);
    case 'r':
      return Container(width: _n(n['w']), height: _n(n['h']), decoration: BoxDecoration(color: _hx(n['bg']), borderRadius: n['r'] != null ? BorderRadius.circular(_n(n['r'])) : null));
    case 'i':
      return _ImgNode(n, iw);
    case 'v':
      return _SvgNode(n, iw);
    case 'a':
      return _AccNode(n, iw, cx: cx);
    case 'x':
      return n['live'] == 'bundles' ? const BundleCards() : const FirstBill();
  }
  return const SizedBox.shrink();
}

class _ImgNode extends StatelessWidget {
  const _ImgNode(this.n, this.iw);
  final Map<String, dynamic> n;
  final double iw;
  @override
  Widget build(BuildContext context) {
    final src = '${n['src']}'.split('/').last;
    final w = _n(n['w']), h = _n(n['h']);
    final r = _n(n['r']);
    Widget im;
    if (src.endsWith('.svg')) {
      im = SvgPicture.asset('assets/site/img/$src', width: w, height: h, fit: BoxFit.contain, placeholderBuilder: (_) => SizedBox(width: w, height: h));
    } else {
      im = Image.asset('assets/site/img/$src', width: w, height: h, fit: BoxFit.cover, errorBuilder: (_, __, ___) => SizedBox(width: w, height: h));
    }
    if (r > 0) im = ClipRRect(borderRadius: BorderRadius.circular(r), child: im);
    return w > iw && iw > 0 ? FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: im) : im;
  }
}

class _SvgNode extends StatelessWidget {
  const _SvgNode(this.n, this.iw);
  final Map<String, dynamic> n;
  final double iw;
  @override
  Widget build(BuildContext context) {
    final w = _n(n['w']), h = _n(n['h']);
    final sv = SvgPicture.string('${n['svg']}', width: w, height: h, fit: BoxFit.contain);
    return w > iw && iw > 0 ? FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: sv) : sv;
  }
}

/// Text with the exact style the browser used; links inside it open in the app.
class NText extends StatefulWidget {
  const NText(this.n, {this.cx = const NodeCx(), super.key});
  final Map<String, dynamic> n;
  final NodeCx cx;
  @override
  State<NText> createState() => _NTextState();
}

class _NTextState extends State<NText> {
  final _rec = <TapGestureRecognizer>[];
  void _dispose() {
    for (final r in _rec) {
      r.dispose();
    }
    _rec.clear();
  }

  @override
  void dispose() {
    _dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _dispose();
    final env = _Env.of(context);
    final n = widget.n;
    final s = (n['s'] as Map).cast<String, dynamic>();
    final upper = s['tt'] == 'u';
    final runs = [for (final r in (n['r'] as List)) (r as Map).cast<String, dynamic>()];
    var added = false;
    final ad = widget.cx.added;
    if (ad != null) added = ad.value;
    final spans = <InlineSpan>[];
    for (var i = 0; i < runs.length; i++) {
      final r = runs[i];
      var t = '${r['x']}';
      if (widget.cx.inc && i == 0) t = 'Included with AUZsPOS';
      if (added && i == 0) t = 'Added. View cart';
      if (r['s'] != null && (r['s'] as Map)['tt'] == 'u') {
        t = t.toUpperCase();
      } else if (upper && !(r['s'] is Map && (r['s'] as Map).containsKey('tt'))) {
        t = t.toUpperCase();
      }
      final st = _tstyle({...s, ...?(r['s'] as Map?)?.cast<String, dynamic>()});
      TapGestureRecognizer? rec;
      final h = r['h'];
      if (h is String && h.isNotEmpty) {
        rec = TapGestureRecognizer()..onTap = () => env.open(context, h);
        _rec.add(rec);
      }
      spans.add(TextSpan(text: t, style: rec == null ? st : st.copyWith(decoration: TextDecoration.underline, decorationColor: st.color), recognizer: rec));
      if ((widget.cx.inc || added) && i == 0) break;
    }
    final ta = s['ta'] == 'c' ? TextAlign.center : (s['ta'] == 'r' ? TextAlign.right : TextAlign.left);
    Widget w = fw.Text.rich(TextSpan(children: spans, style: _tstyle(s)), textAlign: ta, textHeightBehavior: const TextHeightBehavior(applyHeightToFirstAscent: true, applyHeightToLastDescent: true));
    final mw = n['mw'];
    if (mw is num) {
      w = ConstrainedBox(constraints: BoxConstraints(maxWidth: mw.toDouble() + 2), child: w);
      w = Align(alignment: s['ta'] == 'c' ? Alignment.topCenter : Alignment.topLeft, child: w);
    }
    return w;
  }
}

class _BoxNode extends StatefulWidget {
  const _BoxNode(this.n, this.iw, {required this.cx, this.inRow = false});
  final Map<String, dynamic> n;
  final double iw;
  final NodeCx cx;
  final bool inRow;
  @override
  State<_BoxNode> createState() => _BoxNodeState();
}

class _BoxNodeState extends State<_BoxNode> {
  ValueNotifier<bool>? added;
  @override
  void initState() {
    super.initState();
    if (widget.n['a'] == 'add') added = ValueNotifier(false);
  }

  @override
  void dispose() {
    added?.dispose();
    super.dispose();
  }

  Future<void> _tap(BuildContext context) async {
    final env = _Env.of(context);
    final n = widget.n;
    final a = n['a'];
    if (a == 'add') {
      if (added!.value) {
        env.open(context, 'cart.html');
        return;
      }
      final keys = '${n['p'] ?? ''}'.split(',').where((e) => e.isNotEmpty).toList();
      if (keys.isEmpty) {
        env.open(context, 'cart.html');
        return;
      }
      await Cart.add(keys);
      if (!mounted) return;
      added!.value = true;
      toast(context, 'Added to your cart.');
      return;
    }
    if (a == 'contact') {
      env.open(context, 'contact.html');
      return;
    }
    final h = n['h'];
    if (h is String && h.isNotEmpty) env.open(context, h);
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.n;
    final env = _Env.of(context);
    var cx = widget.cx;
    if (n['pc'] != null) cx = cx.with_(pc: '${n['pc']}');
    if (added != null) cx = cx.with_(added: added);
    if (n['a'] == 'inc') cx = cx.with_(inc: true);
    final s = _s(n);
    final pad = _padOf(s);
    final bdL = _bw(s, 'l'), bdR = _bw(s, 'r'), bdT = _bw(s, 't'), bdB = _bw(s, 'b');
    // width this box has inside the parent
    final wf = s['w'];
    var bw = widget.iw;
    if (wf is num && wf < 0.999 && s['fit'] != 1) bw = widget.iw * wf.toDouble() + 1;
    final iw = (bw - pad[1] - pad[3] - bdL - bdR).clamp(0, double.infinity).toDouble();

    // live price replacement
    var kids = _kids(n);
    if (n['lp'] == 1 && cx.pc.isNotEmpty && env.pricing != null) {
      final live = env.pricing!.monthly(cx.pc.split(','));
      if (live != null && live > 0 && kids.isNotEmpty && kids.first['k'] == 't') {
        final k0 = {...kids.first};
        final runs = [for (final r in (k0['r'] as List)) {...(r as Map).cast<String, dynamic>()}];
        runs[0] = {...runs[0], 'x': inr(live)};
        k0['r'] = runs;
        kids = [k0, ...kids.skip(1)];
      }
    }

    Widget content = _layout(context, n, s, kids, iw, cx, pad);
    if (n['a'] == 'add' && added != null) {
      content = ValueListenableBuilder<bool>(valueListenable: added!, builder: (_, __, ___) => _layout(context, n, s, kids, iw, cx, pad));
    }
    final abs = kids.where(_isAbs).toList();
    if (abs.isNotEmpty) {
      final flow = _layout(context, n, s, kids.where((k) => !_isAbs(k)).toList(), iw, cx, pad, padOnly: false);
      content = Stack(clipBehavior: Clip.none, children: [
        flow,
        for (final a in abs)
          Positioned(left: _n((a['abs'] as List)[0]) - pad[3] - bdL, top: _n((a['abs'] as List)[1]) - pad[0] - bdT, child: nodeView(context, a, iw, cx: cx)),
      ]);
      content = Padding(padding: EdgeInsets.zero, child: content);
    }

    Widget box = _decorated(n, s, pad, bdL, bdT, bdR, bdB, content);
    final rot = _n(s['rot']);
    if (rot != 0) box = Transform.rotate(angle: rot * 3.14159265 / 180, child: box);

    final act = n['a'];
    final linked = (n['h'] is String && '${n['h']}'.isNotEmpty) || act == 'add' || act == 'contact';
    if (linked && act != 'inc') {
      box = GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => _tap(context), child: box);
    }

    // placement inside the parent
    if (widget.inRow) {
      if (wf is num && wf < 0.999 && s['fit'] != 1) return SizedBox(width: bw, child: box);
      return box;
    }
    if (s['fit'] == 1) {
      return Align(alignment: s['ac'] == 1 ? Alignment.topCenter : Alignment.topLeft, child: box);
    }
    if (wf is num && wf < 0.999) {
      return Align(alignment: s['ac'] == 1 ? Alignment.topCenter : Alignment.topLeft, child: SizedBox(width: bw, child: box));
    }
    final mw = s['mw'];
    if (mw is num && mw < widget.iw) {
      return Align(alignment: s['ac'] == 1 ? Alignment.topCenter : Alignment.topLeft, child: ConstrainedBox(constraints: BoxConstraints(maxWidth: mw.toDouble()), child: box));
    }
    return box;
  }

  Widget _decorated(Map<String, dynamic> n, Map<String, dynamic> s, List<double> pad, double l, double t, double r, double b, Widget content) {
    final bg = _hx(s['bg']);
    final rad = s['r'];
    BorderRadius? br;
    if (rad is num) {
      br = BorderRadius.circular(rad.toDouble());
    } else if (rad is List) {
      br = BorderRadius.only(topLeft: Radius.circular(_n(rad[0])), topRight: Radius.circular(_n(rad[1])), bottomRight: Radius.circular(_n(rad[2])), bottomLeft: Radius.circular(_n(rad[3])));
    }
    final sh = <BoxShadow>[
      if (bg != null)
      for (final x in ((s['sh'] as List?) ?? const []))
        BoxShadow(offset: Offset(_n((x as List)[0]), _n(x[1])), blurRadius: _n(x[2]).abs(), spreadRadius: _n(x[3]), color: _hx(x[4]) ?? const Color(0x33000000)),
    ];
    final bd = s['bd'] as Map?;
    Widget inner = Padding(padding: EdgeInsets.fromLTRB(pad[3], pad[0], pad[1], pad[2]), child: content);
    var dashed = false;
    BoxBorder? border;
    if (bd != null) {
      BorderSide side(String k) {
        final x = bd[k];
        if (x is! List) return BorderSide.none;
        if (x.length > 2 && x[2] == 'd') dashed = true;
        return BorderSide(color: _hx(x[1]) ?? M.line, width: _n(x[0]));
      }

      final ts = side('t'), rs = side('r'), bs = side('b'), ls = side('l');
      if (!dashed) {
        final uniform = ts.width == rs.width && rs.width == bs.width && bs.width == ls.width && ts.color == rs.color && rs.color == bs.color && bs.color == ls.color;
        if (uniform || br == null) {
          border = uniform ? Border.all(color: ts.color, width: ts.width) : Border(top: ts, right: rs, bottom: bs, left: ls);
          if (uniform && ts.width == 0) border = null;
        }
      }
    }
    if (bd != null && border == null && !dashed && br != null) {
      final c = _hx((bd.values.firstWhere((x) => x is List, orElse: () => null) as List?)?[1]) ?? M.ink;
      final wd = [l, t, r, b].fold<double>(0, (m, x) => x > m ? x : m);
      Widget fill = DecoratedBox(decoration: BoxDecoration(color: bg, borderRadius: br, boxShadow: sh), child: (s['cl'] == 1) ? ClipRRect(borderRadius: br, child: inner) : inner);
      return CustomPaint(foregroundPainter: _RRectSides(br, c, wd, l > 0, t > 0, r > 0, b > 0), child: fill);
    }
    Widget d = DecoratedBox(
      decoration: BoxDecoration(color: bg, borderRadius: border is Border && !(border).isUniform ? null : br, border: border, boxShadow: sh),
      child: (s['cl'] == 1 && br != null) ? ClipRRect(borderRadius: br, child: inner) : inner,
    );
    if (dashed && bd != null) {
      d = CustomPaint(foregroundPainter: _DashedBorder(bd.cast<String, dynamic>()), child: d);
    }
    return d;
  }

  Widget _layout(BuildContext context, Map<String, dynamic> n, Map<String, dynamic> s, List<Map<String, dynamic>> kids, double iw, NodeCx cx, List<double> pad, {bool padOnly = false}) {
    final flow = kids.where((k) => !_isAbs(k)).toList();
    if (flow.isEmpty) return const SizedBox.shrink();
    final dir = s['d'];
    final gap = _n(s['g']);
    final rgap = s['rg'] == null ? gap : _n(s['rg']);
    final ai = s['ai'];
    final bullet = s['li'];
    Widget body;
    if (dir == 'g') {
      body = _grid(context, flow, iw, cx, rgap);
    } else if (dir == 'r') {
      body = _row(context, flow, iw, cx, s, gap, rgap);
    } else {
      body = _column(context, n, flow, iw, cx, s, gap, ai);
    }
    if (bullet is String) {
      body = Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        fw.Text('$bullet  ', style: _tstyle({'fs': 13.5, 'lh': 1.65, 'col': s['lic'] ?? '800020', 'fw': 700})),
        Expanded(child: body),
      ]);
    }
    if (s['sx'] == 1 && dir == 'r') {
      body = SingleChildScrollView(scrollDirection: Axis.horizontal, child: body);
    }
    return body;
  }

  Widget _column(BuildContext context, Map<String, dynamic> n, List<Map<String, dynamic>> flow, double iw, NodeCx cx, Map<String, dynamic> s, double gap, dynamic ai) {
    final block = _block(n);
    final hoistT = block && _hoistTop(n);
    final hoistB = block && _hoistBot(n);
    final out = <Widget>[];
    var pendingNeg = 0.0;
    void add(double space, Widget w) {
      if (space < 0) pendingNeg = -space;
      if (space > 0) out.add(SizedBox(height: space));
      if (pendingNeg > 0) {
        out.add(NegTop(pendingNeg, child: w));
        pendingNeg = 0;
      } else {
        out.add(w);
      }
    }

    for (var i = 0; i < flow.length; i++) {
      final k = flow[i];
      double space;
      if (i == 0) {
        space = hoistT ? 0 : _top(k);
      } else {
        space = block ? _coll(_bot(flow[i - 1]), _top(k)) : _bot(flow[i - 1]) + _top(k) + gap;
      }
      Widget w = _indent(k, nodeView(context, k, iw - _ml(k), cx: cx));
      if (ai == 'center' && (k['k'] == 't' || k['k'] == 'i' || k['k'] == 'v' || k['k'] == 'r')) w = Align(alignment: Alignment.topCenter, child: w);
      if (ai == 'end' && (k['k'] == 't' || k['k'] == 'i' || k['k'] == 'v')) w = Align(alignment: Alignment.topRight, child: w);
      if (k['k'] == 'i' || k['k'] == 'v' || k['k'] == 'r') {
        if (ai != 'center' && ai != 'end') w = Align(alignment: Alignment.topLeft, child: w);
      }
      add(space, w);
    }
    final lastBot = hoistB ? 0.0 : _bot(flow.last);
    if (lastBot > 0) out.add(SizedBox(height: lastBot));
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: out);
  }

  Widget _row(BuildContext context, List<Map<String, dynamic>> flow, double iw, NodeCx cx, Map<String, dynamic> s, double gap, double rgap) {
    final ai = s['ai'];
    final cross = ai == 'center' ? CrossAxisAlignment.center : (ai == 'end' ? CrossAxisAlignment.end : CrossAxisAlignment.start);
    final jc = s['jc'];
    final main = jc == 'center'
        ? MainAxisAlignment.center
        : jc == 'end'
            ? MainAxisAlignment.end
            : jc == 'between'
                ? MainAxisAlignment.spaceBetween
                : jc == 'around'
                    ? MainAxisAlignment.spaceAround
                    : MainAxisAlignment.start;
    final wrapRow = s['wr'] == 1;
    Widget cell(Map<String, dynamic> k) {
      final w = k['k'] == 't' ? k['w'] : _s(k)['w'];
      final top = _top(k), bot = _bot(k);
      Widget v = nodeView(context, k, iw, cx: cx, inRow: true);
      if (k['k'] == 't' && w is num && w < 0.999 && _n(k['nl'], 2) > 1) v = SizedBox(width: iw * w.toDouble() + 2, child: v);
      if (wrapRow && w == null && (k['k'] == 'b' || k['k'] == 't') && !(k['k'] == 'b' && _s(k)['fit'] == 1)) v = SizedBox(width: iw, child: v);
      if (top > 0 || bot > 0) v = Padding(padding: EdgeInsets.only(top: top, bottom: bot), child: v);
      return v;
    }

    if (s['wr'] == 1) {
      return Wrap(spacing: gap, runSpacing: rgap, alignment: main == MainAxisAlignment.center ? WrapAlignment.center : (main == MainAxisAlignment.end ? WrapAlignment.end : WrapAlignment.start), crossAxisAlignment: cross == CrossAxisAlignment.center ? WrapCrossAlignment.center : WrapCrossAlignment.start, children: [for (final k in flow) cell(k)]);
    }
    final children = <Widget>[];
    for (var i = 0; i < flow.length; i++) {
      final k = flow[i];
      if (i > 0 && gap > 0) children.add(SizedBox(width: gap));
      final grow = (k['k'] == 'b' ? _s(k)['fg'] : k['fg']) == 1;
      final w = k['k'] == 't' ? k['w'] : _s(k)['w'];
      final fit = k['k'] == 'b' && _s(k)['fit'] == 1;
      if (grow || (w == null && !fit && k['k'] != 'i' && k['k'] != 'v' && k['k'] != 'r')) {
        Widget v = nodeView(context, k, iw, cx: cx, inRow: true);
        children.add(Expanded(child: v));
      } else {
        children.add(Flexible(fit: FlexFit.loose, child: cell(k)));
      }
    }
    final hasExpanded = children.any((c) => c is Expanded);
    return Row(crossAxisAlignment: cross, mainAxisAlignment: main, mainAxisSize: hasExpanded || main != MainAxisAlignment.start ? MainAxisSize.max : MainAxisSize.min, children: children);
  }

  Widget _grid(BuildContext context, List<Map<String, dynamic>> flow, double iw, NodeCx cx, double rgap) {
    // group the cells into lines by their top edge, then lay each line out with the measured left offsets
    final items = [...flow];
    items.sort((a, b) {
      final dy = _n(a['y']) - _n(b['y']);
      if (dy.abs() > 2) return dy < 0 ? -1 : 1;
      return _n(a['x']).compareTo(_n(b['x']));
    });
    final lines = <List<Map<String, dynamic>>>[];
    for (final k in items) {
      if (lines.isNotEmpty && (_n(lines.last.first['y']) - _n(k['y'])).abs() <= 2) {
        lines.last.add(k);
      } else {
        lines.add([k]);
      }
    }
    final out = <Widget>[];
    for (var li = 0; li < lines.length; li++) {
      final line = lines[li];
      final row = <Widget>[];
      var cursor = 0.0;
      for (final k in line) {
        final x = _n(k['x']);
        if (x - cursor > 0.5) row.add(SizedBox(width: x - cursor));
        final w = k['k'] == 't' ? k['w'] : _s(k)['w'];
        final px = w is num ? iw * w.toDouble() + (k['k'] == 't' ? 2 : 1) : iw;
        final single = k['k'] == 't' && _n(k['nl'], 2) <= 1;
        row.add(single ? Flexible(fit: FlexFit.loose, child: nodeView(context, k, iw, cx: cx, inRow: true)) : SizedBox(width: px, child: nodeView(context, k, iw, cx: cx, inRow: true)));
        cursor = x + (w is num ? iw * w.toDouble() : iw);
      }
      if (li > 0) out.add(SizedBox(height: rgap));
      out.add(Row(crossAxisAlignment: CrossAxisAlignment.start, children: row));
    }
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: out);
  }
}

/// A rounded box with a border on only some sides (the website's stacked sheets have none at the bottom).
class _RRectSides extends CustomPainter {
  _RRectSides(this.br, this.color, this.w, this.l, this.t, this.r, this.b);
  final BorderRadius br;
  final Color color;
  final double w;
  final bool l, t, r, b;
  @override
  void paint(Canvas c, Size sz) {
    c.save();
    c.clipRect(Rect.fromLTRB(l ? -w : 0, t ? -w : 0, sz.width + (r ? w : 0), sz.height + (b ? w : 0)).intersect(Rect.fromLTRB(l ? -w : 0, t ? -w : 0, sz.width + (r ? w : 0), sz.height + (b ? w : 0))));
    final rr = RRect.fromRectAndCorners(Rect.fromLTWH(0, 0, sz.width, sz.height).deflate(w / 2), topLeft: br.topLeft, topRight: br.topRight, bottomLeft: br.bottomLeft, bottomRight: br.bottomRight);
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = w
      ..color = color;
    // hide the sides that have no border by clipping their strip away
    c.clipRect(Rect.fromLTRB(l ? 0 : w, t ? 0 : w, r ? sz.width : sz.width - w, b ? sz.height : sz.height - w));
    c.drawRRect(rr, p);
    c.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => true;
}

class _DashedBorder extends CustomPainter {
  _DashedBorder(this.bd);
  final Map<String, dynamic> bd;
  @override
  void paint(Canvas c, Size sz) {
    void line(String k, Offset a, Offset b) {
      final x = bd[k];
      if (x is! List || x.length < 3 || x[2] != 'd') return;
      final p = Paint()
        ..color = _hx(x[1]) ?? M.line
        ..strokeWidth = _n(x[0]);
      final len = (b - a).distance;
      final dir = (b - a) / len;
      for (double d = 0; d < len; d += 10) {
        final e = d + 5 > len ? len : d + 5;
        c.drawLine(a + dir * d, a + dir * e, p);
      }
    }

    line('t', Offset.zero, Offset(sz.width, 0));
    line('b', Offset(0, sz.height - 1), Offset(sz.width, sz.height - 1));
    line('l', Offset.zero, Offset(0, sz.height));
    line('r', Offset(sz.width - 1, 0), Offset(sz.width - 1, sz.height));
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

class _AccNode extends StatefulWidget {
  const _AccNode(this.n, this.iw, {required this.cx});
  final Map<String, dynamic> n;
  final double iw;
  final NodeCx cx;
  @override
  State<_AccNode> createState() => _AccNodeState();
}

class _AccNodeState extends State<_AccNode> {
  late bool open = widget.n['o'] == 1;
  @override
  Widget build(BuildContext context) {
    final n = widget.n;
    final hd = n['hd'] as Map?;
    final bd = n['bd'] as Map?;
    final line = n['line'];
    Widget col = Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      if (hd != null) GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => setState(() => open = !open), child: nodeView(context, hd.cast<String, dynamic>(), widget.iw, cx: widget.cx)),
      if (open && bd != null) nodeView(context, bd.cast<String, dynamic>(), widget.iw, cx: widget.cx),
    ]);
    if (line is List) {
      col = DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: _hx(line[1]) ?? M.line, width: _n(line[0])))), child: col);
    }
    return col;
  }
}

/// A whole section of a page (its root node) drawn at the full width available.
class SectionView extends StatelessWidget {
  const SectionView(this.root, {super.key});
  final Map<String, dynamic> root;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (c, cs) => nodeView(c, root, cs.maxWidth));
}
