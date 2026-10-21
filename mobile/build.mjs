// Usage: node build.mjs <app> ; generates www/, capacitor.config.json and the android/ project for one app.
import fs from 'fs'; import {execSync} from 'child_process';
const app = process.argv[2];
const A = app && JSON.parse(fs.readFileSync('apps.json','utf8'))[app];
if (!A) throw new Error('usage: node build.mjs <app>  (pos, mob, payroll, accounts or scan)');
fs.rmSync('www',{recursive:true,force:true}); fs.mkdirSync('www');
fs.writeFileSync('www/index.html', `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${A.name}</title><body style="margin:0;background:#171717;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><div><h1 style="font-size:22px">${A.name}</h1><p>You are offline. Connect to the internet and try again.</p><button onclick="location.href='${A.url}'" style="font:inherit;padding:12px 22px;border:0;border-radius:12px">Retry</button></div>`);
// Computed up front (not just for the google-services.json write further down) because it also needs to reach
// the live website's JS as a build-time fact, via Capacitor.getConfig()'s "plugins" field -- see the long
// comment near the google-services.json write below for why this matters: without it, ds/nativepush.js has no
// way to know push-notifications was bundled into THIS app's build without Firebase actually being configured
// for it, and calling into that plugin unconfigured crashes the whole app, not just rejects a promise.
const gsRaw = process.env.GOOGLE_SERVICES_JSON ? Buffer.from(process.env.GOOGLE_SERVICES_JSON,'base64').toString('utf8') : '';
const pushReady = !!gsRaw && (gsRaw.includes('"package_name": "'+A.id+'"') || gsRaw.includes('"package_name":"'+A.id+'"'));
fs.writeFileSync('capacitor.config.json', JSON.stringify({
  appId:A.id, appName:A.name, webDir:'www', backgroundColor:'#171717',
  // errorPath: without it, a failed load of the remote server.url (e.g. no internet) falls through to
  // the OS's own native "Web page not available / net::ERR_INTERNET_DISCONNECTED" error screen --
  // which shows the real app.auzslab.in URL and a generic browser-style page, visibly giving away that
  // this is a wrapped website rather than a native app. Capacitor's own BridgeWebViewClient already
  // redirects to this local bundled page automatically on any main-frame load error when it's set
  // (com.getcapacitor.Bridge#getErrorUrl / CapConfig#getErrorPath -- no custom native code needed), so
  // the owner's own branded www/index.html (written above) shows instead.
  server:{url:A.url, cleartext:false, allowNavigation:['auzslab.in','*.auzslab.in'], errorPath:'index.html'},
  android:{appendUserAgent:'AUZslabApp', allowMixedContent:false},
  auzPushReady:pushReady
},null,2));
fs.rmSync('android',{recursive:true,force:true});
execSync('npx cap add android',{stdio:'inherit'});
const png = '../app/public/'+A.icon;
if (fs.existsSync(png)) {
  for (const [d,s] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})) {
    // ic_launcher / ic_launcher_round: the flat, pre-API-26 icon -- full-bleed is correct here, nothing
    // masks it. ic_launcher_foreground: the layer Android's ADAPTIVE icon masks to a circle/squircle/
    // rounded-square depending on the launcher -- our source art fills its whole canvas edge to edge
    // with no margin, so the mask was cropping straight into the wordmark (reported from a real device:
    // "icon size is not fitting well"). Adaptive icons need real content kept inside a safe zone
    // (roughly the centre 66% of the canvas); shrink the art and pad with its own corner colour (sampled
    // from the source image, not assumed) so the margin matches instead of showing a seam.
    for (const n of ['ic_launcher', 'ic_launcher_round'])
      execSync(`python3 -c "from PIL import Image;Image.open('${png}').convert('RGBA').resize((${s},${s})).save('android/app/src/main/res/mipmap-${d}/${n}.png')"`);
    execSync(`python3 -c "
from PIL import Image
im = Image.open('${png}').convert('RGBA')
bg = im.getpixel((1, 1))
inner = im.resize((round(${s}*0.62), round(${s}*0.62)))
canvas = Image.new('RGBA', (${s}, ${s}), bg)
canvas.paste(inner, ((${s} - inner.width) // 2, (${s} - inner.height) // 2))
canvas.save('android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png')
"`);
  }
}
// Android's own cold-start splash (via the androidx core-splashscreen dependency `cap add android`
// already pulls in) defaults to a plain WHITE 480x320 drawable plus the app's own launcher icon
// auto-overlaid on top -- shown for however long the WebView takes to fetch and paint the real page.
// That is the "icon on a white screen for two seconds, then our own animation starts" the owner
// reported: two splash screens stacked back to back, not one. Fixed by making the OS splash the exact
// same ink colour every web splash (ds/launch.js / ds/launch-hub.js) opens on, with no icon overlay --
// the two then read as one continuous screen instead of a visible hand-off. `windowSplashScreenBackground`
// / `windowSplashScreenAnimatedIcon` are read by the compat library on every supported API level (not
// only real Android 12+), since `Theme.SplashScreen` here is the compat theme those attrs belong to.
const splashBg = [23, 23, 23]; // #171717, matches ds/launch.js and ds/launch-hub.js's background exactly
for (const dir of fs.readdirSync('android/app/src/main/res').filter((d) => /^drawable(-|$)/.test(d))) {
  const f = `android/app/src/main/res/${dir}/splash.png`;
  if (fs.existsSync(f)) {
    const im = fs.statSync(f) && execSync(`python3 -c "from PIL import Image;print(Image.open('${f}').size)"`).toString().trim();
    const [w, h] = im.replace(/[()]/g, '').split(',').map((n) => parseInt(n, 10));
    execSync(`python3 -c "from PIL import Image;Image.new('RGB',(${w},${h}),(${splashBg.join(',')})).save('${f}')"`);
  }
}
execSync(`python3 -c "from PIL import Image;Image.new('RGBA',(4,4),(0,0,0,0)).save('android/app/src/main/res/drawable/auz_splash_icon.png')"`);
fs.writeFileSync('android/app/src/main/res/values/colors.xml',
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="auz_splash_bg">#171717</color>\n</resources>\n');
let styles = fs.readFileSync('android/app/src/main/res/values/styles.xml', 'utf8');
styles = styles.replace(
  '<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n        <item name="android:background">@drawable/splash</item>\n    </style>',
  '<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n' +
  '        <item name="android:background">@color/auz_splash_bg</item>\n' +
  '        <item name="windowSplashScreenBackground">@color/auz_splash_bg</item>\n' +
  '        <item name="windowSplashScreenAnimatedIcon">@drawable/auz_splash_icon</item>\n' +
  '        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>\n' +
  '    </style>');
fs.writeFileSync('android/app/src/main/res/values/styles.xml', styles);
// Payroll's clock-in (and the hub app, which can navigate into Payroll in the same WebView -- allowNavigation
// above covers the whole domain) calls plain navigator.geolocation. Capacitor's own WebView already answers that
// call (BridgeWebChromeClient grants the runtime permission automatically, no extra npm plugin needed) -- but
// only once the permission actually exists in the manifest; `cap add android`'s template never includes it, so
// without this the browser call always silently fails (position unavailable) inside the packaged app, with no
// error a user could act on. Declared for every app, not just payroll, since it costs nothing when unused and the
// hub app can end up showing the Payroll pages in its own WebView.
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('ACCESS_FINE_LOCATION')) {
  manifest = manifest.replace('</manifest>',
    '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />\n' +
    '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />\n' +
    // Android 13+ (API 33) requires this to be requested at runtime before any
    // notification (including a push one) can actually show -- @capacitor/push-notifications'
    // requestPermissions() call does that, but only works at all once this is declared.
    '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n' +
    '</manifest>');
  fs.writeFileSync(manifestPath, manifest);
}
// The hub app (and its auzslab://signin intent filter, Google sign-in's hand-back from the phone's
// own browser) was removed per owner request -- this block used to add that filter for app === 'hub',
// which can never run now that 'hub' is gone from apps.json. Each of the five remaining apps' own
// in-app Google sign-in still works the same way it always did: the app, not an embedded web view.
// Barcode scanning (AUZsLedger Scan to bill / AUZsScan, ds/scanner.js) opens the camera with getUserMedia. Capacitor's WebView
// answers that prompt itself, but only once CAMERA is declared. camera is not "required", so phones without one are not filtered out.
manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('android.permission.CAMERA')) {
  manifest = manifest.replace('</manifest>',
    '    <uses-permission android:name="android.permission.CAMERA" />\n' +
    '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n' +
    '</manifest>');
  fs.writeFileSync(manifestPath, manifest);
}
// Bluetooth receipt printing (ds/escpos.js's native branch, @capacitor-community/bluetooth-le). The plugin's own
// `cap add android` step already merges BLUETOOTH_SCAN/BLUETOOTH_CONNECT (Android 12+, API 31) into the manifest
// via its AndroidManifest; ACCESS_FINE_LOCATION (needed for BLE scanning on Android < 12) is already declared above
// for every app. This block only adds the two legacy permissions (`BLUETOOTH`/`BLUETOOTH_ADMIN`) that some older
// plugin/manifest-merger paths still expect and that cost nothing when unused -- confirmed by reading the plugin's
// own documented manifest requirements, NOT verified by an actual build (no Android SDK in this sandbox).
manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('android.permission.BLUETOOTH"')) {
  manifest = manifest.replace('</manifest>',
    '    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />\n' +
    '    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />\n' +
    '</manifest>');
  fs.writeFileSync(manifestPath, manifest);
}

