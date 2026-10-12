import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'receipt.dart';
import 'theme.dart';

/// Recent sales (tax invoices) from the books, with the invoice link to send again.
class SalesPage extends StatefulWidget {
  const SalesPage(this.s, {super.key});
  final ScanSession s;
  @override
  State<SalesPage> createState() => _SalesPageState();
}

class _SalesPageState extends State<SalesPage> {
  ScanSession get s => widget.s;
  List<Map<String, dynamic>>? rows;
  String? err;
  final q = TextEditingController();
  num total = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await s.api.rpc('acc_list_documents', {'p': {'types': ['invoice'], 'search': q.text.trim(), 'status': '', 'limit': 60, 'offset': 0}}) as Map);
      if (!mounted) return;
      setState(() {
        rows = (d['rows'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        total = d['count'] is num ? d['count'] as num : rows!.length;
        err = null;
      });
    } catch (e) {
      if (mounted) setState(() => err = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = rows;
    return TabPage('Sales', [
      Pad(TextField(controller: q, onSubmitted: (_) => _load(), decoration: InputDecoration(hintText: tr('Search by number or customer'), prefixIcon: const Icon(Icons.search)))),
      if (err != null) Note(err!, bad: true),
      if (l == null && err == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
      else if (l != null && l.isEmpty) emptyBox(Icons.receipt_long_outlined, tr('Nothing yet'))
      else if (l != null)
        Group([
          for (final r in l)
            Li('${'${r['number']}'.startsWith('DRAFT-') ? tr('Draft') : r['number']}', sub: '${r['doc_date'] ?? ''} · ${'${r['party_name'] ?? ''}'.isEmpty ? 'Walk-in' : r['party_name']}', value: inr(n(r['total'])), icon: Icons.receipt_long_outlined, tone: Tk.accent,
                trailing: n(r['outstanding']) > 0 ? Pill('${tr('Due')} ${inr(n(r['outstanding']))}', tone: Tk.orange) : null, chevron: false, onTap: () => _open(r)),
        ]),
    ], onRefresh: () async {
      await s.flush();
      await _load();
    });
  }

  void _open(Map<String, dynamic> r) {
    final ph = TextEditingController();
    openSheet(context, '${r['number']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Center(child: Text(inr(n(r['total'])), style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800))),
          Center(child: Text('${r['doc_date'] ?? ''} · ${'${r['party_name'] ?? ''}'.isEmpty ? 'Walk-in' : r['party_name']}', style: TextStyle(color: Tk.label2))),
          gap(),
          Fld('WhatsApp number', ph, phone: true),
          gap(),
          FilledButton.icon(onPressed: () async {
            try {
              final link = await s.shareLink('${r['id']}');
              await openWhatsApp(ph.text, 'Hello, here is your invoice ${r['number']} from ${s.orgName} for ${inr(n(r['total']))}.\n$link');
            } catch (e) {
              if (ctx.mounted) toast(ctx, '$e', err: true);
            }
          }, icon: const Icon(Icons.chat), label: const Text('Send on WhatsApp')),
          gap(8),
          OutlinedButton.icon(onPressed: () async {
            try {
              await Clipboard.setData(ClipboardData(text: await s.shareLink('${r['id']}')));
              if (ctx.mounted) toast(ctx, tr('Link copied'));
            } catch (e) {
              if (ctx.mounted) toast(ctx, '$e', err: true);
            }
          }, icon: const Icon(Icons.link), label: const Text('Copy link')),
        ]));
  }
}
