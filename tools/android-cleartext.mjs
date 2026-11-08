// After `tauri android init`: allow plain-HTTP requests so the phone app can sync with the
// desktop home base on the home network (http://192.168.x.x:7878). Run: node tools/android-cleartext.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = 'src-tauri/gen/android/app';
const manifest = path.join(root, 'src/main/AndroidManifest.xml');
if (!fs.existsSync(manifest)) { console.error('Run `npm run android:init` first.'); process.exit(1); }

let m = fs.readFileSync(manifest, 'utf8');
if (/usesCleartextTraffic=/.test(m)) m = m.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="true"');
else m = m.replace('<application', '<application android:usesCleartextTraffic="true"');
if (!m.includes('android.permission.CAMERA')) m = m.replace('<application', '<uses-permission android:name="android.permission.CAMERA" />\n    <application');
fs.writeFileSync(manifest, m);

for (const f of ['build.gradle.kts', 'build.gradle']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*)"false"/g, '$1"true"'));
}
console.log('Android project allows home-network sync (cleartext HTTP) and the camera for scanning labels.');
