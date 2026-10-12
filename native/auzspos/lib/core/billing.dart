/// Billing math. A line-for-line port of tot() in app/public/pos/core.js (the website POS), so a bill made here and a bill
/// made on the web come to the same paisa (including Buy-N-Get-M offers). Any change to the web tot() must be mirrored here and in test/billing_test.dart.
import 'dart:math' as math;

double r2(num? n) => ((n ?? 0).toDouble() * 100).roundToDouble() / 100;

/// JS Math.round: halves round towards +infinity.
double jsRound(double x) => (x + 0.5).floorToDouble();

class Totals {
  Totals({required this.sub, required this.d, required this.tax, required this.round, required this.total, required this.net, required this.rates, this.svc = 0, this.pack = 0, this.deliv = 0, this.offer = 0, this.offers = const []});
  final double sub, d, tax, round, total, net, svc, pack, deliv, offer;
  final List<Map<String, dynamic>> offers;
  final Map<String, Map<String, double>> rates;

  Map<String, dynamic> toJson() => {
        'sub': sub, 'd': d, 'tax': tax, 'round': round, 'total': total, 'net': net,
        'rates': rates,
        if (svc != 0) 'svc': svc,
        if (pack != 0) 'pack': pack,
        if (deliv != 0) 'deliv': deliv,
        if (offer != 0) 'offer': offer,
        if (offer != 0) 'offers': offers,
      };
}

num _n(dynamic v) => v is num ? v : (num.tryParse('${v ?? ''}') ?? 0);

/// [cfg] is the business settings record; [taxes] maps a tax record id to its record data; [items] maps an item id to its data.
Totals tot(Map<String, dynamic> o, Map<String, dynamic> cfg, {Map<String, Map<String, dynamic>> taxes = const {}, Map<String, Map<String, dynamic>> items = const {}, List<Map<String, dynamic>> offerRecords = const [], String today = ''}) {
  final lines = ((o['lines'] as List?) ?? const []).cast<Map<String, dynamic>>();
  double rateOf(Map<String, dynamic> l) {
    final it = items[l['id']];
    final t = it != null && it['taxId'] != null ? taxes[it['taxId']] : null;
    return t != null ? _n(t['rate']).toDouble() : _n(cfg['tax'] ?? 5).toDouble();
  }

  bool inclusiveOf(Map<String, dynamic> l) {
    final it = items[l['id']];
    final t = it != null && it['taxId'] != null ? taxes[it['taxId']] : null;
    if (t != null && t['inclusive'] != null) return t['inclusive'] == true;
    return cfg['taxInclusive'] == true;
  }

  final sub = r2(lines.fold<double>(0, (a, l) => a + _n(l['price']) * _n(l['qty'])));
  final comp = o['complimentary'] == true;
  final offers = comp ? <_Offer>[] : _offerMatches(lines, offerRecords, items, today);
  final offerDisc = r2(offers.fold<double>(0, (a, x) => a + x.amt));
  final effSub = r2(sub - offerDisc);
  double d = 0;
  final disc = o['disc'] as Map<String, dynamic>?;
  if (comp) {
    d = sub;
  } else if (disc != null) {
    final v = _n(disc['v']).toDouble();
    d = r2(math.min(effSub, disc['t'] == '%' ? (effSub * v) / 100 : v));
  }
  final keep = effSub != 0 ? (effSub - d) / effSub : 1.0;
  final rates = <double, Map<String, double>>{};
  double base = 0, tax = 0;
  for (var idx = 0; idx < lines.length; idx++) {
    final l = lines[idx];
    final lineOfferAmt = offers.fold<double>(0, (a, x) => a + (x.perLine[idx] ?? 0));
    final g = (_n(l['price']) * _n(l['qty']) - lineOfferAmt) * keep;
    final rt = rateOf(l), inc = inclusiveOf(l);
    final b = inc ? g / (1 + rt / 100) : g, t = inc ? g - b : (g * rt) / 100;
    base += b;
    tax += t;
    final x = rates.putIfAbsent(rt, () => {'base': 0, 'tax': 0});
    x['base'] = x['base']! + b;
    x['tax'] = x['tax']! + t;
  }
  // charges
  final net = effSub - d;
  double svc = 0, pack = 0, deliv = 0;
  if (!comp && net > 0) {
    final type = o['type'];
    if (type == 'Dine-in' && _n(cfg['serviceChargePct']) > 0 && o['noSvc'] != true) svc = r2((net * _n(cfg['serviceChargePct'])) / 100);
    if ((type == 'Takeaway' || type == 'Delivery') && _n(cfg['packingCharge']) > 0) pack = r2(_n(cfg['packingCharge']));
    if (type == 'Delivery' && _n(cfg['deliveryCharge']) > 0) deliv = r2(_n(cfg['deliveryCharge']));
  }
  final chSum = svc + pack + deliv;
  final chRate = _n(cfg['chargesTax'] ?? cfg['tax'] ?? 5).toDouble();
  if (chSum != 0) {
    final x = rates.putIfAbsent(chRate, () => {'base': 0, 'tax': 0});
    x['base'] = x['base']! + chSum;
    x['tax'] = x['tax']! + (chSum * chRate) / 100;
    tax += (chSum * chRate) / 100;
  }
  base = r2(base);
  tax = r2(tax);
  final ex = r2(base + chSum + tax);
  final total = cfg['roundOff'] == false ? ex : jsRound(ex);
  final outRates = <String, Map<String, double>>{};
  rates.forEach((k, v) => outRates[_key(k)] = {'base': r2(v['base']), 'tax': r2(v['tax'])});
  return Totals(sub: sub, d: d, tax: tax, round: r2(total - ex), total: total, net: r2(base + chSum), rates: outRates, svc: svc, pack: pack, deliv: deliv, offer: offerDisc, offers: [for (final x in offers) {'id': x.id, 'name': x.name, 'amt': x.amt, 'desc': x.desc}]);
}

