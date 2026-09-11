#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const apply = process.argv.includes('--apply');
const familyDbPath = process.env.FAMILY_DB || '/app/data/peanut-family.db';
const peanutDataDir = process.env.PEANUT_DATA_DIR || '/app/data-peanut';
const peanutDbPath = process.env.PEANUT_DB || path.join(peanutDataDir, 'peanut.db');

const familyDb = new Database(familyDbPath);
const peanutDb = new Database(peanutDbPath, { readonly: true });
familyDb.pragma('busy_timeout = 10000');

const existingByHash = familyDb.prepare(`
  SELECT id, visibility, uploaderId
  FROM media
  WHERE hash = ?
  ORDER BY CASE visibility WHEN 'shared' THEN 0 ELSE 1 END, id
`);
const promote = familyDb.prepare("UPDATE media SET visibility = 'shared', ownerId = NULL WHERE id = ?");
const insert = familyDb.prepare(`
  INSERT INTO media (uploaderId, filename, originalName, mimeType, type, size, width, height, duration, hash, createdAt, uploadedAt, takenAt, source, visibility, ownerId)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'peanut', 'shared', NULL)
`);
const setCursor = familyDb.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('peanut_last_id', ?)");
const getFamilyUser = familyDb.prepare('SELECT id FROM users WHERE provider = ? AND providerId = ?');
const insertFamilyUser = familyDb.prepare('INSERT INTO users (provider, providerId, name, profileImage, role) VALUES (?, ?, ?, ?, ?)');
const getPeanutUser = peanutDb.prepare('SELECT provider, providerId, name, profileImage, role FROM users WHERE id = ?');

const userCache = new Map();
function mapUser(peanutUserId) {
  if (userCache.has(peanutUserId)) return userCache.get(peanutUserId);
  const pUser = getPeanutUser.get(peanutUserId);
  if (!pUser) {
    userCache.set(peanutUserId, null);
    return null;
  }

  let ourUser = getFamilyUser.get(pUser.provider, pUser.providerId);
  if (!ourUser && apply) {
    const result = insertFamilyUser.run(pUser.provider, pUser.providerId, pUser.name, pUser.profileImage, pUser.role);
    ourUser = { id: Number(result.lastInsertRowid) };
  }

  const id = ourUser ? ourUser.id : null;
  userCache.set(peanutUserId, id);
  return id;
}

const stats = {
  apply,
  scanned: 0,
  alreadyShared: 0,
  wouldPromote: 0,
  promoted: 0,
  wouldInsert: 0,
  inserted: 0,
  missingFiles: 0,
  missingUsers: 0,
  maxId: 0,
};

const rows = peanutDb.prepare('SELECT * FROM media WHERE hash IS NOT NULL ORDER BY id ASC').all();

const run = familyDb.transaction(() => {
  for (const m of rows) {
    stats.scanned++;
    if (m.id > stats.maxId) stats.maxId = m.id;

    const existing = existingByHash.all(m.hash);
    if (existing.some(row => row.visibility === 'shared')) {
      stats.alreadyShared++;
      continue;
    }

    let mappedUserId;
    const getMappedUserId = () => {
      if (mappedUserId === undefined) mappedUserId = mapUser(m.uploaderId);
      return mappedUserId;
    };

    if (existing.length > 0) {
      stats.wouldPromote++;
      if (apply) {
        const userId = getMappedUserId();
        const target = (userId ? existing.find(row => row.uploaderId === userId) : undefined) || existing[0];
        promote.run(target.id);
        stats.promoted++;
      }
      continue;
    }

    const original = path.join(peanutDataDir, 'originals', m.filename);
    if (!fs.existsSync(original)) {
      stats.missingFiles++;
      continue;
    }

    const userId = getMappedUserId();
    if (!userId) {
      stats.missingUsers++;
      continue;
    }

    stats.wouldInsert++;
    if (apply) {
      insert.run(userId, m.filename, m.originalName, m.mimeType, m.type, m.size, m.width, m.height, m.duration, m.hash, m.createdAt, m.uploadedAt);
      stats.inserted++;
    }
  }

  if (apply && stats.maxId > 0) setCursor.run(String(stats.maxId));
});

run();
console.log(JSON.stringify(stats, null, 2));
