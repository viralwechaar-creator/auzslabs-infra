'use strict';
// AUZsStyle for Windows: one window around the app, with its own PostgreSQL database and local server running quietly behind it.
// Works with no internet. Needs a licence code from AUZslab (checked by the local server, see server/src/licence.js).
const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const L = require('./lib/setup.cjs');
const C = require('./lib/cloud.cjs');

const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'stage');
const paths = { pgBin: path.join(RES, 'pg', 'bin'), serverDir: path.join(RES, 'server'), appDir: path.join(RES, 'app'), dbDir: path.join(RES, 'db') };
const dataDir = app.getPath('userData');
const uploads = path.join(dataDir, 'uploads');
let server = null, win = null, splash = null, ctx = null, port = 0, pgPort = 0, quitting = false;

// (Electron 22, used for Windows 7, has no built-in fetch in this part of the program)
const getJson = (u) => new Promise((res, rej) => http.get(u, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => { let j = {}; try { j = JSON.parse(b || '{}'); } catch { /* not json */ } res({ ok: r.statusCode < 400, json: j }); }); }).on('error', rej));
const log = (m) => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.appendFileSync(path.join(dataDir, 'app.log'), new Date().toISOString() + ' ' + m + '\n'); } catch { /* ignore */ } };
const free = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const portOk = (p) => new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))); });
const say = (m) => { log(m); if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript(`document.getElementById('m').textContent=${JSON.stringify(m)}`).catch(() => {}); };

// The address must stay the same between runs: the browser part keeps the shop's waiting changes and sign-in under it.
async function chooseAddress() {
  const f = path.join(dataDir, 'settings.json'); let s = {};
  try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* first run */ }
  if (!s.port) s.port = (await portOk(38417)) ? 38417 : await free();
  if (!s.pgPort) s.pgPort = (await portOk(54329)) ? 54329 : await free();
  fs.writeFileSync(f, JSON.stringify(s));
  return s;
}

function startServer(sec) {
  const pub = fs.existsSync(path.join(RES, 'licence-public.txt')) ? fs.readFileSync(path.join(RES, 'licence-public.txt'), 'utf8').trim() : (process.env.LICENCE_PUBLIC_KEY || '');
  if (!pub) throw new Error('This copy of AUZsStyle has no licence key inside it. Please download the installer again.');
  const out = fs.openSync(path.join(dataDir, 'server.log'), 'a');
  server = spawn(process.execPath, ['--require', path.join(RES, 'compat-preload.cjs'), path.join(paths.serverDir, 'src', 'index.js')], {
    cwd: paths.serverDir, stdio: ['ignore', out, out], windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', PORT: String(port), AUZ_OFFLINE: '1', AUZ_DATA_DIR: dataDir, AUZ_APP_ROOT: paths.appDir, UPLOAD_ROOT: uploads, DOC_UPLOAD_ROOT: path.join(dataDir, 'docs'), PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PUBLIC_KEY: pub, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '6' },
  });
  server.on('exit', (c) => { log('server exited ' + c); server = null; });
}
const stopServer = () => new Promise((r) => { if (!server) return r(); const s = server; s.once('exit', () => r()); s.kill(); setTimeout(r, 5000); });
async function waitServer() {
  for (let i = 0; i < 120; i++) { try { const r = await getJson(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('The program behind AUZsStyle did not start. See ' + path.join(dataDir, 'server.log'));
}

async function boot() {
  splash = new BrowserWindow({ width: 420, height: 260, frame: false, resizable: false, show: true, backgroundColor: '#ffffff', webPreferences: { contextIsolation: true } });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  try {
    ctx = await chooseAddress(); port = ctx.port; pgPort = ctx.pgPort;
    const sec = L.secrets(dataDir);
    const o = { ...paths, dataDir, port: pgPort, superPassword: sec.superPassword, appPassword: sec.appPassword, memoryMb: Math.round(os.totalmem() / 1048576) };
    say('Getting things ready...');
    if (L.ensureCluster(o)) say('Creating the database for this computer...');
    L.startPg(o);
    const r = await L.migrate({ ...o, onProgress: (i, n) => { if (n > 1) say(`Setting up the first time (${i}/${n}). This takes a minute or two...`); } });
    if (r.applied) log('migrations applied: ' + r.applied);
    say('Starting...');
    startServer(sec); await waitServer();
    openWindow();
  } catch (e) {
    log('start failed: ' + (e && e.stack || e));
    dialog.showErrorBox('AUZsStyle could not start', String(e && e.message || e) + '\n\nDetails are saved in ' + path.join(dataDir, 'app.log'));
    app.exit(1);
  } finally { if (splash && !splash.isDestroyed()) splash.close(); }
}

function openWindow() {
  const origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 600, title: 'AUZsStyle', backgroundColor: '#f5f4f2', autoHideMenuBar: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  // the camera is used to scan tags; nothing else is allowed
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && wc.getURL().startsWith(origin)));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url); return { action: 'deny' }; }); // WhatsApp bill links open in the browser
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.loadURL(origin + '/');
  win.on('closed', () => { win = null; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Shop', submenu: [
      { label: 'Back up to a pen drive or folder...', click: doBackup },
      { label: 'Restore from a backup...', click: doRestore },
      { label: 'Back up to the cloud now', click: () => cloudNow(true) },
      { label: 'Restore from the cloud...', click: doCloudRestore },
      { label: 'Open the data folder', click: () => shell.openPath(dataDir) },
      { type: 'separator' },
      { label: 'Licence', click: showLicence },
      { type: 'separator' }, { role: 'quit', label: 'Quit' }] },
    { label: 'View', submenu: [{ role: 'reload', label: 'Reload' }, { role: 'togglefullscreen', label: 'Full screen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
  ]));
}

