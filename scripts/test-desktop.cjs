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
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  let child;
  try {
    const desktopEnv = { ...process.env, CHAT_DESKTOP_SMOKE: '1', DATA_DIR: dataDir, PORT: String(port) };
    delete desktopEnv.ELECTRON_RUN_AS_NODE;
    child = spawn(electron, ['.'], { cwd: path.resolve(__dirname, '..'), env: desktopEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => stderr += data);
    let testedUrl;
    let remoteSocket;
    if (process.env.CHAT_TEST_TUNNEL === '1') {
      child.stdout.on('data', () => {});
      // The app owns a short-lived public route against the isolated test data.
      for (let attempt = 0; attempt < 1200; attempt++) {
        const runningLogs = await fs.readFile(path.join(dataDir, 'desktop.log'), 'utf8').catch(() => '');
        const match = runningLogs.match(/PUBLIC_READY (https:\/\/[^\s]+)/);
        if (match) {
          testedUrl = match[1];
          const response = await fetch(testedUrl + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: testedUrl }, body: JSON.stringify({ nickname: '외부 검증' }), signal: AbortSignal.timeout(10000) });
          assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie').split(';')[0];
          remoteSocket = io(testedUrl, { extraHeaders: { Cookie: cookie, Origin: testedUrl }, transports: ['websocket'], reconnection: false, timeout: 10000 });
          await Promise.race([once(remoteSocket, 'connect'), once(remoteSocket, 'connect_error').then(([error]) => { throw error; })]);
          const result = await remoteSocket.timeout(10000).emitWithAck('message:send', { clientId: crypto.randomUUID(), text: '외부 접속 실시간 전송 검증', attachments: [] });
          assert.ok(result.message); remoteSocket.close();
          await fs.writeFile(path.join(dataDir, 'public-test-complete'), 'ok');
          console.log('PASS: public HTTPS login and real-time WebSocket message.'); break;
        }
        if (child.exitCode !== null) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(testedUrl, 'Public URL must be reachable');
    }
    const timer = setTimeout(() => child.kill(), 30000);
    const [code] = await once(child, 'exit'); clearTimeout(timer);
    const logs = await fs.readFile(path.join(dataDir, 'desktop.log'), 'utf8').catch(() => { throw new Error('Desktop did not initialize. Exit ' + code + ': ' + stderr); });
    assert.equal(code, 0, stderr + '\n' + logs);
    assert.match(logs, /SERVER_READY/); assert.match(logs, /WINDOW_READY/);
    assert.match(logs, /SMOKE_SERVER_ONLY .*"chatOpen":false/);
    assert.match(logs, /SMOKE_NICKNAME_ENTRY true/);
    assert.match(logs, /SMOKE_UI .*"loggedIn":true/);
    assert.match(logs, /SMOKE_UI .*"overflow":false/);
    assert.match(logs, /SERVER_WINDOW_READY/);
    assert.match(logs, /CHAT_WINDOW_CLOSE/); assert.match(logs, /SERVER_WINDOW_CLOSE/); assert.match(logs, /SERVER_STOP_REQUEST/);
    assert.match(logs, /SMOKE_CHAT_CLOSED .*"serverAlive":true,"serverWindowOpen":true,"externalAlive":true/);
    assert.match(logs, /SMOKE_SERVER_UI .*"hasChatControl":true,"hasStopControl":true,"overflow":false/);
    assert.match(logs, /SMOKE_CHAT_REOPENED true/);
    let closed = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { closed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(closed, 'Server must stop when the server window closes');
    if (process.env.CHAT_TEST_TUNNEL === '1') {
      const connectorId = Number(await fs.readFile(path.join(dataDir, 'connector-pid.txt'), 'utf8'));
      await assertStopped(connectorId);
      await assertNoAddress(dataDir);
      console.log('PASS: closing the server window also terminates the external connector.');
    }
    console.log('PASS: separate server and chat windows; closing/reopening chat preserves the server; closing server stops it.');
    desktopEnv.CHAT_DESKTOP_SMOKE = 'hold'; desktopEnv.CHAT_SMOKE_MOBILE = '1';
    delete desktopEnv.CHAT_SCREENSHOT_PATH;
    child = spawn(electron, ['.'], { cwd: path.resolve(__dirname, '..'), env: desktopEnv, windowsHide: true, stdio: 'ignore' });
    let ready = false;
    for (let attempt = 0; attempt < (process.env.CHAT_TEST_TUNNEL === '1' ? 1200 : 100); attempt++) {
      const currentLogs = await fs.readFile(path.join(dataDir, 'desktop.log'), 'utf8');
      if ((currentLogs.match(/SMOKE_UI/g) || []).length === 2) { assert.match(currentLogs.split('SMOKE_UI').at(-1), /"loggedIn":true.*"overflow":false/); ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Mobile window must be ready');
    child.kill(); await once(child, 'exit');
    let orphanStopped = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { orphanStopped = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(orphanStopped, 'Server must also stop if the desktop process is force-killed');
    if (process.env.CHAT_TEST_TUNNEL === '1') {
      const connectorId = Number(await fs.readFile(path.join(dataDir, 'connector-pid.txt'), 'utf8'));
      await assertStopped(connectorId);
      console.log('PASS: force-closing desktop also terminates the external connector.');
    }
    console.log('PASS: mobile window has no overflow; force-closing desktop also stops the server through IPC disconnect.');
    const closedLaunch = spawn(electron, ['.', '--chat'], { cwd: path.resolve(__dirname, '..'), env: desktopEnv, windowsHide: true, stdio: 'ignore' });
    await once(closedLaunch, 'exit');
    const closedLogs = await fs.readFile(path.join(dataDir, 'desktop.log'), 'utf8');
    assert.match(closedLogs, /CHAT_SERVER_CLOSED/);
    assert.equal((closedLogs.match(/SERVER_READY/g) || []).length, 2, 'Chat launcher must not start a server');
    console.log('PASS: server launcher starts only server UI; chat launcher cannot start a closed server.');
  } finally { if (child && child.exitCode === null) child.kill(); await fs.rm(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
async function assertStopped(pid) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('External connector must be stopped: ' + pid);
}
async function assertNoAddress(dataDir) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await fs.access(path.join(dataDir, '공유주소.txt')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('The stopped server must remove its expired public address.');
}
