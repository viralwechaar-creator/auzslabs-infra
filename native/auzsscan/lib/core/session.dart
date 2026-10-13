import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../ui/i18n.dart';
import 'api.dart';
import 'calc.dart';
import 'push.dart';
import 'store.dart';

/// Signed-in state for AUZsScan. It runs on the AUZsLedger books: the same functions as the website's Scan to bill
/// (acc_list_products, acc_save_product, acc_stock_adjust, acc_offline_apply, acc_share_document).
class ScanSession extends ChangeNotifier {
  final api = ApiClient();
  LocalStore? store;
  Map<String, dynamic>? user;
  Map<String, dynamic> dash = {}, ctx = {};
  String? notice;
  Timer? _timer;

  List<Map<String, dynamic>> products = [], baseProducts = [], parties = [];
  /// Entries kept on the phone until the books accept them: {op, at, kind, payload, state, meta, error?, lastError?}.
  List<Map<String, dynamic>> queue = [];
  bool syncing = false, offline = false;
  final refused = ValueNotifier<String?>(null);

  bool get signedIn => user != null && store != null;
  String get role => '${user?['role'] ?? dash['my_role'] ?? ''}';
  String get slug => '${(dash['tenant'] as Map?)?['slug'] ?? ''}';
  String get origin => slug.isEmpty ? 'https://app.auzslab.in' : 'https://$slug.auzslab.in';
  Map<String, dynamic> get org => ctx['org'] is Map ? Map<String, dynamic>.from(ctx['org'] as Map) : const {};
  Map<String, dynamic> get perms => ctx['perms'] is Map ? Map<String, dynamic>.from(ctx['perms'] as Map) : const {};
  bool can(String k) => perms[k] == true;
  List<Map<String, dynamic>> _list(String k) => ((ctx[k] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  List<Map<String, dynamic>> get accounts => _list('accounts');
  List<Map<String, dynamic>> get taxcodes => _list('taxcodes');
  List<Map<String, dynamic>> get branches => _list('branches');
  List<Map<String, dynamic>> get warehouses => _list('warehouses');
  String get orgName => '${org['trade_name'] ?? ''}'.isNotEmpty ? '${org['trade_name']}' : ('${org['legal_name'] ?? ''}'.isNotEmpty ? '${org['legal_name']}' : '${(dash['tenant'] as Map?)?['name'] ?? ''}');
  bool get allowNegative => org['allow_negative_stock'] == true;

  /// GST rates the business uses (0 always included).
  List<double> get taxRates {
    final s = <double>{0, for (final t in taxcodes) if (t['active'] == true && t['kind'] == 'taxable') n(t['rate'])};
    return s.toList()..sort();
  }
  double get defaultTaxRate => taxRates.contains(18) ? 18 : (taxRates.length > 1 ? taxRates[1] : 0);
  List<Map<String, dynamic>> payAccounts(String kind) {
    final all = accounts.where((a) => (a['is_bank'] == true || a['is_cash'] == true) && a['active'] == true).toList();
    final m = kind == 'cash' ? all.where((a) => a['is_cash'] == true).toList() : all.where((a) => a['is_bank'] == true).toList();
    return m.isNotEmpty ? m : all;
  }

  /// Entitled to AUZsScan (own product) or AUZsLedger, and not switched off by the owner. Unknown counts as allowed.
  bool get allowed {
    final f = dash['features'];
    if (f is! Map) return true;
    final e = dash['enabled_features'];
    bool on(String k) => f[k] == true && !(e is Map && e[k] == false);
    return on('scan') || on('accounting');
  }
  bool featureOn(String k) {
    final f = dash['features'];
    final e = dash['enabled_features'];
    return f is! Map || (f[k] == true && !(e is Map && e[k] == false));
  }

  // ---- sign in ----
  Future<void> restore() async {
    final p = await SharedPreferences.getInstance();
    final t = p.getString('token'), u = p.getString('user');
    if (t == null || u == null) return;
    api.token = t;
    await _open(Map<String, dynamic>.from(jsonDecode(u) as Map));
  }

  Future<void> signIn(Map<String, dynamic> u) async {
    final p = await SharedPreferences.getInstance();
    await p.setString('token', api.token!);
    await p.setString('user', jsonEncode(u));
    await _open(u);
  }

  Future<void> _open(Map<String, dynamic> u) async {
    api.onSessionExpired = () => signOut(message: 'Your session ended. Please sign in again.');
    await openWith(u, await SqliteStore.open('${u['id']}'));
  }

  Future<void> openWith(Map<String, dynamic> u, LocalStore s) async {
    store = s;
    user = {...u};
    unawaited(PushRegistration.register(api, '${u['id']}'));
    final cp = await s.meta('products'), cq = await s.meta('parties');
    baseProducts = cp == null ? [] : _decodeList(cp);
    parties = cq == null ? [] : _decodeList(cq);
    queue = (await s.all('queue'))..sort((a, b) => n(a['at']).compareTo(n(b['at'])));
    products = overlay(baseProducts);
    try {
      dash = Map<String, dynamic>.from(await api.rpc('my_dashboard') as Map);
      await s.setMeta('dash', jsonEncode(dash));
    } on ApiError catch (e) {
      if (e.status == 401) return;
      final c = await s.meta('dash');
      if (c != null) dash = Map<String, dynamic>.from(jsonDecode(c) as Map);
    }
    user!['role'] = dash['my_role'] ?? user!['role'];
    user!['email'] = dash['my_email'] ?? user!['email'];
    if (allowed) {
      try {
        ctx = Map<String, dynamic>.from(await api.rpc('acc_bootstrap') as Map);
        await s.setMeta('ctx', jsonEncode(ctx));
      } on ApiError catch (e) {
        if (e.status == 401) return;
        final c = await s.meta('ctx');
        if (c != null) ctx = Map<String, dynamic>.from(jsonDecode(c) as Map);
      }
      notifyListeners();
      unawaited(refreshProducts().then((_) => flush()));
    }
    notifyListeners();
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => flush());
  }

  List<Map<String, dynamic>> _decodeList(String j) => (jsonDecode(j) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  // ---- catalogue ----
  static const productCap = 5000;
  bool productsPartial = false;

  /// Reloads the product list from the books (keeps the copy on the phone when there is no connection).
  Future<void> refreshProducts() async {
    try {
      final d = await api.rpc('acc_list_products', {'p': {'limit': productCap}});
      final rows = ((d as Map)['rows'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      baseProducts = rows;
      productsPartial = rows.length >= productCap;
      await store!.setMeta('products', jsonEncode(rows));
      offline = false;
    } on ApiError catch (e) {
      if (e.networkError) offline = true;
    }
    products = overlay(baseProducts);
    notifyListeners();
  }

  Future<void> refreshParties() async {
    try {
      final d = await api.rpc('acc_list_parties', {'p': {'limit': 5000, 'include_inactive': true}});
      parties = ((d as Map)['rows'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      await store!.setMeta('parties', jsonEncode(parties));
    } on ApiError {
      /* keep the copy on the phone */
    }
    notifyListeners();
  }

  /// A product folded into the cached lists after it was saved elsewhere (a price edit).
  void remember(Map<String, dynamic> row) {
    for (final l in [baseProducts, products]) {
      final i = l.indexWhere((x) => x['id'] == row['id']);
      if (i >= 0) {
        l[i] = {...l[i], ...row};
      } else {
        l.add(row);
      }
    }
    store?.setMeta('products', jsonEncode(baseProducts));
    notifyListeners();
  }

  /// Stock shown on the phone = the last list from the books with the waiting sales, receipts and new products applied.
  List<Map<String, dynamic>> overlay(List<Map<String, dynamic>> list) {
    final rows = list.map((p) => {...p}).toList();
    final by = {for (final p in rows) '${p['id']}': p};
    for (final it in queue) {
      if (it['state'] == 'refused') continue;
      final payload = it['payload'] as Map;
      final lines = ((payload['lines'] as List?) ?? const []).cast<Map>();
      if (it['kind'] == 'product') {
        final t = (it['meta'] as Map?)?['temp'];
        if (t is Map && !by.containsKey('${t['id']}')) {
          final row = {...Map<String, dynamic>.from(t), 'stock': 0};
          rows.add(row);
          by['${t['id']}'] = row;
        }
      } else if (it['kind'] == 'sale') {
        for (final l in lines) {
          final p = by['${l['product_id']}'];
          if (p != null && p['track_stock'] == true && p['is_service'] != true) p['stock'] = n(p['stock']) - n(l['qty']);
        }
      } else if (it['kind'] == 'stock') {
        for (final l in lines) {
          final p = by['${l['product_id']}'];
          if (p != null) p['stock'] = n(p['stock']) + n(l['qty']);
        }
      }
    }
    return rows;
  }

  // ---- offline queue ----
  String newOp() => '${DateTime.now().millisecondsSinceEpoch}${(DateTime.now().microsecond * 7919).toRadixString(36)}';
  String tempId() => 'local:${newOp()}';
  static bool isTemp(Object? id) => id is String && id.startsWith('local:');

  /// A provisional bill number (OFF-<phone code>-<n>) until the books give the real gapless one.
  Future<String> nextRef() async {
    final p = await SharedPreferences.getInstance();
    final dev = p.getString('scan.dev') ?? (() {
      final d = (DateTime.now().microsecondsSinceEpoch.toRadixString(36)).toUpperCase();
      final v = d.substring(d.length - 3);
      p.setString('scan.dev', v);
      return v;
    })();
    final c = (p.getInt('scan.seq') ?? 0) + 1;
    await p.setInt('scan.seq', c);
    return 'OFF-$dev-${c.toString().padLeft(3, '0')}';
  }

  Future<Map<String, dynamic>> enqueue(String kind, Map<String, dynamic> payload, {Map<String, dynamic>? meta, String? op}) async {
    final Map<String, dynamic> row = {'id': op ?? newOp(), 'op': '', 'at': DateTime.now().millisecondsSinceEpoch, 'kind': kind, 'payload': payload, 'state': 'waiting', 'meta': meta ?? {}};
    row['op'] = row['id'];
    await store!.put('queue', row);
    queue = [...queue, row];
    products = overlay(baseProducts);
    notifyListeners();
    return row;
  }

  Future<void> discard(String op) async {
    await store!.del('queue', op);
    queue = queue.where((x) => x['op'] != op).toList();
    products = overlay(baseProducts);
    notifyListeners();
  }

  Future<void> retry(String op) async {
    final i = queue.indexWhere((x) => x['op'] == op);
    if (i < 0) return;
    queue[i] = {...queue[i], 'state': 'waiting'}..remove('error');
    await store!.put('queue', queue[i]);
    await flush();
  }

  static bool transient(ApiError e) => e.networkError || e.status == null || e.status! >= 500 || e.status == 401 || e.status == 408 || e.status == 429;

  dynamic _subst(dynamic v, Map<String, String> map) {
    if (v is String) return map[v] ?? v;
    if (v is List) return v.map((e) => _subst(e, map)).toList();
    if (v is Map) return {for (final e in v.entries) e.key: _subst(e.value, map)};
    return v;
  }

  /// Sends the waiting entries to the books in order. Idempotent on the operation id, so a retry never makes a second bill.
  Future<({int sent, int refused})> flush() async {
    if (syncing || store == null) return (sent: 0, refused: 0);
    syncing = true;
    notifyListeners();
    var sent = 0, refusedN = 0;
    try {
      final mj = await store!.meta('scan.map');
      final map = mj == null ? <String, String>{} : Map<String, String>.from(jsonDecode(mj) as Map);
      for (final it in List.of(queue)) {
        if (it['state'] == 'refused') {
          refusedN++;
          continue;
        }
        try {
          final payload = _subst(it['payload'], map) as Map;
          final r = await api.rpc('acc_offline_apply', {'p': {'op': it['op'], 'kind': it['kind'], 'payload': payload}});
          final Map<dynamic, dynamic> res = r is Map ? r : const {};
          final meta = (it['meta'] as Map?) ?? const {};
          if (it['kind'] == 'product' && meta['temp'] is Map && res['id'] != null) {
            map['${(meta['temp'] as Map)['id']}'] = '${res['id']}';
            await store!.setMeta('scan.map', jsonEncode(map));
          }
          if (it['kind'] == 'sale') {
            await _remember({'ref': meta['ref'], 'id': res['id'], 'number': res['number'], 'total': res['total'], 'at': it['at'], 'name': meta['name'], 'phone': meta['phone']});
          }
          await store!.del('queue', '${it['op']}');
          queue = queue.where((x) => x['op'] != it['op']).toList();
          sent++;
          offline = false;
        } on ApiError catch (e) {
          final i = queue.indexWhere((x) => x['op'] == it['op']);
          if (transient(e)) {
            offline = e.networkError;
            if (i >= 0) {
              queue[i] = {...queue[i], 'lastError': e.message, 'lastTry': DateTime.now().millisecondsSinceEpoch};
              await store!.put('queue', queue[i]);
            }
            break;
          }
          if (i >= 0) {
            queue[i] = {...queue[i], 'state': 'refused', 'error': e.message};
            await store!.put('queue', queue[i]);
          }
          refusedN++;
          refused.value = e.message;
        }
      }
    } finally {
      syncing = false;
    }
    if (sent > 0) await refreshProducts();
    products = overlay(baseProducts);
    notifyListeners();
    return (sent: sent, refused: refusedN);
  }

  Future<void> _remember(Map<String, dynamic> done) async {
    final j = await store!.meta('scan.done');
    final l = j == null ? <dynamic>[] : jsonDecode(j) as List;
    l.insert(0, done);
    await store!.setMeta('scan.done', jsonEncode(l.take(40).toList()));
  }

  /// Offline sales that have reached the books and still await their real invoice link being sent.
  Future<List<Map<String, dynamic>>> syncedToSend() async {
    final j = await store?.meta('scan.done');
    if (j == null) return [];
    return (jsonDecode(j) as List).map((e) => Map<String, dynamic>.from(e as Map)).where((x) => x['id'] != null && '${x['phone'] ?? ''}'.isNotEmpty && x['sent'] != true).toList();
  }

  Future<void> markSent(String ref) async {
    final j = await store!.meta('scan.done');
    if (j == null) return;
    final l = (jsonDecode(j) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    for (final x in l) {
      if (x['ref'] == ref) x['sent'] = true;
    }
    await store!.setMeta('scan.done', jsonEncode(l));
    notifyListeners();
  }

  // ---- links ----
  Future<String> shareLink(String docId) async {
    final o = await api.rpc('acc_share_document', {'p_doc': docId, 'p_enable': true});
    return '$origin/bill.html?t=${(o as Map)['token']}';
  }

  Future<void> saveLangPref(String code) => Lang.set(code);

  Future<void> signOut({String? message}) async {
    _timer?.cancel();
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
    await p.remove('user');
    api.token = null;
    store = null;
    user = null;
    dash = {};
    ctx = {};
    products = [];
    baseProducts = [];
    parties = [];
    queue = [];
    notice = message;
    notifyListeners();
  }
}
