import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/session.dart';
import '../core/thermal.dart';
import 'home.dart';

String _digits(String s) => s.replaceAll(RegExp(r'[^0-9]'), '');

String billUrl(Session s, Map<String, dynamic> o) => 'https://${s.slug}.auzslab.in/i.html?o=${Uri.encodeComponent('${o['tok'] ?? o['no']}')}';

/// Same message as wa() in the website POS: bill lines, total and the public invoice link.
String billMessage(Session s, Map<String, dynamic> o) {
  final t = (o['t'] as Map?) ?? {};
  final items = ((o['lines'] as List?) ?? []).cast<Map>().map((l) => '${l['name']}${(l['size'] ?? '') != '' ? ' (${l['size']})' : ''} × ${l['qty']}: ${inr((l['price'] as num) * (l['qty'] as num))}').join('\n');
  final name = ((o['cust'] as Map?)?['name'] ?? '');
  return 'Hi $name, thank you for visiting ${s.cfg['name']}.\n\nInvoice ${o['no']}\n$items\nTotal: ${inr((t['total'] ?? 0) as num)}\n\nView or download your invoice:\n${billUrl(s, o)}';
}

Future<void> sendWhatsApp(BuildContext context, Session s, Map<String, dynamic> o) async {
  var p = _digits('${(o['cust'] as Map?)?['phone'] ?? ''}');
  if (p.isEmpty) {
    final c = TextEditingController();
    final v = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Send the bill on WhatsApp'),
        content: TextField(controller: c, keyboardType: TextInputType.phone, autofocus: true, decoration: const InputDecoration(labelText: 'Customer phone')),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, c.text), child: const Text('Send'))],
      ),
    );
    p = _digits(v ?? '');
  }
  if (p.isEmpty) return;
  if (p.length == 10) p = '91$p';
  await launchUrl(Uri.parse('https://wa.me/$p?text=${Uri.encodeComponent(billMessage(s, o))}'), mode: LaunchMode.externalApplication);
}

/// A receipt PDF on a roll-paper width (80 mm). The system print dialog sends it to any printer or saves it as a PDF.
Future<void> printReceipt(Session s, Map<String, dynamic> o) async {
  final t = (o['t'] as Map?) ?? {};
  final doc = pw.Document();
  pw.Widget row(String a, String b, {bool bold = false}) => pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [pw.Expanded(child: pw.Text(a, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal))), pw.Text(b, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal))]);
  final lines = ((o['lines'] as List?) ?? []).cast<Map>();
  final pays = ((o['pays'] as List?) ?? []).cast<Map>();
  doc.addPage(pw.Page(
    pageFormat: const PdfPageFormat(80 * PdfPageFormat.mm, double.infinity, marginAll: 6 * PdfPageFormat.mm),
    build: (_) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
      pw.Text('${s.cfg['name']}', textAlign: pw.TextAlign.center, style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
      if ('${s.cfg['addr'] ?? ''}'.isNotEmpty) pw.Text('${s.cfg['addr']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
      if ('${s.cfg['phone'] ?? ''}'.isNotEmpty) pw.Text('${s.cfg['phone']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
      if ('${s.cfg['gstin'] ?? ''}'.isNotEmpty) pw.Text('GSTIN ${s.cfg['gstin']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
      pw.SizedBox(height: 6),
      row('Bill ${o['no']}', '${o['type']}'),
      row('${'${o['paidAt'] ?? o['created']}'.replaceFirst('T', ' ').substring(0, 16)}', ''),
      pw.Divider(),
      for (final l in lines) row('${l['qty']} × ${l['name']}${(l['size'] ?? '') != '' ? ' (${l['size']})' : ''}', inr((l['price'] as num) * (l['qty'] as num))),
      pw.Divider(),
      row('Subtotal', inr((t['sub'] ?? 0) as num)),
      if (((t['d'] ?? 0) as num) > 0) row('Discount', '-${inr((t['d']) as num)}'),
      if (((t['svc'] ?? 0) as num) > 0) row('Service charge', inr((t['svc']) as num)),
      if (((t['tax'] ?? 0) as num) > 0) row('Tax', inr((t['tax']) as num)),
      if (((t['round'] ?? 0) as num) != 0) row('Round off', inr((t['round']) as num)),
      row('TOTAL', inr((t['total'] ?? 0) as num), bold: true),
      pw.SizedBox(height: 4),
      for (final p in pays) row('Paid by ${p['m']}', inr((p['amt'] ?? 0) as num)),
      pw.SizedBox(height: 8),
      pw.Text('${s.cfg['ftr'] ?? 'Thank you!'}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 9)),
    ]),
  ));
  await Printing.layoutPdf(name: 'Bill ${o['no']}', onLayout: (_) async => doc.save());
}

/// Shown after a payment and from a paid bill.
Future<void> billActions(BuildContext context, HomeState h, Map<String, dynamic> o, {String title = 'Payment complete'}) {
  final t = (o['t'] as Map?) ?? {};
  return showModalBottomSheet<void>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Icon(Icons.check_circle, color: Color(0xFF1F8A3D), size: 44),
          const SizedBox(height: 6),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          Text('${o['no']} · ${inr((t['total'] ?? 0) as num)}', textAlign: TextAlign.center),
          const SizedBox(height: 12),
          FilledButton.icon(onPressed: () => sendWhatsApp(context, h.s, o), icon: const Icon(Icons.chat), label: const Text('Send bill on WhatsApp')),
          const SizedBox(height: 8),
          FilledButton.tonalIcon(
              onPressed: () async {
                final err = await Thermal.printBill(h.s, o);
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err ?? 'Sent to the printer')));
              },
              icon: const Icon(Icons.print),
              label: const Text('Print on thermal printer')),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: () => printReceipt(h.s, o), icon: const Icon(Icons.print_outlined), label: const Text('Print or save PDF')),
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done')),
        ]),
      ),
    ),
  );
}
