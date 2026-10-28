import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('repair is scoped, backed up, idempotent and respects explicit deletions', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peanut-repair-test-'));
  const peanutDir = path.join(dir, 'peanut');
  fs.mkdirSync(path.join(peanutDir, 'originals'), { recursive: true });
  const familyPath = path.join(dir, 'family.db');
  const db = new Database(familyPath);
  const peanut = new Database(path.join(peanutDir, 'peanut.db'));
  const mediaSchema = `CREATE TABLE media (id INTEGER PRIMARY KEY, uploaderId INTEGER, filename TEXT,
    originalName TEXT, mimeType TEXT, type TEXT, size INTEGER, width INTEGER, height INTEGER,
    duration REAL, hash TEXT, createdAt TEXT, uploadedAt TEXT, takenAt TEXT, source TEXT,
    visibility TEXT, ownerId INTEGER, externalShared INTEGER DEFAULT 0)`;
  const userSchema = 'CREATE TABLE users (id INTEGER PRIMARY KEY, provider TEXT, providerId TEXT)';
  db.exec(`${mediaSchema}; ${userSchema}; INSERT INTO users VALUES (3, 'kakao', 'owner');
    CREATE TABLE deleted_hashes (hash TEXT PRIMARY KEY);
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO sync_state VALUES ('peanut_last_id', '99')`);
  peanut.exec(`${mediaSchema}; ${userSchema}; INSERT INTO users VALUES (8, 'kakao', 'owner')`);
  for (const id of [1, 2, 3]) {
    peanut.prepare(`INSERT INTO media (id, uploaderId, filename, originalName, hash, source)
      VALUES (?, 8, ?, ?, ?, 'local')`).run(id, `${id}.jpg`, `${id}.jpg`, `hash-${id}`);
    fs.writeFileSync(path.join(peanutDir, 'originals', `${id}.jpg`), 'photo');
  }
  db.exec("INSERT INTO deleted_hashes VALUES ('hash-3')");
  t.after(() => { db.close(); peanut.close(); fs.rmSync(dir, { recursive: true }); });
  const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/repair_peanut_links.cjs', ...args], {
    encoding: 'utf8', env: { ...process.env, FAMILY_DB: familyPath, PEANUT_DATA_DIR: peanutDir },
  });
  assert.equal(run('--ids=1').status, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM media').get() as any).n, 0);
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  const applied = run('--ids=1', '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(db.prepare('SELECT filename, uploaderId, visibility, ownerId, externalShared FROM media').all(),
    [{ filename: '1.jpg', uploaderId: 3, visibility: 'shared', ownerId: null, externalShared: 0 }]);
  const backup = new Database(path.join(dir, 'backups', fs.readdirSync(path.join(dir, 'backups'))[0]), { readonly: true });
  assert.equal((backup.prepare('SELECT COUNT(*) n FROM media').get() as any).n, 0);
  backup.close();
  assert.equal(run('--ids=1', '--apply').status, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM media').get() as any).n, 1);
  assert.equal((db.prepare('SELECT value FROM sync_state').get() as any).value, '99');
  assert.equal(run('--ids=2,3', '--apply').status, 1); // 하나라도 삭제 묘비면 부분 복구 없이 중단
  assert.equal((db.prepare('SELECT COUNT(*) n FROM media').get() as any).n, 1);
  assert.equal(fs.readdirSync(path.join(peanutDir, 'originals')).length, 3);
});
