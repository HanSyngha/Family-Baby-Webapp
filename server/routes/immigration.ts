import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../auth.js';
import db from '../db.js';
import { IMMIGRATION_USER_IDS, canUseImmigration, enqueueImmigrationPush, startImmigrationScheduler } from '../immigration-notify.js';

/**
 * 이민 탭: 안건(투표·의견/질문) + 할 일 + 완료 기록. 승하·하람 두 사람만.
 *
 * - 모든 라우트는 [authenticate, requireImmigration]. 두 사람이 아니면 403.
 * - 사진은 갤러리 media 파이프라인을 쓰지 않는다. data/immigration/ 에 webp로만 저장하고
 *   이 파일의 /api/immigration/photos/:file 로만 서빙한다.
 * - 확정 = 두 사람 모두 찬성. 수정하면 찬성·반대 모두 초기화(revision+1).
 */

const PHOTO_DIR = path.resolve('data', 'immigration');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const FULL_PX = 2048;   // 서류 사진 글자가 읽히는 크기
const HARAM_ID = 3;     // 황하람 — 설이 응원 연출은 하람이 하트 누른 사진을 쓴다
const THUMB_PX = 400;
const MAX_PHOTOS = 20;

function requireImmigration(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const userId = (request as any).user?.userId;
  if (!canUseImmigration(userId)) {
    console.warn(`[Immigration] 403 user=${userId} ${request.method} ${request.url}`);
    reply.code(403).send({ error: 'Forbidden' });
    return;
  }
  done();
}

const guard = { preHandler: [authenticate, requireImmigration] };

function me(request: FastifyRequest): number {
  return (request as any).user.userId;
}

function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function str(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

function isDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function removePhotoFiles(filename: string) {
  for (const f of [filename, thumbName(filename)]) {
    try { fs.unlinkSync(path.join(PHOTO_DIR, f)); } catch {}
  }
}

function thumbName(filename: string): string {
  return filename.replace(/\.webp$/, '_t.webp');
}

function otherPerson(userId: number): number | undefined {
  return IMMIGRATION_USER_IDS.find(id => id !== userId);
}

function userName(userId: number): string {
  return (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string } | undefined)?.name ?? '누군가';
}

// ---------- 조회 헬퍼 ----------

interface PhotoOut { id: number; full: string; thumb: string; width: number | null; height: number | null }

function photoOut(r: { id: number; filename: string; width: number | null; height: number | null }): PhotoOut {
  return {
    id: r.id,
    full: `/api/immigration/photos/${r.filename}`,
    thumb: `/api/immigration/photos/${thumbName(r.filename)}`,
    width: r.width,
    height: r.height,
  };
}

