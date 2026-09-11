#!/usr/bin/env node
// Recover audited orphan media into the media table.
//
// Default is DRY_RUN=1. Live mode requires DRY_RUN=0 CONFIRM_RECOVER=YES.
// Only rows classified as recover_candidate by audit_recovery_candidates.cjs
// are inserted. Visual duplicates, invalid files, and inconclusive files are
// preserved on disk but not inserted.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const sharp = require('sharp');
const Database = require('better-sqlite3');

const DATA = process.env.DATA_DIR || '/app/data';
const OUT = process.env.OUT_DIR || path.join(DATA, 'orphan_audit');
const REPORT_PATH = path.join(OUT, 'recovery_candidates_audit.jsonl');
const RESULT_PATH = path.join(OUT, 'recover_orphan_media_result.json');
const DRY = process.env.DRY_RUN !== '0';
const OWNER_ID = Number(process.env.RECOVERY_OWNER_ID || 1);
const VISIBILITY = process.env.RECOVERY_VISIBILITY || 'private';
const RECOVER_CLASSES = new Set((process.env.RECOVER_CLASSES || 'recover_candidate').split(',').map((s) => s.trim()).filter(Boolean));
const CHUNK = 4 * 1024 * 1024;

if (!DRY && process.env.CONFIRM_RECOVER !== 'YES') {
  console.error('Live recovery requires DRY_RUN=0 CONFIRM_RECOVER=YES');
  process.exit(2);
}
if (!['private', 'shared'].includes(VISIBILITY)) {
  console.error(`Invalid RECOVERY_VISIBILITY=${VISIBILITY}`);
  process.exit(2);
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function nowKst() {
  return new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

function mtimeKst(file) {
  const st = fs.statSync(file);
  return new Date(st.mtimeMs + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

function mimeType(filename, kind) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.3gp': 'video/3gpp',
  };
  return map[ext] || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
}

function quickHash(file, size) {
  const h = crypto.createHash('sha256');
  if (size <= CHUNK) {
    h.update(fs.readFileSync(file));
  } else {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(CHUNK);
      const tail = Buffer.alloc(CHUNK);
      fs.readSync(fd, head, 0, CHUNK, 0);
      fs.readSync(fd, tail, 0, CHUNK, size - CHUNK);
      h.update(head);
      h.update(tail);
      const sizeBuf = Buffer.alloc(8);
      sizeBuf.writeDoubleBE(size);
      h.update(sizeBuf);
    } finally {
      fs.closeSync(fd);
    }
  }
  return h.digest('hex');
}

function fullHash(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

async function ensureThumbnail(row) {
  const src = row.path;
  const thumb = path.join(DATA, 'thumbnails', row.filename + '.webp');
  if (fs.existsSync(thumb)) return;
  if (DRY) return;

  if (row.kind === 'image') {
    try {
      await sharp(src, { failOn: 'none' })
        .rotate()
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumb);
    } catch {
      const tmp = path.join(DATA, 'thumbnails', row.filename + '_tmp.jpg');
      try {
        cp.execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vframes', '1', '-vf', 'scale=300:-1', '-y', tmp], {
          timeout: 120000,
          maxBuffer: 32 * 1024 * 1024,
        });
        await sharp(tmp).webp({ quality: 80 }).toFile(thumb);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    }
    return;
  }

  const tmp = path.join(DATA, 'thumbnails', row.filename + '_tmp.jpg');
  try {
    cp.execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vframes', '1', '-vf', 'scale=300:-1', '-y', tmp], {
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
    });
    await sharp(tmp).webp({ quality: 80 }).toFile(thumb);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

