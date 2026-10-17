// The Owner/Admin Console Dashboard's per-day analytics, ported from the website's own
// app/public/console/p-dashboard.js and app/public/console/core.js. Pure functions over a Repo, same
// split as costing.dart/stock_test.dart, so each formula is directly provable against the website's
// own arithmetic rather than trusted by inspection.
//
// Deliberate naming/behavior notes, so nobody "fixes" these back to a subtly different answer:
//   - `netOf()` (website core.js: `o.t.total - sum(refunds.amt)`) is the figure the Dashboard's
//     revenue, channel and payment-mode cards all use -- NOT the raw bill total. A bill with a partial
//     refund shows its reduced, real revenue, same as the website.
//   - `isOnline()` is `!!o.src` on the website -- any order with a non-empty `src` field counts as
//     "online", regardless of which platform. A table-QR self-order is NOT online by this definition
//     (self-order writes do not set `src`); only aggregator/online-channel orders do.
//   - `chanOf()` treats anything that is not literally `type=='Takeaway'` or `type=='Delivery'` as
//     Dine-In, matching the website's own `o.type=='Delivery'?'Delivery':o.type=='Takeaway'?
//     'Takeaway':'Dine-In'` fallback exactly (an order with a blank/unknown type is Dine-In, not
//     "Other").
//   - The website's `dayStats()` reads `hours[new Date(o.paidAt).getHours()]` in the BROWSER's local
//     timezone; this port uses `DateTime.parse(...).toLocal().hour` for the same effect on the device.
import 'repo.dart';

/// `o.t.total - sum(o.refunds[].amt)`, rounded to 2 decimals the same way everywhere else in this
/// codebase rounds money (see billing.dart's r2).
num netOf(Map<String, dynamic> o) {
  final total = ((o['t'] as Map?)?['total'] ?? 0) as num;
  final refunds = ((o['refunds'] as List?) ?? const []).cast<Map>();
  final refunded = refunds.fold<num>(0, (a, r) => a + ((r['amt'] ?? 0) as num));
  return _r2(total - refunded);
}

num _r2(num n) => (n.toDouble() * 100).roundToDouble() / 100;

/// `!!o.src` -- any non-empty `src` marks an order as coming from an online channel (aggregator,
/// website, etc). A table-QR self-order never sets `src`, so it is never "online" by this definition.
bool isOnline(Map<String, dynamic> o) => '${o['src'] ?? ''}'.isNotEmpty;

/// Dine-In / Takeaway / Delivery, matching the website's `chanOf()` exactly (anything that is not
/// literally 'Delivery' or 'Takeaway' falls back to 'Dine-In').
String chanOf(Map<String, dynamic> o) {
  final t = '${o['type'] ?? ''}';
  if (t == 'Delivery') return 'Delivery';
  if (t == 'Takeaway') return 'Takeaway';
  return 'Dine-In';
}

/// One channel's order count + net revenue.
class ChannelStat {
  ChannelStat({this.count = 0, this.value = 0});
  int count;
  num value;
}

/// Everything the website's `dayStats(d)` computes for one calendar day (device-local `yyyy-MM-dd`):
/// net revenue, the payment-mode split (cash/card/upi/other/online, each net of a cash order's
/// change), unpaid-due total for bills CREATED that day, the three order channels, revenue by hour of
/// day (0-23, device-local), and the count of all non-void orders CREATED that day (not just paid
/// ones -- matches the website's own `count:createdOn(d).length`, used by "Total Orders").
class DayStats {
  DayStats({required this.rev, required this.pay, required this.unpaid, required this.ch, required this.hours, required this.count, required this.paidOrders});
  final num rev;
  final Map<String, num> pay; // cash, card, upi, other, online
  final num unpaid;
  final Map<String, ChannelStat> ch; // 'Dine-In','Takeaway','Delivery'
  final List<num> hours; // length 24
  final int count;
  final List<Map<String, dynamic>> paidOrders;
}

