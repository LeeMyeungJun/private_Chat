const { app, BrowserWindow, Menu, dialog, clipboard, ipcMain, session, shell, screen } = require('electron');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { publishConnection } = require('./connection-publisher.cjs');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, '.data'));
const port = Number(process.env.PORT || 3000);
const localUrl = `http://127.0.0.1:${port}`;
const smoke = Boolean(process.env.CHAT_DESKTOP_SMOKE);
const chatOnly = process.argv.includes('--chat');
const shareAddressPath = smoke ? path.join(dataDir, '공유주소.txt') : path.join(root, '공유주소.txt');
if (smoke) app.setPath('userData', path.join(dataDir, 'electron-state'));
let window, serverWindow, child, tunnelWorker, quitting = false;
const closingChats = new WeakSet();
let publicUrl = '', sharingBusy = false, shareStatus = '외부 접속 주소를 준비하고 있어요.';
let connectionTimer;
let connectionGeneration = 0;
const logPath = path.join(dataDir, 'desktop.log');
fs.mkdirSync(dataDir, { recursive: true });
function log(text) { fs.appendFileSync(logPath, `${new Date().toISOString()} ${text}\n`); }
function hostInfo() { return { publicUrl, sharingBusy, shareStatus, localUrl, chatOpen: Boolean(window && !window.isDestroyed()) }; }
function publishInfo() { for (const view of [window, serverWindow]) if (view && !view.isDestroyed()) view.webContents.send('host:status', hostInfo()); }
function authorize(event) { if (![window?.webContents, serverWindow?.webContents].includes(event.sender)) throw new Error('Unauthorized'); }
function stopServer() {
  clearTimeout(connectionTimer); connectionGeneration++;
  if (tunnelWorker?.connected) tunnelWorker.send({ type: 'stop' }, () => {});
  removeShareAddress();
  if (child && child.exitCode === null) { log('SERVER_STOP_REQUEST'); child.kill(); }
}
function removeShareAddress() { try { fs.unlinkSync(shareAddressPath); } catch (error) { if (error.code !== 'ENOENT') log('ADDRESS_REMOVE_FAILED ' + error.code); } }
if (!app.requestSingleInstanceLock()) app.quit();
else if (chatOnly) {
  app.whenReady().then(() => {
    log('CHAT_SERVER_CLOSED');
    if (!smoke) dialog.showErrorBox('서버가 닫혀 있습니다', '모음 서버 바로가기로 서버를 먼저 열어 주세요.');
    app.quit();
  });
}
else {
  app.on('second-instance', (event, argv) => {
    if (argv.includes('--chat')) openChat().catch(error => log('CHAT_OPEN_ERROR ' + error.message));
    else if (serverWindow) { if (serverWindow.isMinimized()) serverWindow.restore(); serverWindow.show(); serverWindow.focus(); }
  });
  app.on('before-quit', () => { quitting = true; stopServer(); });
  app.on('window-all-closed', () => app.quit());
  process.on('exit', stopServer);
  app.whenReady().then(start).catch(error => { log('START_ERROR ' + error.message); dialog.showErrorBox('모음 실행 실패', error.message); app.quit(); });
}
async function startServer() {
  child = fork(path.join(root, 'server.js'), [], { cwd: root, execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DATA_DIR: dataDir, PORT: String(port) }, silent: true, windowsHide: true });
  fs.writeFileSync(path.join(dataDir, 'desktop-server-pid.txt'), String(child.pid));
  child.stderr.on('data', data => log('SERVER_ERROR ' + data.toString().trim()));
  child.on('exit', (code, signal) => {
    log(`SERVER_EXIT ${code ?? signal}`);
    if (!quitting) { dialog.showErrorBox('서버가 종료되었습니다', '채팅 서버가 종료되어 앱도 닫힙니다. 다시 실행해 주세요.'); app.quit(); }
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('서버 시작 시간이 초과되었습니다.')), 15000);
    child.stdout.on('data', data => { output += data; if (output.includes('Private Chat ready:')) { clearTimeout(timer); log('SERVER_READY'); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('서버를 시작하지 못했습니다. 3000 포트가 사용 중인지 확인해 주세요.')); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}
async function start() {
  fs.writeFileSync(path.join(dataDir, 'desktop-app-pid.txt'), String(process.pid));
  removeShareAddress();
  await startServer();
  const password = fs.readFileSync(path.join(dataDir, '입장비밀번호.txt'), 'utf8').trim();
  const response = await fetch(localUrl + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'MainPC', password }) });
  if (!response.ok) throw new Error('호스트 자동 입장에 실패했습니다.');
  const token = response.headers.get('set-cookie').split(';')[0].slice('chat_session='.length);
  await session.defaultSession.cookies.set({ url: localUrl, name: 'chat_session', value: token, httpOnly: true, sameSite: 'strict' });
  ipcMain.handle('host:info', event => { authorize(event); return hostInfo(); });
  ipcMain.handle('host:open-chat', async event => { authorize(event); await openChat(); return hostInfo(); });
  ipcMain.handle('host:quit', event => { authorize(event); app.quit(); });
  ipcMain.handle('host:sharing', async event => {
    authorize(event);
    configureSharing();
    return hostInfo();
  });
  ipcMain.handle('host:retry-sharing', async event => {
    authorize(event);
    configureSharing(); return hostInfo();
  });
  ipcMain.handle('host:invite', async event => {
    authorize(event);
    const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), { type: 'info', title: '친구 초대하기', message: publicUrl ? '이 주소와 비밀번호를 친구에게 전달해 주세요.' : '외부 접속 주소를 준비 중입니다.', detail: `${publicUrl || shareStatus}\n\n입장 비밀번호: ${password}\n\n서버 창을 닫으면 서버와 외부 접속이 종료됩니다.\n채팅창만 닫으면 서버는 계속 실행됩니다.\n서버를 다시 실행하면 새로운 주소가 만들어집니다.`, buttons: publicUrl ? ['주소와 비밀번호 복사', '닫기'] : ['닫기'], defaultId: publicUrl ? 1 : 0, cancelId: publicUrl ? 1 : 0 });
    if (publicUrl && result.response === 0) clipboard.writeText(`모음 채팅\n${publicUrl}\n입장 비밀번호: ${password}`);
    return { copied: Boolean(publicUrl) && result.response === 0 };
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '모음', submenu: [{ label: '채팅창 열기', click: () => openChat().catch(error => log('CHAT_OPEN_ERROR ' + error.message)) }, { label: '초대 정보', click: () => serverWindow?.webContents.send('host:invite-open') }, { label: '데이터 폴더 열기', click: () => shell.openPath(dataDir) }, { type: 'separator' }, { label: '서버 종료', click: () => app.quit() }] },
    { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '보기', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
  await openServerWindow();
  if (smoke) {
    log('SMOKE_SERVER_ONLY ' + JSON.stringify({ chatOpen: Boolean(window) }));
    await serverWindow.webContents.executeJavaScript('window.moeumHost.openChat()');
    if (process.env.CHAT_TEST_TUNNEL === '1') {
      configureSharing();
      const startedAt = Date.now();
      while (sharingBusy && Date.now() - startedAt < 120000) await new Promise(resolve => setTimeout(resolve, 100));
      log('SMOKE_EXTERNAL ' + JSON.stringify({ connected: Boolean(publicUrl), url: publicUrl }));
      if (process.env.CHAT_DESKTOP_SMOKE === '1' && publicUrl) {
        const deadline = Date.now() + 30000;
        while (!fs.existsSync(path.join(dataDir, 'public-test-complete')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const result = await window.webContents.executeJavaScript(`new Promise(resolve => { let count = 0; const poll = setInterval(() => { const ws = document.getElementById('workspace'); if (ws && !ws.hidden) { clearInterval(poll); resolve({ loggedIn: true, title: document.title, overflow: document.documentElement.scrollWidth > innerWidth }); } else if (++count > 100) { clearInterval(poll); resolve({ loggedIn: false }); } }, 100); })`);
    log('SMOKE_UI ' + JSON.stringify(result));
    const serverView = await serverWindow.webContents.executeJavaScript(`({ title: document.title, hasChatControl: !!document.getElementById('open-chat'), hasStopControl: !!document.getElementById('stop-server'), overflow: document.documentElement.scrollWidth > innerWidth })`);
    log('SMOKE_SERVER_UI ' + JSON.stringify(serverView));
    if (process.env.CHAT_SCREENSHOT_PATH) { const capture = await window.webContents.capturePage(); fs.writeFileSync(process.env.CHAT_SCREENSHOT_PATH, capture.toPNG()); }
    if (process.env.CHAT_SERVER_SCREENSHOT_PATH) { const capture = await serverWindow.webContents.capturePage(); fs.writeFileSync(process.env.CHAT_SERVER_SCREENSHOT_PATH, capture.toPNG()); }
    if (process.env.CHAT_DESKTOP_SMOKE === '1') {
      window.close();
      const response = await fetch(localUrl + '/api/health');
      let externalAlive = true;
      if (publicUrl) { const remote = await fetch(publicUrl + '/api/health', { signal: AbortSignal.timeout(10000) }); externalAlive = remote.ok && (await remote.json()).ok; }
      log('SMOKE_CHAT_CLOSED ' + JSON.stringify({ serverAlive: response.ok && (await response.json()).ok, serverWindowOpen: Boolean(serverWindow && !serverWindow.isDestroyed()), externalAlive }));
      await serverWindow.webContents.executeJavaScript('window.moeumHost.openChat()');
      const restored = await window.webContents.executeJavaScript(`new Promise(resolve => { const started = Date.now(); const timer = setInterval(() => { if (!document.getElementById('workspace').hidden) { clearInterval(timer); resolve(true); } else if (Date.now() - started > 10000) { clearInterval(timer); resolve(false); } }, 100); })`);
      log('SMOKE_CHAT_REOPENED ' + restored);
      serverWindow.close();
    }
  } else configureSharing();
}
async function openServerWindow() {
  serverWindow = new BrowserWindow({ width: 490, height: 720, minWidth: 430, minHeight: 620, title: '모음 · 서버 관리', backgroundColor: '#13131c', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  serverWindow.on('close', () => { log('SERVER_WINDOW_CLOSE'); quitting = true; stopServer(); });
  serverWindow.on('closed', () => { serverWindow = null; app.quit(); });
  serverWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  serverWindow.webContents.on('will-navigate', event => event.preventDefault());
  if (!smoke) {
    const area = screen.getPrimaryDisplay().workArea;
    serverWindow.setBounds({ x: area.x + 24, y: area.y + 24, width: 460, height: Math.max(620, Math.min(720, area.height - 48)) });
  }
  await serverWindow.loadFile(path.join(__dirname, 'server.html'));
  if (!smoke) serverWindow.show(); log('SERVER_WINDOW_READY');
}
async function openChat() {
  if (quitting) return;
  if (window && !window.isDestroyed()) {
    if (closingChats.has(window)) { await once(window, 'closed'); return openChat(); }
    if (!smoke) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
    return;
  }
  const chat = new BrowserWindow({ width: smoke && process.env.CHAT_SMOKE_MOBILE ? 430 : 1280, height: 880, minWidth: 400, minHeight: 560, title: '모음 · 채팅', backgroundColor: '#13131c', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window = chat;
  if (!smoke) {
    const area = screen.getPrimaryDisplay().workArea;
    const sideBySide = area.width >= 1300;
    chat.setBounds({ x: area.x + (sideBySide ? 504 : 65), y: area.y + (sideBySide ? 24 : 50), width: Math.max(400, Math.min(1280, area.width - (sideBySide ? 528 : 90))), height: Math.max(560, Math.min(880, area.height - (sideBySide ? 48 : 75))) });
  }
  chat.on('close', () => { closingChats.add(chat); log('CHAT_WINDOW_CLOSE'); });
  chat.on('closed', () => { if (window === chat) window = null; publishInfo(); });
  chat.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  chat.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== localUrl) event.preventDefault(); });
  await chat.loadURL(localUrl);
  if (!chat.isDestroyed()) { if (!smoke) chat.show(); chat.setTitle('모음 · 채팅'); }
  log('WINDOW_READY'); publishInfo();
}
function configureSharing() {
  if (sharingBusy || quitting) return;
  clearTimeout(connectionTimer); connectionGeneration++;
  publicUrl = ''; removeShareAddress(); sharingBusy = true;
  shareStatus = '외부 접속 주소를 생성하고 있어요.'; publishInfo();
  if (tunnelWorker?.connected) tunnelWorker.send({ type: 'stop' }, () => {});
  const worker = fork(path.join(__dirname, 'tunnel-worker.cjs'), [], { cwd: root, execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, silent: true, windowsHide: true });
  tunnelWorker = worker;
  worker.on('error', () => sharingFailed(worker, '외부 연결 모듈을 실행하지 못했습니다.'));
  worker.on('exit', () => { if (!quitting && tunnelWorker === worker && (sharingBusy || publicUrl)) sharingFailed(worker, '외부 연결이 종료되었습니다. 다시 연결해 주세요.'); });
  worker.on('message', async message => {
    if (quitting || tunnelWorker !== worker) return;
    if (message.type === 'status') { shareStatus = message.text; publishInfo(); }
    if (message.type === 'pid') fs.writeFileSync(path.join(dataDir, 'connector-pid.txt'), String(message.pid));
    if (message.type === 'error') sharingFailed(worker, message.text);
    if (message.type === 'ready') {
      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(message.url)) return sharingFailed(worker, '유효하지 않은 외부 접속 주소입니다.');
      shareStatus = '외부 주소에서 서버 응답을 확인하고 있어요.'; publishInfo();
      // An allocated hostname alone is not proof that external users can reach us.
      for (let attempt = 0; attempt < 12; attempt++) {
        if (quitting || tunnelWorker !== worker || !worker.connected) return;
        try {
          const response = await fetch(message.url + '/api/health', { signal: AbortSignal.timeout(5000) });
          const health = response.ok ? await response.json() : {};
          if (health.ok) {
            if (quitting || tunnelWorker !== worker || !worker.connected) return;
            publicUrl = message.url; sharingBusy = false;
            fs.writeFileSync(shareAddressPath, publicUrl + '\n', 'utf8');
            shareStatus = '외부 접속 가능 · 다시 실행하면 주소가 바뀝니다.';
            log('PUBLIC_READY ' + publicUrl); publishInfo();
            if (!smoke) registerAndroid(publicUrl, health.instanceId, connectionGeneration);
            return;
          }
        } catch { /* DNS or the edge route can need a few seconds to settle. */ }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      sharingFailed(worker, '외부 주소 응답을 확인하지 못했습니다. 다시 연결해 주세요.');
    }
  });
  worker.send({ type: 'start', root, localUrl, addressFile: shareAddressPath });
}
function sharingFailed(worker, text) {
  if (quitting || tunnelWorker !== worker) return;
  clearTimeout(connectionTimer); connectionGeneration++;
  publicUrl = ''; removeShareAddress(); sharingBusy = false; shareStatus = text;
  if (worker.connected) worker.send({ type: 'stop' }, () => {});
  log('PUBLIC_ERROR ' + text); publishInfo();
}

async function registerAndroid(address, instanceId, generation) {
  if (quitting || generation !== connectionGeneration || publicUrl !== address) return;
  try {
    await publishConnection(root, address, instanceId);
    if (quitting || generation !== connectionGeneration || publicUrl !== address) return;
    shareStatus = '외부 접속 가능 · Android 앱 입장 가능';
    log('ANDROID_ADDRESS_READY'); publishInfo();
  } catch (error) {
    if (quitting || generation !== connectionGeneration || publicUrl !== address) return;
    shareStatus = '외부 접속 가능 · 앱 주소 등록 재시도 중 (MainPC GitHub 인증 확인)';
    log('ANDROID_ADDRESS_ERROR ' + error.message); publishInfo();
    connectionTimer = setTimeout(() => registerAndroid(address, instanceId, generation), 60000);
  }
}
