// Usage: node build.mjs <app> ; generates www/, capacitor.config.json and the android/ project for one app.
import fs from 'fs'; import {execSync} from 'child_process';
const app = process.argv[2] || 'hub';
const A = JSON.parse(fs.readFileSync('apps.json','utf8'))[app];
if (!A) throw new Error('unknown app '+app);
fs.rmSync('www',{recursive:true,force:true}); fs.mkdirSync('www');
fs.writeFileSync('www/index.html', `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${A.name}</title><body style="margin:0;background:#171717;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><div><h1 style="font-size:22px">${A.name}</h1><p>You are offline. Connect to the internet and try again.</p><button onclick="location.href='${A.url}'" style="font:inherit;padding:12px 22px;border:0;border-radius:12px">Retry</button></div>`);
fs.writeFileSync('capacitor.config.json', JSON.stringify({
  appId:A.id, appName:A.name, webDir:'www', backgroundColor:'#171717',
  server:{url:A.url, cleartext:false, allowNavigation:['auzslab.in','*.auzslab.in']},
  android:{appendUserAgent:'AUZslabApp', allowMixedContent:false}
},null,2));
fs.rmSync('android',{recursive:true,force:true});
execSync('npx cap add android',{stdio:'inherit'});
const png = '../app/public/'+A.icon;
if (fs.existsSync(png)) {
  for (const [d,s] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})) {
    for (const n of ['ic_launcher','ic_launcher_round','ic_launcher_foreground'])
      execSync(`python3 -c "from PIL import Image;Image.open('${png}').convert('RGBA').resize((${s},${s})).save('android/app/src/main/res/mipmap-${d}/${n}.png')"`);
  }
}
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
    '</manifest>');
  fs.writeFileSync(manifestPath, manifest);
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
