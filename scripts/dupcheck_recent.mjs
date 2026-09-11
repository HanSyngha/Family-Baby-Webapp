// READ-ONLY: 최근 업로드 중복 백업 점검. 아무것도 수정하지 않음.
// 그룹 기준: 같은 uploaderId + takenAt + width + height (= 같은 사진일 강한 신호).
// 2차 dedup(uploaderId+size+takenAt+w+h 정확일치)을 통과해버린(=size나 hash가 다른) 중복을 찾는다.
import Database from 'better-sqlite3';

const DB = process.argv[2] || '/app/data/peanut-family.db';
const SINCE = process.argv[3] || '2026-06-01';   // 대청소 이후
const db = new Database(DB, { readonly: true });

const recentTotal = db.prepare(`SELECT COUNT(*) c FROM media WHERE createdAt >= ?`).get(SINCE).c;
const grandTotal = db.prepare(`SELECT COUNT(*) c FROM media`).get().c;
console.log(`DB=${DB}`);
console.log(`전체 media: ${grandTotal} | ${SINCE} 이후 생성: ${recentTotal}`);

// 1) 정확 중복(2차 dedup가 막았어야 함) — 0이어야 정상
const exact = db.prepare(`
  SELECT uploaderId, size, takenAt, width, height, COUNT(*) c, GROUP_CONCAT(id) ids
  FROM media WHERE createdAt >= ? AND takenAt IS NOT NULL
  GROUP BY uploaderId, size, takenAt, width, height HAVING c > 1
`).all(SINCE);
let exactExtra = 0; exact.forEach(g => exactExtra += g.c - 1);
console.log(`\n[1] 정확 중복(uploaderId+size+takenAt+w+h 동일) 그룹: ${exact.length}, 잉여본: ${exactExtra}`);

// 2) 같은 사진 의심(uploaderId+takenAt+w+h 동일, size/hash는 다를 수 있음)
const soft = db.prepare(`
  SELECT uploaderId, takenAt, width, height, COUNT(*) c,
         GROUP_CONCAT(id) ids, GROUP_CONCAT(size) sizes,
         GROUP_CONCAT(substr(hash,1,10)) hashes, GROUP_CONCAT(type) types,
         GROUP_CONCAT(visibility) vis, GROUP_CONCAT(source) src
  FROM media WHERE createdAt >= ? AND takenAt IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL
  GROUP BY uploaderId, takenAt, width, height HAVING c > 1
`).all(SINCE);
let softExtra = 0; soft.forEach(g => softExtra += g.c - 1);
console.log(`[2] 같은사진 의심(uploaderId+takenAt+w+h 동일) 그룹: ${soft.length}, 잉여본: ${softExtra}`);

// 분류: 정확중복 제외하고 size/hash가 갈리는 "진짜 의심" 그룹만
const suspicious = soft.filter(g => {
  const sizes = new Set(g.sizes.split(','));
  const hashes = new Set(g.hashes.split(','));
  return sizes.size > 1 || hashes.size > 1;
});
let suspExtra = 0; suspicious.forEach(g => suspExtra += g.c - 1);
console.log(`[3] size/hash가 다른 의심 그룹: ${suspicious.length}, 잉여본: ${suspExtra}`);

console.log(`\n--- 의심 그룹 샘플(최대 25) ---`);
for (const g of suspicious.slice(0, 25)) {
  console.log(`uploader=${g.uploaderId} takenAt=${g.takenAt} ${g.width}x${g.height} c=${g.c} ids=[${g.ids}] sizes=[${g.sizes}] hashes=[${g.hashes}] vis=[${g.vis}] src=[${g.src}]`);
}

// 4) uploaderId 별 분포
const byUploader = db.prepare(`
  SELECT u.name, m.uploaderId, COUNT(*) c
  FROM media m LEFT JOIN users u ON u.id = m.uploaderId
  WHERE m.createdAt >= ? GROUP BY m.uploaderId ORDER BY c DESC
`).all(SINCE);
console.log(`\n--- ${SINCE} 이후 업로더별 ---`);
byUploader.forEach(r => console.log(`  ${r.name || '?'}(#${r.uploaderId}): ${r.c}`));

db.close();
