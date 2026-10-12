import 'package:flutter/material.dart' hide Text;
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

String _digits(dynamic v) => '${v ?? ''}'.replaceAll(RegExp(r'\D'), '');

/// One customer with what they bought and what they still owe, worked out on the phone from the synced bills.
class CustomerRow {
  CustomerRow(this.name, this.phone, this.bills, this.bought, this.due);
  final String name, phone;
  final List<Map<String, dynamic>> bills;
  final double bought, due;
}

List<CustomerRow> customerRows(List<Map<String, dynamic>> customers, List<Map<String, dynamic>> sales) {
  final byKey = <String, List<Map<String, dynamic>>>{};
  String keyOf(String phone, String name) => phone.length >= 7 ? phone : name.toLowerCase().trim();
  for (final s in sales) {
    if (s['voided'] == true) continue;
    final k = keyOf(_digits(s['customer_phone']), '${s['customer_name'] ?? ''}');
    if (k.isEmpty) continue;
    byKey.putIfAbsent(k, () => []).add(s);
  }
  final out = <CustomerRow>[];
  final seen = <String>{};
  void add(String name, String phone) {
    final k = keyOf(_digits(phone), name);
    if (k.isEmpty || !seen.add(k)) return;
    final b = byKey[k] ?? const <Map<String, dynamic>>[];
    out.add(CustomerRow(name, phone, b, b.fold<double>(0, (a, x) => a + n(x['total'])), b.fold<double>(0, (a, x) => a + n(x['balance']))));
  }

  for (final c in customers) {
    add('${c['name'] ?? ''}', '${c['phone'] ?? ''}');
  }
  for (final s in sales) {
    if (s['voided'] != true) add('${s['customer_name'] ?? ''}', '${s['customer_phone'] ?? ''}');
  }
  out.sort((a, b) => b.bought.compareTo(a.bought));
  return out;
}

class CustomersPage extends StatefulWidget {
  const CustomersPage(this.s, {super.key});
  final MobSession s;
  @override
  State<CustomersPage> createState() => _CustomersPageState();
}

class _CustomersPageState extends State<CustomersPage> {
  String q = '';

  void _open(CustomerRow c) {
    openSheet(context, c.name.isEmpty ? c.phone : c.name, (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (c.phone.isNotEmpty) Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: () => launchUrl(Uri.parse('tel:${c.phone}')), icon: const Icon(Icons.call_outlined), label: const Text('Call'))),
            const SizedBox(width: 10),
            Expanded(child: OutlinedButton.icon(onPressed: () => launchUrl(Uri.parse('https://wa.me/${_digits(c.phone).length == 10 ? '91${_digits(c.phone)}' : _digits(c.phone)}'), mode: LaunchMode.externalApplication), icon: const Icon(Icons.chat_outlined), label: const Text('WhatsApp'))),
          ]),
          gap(),
          Text('${tr('Bought')}: ${inr(c.bought)}   ${tr('Due')}: ${inr(c.due)}', style: const TextStyle(fontWeight: FontWeight.w700)),
          gap(8),
          Group([for (final b in (c.bills.toList()..sort((a, b) => '${b['created_at']}'.compareTo('${a['created_at']}'))).take(30)) Li(inr(n(b['total'])), sub: fmtDT(b['created_at']), value: n(b['balance']) > 0 ? '${tr('Due')} ${inr(n(b['balance']))}' : null, chevron: false)]),
        ]));
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.s.repo!;
    final all = customerRows(r.rows('customers'), r.rows('sales'));
    final rows = all.where((c) => q.isEmpty || '${c.name} ${c.phone}'.toLowerCase().contains(q.toLowerCase())).toList();
    return SubPage('Customers', [
      Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 8), child: TextField(decoration: InputDecoration(hintText: tr('Search name or phone'), prefixIcon: const Icon(Icons.search)), onChanged: (v) => setState(() => q = v))),
      if (rows.isEmpty) emptyBox(Icons.people_outline, tr('No customers yet'), tr('Customers appear here once you sell with a name or phone number.')) else Group([for (final c in rows) Li(c.name.isEmpty ? c.phone : c.name, sub: [if (c.name.isNotEmpty && c.phone.isNotEmpty) c.phone, '${c.bills.length} ${tr('bills')}'].join(' · '), value: c.due > 0 ? '${tr('Due')} ${inr(c.due)}' : inr(c.bought), onTap: () => _open(c))]),
    ]);
  }
}

