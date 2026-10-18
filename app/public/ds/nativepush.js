/* Native push for the Android app (Firebase Cloud Messaging, db/119/server/src/fcm.js). Web Push (the POS's
   existing push_subs/VAPID flow, pos/staff.js) never works inside a bare Capacitor WebView -- the browser
   there never registers a push service -- so this is the real mechanism once the app is packaged.
   window.auzNativePush.isNative() tells a caller whether to even offer "enable push" through this path.
   window.auzNativePush.enable(sb, userId) requests permission, registers with FCM and saves the device's
   token (sb.from('fcm_tokens').upsert, same table shape as push_subs) -- returns a promise resolving to
   {ok, message}. A no-op, resolving {ok:false, message:'...'}, outside the native app (the web/PWA build
   keeps using Web Push instead). */
(function () {
  function cap() { return window.Capacitor; }
  function plugin() { var c = cap(); return c && c.Plugins && c.Plugins.PushNotifications; }
  function isNative() { var c = cap(); return !!(c && c.isNativePlatform && c.isNativePlatform()); }
  /* mobile/build.mjs bakes this in at build time: true only when this exact app's package id was found in the
     Firebase project (GOOGLE_SERVICES_JSON), i.e. google-services.json actually shipped in the APK. The
     push-notifications plugin's native code is bundled into every wrapper app regardless -- calling into it
     (requestPermissions/register) when Firebase was never configured throws an uncaught native exception
     ("Default FirebaseApp is not initialized") that crashes the whole app, not just a rejected JS promise, so
     this must be checked BEFORE touching the plugin at all, not inside a try/catch. See docs/AUZSPOS_LAUNCH_CHECKLIST.md. */
  function pushConfigured() { var c = cap(); var cfg = c && c.getConfig ? c.getConfig() : null; return !!(cfg && cfg.auzPushReady); }

  function enable(sb, userId) {
    var Push = plugin();
    if (!isNative() || !Push || !pushConfigured()) return Promise.resolve({ ok: false, message: 'Native push is only available inside the installed app.' });
    return Push.requestPermissions().then(function (perm) {
      if (perm.receive !== 'granted') return { ok: false, message: 'Allow notifications for this app in your phone settings.' };
      return new Promise(function (resolve) {
        var done = false;
        var offReg = Push.addListener('registration', function (token) {
          if (done) return; done = true; try { offReg.remove(); } catch (e) {} try { offErr.remove(); } catch (e) {}
          sb.from('fcm_tokens').upsert({ user_id: userId, token: token.value, platform: 'android' }, { onConflict: 'token' })
            .then(function (r) {
              resolve(r.error ? { ok: false, message: 'Could not save this device: ' + r.error.message } : { ok: true, message: 'Order alerts are on for this device' });
            });
        });
        var offErr = Push.addListener('registrationError', function (err) {
          if (done) return; done = true; try { offReg.remove(); } catch (e) {} try { offErr.remove(); } catch (e) {}
          resolve({ ok: false, message: 'Could not register this device for notifications.' });
        });
        Push.register().catch(function () {
          if (done) return; done = true; try { offReg.remove(); } catch (e) {} try { offErr.remove(); } catch (e) {}
          resolve({ ok: false, message: 'Could not register this device for notifications.' });
        });
      });
    }).catch(function () { return { ok: false, message: 'Could not request notification permission.' }; });
  }

  /* AUZslab admin and team members belong to no business, so their phones are saved through register_platform_push
     (db/182) instead of the per-business fcm_tokens table. Resolves {ok, message}; silent no-op outside the app. */
  function enablePlatform(sb) {
    var Push = plugin();
    if (!isNative() || !Push || !pushConfigured()) return Promise.resolve({ ok: false, message: 'Alerts are only available inside the installed app.' });
    return Push.requestPermissions().then(function (perm) {
      if (perm.receive !== 'granted') return { ok: false, message: 'Allow notifications for this app in your phone settings.' };
      return new Promise(function (resolve) {
        var done = false, offReg, offErr;
        function finish(r) { if (done) return; done = true; try { offReg.remove(); } catch (e) {} try { offErr.remove(); } catch (e) {} resolve(r); }
        offReg = Push.addListener('registration', function (token) {
          sb.rpc('register_platform_push', { p_token: token.value }).then(function (r) {
            finish(r.error ? { ok: false, message: r.error.message } : { ok: true, message: 'Alerts are on for this device' });
          });
        });
        offErr = Push.addListener('registrationError', function () { finish({ ok: false, message: 'Could not register this device for notifications.' }); });
        Push.register().catch(function () { finish({ ok: false, message: 'Could not register this device for notifications.' }); });
      });
    }).catch(function () { return { ok: false, message: 'Could not request notification permission.' }; });
  }

  /* Browser alerts (Web Push) for the AUZslab admin and team, saved with register_platform_web_push (db/183). Needs the
     public key that matches the server's VAPID_PRIVATE (same value as VAPID_PUBLIC in pos/core.js: change both together).
     webState() -> 'native' | 'unsupported' | 'ios-install' (iPhone browser tab: Add to Home Screen first) | 'blocked' | 'ask' | 'on'.
     enablePlatformWeb(sb, ask) -> {ok, message}; with ask=false it only re-saves an already allowed subscription (no popup). */
  var VAPID_PUBLIC = 'BD-oWPPzj7gzvYCrQiNAowSxyIZWfoRNO3A7tGqs3km352VZuNhzl8sZvnri5IilWEeAE1AYzWrfiZJS_rmhp_c';
  function keyBytes(b64) { var p = '='.repeat((4 - b64.length % 4) % 4), s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function webState() {
    if (isNative()) return 'native';
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (ios && !standalone) return 'ios-install';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return Notification.permission === 'granted' ? 'on' : 'ask';
  }
  function enablePlatformWeb(sb, ask) {
    var st = webState();
    if (st === 'native' || st === 'unsupported' || st === 'ios-install') return Promise.resolve({ ok: false, message: st === 'ios-install' ? 'On an iPhone, tap Share, then Add to Home Screen, open the app from there and try again.' : 'This browser cannot show alerts.' });
    if (st === 'blocked') return Promise.resolve({ ok: false, message: 'Alerts are blocked. Allow notifications for this site in the browser settings.' });
    if (st === 'ask' && ask === false) return Promise.resolve({ ok: false, message: '' });
    var perm = st === 'on' ? Promise.resolve('granted') : Notification.requestPermission();
    return perm.then(function (p) {
      if (p !== 'granted') return { ok: false, message: 'Alerts are off. Allow notifications to turn them on.' };
      return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) }); });
      }).then(function (sub) {
        var j = sub.toJSON();
        return sb.rpc('register_platform_web_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
      }).then(function (r) { return r.error ? { ok: false, message: r.error.message } : { ok: true, message: 'Alerts are on for this device' }; });
    }).catch(function () { return { ok: false, message: 'Could not turn on alerts on this device.' }; });
  }

  window.auzNativePush = { isNative: isNative, enable: enable, enablePlatform: enablePlatform, webState: webState, enablePlatformWeb: enablePlatformWeb };
})();
