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
}
