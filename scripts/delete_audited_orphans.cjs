#!/usr/bin/env node
// Delete audited orphan/trash files only after explicit confirmation.
//
// Default is DRY_RUN=1. Live mode requires:
//   DRY_RUN=0 CONFIRM_DELETE_NAS_DATA=YES
//
// Safety gates:
//   - never deletes a file currently referenced by a local media row
//   - only deletes paths under /app/data/originals, /app/data/thumbnails,
//     /app/data/hls, or /app/data/_dup_trash
//   - uses completed audit classifications as input

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA = process.env.DATA_DIR || '/app/data';
const OUT = process.env.OUT_DIR || path.join(DATA, 'orphan_audit');
const DRY = process.env.DRY_RUN !== '0';

if (!DRY && process.env.CONFIRM_DELETE_NAS_DATA !== 'YES') {
  console.error('Live delete requires DRY_RUN=0 CONFIRM_DELETE_NAS_DATA=YES');
  process.exit(2);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function under(p, dir) {
  const rel = path.relative(dir, p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function gb(bytes) {
  return +(bytes / 1073741824).toFixed(3);
}

function addFile(map, file, reason) {
  if (!fs.existsSync(file)) return;
  const allowed = [
    path.join(DATA, 'originals'),
    path.join(DATA, 'thumbnails'),
    path.join(DATA, 'hls'),
    path.join(DATA, '_dup_trash'),
  ].some((dir) => under(file, dir));
  if (!allowed) throw new Error(`Refusing unsafe path: ${file}`);
  const st = fs.statSync(file);
  if (st.isDirectory()) return;
  map.set(file, { file, reason, bytes: st.size });
}

const db = new Database(path.join(DATA, 'peanut-family.db'), { readonly: true });
const localRefs = new Set(
  db.prepare("SELECT filename FROM media WHERE COALESCE(source, 'local') != 'peanut'")
    .all()
    .map((r) => r.filename)
);

const targets = new Map();
const byteRows = readJsonl(path.join(OUT, 'byte_audit.jsonl'));
const validateRows = readJsonl(path.join(OUT, 'validate_audit.jsonl'));
const recoveryRows = readJsonl(path.join(OUT, 'recovery_candidates_audit.jsonl'));
const dbDedupe = fs.existsSync(path.join(OUT, 'dedupe_db_rows_keep_files_result.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'dedupe_db_rows_keep_files_result.json'), 'utf8'))
  : { actions: [] };

function addMediaArtifacts(filename, reason) {
  if (localRefs.has(filename)) return;
  addFile(targets, path.join(DATA, 'originals', filename), reason);
  addFile(targets, path.join(DATA, 'thumbnails', filename + '.webp'), `${reason}:thumb`);
  const hls = path.join(DATA, 'hls', filename);
  if (fs.existsSync(hls)) {
    for (const name of fs.readdirSync(hls)) addFile(targets, path.join(hls, name), `${reason}:hls`);
  }
}

for (const row of byteRows) {
  if (row.classification === 'byte_duplicate_of_existing_media') addMediaArtifacts(row.filename, 'byte_duplicate_of_existing_media');
}
for (const row of validateRows) {
  if (row.classification === 'invalid_or_truncated') addMediaArtifacts(row.filename, 'invalid_or_truncated');
}
for (const row of recoveryRows) {
  if (
    row.classification === 'visual_duplicate_of_existing_media' ||
    row.classification === 'visual_duplicate_of_recovery_candidate' ||
    row.classification === 'byte_duplicate_of_recovery_candidate'
  ) {
    addMediaArtifacts(row.filename, row.classification);
  }
}
for (const action of dbDedupe.actions || []) {
  if (action.action === 'delete_db_row_keep_file') addMediaArtifacts(action.deleteFilename, 'db_row_deduped_file');
}

const trashDir = path.join(DATA, '_dup_trash');
if (fs.existsSync(trashDir)) {
  for (const name of fs.readdirSync(trashDir)) {
    addFile(targets, path.join(trashDir, name), 'existing_dup_trash');
  }
}

let deleted = 0;
let deletedBytes = 0;
let errors = 0;
const byReason = {};
for (const target of targets.values()) {
  byReason[target.reason] = byReason[target.reason] || { count: 0, bytes: 0 };
  byReason[target.reason].count++;
  byReason[target.reason].bytes += target.bytes;
  if (!DRY) {
    try {
      fs.unlinkSync(target.file);
      deleted++;
      deletedBytes += target.bytes;
    } catch {
      errors++;
    }
  }
}

const summary = {
  mode: DRY ? 'DRY_RUN' : 'LIVE',
  targetFiles: targets.size,
  targetGB: gb([...targets.values()].reduce((sum, r) => sum + r.bytes, 0)),
  deleted,
  deletedGB: gb(deletedBytes),
  errors,
  byReason: Object.fromEntries(Object.entries(byReason).map(([k, v]) => [k, { count: v.count, gb: gb(v.bytes) }])),
};
fs.writeFileSync(path.join(OUT, 'delete_audited_orphans_result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
db.close();
