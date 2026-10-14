import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/orderdata.dart';
import '../core/session.dart';
import '../core/util.dart';
import 'cart.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// Icons/tones for the product keys this page prices (website_builder and salon stay on the
/// manual-request flow, same as the cart, so they are not priced cards here).
const _icon = <String, IconData>{'pos': Icons.point_of_sale, 'self_order': Icons.qr_code, 'payroll': Icons.groups_outlined, 'accounting': Icons.receipt_long_outlined, 'mobile': Icons.smartphone, 'scan': Icons.qr_code_scanner};

/// A flat, not admin-editable one-time fee on every new signup, same constant as the server's own
/// (server/src/payments.js SETUP_FEE) -- not something an RPC can drift away from under us.
const onboardingFee = 1460.0;

/// One-time setup fee, charged only when AUZsPOS/AUZsPOS QR is part of the order (same constant
/// as server/src/payments.js SETUP_FEE and site/pricing.html's own firstBill calculator).
const setupFee = 2190.0;

/// "Products and pricing": the native equivalent of site/pricing.html and site/products.html.
/// Reads the SAME public, no-login RPCs the website pricing page reads (public_product_prices,
/// public_bundles, public_addon_price_overrides) so a price the admin changes here never drifts
/// from what is shown there; nothing here is a hardcoded product price. Each card adds its
/// product(s) to the same on-phone cart CartPage reads (core/orderdata.dart's Cart) and opens it.
class ProductsPricingPage extends StatefulWidget {
  const ProductsPricingPage(this.s, {super.key});
  final HubSession s;
  @override
  State<ProductsPricingPage> createState() => _ProductsPricingPageState();
}

class _ProductsPricingPageState extends State<ProductsPricingPage> {
  bool loading = true;
  String? err;
  List<Map<String, dynamic>> products = [], bundles = [], overrides = [];
  num gstPct = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  num _n(dynamic v) => v is num ? v : (num.tryParse('$v') ?? 0);

  Future<void> _load() async {
    setState(() {
      loading = true;
      err = null;
    });
    try {
      final results = await Future.wait([widget.s.api.rpc('public_product_prices'), widget.s.api.rpc('public_bundles'), widget.s.api.rpc('public_addon_price_overrides')]);
      List<Map<String, dynamic>> list(dynamic r) => (r is List ? r : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      products = list(results[0]);
      bundles = list(results[1]);
      overrides = list(results[2]);
      try {
        final c = await widget.s.api.paymentConfig();
        gstPct = _n(c['gstPct']);
      } catch (_) {}
    } on ApiError catch (e) {
      err = e.networkError ? 'Could not load prices. Check your connection.' : e.message;
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Map<String, dynamic>? _price(String key) {
    for (final p in products) {
      if (p['key'] == key) return p;
    }
    return null;
  }

  bool get gstOn => gstPct > 0;

  Future<void> _add(List<String> keys, String what) async {
    final cur = await Cart.get();
    final next = {...cur, ...keys.where(productLabels.containsKey)}.toList();
    await Cart.set(next);
    if (!mounted) return;
    toast(context, '$what added to your cart.');
    await Navigator.push(context, MaterialPageRoute<void>(builder: (_) => CartPage(widget.s)));
  }

  Widget _card(List<Widget> kids) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: kids),
        ),
      );

