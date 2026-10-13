/// Pure helpers (no screens, no phone storage) so they can be tested: stock, vendor dues, report dates, profit sharing, CSV.
library;

double n(dynamic v) {
  if (v is num) return v.toDouble();
  final x = double.tryParse('${v ?? ''}'.replaceAll(',', '').trim());
  return x == null || x.isNaN || x.isInfinite ? 0 : x;
}

double r2(num v) => (v * 100).roundToDouble() / 100;

String qtyStr(num v) => v == v.roundToDouble() ? '${v.toInt()}' : '${r2(v)}';

String _indian(String intPart) {
  if (intPart.length <= 3) return intPart;
  final last3 = intPart.substring(intPart.length - 3);
  var rest = intPart.substring(0, intPart.length - 3);
  rest = rest.replaceAllMapped(RegExp(r'(\d)(?=(\d\d)+$)'), (m) => '${m[1]},');
  return '$rest,$last3';
}

/// ₹1,23,456 (no decimals when whole, else two), minus sign in front of the rupee sign like the website.
String inr(num v, {int? dp}) {
  final d = dp ?? (v == v.roundToDouble() ? 0 : 2);
  final s = v.abs().toStringAsFixed(d);
  final parts = s.split('.');
  final body = _indian(parts[0]) + (parts.length > 1 ? '.${parts[1]}' : '');
  return '${v < 0 ? '-' : ''}₹$body';
}


String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

const _mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// "Mon, 5 Oct 2026" from a 2026-10-05 string (or an ISO time).
String fmtD(dynamic s, {bool weekday = false}) {
  final t = '${s ?? ''}';
  final d = DateTime.tryParse(t.length >= 10 ? t.substring(0, 10) : t);
  if (d == null) return '';
  return '${weekday ? '${_wd[d.weekday - 1]}, ' : ''}${d.day} ${_mo[d.month - 1]} ${d.year}';
}

String csvEscape(Object? v) {
  final s = v == null ? '' : '$v';
  return RegExp(r'[",\r\n]').hasMatch(s) ? '"${s.replaceAll('"', '""')}"' : s;
}

/// The totals of one sales document: the same GST maths as the website's calcDoc() (p-editor.js), so the screen and the books agree.
class DocCalc {
  DocCalc(this.supply, this.zero);
  final String supply; // intra | inter
  final bool zero;
  final lines = <Map<String, double>>[];
  double subtotal = 0, discount = 0, taxable = 0, cgst = 0, sgst = 0, igst = 0, cess = 0, roundoff = 0, total = 0;
  final byRate = <double, Map<String, double>>{};
}

