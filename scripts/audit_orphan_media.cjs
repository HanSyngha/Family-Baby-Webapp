#!/usr/bin/env node
// Read-only orphan media audit for peanut-family.
//
// Phases:
//   PHASE=inventory  Fast source-aware DB/filesystem inventory.
//   PHASE=byte       Exact byte-duplicate check for inventory candidates.
//   PHASE=validate   Decode/structure validation for non-byte-duplicates.
//
// Output is written under /app/data/orphan_audit by default. No media/DB rows
// are modified or deleted.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const Database = require('better-sqlite3');

const DATA = process.env.DATA_DIR || '/app/data';
const PEANUT_DATA = process.env.PEANUT_DATA_DIR || '/app/data-peanut';
const OUT = process.env.OUT_DIR || path.join(DATA, 'orphan_audit');
const PHASE = process.env.PHASE || 'inventory';
const CHUNK = 4 * 1024 * 1024;
const PROGRESS_EVERY = Math.max(1, Number(process.env.PROGRESS_EVERY || 250));

const ORIGINALS = path.join(DATA, 'originals');
const DB_PATH = path.join(DATA, 'peanut-family.db');
const INVENTORY_PATH = path.join(OUT, 'inventory.json');
const CANDIDATES_PATH = path.join(OUT, 'orphan_candidates.jsonl');
const BYTE_PATH = path.join(OUT, 'byte_audit.jsonl');
const VALIDATE_PATH = path.join(OUT, 'validate_audit.jsonl');

fs.mkdirSync(OUT, { recursive: true });

function now() {
  return new Date().toISOString();
}

function appendJsonl(file, row) {
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

function gb(bytes) {
  return +(bytes / 1073741824).toFixed(3);
}

function statFile(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    return { size: st.size, mtime: st.mtime.toISOString() };
  } catch {
    return null;
  }
}

function sourceDir(source) {
  return source === 'peanut' ? PEANUT_DATA : DATA;
}

function mediaPath(row) {
  return path.join(sourceDir(row.source), 'originals', row.filename);
}

function quickHash(file, size) {
  const hash = crypto.createHash('sha256');
  if (size <= CHUNK) {
    hash.update(fs.readFileSync(file));
  } else {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(CHUNK);
      const tail = Buffer.alloc(CHUNK);
      fs.readSync(fd, head, 0, CHUNK, 0);
      fs.readSync(fd, tail, 0, CHUNK, size - CHUNK);
      hash.update(head);
      hash.update(tail);
      const sizeBuf = Buffer.alloc(8);
      sizeBuf.writeDoubleBE(size);
      hash.update(sizeBuf);
    } finally {
      fs.closeSync(fd);
    }
  }
  return hash.digest('hex');
}