String _dayKeyOf(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

String _dayOfIso(dynamic iso) {
  final t = DateTime.tryParse('$iso')?.toLocal();
  return t == null ? '' : _dayKeyOf(t);
}

/// Every non-void order (has lines+totals), matching the website's own `orders()` filter.
Iterable<Map<String, dynamic>> _orders(Repo repo) => repo.of('order').where((o) => o['t'] != null && (o['lines'] as List?)?.isNotEmpty == true);

DayStats dayStats(Repo repo, String day) {
  final all = _orders(repo).toList();
  final paid = all.where((o) => o['status'] == 'paid' && _dayOfIso(o['paidAt']) == day).toList();
  final rev = paid.fold<num>(0, (a, o) => a + netOf(o));
  final pay = <String, num>{'cash': 0, 'card': 0, 'upi': 0, 'other': 0, 'online': 0};
  for (final o in paid) {
    if (isOnline(o)) {
      pay['online'] = pay['online']! + netOf(o);
      continue;
    }
    for (final p in ((o['pays'] as List?) ?? const []).cast<Map>()) {
      final m = '${p['m'] ?? ''}';
      final change = m == 'cash' ? ((o['change'] ?? 0) as num) : 0;
      final amt = ((p['amt'] ?? 0) as num) - change;
      if (m == 'cash') {
        pay['cash'] = pay['cash']! + amt;
      } else if (m == 'card') {
        pay['card'] = pay['card']! + amt;
      } else if (m == 'upi') {
        pay['upi'] = pay['upi']! + amt;
      } else {
        pay['other'] = pay['other']! + amt;
      }
    }
  }
  final unpaid = all.where((o) => o['status'] == 'due' && _dayOfIso(o['created']) == day).fold<num>(0, (a, o) {
    final total = ((o['t'] as Map?)?['total'] ?? 0) as num;
    final paidSoFar = ((o['pays'] as List?) ?? const []).cast<Map>().fold<num>(0, (b, p) => b + ((p['amt'] ?? 0) as num));
    return a + (total - paidSoFar);
  });
  final ch = {'Dine-In': ChannelStat(), 'Takeaway': ChannelStat(), 'Delivery': ChannelStat()};
  for (final o in paid) {
    final c = ch[chanOf(o)]!;
    c.count++;
    c.value += netOf(o);
  }
  final hours = List<num>.filled(24, 0);
  for (final o in paid) {
    final t = DateTime.tryParse('${o['paidAt']}')?.toLocal();
    if (t != null) hours[t.hour] += netOf(o);
  }
  final count = all.where((o) => o['status'] != 'void' && _dayOfIso(o['created']) == day).length;
  return DayStats(rev: _r2(rev), pay: pay, unpaid: _r2(unpaid), ch: ch, hours: hours, count: count, paidOrders: paid);
}

/// `dayKey(DateTime)` -- exposed so callers (and tests) can build the same device-local day string
/// `dayStats()` expects, without duplicating the format elsewhere.
String dayKeyOf(DateTime d) => _dayKeyOf(d);

/// One named item's quantity sold and revenue, for the "Top Performing Items" card.
class ItemStat {
  ItemStat(this.name, this.qty, this.amount);
  final String name;
  final num qty, amount;
}

/// Ported from the website's `itemStats(from,to)`: sums quantity+revenue per item name across every
/// PAID order whose `paidAt` day falls within [from, to] (inclusive, both device-local day strings).
Map<String, ItemStat> itemStats(Repo repo, String from, String to) {
  final m = <String, ItemStat>{};
  for (final o in _orders(repo)) {
    if (o['status'] != 'paid') continue;
    final d = _dayOfIso(o['paidAt']);
    if (d.isEmpty || d.compareTo(from) < 0 || d.compareTo(to) > 0) continue;
    for (final l in ((o['lines'] as List?) ?? const []).cast<Map>()) {
      final name = '${l['name'] ?? ''}';
      final qty = (l['qty'] ?? 0) as num;
      final price = (l['price'] ?? 0) as num;
      final prev = m[name];
      m[name] = ItemStat(name, (prev?.qty ?? 0) + qty, (prev?.amount ?? 0) + price * qty);
    }
  }
  return m;
}

/// Top (or lowest) [n] items by quantity sold, each with its share of the total quantity -- matches
/// the website's own `list=[...arr].sort(...).slice(0,5)` plus `(x.q/total*100)` percentage.
List<({String name, num qty, double pct})> topOrLowItems(Map<String, ItemStat> stats, {bool best = true, int n = 5}) {
  final arr = stats.values.toList();
  final total = arr.fold<num>(0, (a, x) => a + x.qty).clamp(1, double.infinity);
  arr.sort((a, b) => best ? b.qty.compareTo(a.qty) : a.qty.compareTo(b.qty));
  return [for (final x in arr.take(n)) (name: x.name, qty: x.qty, pct: (x.qty / total * 100))];
}

/// One online-ordering platform's order count/prepaid-vs-COD split/revenue, for the "Online Orders
/// Overview" card.
class PlatformStat {
  PlatformStat({this.n = 0, this.pre = 0, this.cod = 0, this.rev = 0});
  int n, pre, cod;
  num rev;
}

/// Online orders CREATED/PAID that day (ported from the website's `onl=st.ps.filter(isOnline)` --
/// i.e. taken from that day's PAID orders, same `dayStats().paidOrders` this port already computes),
/// split by platform (`o.src`, 'Other' when blank) and prepaid (any non-cash payment) vs. COD.
Map<String, PlatformStat> onlinePlatformStats(DayStats day) {
  final byP = <String, PlatformStat>{};
  for (final o in day.paidOrders.where(isOnline)) {
    final k = '${o['src'] ?? ''}'.isEmpty ? 'Other' : '${o['src']}';
    final e = byP.putIfAbsent(k, () => PlatformStat());
    e.n++;
    e.rev += netOf(o);
    final prepaid = ((o['pays'] as List?) ?? const []).cast<Map>().any((p) => '${p['m'] ?? ''}' != 'cash');
    if (prepaid) {
      e.pre++;
    } else {
      e.cod++;
    }
  }
  return byP;
}

/// Revenue Leakage counters for one day -- ported from the website's `leakRows` exactly, reading the
/// same fields other native screens already write (void log, refunds/exchanges, shifted/reprints,
/// complimentary+discount).
class RevenueLeakage {
  RevenueLeakage({required this.kots, required this.cancelledBills, required this.modifiedBills, required this.shiftedOrders, required this.reprintedBills, required this.waivedOff});
  final int kots, cancelledBills, modifiedBills, shiftedOrders, reprintedBills;
  final num waivedOff;
}

RevenueLeakage revenueLeakage(Repo repo, String day) {
  final voidLog = repo.ofAll('voidlog').where((v) => _dayOfIso(v['at']) == day).toList();
  final dayOrders = _orders(repo).where((o) => _dayOfIso(o['created']) == day || _dayOfIso(o['paidAt']) == day).toList();
  final kots = voidLog.where((v) => v['item'] != null).length;
  final cancelled = dayOrders.where((o) => o['status'] == 'void').length;
  final modified = dayOrders.where((o) => (((o['refunds'] as List?) ?? const []).isNotEmpty) || (((o['exchanges'] as List?) ?? const []).isNotEmpty)).length;
  final shifted = dayOrders.where((o) => o['shifted'] == true).length;
  final reprinted = dayOrders.where((o) => o['reprints'] != null && o['reprints'] != 0 && o['reprints'] != false).length;
  final waived = dayOrders.where((o) => o['status'] != 'void').fold<num>(0, (a, o) {
    final total = ((o['t'] as Map?)?['total'] ?? 0) as num;
    final disc = ((o['t'] as Map?)?['d'] ?? 0) as num;
    return a + (o['complimentary'] == true ? total : 0) + disc;
  });
  return RevenueLeakage(kots: kots, cancelledBills: cancelled, modifiedBills: modified, shiftedOrders: shifted, reprintedBills: reprinted, waivedOff: _r2(waived));
}