/// [lines] each: qty, rate, disc_pct, disc_amt, tax_rate, cess_pct (numbers or numeric strings).
/// [org]: state_code, reg_type, round_off_sales. [party]: state_code, reg_type. [branch]: state_code.
DocCalc calcSales(List<Map<String, dynamic>> lines, {required bool inclusive, required Map<String, dynamic> org, Map<String, dynamic>? party, Map<String, dynamic>? branch, String? placeOfSupply, String? roundoff}) {
  final origin = '${branch?['state_code'] ?? org['state_code'] ?? ''}';
  final pos = (placeOfSupply ?? '').isNotEmpty ? placeOfSupply! : '${party?['state_code'] ?? origin}';
  var supply = origin.isNotEmpty && pos.isNotEmpty && origin != pos ? 'inter' : 'intra';
  var zero = false;
  if (party != null && party['reg_type'] == 'overseas') {
    supply = 'inter';
    zero = true;
  }
  if (org['reg_type'] != 'regular') zero = true;
  final out = DocCalc(supply, zero);
  for (final l in lines) {
    final q = n(l['qty']), rate = n(l['rate']), gross = r2(q * rate);
    var damt = n(l['disc_amt']);
    final dp = n(l['disc_pct']);
    if (dp > 0 && damt == 0) damt = r2(gross * dp / 100);
    final net = gross - damt > 0 ? gross - damt : 0.0, tr = zero ? 0.0 : n(l['tax_rate']);
    double txb, tx;
    if (inclusive && tr > 0) {
      txb = r2(net * 100 / (100 + tr));
      tx = r2(net - txb);
    } else {
      txb = net.toDouble();
      tx = r2(txb * tr / 100);
    }
    double cg = 0, sg = 0, ig = 0;
    if (supply == 'inter') {
      ig = tx;
    } else {
      cg = r2(tx / 2);
      sg = r2(tx - cg);
    }
    final cs = r2(txb * n(l['cess_pct']) / 100);
    out.lines.add({'gross': gross, 'damt': damt, 'taxable': txb, 'tax': tx + cs, 'cgst': cg, 'sgst': sg, 'igst': ig, 'cess': cs, 'total': r2(txb + tx + cs), 'qty': q});
    out.subtotal += gross;
    out.discount += damt;
    out.taxable += txb;
    out.cgst += cg;
    out.sgst += sg;
    out.igst += ig;
    out.cess += cs;
    final br = out.byRate.putIfAbsent(tr, () => {'taxable': 0, 'tax': 0});
    br['taxable'] = br['taxable']! + txb;
    br['tax'] = br['tax']! + tx;
  }
  out.subtotal = r2(out.subtotal);
  out.discount = r2(out.discount);
  out.taxable = r2(out.taxable);
  out.cgst = r2(out.cgst);
  out.sgst = r2(out.sgst);
  out.igst = r2(out.igst);
  out.cess = r2(out.cess);
  final total = out.taxable + out.cgst + out.sgst + out.igst + out.cess;
  if (roundoff != null && roundoff.trim().isNotEmpty && double.tryParse(roundoff) != null) {
    out.roundoff = r2(n(roundoff));
  } else if (org['round_off_sales'] == true) {
    out.roundoff = r2(total.roundToDouble() - total);
  }
  out.total = r2(total + out.roundoff);
  return out;
}

/// A digit-only phone with 91 in front when it is a 10-digit Indian number.
String waNumber(String phone) {
  final d = phone.replaceAll(RegExp(r'[^0-9]'), '');
  return d.length == 10 ? '91$d' : d;
}

/// From/to dates (YYYY-MM-DD) for a report period. Indian financial year runs 1 April to 31 March.
(String, String) reportPeriod(String key, DateTime now) {
  final fyStartYear = now.month >= 4 ? now.year : now.year - 1;
  switch (key) {
    case 'lastmonth':
      final first = DateTime(now.year, now.month - 1, 1);
      return (ymd(first), ymd(DateTime(now.year, now.month, 0)));
    case 'fy':
      return (ymd(DateTime(fyStartYear, 4, 1)), ymd(DateTime(fyStartYear + 1, 3, 31)));
    case 'lastfy':
      return (ymd(DateTime(fyStartYear - 1, 4, 1)), ymd(DateTime(fyStartYear, 3, 31)));
    default:
      return (ymd(DateTime(now.year, now.month, 1)), ymd(DateTime(now.year, now.month + 1, 0)));
  }
}

/// Parse CSV text (quotes, doubled quotes, CRLF) into rows of cells.
List<List<String>> parseCsv(String text) {
  final rows = <List<String>>[];
  var row = <String>[];
  final cell = StringBuffer();
  var q = false;
  final t = text.startsWith('﻿') ? text.substring(1) : text;
  for (var i = 0; i < t.length; i++) {
    final ch = t[i];
    if (q) {
      if (ch == '"') {
        if (i + 1 < t.length && t[i + 1] == '"') {
          cell.write('"');
          i++;
        } else {
          q = false;
        }
      } else {
        cell.write(ch);
      }
    } else if (ch == '"') {
      q = true;
    } else if (ch == ',') {
      row.add(cell.toString());
      cell.clear();
    } else if (ch == '\n' || ch == '\r') {
      if (ch == '\r' && i + 1 < t.length && t[i + 1] == '\n') i++;
      row.add(cell.toString());
      cell.clear();
      if (row.any((c) => c.trim().isNotEmpty)) rows.add(row);
      row = <String>[];
    } else {
      cell.write(ch);
    }
  }
  row.add(cell.toString());
  if (row.any((c) => c.trim().isNotEmpty)) rows.add(row);
  return rows;
}