function photosFor(column: 'agendaId' | 'commentId', ids: number[]): Map<number, PhotoOut[]> {
  const map = new Map<number, PhotoOut[]>();
  if (ids.length === 0) return map;
  const rows = db.prepare(`SELECT id, ${column} AS ownerId, filename, width, height FROM imm_photos WHERE ${column} IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids) as any[];
  for (const r of rows) {
    if (!map.has(r.ownerId)) map.set(r.ownerId, []);
    map.get(r.ownerId)!.push(photoOut(r));
  }
  return map;
}

function agendaRows(where = '', ...params: unknown[]) {
  const agendas = db.prepare(`
    SELECT a.id, a.title, a.body, a.authorId, u.name AS authorName, a.revision, a.revisedAt, a.confirmedAt, a.createdAt,
      (SELECT COUNT(*) FROM imm_comments c WHERE c.agendaId = a.id AND c.kind = 'opinion') AS opinionCount,
      (SELECT COUNT(*) FROM imm_comments c WHERE c.agendaId = a.id AND c.kind = 'question') AS questionCount
    FROM imm_agendas a JOIN users u ON u.id = a.authorId
    ${where}
    ORDER BY a.createdAt DESC, a.id DESC
  `).all(...params) as any[];
  const ids = agendas.map(a => a.id);
  const votes = ids.length
    ? db.prepare(`SELECT agendaId, userId, value FROM imm_votes WHERE agendaId IN (${ids.map(() => '?').join(',')})`).all(...ids) as any[]
    : [];
  const photos = photosFor('agendaId', ids);
  return agendas.map(a => ({
    ...a,
    votes: Object.fromEntries(votes.filter(v => v.agendaId === a.id).map(v => [v.userId, v.value])),
    photos: photos.get(a.id) ?? [],
  }));
}

function agendaById(id: number) {
  return agendaRows('WHERE a.id = ?', id)[0];
}

// 두 사람 모두 찬성이면 확정, 아니면 확정 해제. 상태가 바뀔 때만 시각을 갱신.
function syncConfirmed(agendaId: number) {
  const yes = (db.prepare("SELECT COUNT(*) n FROM imm_votes WHERE agendaId = ? AND value = 'yes'").get(agendaId) as { n: number }).n;
  const confirmed = yes >= IMMIGRATION_USER_IDS.length;
  if (confirmed) {
    const r = db.prepare("UPDATE imm_agendas SET confirmedAt = datetime('now', '+9 hours') WHERE id = ? AND confirmedAt IS NULL").run(agendaId);
    if (r.changes) console.log(`[Immigration] 안건 ${agendaId} 확정`);
  } else {
    db.prepare('UPDATE imm_agendas SET confirmedAt = NULL WHERE id = ?').run(agendaId);
  }
}

// 먼저 올려 둔 내 사진 중 아직 어디에도 안 붙은 것만 붙인다.
function attachPhotos(photoIds: unknown, userId: number, target: { agendaId?: number; commentId?: number }) {
  if (!Array.isArray(photoIds)) return 0;
  const ids = photoIds.map(Number).filter(Number.isInteger).slice(0, MAX_PHOTOS);
  const stmt = target.agendaId
    ? db.prepare('UPDATE imm_photos SET agendaId = ? WHERE id = ? AND uploaderId = ? AND agendaId IS NULL AND commentId IS NULL')
    : db.prepare('UPDATE imm_photos SET commentId = ? WHERE id = ? AND uploaderId = ? AND agendaId IS NULL AND commentId IS NULL');
  let n = 0;
  for (const id of ids) n += stmt.run(target.agendaId ?? target.commentId, id, userId).changes;
  return n;
}

const itemCols = `
  SELECT i.id, i.title, i.memo, i.dueDate, i.assigneeId, i.status, i.doneDate, i.creatorId, i.createdAt, i.updatedAt
  FROM imm_items i`;

function parseAssignee(v: unknown): number | null {
  const n = Number(v);
  return IMMIGRATION_USER_IDS.includes(n) ? n : null;
}

export function registerImmigrationRoutes(app: FastifyInstance) {
  startImmigrationScheduler(removePhotoFiles);

  // 탭 표시 여부 + 배지(내가 아직 안 누른 안건 수) + 두 사람 정보 + 설이 응원 사진
  app.get('/api/immigration/summary', guard, async (request) => {
    const userId = me(request);
    const people = db.prepare(`SELECT id, name, profileImage FROM users WHERE id IN (${IMMIGRATION_USER_IDS.map(() => '?').join(',')}) ORDER BY id`)
      .all(...IMMIGRATION_USER_IDS);
    const pendingVotes = (db.prepare(`
      SELECT COUNT(*) n FROM imm_agendas a
      WHERE a.confirmedAt IS NULL AND NOT EXISTS (SELECT 1 FROM imm_votes v WHERE v.agendaId = a.id AND v.userId = ?)
    `).get(userId) as { n: number }).n;
    // 하람이 갤러리에서 하트(좋아요) 누른 공유 사진 중 설이가 태어난 뒤의 것. 적으면 클라가 고른 기본 사진을 쓴다.
    // 공유(visibility='shared')만 — 개인공간 사진은 상대 계정에서 404가 난다.
    const cheerPhotoIds = (db.prepare(`
      SELECT m.id FROM likes l JOIN media m ON m.id = l.mediaId
      WHERE l.userId = ? AND m.type = 'image' AND m.visibility = 'shared'
        AND COALESCE(m.takenAt, m.createdAt) >= '2026-02-19'
      ORDER BY l.createdAt DESC
      LIMIT 40
    `).all(HARAM_ID) as { id: number }[]).map(r => r.id);
    return { people, pendingVotes, cheerPhotoIds };
  });

  // ---------- 사진 ----------

  app.post('/api/immigration/photos', guard, async (request, reply) => {
    const userId = me(request);
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'No file' });
    if (!file.mimetype.startsWith('image/')) return reply.code(400).send({ error: '사진만 올릴 수 있어요' });
    const buf = await file.toBuffer();
    const filename = uuidv4() + '.webp';
    try {
      // rotate(): EXIF 방향 반영. sharp는 기본으로 메타데이터(GPS 포함)를 버린다.
      const full = await sharp(buf).rotate().resize(FULL_PX, FULL_PX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 }).toFile(path.join(PHOTO_DIR, filename));
      await sharp(buf).rotate().resize(THUMB_PX, THUMB_PX, { fit: 'cover' })
        .webp({ quality: 75 }).toFile(path.join(PHOTO_DIR, thumbName(filename)));
      const r = db.prepare('INSERT INTO imm_photos (uploaderId, filename, width, height) VALUES (?, ?, ?, ?)')
        .run(userId, filename, full.width, full.height);
      console.log(`[Immigration] 사진 업로드 user=${userId} id=${r.lastInsertRowid} ${buf.length}B → ${full.width}x${full.height}`);
      return photoOut({ id: r.lastInsertRowid as number, filename, width: full.width, height: full.height });
    } catch (e) {
      removePhotoFiles(filename);
      console.warn(`[Immigration] 사진 변환 실패 user=${userId} ${file.filename}: ${e instanceof Error ? e.message : e}`);
      return reply.code(400).send({ error: '사진을 읽을 수 없어요' });
    }
  });

  app.get('/api/immigration/photos/:file', guard, async (request, reply) => {
    const { file } = request.params as { file: string };
    const m = /^([a-f0-9-]{36})(_t)?\.webp$/.exec(file);
    if (!m) return reply.code(404).send({ error: 'Not found' });
    // DB에 있는 사진만 서빙 (지운 사진 파일이 남아 있어도 안 나간다)
    const row = db.prepare('SELECT id FROM imm_photos WHERE filename = ?').get(`${m[1]}.webp`);
    const full = path.join(PHOTO_DIR, file);
    if (!row || !fs.existsSync(full)) return reply.code(404).send({ error: 'Not found' });
    reply.header('Content-Type', 'image/webp');
    return reply.send(fs.createReadStream(full));
  });

  // ---------- 안건 ----------

  app.get('/api/immigration/agendas', guard, async () => {
    return { agendas: agendaRows() };
  });

  app.get('/api/immigration/agendas/:id', guard, async (request, reply) => {
    const id = Number((request.params as any).id);
    const agenda = agendaById(id);
    if (!agenda) return reply.code(404).send({ error: 'Not found' });
    const comments = db.prepare(`
      SELECT c.id, c.kind, c.body, c.authorId, u.name AS authorName, c.createdAt
      FROM imm_comments c JOIN users u ON u.id = c.authorId
      WHERE c.agendaId = ? ORDER BY c.createdAt, c.id
    `).all(id) as any[];
    const photos = photosFor('commentId', comments.map(c => c.id));
    return { agenda, comments: comments.map(c => ({ ...c, photos: photos.get(c.id) ?? [] })) };
  });

  app.post('/api/immigration/agendas', guard, async (request, reply) => {
    const userId = me(request);
    const b = request.body as any;
    const title = str(b?.title, 200);
    if (!title) return reply.code(400).send({ error: '제목을 입력해 주세요' });
    const id = db.transaction(() => {
      const r = db.prepare('INSERT INTO imm_agendas (authorId, title, body) VALUES (?, ?, ?)').run(userId, title, str(b?.body, 5000));
      const agendaId = r.lastInsertRowid as number;
      attachPhotos(b?.photoIds, userId, { agendaId });
      return agendaId;
    })();
    console.log(`[Immigration] 안건 등록 id=${id} by=${userId}`);
    const other = otherPerson(userId);
    if (other) enqueueImmigrationPush(other, `새 안건 · ${userName(userId)}`, title, id);
    return agendaById(id);
  });

  // 수정: 내용이 바뀌었으니 찬성·반대 모두 초기화하고 4시간 알림도 처음부터.
  app.patch('/api/immigration/agendas/:id', guard, async (request, reply) => {
    const userId = me(request);
    const id = Number((request.params as any).id);
    const b = request.body as any;
    const cur = db.prepare('SELECT id, title, body FROM imm_agendas WHERE id = ?').get(id) as any;
    if (!cur) return reply.code(404).send({ error: 'Not found' });
    const title = b?.title !== undefined ? str(b.title, 200) : cur.title;
    if (!title) return reply.code(400).send({ error: '제목을 입력해 주세요' });
    const body = b?.body !== undefined ? str(b.body, 5000) : cur.body;

    const removed: string[] = [];
    db.transaction(() => {
      db.prepare(`
        UPDATE imm_agendas SET title = ?, body = ?, revision = revision + 1,
          revisedAt = datetime('now', '+9 hours'), confirmedAt = NULL
        WHERE id = ?
      `).run(title, body, id);
      db.prepare('DELETE FROM imm_votes WHERE agendaId = ?').run(id);
      if (Array.isArray(b?.removePhotoIds)) {
        for (const pid of b.removePhotoIds.map(Number).filter(Number.isInteger)) {
          const p = db.prepare('SELECT filename FROM imm_photos WHERE id = ? AND agendaId = ?').get(pid, id) as any;
          if (!p) continue;
          db.prepare('DELETE FROM imm_photos WHERE id = ?').run(pid);
          removed.push(p.filename);
        }
      }
      attachPhotos(b?.photoIds, userId, { agendaId: id });
    })();
    removed.forEach(removePhotoFiles);
    console.log(`[Immigration] 안건 수정 id=${id} by=${userId} → 투표 초기화, 사진 삭제 ${removed.length}`);
    return agendaById(id);
  });

  app.delete('/api/immigration/agendas/:id', guard, async (request, reply) => {
    const userId = me(request);
    const id = Number((request.params as any).id);
    const files = db.prepare(`
      SELECT filename FROM imm_photos
      WHERE agendaId = ? OR commentId IN (SELECT id FROM imm_comments WHERE agendaId = ?)
    `).all(id, id) as { filename: string }[];
    const r = db.prepare('DELETE FROM imm_agendas WHERE id = ?').run(id);
    if (!r.changes) return reply.code(404).send({ error: 'Not found' });
    files.forEach(f => removePhotoFiles(f.filename));
    console.log(`[Immigration] 안건 삭제 id=${id} by=${userId} 사진 ${files.length}장`);
    return { ok: true };
  });

  // 투표: 'yes' | 'no' | null(취소). 1인 1표, 바꿀 수 있다. 제시자도 직접 눌러야 한다.
  app.put('/api/immigration/agendas/:id/vote', guard, async (request, reply) => {
    const userId = me(request);
    const id = Number((request.params as any).id);
    const value = (request.body as any)?.value ?? null;
    if (value !== null && value !== 'yes' && value !== 'no') return reply.code(400).send({ error: 'Invalid vote' });
    if (!db.prepare('SELECT 1 FROM imm_agendas WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Not found' });
    db.transaction(() => {
      if (value === null) {
        db.prepare('DELETE FROM imm_votes WHERE agendaId = ? AND userId = ?').run(id, userId);
      } else {
        db.prepare(`
          INSERT INTO imm_votes (agendaId, userId, value) VALUES (?, ?, ?)
          ON CONFLICT(agendaId, userId) DO UPDATE SET value = excluded.value, votedAt = datetime('now', '+9 hours')
        `).run(id, userId, value);
      }
      syncConfirmed(id);
    })();
    console.log(`[Immigration] 투표 안건=${id} user=${userId} value=${value}`);
    return agendaById(id);
  });

  // ---------- 의견 / 질문 ----------

  app.post('/api/immigration/agendas/:id/comments', guard, async (request, reply) => {
    const userId = me(request);
    const agendaId = Number((request.params as any).id);
    const b = request.body as any;
    const kind = b?.kind === 'question' ? 'question' : 'opinion';
    const body = str(b?.body, 5000);
    const hasPhotos = Array.isArray(b?.photoIds) && b.photoIds.length > 0;
    if (!body && !hasPhotos) return reply.code(400).send({ error: '내용을 입력해 주세요' });
    const agenda = db.prepare('SELECT title FROM imm_agendas WHERE id = ?').get(agendaId) as { title: string } | undefined;
    if (!agenda) return reply.code(404).send({ error: 'Not found' });
    const id = db.transaction(() => {
      const r = db.prepare('INSERT INTO imm_comments (agendaId, authorId, kind, body) VALUES (?, ?, ?, ?)').run(agendaId, userId, kind, body);
      const commentId = r.lastInsertRowid as number;
      attachPhotos(b?.photoIds, userId, { commentId });
      return commentId;
    })();
    console.log(`[Immigration] ${kind === 'question' ? '질문' : '의견'} 등록 id=${id} 안건=${agendaId} by=${userId}`);
    // 질문은 답이 필요하니 상대에게 알린다. 의견은 알리지 않는다.
    const other = otherPerson(userId);
    if (kind === 'question' && other) {
      enqueueImmigrationPush(other, `질문 · ${userName(userId)}`, `${agenda.title} — ${body || '사진'}`.slice(0, 200), agendaId);
    }
    return { ok: true, id };
  });

  app.delete('/api/immigration/comments/:id', guard, async (request, reply) => {
    const userId = me(request);
    const id = Number((request.params as any).id);
    const files = db.prepare('SELECT filename FROM imm_photos WHERE commentId = ?').all(id) as { filename: string }[];
    const r = db.prepare('DELETE FROM imm_comments WHERE id = ?').run(id);
    if (!r.changes) return reply.code(404).send({ error: 'Not found' });
    files.forEach(f => removePhotoFiles(f.filename));
    console.log(`[Immigration] 댓글 삭제 id=${id} by=${userId}`);
    return { ok: true };
  });

  // ---------- 할 일 / 완료 ----------

  app.get('/api/immigration/items', guard, async () => {
    const todo = db.prepare(`${itemCols} WHERE i.status = 'todo' ORDER BY i.dueDate IS NULL, i.dueDate, i.id`).all();
    const done = db.prepare(`${itemCols} WHERE i.status != 'todo' ORDER BY i.doneDate DESC, i.updatedAt DESC, i.id DESC`).all();
    return { todo, done };
  });

  app.post('/api/immigration/items', guard, async (request, reply) => {
    const userId = me(request);
    const b = request.body as any;
    const title = str(b?.title, 200);
    if (!title) return reply.code(400).send({ error: '내용을 입력해 주세요' });
    const status = ['todo', 'done', 'waiting'].includes(b?.status) ? b.status : 'todo';
    const doneDate = status === 'todo' ? null : isDate(b?.doneDate) ? b.doneDate : todayKST();
    const r = db.prepare(`
      INSERT INTO imm_items (title, memo, dueDate, assigneeId, status, doneDate, creatorId) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title, str(b?.memo, 2000), isDate(b?.dueDate) ? b.dueDate : null, parseAssignee(b?.assigneeId), status, doneDate, userId);
    console.log(`[Immigration] 항목 추가 id=${r.lastInsertRowid} status=${status} by=${userId}`);
    return db.prepare(`${itemCols} WHERE i.id = ?`).get(r.lastInsertRowid);
  });

  // 완료 처리 = status 'done' (+ 완료일 오늘). 되돌리기 = status 'todo'.
  app.patch('/api/immigration/items/:id', guard, async (request, reply) => {
    const userId = me(request);
    const id = Number((request.params as any).id);
    const b = request.body as any;
    const cur = db.prepare('SELECT * FROM imm_items WHERE id = ?').get(id) as any;
    if (!cur) return reply.code(404).send({ error: 'Not found' });
    const title = b?.title !== undefined ? str(b.title, 200) : cur.title;
    if (!title) return reply.code(400).send({ error: '내용을 입력해 주세요' });
    const status = ['todo', 'done', 'waiting'].includes(b?.status) ? b.status : cur.status;
    let doneDate = b?.doneDate !== undefined ? (isDate(b.doneDate) ? b.doneDate : null) : cur.doneDate;
    if (status === 'todo') doneDate = null;
    else if (!doneDate) doneDate = todayKST();
    db.prepare(`
      UPDATE imm_items SET title = ?, memo = ?, dueDate = ?, assigneeId = ?, status = ?, doneDate = ?,
        updatedAt = datetime('now', '+9 hours')
      WHERE id = ?
    `).run(
      title,
      b?.memo !== undefined ? str(b.memo, 2000) : cur.memo,
      b?.dueDate !== undefined ? (isDate(b.dueDate) ? b.dueDate : null) : cur.dueDate,
      b?.assigneeId !== undefined ? parseAssignee(b.assigneeId) : cur.assigneeId,
      status, doneDate, id,
    );
    console.log(`[Immigration] 항목 수정 id=${id} status=${cur.status}→${status} by=${userId}`);
    return db.prepare(`${itemCols} WHERE i.id = ?`).get(id);
  });

  app.delete('/api/immigration/items/:id', guard, async (request, reply) => {
    const userId = me(request);
    const id = Number((request.params as any).id);
    const r = db.prepare('DELETE FROM imm_items WHERE id = ?').run(id);
    if (!r.changes) return reply.code(404).send({ error: 'Not found' });
    console.log(`[Immigration] 항목 삭제 id=${id} by=${userId}`);
    return { ok: true };
  });
}
