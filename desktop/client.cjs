const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, session, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, '.data'));
const localUrl = `http://127.0.0.1:${Number(process.env.PORT || 3000)}`;
const smoke = Boolean(process.env.CHAT_CLIENT_SMOKE);
app.setPath('userData', smoke ? path.join(dataDir, 'client-state') : path.join(app.getPath('appData'), 'moeum-chat-client'));
fs.mkdirSync(dataDir, { recursive: true });
const log = text => fs.appendFileSync(path.join(dataDir, 'client.log'), `${new Date().toISOString()} ${text}\n`);
let window, timer, opening = false, connected = false;
function authorize(event) { if (event.sender !== window?.webContents) throw new Error('Unauthorized'); }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => clearInterval(timer));
  app.whenReady().then(start).catch(error => { log('CLIENT_ERROR ' + error.message); if (!smoke) dialog.showErrorBox('채팅 실행 실패', error.message); app.quit(); });
}
async function start() {
  fs.writeFileSync(path.join(dataDir, 'desktop-client-pid.txt'), String(process.pid));
  window = new BrowserWindow({ width: smoke && process.env.CHAT_SMOKE_MOBILE ? 430 : 1100, height: 880, minWidth: 400, minHeight: 560,
    title: '모음 · 채팅', backgroundColor: '#13131c', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'client-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (!smoke) {
    const area = screen.getPrimaryDisplay().workArea;
    const side = area.width >= 928;
    window.setBounds({ x: area.x + (side ? 504 : 65), y: area.y + 24,
      width: Math.max(400, Math.min(1280, area.width - (side ? 528 : 90))), height: Math.max(560, Math.min(880, area.height - 48)) });
  }
  window.on('closed', () => { log('CLIENT_WINDOW_CLOSED'); window = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, address) => {
    try { if (new URL(address).origin !== localUrl) event.preventDefault(); } catch { event.preventDefault(); }
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));
  ipcMain.handle('client:retry', event => { authorize(event); return connect(); });
  ipcMain.handle('client:invite', event => {
    authorize(event);
    const file = smoke ? path.join(dataDir, '공유주소.txt') : path.join(root, '공유주소.txt');
    const address = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(address)) return false;
    clipboard.writeText(address); return true;
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '채팅', submenu: [{ label: '다시 입장', click: () => connect().catch(error => log(error.message)) }, { label: '채팅창 닫기', role: 'close' }] },
    { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
  ]));
  await connect();
  if (!smoke) { window.show(); window.focus(); }
  if (smoke && connected) {
    const result = await window.webContents.executeJavaScript(`new Promise(resolve => { let count = 0; const timer = setInterval(() => {
      if (!document.getElementById('workspace').hidden) { clearInterval(timer); resolve({ loggedIn: true, overflow: document.documentElement.scrollWidth > innerWidth }); }
      else if (++count > 100) { clearInterval(timer); resolve({ loggedIn: false }); }
    }, 100); })`);
    log('CLIENT_UI ' + JSON.stringify(result));
    const entry = await window.webContents.executeJavaScript(`(async () => {
      showLogin(); await api('/api/logout', { method: 'POST' });
      if (document.querySelector('input[type="password"]') || window.moeumHost) return false;
      document.getElementById('nickname').value = 'MainPC'; document.getElementById('login-form').requestSubmit();
      return new Promise(resolve => { let count = 0; const timer = setInterval(() => {
        if (!document.getElementById('workspace').hidden) { clearInterval(timer); resolve(true); }
        else if (++count > 100) { clearInterval(timer); resolve(false); }
      }, 100); });
    })()`);
    log('CLIENT_NICKNAME_ENTRY ' + entry);
  }
  if (smoke === true && process.env.CHAT_CLIENT_SMOKE === '1') { window.close(); return; }
  timer = setInterval(async () => {
    if (!connected || opening || !window) return;
    try { const result = await fetch(localUrl + '/api/health', { signal: AbortSignal.timeout(1500) }); if (!result.ok) throw new Error('Closed'); }
    catch { if (!opening && window) await closed(); }
  }, 3000);
}
async function closed() {
  connected = false; log('CLIENT_SERVER_CLOSED');
  if (window && !window.isDestroyed()) await window.loadFile(path.join(__dirname, 'client-closed.html'));
}
async function connect() {
  if (opening || !window) return;
  opening = true;
  try {
    const health = await fetch(localUrl + '/api/health', { signal: AbortSignal.timeout(2000) });
    if (!health.ok || !(await health.json()).ok) throw new Error('Closed');
    const response = await fetch(localUrl + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'MainPC' }), signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Entry failed');
    const token = response.headers.get('set-cookie').split(';')[0].slice('chat_session='.length);
    await session.defaultSession.cookies.set({ url: localUrl, name: 'chat_session', value: token, httpOnly: true, sameSite: 'strict' });
    if (!window || window.isDestroyed()) return;
    await window.loadURL(localUrl); connected = true; log('CLIENT_CONNECTED');
  } catch { await closed(); }
  finally { opening = false; }
}
