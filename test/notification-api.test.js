import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

test('automation API authenticates, posts Korean details, deduplicates, limits rate, pins boot and works with the Python client', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'moeum-notify-'));
  const env = { ...process.env, DATA_DIR: dataDir, PORT: '0' };
  delete env.MOEUM_NOTIFICATION_API_KEY; delete env.MOEUM_FIREBASE_CREDENTIALS;
  let child, socket;
  async function stop() { if (child?.exitCode === null) { child.kill(); await once(child, 'exit'); } }
  t.after(async () => { socket?.close(); await stop(); await rm(dataDir, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => stderr += data);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test server startup timed out.')), 10000);
      child.stdout.on('data', data => {
        const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error(stderr)); });
    });
  }
  let base = await start();
  const keyFile = path.join(dataDir, 'notification-api-key.txt');
  const key = (await readFile(keyFile, 'utf8')).trim();
  const health = await (await fetch(base + '/api/health')).json();
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const payload = { source: 'stock-bot', eventId: 'order-001-filled', title: '매수 체결 완료', body: '종목: 테스트 종목\n수량: 2\n가격: 테스트 가격 🙂', expectedInstanceId: health.instanceId };
  const post = body => fetch(base + '/api/notifications', { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/notifications/status')).status, 401);
  assert.equal((await fetch(base + '/api/notifications', { method: 'POST', headers: { ...headers, Authorization: 'Bearer ' + '0'.repeat(64) }, body: JSON.stringify(payload) })).status, 401);
  const status = await (await fetch(base + '/api/notifications/status', { headers })).json();
  assert.equal(status.apiVersion, 1); assert.equal(status.pushEnabled, false);
  assert.equal((await post({ ...payload, source: '' })).status, 400);
  assert.equal((await post({ ...payload, title: 'x'.repeat(81) })).status, 400);
  assert.equal((await post({ ...payload, body: 'x'.repeat(5001) })).status, 400);
  assert.equal((await post({ ...payload, expectedInstanceId: crypto.randomUUID() })).status, 409);
  assert.equal((await post({ ...payload, unused: 'x'.repeat(40000) })).status, 413);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '알림 확인' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/notifications/status', { headers: { Cookie: cookie } })).status, 401);
  socket = io(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false });
  await once(socket, 'connect');
  const receive = once(socket, 'message');
  const first = await post(payload); assert.equal(first.status, 201);
  const accepted = await first.json();
  assert.equal(accepted.posted, true); assert.equal(accepted.pushSent, false); assert.equal(accepted.replayed, false); assert.ok(accepted.warning);
  const [message] = await receive;
  assert.equal(message.title, payload.title); assert.equal(message.text, payload.body);
  assert.equal(message.nickname, '서버 공지 · stock-bot'); assert.equal(message.kind, 'announcement');
  const retry = await post(payload); assert.equal(retry.status, 200);
  const replay = await retry.json(); assert.equal(replay.messageId, accepted.messageId); assert.equal(replay.replayed, true);
  const conflict = await post({ ...payload, body: '다른 내용' }); assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'IDEMPOTENCY_CONFLICT');
  const limited = await post({ ...payload, eventId: 'next-order' }); assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await limited.json()).code, 'RATE_LIMITED');
  const python = await promisify(execFile)('python', ['examples/moeum_notify.py', '--server', base,
    '--source', payload.source, '--event-id', payload.eventId, '--title', payload.title, '--body', payload.body,
    '--instance-id', health.instanceId], { env: { ...process.env, MOEUM_NOTIFY_KEY_FILE: keyFile, MOEUM_NOTIFY_KEY: '', PYTHONIOENCODING: 'utf-8' }, timeout: 10000 });
  const pythonResult = JSON.parse(python.stdout);
  assert.equal(pythonResult.messageId, accepted.messageId); assert.equal(pythonResult.replayed, true);
  const history = await (await fetch(base + '/api/messages', { headers: { Cookie: cookie } })).json();
  assert.equal(history.messages.length, 1);
  socket.close(); await stop(); base = await start();
  assert.equal((await readFile(keyFile, 'utf8')).trim(), key, 'Notification key must survive room restart');
  const changed = await post(payload); assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, 'SERVER_CHANGED');
  const newBoot = await (await fetch(base + '/api/health')).json();
  assert.notEqual(newBoot.instanceId, health.instanceId);
  const newEvent = await post({ ...payload, eventId: 'new-boot-order', expectedInstanceId: newBoot.instanceId });
  assert.equal(newEvent.status, 201);
});
