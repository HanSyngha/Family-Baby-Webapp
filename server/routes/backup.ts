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
