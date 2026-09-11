import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import { enqueue, getQueueStatus } from '../upload-queue.js';
import db, { peanutDb } from '../db.js';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { ensureDerivative, parseDerivativeWidth } from '../derivatives.js';
const DATA_DIR = path.resolve('data');

function resolveDataDir(source: string | null): string {
  return source === 'peanut'
    ? (process.env.PEANUT_DATA_DIR || '/app/data-peanut')
    : DATA_DIR;
}

function parseVideoCursor(cursor?: string): { createdAt: string; id: number | null } | null {
  if (!cursor) return null;
  const [createdAt, id] = cursor.split('|');
  return { createdAt, id: id ? parseInt(id) : null };
}

function makeVideoCursor(row: any): string {
  return `${row.createdAt}|${row.id}`;
}

// 개인(비공개) 미디어 접근 가드. 비공개는 소유 관리자 본인만. 아니면 404로 위장.
function assertMediaAccess(media: { visibility?: string; ownerId?: number | null }, user: { userId: number; role: string }, reply: any): boolean {
  if (media.visibility === 'private' && !(user.role === 'master' && media.ownerId === user.userId)) {
    reply.code(404).send({ error: 'Not found' });
    return false;
  }
  return true;
}

export function registerMediaRoutes(app: FastifyInstance) {
  // 미디어 목록 (커서 기반 페이지네이션, sort 지원)
  app.get('/api/media', { preHandler: authenticate }, async (request) => {
    const { cursor, limit = '20', sort = 'recent', scope = 'shared' } = request.query as { cursor?: string; limit?: string; sort?: string; scope?: string };
    const lim = Math.min(parseInt(limit), 50);
    const { userId, role } = (request as any).user;

    // 스코프 필터: 공유(전원) vs 개인(관리자 본인 것만)
    let scopeWhere: string;
    const scopeParams: any[] = [];
    if (scope === 'private') {
      if (role !== 'master') return { items: [], nextCursor: null };
      // 개인공간 = 내가 올린 사진 전부(공유 여부 무관). 백업이 채우고, 공유는 토글로.
      // ⚠️ 불변식: 비공개(visibility='private') 행은 반드시 ownerId === uploaderId.
      //    이 목록은 uploaderId 기준, 접근 게이트(assertMediaAccess)는 ownerId 기준이라
      //    이 둘이 어긋나면 목록엔 뜨는데 서빙은 404가 된다. 비공개 INSERT 시 항상 동일하게.
      scopeWhere = "m.uploaderId = ?";
      scopeParams.push(userId);
    } else {
      scopeWhere = "m.visibility = 'shared'";
    }

    const baseQuery = `
      SELECT m.*,
        u.name as uploaderName, u.profileImage as uploaderImage,
        (SELECT COUNT(*) FROM likes WHERE mediaId = m.id) as likeCount,
        (SELECT COUNT(*) FROM comments WHERE mediaId = m.id) as commentCount,
        (SELECT COUNT(*) FROM views WHERE mediaId = m.id) as viewCount,
        (SELECT COUNT(*) FROM shares WHERE mediaId = m.id) as shareCount,
        EXISTS(SELECT 1 FROM likes WHERE mediaId = m.id AND userId = ?) as liked,
        EXISTS(SELECT 1 FROM favorites WHERE mediaId = m.id AND userId = ?) as favorited,
        (SELECT json_group_array(json_object('userId', vu.id, 'name', vu.name, 'profileImage', vu.profileImage))
         FROM (SELECT DISTINCT vw.userId FROM views vw WHERE vw.mediaId = m.id) dv JOIN users vu ON vu.id = dv.userId) as viewersJson,
        (SELECT json_group_array(json_object('userId', du.id, 'name', du.name, 'profileImage', du.profileImage))
         FROM downloads dl JOIN users du ON du.id = dl.userId WHERE dl.mediaId = m.id) as downloadersJson,
        EXISTS(SELECT 1 FROM album_items ai JOIN albums al ON al.id = ai.albumId WHERE ai.mediaId = m.id AND al.kind = 'trip') as inTrip
      FROM media m
      JOIN users u ON u.id = m.uploaderId
    `;

    let rows: any[];
    if (sort === 'likes') {
      rows = db.prepare(baseQuery + ` WHERE ${scopeWhere} ORDER BY likeCount DESC, m.id DESC`).all(userId, userId, ...scopeParams);
    } else if (sort === 'views') {
      rows = db.prepare(baseQuery + ` WHERE ${scopeWhere} ORDER BY (SELECT COUNT(*) FROM views WHERE mediaId = m.id) DESC, m.id DESC`).all(userId, userId, ...scopeParams);
    } else if (sort === 'favorites') {
      rows = db.prepare(baseQuery + ` WHERE ${scopeWhere} AND EXISTS(SELECT 1 FROM favorites WHERE mediaId = m.id AND userId = ?) ORDER BY m.createdAt DESC`).all(userId, userId, ...scopeParams, userId);
    } else if (cursor) {
      // 커서는 'createdAt|id' 복합키. id 없는 옛 커서(날짜 점프 등)는 createdAt만으로 비교.
      const c = parseVideoCursor(cursor)!;
      rows = c.id !== null && !Number.isNaN(c.id)
        ? db.prepare(baseQuery + ` WHERE ${scopeWhere} AND (m.createdAt < ? OR (m.createdAt = ? AND m.id < ?)) ORDER BY m.createdAt DESC, m.id DESC LIMIT ?`).all(userId, userId, ...scopeParams, c.createdAt, c.createdAt, c.id, lim)
        : db.prepare(baseQuery + ` WHERE ${scopeWhere} AND m.createdAt < ? ORDER BY m.createdAt DESC, m.id DESC LIMIT ?`).all(userId, userId, ...scopeParams, c.createdAt, lim);
    } else {
      rows = db.prepare(baseQuery + ` WHERE ${scopeWhere} ORDER BY m.createdAt DESC, m.id DESC LIMIT ?`).all(userId, userId, ...scopeParams, lim);
    }

    const isMaster = role === 'master';
    const items = rows.map(row => {
      const viewers = isMaster && row.viewersJson ? JSON.parse(row.viewersJson).filter((v: any) => v.userId !== null) : [];
      const downloaders = isMaster && row.downloadersJson ? JSON.parse(row.downloadersJson).filter((d: any) => d.userId !== null) : [];
      const { viewersJson, downloadersJson, ...rest } = row;
      return { ...rest, viewCount: row.viewCount || 0, shareCount: row.shareCount || 0, liked: !!row.liked, favorited: !!row.favorited, inTrip: !!row.inTrip, inPeanut: false, viewers, downloaders };
    });

    // 땅콩땅콩(구앱) 공유 여부 — 같은 해시가 peanutDb에 있는지 일괄 확인(페이지당 1쿼리)
    if (peanutDb && items.length) {
      const hashes = (items as any[]).map(i => i.hash).filter(Boolean);
      if (hashes.length) {
        const ph = hashes.map(() => '?').join(',');
        const present = new Set((peanutDb.prepare(`SELECT hash FROM media WHERE hash IN (${ph})`).all(...hashes) as any[]).map((r: any) => r.hash));
        for (const it of items as any[]) it.inPeanut = !!(it.hash && present.has(it.hash));
      }
    }

    const noPagination = sort === 'likes' || sort === 'views' || sort === 'favorites';
    const nextCursor = noPagination ? null : (rows.length === lim ? makeVideoCursor(rows[rows.length - 1]) : null);
    return { items, nextCursor };
  });

  // 쇼츠형 영상 피드: 사진 목록과 분리해 영상만 커서 기반으로 가져온다.
  app.get('/api/media/videos', { preHandler: authenticate }, async (request) => {
    const { cursor, limit = '12', scope = 'shared' } = request.query as { cursor?: string; limit?: string; scope?: string };
    const lim = Math.min(Math.max(parseInt(limit) || 12, 1), 24);
    const { userId, role } = (request as any).user;

    let scopeWhere: string;
    const scopeParams: any[] = [];
    if (scope === 'private') {
      if (role !== 'master') return { items: [], nextCursor: null };
      scopeWhere = 'm.uploaderId = ?';
      scopeParams.push(userId);
    } else {
      scopeWhere = "m.visibility = 'shared'";
    }

    const baseQuery = `
      SELECT m.*,
        u.name as uploaderName, u.profileImage as uploaderImage,
        (SELECT COUNT(*) FROM likes WHERE mediaId = m.id) as likeCount,
        (SELECT COUNT(*) FROM comments WHERE mediaId = m.id) as commentCount,
        (SELECT COUNT(*) FROM views WHERE mediaId = m.id) as viewCount,
        (SELECT COUNT(*) FROM shares WHERE mediaId = m.id) as shareCount,
        EXISTS(SELECT 1 FROM likes WHERE mediaId = m.id AND userId = ?) as liked,
        EXISTS(SELECT 1 FROM favorites WHERE mediaId = m.id AND userId = ?) as favorited,
        (SELECT json_group_array(json_object('userId', vu.id, 'name', vu.name, 'profileImage', vu.profileImage))
         FROM (SELECT DISTINCT vw.userId FROM views vw WHERE vw.mediaId = m.id) dv JOIN users vu ON vu.id = dv.userId) as viewersJson,
        (SELECT json_group_array(json_object('userId', du.id, 'name', du.name, 'profileImage', du.profileImage))
         FROM downloads dl JOIN users du ON du.id = dl.userId WHERE dl.mediaId = m.id) as downloadersJson,
        EXISTS(SELECT 1 FROM album_items ai JOIN albums al ON al.id = ai.albumId WHERE ai.mediaId = m.id AND al.kind = 'trip') as inTrip
      FROM media m
      JOIN users u ON u.id = m.uploaderId
      WHERE ${scopeWhere} AND m.type = 'video'
    `;

    const parsedCursor = parseVideoCursor(cursor);
    let rows: any[];
    if (parsedCursor?.id) {
      rows = db.prepare(baseQuery + ' AND (m.createdAt < ? OR (m.createdAt = ? AND m.id < ?)) ORDER BY m.createdAt DESC, m.id DESC LIMIT ?')
        .all(userId, userId, ...scopeParams, parsedCursor.createdAt, parsedCursor.createdAt, parsedCursor.id, lim);
    } else if (parsedCursor) {
      rows = db.prepare(baseQuery + ' AND m.createdAt < ? ORDER BY m.createdAt DESC, m.id DESC LIMIT ?')
        .all(userId, userId, ...scopeParams, parsedCursor.createdAt, lim);
    } else {
      rows = db.prepare(baseQuery + ' ORDER BY m.createdAt DESC, m.id DESC LIMIT ?')
        .all(userId, userId, ...scopeParams, lim);
    }

    const isMaster = role === 'master';
    const items = rows.map((row: any) => {
      const viewers = isMaster && row.viewersJson ? JSON.parse(row.viewersJson).filter((v: any) => v.userId !== null) : [];
      const downloaders = isMaster && row.downloadersJson ? JSON.parse(row.downloadersJson).filter((d: any) => d.userId !== null) : [];
      const { viewersJson, downloadersJson, ...rest } = row;
      return { ...rest, viewCount: row.viewCount || 0, shareCount: row.shareCount || 0, liked: !!row.liked, favorited: !!row.favorited, inTrip: !!row.inTrip, inPeanut: false, viewers, downloaders };
    });

    if (peanutDb && items.length) {
      const hashes = (items as any[]).map(i => i.hash).filter(Boolean);
      if (hashes.length) {
        const ph = hashes.map(() => '?').join(',');
        const present = new Set((peanutDb.prepare(`SELECT hash FROM media WHERE hash IN (${ph})`).all(...hashes) as any[]).map((r: any) => r.hash));
        for (const it of items as any[]) it.inPeanut = !!(it.hash && present.has(it.hash));
      }
    }

    return { items, nextCursor: rows.length === lim ? makeVideoCursor(rows[rows.length - 1]) : null };
  });

  // 전체 미디어 ID 목록 (랜덤 재생용, 가벼움)
  app.get('/api/media/ids', { preHandler: authenticate }, async (request) => {
    const { scope = 'shared' } = request.query as { scope?: string };
    const { userId, role } = (request as any).user;
    if (scope === 'private') {
      if (role !== 'master') return { items: [] };
      const rows = db.prepare("SELECT id, filename, type, createdAt FROM media WHERE uploaderId = ? ORDER BY createdAt DESC").all(userId);
      return { items: rows };
    }
    const rows = db.prepare("SELECT id, filename, type, createdAt FROM media WHERE visibility = 'shared' ORDER BY createdAt DESC").all();
    return { items: rows };
  });

  // 단일 미디어 상세
  app.get('/api/media/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = (request as any).user;

    const row = db.prepare(`
      SELECT m.*,
        u.name as uploaderName, u.profileImage as uploaderImage,
        (SELECT COUNT(*) FROM likes WHERE mediaId = m.id) as likeCount,
        (SELECT COUNT(*) FROM comments WHERE mediaId = m.id) as commentCount,
        (SELECT COUNT(*) FROM views WHERE mediaId = m.id) as viewCount,
        (SELECT COUNT(*) FROM shares WHERE mediaId = m.id) as shareCount,
        EXISTS(SELECT 1 FROM likes WHERE mediaId = m.id AND userId = ?) as liked,
        EXISTS(SELECT 1 FROM favorites WHERE mediaId = m.id AND userId = ?) as favorited,
        (SELECT json_group_array(json_object('userId', vu.id, 'name', vu.name, 'profileImage', vu.profileImage))
         FROM (SELECT DISTINCT vw.userId FROM views vw WHERE vw.mediaId = m.id) dv JOIN users vu ON vu.id = dv.userId) as viewersJson,
        (SELECT json_group_array(json_object('userId', du.id, 'name', du.name, 'profileImage', du.profileImage))
         FROM downloads dl JOIN users du ON du.id = dl.userId WHERE dl.mediaId = m.id) as downloadersJson,
        EXISTS(SELECT 1 FROM album_items ai JOIN albums al ON al.id = ai.albumId WHERE ai.mediaId = m.id AND al.kind = 'trip') as inTrip
      FROM media m
      JOIN users u ON u.id = m.uploaderId
      WHERE m.id = ?
    `).get(userId, userId, parseInt(id)) as any;

    if (!row) return reply.code(404).send({ error: 'Not found' });
    if (!assertMediaAccess(row, { userId, role }, reply)) return;

    const isMaster = role === 'master';
    const viewers = isMaster && row.viewersJson ? JSON.parse(row.viewersJson).filter((v: any) => v.userId !== null) : [];
    const downloaders = isMaster && row.downloadersJson ? JSON.parse(row.downloadersJson).filter((d: any) => d.userId !== null) : [];
    const { viewersJson, downloadersJson, ...rest } = row;
    const inPeanut = !!(row.hash && peanutDb && peanutDb.prepare('SELECT 1 FROM media WHERE hash = ?').get(row.hash));
    return { ...rest, viewCount: row.viewCount || 0, liked: !!row.liked, favorited: !!row.favorited, inTrip: !!row.inTrip, inPeanut, viewers, downloaders };
  });

  // 업로드 전 중복 체크 (해시)
  app.post('/api/media/check-duplicate', { preHandler: authenticate }, async (request) => {
    const { hash } = request.body as { hash: string };
    if (!hash) return { duplicate: false, existingId: null };
    const { userId } = (request as any).user;
    const existing = db.prepare('SELECT id, visibility, uploaderId FROM media WHERE hash = ?').get(hash) as any;
    if (existing) {
      // 재업로드를 공유로 전환하려면 기존 사진의 상태가 필요(내 비공개면 promote 가능)
      return {
        duplicate: true,
        existingId: existing.id,
        existingVisibility: existing.visibility,
        existingMine: existing.uploaderId === userId,
      };
    }
    // 삭제 묘비(tombstone): 폰 백업은 duplicate로 보고 스킵, 웹 수동 업로드는 tombstone 플래그로 무시하고 진행.
    const tomb = db.prepare('SELECT hash FROM deleted_hashes WHERE hash = ?').get(hash) as any;
    if (tomb) return { duplicate: true, tombstone: true, existingId: null };
    return { duplicate: false, existingId: null };
  });

  // 처리 큐 상태
  app.get('/api/media/processing', { preHandler: authenticate }, async () => {
    return getQueueStatus();
  });

  // 업로드
  app.post('/api/media/upload', { preHandler: authenticate }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'No file' });

    const mimeType = data.mimetype;
    const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : null;
    if (!type) return reply.code(400).send({ error: 'Unsupported file type' });

    const ext = path.extname(data.filename);
    const filename = uuidv4() + ext;
    const filePath = path.join(DATA_DIR, 'originals', filename);

    app.log.info({ originalName: data.filename, mimeType, type }, 'Upload started');

    // 파일 저장 (pipeline으로 안전하게 스트림 처리)
    // 중간에 끊기면(프록시 60s 타임아웃·네트워크 끊김 등) partial 파일이 originals/에 남아
    // DB 미참조 고아로 쌓인다 → 실패 시 즉시 삭제하고 끝낸다.
    try {
      await pipeline(data.file, fs.createWriteStream(filePath));
    } catch (err) {
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
      app.log.warn({ originalName: data.filename, filename, err: String(err) }, 'Upload stream failed → partial 삭제');
      if (!reply.sent) reply.code(499).send({ error: 'Upload interrupted' });
      return;
    }

    const stat = fs.statSync(filePath);
    app.log.info({ originalName: data.filename, size: stat.size, filename }, 'File saved');

    // 빠른 해시: 첫 4MB + 마지막 4MB + 파일 크기 (클라이언트와 동일 방식)
    const fileHash = await computeQuickHash(filePath, stat.size);
    app.log.info({ originalName: data.filename, hash: fileHash.slice(0, 12) }, 'Hash computed');

    const existing = db.prepare('SELECT id FROM media WHERE hash = ?').get(fileHash) as any;
    if (existing) {
      fs.unlinkSync(filePath);
      app.log.info({ originalName: data.filename, existingId: existing.id }, 'Duplicate skipped');
      return { ok: true, duplicate: true, existingId: existing.id };
    }

    const { userId: uploaderId, role } = (request as any).user;
    // 개인(비공개) 업로드는 관리자만. 그 외는 공유.
    const { visibility, albumId } = request.query as { visibility?: string; albumId?: string };
    const vis = (visibility === 'private' && role === 'master') ? 'private' : 'shared';
    const ownerId = vis === 'private' ? uploaderId : null;
    // 여행 앨범으로 바로 업로드(#4): 공유 사진 + 그 앨범에 추가. master + 존재하는 앨범만.
    let targetAlbumId: number | null = null;
    if (albumId && vis === 'shared' && role === 'master') {
      const a = db.prepare('SELECT id FROM albums WHERE id = ?').get(parseInt(albumId)) as any;
      if (a) targetAlbumId = a.id;
    }
    enqueue({ filename, originalName: data.filename, mimeType, type, size: stat.size, uploaderId, hash: fileHash, visibility: vis, ownerId, albumId: targetAlbumId });
    app.log.info({ originalName: data.filename, uploaderId, filename }, 'Enqueued for processing');

    return { ok: true, filename };
  });

  // 날짜 수정
  app.patch('/api/media/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = (request as any).user;
    const { createdAt, takenAt, place } = request.body as { createdAt?: string; takenAt?: string; place?: string };

    const media = db.prepare('SELECT uploaderId FROM media WHERE id = ?').get(parseInt(id)) as any;
    if (!media) return reply.code(404).send({ error: 'Not found' });
    if (media.uploaderId !== userId && role !== 'master') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    // 메타데이터 수정: 시간(takenAt+createdAt 동기화) / 장소(place). 둘 다 그 값으로 갱신.
    const sets: string[] = [];
    const vals: any[] = [];
    const t = takenAt ?? createdAt; // 시간 입력 (YY-MM-DD HH:mm 또는 :ss)
    if (t !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(t)) {
        return reply.code(400).send({ error: 'Invalid date format' });
      }
      const full = t.length === 16 ? t + ':00' : t;
      sets.push('createdAt = ?', 'takenAt = ?');
      vals.push(full, full);
    }
    if (place !== undefined) {
      sets.push('place = ?');
      vals.push(place && place.trim() ? place.trim() : null);
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'Nothing to update' });
    vals.push(parseInt(id));
    db.prepare(`UPDATE media SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = db.prepare('SELECT createdAt, takenAt, place FROM media WHERE id = ?').get(parseInt(id));
    return { ok: true, ...(row as object) };
  });

  // 삭제
  app.delete('/api/media/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = (request as any).user;

    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(parseInt(id)) as any;
    if (!media) return reply.code(404).send({ error: 'Not found' });

    if (media.uploaderId !== userId && role !== 'master') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    // 외부 소스 파일은 삭제하지 않음 (원본은 다른 앱에 속함)
    if (!media.source || media.source === 'local') {
      const originalPath = path.join(DATA_DIR, 'originals', media.filename);
      const thumbPath = path.join(DATA_DIR, 'thumbnails', media.filename + '.webp');
      const hlsDir = path.join(DATA_DIR, 'hls', media.filename);
      if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      if (fs.existsSync(hlsDir)) fs.rmSync(hlsDir, { recursive: true });
    }

    // 삭제 묘비 기록: 폰 자동백업이 이 사진을 다시 올리지 않게(수동 재업로드는 가능 — useUploadQueue가 tombstone 무시).
    if (media.hash) db.prepare('INSERT OR IGNORE INTO deleted_hashes (hash) VALUES (?)').run(media.hash);

    db.prepare('DELETE FROM media WHERE id = ?').run(parseInt(id));
    return { ok: true };
  });

  // 원본 파일 서빙 (Range Request 지원)
  app.get('/api/media/:id/file', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = (request as any).user;
    const media = db.prepare('SELECT filename, mimeType, size, source, visibility, ownerId FROM media WHERE id = ?').get(parseInt(id)) as any;
    if (!media) return reply.code(404).send({ error: 'Not found' });
    if (!assertMediaAccess(media, { userId, role }, reply)) return;

    const filePath = path.join(resolveDataDir(media.source), 'originals', media.filename);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'File not found' });

    const range = request.headers.range;
    const stat = fs.statSync(filePath);

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0]);
      const end = parts[1] ? parseInt(parts[1]) : stat.size - 1;
      const chunkSize = end - start + 1;

      reply.code(206).headers({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': media.mimeType,
      });
      return reply.send(fs.createReadStream(filePath, { start, end }));
    }

    reply.headers({
      'Content-Length': stat.size,
      'Content-Type': media.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'max-age=31536000, immutable',
    });
    return reply.send(fs.createReadStream(filePath));
  });

  // 썸네일 서빙
  app.get('/api/media/:id/thumb', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = (request as any).user;
    const media = db.prepare('SELECT filename, type, source, visibility, ownerId FROM media WHERE id = ?').get(parseInt(id)) as any;
    if (!media) return reply.code(404).send({ error: 'Not found' });
    if (!assertMediaAccess(media, { userId, role }, reply)) return;

    // ?w=640|1280 → 고해상도 파생본. 없으면 원본에서 만들어 캐시한다.
    // (실패하면 아래 300px 썸네일로 조용히 폴백)
    const width = parseDerivativeWidth((request.query as any)?.w);
    if (width) {
      const deriv = await ensureDerivative(resolveDataDir(media.source), media.filename, media.type, width);
      if (deriv) {
        reply.headers({
          'Content-Type': 'image/webp',
          'Cache-Control': 'max-age=31536000, immutable',
        });
        return reply.send(fs.createReadStream(deriv));
      }
    }

    const thumbPath = path.join(resolveDataDir(media.source), 'thumbnails', media.filename + '.webp');
    if (!fs.existsSync(thumbPath)) {
      // 썸네일이 애초에 안 만들어진 항목(전체의 0.02% 수준)은 갤러리에 빈 칸으로 남는다.
      // 원본에서 한 번 만들어 캐시하고 그걸 내려준다.
      const rescued = await ensureDerivative(resolveDataDir(media.source), media.filename, media.type, 640);
      if (!rescued) return reply.code(404).send({ error: 'Thumbnail not found' });
      reply.headers({
        'Content-Type': 'image/webp',
        'Cache-Control': 'max-age=31536000, immutable',
      });
      return reply.send(fs.createReadStream(rescued));
    }

    reply.headers({
      'Content-Type': 'image/webp',
      'Cache-Control': 'max-age=31536000, immutable',
    });
    return reply.send(fs.createReadStream(thumbPath));
  });

  // HLS playlist 서빙
  app.get('/api/media/:id/hls/playlist.m3u8', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = (request as any).user;
    const media = db.prepare('SELECT filename, source, visibility, ownerId FROM media WHERE id = ?').get(parseInt(id)) as any;
    if (!media) return reply.code(404).send({ error: 'Not found' });
    if (!assertMediaAccess(media, { userId, role }, reply)) return;

    const playlistPath = path.join(resolveDataDir(media.source), 'hls', media.filename, 'playlist.m3u8');
    if (!fs.existsSync(playlistPath)) return reply.code(404).send({ error: 'HLS not available' });

    reply.headers({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache',
    });
    return reply.send(fs.createReadStream(playlistPath));
  });

  // HLS segment 서빙
  app.get('/api/media/:id/hls/:segment', { preHandler: authenticate }, async (request, reply) => {
    const { id, segment } = request.params as { id: string; segment: string };
    if (segment.includes('/') || segment.includes('\\') || segment.includes('..')) {
      return reply.code(400).send({ error: 'Invalid segment' });
    }
    const { userId, role } = (request as any).user;
    const media = db.prepare('SELECT filename, source, visibility, ownerId FROM media WHERE id = ?').get(parseInt(id)) as any;
    if (!media) return reply.code(404).send({ error: 'Not found' });
    if (!assertMediaAccess(media, { userId, role }, reply)) return;

    const segmentPath = path.join(resolveDataDir(media.source), 'hls', media.filename, segment);
    if (!fs.existsSync(segmentPath)) return reply.code(404).send({ error: 'Segment not found' });

    const contentType = segment.endsWith('.ts') ? 'video/mp2t' : 'video/mp4';
    reply.headers({
      'Content-Type': contentType,
      'Cache-Control': 'max-age=31536000, immutable',
    });
    return reply.send(fs.createReadStream(segmentPath));
  });

  // 다운로드 (원본 다운로드 + 기록)
  app.get('/api/media/:id/download', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = (request as any).user;

    const media = db.prepare('SELECT filename, originalName, mimeType, size, source, visibility, ownerId FROM media WHERE id = ?').get(parseInt(id)) as any;
    if (!media) return reply.code(404).send({ error: 'Not found' });
    if (!assertMediaAccess(media, { userId, role }, reply)) return;

    const filePath = path.join(resolveDataDir(media.source), 'originals', media.filename);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'File not found' });

    // 다운로드 기록
    db.prepare('INSERT OR IGNORE INTO downloads (mediaId, userId) VALUES (?, ?)').run(parseInt(id), userId);

    // Content-Length는 DB 값이 아니라 실제 파일 크기를 사용한다.
    // (예전 업로드는 후처리로 파일 크기가 DB값과 달라져, DB값을 쓰면 다운로드가 잘렸음)
    const stat = fs.statSync(filePath);
    // 한글 파일명은 RFC 5987(filename*)로 보내고, 구형 클라이언트용 ASCII 폴백을 함께 준다.
    const safeName = media.originalName.replace(/[\r\n"]/g, '_');
    const asciiName = safeName.replace(/[^\x20-\x7e]/g, '_');
    reply.headers({
      'Content-Type': media.mimeType,
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      'Content-Length': stat.size,
    });
    return reply.send(fs.createReadStream(filePath));
  });

  // 땅콩땅콩땅콩콩땅(old app)으로 미디어 게시 (파일 복사 없이 DB 레코드만 추가)
  app.post('/api/media/copy-to-peanut', { preHandler: authenticate }, async (request, reply) => {
    if (!peanutDb) return reply.code(400).send({ error: '땅콩땅콩땅콩콩땅 연결 불가' });

    const { ids } = request.body as { ids: number[] };
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: '선택된 미디어 없음' });
    }
    if (ids.length > 100) {
      return reply.code(400).send({ error: '최대 100개까지 가능' });
    }

    const { userId } = (request as any).user;

    // 유저 매핑: provider+providerId로 old app 유저 찾기
    const familyUser = db.prepare('SELECT provider, providerId, name FROM users WHERE id = ?')
      .get(userId) as { provider: string; providerId: string; name: string } | undefined;
    if (!familyUser) return reply.code(400).send({ error: '유저 없음' });

    const peanutUser = peanutDb.prepare('SELECT id FROM users WHERE provider = ? AND providerId = ?')
      .get(familyUser.provider, familyUser.providerId) as { id: number } | undefined;
    if (!peanutUser) {
      return reply.code(400).send({ error: '땅콩땅콩땅콩콩땅에 계정이 없습니다. 먼저 로그인해주세요.' });
    }

    let copied = 0;
    let duplicates = 0;
    const errors: string[] = [];

    for (const id of ids) {
      let media: any;
      try {
        media = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
        if (!media) { errors.push(`ID ${id} 없음`); continue; }
        // 개인(비공개) 사진은 땅콩땅콩으로 공유 금지 (공유 갤러리에서만 가능)
        if (media.visibility === 'private') { errors.push(`${media.originalName}: 개인 사진은 공유할 수 없습니다`); continue; }

        // 해시로 중복 체크
        if (media.hash) {
          const existing = peanutDb.prepare('SELECT id FROM media WHERE hash = ?').get(media.hash);
          if (existing) { duplicates++; continue; }
        }

        // 원본 파일 확인 (로컬 또는 peanut 소스)
        const srcDir = resolveDataDir(media.source);
        const srcPath = path.join(srcDir, 'originals', media.filename);
        if (!fs.existsSync(srcPath)) { errors.push(`${media.originalName}: 파일 없음`); continue; }

        // DB 레코드만 추가 (source='family' → P1이 P2 볼륨에서 서빙)
        const nowKst = new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
        peanutDb.prepare(`
          INSERT INTO media (uploaderId, filename, originalName, mimeType, type, size, width, height, duration, hash, createdAt, uploadedAt, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'family')
        `).run(
          peanutUser.id, media.filename, media.originalName, media.mimeType, media.type,
          media.size, media.width, media.height, media.duration, media.hash,
          media.createdAt, nowKst,
        );

        copied++;
      } catch (err) {
        errors.push(`${media?.originalName || id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { copied, duplicates, errors };
  });

  // ===== 갤러리 이벤트 자막 (날짜 범위 → 'N일차' 자동) =====
  app.get('/api/gallery-events', { preHandler: authenticate }, async () => {
    return db.prepare('SELECT id, startDate, endDate, title, color FROM gallery_events ORDER BY startDate DESC').all();
  });

  app.post('/api/gallery-events', { preHandler: authenticate }, async (request, reply) => {
    const { userId, role } = (request as any).user;
    if (role !== 'master') return reply.code(403).send({ error: '관리자만 가능합니다' });
    let { startDate, endDate, title, color } = request.body as { startDate: string; endDate: string; title: string; color?: string };
    if (!title?.trim()) return reply.code(400).send({ error: '제목을 입력하세요' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return reply.code(400).send({ error: '날짜 형식 오류' });
    }
    if (endDate < startDate) [startDate, endDate] = [endDate, startDate];
    const r = db.prepare('INSERT INTO gallery_events (startDate, endDate, title, color, createdBy) VALUES (?, ?, ?, ?, ?)')
      .run(startDate, endDate, title.trim(), color || '#E8943A', userId);
    return db.prepare('SELECT id, startDate, endDate, title, color FROM gallery_events WHERE id = ?').get(r.lastInsertRowid);
  });

  app.patch('/api/gallery-events/:id', { preHandler: authenticate }, async (request, reply) => {
    if ((request as any).user.role !== 'master') return reply.code(403).send({ error: '관리자만 가능합니다' });
    const { id } = request.params as { id: string };
    let { startDate, endDate, title, color } = request.body as { startDate: string; endDate: string; title: string; color?: string };
    if (!title?.trim()) return reply.code(400).send({ error: '제목을 입력하세요' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return reply.code(400).send({ error: '날짜 형식 오류' });
    }
    if (endDate < startDate) [startDate, endDate] = [endDate, startDate];
    const ev = db.prepare('SELECT id FROM gallery_events WHERE id = ?').get(parseInt(id));
    if (!ev) return reply.code(404).send({ error: 'Not found' });
    db.prepare('UPDATE gallery_events SET startDate = ?, endDate = ?, title = ?, color = ? WHERE id = ?')
      .run(startDate, endDate, title.trim(), color || '#E8943A', parseInt(id));
    return db.prepare('SELECT id, startDate, endDate, title, color FROM gallery_events WHERE id = ?').get(parseInt(id));
  });

  app.delete('/api/gallery-events/:id', { preHandler: authenticate }, async (request, reply) => {
    if ((request as any).user.role !== 'master') return reply.code(403).send({ error: '관리자만 가능합니다' });
    const { id } = request.params as { id: string };
    db.prepare('DELETE FROM gallery_events WHERE id = ?').run(parseInt(id));
    return { ok: true };
  });

  // 신규 앱 → 구 앱(땅콩땅콩땅콩콩땅) 단방향 적용 (복사本)
  app.post('/api/gallery-events/:id/apply-to-peanut', { preHandler: authenticate }, async (request, reply) => {
    if ((request as any).user.role !== 'master') return reply.code(403).send({ error: '관리자만 가능합니다' });
    if (!peanutDb) return reply.code(400).send({ error: '땅콩땅콩 연결 불가' });
    const { id } = request.params as { id: string };
    const ev = db.prepare('SELECT startDate, endDate, title, color FROM gallery_events WHERE id = ?').get(parseInt(id)) as any;
    if (!ev) return reply.code(404).send({ error: 'Not found' });
    peanutDb.exec(`CREATE TABLE IF NOT EXISTS gallery_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, startDate TEXT NOT NULL, endDate TEXT NOT NULL,
      title TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#946b2d', createdBy INTEGER,
      createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
    )`);
    const existing = peanutDb.prepare('SELECT id FROM gallery_events WHERE startDate = ? AND endDate = ? AND title = ?')
      .get(ev.startDate, ev.endDate, ev.title) as any;
    if (existing) {
      peanutDb.prepare('UPDATE gallery_events SET color = ? WHERE id = ?').run(ev.color, existing.id);
    } else {
      peanutDb.prepare('INSERT INTO gallery_events (startDate, endDate, title, color, createdBy) VALUES (?, ?, ?, ?, NULL)')
        .run(ev.startDate, ev.endDate, ev.title, ev.color);
    }
    return { ok: true };
  });
}

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

async function computeQuickHash(filePath: string, fileSize: number): Promise<string> {
  const hash = crypto.createHash('sha256');

  if (fileSize <= CHUNK_SIZE) {
    // 작은 파일: 전체 해시
    const data = fs.readFileSync(filePath);
    hash.update(data);
  } else {
    // 큰 파일: head 4MB + tail 4MB + 파일 크기
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(CHUNK_SIZE);
    const tail = Buffer.alloc(CHUNK_SIZE);
    fs.readSync(fd, head, 0, CHUNK_SIZE, 0);
    fs.readSync(fd, tail, 0, CHUNK_SIZE, fileSize - CHUNK_SIZE);
    fs.closeSync(fd);
    hash.update(head);
    hash.update(tail);
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeDoubleBE(fileSize);
    hash.update(sizeBuf);
  }

  return hash.digest('hex');
}
