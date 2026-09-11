import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('/app/data/peanut-family.db', { readonly: true });
// 실제 행을 순회하며 직접 카운트 (COUNT 인덱스 불신)
const rows = db.prepare("SELECT type FROM media").all();
let v = 0, i = 0, o = 0;
for (const r of rows) { if (r.type === 'video') v++; else if (r.type === 'image') i++; else o++; }
const countStar = db.prepare("SELECT COUNT(*) c FROM media").get().c;
const integrity = db.prepare("PRAGMA integrity_check").all();
const quick = db.prepare("PRAGMA quick_check").all();
fs.writeFileSync('/app/data/DBCHECK.json', JSON.stringify({
  iteratedRows: rows.length, byIter_video: v, byIter_image: i, byIter_other: o,
  countStar, integrity: integrity.slice(0, 3), quick: quick.slice(0, 3),
}));