async function main() {
  const db = new Database(path.join(DATA, 'peanut-family.db'));
  db.pragma('busy_timeout = 30000');
  db.exec(`CREATE TABLE IF NOT EXISTS orphan_recovery_log (
    filename TEXT PRIMARY KEY,
    mediaId INTEGER,
    status TEXT NOT NULL,
    hash TEXT,
    error TEXT,
    processedAt TEXT DEFAULT (datetime('now', '+9 hours'))
  )`);

  const owner = db.prepare('SELECT id, role, name FROM users WHERE id = ?').get(OWNER_ID);
  if (!owner || owner.role !== 'master') {
    throw new Error(`RECOVERY_OWNER_ID=${OWNER_ID} is not a master user`);
  }

  const rows = readJsonl(REPORT_PATH).filter((r) => RECOVER_CLASSES.has(r.classification));
  const insert = db.prepare(`
    INSERT INTO media (
      uploaderId, filename, originalName, mimeType, type, size, width, height,
      duration, hash, createdAt, uploadedAt, takenAt, source, visibility, ownerId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)
  `);
  const log = db.prepare('INSERT OR REPLACE INTO orphan_recovery_log(filename, mediaId, status, hash, error) VALUES (?, ?, ?, ?, ?)');
  const findFilename = db.prepare('SELECT id FROM media WHERE filename = ?');
  const findHash = db.prepare('SELECT id FROM media WHERE hash = ?');

  let inserted = 0;
  let dupHash = 0;
  let already = 0;
  let thumbErrors = 0;
  let errors = 0;
  const planned = [];
  const seenHashes = new Map();
  const now = nowKst();

  for (const row of rows) {
    try {
      if (!fs.existsSync(row.path)) {
        errors++;
        log.run(row.filename, null, DRY ? 'dry_nofile' : 'nofile', null, 'file missing');
        continue;
      }
      const size = fs.statSync(row.path).size;
      let hash = quickHash(row.path, size);
      const existingFilename = findFilename.get(row.filename);
      if (existingFilename) {
        already++;
        log.run(row.filename, existingFilename.id, DRY ? 'dry_already_exists' : 'already_exists', hash, null);
        continue;
      }
      let existingHash = findHash.get(hash);
      if (existingHash && (
        row.classification === 'recover_candidate_quick_hash_collision' ||
        row.classification === 'inconclusive_preserve_not_recovered'
      )) {
        hash = 'full:' + fullHash(row.path);
        existingHash = findHash.get(hash);
      }
      if (existingHash) {
        dupHash++;
        log.run(row.filename, existingHash.id, DRY ? 'dry_dup_hash' : 'dup_hash', hash, null);
        continue;
      }
      if (seenHashes.has(hash)) {
        dupHash++;
        log.run(row.filename, null, DRY ? 'dry_dup_hash_in_batch' : 'dup_hash_in_batch', hash, `duplicate of ${seenHashes.get(hash)}`);
        continue;
      }
      seenHashes.set(hash, row.filename);

      const createdAt = row.validation?.probe?.format?.tags?.creation_time
        ? new Date(new Date(row.validation.probe.format.tags.creation_time).getTime() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19)
        : mtimeKst(row.path);
      const ownerId = VISIBILITY === 'private' ? OWNER_ID : null;
      planned.push({
        filename: row.filename,
        kind: row.kind,
        size,
        hash,
        createdAt,
        visibility: VISIBILITY,
        ownerId,
      });
      if (DRY) {
        inserted++;
        log.run(row.filename, null, 'dry_insert', hash, null);
        continue;
      }

      try {
        await ensureThumbnail(row);
      } catch (e) {
        thumbErrors++;
        log.run(row.filename, null, 'thumb_error', hash, String(e?.stderr || e));
        continue;
      }

      const result = insert.run(
        OWNER_ID,
        row.filename,
        row.filename,
        mimeType(row.filename, row.kind),
        row.kind,
        size,
        row.validation.width ?? null,
        row.validation.height ?? null,
        row.validation.duration ?? null,
        hash,
        createdAt,
        now,
        createdAt,
        VISIBILITY,
        ownerId,
      );
      inserted++;
      log.run(row.filename, result.lastInsertRowid, 'inserted', hash, null);
    } catch (e) {
      errors++;
      try { log.run(row.filename, null, DRY ? 'dry_error' : 'error', null, String(e?.stderr || e)); } catch {}
    }
  }
  const summary = {
    mode: DRY ? 'DRY_RUN' : 'LIVE',
    owner,
    visibility: VISIBILITY,
    recoverClasses: [...RECOVER_CLASSES],
    inputRecoverCandidates: rows.length,
    wouldInsertOrInserted: inserted,
    already,
    dupHash,
    thumbErrors,
    errors,
    plannedSample: planned.slice(0, 20),
  };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