/// JS object keys print whole numbers without ".0" (5 -> "5", 2.5 -> "2.5").
String _key(double r) => r == r.truncateToDouble() ? r.toInt().toString() : r.toString();

double paidSoFar(Map<String, dynamic> o) => r2(((o['pays'] as List?) ?? const []).fold<double>(0, (a, p) => a + _n((p as Map)['amt'])));

class _Offer {
  _Offer(this.id, this.name, this.amt, this.perLine, this.desc);
  final String id, name, desc;
  final double amt;
  final Map<int, double> perLine;
}

bool _offerActive(Map<String, dynamic> off, String today) {
  if (off['active'] == false) return false;
  if (off['from'] != null && '${off['from']}'.isNotEmpty && today.compareTo('${off['from']}') < 0) return false;
  if (off['to'] != null && '${off['to']}'.isNotEmpty && today.compareTo('${off['to']}') > 0) return false;
  return true;
}

/// Port of offerMatches(): one offer per line at most, item offers before category offers, whole buy+get groups only.
List<_Offer> _offerMatches(List<Map<String, dynamic>> lines, List<Map<String, dynamic>> all, Map<String, Map<String, dynamic>> items, String today) {
  final offers = all.where((o) => _offerActive(o, today)).toList();
  offers.sort((a, b) => (a['scope'] == 'item' ? 0 : 1) - (b['scope'] == 'item' ? 0 : 1));
  final used = <int>{};
  final out = <_Offer>[];
  for (final off in offers) {
    final buy = math.max(1, _n(off['buyQty'] == null || _n(off['buyQty']) == 0 ? 1 : off['buyQty']).toInt());
    final get = math.max(1, _n(off['getQty'] == null || _n(off['getQty']) == 0 ? 1 : off['getQty']).toInt());
    final pct = math.min(100, math.max(0, off['getPct'] == null ? 100 : _n(off['getPct']).toDouble())).toDouble();
    final idxs = <int>[];
    for (var i = 0; i < lines.length; i++) {
      final l = lines[i];
      if (used.contains(i) || !(_n(l['qty']) > 0)) continue;
      final it = items['${l['id']}'];
      if (it == null) continue;
      if (off['scope'] == 'item' ? l['id'] == off['scopeId'] : off['scope'] == 'cat' && it['cat'] == off['scopeId']) idxs.add(i);
    }
    if (idxs.isEmpty) continue;
    final qty = idxs.fold<num>(0, (a, i) => a + _n(lines[i]['qty']));
    var discQty = (qty / (buy + get)).floor() * get;
    if (discQty <= 0) continue;
    final order = [...idxs]..sort((a, b) => _n(lines[a]['price']).compareTo(_n(lines[b]['price'])));
    final perLine = <int, double>{};
    var amt = 0.0;
    for (final i in order) {
      if (discQty <= 0) break;
      final give = math.min(_n(lines[i]['qty']).toInt(), discQty);
      final a = r2((give * _n(lines[i]['price']) * pct) / 100);
      perLine[i] = (perLine[i] ?? 0) + a;
      amt = r2(amt + a);
      discQty -= give;
      used.add(i);
    }
    if (amt > 0) {
      final label = '$buy Get $get${pct < 100 ? ' (${_key(pct)}% off)' : ''}';
      final name = off['name'] ?? 'Offer';
      out.add(_Offer('${off['id']}', '$name', amt, perLine, 'Offer: Buy $label — ${off['name'] ?? 'applied item'}'));
    }
  }
  return out;
}
