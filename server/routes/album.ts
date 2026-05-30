import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import db from '../db.js';

// 앨범 미디어 공통 SELECT (그리드/라이트박스가 쓰는 필드 + 좋아요/즐겨찾기 상태).
// 바인딩 순서: liked(userId), favorited(userId).
const MEDIA_COLS = `
  m.id, m.uploaderId, m.filename, m.originalName, m.mimeType, m.type, m.size,
  m.width, m.height, m.duration, m.createdAt, m.takenAt, m.source, m.visibility, m.ownerId,
  m.lat, m.lng, m.livePhotoGroup,
  u.name as uploaderName, u.profileImage as uploaderImage,
  (SELECT COUNT(*) FROM likes WHERE mediaId = m.id) as likeCount,
  (SELECT COUNT(*) FROM comments WHERE mediaId = m.id) as commentCount,
  (SELECT COUNT(*) FROM views WHERE mediaId = m.id) as viewCount,
  EXISTS(SELECT 1 FROM likes WHERE mediaId = m.id AND userId = ?) as liked,
  EXISTS(SELECT 1 FROM favorites WHERE mediaId = m.id AND userId = ?) as favorited
`;

function mapMedia(row: any) {
  return { ...row, liked: !!row.liked, favorited: !!row.favorited };
}

function requireMaster(request: any, reply: any): boolean {
  if (request.user?.role !== 'master') {
    reply.code(403).send({ error: '관리자만 가능합니다' });
    return false;
  }
  return true;
}

function placeholders(n: number): string {
  return Array(n).fill('?').join(',');
}

// 시공간 그리디 클러스터링 (외부 의존성 0). 거리 < 300m & 시간 간격 < 2h 이면 같은 장소.
function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 앨범 기간 + 소속 장소 시간범위를 멤버 미디어의 촬영시각으로 재집계 (idempotent).
function recomputeAlbum(albumId: number) {
  const places = db.prepare('SELECT id FROM trip_places WHERE albumId = ?').all(albumId) as { id: number }[];
  for (const p of places) {
    const r = db.prepare(`
      SELECT MIN(COALESCE(m.takenAt, m.createdAt)) as startAt, MAX(COALESCE(m.takenAt, m.createdAt)) as endAt
      FROM album_items ai JOIN media m ON m.id = ai.mediaId
      WHERE ai.albumId = ? AND ai.placeId = ?
    `).get(albumId, p.id) as { startAt: string | null; endAt: string | null };
    db.prepare('UPDATE trip_places SET startAt = ?, endAt = ? WHERE id = ?').run(r.startAt, r.endAt, p.id);
  }
  const a = db.prepare(`
    SELECT MIN(COALESCE(m.takenAt, m.createdAt)) as s, MAX(COALESCE(m.takenAt, m.createdAt)) as e
    FROM album_items ai JOIN media m ON m.id = ai.mediaId WHERE ai.albumId = ?
  `).get(albumId) as { s: string | null; e: string | null };
  db.prepare('UPDATE albums SET startDate = ?, endDate = ? WHERE id = ?')
    .run(a.s ? a.s.slice(0, 10) : null, a.e ? a.e.slice(0, 10) : null, albumId);
}