// Native push (Firebase Cloud Messaging, db/119/server/src/fcm.js). Same
// dormant-until-configured discipline as every other optional integration:
// without a GOOGLE_SERVICES_JSON secret, this file is never written and the
// app builds exactly as before (no push, nothing broken). Confirmed by hand:
// once @capacitor/push-notifications is installed, `cap add android` itself
// already writes a try/catch into android/app/build.gradle that applies the
// google-services Gradle plugin only if google-services.json exists and is
// non-empty -- so writing the file here is the only step this script needs;
// the plugin side is already handled by Capacitor's own template.
// The Firebase file only lists the apps registered in the Firebase project; the
// google-services Gradle plugin fails the whole build when this app's package id
// is not in it. So the file is written only when it contains this app's id;
// otherwise this app builds without push, exactly like the dormant case.
if (pushReady) {
  fs.writeFileSync('android/app/google-services.json', gsRaw);
} else if (process.env.GOOGLE_SERVICES_JSON) {
  console.log('push skipped: '+A.id+' is not in the Firebase file');
}

const g='android/app/build.gradle'; let t=fs.readFileSync(g,'utf8');
t=t.replace(/versionCode \d+/,'versionCode '+(process.env.VERSION_CODE||1)).replace(/versionName "[^"]*"/,'versionName "'+(process.env.VERSION_NAME||'1.0.0')+'"');
// Release signing (only when the keystore secrets are present): Play re-signs with its own key (Play App Signing),
// this is the upload key.
if (process.env.KEYSTORE_PATH) {
  t = t.replace(/android \{/, `android {
    signingConfigs {
        release {
            storeFile file(System.getenv('KEYSTORE_PATH'))
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias System.getenv('KEY_ALIAS')
            keyPassword System.getenv('KEY_PASSWORD')
        }
    }`);
  t = t.replace(/buildTypes \{\s*release \{/, m => m + `
            signingConfig signingConfigs.release`);
}
fs.writeFileSync(g,t);
console.log('ready:',app);
