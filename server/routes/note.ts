import type { FastifyInstance, FastifyRequest } from 'fastify';
import db from '../db.js';
import { authenticate } from '../auth.js';
import { sendPushToOthers, getUserName } from '../push.js';
import { polishText } from '../llm-client.js';

interface TopicRow {
  id: number;
  creatorId: number;
  name: string;
  icon: string;
  isPrivate: number;
  sortOrder: number;
  createdAt: string;
  creatorName: string;
  creatorImage: string | null;
}

interface NoteRow {
  id: number;
  topicId: number;
  creatorId: number;
  title: string;
  content: string;
  todoId: number | null;
  isPrivate: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  creatorName: string;
  creatorImage: string | null;
  topicName: string;
}

export function registerNoteRoutes(app: FastifyInstance) {
  // ============================================================
  // 토픽
  // ============================================================

  // 토픽 목록
  app.get('/api/notes/topics', { preHandler: authenticate }, async (request: FastifyRequest) => {
    const userId = (request as any).user.userId;

    const topics = db.prepare(`
      SELECT nt.*, u.name as creatorName, u.profileImage as creatorImage,
        (SELECT COUNT(*) FROM notes n WHERE n.topicId = nt.id
          AND (n.isPrivate = 0 OR n.creatorId = ?)) as noteCount
      FROM note_topics nt
      JOIN users u ON nt.creatorId = u.id
      WHERE nt.isPrivate = 0 OR nt.creatorId = ?
      ORDER BY nt.sortOrder, nt.createdAt
    `).all(userId, userId) as (TopicRow & { noteCount: number })[];

    return topics.map(t => ({ ...t, isPrivate: !!t.isPrivate }));
  });

  // 토픽 생성
  app.post('/api/notes/topics', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const body = request.body as any;
    const { name, icon, isPrivate, sortOrder } = body;

    const result = db.prepare(`
      INSERT INTO note_topics (creatorId, name, icon, isPrivate, sortOrder)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, name, icon || '📝', isPrivate ? 1 : 0, sortOrder || 0);

    console.log(`[Note] Topic created: "${name}" by userId=${userId}`);

    const topic = db.prepare(`
      SELECT nt.*, u.name as creatorName, u.profileImage as creatorImage
      FROM note_topics nt JOIN users u ON nt.creatorId = u.id WHERE nt.id = ?
    `).get(result.lastInsertRowid) as TopicRow;

    return { ...topic, isPrivate: !!topic.isPrivate };
  });

  // 토픽 수정
  app.put('/api/notes/topics/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const topicId = Number(id);
    const userId = (request as any).user.userId;
    const body = request.body as any;

    const existing = db.prepare('SELECT id, isPrivate, creatorId FROM note_topics WHERE id = ?').get(topicId) as { id: number; isPrivate: number; creatorId: number } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Topic not found' });
    if (existing.isPrivate && existing.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private topic' });
    }

    const fields: string[] = [];
    const values: any[] = [];

    for (const key of ['name', 'icon'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
    }
    if (body.isPrivate !== undefined) { fields.push('isPrivate = ?'); values.push(body.isPrivate ? 1 : 0); }
    if (body.sortOrder !== undefined) { fields.push('sortOrder = ?'); values.push(body.sortOrder); }

    if (fields.length > 0) {
      db.prepare(`UPDATE note_topics SET ${fields.join(', ')} WHERE id = ?`).run(...values, topicId);
    }

    console.log(`[Note] Topic updated: id=${topicId}`);

    const topic = db.prepare(`
      SELECT nt.*, u.name as creatorName, u.profileImage as creatorImage
      FROM note_topics nt JOIN users u ON nt.creatorId = u.id WHERE nt.id = ?
    `).get(topicId) as TopicRow;

    return { ...topic, isPrivate: !!topic.isPrivate };
  });

  // 토픽 삭제 (CASCADE로 하위 노트도 삭제)
  app.delete('/api/notes/topics/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).user.userId;
    const existing = db.prepare('SELECT id, isPrivate, creatorId, name FROM note_topics WHERE id = ?').get(Number(id)) as { id: number; isPrivate: number; creatorId: number; name: string } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Topic not found' });
    if (existing.isPrivate && existing.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private topic' });
    }
    db.prepare('DELETE FROM note_topics WHERE id = ?').run(Number(id));
    console.log(`[Note] Topic deleted: id=${id}`);
    return { ok: true };
  });

  // ============================================================
  // 노트
  // ============================================================

  // 노트 목록
  app.get('/api/notes', { preHandler: authenticate }, async (request: FastifyRequest) => {
    const userId = (request as any).user.userId;
    const { topicId } = request.query as { topicId?: string };

    let where = '(n.isPrivate = 0 OR n.creatorId = ?)';
    const params: any[] = [userId];

    if (topicId) {
      where += ' AND n.topicId = ?';
      params.push(Number(topicId));
    }

    const notes = db.prepare(`
      SELECT n.*, u.name as creatorName, u.profileImage as creatorImage, nt.name as topicName
      FROM notes n
      JOIN users u ON n.creatorId = u.id
      JOIN note_topics nt ON n.topicId = nt.id
      WHERE ${where}
      ORDER BY n.sortOrder, n.createdAt DESC
    `).all(...params) as NoteRow[];

    return notes.map(n => ({ ...n, isPrivate: !!n.isPrivate }));
  });

  // 단일 노트 조회
  app.get('/api/notes/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).user.userId;

    const note = db.prepare(`
      SELECT n.*, u.name as creatorName, u.profileImage as creatorImage, nt.name as topicName
      FROM notes n
      JOIN users u ON n.creatorId = u.id
      JOIN note_topics nt ON n.topicId = nt.id
      WHERE n.id = ?
    `).get(Number(id)) as NoteRow | undefined;

    if (!note) return reply.code(404).send({ error: 'Note not found' });
    if (note.isPrivate && note.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private note' });
    }
    return { ...note, isPrivate: !!note.isPrivate };
  });

  // 노트 생성
  app.post('/api/notes', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const body = request.body as any;
    const { topicId, title, content, todoId, isPrivate, sortOrder } = body;

    const result = db.prepare(`
      INSERT INTO notes (topicId, creatorId, title, content, todoId, isPrivate, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(topicId, userId, title, content || '', todoId || null, isPrivate ? 1 : 0, sortOrder || 0);

    const noteId = result.lastInsertRowid as number;
    console.log(`[Note] Created: "${title}" in topicId=${topicId} by userId=${userId}`);
    if (!isPrivate) sendPushToOthers(userId, `${getUserName(userId)}님이 노트 작성`, `"${title}" 📝`, '/notes');

    // LLM 교정 (비동기, 메인 응답 block 안 함)
    if (content && content.trim().length >= 5) {
      polishText(content, `노트 제목: ${title}`).then(polished => {
        if (polished && polished !== content) {
          db.prepare('UPDATE notes SET contentPolished = ? WHERE id = ?').run(polished, noteId);
          console.log(`[Note] Polished: id=${noteId}`);
        }
      }).catch(err => console.error('[Note] Polish error:', err.message));
    }

    const note = db.prepare(`
      SELECT n.*, u.name as creatorName, u.profileImage as creatorImage, nt.name as topicName
      FROM notes n
      JOIN users u ON n.creatorId = u.id
      JOIN note_topics nt ON n.topicId = nt.id
      WHERE n.id = ?
    `).get(noteId) as NoteRow;

    return { ...note, isPrivate: !!note.isPrivate };
  });

  // 노트 수정
  app.put('/api/notes/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const noteId = Number(id);
    const userId = (request as any).user.userId;
    const body = request.body as any;

    const existing = db.prepare('SELECT id, isPrivate, creatorId, title FROM notes WHERE id = ?').get(noteId) as { id: number; isPrivate: number; creatorId: number; title: string } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Note not found' });
    if (existing.isPrivate && existing.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private note' });
    }

    const fields: string[] = [];
    const values: any[] = [];

    for (const key of ['title', 'content'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
    }
    if (body.topicId !== undefined) { fields.push('topicId = ?'); values.push(body.topicId); }
    if (body.todoId !== undefined) { fields.push('todoId = ?'); values.push(body.todoId || null); }
    if (body.isPrivate !== undefined) { fields.push('isPrivate = ?'); values.push(body.isPrivate ? 1 : 0); }
    if (body.sortOrder !== undefined) { fields.push('sortOrder = ?'); values.push(body.sortOrder); }

    if (fields.length > 0) {
      fields.push("updatedAt = datetime('now', '+9 hours')");
      db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values, noteId);
    }

    console.log(`[Note] Updated: id=${noteId}`);
    if (!existing.isPrivate) sendPushToOthers(userId, `${getUserName(userId)}님이 노트 수정`, `"${existing.title}" ✏️`, '/notes');

    // content 변경 시 재교정 (비동기)
    if (body.content && body.content.trim().length >= 5) {
      const noteTitle = body.title || existing.title;
      polishText(body.content, `노트 제목: ${noteTitle}`).then(polished => {
        if (polished && polished !== body.content) {
          db.prepare('UPDATE notes SET contentPolished = ? WHERE id = ?').run(polished, noteId);
          console.log(`[Note] Re-polished: id=${noteId}`);
        } else {
          db.prepare('UPDATE notes SET contentPolished = NULL WHERE id = ?').run(noteId);
        }
      }).catch(err => console.error('[Note] Polish error:', err.message));
    }

    const note = db.prepare(`
      SELECT n.*, u.name as creatorName, u.profileImage as creatorImage, nt.name as topicName
      FROM notes n
      JOIN users u ON n.creatorId = u.id
      JOIN note_topics nt ON n.topicId = nt.id
      WHERE n.id = ?
    `).get(noteId) as NoteRow;

    return { ...note, isPrivate: !!note.isPrivate };
  });

  // 노트 삭제
  app.delete('/api/notes/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).user.userId;
    const existing = db.prepare('SELECT id, isPrivate, creatorId, title FROM notes WHERE id = ?').get(Number(id)) as { id: number; isPrivate: number; creatorId: number; title: string } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Note not found' });
    if (existing.isPrivate && existing.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private note' });
    }
    db.prepare('DELETE FROM notes WHERE id = ?').run(Number(id));
    console.log(`[Note] Deleted: id=${id}`);
    if (!existing.isPrivate) sendPushToOthers(userId, `${getUserName(userId)}님이 노트 삭제`, `"${existing.title}" 🗑️`, '/notes');
    return { ok: true };
  });
}
