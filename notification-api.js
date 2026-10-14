import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export function notificationAccess(dataDir) {
  const filename = path.join(dataDir, 'notification-api-key.txt');
  let key = process.env.MOEUM_NOTIFICATION_API_KEY;
  if (!key) {
    if (!fs.existsSync(filename)) fs.writeFileSync(filename, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    key = fs.readFileSync(filename, 'utf8').trim();
  }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw new Error('Invalid notification API key configuration.');
  const digest = value => createHash('sha256').update(value).digest();
  const expected = digest(key);
  return (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization || '');
    if (!match || !timingSafeEqual(expected, digest(match[1]))) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '알림 API 인증키를 확인해 주세요.' });
    }
    next();
  };
}

export function automationNotice(payload, instanceId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { code: 'INVALID_REQUEST', error: 'JSON 객체가 필요합니다.' };
  const source = typeof payload.source === 'string' ? payload.source.trim() : '';
  const eventId = typeof payload.eventId === 'string' ? payload.eventId.trim() : '';
  if (!source || source.length > 40 || /[\p{C}]/u.test(source) || !eventId || eventId.length > 128 || /[\p{C}]/u.test(eventId))
    return { code: 'INVALID_REQUEST', error: 'source는 1~40자, eventId는 1~128자로 입력해 주세요.' };
  if (payload.expectedInstanceId !== undefined && payload.expectedInstanceId !== instanceId)
    return { code: 'SERVER_CHANGED', error: '서버가 재시작되었습니다. 현재 실행 ID를 확인해 주세요.' };
  const hash = createHash('sha256').update(JSON.stringify(['automation:v1', source, eventId])).digest('hex').slice(0, 32);
  const clientId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
  return { notice: { clientId, source, title: payload.title, body: payload.body } };
}
