#!/usr/bin/env node
// Build a conservative recovery manifest from validate_audit.jsonl.
//
// Principle: recover/preserve unless duplicate proof is strong. Byte duplicates
// were already removed from this input. Here we only suppress recovery for:
//   - quick-hash collision/match rows that were not byte-verified
//   - videos whose sampled frames and duration match an existing DB item
//   - duplicate videos/images within the recovery set confirmed by signatures
//
// Images are not compared against thousands of existing DB images here. If they
// are not byte duplicates, recovering them is safer than hiding possible lost
// files.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const sharp = require('sharp');
const Database = require('better-sqlite3');

const DATA = process.env.DATA_DIR || '/app/data';
const PEANUT_DATA = process.env.PEANUT_DATA_DIR || '/app/data-peanut';
const OUT = process.env.OUT_DIR || path.join(DATA, 'orphan_audit');
const VALIDATE_PATH = path.join(OUT, 'validate_audit.jsonl');
const REPORT_PATH = path.join(OUT, 'recovery_candidates_audit.jsonl');
const SUMMARY_PATH = path.join(OUT, 'recovery_candidates_summary.json');

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonl(file, row) {
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

function gb(bytes) {
  return +(bytes / 1073741824).toFixed(3);
}

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function mediaPath(row) {
  const base = row.source === 'peanut' ? PEANUT_DATA : DATA;
  return path.join(base, 'originals', row.filename);
}

function frameHash(file, at) {
  const out = cp.execFileSync('ffmpeg', [
    '-v', 'error',
    '-ss', String(Math.max(0, at)),
    '-i', file,
    '-frames:v', '1',
    '-vf', 'scale=320:-1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-',
  ], { timeout: 120000, maxBuffer: 256 * 1024 * 1024 });
  return sha(out);
}

function videoSig(file, duration) {
  const dur = Number(duration || 0);
  const points = dur > 2
    ? [0.5, dur * 0.25, dur * 0.5, dur * 0.75, Math.max(0.5, dur - 0.5)]
    : [0];
  const hashes = points.map((p) => frameHash(file, p));
  return sha(Buffer.from(hashes.join('|')));
}

async function imageSmallSig(file) {
  const metadata = await sharp(file, { failOn: 'none' }).rotate().metadata();
  const raw = await sharp(file, { failOn: 'none' })
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer();
  return {
    width: metadata.width || null,
    height: metadata.height || null,
    channels: metadata.channels || null,
    hash: sha(raw),
  };
}

function closeDuration(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.08;
}

async function main() {
  const db = new Database(path.join(DATA, 'peanut-family.db'), { readonly: true });
  const media = db.prepare(`
    SELECT id, filename, COALESCE(source, 'local') AS source, type, width, height,
           duration, visibility, uploaderId
    FROM media
  `).all();

  const validRows = readJsonl(VALIDATE_PATH)
    .filter((r) => r.classification === 'valid_non_byte_duplicate_preserve_or_recover');
  const inconclusiveRows = readJsonl(VALIDATE_PATH)
    .filter((r) => r.classification === 'inconclusive_preserve');

  fs.writeFileSync(REPORT_PATH, '');

  const videoRecoveryReps = new Map();
  const imageRecoveryReps = new Map();
  const smallFullHashReps = new Map();

  let n = 0;
  for (const row of validRows) {
    n++;
    let classification = 'recover_candidate';
    let duplicateOf = null;
    let error = null;

    try {
      if (row.size <= 4 * 1024 * 1024 && row.quickHash) {
        if (smallFullHashReps.has(row.quickHash)) {
          classification = 'byte_duplicate_of_recovery_candidate';
          duplicateOf = { filename: smallFullHashReps.get(row.quickHash) };
        } else {
          smallFullHashReps.set(row.quickHash, row.filename);
        }
      } else if (row.kind === 'video') {
        const sig = videoSig(row.path, row.validation.duration);
        const existing = media.filter((m) =>
          m.type === 'video' &&
          m.width === row.validation.width &&
          m.height === row.validation.height &&
          closeDuration(m.duration, row.validation.duration) &&
          fs.existsSync(mediaPath(m))
        );
        for (const m of existing) {
          try {
            if (videoSig(mediaPath(m), m.duration) === sig) {
              classification = 'visual_duplicate_of_existing_media';
              duplicateOf = { id: m.id, filename: m.filename, source: m.source, visibility: m.visibility, uploaderId: m.uploaderId };
              break;
            }
          } catch {}
        }
        if (!duplicateOf) {
          const key = `${row.validation.width}x${row.validation.height}:${Number(row.validation.duration || 0).toFixed(2)}:${sig}`;
          if (videoRecoveryReps.has(key)) {
            classification = 'visual_duplicate_of_recovery_candidate';
            duplicateOf = { filename: videoRecoveryReps.get(key) };
          } else {
            if (row.quickHashMatches && row.quickHashMatches.length > 0) {
              classification = 'recover_candidate_quick_hash_collision';
            }
            videoRecoveryReps.set(key, row.filename);
          }
        }
      } else if (row.kind === 'image') {
        try {
          const sig = await imageSmallSig(row.path);
          const key = `${sig.width}x${sig.height}:${sig.channels}:${sig.hash}`;
          if (imageRecoveryReps.has(key)) {
            classification = 'visual_duplicate_of_recovery_candidate';
            duplicateOf = { filename: imageRecoveryReps.get(key) };
          } else {
            imageRecoveryReps.set(key, row.filename);
          }
        } catch (e) {
          // HEIC/partially decodable images may be valid via ffprobe but not
          // decodable by sharp. Recovering is safer than hiding data.
          classification = 'recover_candidate';
          error = `image_signature_skipped: ${String(e?.stderr || e).slice(0, 300)}`;
        }
      }
    } catch (e) {
      classification = 'recovery_audit_error_preserve';
      error = String(e?.stderr || e).slice(0, 1000);
    }

    appendJsonl(REPORT_PATH, {
      filename: row.filename,
      path: row.path,
      kind: row.kind,
      size: row.size,
      mtime: row.mtime,
      validation: row.validation,
      classification,
      duplicateOf,
      error,
    });
    if (n % 10 === 0) console.log(`[finalize] ${n}/${validRows.length}`);
  }

  for (const row of inconclusiveRows) {
    appendJsonl(REPORT_PATH, {
      filename: row.filename,
      path: row.path,
      kind: row.kind,
      size: row.size,
      mtime: row.mtime,
      validation: row.validation,
      classification: 'inconclusive_preserve_not_recovered',
      duplicateOf: null,
      error: null,
    });
  }

  const report = readJsonl(REPORT_PATH);
  const byClass = {};
  const bytesByClass = {};
  for (const row of report) {
    byClass[row.classification] = (byClass[row.classification] || 0) + 1;
    bytesByClass[row.classification] = (bytesByClass[row.classification] || 0) + (row.size || 0);
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    validInput: validRows.length,
    inconclusiveInput: inconclusiveRows.length,
    byClass,
    gbByClass: Object.fromEntries(Object.entries(bytesByClass).map(([k, v]) => [k, gb(v)])),
    output: REPORT_PATH,
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
