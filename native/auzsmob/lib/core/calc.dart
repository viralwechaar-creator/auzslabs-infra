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

/// Stock of an item = the sum of its stock movements (never a counter), like the server.
double stockOf(List<Map<String, dynamic>> movements, String itemId) {
  var t = 0.0;
  for (final m in movements) {
    if (m['item_id'] == itemId) t += n(m['qty']);
  }
  return t;
}

class VendorDues {
  VendorDues(this.rows, this.totalPurchased, this.totalPaid);
  final List<Map<String, dynamic>> rows; // each purchase plus `_due`
  final double totalPurchased, totalPaid;
}

/// First-in-first-out: a payment clears the OLDEST unpaid purchase first. A best-effort view of one vendor's bill, computed on
/// the phone from data already synced (voided purchases never carry a due). Same rule as the website.
VendorDues vendorPurchaseDues(List<Map<String, dynamic>> purchases, List<Map<String, dynamic>> payments, String vendorId) {
  final vp = purchases.where((p) => p['vendor_id'] == vendorId && p['voided'] != true).toList()
    ..sort((a, b) {
      final c = '${a['created_at'] ?? ''}'.compareTo('${b['created_at'] ?? ''}');
      return c != 0 ? c : '${a['id']}'.compareTo('${b['id']}');
    });
  final paid = payments.where((p) => p['kind'] == 'vendor_due' && p['vendor_id'] == vendorId).fold<double>(0, (a, p) => a + n(p['amount']));
  var remaining = paid, bought = 0.0;
  final rows = <Map<String, dynamic>>[];
  for (final p in vp) {
    bought += n(p['total']);
    final applied = n(p['total']) < (remaining > 0 ? remaining : 0) ? n(p['total']) : (remaining > 0 ? remaining : 0);
    remaining -= applied;
    rows.add({...p, '_due': r2(n(p['total']) - applied)});
  }
  return VendorDues(rows, bought, paid);
}

/// Amount each vendor is owed: purchases (not voided) minus vendor payments. Only vendors with something due.
Map<String, double> vendorBalances(List<Map<String, dynamic>> purchases, List<Map<String, dynamic>> payments) {
  final by = <String, double>{};
  for (final p in purchases) {
    final v = p['vendor_id'];
    if (v == null || p['voided'] == true) continue;
    by['$v'] = (by['$v'] ?? 0) + n(p['total']);
  }
  for (final p in payments) {
    if (p['kind'] == 'vendor_due' && p['vendor_id'] != null) by['${p['vendor_id']}'] = (by['${p['vendor_id']}'] ?? 0) - n(p['amount']);
  }
  by.removeWhere((_, v) => v <= 0.01);
  return by;
}

String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Report period -> (from, to) as local dates. `custom` uses [from]/[to] (either may be missing).
(String, String) rangeDates(String range, {String? from, String? to, DateTime? now}) {
  final d = now ?? DateTime.now(), today = ymd(d);
  switch (range) {
    case 'week':
      return (ymd(d.subtract(const Duration(days: 6))), today);
    case 'month':
      return (ymd(DateTime(d.year, d.month, 1)), today);
    case 'lastmonth':
      return (ymd(DateTime(d.year, d.month - 1, 1)), ymd(DateTime(d.year, d.month, 0)));
    case 'year':
      return (ymd(DateTime(d.year, 1, 1)), today);
    case 'lastyear':
      return (ymd(DateTime(d.year - 1, 1, 1)), ymd(DateTime(d.year - 1, 12, 31)));
    case 'custom':
      final ok = RegExp(r'^\d{4}-\d{2}-\d{2}$');
      var a = from, b = to;
      final aok = a != null && ok.hasMatch(a), bok = b != null && ok.hasMatch(b);
      if (!aok && !bok) return (today, today);
      if (!aok) a = b;
      if (!bok) b = a;
      return a!.compareTo(b!) <= 0 ? (a, b) : (b, a);
    default:
      return (today, today);
  }
}

class Split {
  Split(this.pct, this.shop, this.staff);
  final double pct, shop, staff;
}

/// Profit sharing: [pct]% of positive profit goes to the shop owner, the rest is the staffer's. 0 = off.
Split splitProfit(num profit, double pct) {
  final p = pct > 0 && pct <= 100 ? pct : 0.0;
  final shop = r2((profit > 0 ? profit : 0) * p / 100);
  return Split(p, shop, r2(profit - shop));
}

String csvEscape(Object? v) {
  final s = v == null ? '' : '$v';
  return RegExp(r'[",\r\n]').hasMatch(s) ? '"${s.replaceAll('"', '""')}"' : s;
}

/// The owner's report spreadsheet: one block per staffer who sold, columns as the website's export, with a total line.
String ledgerCsv(List<Map<String, dynamic>> rows) {
  const head = ['Sold By', 'Purchased By', 'Item Name', 'Qty', 'Purchase Price', 'Selling Price', 'Profit'];
  List<Object?> line(Map<String, dynamic> r) => [r['sold_by'] ?? '', r['purchased_by'] ?? '', r['item_name'], r['qty'], r['cost_total'], r['sale_total'], r['profit']];
  final by = <String, List<Map<String, dynamic>>>{};
  for (final r in rows) {
    (by[(r['sold_by'] ?? '—') as String] ??= []).add(r);
  }
  double sum(List<Map<String, dynamic>> l, String k) => l.fold(0.0, (a, r) => a + n(r[k]));
  final out = <List<Object?>>[];
  by.forEach((_, list) {
    if (out.isNotEmpty) out.add(const []);
    out.add(head);
    out.addAll(list.map(line));
    out.add(['', '', 'Total', sum(list, 'qty'), sum(list, 'cost_total'), sum(list, 'sale_total'), sum(list, 'profit')]);
  });
  return '\u{feff}${out.map((r) => r.map(csvEscape).join(',')).join('\r\n')}';
}

/// "Who is shown as hindi/english" helper for server status words like in_repair.
const repairStatuses = ['received', 'in_repair', 'ready', 'delivered', 'cancelled'];
