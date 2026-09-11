// 원본 파일이 실제로 없는 media 행 삭제 (손상영상 파일삭제 후 남은 orphan DB행).
// 안전장치: 파일이 존재하면 절대 삭제 안 함. DRY_RUN=1 이면 카운트만.
import Database from 'better-sqlite3';
import fs from 'fs';
const DRY = process.env.DRY_RUN === '1';
const db = new Database('/app/data/peanut-family.db');
db.pragma('busy_timeout = 30000');
const all = db.prepare("SELECT id, filename FROM media").all();
const orphans = all.filter(r => !fs.existsSync('/app/data/originals/' + r.filename));
let deleted = 0;
if (!DRY) {
  const del = db.prepare('DELETE FROM media WHERE id = ?');
  const tx = db.transaction(rows => { for (const r of rows) deleted += del.run(r.id).changes; });
  tx(orphans);
}
const after = db.prepare("SELECT COUNT(*) c FROM media").get().c;
const vid = db.prepare("SELECT COUNT(*) c FROM media WHERE type='video'").get().c;
const img = db.prepare("SELECT COUNT(*) c FROM media WHERE type='image'").get().c;
fs.writeFileSync('/app/data/ORPHAN_RESULT.json', JSON.stringify({ mode: DRY ? 'DRY' : 'DELETED', orphansFound: orphans.length, deleted, mediaAfter: after, video: vid, image: img }));
db.close();
