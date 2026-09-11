import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('/app/data/peanut-family.db', { readonly: true });
// 단일 트랜잭션 = 일관된 스냅샷
const r = db.transaction(() => ({
  total: db.prepare("SELECT COUNT(*) c FROM media").get().c,
  video: db.prepare("SELECT COUNT(*) c FROM media WHERE type='video'").get().c,
  image: db.prepare("SELECT COUNT(*) c FROM media WHERE type='image'").get().c,
  otherType: db.prepare("SELECT COUNT(*) c FROM media WHERE type NOT IN ('video','image') OR type IS NULL").get().c,
  privCnt: db.prepare("SELECT COUNT(*) c FROM media WHERE visibility='private'").get().c,
  sharedCnt: db.prepare("SELECT COUNT(*) c FROM media WHERE visibility='shared'").get().c,
}))();
r.videoPlusImage = r.video + r.image;
fs.writeFileSync('/app/data/SNAP2.json', JSON.stringify(r));
