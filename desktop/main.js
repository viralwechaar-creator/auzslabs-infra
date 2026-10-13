// AUZslab for Windows and Mac. A thin shell: it opens the SAME hub as the phone apps (https://app.auzslab.in/start.html) in a
// window with no browser chrome. Everything (sign in, marketing site, account, admin panel, team workspace, every product app)
// is the live web app, so one change updates every platform. Pages recognise this shell by the user agent "AUZslabDesktop"
// (see app/public/ds/appshell.js). Plain CommonJS, no build step for the shell itself.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

const START = 'https://app.auzslab.in/start.html';
const OURS = /(^|\.)auzslab\.in$/i;
app.userAgentFallback = app.userAgentFallback + ' AUZslabDesktop';

const isGoogleStart = (u) => { try { const x = new URL(u); return x.pathname === '/signin.html' && /^auzslab:/i.test(x.searchParams.get('return') || ''); } catch { return false; } };
const isOurs = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && OURS.test(x.hostname); } catch { return false; } };

// auzslab://signin#auz_gt=... is how the system browser hands the Google sign-in back to this app
if (process.defaultApp) { if (process.argv.length >= 2) app.setAsDefaultProtocolClient('auzslab', process.execPath, [path.resolve(process.argv[1])]); }
else app.setAsDefaultProtocolClient('auzslab');
let pending = null, win = null;
const takeLink = (u) => { const m = /[#&]auz_gt=([^&\s]+)/.exec(u || ''); if (!m) return; const url = START + '#auz_gt=' + m[1]; if (typeof win !== 'undefined' && win) { win.loadURL(url); win.show(); win.focus(); } else pending = url; };

if (!app.requestSingleInstanceLock()) { app.quit(); } else {

  app.on('second-instance', (_e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } const l = (argv || []).find((a) => /^auzslab:/i.test(a)); if (l) takeLink(l); });
  app.on('open-url', (e, u) => { e.preventDefault(); takeLink(u); });

  function create() {
    win = new BrowserWindow({
      width: 1280, height: 860, minWidth: 380, minHeight: 600, backgroundColor: '#171717', title: 'AUZslab', show: false,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
    });
    win.once('ready-to-show', () => win.show());
    // links inside AUZslab stay in the window; anything else opens in the person's own browser
    // Google refuses an embedded browser, so its sign-in page opens in the person's own browser and returns through auzslab://signin
    const external = (u) => !isOurs(u) || isGoogleStart(u);
    win.webContents.setWindowOpenHandler(({ url }) => { if (!external(url)) { win.loadURL(url); } else { shell.openExternal(url); } return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && external(url)) { e.preventDefault(); shell.openExternal(url); } });
    // no connection: a friendly page with Try again instead of a blank window
    win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => {
      if (isMain && code !== -3 && !String(url).startsWith('file:')) win.loadFile(path.join(__dirname, 'offline.html'));
    });
    win.loadURL(pending || START); pending = null;
  }

  app.whenReady().then(() => {
    // keep copy / paste / undo working on Mac while hiding the rest of the menu bar
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] }
    ]));
    create();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) create(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
