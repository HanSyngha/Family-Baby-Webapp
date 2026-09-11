#!/bin/sh
set -eu

OUT_DIR="${OUT_DIR:-/app/data/orphan_audit}"
SCRIPT="$OUT_DIR/audit_orphan_media.cjs"

echo "[$(date -Iseconds)] supervisor started"

while :; do
  if node - "$OUT_DIR/byte_summary.json" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
if (!fs.existsSync(file)) process.exit(1);
const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
process.exit(summary.auditedRows === summary.candidates ? 0 : 1);
NODE
  then
    break
  fi
  sleep 300
done

echo "[$(date -Iseconds)] byte phase complete; starting validate"
PHASE=validate \
OUT_DIR="$OUT_DIR" \
PROGRESS_EVERY="${PROGRESS_EVERY:-200}" \
FULL_DECODE="${FULL_DECODE:-1}" \
FULL_DECODE_TIMEOUT_MS="${FULL_DECODE_TIMEOUT_MS:-600000}" \
node "$SCRIPT" >> "$OUT_DIR/validate_run.log" 2>&1
echo "[$(date -Iseconds)] validate phase finished"
