import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../ui/i18n.dart';
import 'api.dart';
import 'calc.dart';
import 'push.dart';
import 'repo.dart';
import 'store.dart';

const kFeatDefaults = {'sell': true, 'purchase': true, 'repairs': 'full', 'stock': true, 'serials': true, 'customers': true, 'vendors': true, 'dayclose': true};

/// Signed-in state for AUZsMob. Each login gets its own database file, so one shop's data never shows up in another's.
class MobSession extends ChangeNotifier {
  final api = ApiClient();
  MobRepo? repo;
  Map<String, dynamic>? user; // {id, email, role}
  Map<String, dynamic> dash = {}, ctx = {};
  String? notice;
  Timer? _timer;
  bool booting = false;
  /// Shown as a toast by the shell when the server refuses a queued entry.
  final refused = ValueNotifier<String?>(null);

  bool get signedIn => user != null && repo != null;
  String get role => '${user?['role'] ?? dash['my_role'] ?? 'cashier'}';
  bool get isOwner => role == 'owner';
  String get slug => '${(dash['tenant'] as Map?)?['slug'] ?? ''}';
  String get shopName => '${(dash['tenant'] as Map?)?['name'] ?? ''}';
  /// The business address pages (shared bill links) live on.
  String get origin => slug.isEmpty ? 'https://app.auzslab.in' : 'https://$slug.auzslab.in';
  Map<String, dynamic> get perms => ctx['perms'] is Map ? Map<String, dynamic>.from(ctx['perms'] as Map) : const {};
  bool can(String k) => perms[k] == true;
  bool get canSeeRates => ctx['can_see_rates'] == true;
  Map<String, dynamic> get settings => ctx['settings'] is Map ? Map<String, dynamic>.from(ctx['settings'] as Map) : const {};
  Map<String, dynamic> get features => {...kFeatDefaults, ...(settings['features'] is Map ? Map<String, dynamic>.from(settings['features'] as Map) : const {})};
  bool feat(String k) => features[k] != false && features[k] != 'off';
  String get repairsMode {
    final r = features['repairs'];
    return r == 'off' || r == 'simple' ? '$r' : (r == false ? 'off' : 'full');
  }
  double get sharePct {
    final x = n(features['profitSharePct']);
    return x > 0 && x <= 100 ? x : 0;
  }
  Split split(num profit) => splitProfit(profit, sharePct);

  /// False when the business has not bought AUZsMob (or the owner switched it off). Unknown (offline, nothing cached) = allowed.
  bool get mobAllowed {
    final f = dash['features'];
    if (f is! Map) return true;
    final e = dash['enabled_features'];
    return f['mobile'] == true && !(e is Map && e['mobile'] == false);
  }
  bool featureOn(String k) {
    final f = dash['features'];
    final e = dash['enabled_features'];
    return f is! Map || (f[k] == true && !(e is Map && e[k] == false));
  }

  // ---- menu ----
  bool pageAllowed(String id) => switch (id) {
        'home' || 'stock' || 'settings' => can('mob_view'),
        'sell' || 'dues' => can('mob_sell'),
        'purchase' => can('mob_purchase'),
        'repairs' => can('mob_repair'),
        'reports' => can('mob_reports'),
        'myreport' => can('mob_sell') && !can('mob_reports'),
        _ => false,
      };
  /// Every section this person may open, in the automatic order.
  List<String> get allNav {
    final l = <String>['home'];
    if (feat('sell')) l.add('sell');
    if (repairsMode == 'full') l.add('repairs');
    if (feat('stock') || can('mob_manage')) l.add('stock');
    if (can('mob_reports')) l.add('reports');
    if (can('mob_sell') && !can('mob_reports')) l.add('myreport');
    if (feat('customers') || feat('vendors')) l.add('dues');
    l.add('settings');
    return l.where(pageAllowed).toList();
  }
  List<String>? get customNav {
    final nv = features['nav'];
    return nv is List && nv.isNotEmpty ? nv.map((e) => '$e').toList() : null;
  }
  bool get showMore {
    final c = customNav;
    return c == null || c.contains('more');
  }
  List<String> get navList {
    final all = allNav, c = customNav;
    if (c == null) return all;
    final picked = <String>[for (final id in c) if (all.contains(id)) id];
    if (all.contains('myreport') && !picked.contains('myreport')) picked.add('myreport');
    if (!picked.contains('settings') && !c.contains('more') && all.contains('settings')) picked.add('settings');
    return picked.isEmpty ? all : picked;
  }
  /// What the bottom bar shows (the rest go under More).
  List<String> get tabs => customNav != null ? navList : navList.take(4).toList();
  List<String> get moreList {
    final shown = tabs;
    final src = customNav != null ? allNav.where((id) => id == 'settings') : navList;
    return src.where((id) => !shown.contains(id)).toList();
  }

