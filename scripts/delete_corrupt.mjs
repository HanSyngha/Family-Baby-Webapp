// 복구 불가(DEAD) 손상 영상 삭제. untrunc_report.tsv 의 DEAD 항목만.
// 안전장치: ① HLS 있으면(정상) 절대 삭제 안 함 ② ffprobe 통과하면(재생가능) 삭제 안 함
//           ③ DRY_RUN=1 이면 목록만 출력하고 실제 삭제 안 함
import Database from 'better-sqlite3';
import fs from 'fs';
import { execFileSync } from 'child_process';

const DRY = process.env.DRY_RUN === '1';
const DATA = '/app/data';
const report = fs.readFileSync(DATA + '/untrunc_report.tsv', 'utf8').trim().split('\n');
const deadNames = new Set(report.filter(l => l.split('\t')[1] === 'DEAD').map(l => l.split('\t')[0]));

const db = new Database(DATA + '/peanut-family.db'); // 쓰기 (삭제)
db.pragma('busy_timeout = 30000');

let deleted = 0, freedBytes = 0, skippedSafe = 0, err = 0;
const delMedia = db.prepare('DELETE FROM media WHERE id = ?');
const delLog = db.prepare("UPDATE migration_log SET status = 'deleted-corrupt' WHERE mediaId = ?");

for (const fn of deadNames) {
  const orig = DATA + '/originals/' + fn;
  // 안전장치 ①: HLS 있으면 정상 → 스킵
  if (fs.existsSync(DATA + '/hls/' + fn + '/playlist.m3u8')) { skippedSafe++; continue; }
  // 안전장치 ②: ffprobe 통과(재생가능)면 스킵
  try { execFileSync('ffprobe', ['-v', 'error', '-i', orig], { timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }); skippedSafe++; continue; } catch {}
  // media row 조회
  const row = db.prepare('SELECT id, size FROM media WHERE filename = ?').get(fn);
  if (!row) { err++; continue; }
  if (DRY) { deleted++; freedBytes += row.size || 0; continue; }
  try {
    const sz = fs.existsSync(orig) ? fs.statSync(orig).size : 0;
    if (fs.existsSync(orig)) fs.unlinkSync(orig);
    const thumb = DATA + '/thumbnails/' + fn + '.webp';
    if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    const hlsdir = DATA + '/hls/' + fn;
    if (fs.existsSync(hlsdir)) fs.rmSync(hlsdir, { recursive: true, force: true });
    delLog.run(row.id);
    delMedia.run(row.id);
    deleted++; freedBytes += sz;
  } catch (e) { err++; }
}
console.log(JSON.stringify({ mode: DRY ? 'DRY_RUN' : 'DELETED', deadInReport: deadNames.size, deleted, freedGB: +(freedBytes / 1e9).toFixed(2), skippedSafe, err }));
db.close();
