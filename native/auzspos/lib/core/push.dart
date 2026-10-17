import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'api.dart';

/// Closed-app alerts: registers this phone's Firebase token with the business so the server can wake it for a new QR order.
/// Does nothing (and never throws) when the build has no Firebase file, so the app works exactly as before until one is added.
class PushRegistration {
  static bool _listening = false;

  /// Set by the signed-in Home screen (initState/dispose) -- lets a push that arrives while the app is
  /// OPEN trigger an immediate refresh of the existing guest-order poll, instead of waiting up to 10 s
  /// for its own timer. Null when nothing is signed in/mounted, in which case a foreground message is a
  /// safe no-op (there is nothing useful to refresh). Deliberately a hook into the EXISTING poll, not a
  /// second, independent place that rings an alert -- see the doc comment on register()'s own onMessage
  /// listener below for why.
  static Future<void> Function()? onForegroundMessage;

  static Future<bool> register(ApiClient api, String userId) async {
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      final m = FirebaseMessaging.instance;
      // Audit finding: this used to also call `await m.requestPermission();` here, unconditionally, on
      // every login AND every app launch that restores a saved session (Session._open(), called from
      // both signIn() and restore()) -- a second notification-permission prompt, shown with no context
      // before the user has even reached the app's main screen, racing the existing, correctly-timed
      // prompt in core/alerts.dart (shown only when a real alert is about to ring). Android's
      // POST_NOTIFICATIONS dialog is one-shot per install: whichever prompt the user sees FIRST decides
      // the answer for both, permanently, until they visit system settings by hand. A cashier reflexively
      // dismissing this early, unexplained prompt would have silently disabled BOTH Firebase push AND the
      // pre-existing, Firebase-independent local alert sound/notification -- they share the same OS
      // permission. Removed: getToken() below does not need the permission granted to succeed (it only
      // affects whether a later notification can actually be shown, not whether registration works), so
      // removing this request does not weaken registration -- it only removes the duplicate, badly-timed
      // prompt. alerts.dart's own prompt remains the one and only place this is ever asked.
      final token = await m.getToken();
      if (token == null) return false;
      await _save(api, userId, token);
      if (!_listening) {
        _listening = true;
        m.onTokenRefresh.listen((t) => _save(api, userId, t));
        // Foreground gap: Android's FCM layer only auto-displays a system notification while the app is
        // backgrounded or closed -- a message arriving while the app is OPEN is handed to the app via
        // onMessage with NO default UI at all, and nothing in this app listened for it, so a push that
        // arrived while someone was actively using the till produced nothing visible whatsoever. Routing
        // it into the EXISTING guest-order poll (via onForegroundMessage) instead of ringing an alert
        // directly here avoids a double-beep: the poll already fetches the real guest_orders rows and
        // only ever rings for ones it has not already shown (home.dart's loadGuests(), de-duplicated by
        // id) -- this just asks it to check NOW instead of waiting up to 10 s, it never rings on its own.
        FirebaseMessaging.onMessage.listen((_) => onForegroundMessage?.call());
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
