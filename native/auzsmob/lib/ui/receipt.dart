import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'i18n.dart';

/// The bill as plain text, ready for WhatsApp (free `wa.me` link: the cashier taps Send).
String waBillText(MobSession s, Map<String, dynamic> sale) {
  final st = s.settings;
  final lines = <String>[
    '${st['shopName'] ?? ''}${'${st['address'] ?? ''}'.isNotEmpty ? ', ${st['address']}' : ''}',
    '${tr('Bill')} ${sale['bill_no'] ?? ''}',
    for (final it in (sale['items'] as List? ?? const [])) '${(it as Map)['name']} x${it['qty']}  ${inr(n(it['price']) * n(it['qty']))}',
    '${tr('Total')}: ${inr(n(sale['total']))}',
    '${st['billFooter'] ?? ''}'.isNotEmpty ? '${st['billFooter']}' : tr('Thank you!'),
  ];
  return lines.where((l) => l.trim().isNotEmpty).join('\n');
}

/// The styled receipt page (mobbill.html, the shop's chosen template). A sale that has not reached the server yet has no real
/// bill number, so it has no link; the plain text still goes out.
Future<String?> receiptLink(MobSession s, Map<String, dynamic> sale) async {
  if ('${sale['bill_no'] ?? ''}'.isEmpty || sale['voided'] == true) return null;
  try {
    final r = await s.api.rpc('mob_share_sale', {'p_sale_id': sale['id']});
    final t = r is Map ? r['token'] : null;
    return t == null ? null : '${s.origin}/mobbill.html?t=$t';
  } catch (_) {
    return null;
  }
}

String digitsOf(String x) => x.replaceAll(RegExp(r'[^0-9]'), '');

Future<void> shareSaleOnWhatsApp(MobSession s, Map<String, dynamic> sale) async {
  var d = digitsOf('${sale['customer_phone'] ?? ''}');
  if (d.length == 10) d = '91$d';
  final link = await receiptLink(s, sale);
  final text = waBillText(s, sale) + (link != null ? '\n$link' : '');
  await launchUrl(Uri.parse('https://wa.me/$d?text=${Uri.encodeComponent(text)}'), mode: LaunchMode.externalApplication);
}

/// A receipt PDF on roll-paper width (80 mm). The system print dialog sends it to any printer or saves it as a PDF.
Future<void> printSale(MobSession s, Map<String, dynamic> sale) async {
  final st = s.settings;
  final doc = pw.Document();
  pw.Widget row(String a, String b, {bool bold = false}) => pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
        pw.Expanded(child: pw.Text(a, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal))),
        pw.Text(b, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
      ]);
  final items = (sale['items'] as List? ?? const []).cast<Map>();
  doc.addPage(pw.Page(
    pageFormat: const PdfPageFormat(80 * PdfPageFormat.mm, double.infinity, marginAll: 6 * PdfPageFormat.mm),
    build: (_) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
      pw.Text('${st['shopName'] ?? 'Shop'}', textAlign: pw.TextAlign.center, style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
      if ('${st['address'] ?? ''}'.isNotEmpty) pw.Text('${st['address']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
      if ('${st['phone'] ?? ''}'.isNotEmpty) pw.Text('${st['phone']}', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8)),
      pw.SizedBox(height: 6),
      row('Bill ${sale['bill_no'] ?? ''}', '${sale['payment_mode'] ?? ''}'),
      row(fmtShort(sale['created_at']), ''),
      pw.Divider(),
      for (final it in items) row('${it['qty']} x ${it['name']}', inr(n(it['price']) * n(it['qty']))),
      pw.Divider(),
      if (n(sale['discount']) > 0) row('Discount', '-${inr(n(sale['discount']))}'),
      row('TOTAL', inr(n(sale['total'])), bold: true),
      if (n(sale['balance']) > 0) row('Balance due', inr(n(sale['balance']))),
      pw.SizedBox(height: 8),
      pw.Text('${st['billFooter'] ?? ''}'.isNotEmpty ? '${st['billFooter']}' : 'Thank you!', textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 9)),
    ]),
  ));
  await Printing.layoutPdf(name: 'Bill ${sale['bill_no'] ?? ''}', onLayout: (_) async => doc.save());
}

String fmtShort(dynamic s) {
  final d = DateTime.tryParse('${s ?? ''}')?.toLocal();
  if (d == null) return '';
  return '${ymd(d)} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}
