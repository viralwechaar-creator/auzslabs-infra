import 'dart:ui' as ui;
import 'package:flutter/material.dart' hide Text;
import 'package:qr_flutter/qr_flutter.dart';
import 'i18n.dart';
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
        content: TextField(controller: c, keyboardType: TextInputType.phone, autofocus: true, decoration: InputDecoration(labelText: tr('Customer phone'))),
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
  pw.Widget row(String a, String b, {bool bold = false}) => pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [pw.Expanded(child: _T(a, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal))), _T(b, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal))]);
  final lines = ((o['lines'] as List?) ?? []).cast<Map>();
  final pays = ((o['pays'] as List?) ?? []).cast<Map>();
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat(80 * PdfPageFormat.mm, 297 * PdfPageFormat.mm, marginAll: 6 * PdfPageFormat.mm),
    build: (_) => [pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
      _T('${s.cfg['name']}', textAlign: pw.TextAlign.center, style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
      if ('${s.cfg['addr'] ?? ''}'.isNotEmpty) _T('${s.cfg['addr']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
      if ('${s.cfg['phone'] ?? ''}'.isNotEmpty) _T('${s.cfg['phone']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
      if ('${s.cfg['gstin'] ?? ''}'.isNotEmpty) _T('GSTIN ${s.cfg['gstin']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
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
      _T('${s.cfg['ftr'] ?? 'Thank you!'}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 9)),
    ]),],
  ));
  try {
    await Printing.layoutPdf(name: 'Bill ${o['no']}', onLayout: (_) async => doc.save());
  } catch (e) {
    throw Exception('Could not open the print dialog: $e');
  }
}

/// Table QR codes as an A4 sheet (two per row). The system print dialog sends it to a printer or saves it as a PDF.
Future<void> printQrCodes(Session s, List<Map<String, dynamic>> tables, String Function(Map<String, dynamic>) urlOf) async {
  final doc = pw.Document();
  final imgs = <Object?, pw.MemoryImage>{};
  for (final t in tables) {
    final bd = await QrPainter(data: urlOf(t), version: QrVersions.auto, gapless: true, emptyColor: Colors.white, eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Colors.black), dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Colors.black)).toImageData(700, format: ui.ImageByteFormat.png);
    if (bd != null) imgs[t['id']] = pw.MemoryImage(bd.buffer.asUint8List());
  }
  pw.Widget card(Map<String, dynamic> t) => pw.Container(
        width: 240,
        padding: const pw.EdgeInsets.all(12),
        decoration: pw.BoxDecoration(border: pw.Border.all(width: 1), borderRadius: pw.BorderRadius.circular(8)),
        child: pw.Column(children: [
          _T('${s.cfg['name'] ?? ''}', textAlign: pw.TextAlign.center, style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
          pw.SizedBox(height: 8),
          if (imgs[t['id']] != null) pw.Image(imgs[t['id']]!, width: 190, height: 190),
          pw.SizedBox(height: 8),
          _T('${t['name']}', textAlign: pw.TextAlign.center, style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold)),
          _T('Scan to view menu & order', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 10)),
        ]),
      );
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.a4,
    margin: const pw.EdgeInsets.all(24),
    build: (_) => [pw.Wrap(spacing: 14, runSpacing: 14, children: [for (final t in tables) card(t)])],
  ));
  try {
    await Printing.layoutPdf(name: 'Table QR codes', onLayout: (_) async => doc.save());
  } catch (e) {
    throw Exception('Could not open the print dialog: $e');
  }
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

/// The built-in PDF font has no rupee sign or multiplication sign; show them as plain letters.
String _pt(String t) => t.replaceAll('₹', 'Rs ').replaceAll('×', 'x');

pw.Widget _T(String t, {pw.TextAlign? textAlign, pw.TextStyle? style}) => pw.Text(_pt(t), textAlign: textAlign, style: style);
