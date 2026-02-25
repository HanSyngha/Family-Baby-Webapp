import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve('data');
const DB_PATH = path.join(DATA_DIR, 'peanut-family.db');

// 데이터 디렉토리 생성
fs.mkdirSync(path.join(DATA_DIR, 'originals'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'thumbnails'), { recursive: true });

const db = new Database(DB_PATH);

// WAL 모드 + 성능 설정
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// ============================================================
// 기존 테이블 (갤러리 - 땅콩땅콩땅땅콩콩에서 복사)
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    providerId TEXT NOT NULL,
    name TEXT NOT NULL,
    profileImage TEXT,
    role TEXT DEFAULT 'member',
    createdAt TEXT DEFAULT (datetime('now', '+9 hours')),
    UNIQUE(provider, providerId)
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uploaderId INTEGER NOT NULL REFERENCES users(id),
    filename TEXT NOT NULL,
    originalName TEXT NOT NULL,
    mimeType TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration REAL,
    hash TEXT,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE TABLE IF NOT EXISTS views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mediaId INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mediaId INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now', '+9 hours')),
    UNIQUE(mediaId, userId)
  );

  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mediaId INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now', '+9 hours')),
    UNIQUE(mediaId, userId)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mediaId INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    keys TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mediaId INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours')),
    UNIQUE(mediaId, userId)
  );

  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mediaId INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_media_created ON media(createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_media_uploader ON media(uploaderId);
  CREATE INDEX IF NOT EXISTS idx_media_hash ON media(hash);
  CREATE INDEX IF NOT EXISTS idx_views_media ON views(mediaId);
  CREATE INDEX IF NOT EXISTS idx_downloads_media ON downloads(mediaId);
  CREATE INDEX IF NOT EXISTS idx_likes_media ON likes(mediaId);
  CREATE INDEX IF NOT EXISTS idx_comments_media ON comments(mediaId);
  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(userId);
  CREATE INDEX IF NOT EXISTS idx_favorites_media ON favorites(mediaId);
  CREATE INDEX IF NOT EXISTS idx_shares_media ON shares(mediaId);

  -- ============================================================
  -- 캘린더
  -- ============================================================

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creatorId INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    startAt TEXT NOT NULL,
    endAt TEXT NOT NULL,
    allDay INTEGER DEFAULT 0,
    color TEXT DEFAULT '#007AFF',
    location TEXT DEFAULT '',
    isPrivate INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours')),
    updatedAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE TABLE IF NOT EXISTS calendar_recurrence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    interval INTEGER DEFAULT 1,
    daysOfWeek TEXT,
    dayOfMonth INTEGER,
    monthOfYear INTEGER,
    endDate TEXT,
    count INTEGER,
    UNIQUE(eventId)
  );

  CREATE TABLE IF NOT EXISTS calendar_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id),
    status TEXT DEFAULT 'pending',
    UNIQUE(eventId, userId)
  );

  CREATE TABLE IF NOT EXISTS calendar_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    minutesBefore INTEGER NOT NULL,
    sent INTEGER DEFAULT 0,
    UNIQUE(eventId, minutesBefore)
  );

  CREATE INDEX IF NOT EXISTS idx_cal_events_start ON calendar_events(startAt);
  CREATE INDEX IF NOT EXISTS idx_cal_events_creator ON calendar_events(creatorId);
  CREATE INDEX IF NOT EXISTS idx_cal_participants_user ON calendar_participants(userId);
  CREATE INDEX IF NOT EXISTS idx_cal_reminders_sent ON calendar_reminders(sent);

  -- ============================================================
  -- 할일
  -- ============================================================

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parentId INTEGER REFERENCES todos(id) ON DELETE CASCADE,
    creatorId INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    dueDate TEXT,
    completedAt TEXT,
    completionNote TEXT,
    completionNotePolished TEXT,
    topicName TEXT,
    isPrivate INTEGER DEFAULT 0,
    sortOrder INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours')),
    updatedAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE TABLE IF NOT EXISTS todo_assignees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todoId INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id),
    UNIQUE(todoId, userId)
  );

  CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parentId);
  CREATE INDEX IF NOT EXISTS idx_todos_creator ON todos(creatorId);
  CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
  CREATE INDEX IF NOT EXISTS idx_todo_assignees_user ON todo_assignees(userId);

  -- ============================================================
  -- 노트
  -- ============================================================

  CREATE TABLE IF NOT EXISTS note_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creatorId INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    icon TEXT DEFAULT '📝',
    isPrivate INTEGER DEFAULT 0,
    sortOrder INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topicId INTEGER NOT NULL REFERENCES note_topics(id) ON DELETE CASCADE,
    creatorId INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    todoId INTEGER REFERENCES todos(id) ON DELETE SET NULL,
    isPrivate INTEGER DEFAULT 0,
    sortOrder INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours')),
    updatedAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_note_topics_creator ON note_topics(creatorId);
  CREATE INDEX IF NOT EXISTS idx_notes_topic ON notes(topicId);
  CREATE INDEX IF NOT EXISTS idx_notes_creator ON notes(creatorId);
  CREATE INDEX IF NOT EXISTS idx_notes_todo ON notes(todoId);

  -- ============================================================
  -- LLM
  -- ============================================================

  CREATE TABLE IF NOT EXISTS llm_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    apiKey TEXT NOT NULL,
    model TEXT DEFAULT '',
    maxTokens INTEGER DEFAULT 1024,
    temperature REAL DEFAULT 0.7,
    extraHeaders TEXT DEFAULT '{}',
    extraBody TEXT DEFAULT '{}',
    isActive INTEGER DEFAULT 0,
    lastHealthCheck TEXT,
    lastHealthStatus TEXT DEFAULT 'unknown',
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE TABLE IF NOT EXISTS llm_health_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    configId INTEGER NOT NULL REFERENCES llm_configs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    responseTimeMs INTEGER,
    error TEXT,
    checkedAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_llm_health_config ON llm_health_logs(configId);
`);

// 마이그레이션: users에 banned 컬럼 추가
try { db.exec('ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0'); } catch {}

// 마이그레이션: media에 uploadedAt 컬럼 추가
try { db.exec('ALTER TABLE media ADD COLUMN uploadedAt TEXT'); } catch {}

// 기존 파일들의 해시를 채워넣기 (quick hash: head+tail+size)
import crypto from 'crypto';
const CHUNK = 4 * 1024 * 1024;
const unhashed = db.prepare('SELECT id, filename FROM media WHERE hash IS NULL').all() as { id: number; filename: string }[];
if (unhashed.length > 0) {
  const update = db.prepare('UPDATE media SET hash = ? WHERE id = ?');
  for (const row of unhashed) {
    try {
      const filePath = path.join(DATA_DIR, 'originals', row.filename);
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      const hash = crypto.createHash('sha256');
      if (stat.size <= CHUNK) {
        hash.update(fs.readFileSync(filePath));
      } else {
        const fd = fs.openSync(filePath, 'r');
        const head = Buffer.alloc(CHUNK);
        const tail = Buffer.alloc(CHUNK);
        fs.readSync(fd, head, 0, CHUNK, 0);
        fs.readSync(fd, tail, 0, CHUNK, stat.size - CHUNK);
        fs.closeSync(fd);
        hash.update(head);
        hash.update(tail);
        const sizeBuf = Buffer.alloc(8);
        sizeBuf.writeDoubleBE(stat.size);
        hash.update(sizeBuf);
      }
      update.run(hash.digest('hex'), row.id);
    } catch {}
  }
  console.log(`Backfilled hash for ${unhashed.length} existing files`);
}

export default db;
