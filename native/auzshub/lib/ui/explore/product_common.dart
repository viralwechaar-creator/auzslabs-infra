import 'package:flutter/material.dart' hide Text;
import '../../core/api.dart';
import '../../core/orderdata.dart';
import '../../core/session.dart';
import '../../core/util.dart';
import '../cart.dart';
import '../i18n.dart';
import '../mk.dart';
import '../pricing.dart';
import '../theme.dart';

/// Shared by the eight native product detail pages (`product_*.dart`): a feature card (same look
/// as `home_page.dart`/`why_page.dart`'s `_card`) and the "what's included" row used by several of
/// them. Kept here instead of copy-pasted eight times.
Widget productHero(String eyebrow, String headline, String sub) => Container(
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(22)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(eyebrow, style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
        const SizedBox(height: 10),
        Text(headline, style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
        const SizedBox(height: 10),
        Text(sub, style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
      ]),
    );

Widget productCard(List<Widget> kids) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: kids),
      ),
    );

/// One "what's included" row: a short title and its one-line explanation.
Widget includedRow(String title, String body, {bool optional = false}) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(optional ? Icons.add_circle_outline : Icons.check_circle_outline, color: optional ? Tk.label3 : Tk.green, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800)),
          const SizedBox(height: 3),
          Text(body, style: TextStyle(color: Tk.label2, fontSize: 13.5, height: 1.4)),
        ])),
      ]),
    );

/// "Pairs well with": a row of pill links to the other product pages this one mentions.
Widget pairsWith(List<(String, Widget Function())> others) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Wrap(spacing: 8, runSpacing: 8, children: [
        for (final o in others) Builder(builder: (context) => ActionChip(label: Text(o.$1), onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => o.$2())))),
      ]),
    );

/// A live-priced "Add to cart" card: reads the same `public_product_prices` RPC
/// `ProductsPricingPage` reads, so a price here never drifts from pricing, and adds to the same
/// on-phone `Cart` (`core/orderdata.dart`) the website flow and pricing screen use -- no parallel
/// cart mechanism. Pass [includedWith] (e.g. 'pos') when this product has no price of its own and
/// is bundled with another one instead.
class LivePriceCard extends StatefulWidget {
  const LivePriceCard(this.s, this.productKey, {this.includedWith, super.key});
  final HubSession s;
  final String productKey;
  final String? includedWith;
  @override
  State<LivePriceCard> createState() => _LivePriceCardState();
}

class _LivePriceCardState extends State<LivePriceCard> {
  bool loading = true;
  Map<String, dynamic>? price;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  num _n(dynamic v) => v is num ? v : (num.tryParse('$v') ?? 0);

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('public_product_prices');
      final list = (r is List ? r : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      for (final p in list) {
        if (p['key'] == widget.productKey) {
          price = p;
          break;
        }
      }
    } on ApiError catch (e) {
      err = e.networkError ? 'Could not load the price.' : e.message;
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _add() async {
    final key = widget.includedWith ?? widget.productKey;
    final cur = await Cart.get();
    final next = {...cur, key}.toList();
    await Cart.set(next);
    if (!mounted) return;
    toast(context, '${productLabels[key] ?? key} added to your cart.');
    await Navigator.push(context, MaterialPageRoute<void>(builder: (_) => CartPage(widget.s)));
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
    final p = price;
    final value = _n(p?['monthly_price']);
    final bundled = widget.includedWith != null;
    return productCard([
      if (err != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(err!, style: TextStyle(color: Tk.red))),
      if (bundled)
        Text('Included with ${productLabels[widget.includedWith] ?? widget.includedWith}. There is nothing separate to buy.', style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.35))
      else if (p != null && value > 0)
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(inr(value), style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
          Padding(padding: const EdgeInsets.only(left: 4, bottom: 4), child: Text('/month', style: TextStyle(color: Tk.label2, fontSize: 14))),
        ])
      else
        Text('See the full price list for this.', style: TextStyle(color: Tk.label2, fontSize: 14)),
      const SizedBox(height: 12),
      SizedBox(width: double.infinity, child: FilledButton(onPressed: _add, child: Text(bundled ? 'Add ${productLabels[widget.includedWith] ?? ''} to cart' : 'Add to cart'))),
      const SizedBox(height: 8),
      SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => ProductsPricingPage(widget.s))), child: const Text('See all prices and bundles'))),
    ]);
  }
}