  // ---- sign in / restore ----
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
    await openWith(u, store);
  }

  /// Opens the app for [u] on [store] (a test passes a MemoryStore).
  Future<void> openWith(Map<String, dynamic> u, MobStore store) async {
    booting = true;
    final r = MobRepo(api, store);
    r.onRefused = (m) => refused.value = m;
    r.afterPull = _refreshContext;
    repo = r;
    user = {...u};
    unawaited(PushRegistration.register(api, '${u['id']}'));
    await r.load();
    // the shop's settings: from the server, else the last copy kept on the phone (so the app opens with no internet)
    try {
      dash = Map<String, dynamic>.from(await api.rpc('my_dashboard') as Map);
      await store.setMeta('dash', jsonEncode(dash));
    } on ApiError catch (e) {
      if (e.status == 401) return;
      final c = await store.meta('dash');
      if (c != null) dash = Map<String, dynamic>.from(jsonDecode(c) as Map);
    }
    user!['role'] = dash['my_role'] ?? user!['role'];
    user!['email'] = dash['my_email'] ?? user!['email'];
    if (mobAllowed) {
      try {
        ctx = Map<String, dynamic>.from(await api.rpc('mob_context') as Map);
        _ctxAt = DateTime.now();
        await store.setMeta('ctx', jsonEncode(ctx));
      } on ApiError catch (e) {
        if (e.status == 401) return;
        final c = await store.meta('ctx');
        if (c != null) ctx = Map<String, dynamic>.from(jsonDecode(c) as Map);
      }
      await _language();
      await _epoch(store, r);
    }
    booting = false;
    notifyListeners();
    unawaited(r.trySync());
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => r.trySync());
  }

  // Carry the language picked on the sign-in screen into the app until the person (or shop) has saved one for real.
  Future<void> _language() async {
    final set = ctx['my_language_set'] == true, saved = '${ctx['my_language'] ?? 'en'}';
    final local = Lang.code;
    if (!set && local != saved) {
      unawaited(api.rpc('mob_save_my_language', {'p_lang': local}).then((_) {}).catchError((_) {}));
    } else {
      await Lang.set(saved == 'hi' ? 'hi' : 'en');
    }
  }

  // After the owner clears all data, a phone that sees a newer "cleared at" time deletes its own offline copy.
  Future<void> _epoch(MobStore store, MobRepo r) async {
    try {
      final e = await api.rpc('mob_data_epoch');
      final ep = '${(e is Map ? e['epoch'] : '') ?? ''}';
      final seen = await store.meta('epoch');
      if (seen != null && seen != ep) await r.wipeLocal();
      await store.setMeta('epoch', ep);
    } catch (_) {}
  }

  DateTime _ctxAt = DateTime.fromMillisecondsSinceEpoch(0);
  // Pick up the owner's switch / rate changes at most every 5 minutes so other phones follow.
  Future<void> _refreshContext() async {
    if (DateTime.now().difference(_ctxAt) < const Duration(minutes: 5)) return;
    _ctxAt = DateTime.now();
    await reloadContext();
  }

  Future<void> reloadContext() async {
    try {
      ctx = Map<String, dynamic>.from(await api.rpc('mob_context') as Map);
      await repo?.store.setMeta('ctx', jsonEncode(ctx));
      notifyListeners();
    } catch (_) {}
  }

  Future<void> saveLang(String code) async {
    await Lang.set(code);
    try {
      await api.rpc('mob_save_my_language', {'p_lang': code});
    } catch (_) {}
  }

  List<Map<String, dynamic>>? _staff;
  Future<List<Map<String, dynamic>>> staffList({bool refresh = false}) async {
    if (_staff != null && !refresh) return _staff!;
    final d = await api.rpc('mob_staff_list');
    _staff = (d as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    return _staff!;
  }

  Future<void> signOut({String? message}) async {
    _timer?.cancel();
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
    await p.remove('user');
    api.token = null;
    repo = null;
    user = null;
    dash = {};
    ctx = {};
    _staff = null;
    notice = message;
    notifyListeners();
  }
}
