#!/usr/bin/env node
// Build a deletion/quarantine plan from completed orphan audits.
// Read-only: writes JSON reports only, does not move or delete files.

const fs = require('fs');
const path = require('path');

const DATA = process.env.DATA_DIR || '/app/data';
const OUT = process.env.OUT_DIR || path.join(DATA, 'orphan_audit');
const BYTE_PATH = path.join(OUT, 'byte_audit.jsonl');
const VALIDATE_PATH = path.join(OUT, 'validate_audit.jsonl');
const RECOVERY_PATH = path.join(OUT, 'recovery_candidates_audit.jsonl');
const PLAN_PATH = path.join(OUT, 'cleanup_plan.json');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function gb(bytes) {
  return +(bytes / 1073741824).toFixed(3);
}

function summarize(rows) {
  return {
    count: rows.length,
    gb: gb(rows.reduce((sum, r) => sum + (r.size || 0), 0)),
  };
}

const byteRows = readJsonl(BYTE_PATH);
const validateRows = readJsonl(VALIDATE_PATH);
const recoveryRows = readJsonl(RECOVERY_PATH);

const byRecoveryClass = new Map();
for (const row of recoveryRows) {
  if (!byRecoveryClass.has(row.classification)) byRecoveryClass.set(row.classification, []);
  byRecoveryClass.get(row.classification).push(row);
}

const byteDuplicates = byteRows.filter((r) =>
  r.classification === 'byte_duplicate_of_existing_media' &&
  exists(r.path)
);
const invalid = validateRows.filter((r) =>
  r.classification === 'invalid_or_truncated' &&
  exists(r.path)
);
const visualDuplicates = recoveryRows.filter((r) =>
  (r.classification === 'visual_duplicate_of_existing_media' ||
   r.classification === 'visual_duplicate_of_recovery_candidate' ||
   r.classification === 'byte_duplicate_of_recovery_candidate') &&
  exists(r.path)
);
const preserve = [
  ...validateRows.filter((r) => r.classification === 'inconclusive_preserve'),
  ...recoveryRows.filter((r) =>
    r.classification === 'recover_candidate' ||
    r.classification === 'recovery_audit_error_preserve' ||
    r.classification === 'inconclusive_preserve_not_recovered'
  ),
];

const trashDir = path.join(DATA, '_dup_trash');
let trashFiles = 0;
let trashBytes = 0;
if (exists(trashDir)) {
  for (const name of fs.readdirSync(trashDir)) {
    const p = path.join(trashDir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) {
        trashFiles++;
        trashBytes += st.size;
      }
    } catch {}
  }
}

const plan = {
  generatedAt: new Date().toISOString(),
  dataDir: DATA,
  readOnly: true,
  safeToDeleteAfterRecoveryAndUserConfirmation: {
    byteDuplicates: summarize(byteDuplicates),
    invalidOrTruncated: summarize(invalid),
    visualDuplicates: summarize(visualDuplicates),
    existingDupTrash: { count: trashFiles, gb: gb(trashBytes), path: trashDir },
  },
  preserveOrRecover: {
    recoverCandidates: summarize(byRecoveryClass.get('recover_candidate') || []),
    recoveryAuditErrors: summarize(byRecoveryClass.get('recovery_audit_error_preserve') || []),
    inconclusive: summarize(preserve.filter((r) =>
      r.classification === 'inconclusive_preserve' ||
      r.classification === 'inconclusive_preserve_not_recovered'
    )),
  },
  requiredBeforeDeletion: [
    'Run recover_orphan_media.cjs in dry-run and live mode for recover_candidate rows.',
    'Verify recovered rows are visible in the intended personal/shared scope.',
    'Re-run inventory to confirm recovered files are no longer DB-orphaned.',
    'Get explicit user confirmation before deleting NAS data or _dup_trash.',
  ],
};

fs.writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));
console.log(JSON.stringify(plan, null, 2));
