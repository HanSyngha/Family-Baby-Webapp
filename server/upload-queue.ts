import fs from 'fs';
import path from 'path';
import { processImage, processVideo } from './media-processor.js';
import { sendPushToOthers } from './push.js';
import { recomputeAlbum } from './routes/album.js';
import db from './db.js';

const DATA_DIR = path.resolve('data');

// dedup으로 INSERT를 건너뛸 때, 이미 만들어진 원본/썸네일/HLS 고아 파일 정리.
function cleanupOrphanFiles(filename: string) {
  try {
    const original = path.join(DATA_DIR, 'originals', filename);
    const thumb = path.join(DATA_DIR, 'thumbnails', filename + '.webp');
    const hls = path.join(DATA_DIR, 'hls', filename);
    if (fs.existsSync(original)) fs.unlinkSync(original);
    if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    if (fs.existsSync(hls)) fs.rmSync(hls, { recursive: true });
  } catch (e) { console.error('[Queue] orphan cleanup failed:', e); }
}

interface QueueItem {
  filename: string;
  originalName: string;
  mimeType: string;
  type: 'image' | 'video';
  size: number;
  uploaderId: number;
  hash: string;
  visibility?: string;
  ownerId?: number | null;
  albumId?: number | null;
}

interface RecentResult {
  filename: string;
  originalName: string;
  status: 'done' | 'error';
  error?: string;
  elapsed: number;
}

const queue: QueueItem[] = [];
let processing = false;
let current: { filename: string; originalName: string; startedAt: number } | null = null;
const recentResults: RecentResult[] = [];
const MAX_RECENT = 20;

export function getQueueStatus() {
  return {
    current,
    queue: queue.map(q => ({ filename: q.filename, originalName: q.originalName })),
    recentResults,
  };
}

export function enqueue(item: QueueItem) {
  queue.push(item);
  console.log(`[Queue] Added: ${item.originalName} (${(item.size / 1024 / 1024).toFixed(1)}MB) | queue size: ${queue.length}`);
  processNext();
}

