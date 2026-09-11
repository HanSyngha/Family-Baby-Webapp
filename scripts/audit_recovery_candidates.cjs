#!/usr/bin/env node
// Read-only second-pass audit for valid orphan recovery candidates.
//
// This script tries to prevent false recovery of visual duplicates that are not
// byte-identical. It compares valid orphan candidates against existing DB media
// and against other valid orphan candidates using exact decoded pixels for
// images and deterministic sampled-frame hashes for videos.

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
const PROGRESS_EVERY = Math.max(1, Number(process.env.PROGRESS_EVERY || 10));

function now() {
  return new Date().toISOString();
}

function appendJsonl(file, row) {
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function gb(bytes) {
  return +(bytes / 1073741824).toFixed(3);
}

function mediaPath(row) {
  const base = row.source === 'peanut' ? PEANUT_DATA : DATA;
  return path.join(base, 'originals', row.filename);
}

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sourceSafe(row) {
  return row.source || 'local';
}

const db = new Database(path.join(DATA, 'peanut-family.db'), { readonly: true });
const mediaById = new Map();
const mediaRows = db.prepare(`
  SELECT id, filename, hash, COALESCE(source, 'local') AS source,
         type, size, width, height, duration, createdAt, takenAt,
         visibility, uploaderId, ownerId
  FROM media
`).all();
for (const row of mediaRows) mediaById.set(row.id, row);

const imageSigCache = new Map();
const videoSigCache = new Map();

async function imageSig(file, full = false) {
  const key = `${file}:${full ? 'full' : 'small'}`;
  if (imageSigCache.has(key)) return imageSigCache.get(key);
  const metadata = await sharp(file, { failOn: 'none' }).rotate().metadata();
  let pipe = sharp(file, { failOn: 'none' }).rotate();
  if (!full) pipe = pipe.resize(512, 512, { fit: 'inside', withoutEnlargement: true });
  const raw = await pipe.raw().toBuffer();
  const sig = {
    kind: 'image',
    width: metadata.width || null,
    height: metadata.height || null,
    channels: metadata.channels || null,
    full,
    rawSha256: sha(raw),
  };
  imageSigCache.set(key, sig);
  return sig;
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
  const key = `${file}:${duration}`;
  if (videoSigCache.has(key)) return videoSigCache.get(key);
  const dur = Number(duration || 0);
  const points = dur > 2
    ? [0.5, dur * 0.25, dur * 0.5, dur * 0.75, Math.max(0.5, dur - 0.5)]
    : [0];
  const hashes = points.map((p) => frameHash(file, p));
  const sig = {
    kind: 'video',
    duration: Number.isFinite(dur) ? +dur.toFixed(3) : null,
    frameSha256: hashes,
    combinedSha256: sha(Buffer.from(hashes.join('|'))),
  };
  videoSigCache.set(key, sig);
  return sig;
}

function sameImageSig(a, b) {
  return a.rawSha256 === b.rawSha256 && a.width === b.width && a.height === b.height && a.channels === b.channels;
}

function sameVideoSig(a, b, durationA, durationB) {
  if (Math.abs(Number(durationA || 0) - Number(durationB || 0)) > 0.08) return false;
  return a.combinedSha256 === b.combinedSha256;
}

function getExistingCandidates(candidate) {
  if (candidate.kind === 'image') {
    const w = candidate.validation.width;
    const h = candidate.validation.height;
    return mediaRows.filter((r) =>
      r.type === 'image' &&
      r.width === w &&
      r.height === h &&
      fs.existsSync(mediaPath(r))
    );
  }

  if (candidate.kind === 'video') {
    const w = candidate.validation.width;
    const h = candidate.validation.height;
    const d = Number(candidate.validation.duration || 0);
    return mediaRows.filter((r) =>
      r.type === 'video' &&
      r.width === w &&
      r.height === h &&
      Math.abs(Number(r.duration || 0) - d) <= 0.08 &&
      fs.existsSync(mediaPath(r))
    );
  }

  return [];
}

async function signatureFor(row, full = false) {
  const file = row.path || mediaPath(row);
  if (row.kind === 'image' || row.type === 'image') return imageSig(file, full);
  if (row.kind === 'video' || row.type === 'video') return videoSig(file, row.validation?.duration ?? row.duration);
  return null;
}

async function main() {
  const validateRows = readJsonl(VALIDATE_PATH);
  const valid = validateRows.filter((r) => r.classification === 'valid_non_byte_duplicate_preserve_or_recover');
  const inconclusive = validateRows.filter((r) => r.classification === 'inconclusive_preserve');

  fs.writeFileSync(REPORT_PATH, '');
  let processed = 0;
  const orphanRepresentatives = [];

  for (const row of valid) {
    processed++;
    let classification = 'recover_candidate';
    let duplicateOf = null;
    let comparedExisting = 0;
    let comparedOrphans = 0;
    let existingCompareErrors = 0;
    let error = null;

    try {
      const sig = await signatureFor(row);

      for (const existing of getExistingCandidates(row)) {
        comparedExisting++;
        let same = false;
        try {
          const existingSig = await signatureFor(existing);
          same = row.kind === 'image'
            ? sameImageSig(sig, existingSig)
            : sameVideoSig(sig, existingSig, row.validation.duration, existing.duration);
          if (same && row.kind === 'image') {
            // Small resized raw hash is only a fast filter. Confirm on full
            // decoded pixels before declaring a duplicate.
            same = sameImageSig(await signatureFor(row, true), await signatureFor(existing, true));
          }
        } catch {
          existingCompareErrors++;
        }
        if (same) {
          classification = 'visual_duplicate_of_existing_media';
          duplicateOf = {
            id: existing.id,
            filename: existing.filename,
            source: sourceSafe(existing),
            visibility: existing.visibility,
            uploaderId: existing.uploaderId,
          };
          break;
        }
      }

      if (!duplicateOf) {
        for (const rep of orphanRepresentatives) {
          if (rep.kind !== row.kind) continue;
          if (row.kind === 'video' && Math.abs(Number(row.validation.duration || 0) - Number(rep.duration || 0)) > 0.08) continue;
          if (row.kind === 'image' && (row.validation.width !== rep.width || row.validation.height !== rep.height)) continue;
          comparedOrphans++;
          let same = row.kind === 'image'
            ? sameImageSig(sig, rep.sig)
            : sameVideoSig(sig, rep.sig, row.validation.duration, rep.duration);
          if (same && row.kind === 'image') {
            same = sameImageSig(await signatureFor(row, true), rep.fullSig);
          }
          if (same) {
            classification = 'visual_duplicate_of_recovery_candidate';
            duplicateOf = { filename: rep.filename };
            break;
          }
        }
      }

      if (!duplicateOf) {
        orphanRepresentatives.push({
          filename: row.filename,
          kind: row.kind,
          width: row.validation.width,
          height: row.validation.height,
          duration: row.validation.duration,
          sig,
          fullSig: row.kind === 'image' ? await signatureFor(row, true) : sig,
        });
      }
    } catch (e) {
      classification = 'recovery_audit_error_preserve';
      error = String(e?.stderr || e);
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
      comparedExisting,
      comparedOrphans,
      existingCompareErrors,
      error,
    });

    if (processed % PROGRESS_EVERY === 0) {
      console.log(`[${now()}] recovery audit progress ${processed}/${valid.length}`);
    }
  }

  for (const row of inconclusive) {
    appendJsonl(REPORT_PATH, {
      filename: row.filename,
      path: row.path,
      kind: row.kind,
      size: row.size,
      mtime: row.mtime,
      validation: row.validation,
      classification: 'inconclusive_preserve_not_recovered',
      duplicateOf: null,
    });
  }

  const report = readJsonl(REPORT_PATH);
  const byClass = {};
  const bytesByClass = {};
  for (const r of report) {
    byClass[r.classification] = (byClass[r.classification] || 0) + 1;
    bytesByClass[r.classification] = (bytesByClass[r.classification] || 0) + (r.size || 0);
  }

  const summary = {
    generatedAt: now(),
    validInput: valid.length,
    inconclusiveInput: inconclusive.length,
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
  db.close();
  process.exit(1);
});
