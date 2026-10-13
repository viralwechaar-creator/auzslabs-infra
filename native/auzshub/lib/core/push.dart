import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'api.dart';

/// Closed-app alerts. A business user registers in fcm_tokens (like the other AUZslab apps); the AUZslab admin and team
/// register through register_platform_push, so new client requests, team work and notices reach them.
/// Does nothing (and never throws) when the build has no Firebase file.
class PushRegistration {
  static bool _listening = false;

  static Future<bool> register(ApiClient api, String userId, {required bool platform, required bool business}) async {
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      final m = FirebaseMessaging.instance;
      await m.requestPermission();
      final token = await m.getToken();
      if (token == null) return false;
      await _save(api, userId, token, platform, business);
      if (!_listening) {
        _listening = true;
        m.onTokenRefresh.listen((t) => _save(api, userId, t, platform, business));
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> _save(ApiClient api, String userId, String token, bool platform, bool business) async {
    try {
      if (platform) await api.rpc('register_platform_push', {'p_token': token});
      if (business) await api.insert('fcm_tokens', {'user_id': userId, 'token': token, 'platform': 'android'});
    } on ApiError catch (_) {
      // the token is already saved (unique), which is fine
    }
  }
}