function byteEqual(a, b) {
  const as = fs.statSync(a);
  const bs = fs.statSync(b);
  if (as.size !== bs.size) return false;
  const ab = fs.openSync(a, 'r');
  const bb = fs.openSync(b, 'r');
  const left = Buffer.alloc(1024 * 1024);
  const right = Buffer.alloc(1024 * 1024);
  try {
    let pos = 0;
    while (pos < as.size) {
      const len = Math.min(left.length, as.size - pos);
      fs.readSync(ab, left, 0, len, pos);
      fs.readSync(bb, right, 0, len, pos);
      if (!left.subarray(0, len).equals(right.subarray(0, len))) return false;
      pos += len;
    }
    return true;
  } finally {
    fs.closeSync(ab);
    fs.closeSync(bb);
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function loadMedia() {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(`
      SELECT id, filename, originalName, hash, COALESCE(source, 'local') AS source,
             type, size, width, height, duration, visibility, uploaderId, ownerId,
             createdAt, uploadedAt, takenAt
      FROM media
    `).all();
  } finally {
    db.close();
  }
}

function phaseInventory() {
  const media = loadMedia();
  const localRows = media.filter((r) => r.source !== 'peanut');
  const externalRows = media.filter((r) => r.source === 'peanut');
  const localReferenced = new Set(localRows.map((r) => r.filename));
  const externalReferenced = new Set(externalRows.map((r) => r.filename));

  const files = fs.readdirSync(ORIGINALS).filter((f) => statFile(path.join(ORIGINALS, f)));
  const candidates = [];
  const managed = [];
  const shadowedExternal = [];
  let originalsBytes = 0;
  let candidateBytes = 0;
  let managedBytes = 0;

  fs.writeFileSync(CANDIDATES_PATH, '');
  for (const filename of files) {
    const full = path.join(ORIGINALS, filename);
    const st = statFile(full);
    originalsBytes += st.size;

    if (localReferenced.has(filename)) {
      managed.push(filename);
      managedBytes += st.size;
      continue;
    }

    const reason = externalReferenced.has(filename)
      ? 'local_file_shadowed_by_external_source_row'
      : 'not_referenced_by_local_media_row';
    if (reason === 'local_file_shadowed_by_external_source_row') shadowedExternal.push(filename);
    const row = { filename, path: full, size: st.size, mtime: st.mtime, reason };
    candidates.push(row);
    candidateBytes += st.size;
    appendJsonl(CANDIDATES_PATH, row);
  }

  const missingManaged = [];
  const missingExternal = [];
  for (const r of localRows) {
    if (!statFile(mediaPath(r))) missingManaged.push(r);
  }
  for (const r of externalRows) {
    if (!statFile(mediaPath(r))) missingExternal.push(r);
  }

  const summary = {
    phase: 'inventory',
    generatedAt: now(),
    dataDir: DATA,
    peanutDataDir: PEANUT_DATA,
    mediaRows: media.length,
    localRows: localRows.length,
    externalPeanutRows: externalRows.length,
    originalsFiles: files.length,
    originalsGB: gb(originalsBytes),
    managedLocalFiles: managed.length,
    managedLocalGB: gb(managedBytes),
    orphanCandidates: candidates.length,
    orphanCandidatesGB: gb(candidateBytes),
    shadowedExternalFiles: shadowedExternal.length,
    missingManagedRows: missingManaged.length,
    missingExternalRows: missingExternal.length,
    files: {
      candidates: CANDIDATES_PATH,
      byteAudit: BYTE_PATH,
      validateAudit: VALIDATE_PATH,
    },
  };

  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'missing_managed_rows.json'), JSON.stringify(missingManaged, null, 2));
  fs.writeFileSync(path.join(OUT, 'missing_external_rows.json'), JSON.stringify(missingExternal, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

function phaseByte() {
  if (!fs.existsSync(INVENTORY_PATH) || !fs.existsSync(CANDIDATES_PATH)) phaseInventory();
  const media = loadMedia();
  const byHash = new Map();
  for (const r of media) {
    if (!r.hash) continue;
    if (!byHash.has(r.hash)) byHash.set(r.hash, []);
    byHash.get(r.hash).push(r);
  }

  const candidates = readJsonl(CANDIDATES_PATH);
  const done = new Set(readJsonl(BYTE_PATH).map((r) => r.filename));
  let checked = done.size;
  let byteDuplicates = 0;
  let quickOnly = 0;
  let unique = 0;
  let errors = 0;

  for (const c of candidates) {
    if (done.has(c.filename)) continue;
    checked++;
    try {
      const h = quickHash(c.path, c.size);
      const matches = byHash.get(h) || [];
      let exact = null;
      const matchSummaries = [];
      for (const m of matches) {
        const target = mediaPath(m);
        const st = statFile(target);
        matchSummaries.push({ id: m.id, filename: m.filename, source: m.source, exists: !!st, size: st?.size ?? null });
        if (!st || st.size !== c.size) continue;
        if (byteEqual(c.path, target)) {
          exact = { id: m.id, filename: m.filename, source: m.source };
          break;
        }
      }
      const classification = exact
        ? 'byte_duplicate_of_existing_media'
        : matches.length
          ? 'quick_hash_match_but_not_byte_verified'
          : 'quick_hash_unique';
      if (exact) byteDuplicates++;
      else if (matches.length) quickOnly++;
      else unique++;
      appendJsonl(BYTE_PATH, { ...c, quickHash: h, classification, exactDuplicateOf: exact, quickHashMatches: matchSummaries });
    } catch (e) {
      errors++;
      appendJsonl(BYTE_PATH, { ...c, classification: 'hash_error', error: String(e) });
    }
    if (checked % PROGRESS_EVERY === 0) {
      console.log(`[${now()}] byte progress ${checked}/${candidates.length}`);
    }
  }

  const rows = readJsonl(BYTE_PATH);
  const summary = {
    phase: 'byte',
    generatedAt: now(),
    candidates: candidates.length,
    auditedRows: rows.length,
    byteDuplicates: rows.filter((r) => r.classification === 'byte_duplicate_of_existing_media').length,
    quickHashOnly: rows.filter((r) => r.classification === 'quick_hash_match_but_not_byte_verified').length,
    quickHashUnique: rows.filter((r) => r.classification === 'quick_hash_unique').length,
    hashErrors: rows.filter((r) => r.classification === 'hash_error').length,
    currentRun: { checked, byteDuplicates, quickOnly, unique, errors },
    output: BYTE_PATH,
  };
  fs.writeFileSync(path.join(OUT, 'byte_summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

function extType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const image = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.dng', '.tif', '.tiff', '.bmp']);
  const video = new Set(['.mp4', '.mov', '.m4v', '.3gp', '.avi', '.mkv', '.webm']);
  if (image.has(ext)) return 'image';
  if (video.has(ext)) return 'video';
  return 'unknown';
}

function ffprobe(file) {
  const out = cp.execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height,duration',
    '-of', 'json',
    file,
  ], { timeout: 60000, maxBuffer: 1024 * 1024 * 4 });
  return JSON.parse(out.toString());
}

function validateImage(file, filename, size) {
  const ext = path.extname(filename).toLowerCase();
  if ((ext === '.jpg' || ext === '.jpeg') && size >= 2) {
    const fd = fs.openSync(file, 'r');
    try {
      const tail = Buffer.alloc(2);
      fs.readSync(fd, tail, 0, 2, size - 2);
      if (tail[0] !== 0xff || tail[1] !== 0xd9) {
        return { valid: false, reason: 'jpeg_missing_eoi_marker' };
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  const probe = ffprobe(file);
  const stream = (probe.streams || []).find((s) => s.codec_type === 'video');
  if (!stream?.width || !stream?.height) return { valid: false, reason: 'no_decodable_image_dimensions', probe };
  return { valid: true, width: stream.width, height: stream.height, probe };
}

function validateVideo(file) {
  const probe = ffprobe(file);
  const stream = (probe.streams || []).find((s) => s.codec_type === 'video');
  const duration = Number(probe.format?.duration || stream?.duration || 0);
  if (!stream?.width || !stream?.height || !Number.isFinite(duration) || duration <= 0.05) {
    return { valid: false, reason: 'no_valid_video_stream_or_duration', probe };
  }
  if (process.env.FULL_DECODE === '1') {
    try {
      cp.execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], {
        timeout: Number(process.env.FULL_DECODE_TIMEOUT_MS || 300000),
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (e) {
      if (e?.signal === 'SIGTERM' || e?.code === 'ETIMEDOUT') {
        return { valid: null, reason: 'full_decode_timeout_inconclusive', width: stream.width, height: stream.height, duration, probe };
      }
      return {
        valid: false,
        reason: 'full_decode_error',
        width: stream.width,
        height: stream.height,
        duration,
        error: String(e?.stderr || e),
        probe,
      };
    }
  }
  return { valid: true, width: stream.width, height: stream.height, duration, probe };
}

function phaseValidate() {
  if (!fs.existsSync(BYTE_PATH)) phaseByte();
  const byteRows = readJsonl(BYTE_PATH).filter((r) => r.classification !== 'byte_duplicate_of_existing_media');
  const done = new Set(readJsonl(VALIDATE_PATH).map((r) => r.filename));
  let checked = done.size;

  for (const r of byteRows) {
    if (done.has(r.filename)) continue;
    checked++;
    const kind = extType(r.filename);
    try {
      let validation;
      if (kind === 'image') validation = validateImage(r.path, r.filename, r.size);
      else if (kind === 'video') validation = validateVideo(r.path);
      else validation = { valid: true, reason: 'unknown_extension_preserve' };
      const classification = validation.valid === true
        ? 'valid_non_byte_duplicate_preserve_or_recover'
        : validation.valid === false
          ? 'invalid_or_truncated'
          : 'inconclusive_preserve';
      appendJsonl(VALIDATE_PATH, { ...r, kind, classification, validation });
    } catch (e) {
      appendJsonl(VALIDATE_PATH, { ...r, kind, classification: 'invalid_or_truncated', validation: { valid: false, reason: 'decode_or_probe_error', error: String(e) } });
    }
    if (checked % PROGRESS_EVERY === 0) {
      console.log(`[${now()}] validate progress ${checked}/${byteRows.length}`);
    }
  }

  const rows = readJsonl(VALIDATE_PATH);
  const summary = {
    phase: 'validate',
    generatedAt: now(),
    auditedRows: rows.length,
    validPreserveOrRecover: rows.filter((r) => r.classification === 'valid_non_byte_duplicate_preserve_or_recover').length,
    invalidOrTruncated: rows.filter((r) => r.classification === 'invalid_or_truncated').length,
    inconclusivePreserve: rows.filter((r) => r.classification === 'inconclusive_preserve').length,
    output: VALIDATE_PATH,
    fullDecode: process.env.FULL_DECODE === '1',
  };
  fs.writeFileSync(path.join(OUT, 'validate_summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

if (PHASE === 'inventory') phaseInventory();
else if (PHASE === 'byte') phaseByte();
else if (PHASE === 'validate') phaseValidate();
else if (PHASE === 'all') {
  phaseInventory();
  phaseByte();
  phaseValidate();
} else {
  console.error(`Unknown PHASE=${PHASE}`);
  process.exit(2);
}
