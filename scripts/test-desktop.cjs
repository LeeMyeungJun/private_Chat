const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const electron = require('electron');
const { io } = require('socket.io-client');

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moeum-desktop-'));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), CHAT_DESKTOP_SMOKE: 'hold' };
  delete env.ELECTRON_RUN_AS_NODE;
  const children = [];
  function launch(args, extra = {}) {
    const child = spawn(electron, args, { cwd: path.resolve(__dirname, '..'), env: { ...env, ...extra }, windowsHide: true, stdio: 'ignore' });
    children.push(child); return child;
  }
  async function logs(name) { return fs.readFile(path.join(dataDir, name), 'utf8').catch(() => ''); }
  async function waitLog(name, pattern, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const text = await logs(name); if (pattern.test(text)) return text; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.fail('Timed out: ' + pattern + '\n' + await logs(name));
  }
  async function waitExit(child) {
    if (child.exitCode !== null) return child.exitCode;
    const timer = setTimeout(() => child.kill(), 20000);
    try { return (await once(child, 'exit'))[0]; } finally { clearTimeout(timer); }
  }
  async function serverClosed() {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) }); }
      catch { return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail('Server is still running');
  }
  try {
    const server = launch(['.']);
    const initial = await waitLog('desktop.log', /SMOKE_SERVER_UI/);
    assert.match(initial, /"hasChatControl":false,"hasStopControl":true,"overflow":false,"windows":1/);
    await assert.rejects(fs.access(path.join(dataDir, 'desktop-client-pid.txt')));
    let publicUrl;
    if (process.env.CHAT_TEST_TUNNEL === '1') {
      const shared = await waitLog('desktop.log', /PUBLIC_READY/, 150000);
      publicUrl = shared.match(/PUBLIC_READY (https:\/\/[^\s]+)/)[1];
      const response = await fetch(publicUrl + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: publicUrl }, body: JSON.stringify({ nickname: '외부 확인' }), signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      const socket = io(publicUrl, { extraHeaders: { Cookie: response.headers.get('set-cookie').split(';')[0], Origin: publicUrl }, transports: ['websocket'], reconnection: false, timeout: 10000 });
      try { await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; })]); }
      finally { socket.close(); }
    }
    const client = launch(['.', '--chat'], { CHAT_CLIENT_SMOKE: '1' });
    assert.equal(await waitExit(client), 0);
    const clientLog = await logs('client.log');
    assert.match(clientLog, /CLIENT_UI .*"loggedIn":true,"overflow":false/);
    assert.match(clientLog, /CLIENT_NICKNAME_ENTRY true/);
    assert.equal(Number(await fs.readFile(path.join(dataDir, 'desktop-app-pid.txt'))), server.pid);
    assert.equal(Number(await fs.readFile(path.join(dataDir, 'desktop-client-pid.txt'))), client.pid);
    assert.notEqual(server.pid, client.pid);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
    if (publicUrl) assert.equal((await fetch(publicUrl + '/api/health', { signal: AbortSignal.timeout(10000) })).status, 200);
    console.log('PASS: server has no chat controls or client process; separate client entry works; closing client preserves server.');

    const mobile = launch(['.', '--chat'], { CHAT_CLIENT_SMOKE: 'hold', CHAT_SMOKE_MOBILE: '1' });
    await waitLog('client.log', /CLIENT_NICKNAME_ENTRY true[\s\S]*CLIENT_NICKNAME_ENTRY true/);
    assert.match((await logs('client.log')).split('CLIENT_UI').at(-1), /"loggedIn":true,"overflow":false/);
    await fs.writeFile(path.join(dataDir, 'close-server-window'), 'stop');
    assert.equal(await waitExit(server), 0);
    await serverClosed();
    await waitLog('client.log', /CLIENT_SERVER_CLOSED/);
    assert.equal(mobile.exitCode, null, 'Server must not own/terminate the independent client');
    mobile.kill(); await waitExit(mobile);
    await fs.rm(path.join(dataDir, 'close-server-window'));
    console.log('PASS: closing server stops service; independent client displays server closed; mobile has no overflow.');

    const offline = launch(['.', '--chat'], { CHAT_CLIENT_SMOKE: '1' });
    assert.equal(await waitExit(offline), 0);
    assert.equal((await logs('desktop.log')).match(/SERVER_READY/g).length, 1, 'Client must not start a server');
    const crashed = launch(['.']);
    await waitLog('desktop.log', /SMOKE_SERVER_UI[\s\S]*SMOKE_SERVER_UI/);
    if (process.env.CHAT_TEST_TUNNEL === '1') await waitLog('desktop.log', /PUBLIC_READY[\s\S]*PUBLIC_READY/, 150000);
    crashed.kill(); await waitExit(crashed); await serverClosed();
    console.log('PASS: offline client cannot start server; force-closing server also stops the backend.');
  } finally {
    for (const child of children) if (child.exitCode === null) { child.kill(); await waitExit(child); }
    await new Promise(resolve => setTimeout(resolve, 300));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
