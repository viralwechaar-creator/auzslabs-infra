import 'dart:typed_data';
import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/orderdata.dart';
import '../core/session.dart';
import '../core/util.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

List<Map<String, dynamic>> maps(dynamic r) => (r is List ? r : const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
num n0(dynamic v) => v is num ? v : (num.tryParse('$v') ?? 0);
num r2(num v) => (v * 100).round() / 100;

String waDigits(String p) {
  final d = p.replaceAll(RegExp(r'\D'), '');
  return d.length == 10 ? '91$d' : d;
}

Future<void> openWa(String phone, String text) => launchUrl(Uri.parse('https://wa.me/${waDigits(phone)}?text=${Uri.encodeComponent(text)}'), mode: LaunchMode.externalApplication);

const orderStatusNames = {
  'new': 'Received',
  'requested': 'Received',
  'verifying': 'Under verification',
  'confirmed': 'Confirmed',
  'link_sent': 'Payment link sent',
  'payment_submitted': 'Payment submitted',
  'paid': 'Paid',
  'rejected': 'Rejected',
};
const orderFilters = <(String, String)>[('active', 'Active'), ('new', 'New'), ('link_sent', 'Link sent'), ('payment_submitted', 'To confirm'), ('paid', 'Paid'), ('all', 'All')];

/// Same arithmetic as client_order_totals() in the database (the saved totals always come from the database).
Map<String, dynamic> calcQuote(Map q, String? stateCode) {
  final intra = (stateCode == null || stateCode.isEmpty ? '08' : stateCode) == '08';
  num sub = 0, tax = 0, g = 0;
  final lines = <Map<String, dynamic>>[];
  void add(String type, String label, num rate, num disc, num gst, [String? plan]) {
    final net = r2(rate - disc), ga = (net * gst).round() / 100;
    lines.add({'type': type, 'label': label, 'plan': plan, 'rate': rate, 'discount': disc, 'net': net, 'gst': gst, 'gst_amt': ga});
    sub += rate;
    tax += net;
    g += ga;
  }

  for (final i in (q['items'] as List? ?? const []).whereType<Map>()) {
    final r = n0(i['rate']).clamp(0, double.infinity), d = n0(i['discount']).clamp(0, r);
    add('product', productLabels['${i['key']}'] ?? '${i['key']}', r, d, n0(i['gst']).clamp(0, double.infinity), '${i['plan']}');
  }
  final o = q['onboarding'];
  if (o is Map && o['on'] == true) add('onboarding', 'Onboarding fee', n0(o['amount']).clamp(0, double.infinity), 0, n0(o['gst']));
  final su = q['setup'];
  if (su is Map && su['on'] == true) add('setup', 'Setup fee (AUZsPOS installation)', n0(su['amount']).clamp(0, double.infinity), 0, n0(su['gst']));
  for (final c in (q['custom'] as List? ?? const []).whereType<Map>()) {
    if ('${c['label'] ?? ''}'.trim().isNotEmpty) add('custom', '${c['label']}', n0(c['amount']), 0, n0(c['gst']));
  }
  g = r2(g);
  final raw = r2(tax + g), total = raw.round(), round = r2(total - raw);
  final half = (g * 50).round() / 100;
  return {'lines': lines, 'subtotal': sub, 'taxable': tax, 'intra': intra, 'cgst': intra ? half : 0, 'sgst': intra ? g - half : 0, 'igst': intra ? 0 : g, 'gst': g, 'round': round, 'total': total};
}

// ---------------------------------------------------------------- Requests

class RequestsAdmin extends StatefulWidget {
  const RequestsAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<RequestsAdmin> createState() => _RequestsAdminState();
}

class _RequestsAdminState extends State<RequestsAdmin> {
  String filter = 'active';
  List<Map<String, dynamic>>? rows;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('admin_list_client_orders', {'p_status': filter});
      if (mounted) setState(() {
            rows = maps(r);
            err = null;
          });
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = rows;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const PageHead('Requests', sub: 'Verify, quote, collect payment, bill'),
        SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), child: Row(children: [
          for (final f in orderFilters) Padding(padding: const EdgeInsets.only(right: 6), child: ChoiceChip(label: Text(f.$2), selected: filter == f.$1, onSelected: (_) {
            filter = f.$1;
            rows = null;
            _load();
          })),
        ])),
        const SizedBox(height: 8),
        if (err != null) Note(err!, bad: true),
        if (l == null && err == null) const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
        if (l != null && l.isEmpty) emptyBox(Icons.inbox_outlined, 'No requests here yet.'),
        if (l != null && l.isNotEmpty)
          Group([
            for (final o in l)
              Li('${o['business_name'] ?? ''}',
                  sub: '${'${o['created_at']}'.split('T').first} · ${o['kind'] == 'addon' ? 'add-on' : 'new'} · ${((o['products'] as List?) ?? const []).map((k) => productLabels['$k'] ?? '$k').join(', ')}',
                  trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Pill(orderStatusNames['${o['status']}'] ?? '${o['status']}', tone: o['status'] == 'paid' ? Tk.green : (o['status'] == 'rejected' ? Tk.red : (o['status'] == 'payment_submitted' ? Tk.orange : Tk.blue))),
                    if (n0(o['total']) > 0) Text(inr(n0(o['total'])), style: TextStyle(fontSize: 13, color: Tk.label2)),
                    if (o['has_proof'] == true && o['status'] != 'paid') Text('screenshot sent', style: TextStyle(fontSize: 12, color: Tk.orange)),
                  ]),
                  onTap: () async {
                    await Navigator.push(context, MaterialPageRoute<void>(builder: (_) => OrderDetail(widget.s, '${o['id']}')));
                    _load();
                  }),
          ]),
      ]),
    );
  }
}

