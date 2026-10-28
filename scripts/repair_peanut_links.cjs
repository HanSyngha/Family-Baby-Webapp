#!/usr/bin/env node
// 명시한 친척앱 id만 복구한다. 기본은 조회, --apply 시 DB 백업 후 누락 행만 추가.
// 기존 공개 범위·삭제 묘비·동기화 커서·원본 파일은 변경하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

async function main() {
  const idArg = process.argv.find(arg => arg.startsWith('--ids='))?.slice(6);
  if (!idArg || !/^\d+(,\d+)*$/.test(idArg)) throw new Error('Usage: repair_peanut_links.cjs --ids=1,2 [--apply]');
  const ids = [...new Set(idArg.split(',').map(Number))];
  const apply = process.argv.includes('--apply');
  const familyPath = process.env.FAMILY_DB || '/app/data/peanut-family.db';
  const peanutDir = process.env.PEANUT_DATA_DIR || '/app/data-peanut';
  const db = new Database(familyPath, { readonly: !apply, fileMustExist: true });
  const peanut = new Database(path.join(peanutDir, 'peanut.db'), { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 10000');
  try {
    const candidates = [];
    for (const id of ids) {
      const row = peanut.prepare('SELECT * FROM media WHERE id = ?').get(id);
      if (!row || !row.hash || (row.source && row.source !== 'local')) throw new Error(`Invalid local peanut media: ${id}`);
      if (!fs.existsSync(path.join(peanutDir, 'originals', row.filename))) throw new Error(`Original missing: ${id}`);
      if (db.prepare('SELECT 1 FROM media WHERE hash = ? OR filename = ?').get(row.hash, row.filename)) continue;
      if (db.prepare('SELECT 1 FROM deleted_hashes WHERE hash = ?').get(row.hash)) throw new Error(`Explicitly deleted in family: ${id}`);
      const user = peanut.prepare('SELECT provider, providerId FROM users WHERE id = ?').get(row.uploaderId);
      const owner = user && db.prepare('SELECT id FROM users WHERE provider = ? AND providerId = ?').get(user.provider, user.providerId);
      if (!owner) throw new Error(`Family uploader not found: ${id}`);
      candidates.push({ row, uploaderId: owner.id });
    }
    console.log(JSON.stringify({ apply, candidates: candidates.map(({ row }) => ({ peanutId: row.id, originalName: row.originalName })) }));
    if (!apply || candidates.length === 0) return;
    const backupDir = path.join(path.dirname(familyPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `before-peanut-link-repair-${Date.now()}.db`);
    await db.backup(backup);
    console.log(`Backup: ${backup}`);
    const insert = db.prepare(`INSERT INTO media
      (uploaderId, filename, originalName, mimeType, type, size, width, height, duration, hash,
       createdAt, uploadedAt, takenAt, source, visibility, ownerId, externalShared)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'peanut', 'shared', NULL, 0)`);
    const repaired = db.transaction(() => {
      const result = [];
      for (const { row: m, uploaderId } of candidates) {
        // 조회/백업 중 정상 동기화가 먼저 끝났으면 중복 INSERT하지 않는다.
        if (db.prepare('SELECT 1 FROM media WHERE hash = ? OR filename = ?').get(m.hash, m.filename)) continue;
        if (db.prepare('SELECT 1 FROM deleted_hashes WHERE hash = ?').get(m.hash)) throw new Error(`Deleted during repair: ${m.id}`);
        const inserted = insert.run(uploaderId, m.filename, m.originalName, m.mimeType, m.type, m.size,
          m.width, m.height, m.duration, m.hash, m.createdAt, m.uploadedAt);
        result.push({ peanutId: m.id, familyId: Number(inserted.lastInsertRowid) });
      }
      return result;
    })();
    console.log(JSON.stringify({ repaired }));
  } finally { db.close(); peanut.close(); }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