// ---------------------------------------------------------------- day close

class DayClosePage extends StatefulWidget {
  const DayClosePage(this.s, {super.key});
  final MobSession s;
  @override
  State<DayClosePage> createState() => _DayClosePageState();
}

class _DayClosePageState extends State<DayClosePage> {
  MobSession get s => widget.s;
  final counted = TextEditingController();
  bool busy = false;

  @override
  void dispose() {
    counted.dispose();
    super.dispose();
  }

  Future<void> _set(String? date) async {
    setState(() => busy = true);
    try {
      await s.api.rpc('mob_save_settings', {'p': {'dayCloseDate': date ?? ''}});
      await s.reloadContext();
      if (mounted) toast(context, date == null ? tr('Day re-opened') : tr('Day closed. New entries start tomorrow.'));
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    }
    if (mounted) setState(() => busy = false);
  }

  String _summary(DayCash c, double? got) {
    final diff = got == null ? null : r2(got - c.expected);
    return [
      '${s.settings['shopName'] ?? 'Shop'} - ${tr('Day close')} ${todayStr()}',
      '${tr('Bills')}: ${c.bills}',
      '${tr('Cash')}: ${inr(c.cash)}  UPI: ${inr(c.upi)}  ${tr('Card')}: ${inr(c.card)}  ${tr('Credit')}: ${inr(c.credit)}',
      '${tr('Cash collected from customers')}: ${inr(c.collected)}',
      '${tr('Cash paid to vendors')}: ${inr(c.paidOut)}',
      '${tr('Cash expected in drawer')}: ${inr(c.expected)}',
      if (got != null) '${tr('Cash counted')}: ${inr(got)}  (${diff! >= 0 ? '+' : ''}${inr(diff)})',
    ].join('\n');
  }

  @override
  Widget build(BuildContext context) {
    if (!s.can('mob_reports')) return SubPage('Day close', [emptyBox(Icons.lock_outline, tr('You do not have access to this.'))]);
    final r = s.repo!;
    final c = dayCash(r.rows('sales'), r.rows('payments'), todayStr());
    final got = double.tryParse(counted.text.replaceAll(',', '').trim());
    final diff = got == null ? null : r2(got - c.expected);
    final closed = '${s.settings['dayCloseDate'] ?? ''}';
    final todayClosed = closed.isNotEmpty && closed.compareTo(todayStr()) >= 0;
    return SubPage('Day close', [
      Padding(padding: const EdgeInsets.fromLTRB(16, 6, 16, 0), child: Text(todayClosed ? tr('This day is closed. Nothing more can be added for it.') : tr('Count the cash in the drawer, check it matches, then close the day.'), style: TextStyle(color: Tk.label2))),
      metricGrid([Metric('Bills today', '${c.bills}'), Metric('Cash sales', inr(c.cash)), Metric('UPI', inr(c.upi)), Metric('Card', inr(c.card)), Metric('On credit', inr(c.credit))]),
      const SectionLabel('Cash drawer'),
      Group([
        Li('Cash sales', value: inr(c.cash), chevron: false),
        Li('Collected from customers', value: inr(c.collected), chevron: false),
        Li('Paid to vendors', value: '-${inr(c.paidOut)}', chevron: false),
        Li('Expected in the drawer', value: inr(c.expected), chevron: false),
      ]),
      Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: Fld('Cash you counted (₹)', counted, number: true, onChanged: (_) => setState(() {}))),
      if (diff != null) Note(diff == 0 ? tr('Matches. No difference.') : (diff > 0 ? '${tr('Extra cash')}: ${inr(diff)}' : '${tr('Short by')} ${inr(-diff)}'), bad: diff != 0),
      Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 0), child: Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => SharePlus.instance.share(ShareParams(text: _summary(c, got))), child: const Text('Share summary'))),
        const SizedBox(width: 10),
        Expanded(child: todayClosed ? FilledButton.tonal(onPressed: busy ? null : () => _set(null), child: const Text('Re-open day')) : FilledButton(onPressed: busy || got == null ? null : () => _set(todayStr()), child: const Text('Close the day'))),
      ])),
    ]);
  }
}