async function processNext() {
  if (processing || queue.length === 0) return;
  processing = true;

  const item = queue.shift()!;
  const start = Date.now();
  current = { filename: item.filename, originalName: item.originalName, startedAt: start };
  console.log(`[Queue] Processing: ${item.originalName} (${item.type})`);

  try {
    const result = item.type === 'image'
      ? await processImage(item.filename)
      : await processVideo(item.filename);

    const elapsedSec = (Date.now() - start) / 1000;
    console.log(`[Queue] Processed: ${item.originalName} in ${elapsedSec.toFixed(1)}s | ${result.width}x${result.height} | takenAt: ${result.takenAt || 'none'}`);

    // 2차 dedup: 해시가 달라도(메타데이터만 차이) uploaderId+size+takenAt+가로+세로가 모두 같으면 같은 사진 → 스킵.
    // 다중키(특히 바이트 크기 정확 일치)라 다른 사진이 우연히 일치할 확률 ~0 → 진짜 새 사진을 떨굴 위험 없음.
    // (이관본↔백업본처럼 같은 사진이 다른 경로로 들어와 해시가 달라지는 경우를 막는다.)
    // 1차 hash dedup(레이스 방지): 업로드 엔드포인트의 hash 체크는 같은 파일이 거의 동시에 두 번 올라오면
    // 첫 행이 아직 큐에 있어 미삽입이라 둘 다 통과한다(특히 영상은 처리가 느려 창이 큼). 큐는 순차 처리이므로
    // 여기서 다시 hash로 확인하면 먼저 들어간 쌍을 잡는다. (영상 takenAt=null이라 2차로 못 막던 중복도 차단)
    const hashDup = item.hash ? db.prepare('SELECT id FROM media WHERE hash = ?').get(item.hash) as any : null;

    const dupExisting = hashDup ?? ((result.takenAt && result.width && result.height)
      ? db.prepare('SELECT id FROM media WHERE uploaderId = ? AND size = ? AND takenAt = ? AND width = ? AND height = ?')
          .get(item.uploaderId, item.size, result.takenAt, result.width, result.height) as any
      : null);

    if (dupExisting) {
      console.log(`[Queue] dedup 스킵: ${item.originalName} → 기존 #${dupExisting.id}와 동일(${hashDup ? 'hash' : '메타'})`);
      // 파일 삭제는 '바이트 동일(hash 일치)'일 때만. 메타데이터-only 매치는 오탐 가능성(연사 등)이 있어
      // 파일을 보존(고아로 남겨 분류 패스가 안전히 처리) → 실제 새 사진을 지우는 위험 제거.
      if (hashDup) cleanupOrphanFiles(item.filename);
    } else {
      const nowKst = new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
      const insertResult = db.prepare(`
        INSERT INTO media (uploaderId, filename, originalName, mimeType, type, size, width, height, duration, hash, createdAt, uploadedAt, takenAt, visibility, ownerId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.uploaderId,
        item.filename,
        item.originalName,
        item.mimeType,
        item.type,
        item.size,
        result.width ?? null,
        result.height ?? null,
        result.duration ?? null,
        item.hash,
        result.takenAt ?? nowKst,
        nowKst,
        result.takenAt ?? null,
        item.visibility ?? 'shared',
        item.ownerId ?? null,
      );

      // 수동 재업로드로 다시 살아났으면 삭제 묘비 해제(다음 백업 dedup이 정상 동작하게).
      if (item.hash) db.prepare('DELETE FROM deleted_hashes WHERE hash = ?').run(item.hash);

      // 여행 앨범 대상 업로드(#4)면 앨범에 추가
      if (item.albumId) {
        try {
          db.prepare('INSERT OR IGNORE INTO album_items (albumId, mediaId) VALUES (?, ?)').run(item.albumId, insertResult.lastInsertRowid as number);
          recomputeAlbum(item.albumId);   // 앨범 날짜범위/커버 갱신(addAlbumItems와 동일)
        } catch (e) { console.error('[Queue] album add failed:', e); }
      }

      console.log(`[Queue] DB inserted: ${item.originalName} | remaining: ${queue.length}`);

      recentResults.push({ filename: item.filename, originalName: item.originalName, status: 'done', elapsed: elapsedSec });
      if (recentResults.length > MAX_RECENT) recentResults.shift();

      const uploader = db.prepare('SELECT name FROM users WHERE id = ?').get(item.uploaderId) as any;
      const uploaderName = uploader?.name || '누군가';
      const typeLabel = item.type === 'image' ? '사진' : '영상';
      sendPushToOthers(item.uploaderId, `${uploaderName}님의 새로운 ${typeLabel}`, `${uploaderName}님이 올리신 새로운 땅콩땅콩 ${typeLabel}을 확인하세요! 🥜`);
    }
  } catch (err) {
    const elapsed = (Date.now() - start) / 1000;
    const errMsg = err instanceof Error ? err.message : String(err);
    recentResults.push({ filename: item.filename, originalName: item.originalName, status: 'error', error: errMsg, elapsed });
    if (recentResults.length > MAX_RECENT) recentResults.shift();
    console.error(`[Queue] FAILED: ${item.originalName}`, err);
    // 처리 실패 = DB 행 안 생김 → 원본/썸네일/HLS 고아로 남으므로 정리. (폰엔 원본 있어 다음에 재업로드됨)
    // ⚠️ INSERT 성공 후 단계(앨범/푸시)에서 throw된 경우 파일을 지우면 안 됨 → 행 존재 시 정리 생략.
    const inserted = db.prepare('SELECT 1 FROM media WHERE filename = ?').get(item.filename);
    if (!inserted) cleanupOrphanFiles(item.filename);
  }

  current = null;
  processing = false;
  processNext();
}