const pgOpts = () => { const sec = L.secrets(dataDir); return { ...paths, dataDir, port: pgPort, superPassword: sec.superPassword, appPassword: sec.appPassword, uploadDir: uploads }; };
async function doBackup() {
  const r = await dialog.showOpenDialog(win, { title: 'Choose where to save the backup (a pen drive is best)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  try { const out = L.backup({ ...pgOpts(), targetDir: r.filePaths[0], appVersion: app.getVersion() }); dialog.showMessageBox(win, { type: 'info', message: 'Backup saved', detail: out + '\n\nKeep this folder safe. To use it again choose Shop > Restore from a backup.' }); }
  catch (e) { log('backup failed ' + e.message); dialog.showErrorBox('Backup failed', e.message); }
}
async function doRestore() {
  const r = await dialog.showOpenDialog(win, { title: 'Choose the backup folder (AUZsStyle-backup-...)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  const ok = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Replace everything on this computer with this backup?', detail: 'Sales, stock and bills made after the backup was taken will be lost. This cannot be undone. Take a fresh backup first if unsure.' });
  if (ok.response !== 0) return;
  try {
    await stopServer(); await L.restore({ ...pgOpts(), sourceDir: r.filePaths[0] });
    const o = pgOpts(); await L.migrate({ ...o }); startServer(L.secrets(dataDir)); await waitServer();
    win.webContents.session.clearStorageData().catch(() => {}); win.loadURL(`http://127.0.0.1:${port}/`);
    dialog.showMessageBox(win, { type: 'info', message: 'Backup restored' });
  } catch (e) { log('restore failed ' + e.message); dialog.showErrorBox('Restore failed', e.message); try { if (!server) { startServer(L.secrets(dataDir)); await waitServer(); win.loadURL(`http://127.0.0.1:${port}/`); } } catch { /* ignore */ } }
}
// ---- cloud storage extra (only when the licence includes it): a copy goes to AUZslab about once a day while the computer is online ----
const cloudFile = () => path.join(dataDir, 'cloud.json');
const cloudState = () => { try { return JSON.parse(fs.readFileSync(cloudFile(), 'utf8')); } catch { return {}; } };
const saveCloud = (o) => fs.writeFileSync(cloudFile(), JSON.stringify({ ...cloudState(), ...o }));
let cloudBusy = false;
async function cloudNow(manual) {
  if (cloudBusy) return; cloudBusy = true;
  try {
    const lic = (await getJson(`http://127.0.0.1:${port}/licence/status`)).json;
    if (!lic.addons || !lic.addons.cloud) { if (manual) dialog.showMessageBox(win, { type: 'info', message: 'Cloud storage is not part of your plan', detail: 'Ask AUZslab to add cloud storage to your plan, and send you a new licence code.' }); return; }
    await C.backupToCloud({ ...pgOpts(), appVersion: app.getVersion() });
    saveCloud({ lastOk: new Date().toISOString(), lastError: null });
    if (manual) dialog.showMessageBox(win, { type: 'info', message: 'Backed up to the AUZslab cloud', detail: 'The newest copy of your shop is safe on our server.' });
  } catch (e) {
    log('cloud backup failed: ' + e.message); saveCloud({ lastError: e.message, lastTry: new Date().toISOString() });
    if (manual) dialog.showErrorBox('Cloud backup did not work', e.message);
  } finally { cloudBusy = false; }
}
setInterval(() => { const s = cloudState(); if (win && (!s.lastOk || Date.now() - Date.parse(s.lastOk) > 20 * 3600e3) && (!s.lastTry || Date.now() - Date.parse(s.lastTry) > 3600e3)) cloudNow(false); }, 30 * 60e3).unref();
setTimeout(() => { if (win) cloudNow(false); }, 3 * 60e3).unref();

// ---- a free, automatic backup to THIS computer's own disk, once a day, with no licence add-on needed ----
// Cloud backup above only runs for a shop that paid for the "cloud" extra -- every other shop had no automatic
// backup at all, only the manual "Back up to a pen drive" menu item. A laptop disk failing, or a bad update,
// should never be able to erase a shop's whole history just because nobody remembered to click that menu item.
const localBakFile = () => path.join(dataDir, 'local-backup.json');
const localBakState = () => { try { return JSON.parse(fs.readFileSync(localBakFile(), 'utf8')); } catch { return {}; } };
const saveLocalBak = (o) => fs.writeFileSync(localBakFile(), JSON.stringify({ ...localBakState(), ...o }));
const KEEP_LOCAL_BACKUPS = 7;
let localBakBusy = false;
async function localBackupNow() {
  if (localBakBusy) return; localBakBusy = true;
  try {
    const dir = path.join(dataDir, 'backups');
    const { out } = L.backupAndPrune({ ...pgOpts(), targetDir: dir, appVersion: app.getVersion(), keep: KEEP_LOCAL_BACKUPS });
    saveLocalBak({ lastOk: new Date().toISOString(), lastError: null, lastPath: out });
    log('automatic local backup made: ' + out);
  } catch (e) { log('automatic local backup failed: ' + e.message); saveLocalBak({ lastError: e.message, lastTry: new Date().toISOString() }); }
  finally { localBakBusy = false; }
}
setInterval(() => { const s = localBakState(); if (win && (!s.lastOk || Date.now() - Date.parse(s.lastOk) > 20 * 3600e3) && (!s.lastTry || Date.now() - Date.parse(s.lastTry) > 3600e3)) localBackupNow(); }, 30 * 60e3).unref();
setTimeout(() => { if (win) localBackupNow(); }, 90 * 1000).unref();
async function doCloudRestore() {
  let list;
  try { list = await C.listCloud(pgOpts()); } catch (e) { dialog.showErrorBox('Cloud storage', e.message); return; }
  const items = (list.backups || []).slice(0, 3);
  if (!items.length) { dialog.showMessageBox(win, { type: 'info', message: 'No cloud backups yet', detail: 'Choose Shop > Back up to the cloud now first.' }); return; }
  const fmt = (b) => new Date(b.madeAt).toLocaleString() + ' (' + (b.size / 1048576).toFixed(1) + ' MB' + (b.device ? ', ' + b.device : '') + ')';
  const pick = await dialog.showMessageBox(win, { type: 'warning', buttons: [...items.map((b) => 'Restore ' + fmt(b)), 'Cancel'], defaultId: items.length, cancelId: items.length, message: 'Replace everything on this computer with a copy from the cloud?', detail: 'Sales, stock and bills made after that copy was taken will be lost. This cannot be undone.' });
  if (pick.response >= items.length) return;
  try {
    await stopServer(); await C.restoreFromCloud(pgOpts(), items[pick.response].id);
    await L.migrate({ ...pgOpts() }); startServer(L.secrets(dataDir)); await waitServer();
    win.webContents.session.clearStorageData().catch(() => {}); win.loadURL(`http://127.0.0.1:${port}/`);
    dialog.showMessageBox(win, { type: 'info', message: 'Restored from the cloud' });
  } catch (e) { log('cloud restore failed ' + e.message); dialog.showErrorBox('Restore failed', e.message); try { if (!server) { startServer(L.secrets(dataDir)); await waitServer(); win.loadURL(`http://127.0.0.1:${port}/`); } } catch { /* ignore */ } }
}

async function showLicence() {
  try {
    const s = (await getJson(`http://127.0.0.1:${port}/licence/status`)).json;
    const extras = s.addons ? Object.entries(s.addons).filter(([, v]) => v).map(([k]) => ({ cloud: 'Cloud storage', whatsapp: 'WhatsApp automation', store: 'Online store' }[k])).join(', ') || 'none' : '';
    const lb = localBakState();
    dialog.showMessageBox(win, { type: 'info', message: s.state === 'none' ? 'Not activated yet' : 'Licensed to ' + s.shop, detail: s.state === 'none' ? 'Type the licence code AUZslab gave you on the first screen.' : `Plan ends on ${s.end} (${s.daysLeft >= 0 ? s.daysLeft + ' days left' : 'ended'}).\nExtras: ${extras}.\nLast automatic backup on this computer: ${lb.lastOk ? new Date(lb.lastOk).toLocaleString() : 'none yet'}${lb.lastError ? ' (last problem: ' + lb.lastError + ')' : ''}.\n${s.addons && s.addons.cloud ? 'Last cloud backup: ' + (cloudState().lastOk ? new Date(cloudState().lastOk).toLocaleString() : 'none yet') + (cloudState().lastError ? ' (last problem: ' + cloudState().lastError + ')' : '') + '.\n' : ''}To renew, ask AUZslab for a new code and type it in the app when asked.` });
  } catch (e) { dialog.showErrorBox('Licence', e.message); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(boot);
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', async (e) => {
    if (quitting) return; quitting = true; e.preventDefault();
    try { await stopServer(); L.stopPg(pgOpts()); } catch (err) { log('stop failed ' + err.message); }
    app.exit(0);
  });
}
