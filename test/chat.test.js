import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, appendFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { io } from 'socket.io-client';

test('authenticated chat, files, retry deduplication and a fresh room on every server start', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'moeum-test-'));
  let child;
  const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.close()); if (child?.exitCode === null) { child.kill(); await once(child, 'exit'); } await rm(dataDir, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: '0', DATA_DIR: dataDir, CHAT_PASSWORD: 'test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => stderr += data);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out: ' + stderr)), 10000);
      child.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error(stderr)); });
    });
  }
  let base = await start();
  async function login(nickname) {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, password: 'test-secret' }) });
    assert.equal(response.status, 200); return { cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()) };
  }
  async function connect(cookie) {
    const socket = io(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false }); sockets.push(socket);
    await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; })]); return socket;
  }
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + '/api/messages')).status, 401);
  const rejected = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '손님', password: 'wrong' }) });
  assert.equal(rejected.status, 403);
  const crossOrigin = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(crossOrigin.status, 403);
  const alice = await login('메인PC'), bob = await login('친구');
  const a = await connect(alice.cookie), b = await connect(bob.cookie);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7mUAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('files', new Blob([png], { type: 'image/png' }), '사진.png'); form.append('files', new Blob(['<script>alert(1)</script>'], { type: 'image/svg+xml' }), 'test.svg');
  const upload = await fetch(base + '/api/upload', { method: 'POST', headers: { Cookie: alice.cookie }, body: form });
  assert.equal(upload.status, 200); const { files } = await upload.json();
  assert.equal(files[0].name, '사진.png'); assert.equal(files[0].image, true); assert.equal(files[1].image, false);
  assert.equal((await fetch(base + '/files/' + files[0].id, { headers: { Cookie: bob.cookie } })).status, 404);
  const unauthorizedFile = await b.emitWithAck('message:send', { clientId: crypto.randomUUID(), text: 'file theft', attachments: [files[0].id] });
  assert.ok(unauthorizedFile.error);
  const payload = { clientId: crypto.randomUUID(), text: '<img src=x onerror=alert(1)> 안녕하세요', attachments: files.map(file => file.id) };
  const received = once(b, 'message');
  const result = await a.emitWithAck('message:send', payload);
  assert.ok(result.message); assert.equal((await received)[0].id, result.message.id);
  const duplicate = await a.emitWithAck('message:send', payload); assert.equal(duplicate.message.id, result.message.id);
  const messages = await (await fetch(base + '/api/messages', { headers: { Cookie: bob.cookie } })).json(); assert.equal(messages.messages.length, 1);
  const imageResponse = await fetch(base + '/files/' + files[0].id, { headers: { Cookie: bob.cookie } });
  assert.equal(imageResponse.status, 200); assert.equal(imageResponse.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
  const svgResponse = await fetch(base + '/files/' + files[1].id, { headers: { Cookie: bob.cookie } });
  assert.match(svgResponse.headers.get('content-disposition'), /^attachment/); assert.equal(svgResponse.headers.get('content-type'), 'application/octet-stream');
  const large = await a.emitWithAck('message:send', { clientId: crypto.randomUUID(), text: 'a'.repeat(5001), attachments: [] }); assert.ok(large.error);
  const after = await (await fetch(base + '/api/messages?after=1', { headers: { Cookie: alice.cookie } })).json(); assert.equal(after.messages.length, 0);
  assert.equal((await fetch(base + '/files/' + files[0].id)).status, 401);
  const logout = await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: bob.cookie } }); assert.equal(logout.status, 200);
  assert.equal((await fetch(base + '/api/messages', { headers: { Cookie: bob.cookie } })).status, 401);
  assert.match(await readFile(path.join(dataDir, 'messages.jsonl'), 'utf8'), /안녕하세요/);
  const collision = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: new URL(base).port, DATA_DIR: dataDir }, stdio: 'ignore' });
  assert.notEqual((await once(collision, 'exit'))[0], 0);
  assert.match(await readFile(path.join(dataDir, 'messages.jsonl'), 'utf8'), /안녕하세요/);
  assert.deepEqual(await readFile(path.join(dataDir, 'uploads', files[0].id)), png);
  a.close(); b.close(); child.kill(); await once(child, 'exit');
  await appendFile(path.join(dataDir, 'messages.jsonl'), '{"partial":');
  await writeFile(path.join(dataDir, 'messages.jsonl.recovery-old'), 'old recovered messages');
  base = await start(); const returning = await login('메인PC');
  const fresh = await (await fetch(base + '/api/messages', { headers: { Cookie: returning.cookie } })).json();
  assert.deepEqual(fresh.messages, []);
  assert.equal((await fetch(base + '/files/' + files[0].id, { headers: { Cookie: returning.cookie } })).status, 404);
  assert.deepEqual(await readdir(path.join(dataDir, 'uploads')), []);
  assert.equal(await readFile(path.join(dataDir, 'messages.jsonl'), 'utf8'), '');
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'uploads.json'), 'utf8')), {});
  assert.ok(!(await readdir(dataDir)).includes('messages.jsonl.recovery-old'));
});
