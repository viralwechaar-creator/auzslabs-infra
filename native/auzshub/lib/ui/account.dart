import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/orderdata.dart';
import '../core/session.dart';
import 'cart.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'requests.dart';
import 'theme.dart';

/// My account and purchases: profile, what the business owns, requests and bills, ask for more products.
class AccountPage extends StatefulWidget {
  const AccountPage(this.s, {super.key});
  final HubSession s;
  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  final name = TextEditingController(), phone = TextEditingController(), biz = TextEditingController(), city = TextEditingController(), address = TextEditingController();
  String niche = 'cafe';
  bool ready = false, busy = false;
  String? err;
  List<Map<String, dynamic>> orders = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('my_profile');
      final p = r is Map ? r['profile'] : null;
      if (p is Map) {
        name.text = '${p['name'] ?? ''}';
        phone.text = '${p['phone'] ?? ''}';
        biz.text = '${p['business_name'] ?? ''}';
        city.text = '${p['city'] ?? ''}';
        address.text = '${p['address'] ?? ''}';
        if (nicheOptions.any((o) => o.$1 == p['niche'])) niche = '${p['niche']}';
      }
      final o = await widget.s.api.rpc('my_client_orders');
      orders = (o is List ? o : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } on ApiError catch (e) {
      err = e.message;
    }
    if (mounted) setState(() => ready = true);
  }

  @override
  void dispose() {
    for (final c in [name, phone, biz, city, address]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (name.text.trim().isEmpty) return setState(() => err = 'Please enter your name.');
    if (!phoneOk(phone.text)) return setState(() => err = 'Please enter a valid phone number.');
    setState(() {
      busy = true;
      err = null;
    });
    try {
      await widget.s.api.rpc('save_my_profile', {
        'p': {'name': name.text.trim(), 'phone': phone.text.trim(), 'contact_email': widget.s.email, 'business_name': biz.text.trim(), 'niche': niche, 'city': city.text.trim(), 'address': address.text.trim()}
      });
      if (mounted) toast(context, 'Saved.');
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    final owned = [for (final e in productLabels.entries) if (s.own(e.key)) e.value];
    return SubPage('My account', [
      PageHead(s.kind == Kind.business && s.businessName.isNotEmpty ? s.businessName : 'Your account', sub: s.email),
      if (!ready) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
      if (ready) ...[
        if (owned.isNotEmpty) ...[const SectionLabel('Your products'), Pad(Wrap(spacing: 6, runSpacing: 6, children: [for (final o in owned) Pill(o)]))],
        const SectionLabel('Your details'),
        Pad(Fld('Your name', name)),
        Pad(Fld('Mobile number', phone, phone: true)),
        Pad(Fld('Business name', biz)),
        Pad(Sel('Business type', niche, nicheOptions, (v) => setState(() => niche = v))),
        Pad(Fld('City', city)),
        Pad(Fld('Address', address, multiline: true)),
        if (err != null) Note(err!, bad: true),
        Pad(FilledButton(onPressed: busy ? null : _save, child: Text(busy ? 'Saving...' : 'Save details'))),
        const SectionLabel('Purchases'),
        Group([
          Li('My requests and bills', sub: orders.isEmpty ? 'Nothing asked for yet' : '${orders.length} request${orders.length == 1 ? '' : 's'}', icon: Icons.assignment_outlined, tone: Tk.blue, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => RequestsPage(s)))),
          Li('Ask for more products', sub: 'Add products or a new business', icon: Icons.add_shopping_cart, tone: Tk.teal, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => CartPage(s)))),
        ]),
      ],
    ]);
  }
}
