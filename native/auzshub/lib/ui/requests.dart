import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/launcher.dart';
import '../core/session.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// label, line under it, how many of the five steps are done
const requestStatus = <String, (String, String, int)>{
  'requested': ('Received', 'We have your request.', 1),
  'new': ('Received', 'We have your request.', 1),
  'verifying': ('Being checked', 'We are checking your business details.', 2),
  'confirmed': ('Confirmed', 'Your payment link is being prepared.', 2),
  'link_sent': ('Ready to pay', 'Your quote is ready. Read it and pay.', 3),
  'payment_submitted': ('Payment received', 'We are confirming your payment.', 4),
  'paid': ('Active', 'Paid. Your access is active.', 5),
  'rejected': ('Not accepted', 'We could not accept this request. Contact us for help.', 0),
};
const requestSteps = ['Asked', 'Checked', 'Pay', 'Confirmed', 'Active'];

(String, String, int) statusOf(String? s) => requestStatus[s] ?? (s ?? '', '', 0);

/// What the person asked for and where each request is (asked, checked, payment link, paid, active).
class RequestsPage extends StatefulWidget {
  const RequestsPage(this.s, {super.key});
  final HubSession s;
  @override
  State<RequestsPage> createState() => _RequestsPageState();
}

class _RequestsPageState extends State<RequestsPage> {
  List<Map<String, dynamic>>? rows;
  String? err;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    load();
    timer = Timer.periodic(const Duration(seconds: 30), (_) => load());
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final r = await widget.s.api.rpc('my_client_orders');
      if (!mounted) return;
      setState(() {
        rows = (r is List ? r : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        err = null;
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.networkError ? 'Could not load your requests. Check your connection.' : e.message);
    }
  }

  Widget _steps(int n) => Padding(
        padding: const EdgeInsets.only(top: 10, bottom: 2),
        child: Row(children: [
          for (var i = 0; i < requestSteps.length; i++)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Column(children: [
                  Container(height: 4, decoration: BoxDecoration(color: n > 0 && i < n ? Tk.accent : Tk.line2, borderRadius: BorderRadius.circular(2))),
                  const SizedBox(height: 4),
                  Text(requestSteps[i], style: TextStyle(fontSize: 11, color: n > 0 && i < n ? Tk.accentText : Tk.label2)),
                ]),
              ),
            ),
        ]),
      );

  Widget _card(Map<String, dynamic> o) {
    final st = statusOf('${o['status']}');
    final prods = (o['products'] is List ? (o['products'] as List).join(', ') : '');
    final token = Uri.encodeComponent('${o['token']}');
    Future<void> site(String path) => launchUrl(Uri.parse('$siteBase$path'), mode: LaunchMode.externalApplication);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
          Expanded(child: Text('${o['business_name'] ?? 'Request'}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
          Text(fmtDT(o['created_at']), style: TextStyle(fontSize: 12, color: Tk.label2)),
        ]),
        if (prods.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(prods, style: TextStyle(fontSize: 14, color: Tk.label2))),
        _steps(st.$3),
        Padding(padding: const EdgeInsets.only(top: 8), child: Text(st.$1, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
        Text(st.$2, style: TextStyle(fontSize: 14, color: Tk.label2)),
        if (o['status'] == 'link_sent') ...[const SizedBox(height: 10), FilledButton(onPressed: () => site('pay.html?t=$token'), child: const Text('Read quote and pay'))],
        if (o['status'] == 'payment_submitted') ...[const SizedBox(height: 10), OutlinedButton(onPressed: () => site('pay.html?t=$token'), child: const Text('View payment details'))],
        if (o['status'] == 'paid') ...[
          if ('${o['invoice_no'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Bill ${o['invoice_no']}', style: const TextStyle(fontSize: 13))),
          const SizedBox(height: 10),
          OutlinedButton(onPressed: () => site('inv.html?t=$token'), child: const Text('View bill')),
          const SizedBox(height: 8),
          FilledButton(onPressed: () {
            widget.s.load();
            Navigator.pop(context);
          }, child: const Text('Open my apps')),
        ],
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final r = rows;
    return SubPage('My requests', [
      const Hint('You ask for products, we check, send a quote, and your access starts after payment is confirmed.'),
      if (err != null) Note(err!, bad: true),
      if (r == null && err == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
      if (r != null && r.isEmpty) emptyBox(Icons.assignment_outlined, 'You have not asked for anything yet.'),
      if (r != null) ...r.map(_card),
      const SizedBox(height: 12),
      Pad(OutlinedButton(onPressed: () => openSite(widget.s, 'cart.html'), child: const Text('Ask for more products'))),
      Pad(OutlinedButton(onPressed: load, child: const Text('Refresh'))),
    ]);
  }
}
