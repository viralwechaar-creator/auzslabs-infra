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
  b.Totals tot(Map<String, dynamic> o) {
    final d = DateTime.now();
    final today = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    return b.tot(o, cfg, taxes: taxes, items: items, offerRecords: repo?.of('offer').toList() ?? const [], today: today);
  }

  /// Why an item cannot be sold right now ('' = it can). Port of itemOffWhy() in the website POS.
  String itemOffWhy(Map<String, dynamic> i, String type) {
    if (i['off'] == true) {
      final u = DateTime.tryParse('${i['offUntil'] ?? ''}');
      if (u == null || u.isAfter(DateTime.now())) return 'Sold out';
    }
    final key = const {'Dine-in': 'dine', 'Takeaway': 'take', 'Delivery': 'deliv'}[type];
    if (key != null && i['chOff'] is Map && (i['chOff'] as Map)[key] == true) return 'Hidden from $type';
    final rec = '${i['rec'] ?? ''}';
    if (rec.isEmpty) return '';
    final ings = repo?.of('ing').toList() ?? const <Map<String, dynamic>>[];
    for (final part in rec.split(',')) {
      final n = part.split(':').first.trim().toLowerCase();
      if (n.isEmpty) continue;
      for (final g in ings) {
        if ('${g['name']}'.toLowerCase() == n && ((g['qty'] ?? 0) as num) <= 0) return 'No ${g['name']} in stock';
      }
    }
    return '';
  }

  String role = 'cashier';
  bool hasBusiness = true;
  Map<String, dynamic>? features, enabledFeatures;
  bool featureOn(String k) => features == null || (features![k] == true && (enabledFeatures?[k]) != false);
  String slug = 'app';
  Map<String, dynamic>? perms;
  static const _defaultPerms = {'pos': true, 'orders': true, 'kitchen': true, 'reports': true, 'staff': true, 'inventory': true, 'crm': true, 'menu': false, 'settings': false, 'billing': false};

  /// 'm' = may approve money actions (owner, manager, or a role with billing); 'o' = owner only; else a permission key.
  bool can(String x) {
    if (role == 'owner') return true;
    if (x == 'o') return false;
    final p = perms ?? (role == 'manager' ? {..._defaultPerms, 'billing': true} : _defaultPerms);
    return (x == 'm' ? p['billing'] : p[x]) == true;
  }

  Future<void> _loadRole() async {
    try {
      final r = await api.one('profiles', 'id', '${user!['id']}', select: 'role,role_id');
      hasBusiness = r != null;
      role = '${r?['role'] ?? 'cashier'}';
      perms = null;
      if (r?['role_id'] != null) {
        final rr = await api.one('roles', 'id', '${r!['role_id']}', select: 'permissions');
        if (rr?['permissions'] is Map) perms = Map<String, dynamic>.from(rr!['permissions'] as Map);
      }
      try {
        final d = await api.rpc('my_dashboard');
        final sl = (d is Map ? d['tenant'] : null);
        if (sl is Map && sl['slug'] != null) slug = '${sl['slug']}';
        if (d is Map) {
          final ts = d['tenant_settings'] ?? d['settings'] ?? d;
          if (ts is Map && ts['features'] is Map) features = Map<String, dynamic>.from(ts['features'] as Map);
          if (ts is Map && ts['enabled_features'] is Map) enabledFeatures = Map<String, dynamic>.from(ts['enabled_features'] as Map);
        }
      } catch (_) {}
      final p = await SharedPreferences.getInstance();
      await p.setString('role.${user!['id']}', role);
      await p.setString('slug.${user!['id']}', slug);
    } catch (_) {
      final p = await SharedPreferences.getInstance();
      role = p.getString('role.${user!['id']}') ?? 'cashier';
      slug = p.getString('slug.${user!['id']}') ?? 'app';
    }
  }

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
    await _loadRole();
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
