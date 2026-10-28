import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

interface PeanutReference {
  id: number;
  filename: string;
  originalName: string;
  hash: string | null;
}

// 중복 업로드 중 하나를 지워도 같은 내용의 원본이 남아 있으면 기존 family 행을 보존한다.
// id를 유지해야 좋아요·댓글·앨범·공개 범위도 함께 유지된다.
export function reconcilePeanutReferences(
  db: Database.Database,
  peanutDb: Database.Database,
  peanutDataDir: string,
) {
  const theirs = new Set((peanutDb.prepare('SELECT filename FROM media').all() as { filename: string }[]).map(r => r.filename));
  const exists = (filename: string) => fs.existsSync(path.join(peanutDataDir, 'originals', filename));
  const gone = (db.prepare("SELECT id, filename, originalName, hash FROM media WHERE source = 'peanut'").all() as PeanutReference[])
    .filter(r => !theirs.has(r.filename) && !exists(r.filename));
  const replacements = peanutDb.prepare("SELECT filename FROM media WHERE hash = ? AND (source IS NULL OR source = 'local') ORDER BY id");
  const relink = db.prepare("UPDATE media SET filename = ? WHERE id = ? AND source = 'peanut'");
  const missing: PeanutReference[] = [];
  let relinked = 0;

  for (const row of gone) {
    const replacement = row.hash
      ? (replacements.all(row.hash) as { filename: string }[]).find(r => exists(r.filename))
      : undefined;
    if (replacement) {
      relink.run(replacement.filename, row.id);
      relinked++;
    } else {
      missing.push(row);
    }
  }
  if (relinked > 0) console.log(`[Sync] Relinked ${relinked} family media to surviving peanut duplicates`);

  // 마운트 장애를 대량 삭제로 오인하지 않도록 기존 제한을 유지한다.
  const PRUNE_LIMIT = 20;
  if (missing.length > PRUNE_LIMIT) {
    console.warn(`[Sync] 구앱에서 사라진 사진 ${missing.length}장 — ${PRUNE_LIMIT}장 초과라 마운트 이상일 수 있어 지우지 않음`);
    return;
  }
  if (missing.length === 0) return;
  const del = db.prepare('DELETE FROM media WHERE id = ?');
  db.transaction(() => { for (const row of missing) del.run(row.id); })();
  console.log(`[Sync] 구앱에서 삭제된 ${missing.length}장 제거: ${missing.map(r => `${r.id}(${r.originalName})`).join(', ')}`);
}
