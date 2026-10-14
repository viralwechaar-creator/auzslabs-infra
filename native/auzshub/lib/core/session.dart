import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';
import 'push.dart';

/// What kind of person is signed in. Decided by the server in one call (hub_me), exactly like the website hub.
enum Kind { admin, team, business, customer }

/// Signed-in state of the AUZslab hub app: who you are, which business you belong to and which apps it owns.
class HubSession extends ChangeNotifier {
  HubSession({ApiClient? api}) : api = api ?? ApiClient();
  final ApiClient api;
  Map<String, dynamic>? user;
  Map<String, dynamic> hub = {}, dash = {};
  String? notice;
  bool loading = false;

  bool get signedIn => user != null;
  String get email => '${hub['email'] ?? dash['my_email'] ?? user?['email'] ?? ''}';
  bool get isAdmin => hub['admin'] == true;
  bool get isTeam => hub['team'] != null && hub['team'] != false;
  bool get hasBusiness => hub['business'] == true;
  String get role => '${dash['my_role'] ?? user?['role'] ?? ''}';
  bool get isOwner => role == 'owner';
  bool get isManager => role == 'manager';
  Map<String, dynamic> get tenant => dash['tenant'] is Map ? Map<String, dynamic>.from(dash['tenant'] as Map) : const {};
  String get slug => '${tenant['slug'] ?? ''}';
  String get businessName => '${tenant['name'] ?? ''}';
  String get niche => '${tenant['niche'] ?? ''}';
  Kind get kind => isAdmin ? Kind.admin : (isTeam && !hasBusiness ? Kind.team : (hasBusiness ? Kind.business : Kind.customer));

  /// Entitled and not switched off by the owner (same rule as the website's own()).
  bool own(String k) {
    final f = dash['features'], e = dash['enabled_features'];
    return f is Map && f[k] == true && !(e is Map && e[k] == false);
  }

  // ---- sign in ----
  Future<void> restore() async {
    final p = await SharedPreferences.getInstance();
    final t = p.getString('token'), u = p.getString('user');
    if (t == null || u == null) return;
    api.token = t;
    user = Map<String, dynamic>.from(jsonDecode(u) as Map);
    api.onSessionExpired = () => signOut(message: 'Your session ended. Please sign in again.');
    final c = p.getString('hubcache');
    if (c != null) {
      try {
        final m = jsonDecode(c) as Map;
        hub = Map<String, dynamic>.from(m['hub'] as Map);
        dash = Map<String, dynamic>.from(m['dash'] as Map);
      } catch (_) {}
    }
    unawaited(load());
  }

  Future<void> signIn(Map<String, dynamic> u) async {
    final p = await SharedPreferences.getInstance();
    await p.setString('token', api.token!);
    await p.setString('user', jsonEncode(u));
    user = {...u};
    notice = null;
    api.onSessionExpired = () => signOut(message: 'Your session ended. Please sign in again.');
    notifyListeners();
    await load();
  }

  /// Asks the server who this is, then (for a business) which apps it owns. With no answer the last saved copy is kept.
  Future<void> load() async {
    if (user == null) return;
    loading = true;
    notifyListeners();
    try {
      try {
        final h = await api.rpc('hub_me');
        hub = h is Map ? Map<String, dynamic>.from(h) : {};
      } on ApiError catch (e) {
        if (e.status == 401) return;
        if (!e.isTransient) hub = {};
      }
      if (hub['business'] == true) {
        try {
          dash = Map<String, dynamic>.from(await api.rpc('my_dashboard') as Map);
        } on ApiError catch (e) {
          if (e.status == 401) return;
        }
      } else {
        dash = {};
      }
      final p = await SharedPreferences.getInstance();
      await p.setString('hubcache', jsonEncode({'hub': hub, 'dash': dash}));
      unawaited(PushRegistration.register(api, '${user!['id']}', platform: isAdmin || isTeam, business: hasBusiness));
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// The signed-in session in the form the website and the other AUZslab apps take it ("#auz_gt=" hand-off).
  String handoff() {
    final j = jsonEncode({'t': api.token, 'u': user});
    return base64Url.encode(utf8.encode(j)).replaceAll('=', '');
  }

  Future<void> signOut({String? message}) async {
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
    await p.remove('user');
    await p.remove('hubcache');
    api.token = null;
    user = null;
    hub = {};
    dash = {};
    notice = message;
    notifyListeners();
  }
}