/// Turn a statement date like 05/10/2026, 5-10-26, 2026-10-05 or 5 Oct 2026 into 2026-10-05 ('' if unreadable).
String bankDate(String s) {
  final t = s.trim();
  var m = RegExp(r'^(\d{4})-(\d{1,2})-(\d{1,2})').firstMatch(t);
  if (m != null) return '${m[1]}-${m[2]!.padLeft(2, '0')}-${m[3]!.padLeft(2, '0')}';
  m = RegExp(r'^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})').firstMatch(t);
  if (m != null) {
    var y = int.parse(m[3]!);
    if (y < 100) y += 2000;
    return '$y-${m[2]!.padLeft(2, '0')}-${m[1]!.padLeft(2, '0')}';
  }
  m = RegExp(r'^(\d{1,2})[ \-]([A-Za-z]{3})[a-z]*[ \-,]*(\d{2,4})').firstMatch(t);
  if (m != null) {
    final mi = _mo.indexWhere((x) => x.toLowerCase() == m![2]!.toLowerCase());
    if (mi >= 0) {
      var y = int.parse(m[3]!);
      if (y < 100) y += 2000;
      return '$y-${(mi + 1).toString().padLeft(2, '0')}-${m[1]!.padLeft(2, '0')}';
    }
  }
  return '';
}

/// Guess which CSV column is which for a bank statement. Returns column indexes (-1 = none).
Map<String, int> guessBankColumns(List<String> head) {
  int find(RegExp re) => head.indexWhere((h) => re.hasMatch(h.toLowerCase()));
  return {
    'date': find(RegExp(r'date|txn dt|value')),
    'description': find(RegExp(r'desc|narration|particular|remark|details')),
    'reference': find(RegExp(r'ref|chq|cheque|utr|instr')),
    'debit': find(RegExp(r'withdraw|debit|dr\b|paid out')),
    'credit': find(RegExp(r'deposit|credit|cr\b|paid in')),
  };
}

/// Statement rows in the shape acc_bank_import wants.
List<Map<String, dynamic>> bankRows(List<List<String>> table, Map<String, int> col) {
  String at(List<String> r, String k) => (col[k] ?? -1) >= 0 && col[k]! < r.length ? r[col[k]!].trim() : '';
  return [
    for (final r in table.skip(1))
      if (bankDate(at(r, 'date')).isNotEmpty)
        {'date': bankDate(at(r, 'date')), 'description': at(r, 'description'), 'reference': at(r, 'reference'), 'debit': at(r, 'debit'), 'credit': at(r, 'credit')},
  ];
}

/// Oldest-first split of a payment across outstanding documents: [{doc_id, amount}].
List<Map<String, dynamic>> allocateOldestFirst(double amount, List<Map<String, dynamic>> docs) {
  var left = amount;
  final out = <Map<String, dynamic>>[];
  final sorted = [...docs]..sort((a, b) => '${a['due_date'] ?? a['doc_date']}'.compareTo('${b['due_date'] ?? b['doc_date']}'));
  for (final d in sorted) {
    final o = n(d['outstanding']);
    if (o <= 0 || left <= 0) continue;
    final t = left < o ? left : o;
    out.add({'doc_id': d['id'], 'amount': r2(t)});
    left -= t;
  }
  return out;
}

/// Lines of a credit note from an invoice: quantity to credit per line id (blank/0 = left out).
List<Map<String, dynamic>> creditLines(List<Map<String, dynamic>> lines, Map<String, double> qtyByLine) => [
      for (final l in lines)
        if ((qtyByLine['${l['id']}'] ?? 0) > 0)
          {
            'product_id': l['product_id'], 'account_id': l['account_id'], 'description': l['description'], 'hsn': l['hsn'], 'qty': qtyStr(qtyByLine['${l['id']}']!), 'unit': l['unit'], 'rate': l['rate'],
            'disc_pct': l['disc_pct'], 'disc_amt': null, 'tax_rate': '${l['tax_rate']}', 'warehouse_id': l['warehouse_id'],
          }
    ];
