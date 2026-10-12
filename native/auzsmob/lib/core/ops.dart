import 'dart:math';
import 'calc.dart';
import 'session.dart';

final _rnd = Random.secure();

/// A random id the phone makes itself (the server keeps writes idempotent on it, so a retried push is always safe).
String newId() {
  final b = List<int>.generate(16, (_) => _rnd.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
  return '${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}';
}

String nowIso() => DateTime.now().toUtc().toIso8601String();

/// Creates or edits a catalogue item on the phone and queues it. [base] is the server's updated_at when editing (the platform's
/// optimistic-concurrency token), null for a brand-new item.
Future<void> localSaveItem(MobSession s, String id, Map<String, dynamic> data, {String? base}) async {
  final r = s.repo!;
  await r.put('items', {
    'id': id, 'name': data['name'], 'category': data['category'], 'serialized': data['serialized'] == true,
    'selling_price': n(data['sellingPrice']), 'cost_price': n(data['costPrice']), 'low_stock_at': n(data['lowStockAt']), 'active': true, '_pending': true,
  });
  await r.outboxAdd('mob_save_item', {'p_id': id, 'p': data, 'p_base': base});
}

Future<void> localSaveVendor(MobSession s, String id, Map<String, dynamic> data, {String? base}) async {
  final r = s.repo!;
  await r.put('vendors', {'id': id, 'name': data['name'], 'phone': data['phone'], '_pending': true});
  await r.outboxAdd('mob_save_vendor', {'p_id': id, 'p': data, 'p_base': base});
}

/// Writes a purchase on the phone the way mob_push_purchase will on the server, so a just-bought phone can be sold offline at once.
Future<void> localPurchase(MobSession s, {required String itemId, String? vendorId, required double qty, required double rate, String? imei, double? sellingPrice, bool serialized = false, String? unitId}) async {
  final r = s.repo!;
  final pid = newId();
  final uid = serialized ? (unitId ?? newId()) : null;
  final args = <String, dynamic>{'itemId': itemId, 'vendorId': vendorId, 'qty': qty, 'rate': rate, 'imei': uid != null ? imei : null, 'sellingPrice': sellingPrice, 'unitId': uid};
  final now = nowIso();
  if (uid != null) {
    await r.put('units', {'id': uid, 'item_id': itemId, 'imei': args['imei'], 'imei2': null, 'source': 'new', 'condition': null, 'seller_name': null, 'seller_phone': null, 'id_proof_url': null, 'accessories_included': null, 'cost_price': rate, 'selling_price': sellingPrice, 'status': 'in_stock', 'created_at': now, 'updated_at': now});
    await r.put('stockMovements', {'id': newId(), 'item_id': itemId, 'unit_id': uid, 'qty': 1, 'type': 'purchase', 'ref_id': pid, 'staff_id': s.user!['id'], 'created_at': now});
  } else if (s.feat('stock')) {
    await r.put('stockMovements', {'id': newId(), 'item_id': itemId, 'unit_id': null, 'qty': qty, 'type': 'purchase', 'ref_id': pid, 'staff_id': s.user!['id'], 'created_at': now});
  }
  await r.localPush('purchases', {'id': pid, 'item_id': itemId, 'vendor_id': vendorId, 'qty': qty, 'rate': rate, 'total': qty * rate, 'staff_id': s.user!['id'], 'created_at': now}, 'mob_push_purchase', {'p_id': pid, 'p': args});
}
