import type { FastifyInstance } from 'fastify';
import webPush from 'web-push';
import { authenticate } from './auth.js';
import db from './db.js';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:2230';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(BASE_URL, VAPID_PUBLIC, VAPID_PRIVATE);
}

export function registerPushRoutes(app: FastifyInstance) {
  // VAPID 공개키 반환 (클라이언트 구독용)
  app.get('/api/push/vapid-key', async () => {
    return { key: VAPID_PUBLIC };
  });

  // 구독 등록
  app.post('/api/push/subscribe', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const { endpoint, keys } = request.body as { endpoint: string; keys: { p256dh: string; auth: string } };

    db.prepare('INSERT OR REPLACE INTO push_subscriptions (userId, endpoint, keys) VALUES (?, ?, ?)').run(userId, endpoint, JSON.stringify(keys));
    return { ok: true };
  });

  // 구독 해제
  app.post('/api/push/unsubscribe', { preHandler: authenticate }, async (request) => {
    const { endpoint } = request.body as { endpoint: string };
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    return { ok: true };
  });
}

// 특정 사용자를 제외한 전체에게 알림 전송
export function sendPushToOthers(excludeUserId: number, title: string, body: string) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const subs = db.prepare('SELECT id, endpoint, keys FROM push_subscriptions WHERE userId != ?').all(excludeUserId) as any[];

  for (const sub of subs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: JSON.parse(sub.keys),
    };

    webPush.sendNotification(pushSubscription, JSON.stringify({ title, body, url: '/' })).catch(() => {
      // 만료된 구독 자동 정리
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
    });
  }
}
