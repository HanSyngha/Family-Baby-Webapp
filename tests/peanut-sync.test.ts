import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reconcilePeanutReferences } from '../server/peanut-sync.js';

function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peanut-sync-test-'));
  fs.mkdirSync(path.join(dir, 'originals'));
  const db = new Database(':memory:');
  const peanut = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE media (id INTEGER PRIMARY KEY, filename TEXT, originalName TEXT, hash TEXT,
      source TEXT, visibility TEXT DEFAULT 'shared', ownerId INTEGER, externalShared INTEGER DEFAULT 0);
    CREATE TABLE likes (mediaId INTEGER REFERENCES media(id) ON DELETE CASCADE);
    CREATE TABLE album_items (mediaId INTEGER REFERENCES media(id) ON DELETE CASCADE);
  `);
  peanut.exec('CREATE TABLE media (id INTEGER PRIMARY KEY, filename TEXT, hash TEXT, source TEXT)');
  t.after(() => { db.close(); peanut.close(); fs.rmSync(dir, { recursive: true }); });
  const file = (name: string) => fs.writeFileSync(path.join(dir, 'originals', name), 'same photo');
  const run = () => reconcilePeanutReferences(db, peanut, dir);
  return { db, peanut, dir, file, run };
}

test('deleting the first duplicate keeps the family id, interactions and publication settings', t => {
  const { db, peanut, file, run } = fixture(t);
  db.exec(`INSERT INTO media VALUES (10, 'old.jpg', 'photo.jpg', 'same', 'peanut', 'shared', NULL, 1);
    INSERT INTO likes VALUES (10); INSERT INTO album_items VALUES (10)`);
  // 새 업로드는 hash 중복이라 sync 커서만 전진한 상태. 예전 원본/행은 이미 삭제됨.
  peanut.exec("INSERT INTO media VALUES (2, 'new.jpg', 'same', 'local')");
  file('new.jpg');
  run();
  assert.deepEqual(db.prepare('SELECT * FROM media').get(), {
    id: 10, filename: 'new.jpg', originalName: 'photo.jpg', hash: 'same', source: 'peanut',
    visibility: 'shared', ownerId: null, externalShared: 1,
  });
  assert.equal((db.prepare('SELECT COUNT(*) n FROM likes').get() as any).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM album_items').get() as any).n, 1);
  run(); // 반복 동기화로 중복 행을 만들지 않음
  assert.equal((db.prepare('SELECT COUNT(*) n FROM media').get() as any).n, 1);
});

test('relinking keeps private photos private and ignores missing or family-backed duplicates', t => {
  const { db, peanut, file, run } = fixture(t);
  db.exec("INSERT INTO media VALUES (10, 'old.jpg', 'photo.jpg', 'same', 'peanut', 'private', 3, 0)");
  peanut.exec(`INSERT INTO media VALUES (1, 'missing.jpg', 'same', 'local');
    INSERT INTO media VALUES (2, 'circular.jpg', 'same', 'family');
    INSERT INTO media VALUES (3, 'valid.jpg', 'same', 'local')`);
  file('circular.jpg'); file('valid.jpg');
  run();
  assert.deepEqual(db.prepare('SELECT filename, visibility, ownerId, externalShared FROM media').get(),
    { filename: 'valid.jpg', visibility: 'private', ownerId: 3, externalShared: 0 });
});

test('actual deletions are pruned, but existing references and local originals are retained', t => {
  const { db, peanut, file, run } = fixture(t);
  db.exec(`INSERT INTO media (id, filename, hash, source) VALUES
    (1, 'gone.jpg', 'gone', 'peanut'), (2, 'in-db.jpg', 'db', 'peanut'),
    (3, 'on-disk.jpg', 'disk', 'peanut'), (4, 'local.jpg', 'local', 'local'),
    (5, 'unknown.jpg', NULL, 'peanut')`);
  peanut.exec("INSERT INTO media VALUES (1, 'in-db.jpg', 'db', 'local')");
  file('on-disk.jpg');
  run();
  assert.deepEqual(db.prepare('SELECT id FROM media ORDER BY id').all(), [{ id: 2 }, { id: 3 }, { id: 4 }]);
});

test('a possible mount outage does not mass-delete family rows', t => {
  const { db, run } = fixture(t);
  for (let i = 1; i <= 21; i++) db.prepare("INSERT INTO media (id, filename, source) VALUES (?, ?, 'peanut')").run(i, `${i}.jpg`);
  run();
  assert.equal((db.prepare('SELECT COUNT(*) n FROM media').get() as any).n, 21);
});
