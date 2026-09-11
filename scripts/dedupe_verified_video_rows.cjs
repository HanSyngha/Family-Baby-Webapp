#!/usr/bin/env node
// Source-aware verified video DB dedupe.
// Only frame-signature-identical videos are deduped. Files are kept unless
// DELETE_FILES=1 is set; default live mode removes DB rows only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const Database = require('better-sqlite3');

const DATA = process.env.DATA_DIR || '/app/data';
const PEANUT_DATA = process.env.PEANUT_DATA_DIR || '/app/data-peanut';
const DRY = process.env.DRY_RUN !== '0';
const DELETE_FILES = process.env.DELETE_FILES === '1';
if (!DRY && process.env.CONFIRM_VIDEO_DEDUPE !== 'YES') {
  console.error('Live video dedupe requires DRY_RUN=0 CONFIRM_VIDEO_DEDUPE=YES');
  process.exit(2);
}

function mediaPath(row) {
  const base = row.source === 'peanut' ? PEANUT_DATA : DATA;
  return path.join(base, 'originals', row.filename);
}

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function frameHash(file, at) {
  const out = cp.execFileSync('ffmpeg', [
    '-v', 'error', '-ss', String(Math.max(0, at)), '-i', file,
    '-frames:v', '1', '-vf', 'scale=320:-1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { timeout: 120000, maxBuffer: 256 * 1024 * 1024 });
  return sha(out);
}

function videoSig(file, duration) {
  const dur = Number(duration || 0);
  const points = dur > 2 ? [0.5, dur * 0.25, dur * 0.5, dur * 0.75, Math.max(0.5, dur - 0.5)] : [0];
  return sha(Buffer.from(points.map((p) => frameHash(file, p)).join('|')));
}

function score(row) {
  return (
    (row.visibility === 'shared' ? 10000 : 0) +
    (row.source === 'peanut' ? 1000 : 0) +
    (row.albums || 0) * 100 +
    (row.likes || 0) * 10 +
    (row.comments || 0) * 10 -
    row.id / 1000000
  );
}

const db = new Database(path.join(DATA, 'peanut-family.db'));
db.pragma('busy_timeout = 30000');
const groups = db.prepare(`
  SELECT uploaderId, size, width, height, CAST(duration*10 AS INTEGER) dur10, COUNT(*) c
  FROM media
  WHERE type='video' AND size IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND duration IS NOT NULL
  GROUP BY uploaderId, size, width, height, dur10 HAVING c>1
`).all();

const repoint = db.transaction((from, to) => {
  for (const table of ['views','downloads','likes','comments','favorites','shares','album_items']) {
    try {
      db.prepare(`UPDATE OR IGNORE ${table} SET mediaId=? WHERE mediaId=?`).run(to, from);
      db.prepare(`DELETE FROM ${table} WHERE mediaId=?`).run(from);
    } catch {}
  }
});

const delMedia = db.prepare('DELETE FROM media WHERE id=?');
const actions = [];
let compareErrors = 0;

for (const g of groups) {
  const rows = db.prepare(`
    SELECT id, filename, COALESCE(source,'local') source, size, width, height, duration,
           visibility, uploaderId, ownerId,
           (SELECT COUNT(*) FROM album_items WHERE mediaId=media.id) albums,
           (SELECT COUNT(*) FROM likes WHERE mediaId=media.id) likes,
           (SELECT COUNT(*) FROM comments WHERE mediaId=media.id) comments
    FROM media
    WHERE type='video' AND uploaderId=? AND size=? AND width=? AND height=? AND CAST(duration*10 AS INTEGER)=?
  `).all(g.uploaderId, g.size, g.width, g.height, g.dur10)
    .filter((r) => fs.existsSync(mediaPath(r)));

  const buckets = new Map();
  for (const row of rows) {
    try {
      const sig = videoSig(mediaPath(row), row.duration);
      if (!buckets.has(sig)) buckets.set(sig, []);
      buckets.get(sig).push(row);
    } catch {
      compareErrors++;
    }
  }
  for (const set of buckets.values()) {
    if (set.length < 2) continue;
    set.sort((a, b) => score(b) - score(a));
    const keep = set[0];
    for (const dup of set.slice(1)) {
      actions.push({ keepId: keep.id, deleteId: dup.id, deleteFilename: dup.filename, keepFilename: keep.filename });
      if (!DRY) {
        repoint(dup.id, keep.id);
        delMedia.run(dup.id);
        if (DELETE_FILES && dup.source !== 'peanut') {
          for (const p of [path.join(DATA, 'originals', dup.filename), path.join(DATA, 'thumbnails', dup.filename + '.webp')]) {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          }
        }
      }
    }
  }
}

const summary = {
  mode: DRY ? 'DRY_RUN' : 'LIVE',
  candidateGroups: groups.length,
  verifiedDuplicateRows: actions.length,
  compareErrors,
  deleteFiles: DELETE_FILES,
  actions,
};
fs.writeFileSync(path.join(DATA, 'orphan_audit', 'dedupe_verified_video_rows_result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
db.close();
