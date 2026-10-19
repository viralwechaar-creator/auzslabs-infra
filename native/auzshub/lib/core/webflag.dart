import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Home-page WebView pilot switch (see docs/HUB_WEBVIEW_PILOT.md).
///
/// OFF by default and never shipped on by itself. A developer turns it on for THIS PHONE ONLY
/// from the hidden "Developer options" section inside Settings (long-press the sign-in email on
/// the Home screen to reveal it) -- it is never shown to an ordinary signed-in person, and it is
/// not an app-wide remote flag: nothing on the server can turn it on or off.
///
/// Turning it off again (or clearing the app's storage, or reinstalling) always restores the
/// existing native Home page immediately -- this is the rollback.
class WebPilot {
  WebPilot._();
  /// true while the Home tab shows the real website instead of the native renderer.
  static final ValueNotifier<bool> homeEnabled = ValueNotifier(false);
  static const _key = 'dev.webHomePilot';

  static Future<void> load() async {
    try {
      homeEnabled.value = (await SharedPreferences.getInstance()).getBool(_key) ?? false;
    } catch (_) {
      // No storage available (e.g. a cold test run): stay OFF, the safe default.
    }
  }

  static Future<void> set(bool v) async {
    homeEnabled.value = v;
    try {
      await (await SharedPreferences.getInstance()).setBool(_key, v);
    } catch (_) {
      // Not persisted this run, but the in-memory switch above still reflects the choice.
    }
  }
}