class OrderDetail extends StatefulWidget {
  const OrderDetail(this.s, this.id, {super.key});
  final HubSession s;
  final String id;
  @override
  State<OrderDetail> createState() => _OrderDetailState();
}

class _OrderDetailState extends State<OrderDetail> {
  Map<String, dynamic>? o;
  Map<String, dynamic> q = {};
  String? err;
  bool busy = false;
  final c = <String, TextEditingController>{};
  final fee = <String, TextEditingController>{};
  final utr = TextEditingController();
  final paidOn = TextEditingController(text: DateTime.now().toIso8601String().split('T').first);
  Uint8List? proof;
  Map<String, dynamic> prices = {};
  String state = '', niche = 'cafe';

  ApiClient get api => widget.s.api;
  bool get locked => o?['status'] == 'paid' || o?['status'] == 'rejected';

  TextEditingController _c(String k, [String v = '']) => c.putIfAbsent(k, () => TextEditingController(text: v));

  @override
  void initState() {
    super.initState();
    _load();
  }

  num get defGst => n0(o?['default_gst'] ?? 18);

  Map<String, dynamic> _defaultQuote(Map<String, dynamic> d) {
    final prods = ((d['products'] as List?) ?? const []).map((e) => '$e').where(productLabels.containsKey).toList();
    final allExempt = prods.isNotEmpty && prods.every((k) => (prices[k] is Map) && prices[k]['setup_fee_exempt'] == true);
    return {
      'items': [for (final k in prods) {'key': k, 'plan': 'month', 'rate': n0((prices[k] as Map?)?['monthly_price']), 'discount': 0, 'gst': (prices[k] as Map?)?['gst_exempt'] == true ? 0 : defGst}],
      'onboarding': {'on': d['kind'] == 'new', 'amount': 1460, 'gst': 0},
      'setup': {'on': d['kind'] == 'new' && !allExempt, 'amount': 2190, 'gst': defGst},
      'custom': [],
      'note': '',
    };
  }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await api.rpc('admin_get_client_order', {'p_id': widget.id}) as Map);
      try {
        final p = await api.rpc('public_product_prices');
        prices = {for (final e in maps(p)) '${e['key']}': e};
      } catch (_) {}
      o = d;
      state = '${d['state_code'] ?? ''}';
      niche = '${d['niche'] ?? 'cafe'}';
      for (final e in {'name': d['contact_name'], 'phone': d['phone'], 'email': d['email'], 'biz': d['business_name'], 'gstin': d['gstin'], 'slug': d['slug'], 'addr': d['address']}.entries) {
        _c(e.key).text = '${e.value ?? ''}';
      }
      q = d['quote'] is Map ? Map<String, dynamic>.from(jsonClone(d['quote'])) : _defaultQuote(d);
      utr.text = '${(d['payment'] as Map?)?['utr'] ?? ''}';
      if ((d['payment'] as Map?)?['proof'] != null && proof == null) _loadProof();
      if (mounted) setState(() => err = null);
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  dynamic jsonClone(dynamic v) {
    if (v is Map) return {for (final e in v.entries) '${e.key}': jsonClone(e.value)};
    if (v is List) return [for (final e in v) jsonClone(e)];
    return v;
  }

  Future<void> _loadProof() async {
    try {
      final b = await api.getBytes('/storage/order-proof/${widget.id}');
      if (mounted) setState(() => proof = Uint8List.fromList(b));
    } catch (_) {}
  }

  Future<bool> _act(String fn, Map<String, dynamic> args, {String? done}) async {
    setState(() {
      busy = true;
      err = null;
    });
    try {
      await api.rpc(fn, args);
      if (done != null && mounted) toast(context, done);
      await _load();
      return true;
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
      return false;
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void _recalc() => setState(() {});

  dynamic _price(Map? p, bool yearly) => p == null ? null : (yearly ? p['yearly_price'] : p['monthly_price']);

  Widget _num(String label, Map m, String k) {
    final key = '${identityHashCode(m)}$k';
    final ctl = fee.putIfAbsent(key, () => TextEditingController(text: '${m[k] ?? 0}'));
    return Expanded(child: Padding(padding: const EdgeInsets.only(right: 6), child: TextField(controller: ctl, enabled: !locked, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr(label)), onChanged: (v) {
      m[k] = num.tryParse(v) ?? 0;
      _recalc();
    })));
  }

  String get payLink => 'https://auzslab.in/pay.html?t=${o?['token']}';
  String get billLink => 'https://auzslab.in/inv.html?t=${o?['token']}';

  String _payMsg() {
    final t = o?['totals'] as Map? ?? const {};
    return 'Hello ${o?['contact_name'] ?? ''},\n\nThank you for choosing AUZslab. We have checked the details of ${o?['business_name'] ?? 'your business'} and everything looks good.\n\nYour bill is ready: ${inr(n0(t['total']))} (including GST).\n\nPlease open this link to see your bill, read the terms and pay by UPI:\n$payLink\n\nAfter you pay, send us the screenshot on the same page.';
  }

  String _billMsg() {
    final t = o?['totals'] as Map? ?? const {};
    return 'Hello ${o?['contact_name'] ?? ''},\n\nYour payment of ${inr(n0(t['total']))} for ${o?['business_name'] ?? 'your business'} is confirmed. Thank you!\n\n${'${o?['tenant_slug'] ?? ''}'.isNotEmpty ? 'Your access is active at https://${o?['tenant_slug']}.auzslab.in (sign in with the same account you used to send your request).\n\n' : ''}Your GST bill ${o?['invoice_no']}:\n$billLink';
  }

  @override
  Widget build(BuildContext context) {
    final d = o;
    if (d == null) return SubPage('Request', [err == null ? const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())) : Note(err!, bad: true)]);
    final st = '${d['status']}';
    final preview = calcQuote(q, state);
    final T = (d['totals'] is Map && st == 'paid') ? Map<String, dynamic>.from(d['totals'] as Map) : preview;
    final items = (q['items'] as List).whereType<Map>().toList();
    final custom = (q['custom'] as List).whereType<Map>().toList();
    return SubPage('${d['business_name'] ?? 'Request'}', [
      Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 0), child: Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Pill(orderStatusNames[st] ?? st, tone: st == 'paid' ? Tk.green : (st == 'rejected' ? Tk.red : Tk.blue)),
        Text('${'${d['created_at']}'.split('T').first} · ${d['kind'] == 'addon' ? 'add-on to ${d['tenant_slug'] ?? 'existing business'}' : 'new business'}${'${d['user_email'] ?? ''}'.isNotEmpty ? ' · ${d['user_email']}' : ''}', style: TextStyle(color: Tk.label2, fontSize: 13)),
      ])),
      if (err != null) Note(err!, bad: true),
      if (!locked) ...[
        const SectionLabel('Status'),
        Pad(Wrap(spacing: 8, children: [
          for (final s in const [('verifying', 'Under verification'), ('confirmed', 'Confirmed')])
            ChoiceChip(label: Text(s.$2), selected: st == s.$1, onSelected: busy ? null : (_) => _act('admin_set_order_status', {'p_id': d['id'], 'p_status': s.$1})),
          ActionChip(label: Text('Reject', style: TextStyle(color: Tk.red)), onPressed: busy ? null : () async {
            if (await confirm(context, 'Reject this request?', 'The client will see that it was not accepted.', yes: 'Reject', danger: true)) _act('admin_set_order_status', {'p_id': d['id'], 'p_status': 'rejected'});
          }),
        ])),
      ],
      const SectionLabel('Client details'),
      Pad(Fld('Name', _c('name'))),
      Pad(Fld('Mobile / WhatsApp', _c('phone'), phone: true)),
      Pad(Fld('Email', _c('email'))),
      Pad(Fld('Business name', _c('biz'))),
      Pad(Fld('GSTIN', _c('gstin'), onChanged: (v) {
        final x = v.trim().toUpperCase();
        if (x.length >= 2 && stateNames.containsKey(x.substring(0, 2))) setState(() => state = x.substring(0, 2));
      })),
      Pad(Sel('State', state, [('', 'State'), for (final e in stateNames.entries) (e.key, e.value)], (v) => setState(() => state = v))),
      Pad(Sel('Business type', niche, nicheOptions, (v) => setState(() => niche = v))),
      if (d['kind'] == 'new') Pad(Fld('Address (.auzslab.in)', _c('slug'))),
      Pad(Fld('Address', _c('addr'), multiline: true)),
      if ('${d['requirement'] ?? ''}'.isNotEmpty) Pad(Note('They need: ${d['requirement']}')),
      if ('${d['notes'] ?? ''}'.isNotEmpty) Pad(Note('Notes: ${d['notes']}')),
      if (!locked)
        Pad(OutlinedButton(onPressed: busy ? null : () => _act('admin_update_client_order', {'p_id': d['id'], 'p': {'contact_name': _c('name').text, 'phone': _c('phone').text, 'email': _c('email').text, 'business_name': _c('biz').text, 'gstin': _c('gstin').text, 'state_code': state, 'niche': niche, if (d['kind'] == 'new') 'slug': _c('slug').text, 'address': _c('addr').text}}, done: 'Details saved'), child: const Text('Save details'))),
      if (st != 'rejected') ...[
        SectionLabel(st == 'paid' ? 'Bill' : 'Quote'),
        if (st != 'paid') ...[
          for (final it in items)
            Container(margin: const EdgeInsets.fromLTRB(16, 4, 16, 4), padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)), child: Column(children: [
              Row(children: [
                Expanded(child: Sel('Product', '${it['key']}', [for (final e in productLabels.entries) (e.key, e.value)], (v) {
                  it['key'] = v;
                  final p = prices[v] as Map?;
                  it['rate'] = n0(_price(p, it['plan'] == 'year'));
                  it['gst'] = p?['gst_exempt'] == true ? 0 : defGst;
                  fee.removeWhere((k, _) => k.startsWith('${identityHashCode(it)}'));
                  setState(() {});
                })),
                const SizedBox(width: 8),
                SizedBox(width: 120, child: Sel('Plan', '${it['plan']}', const [('month', 'Monthly'), ('year', 'Yearly')], (v) {
                  it['plan'] = v;
                  final p = prices['${it['key']}'] as Map?;
                  final r = n0(_price(p, v == 'year'));
                  if (r > 0) it['rate'] = r;
                  fee.removeWhere((k, _) => k.startsWith('${identityHashCode(it)}'));
                  setState(() {});
                })),
              ]),
              const SizedBox(height: 8),
              Row(children: [_num('Price', it, 'rate'), _num('Discount', it, 'discount'), _num('GST %', it, 'gst')]),
              Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => setState(() => (q['items'] as List).remove(it)), child: Text('Remove', style: TextStyle(color: Tk.red)))),
            ])),
          Pad(OutlinedButton(onPressed: () {
            final used = items.map((i) => '${i['key']}').toList();
            final k = productLabels.keys.firstWhere((x) => !used.contains(x), orElse: () => 'pos');
            final p = prices[k] as Map?;
            setState(() => (q['items'] as List).add({'key': k, 'plan': 'month', 'rate': n0(p?['monthly_price']), 'discount': 0, 'gst': p?['gst_exempt'] == true ? 0 : defGst}));
          }, child: const Text('+ Product'))),
          SwitchListTile(title: const Text('Onboarding fee (every new client)'), value: (q['onboarding'] as Map)['on'] == true, onChanged: (v) => setState(() => (q['onboarding'] as Map)['on'] = v)),
          if ((q['onboarding'] as Map)['on'] == true) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Row(children: [_num('Amount', q['onboarding'] as Map, 'amount'), _num('GST %', q['onboarding'] as Map, 'gst')])),
          SwitchListTile(title: const Text('Setup fee (AUZsPOS / AUZsPOS QR only)'), value: (q['setup'] as Map)['on'] == true, onChanged: (v) => setState(() => (q['setup'] as Map)['on'] = v)),
          if ((q['setup'] as Map)['on'] == true) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Row(children: [_num('Amount', q['setup'] as Map, 'amount'), _num('GST %', q['setup'] as Map, 'gst')])),
          for (final cu in custom)
            Container(margin: const EdgeInsets.fromLTRB(16, 4, 16, 4), padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)), child: Column(children: [
              TextField(controller: fee.putIfAbsent('${identityHashCode(cu)}label', () => TextEditingController(text: '${cu['label'] ?? ''}')), decoration: InputDecoration(labelText: tr('Charge')), onChanged: (v) {
                cu['label'] = v;
                _recalc();
              }),
              const SizedBox(height: 8),
              Row(children: [_num('Amount', cu, 'amount'), _num('GST %', cu, 'gst')]),
              Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => setState(() => (q['custom'] as List).remove(cu)), child: Text('Remove', style: TextStyle(color: Tk.red)))),
            ])),
          Pad(Wrap(spacing: 8, children: [
            OutlinedButton(onPressed: () {
              setState(() => (q['custom'] as List).add({'label': '', 'amount': 0, 'gst': defGst}));
            }, child: const Text('+ Other charge')),
            OutlinedButton(onPressed: () {
              setState(() => (q['custom'] as List).add({'label': 'Customised branding setup', 'amount': 2910, 'gst': defGst}));
            }, child: const Text('+ Branding setup 2,910')),
          ])),
          Pad(TextField(controller: _c('note', '${q['note'] ?? ''}'), decoration: InputDecoration(labelText: tr('Note on the bill (optional)')), onChanged: (v) => q['note'] = v)),
        ],
        Container(margin: const EdgeInsets.fromLTRB(16, 8, 16, 4), padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)), child: Column(children: [
          _tr('Total before GST', inr(n0(T['taxable']))),
          if (T['intra'] == true) ...[_tr('CGST', inr(n0(T['cgst']))), _tr('SGST', inr(n0(T['sgst'])))] else _tr('IGST', inr(n0(T['igst']))),
          if (n0(T['round']) != 0) _tr('Round off', inr(n0(T['round']))),
          _tr('Total', inr(n0(T['total'])), big: true),
        ])),
        if (st != 'paid') Pad(FilledButton(onPressed: busy ? null : () {
          q['note'] = _c('note').text;
          _act('admin_save_order_quote', {'p_id': d['id'], 'p_quote': q}, done: 'Quote saved');
        }, child: const Text('Save quote'))),
      ],
      if (['confirmed', 'link_sent', 'payment_submitted'].contains(st) && d['totals'] != null) ...[
        const SectionLabel('Payment link'),
        Pad(FilledButton(onPressed: busy ? null : () async {
          if (st != 'link_sent' && st != 'payment_submitted') {
            if (!await _act('admin_set_order_status', {'p_id': d['id'], 'p_status': 'link_sent'})) return;
          }
          await openWa('${d['phone']}', _payMsg());
        }, child: const Text('Send payment link on WhatsApp'))),
        Pad(OutlinedButton(onPressed: () => launchUrl(Uri.parse(payLink), mode: LaunchMode.externalApplication), child: const Text('Open the payment page'))),
        const SectionLabel('Payment'),
        Pad(Text((d['payment'] as Map?)?['submitted_at'] != null ? 'The client says they paid.${'${(d['payment'] as Map)['utr'] ?? ''}'.isNotEmpty ? ' UTR: ${(d['payment'] as Map)['utr']}.' : ''}' : 'Nothing submitted by the client yet.', style: TextStyle(color: Tk.label2))),
        if (proof != null) Padding(padding: const EdgeInsets.all(16), child: ClipRRect(borderRadius: BorderRadius.circular(12), child: proof!.length > 4 && String.fromCharCodes(proof!.take(4)) == '%PDF' ? const Note('The client sent a PDF. Open it on the website.') : Image.memory(proof!, fit: BoxFit.contain))),
        Pad(Fld('Paid on (YYYY-MM-DD)', paidOn)),
        Pad(Fld('UTR / reference', utr)),
        Pad(FilledButton(onPressed: busy ? null : () async {
          if (!await confirm(context, 'Confirm the payment?', 'This switches on their products and makes the bill (${inr(n0((d['totals'] as Map)['total']))}). It cannot be undone.', yes: 'Confirm payment')) return;
          await _act('admin_confirm_order_payment', {'p_id': d['id'], 'p_paid_on': paidOn.text.isEmpty ? null : paidOn.text, 'p_utr': utr.text.trim().isEmpty ? null : utr.text.trim()}, done: 'Payment confirmed and bill made');
        }, child: const Text('Confirm payment: switch on access and make the bill'))),
      ],
      if (st == 'paid') ...[
        Pad(Text('Bill ${d['invoice_no']} · paid ${'${d['paid_at'] ?? ''}'.split('T').first}${'${d['tenant_slug'] ?? ''}'.isNotEmpty ? ' · access: ${d['tenant_slug']}.auzslab.in' : ''}${d['bill_sent_at'] != null ? ' · bill sent ${'${d['bill_sent_at']}'.split('T').first}' : ''}', style: TextStyle(color: Tk.label2))),
        Pad(FilledButton(onPressed: () async {
          await api.rpc('admin_mark_order_bill_sent', {'p_id': d['id']});
          await openWa('${d['phone']}', _billMsg());
          _load();
        }, child: const Text('Send bill on WhatsApp'))),
        Pad(OutlinedButton(onPressed: () => launchUrl(Uri.parse(billLink), mode: LaunchMode.externalApplication), child: const Text('View bill'))),
      ],
    ]);
  }

  Widget _tr(String k, String v, {bool big = false}) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [Expanded(child: Text(k, style: TextStyle(fontSize: big ? 17 : 14, fontWeight: big ? FontWeight.w800 : FontWeight.w400))), Text(v, style: TextStyle(fontSize: big ? 18 : 14, fontWeight: FontWeight.w800))]));
}

