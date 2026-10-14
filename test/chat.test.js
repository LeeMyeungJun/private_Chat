import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, appendFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { io } from 'socket.io-client';

test('nickname-only entry, files, retry deduplication and a fresh room on every server start', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), '.moeum-test-'));
  let child;
  const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.close()); if (child?.exitCode === null) { child.kill(); await once(child, 'exit'); } await rm(dataDir, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: '0', DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stderr = ''; child.stderr.on('data', data => stderr += data);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out: ' + stderr)), 10000);
      child.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error(stderr)); });
    });
  }
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ roomName: '우리의 대화', salt: 'legacy', passwordHash: 'legacy' }));
  await writeFile(path.join(dataDir, '입장비밀번호.txt'), 'obsolete-secret');
  let base = await start();
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8')), { roomName: '우리의 대화' });
  assert.ok(!(await readdir(dataDir)).includes('입장비밀번호.txt'));
  async function login(nickname) {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }) });
    assert.equal(response.status, 200); return { cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()) };
  }
  async function connect(cookie) {
    const socket = io(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false }); sockets.push(socket);
    await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; })]); return socket;
  }
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.ok(!(await page.text()).includes('id="password"'));
  assert.equal((await fetch(base + '/api/messages')).status, 401);
  const rejected = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '' }) });
  assert.equal(rejected.status, 400);
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
  function wav(seconds) {
    const length = 8000 * seconds, data = Buffer.alloc(44 + length, 128);
    data.write('RIFF', 0); data.writeUInt32LE(36 + length, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(8000, 28);
    data.writeUInt16LE(1, 32); data.writeUInt16LE(8, 34); data.write('data', 36); data.writeUInt32LE(length, 40); return data;
  }
  const audioForm = new FormData();
  audioForm.append('files', new Blob([wav(2)], { type: 'audio/wav' }), 'short.wav');
  audioForm.append('files', new Blob([wav(600)], { type: 'audio/wav' }), 'ten-minutes.wav');
  audioForm.append('files', new Blob([wav(601)], { type: 'audio/wav' }), 'long.wav');
  audioForm.append('files', new Blob(['<script>alert(1)</script>'], { type: 'audio/mpeg' }), 'fake.mp3');
  audioForm.append('files', new Blob([await readFile('test/fixtures/short.mp3')], { type: 'audio/mpeg' }), 'short.mp3');
  audioForm.append('files', new Blob([await readFile('test/fixtures/short.mp4')], { type: 'video/mp4' }), 'short.mp4');
  const audioUpload = await fetch(base + '/api/upload', { method: 'POST', headers: { Cookie: alice.cookie }, body: audioForm });
  assert.equal(audioUpload.status, 200); const { files: audioFiles } = await audioUpload.json();
  assert.equal(audioFiles[0].media, 'audio'); assert.equal(audioFiles[0].duration, 2); assert.equal(audioFiles[0].inlinePlayable, true);
  assert.equal(audioFiles[1].duration, 600); assert.equal(audioFiles[1].inlinePlayable, true);
  assert.equal(audioFiles[2].duration, 601); assert.equal(audioFiles[2].inlinePlayable, false);
  assert.equal(audioFiles[3].type, 'application/octet-stream'); assert.ok(!audioFiles[3].inlinePlayable);
  assert.equal(audioFiles[4].media, 'audio'); assert.equal(audioFiles[4].inlinePlayable, true); assert.ok(audioFiles[4].duration > 0 && audioFiles[4].duration < 2);
  assert.equal(audioFiles[5].media, 'video'); assert.equal(audioFiles[5].inlinePlayable, true); assert.ok(audioFiles[5].duration > 0 && audioFiles[5].duration < 2);
  assert.equal((await fetch(base + '/files/' + audioFiles[0].id, { headers: { Cookie: bob.cookie } })).status, 404);
  const audioMessage = await a.emitWithAck('message:send', { clientId: crypto.randomUUID(), text: '', attachments: audioFiles.map(f => f.id) });
  assert.equal(audioMessage.message.attachments[0].inlinePlayable, true);
  const range = await fetch(base + '/files/' + audioFiles[0].id, { headers: { Cookie: bob.cookie, Range: 'bytes=0-43' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-type'), 'audio/wav'); assert.match(range.headers.get('content-disposition'), /^inline/);
  assert.equal((await range.arrayBuffer()).byteLength, 44);
  const download = await fetch(base + '/files/' + audioFiles[0].id + '?download=1', { headers: { Cookie: bob.cookie } }); assert.match(download.headers.get('content-disposition'), /^attachment/);
  const longAudio = await fetch(base + '/files/' + audioFiles[2].id, { headers: { Cookie: bob.cookie } }); assert.match(longAudio.headers.get('content-disposition'), /^attachment/);
  const mp4Range = await fetch(base + '/files/' + audioFiles[5].id, { headers: { Cookie: bob.cookie, Range: 'bytes=0-31' } });
  assert.equal(mp4Range.status, 206); assert.equal(mp4Range.headers.get('content-type'), 'video/mp4'); assert.match(mp4Range.headers.get('content-disposition'), /^inline/);
  assert.deepEqual(Buffer.from(await mp4Range.arrayBuffer()), (await readFile('test/fixtures/short.mp4')).subarray(0, 32));
  const large = await a.emitWithAck('message:send', { clientId: crypto.randomUUID(), text: 'a'.repeat(5001), attachments: [] }); assert.ok(large.error);
  const after = await (await fetch(base + '/api/messages?after=2', { headers: { Cookie: alice.cookie } })).json(); assert.equal(after.messages.length, 0);
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
  const member = await connect(returning.cookie);
  const payloadNotice = { clientId: crypto.randomUUID(), title: '서버 안내', body: '<script>실행되지 않는 공지</script>\n자세한 내용입니다.' };
  const noticeDelivered = once(member, 'message');
  async function announce(payload) {
    const requestId = crypto.randomUUID(); const reply = once(child, 'message');
    child.send({ type: 'admin:announcement', requestId, payload });
    const [response] = await reply; assert.equal(response.requestId, requestId); return response.result;
  }
  const notice = await announce(payloadNotice);
  assert.equal(notice.message.kind, 'announcement'); assert.equal(notice.message.nickname, '서버 공지');
  assert.equal(notice.message.title, payloadNotice.title); assert.equal(notice.message.text, payloadNotice.body);
  assert.equal((await noticeDelivered)[0].id, notice.message.id);
  assert.equal(notice.pushSent, false); assert.ok(notice.warning);
  assert.equal((await announce(payloadNotice)).message.id, notice.message.id);
  const persisted = await (await fetch(base + '/api/messages', { headers: { Cookie: returning.cookie } })).json();
  assert.equal(persisted.messages.length, 1); assert.equal(persisted.messages[0].title, payloadNotice.title);
  assert.ok((await announce({ clientId: crypto.randomUUID(), title: '', body: 'invalid' })).error);
  assert.equal((await fetch(base + '/api/admin/announcement', { method: 'POST', headers: { Cookie: returning.cookie } })).status, 404);
});