  Widget _priceLine(num price, {num? strikeFrom, bool gstExempt = false}) => Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        if (strikeFrom != null && strikeFrom > price) Padding(padding: const EdgeInsets.only(right: 6), child: Text(inr(strikeFrom), style: TextStyle(fontSize: 16, color: Tk.label3, decoration: TextDecoration.lineThrough))),
        Text(inr(price), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
        Padding(padding: const EdgeInsets.only(left: 2, bottom: 3), child: Text('/mo${gstOn && !gstExempt ? ' + GST' : ''}', style: TextStyle(fontSize: 13, color: Tk.label2))),
      ]);

  /// One product (pos, self_order, payroll, accounting, scan): monthly price, Add to cart.
  Widget _productCard(String key) {
    final p = _price(key);
    final price = _n(p?['monthly_price']);
    if (p == null || price <= 0) return const SizedBox.shrink();
    final exempt = p['gst_exempt'] == true;
    return _card([
      Row(children: [
        Container(width: 40, height: 40, decoration: BoxDecoration(color: Tk.accentSoft, borderRadius: BorderRadius.circular(11)), child: Icon(_icon[key] ?? Icons.apps, color: Tk.accentText, size: 22)),
        const SizedBox(width: 12),
        Expanded(child: Text('${p['label'] ?? productLabels[key] ?? key}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
      ]),
      const SizedBox(height: 10),
      _priceLine(price, gstExempt: exempt),
      if (exempt) Padding(padding: const EdgeInsets.only(top: 2), child: Text('No GST, no setup fee.', style: TextStyle(color: Tk.label2, fontSize: 13))),
      const SizedBox(height: 12),
      SizedBox(width: double.infinity, child: FilledButton(onPressed: () => _add([key], '${p['label'] ?? productLabels[key]}'), child: const Text('Add to cart'))),
    ]);
  }

  /// AUZsMob: its own pricing shape (yearly first-year + renewal, no GST, no setup fee).
  Widget _mobileCard() {
    final p = _price('mobile');
    final price = _n(p?['monthly_price']);
    if (p == null || price <= 0) return const SizedBox.shrink();
    final y = _n(p['yearly_price']), ry = _n(p['renewal_yearly_price']);
    final save = y > 0 ? price * 12 - y : 0;
    return _card([
      Row(children: [
        Container(width: 40, height: 40, decoration: BoxDecoration(color: Tk.accentSoft, borderRadius: BorderRadius.circular(11)), child: Icon(_icon['mobile'], color: Tk.accentText, size: 22)),
        const SizedBox(width: 12),
        const Expanded(child: Text('AUZsMob', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
      ]),
      const SizedBox(height: 10),
      Row(crossAxisAlignment: CrossAxisAlignment.end, children: [Text(inr(price), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)), Padding(padding: const EdgeInsets.only(left: 2, bottom: 3), child: Text('/mo', style: TextStyle(fontSize: 13, color: Tk.label2)))]),
      if (y > 0) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Or ${inr(y)} for the first year${save > 0 ? ' (save ${inr(save)})' : ''}${ry > 0 ? ', then ${inr(ry)} a year from year two' : ''}. No GST, no setup fee.', style: TextStyle(color: Tk.label2, fontSize: 13))),
      const SizedBox(height: 12),
      SizedBox(width: double.infinity, child: FilledButton(onPressed: () => _add(['mobile'], 'AUZsMob'), child: const Text('Add to cart'))),
    ]);
  }

  Widget _bundleCard(Map<String, dynamic> b) {
    final m = _n(b['monthly_price']), list = _n(b['list_price']), y = _n(b['yearly_price']);
    final keys = (b['feature_keys'] as List?)?.map((e) => '$e').toList() ?? const <String>[];
    final badge = '${b['badge'] ?? ''}', label = '${b['label'] ?? ''}';
    final hot = badge.toLowerCase().contains('popular');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: hot ? Tk.accent : Tk.line, width: hot ? 1.4 : .5)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (badge.isNotEmpty) Pill(badge, tone: hot ? Tk.accent : null),
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
          const SizedBox(height: 4),
          Wrap(spacing: 8, runSpacing: 4, children: [for (final k in keys) Pill(productLabels[k] ?? k)]),
          const SizedBox(height: 10),
          _priceLine(m, strikeFrom: list),
          if (list > m) Padding(padding: const EdgeInsets.only(top: 2), child: Text('Save ${inr(list - m)}/month vs. buying separately.', style: TextStyle(color: Tk.label2, fontSize: 13))),
          if (y > 0) Padding(padding: const EdgeInsets.only(top: 2), child: Text('Or pay ${inr(y)} for the whole year${y < m * 12 ? ' (save ${inr(m * 12 - y)})' : ''}.', style: TextStyle(color: Tk.label2, fontSize: 13))),
          if ('${b['blurb'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('${b['blurb']}', style: TextStyle(color: Tk.label2, fontSize: 14))),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => _add(keys, label), child: Text('Get ${badge.isNotEmpty ? badge : label}'))),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const SubPage('Products and pricing', [Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))]);
    final priced = products.where((p) => p['key'] != 'mobile' && _n(p['monthly_price']) > 0).toList();
    final addon = overrides.isEmpty ? null : overrides.first;
    return SubPage('Products and pricing', [
      const Hint('Start with what you need, add more as you grow. No hidden per-seat fees. Prices update here the moment they change, nothing is hardcoded in the app.'),
      if (err != null) Note(err!, bad: true),
      if (priced.isNotEmpty) const SectionLabel('Products'),
      for (final p in priced) _productCard('${p['key']}'),
      _mobileCard(),
      if (addon != null) Note('Already on AUZsPOS and want to add AUZsPay? The add-on price for existing AUZsPOS customers is ${inr(_n(addon['monthly_price']))}/month${gstOn ? ' + GST' : ''}. Add it from your account page or the website.'),
      if (bundles.isNotEmpty) ...[const SectionLabel('Bundles'), for (final b in bundles) _bundleCard(b)],
      const SectionLabel('Setup & onboarding'),
      _card([
        Row(children: [const Expanded(child: Text('Onboarding fee, every new account', style: TextStyle(fontWeight: FontWeight.w600))), Text(inr(onboardingFee), style: const TextStyle(fontWeight: FontWeight.w800))]),
        const SizedBox(height: 8),
        Row(children: [const Expanded(child: Text('Setup fee, only with AUZsPOS / AUZsPOS QR', style: TextStyle(fontWeight: FontWeight.w600))), Text(inr(setupFee), style: const TextStyle(fontWeight: FontWeight.w800))]),
        const SizedBox(height: 10),
        Text('The onboarding fee applies once, with your first payment. The setup fee only applies when AUZsPOS or AUZsPOS QR is part of your order. Neither has GST. Hardware, integrations and large data migrations are quoted and agreed with you before any charge.', style: TextStyle(color: Tk.label2, fontSize: 13)),
      ]),
      if (gstOn) const Note('All prices above are shown excluding GST (18% on the subscription only). The cart shows the exact total, GST included, for what you pick.'),
      Pad(OutlinedButton(onPressed: _load, child: const Text('Refresh prices'))),
      const SizedBox(height: 10),
    ]);
  }
}