// ---------------------------------------------------------------- Payments and bills

class MoneyAdmin extends StatefulWidget {
  const MoneyAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<MoneyAdmin> createState() => _MoneyAdminState();
}

class _MoneyAdminState extends State<MoneyAdmin> {
  var tab = 'bills';
  List<Map<String, dynamic>>? pays, bills;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await widget.s.api.rpc('admin_list_client_payments', {});
      final b = await widget.s.api.rpc('admin_list_client_bills', {});
      if (mounted) setState(() {
            pays = maps(p);
            bills = maps(b);
            err = null;
          });
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = (pays ?? const []).fold<num>(0, (a, r) => a + n0(r['amount']));
    final month = DateTime.now().toIso8601String().substring(0, 7);
    final thisMonth = (pays ?? const []).where((r) => '${r['paid_on']}'.startsWith(month)).fold<num>(0, (a, r) => a + n0(r['amount']));
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const PageHead('Money', sub: 'Payments received and GST bills'),
        if (pays != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Row(children: [_k('This month', inr(thisMonth)), _k('All time', inr(total))])),
        Padding(padding: const EdgeInsets.all(16), child: Seg<String>(expand: true, items: const [('bills', 'Bills'), ('payments', 'Payments')], value: tab, onChanged: (v) => setState(() => tab = v))),
        if (err != null) Note(err!, bad: true),
        if (pays == null && err == null) const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
        if (tab == 'payments' && pays != null) ...[
          if (pays!.isEmpty) emptyBox(Icons.payments_outlined, 'No payments recorded yet.'),
          if (pays!.isNotEmpty) Group([for (final r in pays!) Li('${r['client'] ?? ''}', sub: '${r['paid_on']} · ${r['mode']}${'${r['utr'] ?? ''}'.isNotEmpty ? ' · UTR ${r['utr']}' : ''}${'${r['purpose'] ?? ''}'.isNotEmpty ? ' · ${r['purpose']}' : ''}', value: inr(n0(r['amount'])), chevron: false)]),
        ],
        if (tab == 'bills' && bills != null) ...[
          if (bills!.isEmpty) emptyBox(Icons.receipt_long_outlined, 'No bills issued yet.'),
          if (bills!.isNotEmpty) Group([
            for (final b in bills!)
              Li('${b['business_name'] ?? ''}', sub: '${b['invoice_no']} · ${'${b['paid_at'] ?? ''}'.split('T').first}', value: inr(n0((b['totals'] as Map?)?['total'])), onTap: () => _bill(b)),
          ]),
        ],
      ]),
    );
  }

  Widget _k(String l, String v) => Expanded(child: Container(margin: const EdgeInsets.all(4), padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(l, style: TextStyle(fontSize: 12, color: Tk.label2)), Text(v, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))])));

  void _bill(Map<String, dynamic> b) {
    final link = 'https://auzslab.in/inv.html?t=${b['token']}';
    openSheet(context, '${b['invoice_no']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${b['business_name']} · ${b['gstin'] ?? ''}', style: TextStyle(color: Tk.label2)),
          Text(inr(n0((b['totals'] as Map?)?['total'])), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
          gap(),
          OutlinedButton(onPressed: () => launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication), child: const Text('View bill')),
          gap(8),
          FilledButton(onPressed: () async {
            await widget.s.api.rpc('admin_mark_order_bill_sent', {'p_id': b['id']});
            await openWa('${b['phone']}', 'Hello ${b['contact_name'] ?? ''},\n\nYour GST bill ${b['invoice_no']} from AUZslab:\n$link');
          }, child: const Text('Send on WhatsApp')),
        ]));
  }
}
