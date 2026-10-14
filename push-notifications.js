import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export const PUSH_TOPIC = 'moeum-room';
export function ringMessage(nickname, instanceId, notice) {
  const message = { topic: PUSH_TOPIC + '-' + instanceId,
    notification: { title: '모음 채팅 · 알림', body: `${nickname} 님이 알림을 울렸어요. 채팅방에 들어와 주세요.` },
    data: { action: 'ring', instanceId },
    android: { priority: 'high', ttl: 60000, collapseKey: 'moeum-ring',
      notification: { channelId: 'moeum_ring', sound: 'default', tag: 'moeum-ring', defaultVibrateTimings: true } } };
  if (notice) {
    const summary = Array.from(notice.body).slice(0, 160).join('');
    message.notification = { title: notice.title, body: summary + (summary.length < notice.body.length ? '…' : '') };
    message.data.messageId = notice.messageId;
  }
  return message;
}
export function createRingController({ send, clock = Date.now, cooldownMs = 15000 }) {
  let nextAllowed = 0, sending = false;
  return async (nickname, instanceId, notice) => {
    if (!send) return { error: '모바일 알림 설정을 준비 중입니다.' };
    if (sending || clock() < nextAllowed) return { error: '잠시 후 다시 알림을 울려 주세요.' };
    sending = true;
    try {
      await send(ringMessage(nickname, instanceId, notice));
      nextAllowed = clock() + cooldownMs;
      return { ok: true, cooldownMs };
    } catch { return { error: '알림을 보내지 못했습니다. 서버의 알림 연결을 확인해 주세요.' }; }
    finally { sending = false; }
  };
}
export function configurePush(dataDir) {
  const credentialFile = process.env.MOEUM_FIREBASE_CREDENTIALS || path.join(dataDir, 'firebase-service-account.json');
  if (!fs.existsSync(credentialFile)) return { enabled: false, ring: createRingController({}) };
  try {
    const key = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
    const firebase = initializeApp({ credential: cert(key) }, 'moeum-' + randomUUID());
    return { enabled: true, ring: createRingController({ send: message => getMessaging(firebase).send(message) }) };
  } catch {
    console.error('Mobile push configuration could not be loaded.');
    return { enabled: false, ring: createRingController({}) };
  }
}
