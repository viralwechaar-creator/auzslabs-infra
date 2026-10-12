import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';
import 'store.dart';

/// Signed-in state for AUZsPay. Payroll is server-authoritative (pay_* functions), with ONE offline exception, like the
/// website: a clock-in taken with no connection is kept on the phone with the real time and sent later (pay_me_punch_offline).
class PaySession extends ChangeNotifier {
  final api = ApiClient();
  LocalStore? store;
  Map<String, dynamic>? user;
  Map<String, dynamic> dash = {}, ctx = {}, me = {};
  bool meOffline = false, syncing = false;
  /// Clock-ins waiting for a connection: {op, at, lat?, lng?, accuracy?}.
  List<Map<String, dynamic>> punchq = [];
  final refused = ValueNotifier<String?>(null);

  bool get signedIn => user != null && store != null;
  String get role => '${user?['role'] ?? dash['my_role'] ?? ''}';
  Map<String, dynamic> get perms => ctx['perms'] is Map ? Map<String, dynamic>.from(ctx['perms'] as Map) : const {};
  bool can(String k) => perms[k] == true;
  /// HR side (people, approvals, payroll runs): the website shows it when pay_bootstrap says `hr`.
  bool get hr => ctx['hr'] == true;
  bool get isManager => me['is_manager'] == true;
  Map<String, dynamic> get org => me['org'] is Map ? Map<String, dynamic>.from(me['org'] as Map) : (ctx['org'] is Map ? Map<String, dynamic>.from(ctx['org'] as Map) : const {});
  Map<String, dynamic> get employee => me['employee'] is Map ? Map<String, dynamic>.from(me['employee'] as Map) : const {};
  bool get hasEmployee => employee.isNotEmpty;
  bool get active => ['active', 'notice'].contains('${employee['status']}');
  String get orgName => '${org['name'] ?? ''}'.isNotEmpty ? '${org['name']}' : '${(dash['tenant'] as Map?)?['name'] ?? ''}';
  String get slug => '${(dash['tenant'] as Map?)?['slug'] ?? ''}';

  /// Entitled to AUZsPay (feature `payroll`) and not switched off by the owner. Unknown counts as allowed.
  bool get allowed => featureOn('payroll');
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
    final q = await s.meta('punchq');
    punchq = q == null ? [] : (jsonDecode(q) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
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
        ctx = Map<String, dynamic>.from(await api.rpc('pay_bootstrap') as Map);
        await s.setMeta('ctx', jsonEncode(ctx));
      } on ApiError catch (e) {
        if (e.status == 401) return;
        final c = await s.meta('ctx');
        if (c != null) ctx = Map<String, dynamic>.from(jsonDecode(c) as Map);
      }
      await loadMe();
      unawaited(flushPunches());
    }
    notifyListeners();
  }

  /// "My day" (pay_me). With no answer at all the last saved copy is shown so a clock-in can still be taken.
  Future<void> loadMe() async {
    try {
      me = Map<String, dynamic>.from(await api.rpc('pay_me') as Map);
      meOffline = false;
      await store?.setMeta('me', jsonEncode(me));
    } on ApiError catch (e) {
      if (e.status == 401) return;
      final c = await store?.meta('me');
      if (c != null && (e.status == null || e.isTransient)) {
        me = Map<String, dynamic>.from(jsonDecode(c) as Map);
        meOffline = true;
      } else if (e.status != null && !e.isTransient) {
        me = {};
      }
    }
    notifyListeners();
  }

  /// The punch card as it should look now: the saved state plus the clock-ins waiting on this phone.
  Map<String, dynamic> get punch {
    final p = Map<String, dynamic>.from(me['punch'] is Map ? me['punch'] as Map : const {});
    if (punchq.isNotEmpty) {
      final odd = punchq.length.isOdd;
      p['open'] = odd ? p['open'] != true : p['open'] == true;
      p['last'] = punchq.last['at'];
      if (odd && p['open'] == true) p['in'] = punchq.last['at'];
    }
    return p;
  }

  // ---- clock in / out ----
  String newOp() {
    final r = Random.secure();
    return '${DateTime.now().microsecondsSinceEpoch}-${List.generate(6, (_) => r.nextInt(36).toRadixString(36)).join()}';
  }

  Future<void> _saveQ() async => store?.setMeta('punchq', jsonEncode(punchq));

  /// Takes the clock-in. Returns a message for the person. No answer at all keeps it on the phone with the real time.
  Future<String> punchNow({double? lat, double? lng, double? accuracy}) async {
    final place = {if (lat != null) 'lat': lat, if (lng != null) 'lng': lng, if (accuracy != null) 'accuracy': accuracy.round()};
    Future<String> keep() async {
      punchq.add({'op': newOp(), 'at': DateTime.now().toUtc().toIso8601String(), ...place});
      await _saveQ();
      notifyListeners();
      return 'offline';
    }

    if (punchq.isNotEmpty) {
      // never jump the queue: an earlier offline punch must be sent first
      await flushPunches();
      if (punchq.isNotEmpty) return keep();
    }
    try {
      final r = await api.rpc('pay_me_punch', {'p': place});
      final m = r is Map ? r : const {};
      await loadMe();
      if (m['duplicate'] == true) return 'duplicate';
      return m['open'] == true ? (m['out_of_range'] == true ? 'in-away' : 'in') : (m['out_of_range'] == true ? 'out-away' : 'out');
    } on ApiError catch (e) {
      if (e.status == null || e.networkError) return keep();
      rethrow;
    }
  }

  /// Sends the saved clock-ins in order. Keeps them on any temporary failure; a real refusal removes it and tells the person.
  Future<void> flushPunches() async {
    if (syncing || punchq.isEmpty || store == null) return;
    syncing = true;
    notifyListeners();
    try {
      for (final it in List.of(punchq)) {
        try {
          await api.rpc('pay_me_punch_offline', {'p': it});
          punchq.removeWhere((x) => x['op'] == it['op']);
          await _saveQ();
        } on ApiError catch (e) {
          if (e.status == null || e.networkError || e.status! >= 500 || e.status == 401 || e.status == 408 || e.status == 429) break;
          punchq.removeWhere((x) => x['op'] == it['op']);
          await _saveQ();
          refused.value = e.message;
        }
      }
      if (punchq.isEmpty) await loadMe();
    } finally {
      syncing = false;
      notifyListeners();
    }
  }

  Future<void> signOut({String? message}) async {
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
    await p.remove('user');
    api.token = null;
    store = null;
    user = null;
    dash = {};
    ctx = {};
    me = {};
    punchq = [];
    notice = message;
    notifyListeners();
  }

  String? notice;
}
