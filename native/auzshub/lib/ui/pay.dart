import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/launcher.dart';
import '../core/orderdata.dart';
import '../core/session.dart';
import '../core/util.dart';
import 'i18n.dart';
import 'mk.dart';
import 'requests.dart';
import 'theme.dart';

/// The page behind a request: status, then (once the quote is ready) the bill, terms, UPI payment and screenshot, then the paid bill.
/// Reads public_client_order by the request's token, the same call the website pay page makes.
class PayPage extends StatefulWidget {
  const PayPage(this.s, this.token, {super.key});
  final HubSession s;
  final String token;
  @override
  State<PayPage> createState() => _PayPageState();
}

class _PayPageState extends State<PayPage> {
  Map<String, dynamic>? d;
  String? err, sendErr;
  bool agree = false, busy = false;
  XFile? shot;
  final utr = TextEditingController();

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    utr.dispose();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final r = await widget.s.api.rpc('public_client_order', {'p_token': widget.token});
      if (!mounted) return;
      setState(() {
        d = r is Map ? Map<String, dynamic>.from(r) : null;
        err = d == null ? 'We could not find this request.' : null;
        if (d != null && '${(d!['payment'] as Map?)?['utr'] ?? ''}'.isNotEmpty && utr.text.isEmpty) utr.text = '${(d!['payment'] as Map)['utr']}';
        agree = agree || d?['status'] == 'payment_submitted';
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.networkError ? 'Could not load. Check your connection.' : e.message);
    }
  }

  num _n(dynamic v) => v is num ? v : (num.tryParse('$v') ?? 0);

  Future<void> _send() async {
    final has = ((d!['payment'] as Map?)?['proof']) != null;
    if (!agree) return setState(() => sendErr = 'Please tick the box to accept the terms, privacy policy and refund policy.');
    if (shot == null && !has) return setState(() => sendErr = 'Please choose the screenshot of your payment.');
    setState(() {
      busy = true;
      sendErr = null;
    });
    try {
      if (shot != null) {
        final bytes = await shot!.readAsBytes();
        if (bytes.length > 5500000) throw ApiError('That file is too big (5 MB at most). Please send a smaller screenshot.');
        await widget.s.api.uploadProof(widget.token, bytes);
      }
      await widget.s.api.rpc('public_order_submit_payment', {'p_token': widget.token, 'p_utr': utr.text.trim(), 'p_terms': true});
      shot = null;
      await load();
      if (mounted) toast(context, 'Thank you. We are confirming your payment.');
    } on ApiError catch (e) {
      if (mounted) setState(() => sendErr = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _kv(String k, String v) => v.isEmpty
      ? const SizedBox.shrink()
      : Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 110, child: Text(k, style: TextStyle(color: Tk.label2))), Expanded(child: Text(v, style: const TextStyle(fontWeight: FontWeight.w600)))]));

  Widget _card(List<Widget> kids) => Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: kids),
      );

  Widget _row(String k, String v, {bool big = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [Expanded(child: Text(k, style: TextStyle(fontSize: big ? 17 : 14, fontWeight: big ? FontWeight.w800 : FontWeight.w400))), Text(v, style: TextStyle(fontSize: big ? 18 : 14, fontWeight: FontWeight.w800))]),
      );

  /// Lines, GST split and total (the quote and the paid bill share this).
  List<Widget> billLines() {
    final t = (d!['totals'] is Map ? d!['totals'] as Map : const {});
    final lines = t['lines'] is List ? t['lines'] as List : const [];
    return [
      for (final l in lines.whereType<Map>())
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${l['label']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                if (l['type'] == 'product') Text('${l['plan'] == 'year' ? 'Yearly' : 'Monthly'} plan${l['renewal'] != null ? ' · renews ${l['renewal']}' : ''}${_n(l['gst']) > 0 ? ' · GST ${l['gst']}%' : ''}', style: TextStyle(fontSize: 12, color: Tk.label2)),
                if (_n(l['discount']) > 0) Text('Discount −${inr(_n(l['discount']))}', style: TextStyle(fontSize: 12, color: Tk.label2)),
              ]),
            ),
            Text(inr(_n(l['rate']) - _n(l['discount'])), style: const TextStyle(fontWeight: FontWeight.w700)),
          ]),
        ),
      const Divider(),
      _row('Total before GST', inr(_n(t['taxable']))),
      if (t['intra'] == true) ...[_row('CGST', inr(_n(t['cgst']))), _row('SGST', inr(_n(t['sgst'])))] else _row('IGST', inr(_n(t['igst']))),
      if (_n(t['round']) != 0) _row('Round off', '${_n(t['round']) > 0 ? '+' : ''}${inr(_n(t['round']))}'),
      _row('Total to pay', inr(_n(t['total'])), big: true),
      if ('${(d!['quote'] as Map?)?['note'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${(d!['quote'] as Map)['note']}', style: TextStyle(color: Tk.label2, fontSize: 13))),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final x = d;
    if (x == null) return SubPage('Your request', [err == null ? const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())) : Note(err!, bad: true)]);
    final st = '${x['status']}';
    final info = statusOf(st);
    final kids = <Widget>[
      _card([
        Text(info.$1, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        Text(info.$2, style: TextStyle(color: Tk.label2)),
        const SizedBox(height: 8),
        _kv('Name', '${x['contact_name'] ?? ''}'),
        _kv('Mobile', '${x['phone'] ?? ''}'),
        _kv('Business', '${x['business_name'] ?? ''}'),
        _kv('GSTIN', '${x['gstin'] ?? ''}'),
        _kv('Address', '${x['address'] ?? ''}'),
        _kv('You asked', '${x['requirement'] ?? ''}'),
      ]),
    ];
    if (st == 'paid') {
      final slug = '${x['tenant_slug'] ?? ''}';
      kids.add(_card([
        Text('Bill ${x['invoice_no'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        Text('Paid on ${'${x['paid_at'] ?? ''}'.split('T').first}${x['payment'] is Map && '${(x['payment'] as Map)['utr'] ?? ''}'.isNotEmpty ? ' · UTR ${(x['payment'] as Map)['utr']}' : ''}', style: TextStyle(color: Tk.label2)),
        const SizedBox(height: 8),
        ...billLines(),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: () => launchUrl(Uri.parse('${siteBase}inv.html?t=${Uri.encodeComponent(widget.token)}'), mode: LaunchMode.externalApplication), child: const Text('Open printable bill (A4)')),
        if (slug.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text('Your workspace: $slug.auzslab.in. Sign in with the same account you used for this request.', style: TextStyle(color: Tk.label2, fontSize: 13))),
        const SizedBox(height: 8),
        FilledButton(onPressed: () async {
          await widget.s.load();
          if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
        }, child: const Text('Open my apps')),
      ]));
    } else if (st == 'link_sent' || st == 'payment_submitted') {
      final total = _n((x['totals'] as Map?)?['total']);
      final uri = 'upi://pay?pa=${Uri.encodeComponent(upiId)}&pn=${Uri.encodeComponent(upiName)}&am=${total.toStringAsFixed(2)}&cu=INR&tn=${Uri.encodeComponent('AUZslab ${x['business_name'] ?? ''}')}';
      kids.addAll([
        _card([const Text('Your bill', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)), const SizedBox(height: 6), ...billLines()]),
        _card([
          const Text('Terms, privacy and refunds', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 6),
          for (final t in orderTerms) ...[Text(t.$1, style: const TextStyle(fontWeight: FontWeight.w700)), Text(t.$2, style: TextStyle(color: Tk.label2, fontSize: 13)), const SizedBox(height: 8)],
          Row(children: [
            TextButton(onPressed: () => launchUrl(Uri.parse('${siteBase}terms.html')), child: const Text('Terms')),
            TextButton(onPressed: () => launchUrl(Uri.parse('${siteBase}privacy.html')), child: const Text('Privacy')),
            TextButton(onPressed: () => launchUrl(Uri.parse('${siteBase}refund.html')), child: const Text('Refunds')),
          ]),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: agree,
            onChanged: (v) => setState(() => agree = v ?? false),
            title: const Text('I have read and I agree to the Terms & Conditions, Privacy Policy and Refund Policy.'),
          ),
        ]),
        _card([
          Text('Pay ${inr(total)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          const SizedBox(height: 4),
          Text('Pay to $upiId ($upiName) with any UPI app, then send the screenshot below.', style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 10),
          OutlinedButton(onPressed: () => launchUrl(Uri.parse(uri), mode: LaunchMode.externalApplication), child: const Text('Open my UPI app')),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () async {
              final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, imageQuality: 80);
              if (f != null) setState(() => shot = f);
            },
            child: Text(shot == null ? 'Choose the payment screenshot' : 'Screenshot chosen: ${shot!.name}'),
          ),
          if ((x['payment'] as Map?)?['proof'] != null) Text('We already have a screenshot from you.', style: TextStyle(color: Tk.label2, fontSize: 13)),
          const SizedBox(height: 10),
          Fld('UTR / reference number (optional)', utr, number: true),
          if (sendErr != null) Note(sendErr!, bad: true),
          const SizedBox(height: 10),
          FilledButton(onPressed: busy ? null : _send, child: Text(busy ? 'Sending...' : (st == 'payment_submitted' ? 'Send again' : 'I have paid: send screenshot'))),
        ]),
      ]);
    }
    return SubPage('Your request', kids, actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh))]);
  }
}
