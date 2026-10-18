// Usage (on a Mac): node build-ios.mjs [hub] ; generates www/, capacitor.config.json and the ios/ Xcode project for the hub app.
// The iPhone/iPad app is the SAME hub as every other platform (https://app.auzslab.in/start.html) in a native shell, plus the in-app
// shell script (app/public/ds/appshell.js: way back to the hub, no bounce, and NO buying inside the app: Apple's rules).
// Needs a Mac (Xcode). The GitHub workflow .github/workflows/ios.yml runs it on a macOS runner. Never run on a real iPhone from the build sandbox.
import fs from 'fs'; import { execSync } from 'child_process';
const app = process.argv[2] || 'hub';
const A = JSON.parse(fs.readFileSync('apps.json', 'utf8'))[app];
if (!A) throw new Error('unknown app ' + app);
fs.rmSync('www', { recursive: true, force: true }); fs.mkdirSync('www');
// shown only if the first page cannot load (no connection)
fs.writeFileSync('www/index.html', `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${A.name}</title>
<body style="margin:0;background:#171717;color:#f6f4f1;font:16px -apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px">
<div><h1 style="font-size:22px;margin:0 0 8px">You are offline</h1><p style="color:#b9b2aa;margin:0 0 18px">${A.name} needs a connection to open.</p>
<button onclick="location.href='${A.url}'" style="min-height:46px;padding:0 22px;border:0;border-radius:12px;background:#c2183f;color:#fff;font:600 16px -apple-system,sans-serif">Try again</button></div>`);
fs.writeFileSync('capacitor.config.json', JSON.stringify({
  appId: A.id, appName: A.name, webDir: 'www', backgroundColor: '#171717',
  server: { url: A.url, cleartext: false, allowNavigation: ['auzslab.in', '*.auzslab.in'] },
  ios: { appendUserAgent: 'AUZslabApp', contentInset: 'never', allowsLinkPreview: false, scrollEnabled: true, backgroundColor: '#171717' }
}, null, 2));
fs.rmSync('ios', { recursive: true, force: true });
execSync('npx cap add ios', { stdio: 'inherit' });

// App icon: one 1024 square (Xcode 15 single-size icon). Upscaled from the 512 master; replace app/public/icon-hub-1024.png with a true 1024 when there is one.
const src = fs.existsSync('../app/public/icon-hub-1024.png') ? '../app/public/icon-hub-1024.png' : '../app/public/' + A.icon;
const set = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
execSync(`python3 -c "from PIL import Image;im=Image.open('${src}').convert('RGB');im.resize((1024,1024),Image.LANCZOS).save('${set}/AppIcon-512@2x.png')"`);

// The words iOS shows when the app asks for permission (the app is rejected without them): scanning, clock-in location, photos for uploads, Face ID.
const plist = 'ios/App/App/Info.plist'; let p = fs.readFileSync(plist, 'utf8');
const add = {
  NSCameraUsageDescription: 'AUZslab uses the camera to scan barcodes and to take photos you choose to upload.',
  NSPhotoLibraryUsageDescription: 'AUZslab lets you choose photos to upload, such as a logo or a menu photo.',
  NSLocationWhenInUseUsageDescription: 'AUZslab uses your location only when you clock in, to check you are at your workplace.',
  NSFaceIDUsageDescription: 'AUZslab can use Face ID to unlock the app.',
  // Receipt printing over Bluetooth (ds/escpos.js's native branch, @capacitor-community/bluetooth-le). Web
  // Bluetooth has never existed in WebKit on any Apple platform, so this is the only way the hub's webview can
  // ever reach a thermal printer on iOS. Without this string iOS refuses to let the app ask for Bluetooth at all.
  NSBluetoothAlwaysUsageDescription: 'AUZslab uses Bluetooth to connect to your receipt printer.',
  ITSAppUsesNonExemptEncryption: false
};
let extra = '';
for (const [k, v] of Object.entries(add)) if (!p.includes('<key>' + k + '</key>')) extra += `\t<key>${k}</key>\n\t` + (typeof v === 'boolean' ? (v ? '<true/>' : '<false/>') : `<string>${v}</string>`) + '\n';
// auzslab://signin brings the Google sign-in (done in Safari, because Google refuses an embedded web view) back into the app
if (!p.includes('<string>auzslab</string>')) extra += '\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>in.auzslab.app</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>auzslab</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n';
p = p.replace(/<\/dict>\s*<\/plist>\s*$/, extra + '</dict>\n</plist>\n');
fs.writeFileSync(plist, p);
execSync('npx cap sync ios', { stdio: 'inherit' });
console.log('ios project ready in mobile/ios');
