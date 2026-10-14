import express from 'express';
import multer from 'multer';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMedia, MAX_INLINE_MEDIA_SECONDS } from './media-info.js';
import { configurePush } from './push-notifications.js';
import { notificationAccess, automationNotice } from './notification-api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, '.data'));
const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const settingsPath = path.join(dataDir, 'settings.json');
const savedSettings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
const settings = { roomName: savedSettings.roomName || '우리의 대화' };
const historyPath = path.join(dataDir, 'messages.jsonl');
const uploadIndexPath = path.join(dataDir, 'uploads.json');
const uploads = Object.create(null);
const history = [];
let sequence = 0;
function startFreshRoom() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.rmSync(path.join(dataDir, '입장비밀번호.txt'), { force: true });
  const target = path.resolve(uploadDir);
  if (path.dirname(target) !== dataDir || path.basename(target) !== 'uploads') throw new Error('Invalid upload storage path');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(dataDir)) {
    if (name === 'messages.jsonl' || name.startsWith('messages.jsonl.recovery-') || name === 'uploads.json' || name === 'uploads.json.tmp') fs.unlinkSync(path.join(dataDir, name));
  }
  fs.writeFileSync(historyPath, '');
  fs.writeFileSync(uploadIndexPath, '{}');
}
const sessions = new Map();
const instanceId = randomUUID();
const push = configurePush(dataDir);
const requireNotificationKey = notificationAccess(dataDir);
const loginAttempts = new Map();
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const app = express();
app.disable('x-powered-by');
const http = createServer(app);

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
const io = new Server(http, { maxHttpBufferSize: 64 * 1024, allowRequest: (req, done) => done(null, sameOrigin(req)) });
function sessionFor(req) {
  const token = req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith('chat_session='))?.slice(13);
  const session = sessions.get(token);
  if (session && session.expires > Date.now()) return session;
  if (session) sessions.delete(token);
  return null;
}
function requireAuth(req, res, next) {
  req.session = sessionFor(req);
  if (!req.session) return res.status(401).json({ error: '다시 입장해 주세요.' });
  next();
}
function publicUser(session) { return { id: session.id, nickname: session.nickname }; }
function validNickname(value) { return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 20 && !/[\p{C}]/u.test(value); }
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.path.startsWith('/api/') || req.path.startsWith('/files/')) res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return res.status(403).json({ error: '허용되지 않은 요청입니다.' });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (req, res) => res.json({ ok: true, instanceId }));
app.get('/api/info', (req, res) => res.json({ roomName: settings.roomName, maxFileSize: MAX_FILE_SIZE, maxFiles: 10, maxInlineMediaSeconds: MAX_INLINE_MEDIA_SECONDS, pushEnabled: push.enabled }));
app.get('/api/notifications/status', requireNotificationKey, (req, res) => res.json({ ok: true, apiVersion: 1, instanceId, pushEnabled: push.enabled }));
app.post('/api/notifications', requireNotificationKey, async (req, res) => {
  const parsed = automationNotice(req.body, instanceId);
  if (parsed.error) return res.status(parsed.code === 'SERVER_CHANGED' ? 409 : 400).json({ ok: false, ...parsed });
  const result = await publishAnnouncement(parsed.notice);
  if (result.error) {
    const status = result.code === 'RATE_LIMITED' ? 429 : result.code === 'IDEMPOTENCY_CONFLICT' ? 409 : result.code === 'SAVE_FAILED' ? 500 : 400;
    if (status === 429) res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    return res.status(status).json({ ok: false, ...result });
  }
  res.status(result.replayed ? 200 : 201).json({ ok: true, posted: true, messageId: result.message.id, instanceId, pushSent: result.pushSent, warning: result.warning, replayed: Boolean(result.replayed) });
});
app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress;
  const attempt = loginAttempts.get(ip) || { count: 0, until: Date.now() + 60000 };
  if (attempt.until < Date.now()) { attempt.count = 0; attempt.until = Date.now() + 60000; }
  attempt.count++;
  loginAttempts.set(ip, attempt);
  if (attempt.count > 20) return res.status(429).json({ error: '입장 시도가 많습니다. 1분 후 다시 시도해 주세요.' });
  if (!validNickname(req.body.nickname)) return res.status(400).json({ error: '닉네임은 1~20자로 입력해 주세요.' });
  const token = randomBytes(32).toString('hex');
  const session = { id: randomUUID(), nickname: req.body.nickname.trim(), expires: Date.now() + 7 * 86400000 };
  sessions.set(token, session);
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  res.setHeader('Set-Cookie', `chat_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`);
  res.json({ user: publicUser(session) });
});
app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.session) }));
app.post('/api/logout', requireAuth, (req, res) => {
  for (const [token, session] of sessions) if (session === req.session) sessions.delete(token);
  for (const socket of io.sockets.sockets.values()) if (socket.data.session === req.session) socket.disconnect(true);
  res.setHeader('Set-Cookie', 'chat_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/messages', requireAuth, (req, res) => {
  const before = Number(req.query.before) || Infinity;
  const after = Number(req.query.after) || 0;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const matching = history.filter(m => m.seq < before && m.seq > after);
  const messages = after ? matching.slice(0, limit) : matching.slice(-limit);
  res.json({ messages, hasMore: matching.length > limit });
});
app.get('/api/files', requireAuth, (req, res) => {
  const files = history.slice().reverse().flatMap(message => message.attachments.map(file => ({ ...file, nickname: message.nickname, createdAt: message.createdAt })));
  res.json({ files: files.slice(0, 200) });
});
function imageType(filename) {
  const fd = fs.openSync(filename, 'r');
  const head = Buffer.alloc(16);
  try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(head.subarray(0,6).toString())) return 'image/gif';
  if (head.subarray(0,4).toString() === 'RIFF' && head.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null;
}
const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (req, file, cb) => cb(null, randomUUID()) }), limits: { fileSize: MAX_FILE_SIZE, files: 10, fields: 0, parts: 10 } });
app.post('/api/upload', requireAuth, upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: '첨부할 파일을 선택해 주세요.' });
    const files = [];
    for (const file of req.files) {
      let name = file.originalname;
      // Browser multipart names are UTF-8; Multer exposes the header as latin1.
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      if (!decoded.includes('\ufffd')) name = decoded;
      name = path.basename(name.replaceAll('\\', '/')).replace(/[\p{C}]/gu, '').slice(0, 180) || '첨부파일';
      const type = imageType(file.path);
      const media = type ? {} : await inspectMedia(file.path);
      files.push({ id: file.filename, name, size: file.size, type: type || 'application/octet-stream', image: Boolean(type), ...media, owner: req.session.id });
    }
    for (const file of files) uploads[file.id] = file;
    const temp = uploadIndexPath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(uploads));
    fs.renameSync(temp, uploadIndexPath);
    res.json({ files });
  } catch (error) { next(error); }
});
app.get('/files/:id', requireAuth, (req, res) => {
  const file = uploads[req.params.id];
  if (!file || (!file.published && file.owner !== req.session.id)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  const filename = path.join(uploadDir, file.id);
  if (!fs.existsSync(filename)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', `${(file.image || file.inlinePlayable) && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  // Storage is intentionally under .data; only authenticated indexed IDs reach here.
  res.sendFile(filename, { dotfiles: 'allow' });
});
io.use((socket, next) => {
  const session = sessionFor(socket.request);
  if (!session) return next(new Error('AUTH_REQUIRED'));
  socket.data.session = session;
  next();
});
function broadcastPresence() {
  const users = new Map();
  for (const socket of io.sockets.sockets.values()) users.set(socket.data.session.id, publicUser(socket.data.session));
  io.emit('presence', [...users.values()]);
}
io.on('connection', socket => {
  broadcastPresence();
  socket.on('notification:ring', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const session = socket.data.session;
    if (session.expires < Date.now()) return reply({ error: '다시 입장해 주세요.' });
    const result = await push.ring(session.nickname, instanceId);
    if (result.ok) io.emit('notification:ring', { nickname: session.nickname, at: new Date().toISOString() });
    reply(result);
  });
  let sent = [];
  let lastTyping = 0;
  socket.on('typing', () => {
    if (Date.now() - lastTyping < 1000) return;
    lastTyping = Date.now();
    socket.broadcast.emit('typing', publicUser(socket.data.session));
  });
  socket.on('message:send', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const session = socket.data.session;
      if (session.expires < Date.now()) return reply({ error: '입장이 만료되었습니다. 다시 입장해 주세요.' });
      if (!payload || typeof payload.clientId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.clientId)) return reply({ error: '올바르지 않은 메시지입니다.' });
      const duplicate = history.find(m => m.clientId === payload.clientId && m.userId === session.id);
      if (duplicate) return reply({ message: duplicate });
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      const ids = payload.attachments ?? [];
      if (text.length > 5000 || !Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== 'string')) return reply({ error: '메시지는 5,000자, 첨부는 10개까지 가능합니다.' });
      const attachments = [...new Set(ids)].map(id => uploads[id]);
      if (attachments.some(file => !file || file.owner !== session.id)) return reply({ error: '첨부파일을 다시 업로드해 주세요.' });
      if (!text && !attachments.length) return reply({ error: '메시지 또는 파일을 입력해 주세요.' });
      sent = sent.filter(time => time > Date.now() - 10000);
      if (sent.length >= 20) return reply({ error: '잠시 후 다시 전송해 주세요.' });
      const message = { id: randomUUID(), seq: sequence + 1, clientId: payload.clientId, userId: session.id, nickname: session.nickname, text, attachments: attachments.map(({ owner, published, ...file }) => file), createdAt: new Date().toISOString() };
      fs.appendFileSync(historyPath, JSON.stringify(message) + '\n');
      sequence++;
      history.push(message);
      for (const file of attachments) file.published = true;
      sent.push(Date.now());
      io.emit('message', message);
      reply({ message });
    } catch (error) { console.error('Message save failed:', error.message); reply({ error: '저장에 실패했습니다. 다시 시도해 주세요.' }); }
  });
  socket.on('disconnect', broadcastPresence);
});
const announcements = new Map();
let lastAnnouncement = 0;
async function publishAnnouncement(payload) {
  if (!payload || typeof payload.clientId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.clientId)) return { code: 'INVALID_REQUEST', error: '올바르지 않은 공지 요청입니다.' };
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const source = typeof payload.source === 'string' ? payload.source.trim() : '';
  if (!title || title.length > 80 || !body || body.length > 5000) return { code: 'INVALID_REQUEST', error: '제목은 1~80자, 자세한 내용은 1~5,000자로 입력해 주세요.' };
  if (source.length > 40 || /[\p{C}]/u.test(source)) return { code: 'INVALID_REQUEST', error: '올바르지 않은 발송 프로그램 이름입니다.' };
  const signature = JSON.stringify([title, body, source]);
  const existing = announcements.get(payload.clientId);
  if (existing) {
    if (existing.signature !== signature) return { code: 'IDEMPOTENCY_CONFLICT', error: '같은 eventId로 다른 내용을 보낼 수 없습니다.' };
    return { ...await existing.operation, replayed: true };
  }
  const retryAfterMs = 15000 - (Date.now() - lastAnnouncement);
  if (retryAfterMs > 0) return { code: 'RATE_LIMITED', retryAfterMs, error: '공지는 15초 간격으로 보내 주세요.' };
  const operation = (async () => {
    const message = { id: randomUUID(), seq: sequence + 1, clientId: payload.clientId, userId: 'server', nickname: source ? '서버 공지 · ' + source : '서버 공지', kind: 'announcement', title, text: body, source, attachments: [], createdAt: new Date().toISOString() };
    fs.appendFileSync(historyPath, JSON.stringify(message) + '\n');
    sequence++; history.push(message); lastAnnouncement = Date.now();
    io.emit('message', message);
    const result = await push.ring('서버', instanceId, { title, body, messageId: message.id });
    return { message, pushSent: Boolean(result.ok), warning: result.error || '' };
  })().catch(() => {
    announcements.delete(payload.clientId);
    return { code: 'SAVE_FAILED', error: '공지를 저장하지 못했습니다. 다시 시도해 주세요.' };
  });
  announcements.set(payload.clientId, { signature, operation });
  return operation;
}
// Administrative announcements are available only to the local parent process.
if (process.connected) process.on('message', async request => {
  if (request?.type !== 'admin:announcement' || typeof request.requestId !== 'string') return;
  const result = await publishAnnouncement(request.payload);
  if (process.connected) process.send({ type: 'admin:announcement-result', requestId: request.requestId, result });
});
const housekeeping = setInterval(() => {
  // An active native or browser connection lasts until explicit logout or server shutdown.
  for (const socket of io.sockets.sockets.values()) socket.data.session.expires = Date.now() + 7 * 86400000;
  for (const [token, session] of sessions) if (session.expires < Date.now()) sessions.delete(token);
  for (const [ip, attempt] of loginAttempts) if (attempt.until < Date.now()) loginAttempts.delete(ip);
}, 60000);
housekeeping.unref();
app.use(express.static(path.join(root, 'public')));
app.use((error, req, res, next) => {
  console.error(error.message);
  const tooBig = error.code === 'LIMIT_FILE_SIZE';
  if (error.type === 'entity.too.large') return res.status(413).json({ ok: false, code: 'REQUEST_TOO_LARGE', error: '알림 요청 JSON은 32 KiB 이하로 보내 주세요.' });
  res.status(error instanceof multer.MulterError || error.type === 'entity.parse.failed' ? 400 : 500).json({ error: tooBig ? '파일 한 개의 최대 크기는 50MB입니다.' : error instanceof multer.MulterError ? '첨부파일은 한 번에 10개까지 가능합니다.' : '요청을 처리하지 못했습니다. 다시 시도해 주세요.' });
});
const port = Number(process.env.PORT || 3000);
http.listen(port, '127.0.0.1', () => {
  // A failed port bind must never wipe an already-running room.
  startFreshRoom();
  console.log(`Private Chat ready: http://127.0.0.1:${http.address().port}`);
});
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  io.emit('server:closed', { instanceId });
  // Give the explicit shutdown event time to reach connected clients before closing transports.
  setTimeout(() => { io.close(); http.close(() => process.exit(0)); }, 150);
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// A desktop crash or force-close also disconnects IPC; never leave its server running.
if (process.connected) process.on('disconnect', shutdown);
