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

  function enable(sb, userId) {
    var Push = plugin();
    if (!isNative() || !Push) return Promise.resolve({ ok: false, message: 'Native push is only available inside the installed app.' });
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

  window.auzNativePush = { isNative: isNative, enable: enable };
})();
