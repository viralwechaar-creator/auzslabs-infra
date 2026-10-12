import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Loud new-order alert: a real beep sound (not the silent system click), vibration and a notification.
/// Works while the app is open or in the background with the phone awake. With the app fully closed, only
/// push alerts (Firebase) can wake the phone; that needs the owner's Firebase file and is not set up yet.
class Alerts {
  static final _player = AudioPlayer();
  static final _notes = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static Future<bool> enabled() async => (await SharedPreferences.getInstance()).getBool('alertSound') ?? true;

  static Future<void> init() async {
    if (_ready) return;
    try {
      await _notes.initialize(settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));
      final a = _notes.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await a?.createNotificationChannel(const AndroidNotificationChannel('orders', 'New orders', description: 'New QR orders and waiter calls', importance: Importance.max, playSound: true, enableVibration: true));
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