export function registerAlbumRoutes(app: FastifyInstance) {
  // 앨범(여행) 목록 — 카드용. cover는 명시값 없으면 최신 멤버로 폴백.
  app.get('/api/albums', { preHandler: authenticate }, async (request) => {
    const { kind = 'trip' } = request.query as { kind?: string };
    const rows = db.prepare(`
      SELECT a.id, a.kind, a.title, a.color, a.coverMediaId, a.startDate, a.endDate, a.sortOrder, a.createdAt,
        (SELECT COUNT(*) FROM album_items WHERE albumId = a.id) as itemCount,
        COALESCE(a.coverMediaId, (
          SELECT ai.mediaId FROM album_items ai JOIN media m ON m.id = ai.mediaId
          WHERE ai.albumId = a.id AND m.visibility = 'shared'
          ORDER BY COALESCE(m.takenAt, m.createdAt) DESC LIMIT 1
        )) as coverId
      FROM albums a WHERE a.kind = ?
      ORDER BY a.sortOrder ASC, COALESCE(a.endDate, a.createdAt) DESC
    `).all(kind);
    return { items: rows };
  });

  // 앨범(여행) 상세 — 장소별 미디어 그룹 + 미배정. 공유 미디어만 (개인사진 누출 방지).
  app.get('/api/albums/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = (request as any).user;
    const albumId = parseInt(id);
    const album = db.prepare('SELECT id, kind, title, color, coverMediaId, startDate, endDate, sortOrder FROM albums WHERE id = ?').get(albumId);
    if (!album) return reply.code(404).send({ error: 'Not found' });

    const places = db.prepare('SELECT id, name, lat, lng, startAt, endAt, sortOrder FROM trip_places WHERE albumId = ? ORDER BY (startAt IS NULL) ASC, startAt ASC, sortOrder ASC').all(albumId) as any[];

    const items = db.prepare(`
      SELECT ${MEDIA_COLS}, ai.placeId, ai.sortOrder as itemOrder
      FROM album_items ai
      JOIN media m ON m.id = ai.mediaId
      JOIN users u ON u.id = m.uploaderId
      WHERE ai.albumId = ? AND m.visibility = 'shared'
      ORDER BY COALESCE(m.takenAt, m.createdAt) ASC
    `).all(userId, userId, albumId).map(mapMedia);

    const byPlace = places.map(p => ({ ...p, items: items.filter((it: any) => it.placeId === p.id) }));
    const unplaced = items.filter((it: any) => it.placeId == null);
    return { album, places: byPlace, unplaced };
  });

  // 여행 생성
  app.post('/api/albums', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { kind = 'trip', title, color } = request.body as { kind?: string; title: string; color?: string };
    if (!title?.trim()) return reply.code(400).send({ error: '제목을 입력하세요' });
    const r = db.prepare('INSERT INTO albums (kind, title, color, createdBy) VALUES (?, ?, ?, ?)')
      .run(kind, title.trim(), color || '#E8943A', (request as any).user.userId);
    return db.prepare('SELECT id, kind, title, color, coverMediaId, startDate, endDate, sortOrder FROM albums WHERE id = ?').get(r.lastInsertRowid);
  });

  // 여행 수정
  app.patch('/api/albums/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(parseInt(id)) as any;
    if (!album) return reply.code(404).send({ error: 'Not found' });
    const { title, color, coverMediaId, sortOrder } = request.body as { title?: string; color?: string; coverMediaId?: number | null; sortOrder?: number };
    db.prepare('UPDATE albums SET title = ?, color = ?, coverMediaId = ?, sortOrder = ? WHERE id = ?').run(
      title?.trim() || album.title,
      color || album.color,
      coverMediaId === undefined ? album.coverMediaId : coverMediaId,
      sortOrder === undefined ? album.sortOrder : sortOrder,
      parseInt(id),
    );
    return db.prepare('SELECT id, kind, title, color, coverMediaId, startDate, endDate, sortOrder FROM albums WHERE id = ?').get(parseInt(id));
  });

  // 여행 삭제 (CASCADE: album_items, trip_places만. media·파일은 불변)
  app.delete('/api/albums/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    db.prepare('DELETE FROM albums WHERE id = ?').run(parseInt(id));
    return { ok: true };
  });

  // 멤버십 추가 (공유 미디어만 — 트립은 공유 갤러리이므로). 파일 복제 없음.
  app.post('/api/albums/:id/items', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    const albumId = parseInt(id);
    const { mediaIds, placeId } = request.body as { mediaIds: number[]; placeId?: number | null };
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) return reply.code(400).send({ error: '선택된 미디어 없음' });
    if (!db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId)) return reply.code(404).send({ error: 'Not found' });

    const ins = db.prepare("INSERT OR IGNORE INTO album_items (albumId, mediaId, placeId) SELECT ?, ?, ? WHERE EXISTS(SELECT 1 FROM media WHERE id = ? AND visibility = 'shared')");
    const tx = db.transaction((arr: number[]) => {
      let added = 0;
      for (const mid of arr) { const r = ins.run(albumId, mid, placeId ?? null, mid); added += r.changes; }
      return added;
    });
    const added = tx(mediaIds);
    recomputeAlbum(albumId);
    return { ok: true, added };
  });

  // 멤버십 제거 (media·파일 보존)
  app.delete('/api/albums/:id/items', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    const albumId = parseInt(id);
    const { mediaIds } = request.body as { mediaIds: number[] };
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) return reply.code(400).send({ error: '선택된 미디어 없음' });
    db.prepare(`DELETE FROM album_items WHERE albumId = ? AND mediaId IN (${placeholders(mediaIds.length)})`).run(albumId, ...mediaIds);
    recomputeAlbum(albumId);
    return { ok: true };
  });

  // 장소 생성
  app.post('/api/albums/:id/places', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    const albumId = parseInt(id);
    if (!db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId)) return reply.code(404).send({ error: 'Not found' });
    const { name, lat, lng } = request.body as { name: string; lat?: number; lng?: number };
    if (!name?.trim()) return reply.code(400).send({ error: '장소 이름을 입력하세요' });
    const maxOrder = (db.prepare('SELECT MAX(sortOrder) as m FROM trip_places WHERE albumId = ?').get(albumId) as any).m ?? 0;
    const r = db.prepare('INSERT INTO trip_places (albumId, name, lat, lng, sortOrder) VALUES (?, ?, ?, ?, ?)')
      .run(albumId, name.trim(), lat ?? null, lng ?? null, maxOrder + 1);
    return db.prepare('SELECT id, name, lat, lng, startAt, endAt, sortOrder FROM trip_places WHERE id = ?').get(r.lastInsertRowid);
  });

  // 장소 일괄 생성 + 미디어 배정 (GPS 자동분류 확정 시 1회 호출)
  app.post('/api/albums/:id/places/bulk', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    const albumId = parseInt(id);
    if (!db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId)) return reply.code(404).send({ error: 'Not found' });
    const { places } = request.body as { places: { name: string; lat?: number; lng?: number; mediaIds: number[] }[] };
    if (!Array.isArray(places) || places.length === 0) return reply.code(400).send({ error: '장소 없음' });

    const insPlace = db.prepare('INSERT INTO trip_places (albumId, name, lat, lng, sortOrder) VALUES (?, ?, ?, ?, ?)');
    const insItem = db.prepare("INSERT INTO album_items (albumId, mediaId, placeId) VALUES (?, ?, ?) ON CONFLICT(albumId, mediaId) DO UPDATE SET placeId = excluded.placeId");
    const baseOrder = (db.prepare('SELECT MAX(sortOrder) as m FROM trip_places WHERE albumId = ?').get(albumId) as any).m ?? 0;
    const tx = db.transaction(() => {
      places.forEach((p, i) => {
        const pr = insPlace.run(albumId, p.name?.trim() || `장소 ${i + 1}`, p.lat ?? null, p.lng ?? null, baseOrder + i + 1);
        const placeId = pr.lastInsertRowid as number;
        for (const mid of (p.mediaIds || [])) {
          const shared = db.prepare("SELECT 1 FROM media WHERE id = ? AND visibility = 'shared'").get(mid);
          if (shared) insItem.run(albumId, mid, placeId);
        }
      });
    });
    tx();
    recomputeAlbum(albumId);
    return { ok: true };
  });

  // 장소 수정
  app.patch('/api/places/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    const place = db.prepare('SELECT * FROM trip_places WHERE id = ?').get(parseInt(id)) as any;
    if (!place) return reply.code(404).send({ error: 'Not found' });
    const { name, lat, lng, sortOrder } = request.body as { name?: string; lat?: number; lng?: number; sortOrder?: number };
    db.prepare('UPDATE trip_places SET name = ?, lat = ?, lng = ?, sortOrder = ? WHERE id = ?').run(
      name?.trim() || place.name,
      lat === undefined ? place.lat : lat,
      lng === undefined ? place.lng : lng,
      sortOrder === undefined ? place.sortOrder : sortOrder,
      parseInt(id),
    );
    return db.prepare('SELECT id, name, lat, lng, startAt, endAt, sortOrder FROM trip_places WHERE id = ?').get(parseInt(id));
  });

  // 장소 삭제 (소속 미디어는 미배정으로 — placeId SET NULL)
  app.delete('/api/places/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    const place = db.prepare('SELECT albumId FROM trip_places WHERE id = ?').get(parseInt(id)) as any;
    if (!place) return reply.code(404).send({ error: 'Not found' });
    db.prepare('DELETE FROM trip_places WHERE id = ?').run(parseInt(id));
    recomputeAlbum(place.albumId);
    return { ok: true };
  });

  // 기간/장소시간 재집계
  app.post('/api/albums/:id/recompute', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!db.prepare('SELECT id FROM albums WHERE id = ?').get(parseInt(id))) return reply.code(404).send({ error: 'Not found' });
    recomputeAlbum(parseInt(id));
    return { ok: true };
  });

  // 개인 → 공유 전환 (+선택 시 여행에 배정). 본인 소유 개인사진만.
  app.post('/api/media/promote-to-shared', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { userId } = (request as any).user;
    const { mediaIds, albumId } = request.body as { mediaIds: number[]; albumId?: number | null };
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) return reply.code(400).send({ error: '선택된 미디어 없음' });

    const ph = placeholders(mediaIds.length);
    const upd = db.prepare(`UPDATE media SET visibility = 'shared', ownerId = NULL WHERE id IN (${ph}) AND visibility = 'private' AND ownerId = ?`)
      .run(...mediaIds, userId);

    let added = 0;
    if (albumId) {
      if (!db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId)) return reply.code(404).send({ error: '여행 없음' });
      const ins = db.prepare("INSERT OR IGNORE INTO album_items (albumId, mediaId) SELECT ?, ? WHERE EXISTS(SELECT 1 FROM media WHERE id = ? AND visibility = 'shared')");
      const tx = db.transaction((arr: number[]) => { for (const mid of arr) added += ins.run(albumId, mid, mid).changes; });
      tx(mediaIds);
      recomputeAlbum(albumId);
    }
    return { ok: true, promoted: upd.changes, addedToAlbum: added };
  });

  // GPS 시공간 클러스터링 → 장소 제안 (사용자가 이름만 입력하면 됨)
  app.post('/api/albums/suggest-places', { preHandler: authenticate }, async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const { mediaIds } = request.body as { mediaIds: number[] };
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) return reply.code(400).send({ error: '선택된 미디어 없음' });

    const rows = db.prepare(`
      SELECT id, lat, lng, COALESCE(takenAt, createdAt) as t FROM media
      WHERE id IN (${placeholders(mediaIds.length)}) AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY t ASC
    `).all(...mediaIds) as { id: number; lat: number; lng: number; t: string }[];

    const DIST = 300; // m
    const GAP = 2 * 3600 * 1000; // 2h
    type Cluster = { lat: number; lng: number; n: number; startAt: string; endAt: string; mediaIds: number[] };
    const clusters: Cluster[] = [];
    for (const r of rows) {
      const tMs = new Date(r.t.replace(' ', 'T')).getTime();
      let placed = false;
      for (const c of clusters) {
        const lastMs = new Date(c.endAt.replace(' ', 'T')).getTime();
        if (haversineM(c.lat, c.lng, r.lat, r.lng) < DIST && tMs - lastMs < GAP) {
          c.lat = (c.lat * c.n + r.lat) / (c.n + 1);
          c.lng = (c.lng * c.n + r.lng) / (c.n + 1);
          c.n += 1;
          c.endAt = r.t;
          c.mediaIds.push(r.id);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ lat: r.lat, lng: r.lng, n: 1, startAt: r.t, endAt: r.t, mediaIds: [r.id] });
    }

    const withGps = new Set(rows.map(r => r.id));
    const noGps = mediaIds.filter(id => !withGps.has(id));
    return {
      clusters: clusters.map((c, i) => ({ suggestedName: `장소 ${i + 1}`, lat: c.lat, lng: c.lng, startAt: c.startAt, endAt: c.endAt, mediaIds: c.mediaIds })),
      noGpsMediaIds: noGps,
    };
  });
}
