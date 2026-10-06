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
export function sendPushToOthers(excludeUserId: number, title: string, body: string, url = '/') {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const subs = db.prepare('SELECT id, endpoint, keys FROM push_subscriptions WHERE userId != ?').all(excludeUserId) as any[];

  for (const sub of subs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: JSON.parse(sub.keys),
    };

    webPush.sendNotification(pushSubscription, JSON.stringify({ title, body, url })).catch(() => {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
    });
  }
}

// 전체 사용자에게 알림 전송 (예측 알림 등)
export function sendPushToAll(title: string, body: string, url = '/') {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const subs = db.prepare('SELECT id, endpoint, keys FROM push_subscriptions').all() as any[];

  for (const sub of subs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: JSON.parse(sub.keys),
    };

    webPush.sendNotification(pushSubscription, JSON.stringify({ title, body, url })).catch(() => {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
    });
  }
}

// 한 사람에게만 알림 전송 (이민 탭처럼 다른 사람에게 새면 안 되는 알림용).
// 구독이 만료(404/410)된 것만 지운다 — 일시적 네트워크 오류로 구독을 잃지 않게.
export async function sendPushToUser(userId: number, title: string, body: string, url = '/', tag = 'notification') {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { sent: 0, failed: 0, subs: 0 };

  const subs = db.prepare('SELECT id, endpoint, keys FROM push_subscriptions WHERE userId = ?').all(userId) as any[];
  let sent = 0;
  let failed = 0;
  await Promise.all(subs.map(async (sub) => {
    try {
      await webPush.sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys) }, JSON.stringify({ title, body, url, tag }));
      sent++;
    } catch (err: any) {
      failed++;
      console.warn(`[Push] user=${userId} sub=${sub.id} 실패 status=${err?.statusCode ?? '?'}`);
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }));
  return { sent, failed, subs: subs.length };
}

// 유저 이름 조회 헬퍼
export function getUserName(userId: number): string {
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string } | undefined;
  return user?.name || '누군가';
}
