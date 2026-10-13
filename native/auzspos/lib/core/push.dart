import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'api.dart';

/// Closed-app alerts: registers this phone's Firebase token with the business so the server can wake it for a new QR order.
/// Does nothing (and never throws) when the build has no Firebase file, so the app works exactly as before until one is added.
class PushRegistration {
  static bool _listening = false;

  static Future<bool> register(ApiClient api, String userId) async {
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      final m = FirebaseMessaging.instance;
      await m.requestPermission();
      final token = await m.getToken();
      if (token == null) return false;
      await _save(api, userId, token);
      if (!_listening) {
        _listening = true;
        m.onTokenRefresh.listen((t) => _save(api, userId, t));
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> _save(ApiClient api, String userId, String token) async {
    try {
      await api.insert('fcm_tokens', {'user_id': userId, 'token': token, 'platform': 'android'});
    } on ApiError catch (_) {
      // the token is already saved (unique), which is fine
    }
  }
}
