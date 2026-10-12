import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';
import 'billing.dart' as b;
import 'repo.dart';
import 'sqlite_store.dart';

/// Signed-in state. Each login gets its own database file, so one business's data can never show up in another's.
class Session extends ChangeNotifier {
  final api = ApiClient();
  Repo? repo;
  Map<String, dynamic>? user;
  String? notice;
  Timer? _timer;
  bool syncing = false;

  bool get signedIn => user != null && repo != null;
  Map<String, dynamic> get cfg => {
        'name': 'My Restaurant', 'prefix': 'INV', 'tax': 5, 'roundOff': true, 'serviceChargePct': 0, 'packingCharge': 0, 'deliveryCharge': 0,
        ...?(repo?.rec('settings'))
      };
  Map<String, Map<String, dynamic>> get taxes => {for (final t in repo?.of('tax') ?? const <Map<String, dynamic>>[]) '${t['id']}': t};
  Map<String, Map<String, dynamic>> get items => {for (final i in repo?.of('item') ?? const <Map<String, dynamic>>[]) '${i['id']}': i};
  b.Totals tot(Map<String, dynamic> o) => b.tot(o, cfg, taxes: taxes, items: items);

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
    final store = await SqliteStore.open('${u['id']}');
    repo = Repo(api, store, onChange: notifyListeners);
    user = u;
    await repo!.load();
    notifyListeners();
    unawaited(sync());
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 45), (_) => sync());
  }

  Future<void> sync() async {
    final r = repo;
    if (r == null || syncing) return;
    syncing = true;
    notifyListeners();
    final res = await r.sync();
    syncing = false;
    if (res.rejected.isNotEmpty) notice = 'Not saved: ${res.rejected.first}';
    if (res.authExpired) {
      await signOut(message: 'Your session ended. Please sign in again.');
      return;
    }
    notifyListeners();
  }

  Future<void> signOut({String? message}) async {
    _timer?.cancel();
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
    await p.remove('user');
    api.token = null;
    repo = null;
    user = null;
    notice = message;
    notifyListeners();
  }

  /// Next bill number from the server; offline it is a device number ending in "~" (replaced when the bill is paid online).
  Future<String> nextNo() async {
    try {
      final d = await api.rpc('next_invoice_no', {'prefix': '${cfg['prefix']}'});
      if (d != null) return '$d';
    } catch (_) {}
    final p = await SharedPreferences.getInstance();
    final n = (p.getInt('n') ?? 0) + 1;
    await p.setInt('n', n);
    return '${cfg['prefix']}-L${n.toString().padLeft(4, '0')}~';
  }

  Future<String> nextKot() async {
    final d = DateTime.now();
    final day = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    try {
      final r = await api.rpc('next_kot_no', {'p_day': day, 'p_outlet': 'main'});
      if (r != null) return '$r';
    } catch (_) {}
    final p = await SharedPreferences.getInstance();
    final n = (p.getInt('kot.$day') ?? 0) + 1;
    await p.setInt('kot.$day', n);
    return 'L$n';
  }
}
