#!/usr/bin/env node
// Remove exact duplicate media DB rows while keeping files on disk.
// Live mode requires DRY_RUN=0 CONFIRM_DEDUPE=YES.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA = process.env.DATA_DIR || '/app/data';
const PEANUT_DATA = process.env.PEANUT_DATA_DIR || '/app/data-peanut';
const DRY = process.env.DRY_RUN !== '0';

if (!DRY && process.env.CONFIRM_DEDUPE !== 'YES') {
  console.error('Live dedupe requires DRY_RUN=0 CONFIRM_DEDUPE=YES');
  process.exit(2);
}

function mediaPath(row) {
  const base = row.source === 'peanut' ? PEANUT_DATA : DATA;
  return path.join(base, 'originals', row.filename);
}

function byteEqual(a, b) {
  const as = fs.statSync(a);
  const bs = fs.statSync(b);
  if (as.size !== bs.size) return false;
  const af = fs.openSync(a, 'r');
  const bf = fs.openSync(b, 'r');
  const ab = Buffer.alloc(1024 * 1024);
  const bb = Buffer.alloc(1024 * 1024);
  try {
    let pos = 0;
    while (pos < as.size) {
      const len = Math.min(ab.length, as.size - pos);
      fs.readSync(af, ab, 0, len, pos);
      fs.readSync(bf, bb, 0, len, pos);
      if (!ab.subarray(0, len).equals(bb.subarray(0, len))) return false;
      pos += len;
    }
    return true;
  } finally {
    fs.closeSync(af);
    fs.closeSync(bf);
  }
}

const db = new Database(path.join(DATA, 'peanut-family.db'));
db.pragma('busy_timeout = 30000');

const groups = db.prepare(`
  SELECT hash FROM media
  WHERE hash IS NOT NULL
  GROUP BY hash HAVING COUNT(*) > 1
`).all();

const engagementTables = ['views', 'downloads', 'likes', 'comments', 'favorites', 'shares', 'album_items'];
const repoint = db.transaction((from, to) => {
  for (const table of engagementTables) {
    try {
      db.prepare(`UPDATE OR IGNORE ${table} SET mediaId = ? WHERE mediaId = ?`).run(to, from);
      db.prepare(`DELETE FROM ${table} WHERE mediaId = ?`).run(from);
    } catch {}
  }
});

function score(row) {
  return (
    (row.visibility === 'shared' ? 1000 : 0) +
    (row.source === 'peanut' ? 100 : 0) +
    (row.albums || 0) * 50 +
    (row.likes || 0) * 10 +
    (row.comments || 0) * 10
  );
}

const actions = [];
let skipped = 0;
for (const group of groups) {
  const rows = db.prepare(`
    SELECT id, filename, COALESCE(source, 'local') source, type, size, visibility,
           uploaderId, ownerId, createdAt,
           (SELECT COUNT(*) FROM album_items WHERE mediaId=media.id) albums,
           (SELECT COUNT(*) FROM likes WHERE mediaId=media.id) likes,
           (SELECT COUNT(*) FROM comments WHERE mediaId=media.id) comments
    FROM media WHERE hash = ?
  `).all(group.hash);

  const withPath = rows.map((r) => ({ ...r, path: mediaPath(r), exists: fs.existsSync(mediaPath(r)) }));
  if (withPath.some((r) => !r.exists)) {
    skipped++;
    actions.push({ hash: group.hash, action: 'skip_missing_file', rows: withPath });
    continue;
  }

  withPath.sort((a, b) => score(b) - score(a) || a.id - b.id);
  const keeper = withPath[0];
  for (const row of withPath.slice(1)) {
    if (!byteEqual(keeper.path, row.path)) {
      skipped++;
      actions.push({ hash: group.hash, action: 'skip_not_byte_equal', keeper, duplicate: row });
      continue;
    }
    actions.push({ hash: group.hash, action: DRY ? 'dry_delete_db_row_keep_file' : 'delete_db_row_keep_file', keepId: keeper.id, deleteId: row.id, deleteFilename: row.filename });
    if (!DRY) {
      repoint(row.id, keeper.id);
      db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
    }
  }
}

const summary = {
  mode: DRY ? 'DRY_RUN' : 'LIVE',
  duplicateHashGroups: groups.length,
  plannedDeletes: actions.filter((a) => a.action.endsWith('delete_db_row_keep_file')).length,
  skipped,
  actions,
};
fs.writeFileSync(path.join(DATA, 'orphan_audit', 'dedupe_db_rows_keep_files_result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
db.close();
