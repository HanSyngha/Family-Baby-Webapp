import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import db from '../db.js';

/**
 * 폰 백업 진행률.
 *
 * 분모(폰에 있는 장수)는 서버가 알 수 없는 숫자라 안드로이드 앱이 보고한다.
 * 분자(done)는 앱이 해시로 서버에 물어 '원본이 있다'가 확인된 개수 —
 * 앱이 올렸다고 주장하는 수가 아니라 실제 대조 결과다.
 */
export function registerBackupRoutes(app: FastifyInstance) {
  // 앱 → 서버 보고 (백업 워커가 회차마다 호출)
  app.post('/api/backup/progress', { preHandler: authenticate }, async (request, reply) => {
    const { userId, role } = (request as any).user;
    if (role !== 'master') return reply.code(403).send({ error: 'master only' });

    const b = (request.body || {}) as Record<string, unknown>;
    const num = (v: unknown) => {
      const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    };
    const deviceName = String(b.deviceName || 'Android').slice(0, 60);

    db.prepare(`
      INSERT INTO backup_progress (userId, deviceName, photoTotal, photoDone, videoTotal, videoDone, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+9 hours'))
      ON CONFLICT(userId, deviceName) DO UPDATE SET
        photoTotal = excluded.photoTotal,
        photoDone  = excluded.photoDone,
        videoTotal = excluded.videoTotal,
        videoDone  = excluded.videoDone,
        updatedAt  = excluded.updatedAt
    `).run(userId, deviceName, num(b.photoTotal), num(b.photoDone), num(b.videoTotal), num(b.videoDone));

    return { ok: true };
  });

  // 앱 → 서버 일괄 대조: (파일명, 바이트 크기)가 같은 원본이 서버에 있는지.
  // 앱을 새로 깔면 대조 기록이 비어, 수만 장을 한 장씩 해싱·질의하느라 며칠이 걸렸다(0%에 멈춘 듯 보임).
  // 폰 파일명은 촬영 시각이라 크기까지 같으면 사실상 같은 파일이다. 안 맞는 것만 앱이 해시로 다시 확인한다.
  app.post('/api/backup/match', { preHandler: authenticate }, async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'master') return reply.code(403).send({ error: 'master only' });

    const items = (request.body as any)?.items;
    if (!Array.isArray(items) || items.length > 1000) return reply.code(400).send({ error: 'items: 최대 1000개 배열' });

    const stmt = db.prepare('SELECT 1 FROM media WHERE originalName = ? AND size = ? LIMIT 1');
    const found: number[] = [];
    items.forEach((it: any, i: number) => {
      if (typeof it?.name === 'string' && Number.isFinite(it?.size) && stmt.get(it.name, it.size)) found.push(i);
    });
    request.log.info({ asked: items.length, found: found.length }, 'backup match');
    return { found };
  });

  // 웹 홈 → 내 기기 진행률. 폰이 여러 대면 가장 최근에 보고한 기기.
  app.get('/api/backup/progress', { preHandler: authenticate }, async (request) => {
    const { userId, role } = (request as any).user;
    if (role !== 'master') return { reported: false };

    const row = db.prepare(`
      SELECT deviceName, photoTotal, photoDone, videoTotal, videoDone, updatedAt
      FROM backup_progress WHERE userId = ?
      ORDER BY updatedAt DESC LIMIT 1
    `).get(userId) as any;

    if (!row) return { reported: false };
    return { reported: true, ...row };
  });
}
