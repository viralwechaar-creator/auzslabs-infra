import 'package:flutter/material.dart' hide Text;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'i18n.dart';
import 'mk.dart';

Future<void> openWhatsApp(String phone, String text) => launchUrl(Uri.parse('https://wa.me/${waNumber(phone)}?text=${Uri.encodeComponent(text)}'), mode: LaunchMode.externalApplication);

/// A roll-paper receipt PDF (80 mm). The system print dialog sends it to any printer or saves it as a PDF.
Future<void> printReceiptPdf(LedgerSession s, String number, double total, List<Map<String, dynamic>> items) async {
  final doc = pw.Document();
  pw.Widget row(String a, String b, {bool bold = false}) => pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
        pw.Expanded(child: _T(a, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal))),
        _T(b, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
      ]);
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat(80 * PdfPageFormat.mm, 297 * PdfPageFormat.mm, marginAll: 6 * PdfPageFormat.mm),
    build: (_) => [pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
      _T(s.orgName, textAlign: pw.TextAlign.center, style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
      if ('${s.org['gstin'] ?? ''}'.isNotEmpty) _T('GSTIN ${s.org['gstin']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
      pw.SizedBox(height: 6),
      row('Invoice $number', ymd(DateTime.now())),
      pw.Divider(),
      for (final it in items) row('${qtyStr(n(it['qty']))} x ${it['name']}', inr(n(it['amt']))),
      pw.Divider(),
      row('TOTAL', inr(total), bold: true),
      pw.SizedBox(height: 8),
      _T('Thank you!', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 9)),
    ]),],
  ));
  try {
    await Printing.layoutPdf(name: 'Invoice $number', onLayout: (_) async => doc.save());
  } catch (e) {
    throw Exception('Could not open the print dialog: $e');
  }
}

String _hello(String name) => 'Hello${name.isEmpty ? '' : ' $name'}';

/// After a sale that reached the books: the real invoice number, WhatsApp with the invoice link, print, copy link.
Future<void> saleDone(BuildContext c, LedgerSession s, Map<String, dynamic> r, Map<String, dynamic>? full, double total, String name, String phone, List<Map<String, dynamic>> items) async {
  final number = '${r['number'] ?? (full?['doc'] as Map?)?['number'] ?? ''}';
  final id = '${r['id'] ?? (full?['doc'] as Map?)?['id'] ?? ''}';
  final ph = TextEditingController(text: phone);
  await openSheet(c, 'Paid', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Center(child: Icon(Icons.check_circle, size: 56, color: Color(0xFF1F8A3D))),
        gap(8),
        Center(child: Text(number.isEmpty ? 'Sale posted' : number, style: const TextStyle(fontSize: 16))),
        Center(child: Text(inr(total), style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800))),
        gap(),
        Fld('WhatsApp number', ph, phone: true, hint: 'Leave empty to choose the contact inside WhatsApp.'),
        gap(),
        FilledButton.icon(onPressed: () async {
          try {
            final link = await s.shareLink(id);
            await openWhatsApp(ph.text, '${_hello(name)}, thank you for shopping with ${s.orgName}. Your invoice $number for ${inr(total)} is here:\n$link');
          } catch (e) {
            if (ctx.mounted) toast(ctx, '$e', err: true);
          }
        }, icon: const Icon(Icons.chat), label: const Text('Send on WhatsApp')),
        gap(8),
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: () => printReceiptPdf(s, number, total, items), icon: const Icon(Icons.print_outlined), label: const Text('Print or save PDF'))),
          const SizedBox(width: 10),
          Expanded(child: OutlinedButton.icon(onPressed: () async {
            try {
              await Clipboard.setData(ClipboardData(text: await s.shareLink(id)));
              if (ctx.mounted) toast(ctx, tr('Link copied'));
            } catch (e) {
              if (ctx.mounted) toast(ctx, '$e', err: true);
            }
          }, icon: const Icon(Icons.link), label: const Text('Copy link'))),
        ]),
      ]), actions: [SheetAction('New sale', (ctx) async => true, primary: false)]);
}

/// A sale kept on the phone: a plain WhatsApp message with a provisional number (the final GST invoice number follows).
Future<void> offlineReceipt(BuildContext c, LedgerSession s, Map<String, dynamic> r) async {
  final ph = TextEditingController(text: '${r['phone'] ?? ''}');
  final items = (r['items'] as List).cast<Map>();
  String text() => '${_hello('${r['name'] ?? ''}')}, thank you for shopping with ${s.orgName}.\nBill ${r['ref']} (the GST invoice number follows)\n${items.map((i) => '${i['name']} x ${qtyStr(n(i['qty']))}  ${inr(n(i['amt']))}').join('\n')}\nTotal ${inr(n(r['total']))}';
  await openSheet(c, 'Saved on this phone', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Center(child: Icon(Icons.cloud_off, size: 48)),
        gap(8),
        Center(child: Text('${r['ref']}', style: const TextStyle(fontSize: 16))),
        Center(child: Text(inr(n(r['total'])), style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800))),
        gap(),
        Note(tr('You are offline. This sale is safe on the phone and goes to your books automatically when the connection is back. The final GST invoice number is given then.')),
        Fld('WhatsApp number', ph, phone: true),
        gap(),
        FilledButton.icon(onPressed: () => openWhatsApp(ph.text, text()), icon: const Icon(Icons.chat), label: const Text('Send receipt on WhatsApp')),
        gap(8),
        OutlinedButton.icon(onPressed: () => printReceiptPdf(s, '${r['ref']}', n(r['total']), items.map((e) => Map<String, dynamic>.from(e)).toList()), icon: const Icon(Icons.print_outlined), label: const Text('Print or save PDF')),
      ]), actions: [SheetAction('New sale', (ctx) async => true, primary: false)]);
}

/// The built-in PDF font has no rupee sign or multiplication sign; show them as plain letters.
String _pt(String t) => t.replaceAll('₹', 'Rs ').replaceAll('×', 'x');

pw.Widget _T(String t, {pw.TextAlign? textAlign, pw.TextStyle? style}) => pw.Text(_pt(t), textAlign: textAlign, style: style);
