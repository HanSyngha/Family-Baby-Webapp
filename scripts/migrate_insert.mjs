// Immich 이관 [2단계: 컨테이너] — 매니페스트 읽어 DB INSERT (한승하 개인). idempotent.
// docker cp 후: docker exec -w /app peanut-family-... node /tmp/migrate_insert.mjs
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA = '/app/data';
const OWNER_ID = 1; // 한승하
const db = new Database(path.join(DATA, 'peanut-family.db'));
db.pragma('busy_timeout = 30000');
db.exec(`CREATE TABLE IF NOT EXISTS migration_log (
  immichId TEXT PRIMARY KEY, mediaId INTEGER, status TEXT, hash TEXT, error TEXT,
  processedAt TEXT DEFAULT (datetime('now','+9 hours')))`);

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'immich-manifest.json'), 'utf8'));
const now = new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
const done = new Set(db.prepare("SELECT immichId FROM migration_log WHERE status IN ('done','dup')").all().map(r => r.immichId));

const ins = db.prepare(`INSERT INTO media
  (uploaderId, filename, originalName, mimeType, type, size, width, height, duration, hash,
   createdAt, uploadedAt, takenAt, source, visibility, ownerId, lat, lng, livePhotoGroup)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const logIns = db.prepare("INSERT OR REPLACE INTO migration_log(immichId,mediaId,status,hash) VALUES(?,?,?,?)");
const findHash = db.prepare("SELECT id FROM media WHERE hash=?");

let nIns = 0, nDup = 0, nSkip = 0, nErr = 0;
const tx = db.transaction((batch) => {
  for (const m of batch) {
    if (done.has(m.immichId)) { nSkip++; continue; }
    try {
      // 실제 파일이 없으면 INSERT 안 함 (깨진 레코드 방지). 재이관으로 채움.
      if (!fs.existsSync(path.join(DATA, 'originals', m.newName))) {
        logIns.run(m.immichId, null, 'nofile', m.hash);
        nErr++; continue;
      }
      const ex = m.hash ? findHash.get(m.hash) : null;
      if (ex) {
        const f = path.join(DATA, 'originals', m.newName);
        if (fs.existsSync(f)) fs.unlinkSync(f);
        logIns.run(m.immichId, ex.id, 'dup', m.hash);
        nDup++; continue;
      }
      const r = ins.run(OWNER_ID, m.newName, m.originalName, m.mime, m.type, m.size, m.width, m.height, null,
        m.hash, m.takenAt, now, m.takenAt, 'local', 'private', OWNER_ID, m.lat, m.lng, m.livePhotoGroup);
      logIns.run(m.immichId, r.lastInsertRowid, 'done', m.hash);
      nIns++;
    } catch (e) {
      nErr++; try { logIns.run(m.immichId, null, 'error', m.hash); } catch {}
      if (nErr <= 10) console.error('ins err', m.immichId, String(e).slice(0, 160));
    }
  }
});

for (let i = 0; i < manifest.length; i += 500) {
  tx(manifest.slice(i, i + 500));
  console.log(`[insert] ${Math.min(i + 500, manifest.length)}/${manifest.length}`);
}
console.log(`[insert] DONE ins=${nIns} dup=${nDup} skip=${nSkip} err=${nErr} manifest=${manifest.length}`);
db.close();
