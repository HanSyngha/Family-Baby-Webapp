import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import db from '../db.js';

export function registerUserRoutes(app: FastifyInstance) {
  // 전체 사용자 목록 + 활동 통계 (master만)
  app.get('/api/users', { preHandler: authenticate }, async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'master') return reply.code(403).send({ error: 'Forbidden' });

    const users = db.prepare(`
      SELECT u.id, u.name, u.profileImage, u.role, u.provider, u.createdAt, u.banned,
        (SELECT COUNT(*) FROM media WHERE uploaderId = u.id) as uploadCount,
        (SELECT COUNT(*) FROM views WHERE userId = u.id) as viewCount,
        (SELECT COUNT(*) FROM downloads WHERE userId = u.id) as downloadCount,
        (SELECT COUNT(*) FROM likes WHERE userId = u.id) as likeCount,
        (SELECT COUNT(*) FROM comments WHERE userId = u.id) as commentCount
      FROM users u
      ORDER BY u.createdAt ASC
    `).all();

    return users;
  });

  // 사용자 차단/해제 (master만)
  app.post('/api/users/:id/ban', { preHandler: authenticate }, async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'master') return reply.code(403).send({ error: 'Forbidden' });

    const targetId = parseInt((request.params as { id: string }).id);
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId) as any;
    if (!target) return reply.code(404).send({ error: 'Not found' });
    if (target.role === 'master') return reply.code(400).send({ error: 'Cannot ban master' });

    const { banned } = request.body as { banned: boolean };
    db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, targetId);
    return { ok: true };
  });

  // 사용자 삭제 (master만)
  app.delete('/api/users/:id', { preHandler: authenticate }, async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'master') return reply.code(403).send({ error: 'Forbidden' });

    const targetId = parseInt((request.params as { id: string }).id);
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId) as any;
    if (!target) return reply.code(404).send({ error: 'Not found' });
    if (target.role === 'master') return reply.code(400).send({ error: 'Cannot delete master' });

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    return { ok: true };
  });

  // 관리자 패널: 사용자 목록 + 통계 (master만)
  app.get('/api/admin/users', { preHandler: authenticate }, async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'master') return reply.code(403).send({ error: 'Forbidden' });

    const users = db.prepare(`
      SELECT u.id, u.name, u.profileImage, u.role, u.provider, u.createdAt, u.banned,
        (SELECT COUNT(*) FROM media WHERE uploaderId = u.id) as mediaCount,
        (SELECT COUNT(*) FROM comments WHERE userId = u.id) as commentCount,
        (SELECT COUNT(*) FROM feedings WHERE recorderId = u.id) as feedingCount,
        (SELECT COUNT(*) FROM sleeps WHERE recorderId = u.id) as sleepCount,
        (SELECT MAX(v.createdAt) FROM views v WHERE v.userId = u.id) as lastActive
      FROM users u
      ORDER BY u.createdAt DESC
    `).all();

    return users;
  });

  // 관리자 패널: 최근 활동 로그 (master만)
  app.get('/api/admin/activity', { preHandler: authenticate }, async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'master') return reply.code(403).send({ error: 'Forbidden' });

    const activities = db.prepare(`
      SELECT * FROM (
        SELECT 'upload' as action, m.uploaderId as userId, u.name as userName, u.profileImage,
          m.originalName as detail, m.createdAt
        FROM media m JOIN users u ON m.uploaderId = u.id
        UNION ALL
        SELECT 'comment' as action, c.userId, u.name, u.profileImage,
          c.content as detail, c.createdAt
        FROM comments c JOIN users u ON c.userId = u.id
        UNION ALL
        SELECT 'feeding' as action, f.recorderId as userId, u.name, u.profileImage,
          CASE WHEN f.type='formula' THEN '분유 ' || f.amountMl || 'ml' ELSE '모유 (' || COALESCE(f.side,'') || ')' END as detail,
          f.createdAt
        FROM feedings f JOIN users u ON f.recorderId = u.id
        UNION ALL
        SELECT 'sleep' as action, s.recorderId as userId, u.name, u.profileImage,
          '수면 ' || COALESCE(s.durationSec/60, 0) || '분' as detail, s.createdAt
        FROM sleeps s JOIN users u ON s.recorderId = u.id
        UNION ALL
        SELECT 'calendar' as action, ce.creatorId as userId, u.name, u.profileImage,
          ce.title as detail, ce.createdAt
        FROM calendar_events ce JOIN users u ON ce.creatorId = u.id
        UNION ALL
        SELECT 'todo' as action, t.creatorId as userId, u.name, u.profileImage,
          t.title as detail, t.createdAt
        FROM todos t JOIN users u ON t.creatorId = u.id
        UNION ALL
        SELECT 'note' as action, n.creatorId as userId, u.name, u.profileImage,
          n.title as detail, n.createdAt
        FROM notes n JOIN users u ON n.creatorId = u.id
      )
      ORDER BY createdAt DESC
      LIMIT 50
    `).all();

    return activities;
  });
}
