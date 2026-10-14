import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/orderdata.dart';
import '../core/session.dart';
import 'guest.dart';
import 'i18n.dart';
import 'mk.dart';
import 'pay.dart';
import 'theme.dart';

/// Ask for products: pick them, tell us about the business, send. Same request as the website cart (submit_client_order).
class CartPage extends StatefulWidget {
  const CartPage(this.s, {super.key});
  final HubSession s;
  @override
  State<CartPage> createState() => _CartPageState();
}

class _CartPageState extends State<CartPage> {
  final name = TextEditingController(), phone = TextEditingController(), biz = TextEditingController(), slug = TextEditingController();
  final gstin = TextEditingController(), address = TextEditingController(), req = TextEditingController(), notes = TextEditingController();
  String niche = 'cafe', state = '';
  List<String> picked = [];
  bool busy = false, ready = false;
  String? err;

  /// An owner who already has a business adds products to it, so the business fields are not asked.
  bool get hasBusiness => widget.s.kind == Kind.business;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    picked = await Cart.get();
    if (!hasBusiness) {
      try {
        final r = await widget.s.api.rpc('my_profile');
        final p = r is Map ? r['profile'] : null;
        if (p is Map) {
          name.text = '${p['name'] ?? ''}';
          phone.text = '${p['phone'] ?? ''}';
          biz.text = '${p['business_name'] ?? ''}';
          address.text = '${p['address'] ?? ''}';
          notes.text = '${p['notes'] ?? ''}';
          if (nicheOptions.any((o) => o.$1 == p['niche'])) niche = '${p['niche']}';
        }
      } catch (_) {}
    }
    if (mounted) setState(() => ready = true);
  }

  @override
  void dispose() {
    for (final c in [name, phone, biz, slug, gstin, address, req, notes]) {
      c.dispose();
    }
    super.dispose();
  }

  void _gst(String v) {
    final x = v.trim().toUpperCase();
    if (x.length >= 2 && stateNames.containsKey(x.substring(0, 2))) setState(() => state = x.substring(0, 2));
  }

  Future<void> _send() async {
    String? bad;
    if (name.text.trim().isEmpty) {
      bad = 'Please enter your name.';
    } else if (!phoneOk(phone.text)) {
      bad = 'Please enter your mobile number (10 digits).';
    } else if (!hasBusiness && biz.text.trim().isEmpty) {
      bad = 'Please enter your business name.';
    } else if (req.text.trim().isEmpty) {
      bad = 'Please tell us what you need.';
    }
    if (bad != null) {
      setState(() => err = bad);
      return;
    }
    if (!widget.s.signedIn) {
      // Exploring needs no account; sending a request does. Sign in or create one, then carry on with what was typed.
      if (!await requireAccount(context, widget.s, tab: 1)) return;
      if (!mounted) return;
    }
    setState(() {
      busy = true;
      err = null;
    });
    try {
      final r = await widget.s.api.rpc('submit_client_order', {
        'p': {
          'contact_name': name.text.trim(), 'phone': phone.text.trim(), 'email': widget.s.email, 'business_name': biz.text.trim(), 'niche': niche, 'slug': slug.text.trim(),
          'gstin': gstin.text.trim(), 'state_code': state, 'address': address.text.trim(), 'requirement': req.text.trim(), 'notes': notes.text.trim(), 'products': picked,
        }
      });
      await Cart.clear();
      if (!mounted) return;
      final token = r is Map ? '${r['token']}' : '';
      toast(context, 'Thank you. We have your request.');
      if (token.isNotEmpty) {
        await Navigator.pushReplacement(context, MaterialPageRoute<void>(builder: (_) => PayPage(widget.s, token)));
      } else {
        Navigator.pop(context);
      }
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          err = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!ready) return const SubPage('My cart', [Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))]);
    return SubPage('My cart', [
      const Hint('Pick what you need and tell us about your business. We check it and send a quote. Nothing is charged before you get our payment link.'),
      Pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Products', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        for (final e in productLabels.entries)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(e.value),
            value: picked.contains(e.key),
            onChanged: (v) async {
              setState(() => v == true ? picked.add(e.key) : picked.remove(e.key));
              await Cart.set(picked);
            },
          ),
        Text('Not sure? Leave them empty and describe what you need below.', style: TextStyle(fontSize: 13, color: Tk.label2)),
      ])),
      Pad(Fld('Your name', name)),
      Pad(Fld('Mobile number (WhatsApp)', phone, phone: true)),
      if (!hasBusiness) ...[
        Pad(Fld('Business name', biz)),
        Pad(Sel('Business type', niche, nicheOptions, (v) => setState(() => niche = v))),
        Pad(Fld('Business address you would like (optional)', slug, hint: 'Your workspace will be ${slug.text.isEmpty ? 'mybusiness' : slug.text.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '')}.auzslab.in', onChanged: (_) => setState(() {}))),
      ],
      Pad(Fld('GSTIN (if you have one)', gstin, onChanged: _gst)),
      Pad(Sel('State', state, [for (final e in stateNames.entries) (e.key, e.value)], (v) => setState(() => state = v))),
      Pad(Fld('Business address', address, multiline: true)),
      Pad(Fld('What do you need?', req, multiline: true, hint: 'How your business works, outlets, staff, billing, stock, payroll, bookings...')),
      Pad(Fld('Anything else we should know? (optional)', notes, multiline: true)),
      if (err != null) Note(err!, bad: true),
      Pad(FilledButton(onPressed: busy ? null : _send, child: Text(busy ? 'Sending...' : 'Send request'))),
    ]);
  }
}
