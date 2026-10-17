import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Loud new-order alert: a real beep sound (not the silent system click), vibration and a notification.
/// Works while the app is open or in the background with the phone awake. With the app fully closed,
/// Firebase push can also wake the phone once a server event is configured to send one (core/push.dart).
///
/// Notification-permission audit finding: the ONLY place in this app that ever asks Android for the
/// POST_NOTIFICATIONS runtime permission is [init] below, triggered the first time a real alert needs
/// to ring -- a deliberate, well-timed design (the user sees the prompt right when it's obvious why:
/// "New QR order" is about to need it). core/push.dart used to ALSO call
/// FirebaseMessaging.instance.requestPermission() unconditionally on every login/app launch -- a SECOND,
/// out-of-context prompt with no explanation, shown before the user has even reached the main screen.
/// Android's notification-permission dialog is a ONE-SHOT prompt per app install: once the user answers
/// (in particular, denies) it, neither plugin can ever show it again without the user manually visiting
/// system settings. A cashier reflexively dismissing that early, unexplained prompt would permanently
/// silence BOTH the local alert below AND any Firebase push -- they share the exact same OS permission
/// regardless of which plugin asked for it. Fixed by removing that second request entirely (push.dart);
/// this file's own, already-correct, already-contextual prompt is now the one and only place it happens.
class Alerts {
  static final _player = AudioPlayer();
  static final _notes = FlutterLocalNotificationsPlugin();
  static bool _ready = false;
  static bool _channelReady = false;

  static Future<bool> enabled() async => (await SharedPreferences.getInstance()).getBool('alertSound') ?? true;

  /// Creates (or re-asserts) the "orders" notification channel only -- no permission prompt, so this is
  /// safe to call as early as app launch, before the user has signed in or seen anything. Deliberately
  /// separated from [init]'s permission request: Android lets an app LOWER a channel's importance/sound
  /// later but never RAISE it back up once the channel exists -- if Firebase's own native FCM layer were
  /// ever the first to create a channel named "orders" (e.g. a background push arriving before this app
  /// had ever rung a local alert), it would create it with plain default settings, and this file's own
  /// later attempt to upgrade it to max importance + sound + vibration would be silently ignored by the
  /// OS forever. Calling this once, early, at app startup (main.dart) guarantees this app's own settings
  /// win the race, whether or not Firebase ever gets a chance to create the channel first.
  static Future<void> ensureChannel() async {
    if (_channelReady) return;
    try {
      await _notes.initialize(settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));
      final a = _notes.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await a?.createNotificationChannel(const AndroidNotificationChannel('orders', 'New orders', description: 'New QR orders and waiter calls', importance: Importance.max, playSound: true, enableVibration: true));
      _channelReady = true;
    } catch (_) {}
  }

  static Future<void> init() async {
    if (_ready) return;
    try {
      await ensureChannel();
      await [Permission.notification].request();
      await _player.setAudioContext(AudioContextConfig(route: AudioContextConfigRoute.speaker, focus: AudioContextConfigFocus.gain).build());
      await _player.setReleaseMode(ReleaseMode.stop);
      await _player.setVolume(1);
      _ready = true;
    } catch (_) {}
  }

  /// Rings once: sound, vibration, and (optionally) a notification in the shade.
  static Future<void> ring({String? title, String? body}) async {
    await init();
    try {
      HapticFeedback.heavyImpact();
      await _player.stop();
      await _player.play(AssetSource('alert.wav'), volume: 1);
    } catch (_) {}
    if (title != null) {
      try {
        await _notes.show(
          id: DateTime.now().millisecondsSinceEpoch % 100000,
          title: title,
          body: body,
          notificationDetails: const NotificationDetails(android: AndroidNotificationDetails('orders', 'New orders', importance: Importance.max, priority: Priority.high, playSound: true, enableVibration: true, category: AndroidNotificationCategory.message)),
        );
      } catch (_) {}
    }
  }
}
