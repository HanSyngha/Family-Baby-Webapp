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

  CREATE TABLE IF NOT EXISTS todo_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todoId INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parentId);
  CREATE INDEX IF NOT EXISTS idx_todos_creator ON todos(creatorId);
  CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
  CREATE INDEX IF NOT EXISTS idx_todo_assignees_user ON todo_assignees(userId);
  CREATE INDEX IF NOT EXISTS idx_todo_comments_todo ON todo_comments(todoId);

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

  -- ============================================================
  -- 육아 - 아이 관리
  -- ============================================================

  CREATE TABLE IF NOT EXISTS babies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    birthDate TEXT,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  -- ============================================================
  -- 육아 - 수유
  -- ============================================================

  CREATE TABLE IF NOT EXISTS feedings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    babyId INTEGER NOT NULL DEFAULT 1 REFERENCES babies(id),
    recorderId INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    side TEXT,
    amountMl INTEGER,
    durationSec INTEGER,
    startedAt TEXT NOT NULL,
    endedAt TEXT,
    memo TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_feedings_started ON feedings(startedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_feedings_recorder ON feedings(recorderId);

  -- ============================================================
  -- 육아 - 수면
  -- ============================================================

  CREATE TABLE IF NOT EXISTS sleeps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    babyId INTEGER NOT NULL DEFAULT 1 REFERENCES babies(id),
    recorderId INTEGER NOT NULL REFERENCES users(id),
    startedAt TEXT NOT NULL,
    endedAt TEXT,
    durationSec INTEGER,
    memo TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_sleeps_started ON sleeps(startedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_sleeps_recorder ON sleeps(recorderId);

  -- ============================================================
  -- 육아 - 기저귀
  -- ============================================================

  CREATE TABLE IF NOT EXISTS diapers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    babyId INTEGER NOT NULL DEFAULT 1 REFERENCES babies(id),
    recorderId INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    changedAt TEXT NOT NULL,
    color TEXT,
    consistency TEXT,
    memo TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_diapers_changed ON diapers(changedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_diapers_recorder ON diapers(recorderId);
  CREATE INDEX IF NOT EXISTS idx_diapers_baby ON diapers(babyId);

  -- ============================================================
  -- 육아 - 예측 로그
  -- ============================================================

  CREATE TABLE IF NOT EXISTS baby_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    babyId INTEGER NOT NULL DEFAULT 1 REFERENCES babies(id),
    type TEXT NOT NULL,
    predictedAt TEXT NOT NULL,
    reasoning TEXT,
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_predictions_type ON baby_predictions(type);

  -- ============================================================
  -- 육아 - 특이사항
  -- ============================================================

  CREATE TABLE IF NOT EXISTS baby_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    babyId INTEGER NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    severity TEXT DEFAULT 'pending',
    llmReasoning TEXT,
    status TEXT DEFAULT 'active',
    recordedBy INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now', '+9 hours')),
    resolvedAt TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_baby_observations_baby ON baby_observations(babyId);

  -- ============================================================
  -- 육아 - 걱정 채팅
  -- ============================================================

  CREATE TABLE IF NOT EXISTS baby_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    babyId INTEGER NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    userId INTEGER REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_baby_chat_baby ON baby_chat_messages(babyId);

  -- ============================================================
  -- 육아 - 설정
  -- ============================================================

  CREATE TABLE IF NOT EXISTS baby_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updatedAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  -- ============================================================
  -- 육아 - 예방접종
  -- ============================================================

  CREATE TABLE IF NOT EXISTS baby_vaccinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    babyId INTEGER NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
    vaccineCode TEXT NOT NULL,
    completedDate TEXT,
    hospital TEXT DEFAULT '',
    memo TEXT DEFAULT '',
    completedBy INTEGER REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_baby_vacc_unique ON baby_vaccinations(babyId, vaccineCode);

  -- ============================================================
  -- 육아 - 성장 기록
  -- ============================================================

  CREATE TABLE IF NOT EXISTS baby_growth_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    babyId INTEGER NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
    measuredDate TEXT NOT NULL,
    weightKg REAL,
    heightCm REAL,
    headCm REAL,
    memo TEXT DEFAULT '',
    recordedBy INTEGER NOT NULL REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now', '+9 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_growth_baby ON baby_growth_records(babyId);
`);

// 마이그레이션: users에 banned 컬럼 추가
try { db.exec('ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0'); } catch {}

// 마이그레이션: media에 uploadedAt 컬럼 추가
try { db.exec('ALTER TABLE media ADD COLUMN uploadedAt TEXT'); } catch {}

// 마이그레이션: media에 source 컬럼 추가 ('local' | 'peanut')
try { db.exec("ALTER TABLE media ADD COLUMN source TEXT DEFAULT 'local'"); } catch {}

// 싱크 상태 추적 테이블
db.exec(`CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

// 마이그레이션: 기본 아이 생성 (한설)
{
  const existingBaby = db.prepare('SELECT id FROM babies LIMIT 1').get();
  if (!existingBaby) {
    db.prepare('INSERT INTO babies (name) VALUES (?)').run('한설');
    console.log('[DB] Default baby created: 한설');
  }
}

// 마이그레이션: 기존 테이블에 babyId 컬럼 추가
try { db.exec('ALTER TABLE feedings ADD COLUMN babyId INTEGER NOT NULL DEFAULT 1 REFERENCES babies(id)'); } catch {}
try { db.exec('ALTER TABLE sleeps ADD COLUMN babyId INTEGER NOT NULL DEFAULT 1 REFERENCES babies(id)'); } catch {}
try { db.exec('ALTER TABLE baby_predictions ADD COLUMN babyId INTEGER NOT NULL DEFAULT 1 REFERENCES babies(id)'); } catch {}

// babyId 인덱스 (마이그레이션 후)
try { db.exec('CREATE INDEX IF NOT EXISTS idx_feedings_baby ON feedings(babyId)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sleeps_baby ON sleeps(babyId)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_predictions_baby ON baby_predictions(babyId)'); } catch {}

// 마이그레이션: LLM 교정 컬럼 추가
try { db.exec('ALTER TABLE notes ADD COLUMN contentPolished TEXT'); } catch {}
try { db.exec('ALTER TABLE todos ADD COLUMN descriptionPolished TEXT'); } catch {}

// 마이그레이션: babies에 gender 컬럼 추가 ('M' | 'F' | null)
try { db.exec("ALTER TABLE babies ADD COLUMN gender TEXT"); } catch {}
// 마이그레이션: 한설이 성별 시드
try { db.exec("UPDATE babies SET gender = 'F' WHERE name = '한설' AND gender IS NULL"); } catch {}

// 마이그레이션: users에 birthDate 컬럼 추가
try { db.exec('ALTER TABLE users ADD COLUMN birthDate TEXT'); } catch {}

// 마이그레이션: 한승하(아빠) 생일 시드
try { db.exec("UPDATE users SET birthDate = '1996-03-12' WHERE name = '한승하' AND birthDate IS NULL"); } catch {}
// 황하람(엄마) 생일 시드 (가입 시)
try { db.exec("UPDATE users SET birthDate = '1992-12-10' WHERE name = '황하람' AND birthDate IS NULL"); } catch {}

// 마이그레이션: users에 lastActiveAt 컬럼 추가 (자동 수면용)
try { db.exec('ALTER TABLE users ADD COLUMN lastActiveAt TEXT'); } catch {}

// 마이그레이션: sleeps에 isAutoSleep 컬럼 추가
try { db.exec('ALTER TABLE sleeps ADD COLUMN isAutoSleep INTEGER DEFAULT 0'); } catch {}

// 마이그레이션: comments에 parentId(대댓글), editedAt(수정 표시) 컬럼 추가
try { db.exec('ALTER TABLE comments ADD COLUMN parentId INTEGER REFERENCES comments(id) ON DELETE CASCADE'); } catch {}
try { db.exec('ALTER TABLE comments ADD COLUMN editedAt TEXT'); } catch {}

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

// ============================================================
// 땅콩땅콩땅콩콩땅 DB (old app) — 볼륨 마운트 시 연결
// ============================================================
const PEANUT_DATA_DIR = process.env.PEANUT_DATA_DIR || '';
let peanutDb: InstanceType<typeof Database> | null = null;

if (PEANUT_DATA_DIR) {
  const peanutDbPath = path.join(PEANUT_DATA_DIR, 'peanut.db');
  if (fs.existsSync(peanutDbPath)) {
    peanutDb = new Database(peanutDbPath);
    peanutDb.pragma('journal_mode = WAL');
    peanutDb.pragma('busy_timeout = 5000');
    console.log('[DB] Connected to peanut.db (땅콩땅콩땅콩콩땅)');
  }
}

// ============================================================
// 기존 중복 파일 정리: P2에 로컬로 있지만 P1에도 같은 hash로 있는 파일
// → source='peanut'으로 변경하고 로컬 복사본 삭제
// ============================================================
if (peanutDb) {
  const dupes = db.prepare(`
    SELECT m.id, m.filename, m.hash FROM media m
    WHERE m.source = 'local' AND m.hash IS NOT NULL
  `).all() as { id: number; filename: string; hash: string }[];

  let cleaned = 0;
  for (const dupe of dupes) {
    const peanutMedia = peanutDb.prepare('SELECT filename FROM media WHERE hash = ?').get(dupe.hash) as { filename: string } | undefined;
    if (!peanutMedia) continue;

    // P1에 같은 hash 파일이 있으면 → P1 filename으로 교체, source='peanut'
    const peanutOriginal = path.join(PEANUT_DATA_DIR, 'originals', peanutMedia.filename);
    if (!fs.existsSync(peanutOriginal)) continue;

    db.prepare('UPDATE media SET filename = ?, source = ? WHERE id = ?')
      .run(peanutMedia.filename, 'peanut', dupe.id);

    // 로컬 복사본 삭제
    const localOriginal = path.join(DATA_DIR, 'originals', dupe.filename);
    const localThumb = path.join(DATA_DIR, 'thumbnails', dupe.filename + '.webp');
    const localHls = path.join(DATA_DIR, 'hls', dupe.filename);
    if (fs.existsSync(localOriginal)) fs.unlinkSync(localOriginal);
    if (fs.existsSync(localThumb)) fs.unlinkSync(localThumb);
    if (fs.existsSync(localHls)) fs.rmSync(localHls, { recursive: true });
    cleaned++;
  }
  if (cleaned > 0) console.log(`[Sync] Cleaned ${cleaned} duplicate files (now served from peanut)`);
}

// ============================================================
// P1→P2 자동 싱크 (30초마다)
// ============================================================
function syncFromPeanut() {
  if (!peanutDb) return;

  try {
    const lastIdRow = db.prepare("SELECT value FROM sync_state WHERE key = 'peanut_last_id'").get() as { value: string } | undefined;
    const lastId = lastIdRow ? parseInt(lastIdRow.value) : 0;

    const newMedia = peanutDb.prepare('SELECT * FROM media WHERE id > ? ORDER BY id ASC').all(lastId) as any[];
    if (newMedia.length === 0) return;

    // P2의 기존 hash 세트 (중복 체크용)
    const ourHashes = new Set(
      (db.prepare('SELECT hash FROM media WHERE hash IS NOT NULL').all() as { hash: string }[]).map(r => r.hash)
    );

    // P1 user → P2 user 매핑 캐시 (없으면 자동 생성)
    const userCache = new Map<number, number | null>();
    function mapUser(peanutUserId: number): number | null {
      if (userCache.has(peanutUserId)) return userCache.get(peanutUserId)!;
      const pUser = peanutDb!.prepare('SELECT provider, providerId, name, profileImage, role FROM users WHERE id = ?').get(peanutUserId) as { provider: string; providerId: string; name: string; profileImage: string | null; role: string } | undefined;
      if (!pUser) { userCache.set(peanutUserId, null); return null; }
      let ourUser = db.prepare('SELECT id FROM users WHERE provider = ? AND providerId = ?').get(pUser.provider, pUser.providerId) as { id: number } | undefined;
      if (!ourUser) {
        // P2에 유저 자동 생성
        const result = db.prepare('INSERT INTO users (provider, providerId, name, profileImage, role) VALUES (?, ?, ?, ?, ?)').run(pUser.provider, pUser.providerId, pUser.name, pUser.profileImage, pUser.role);
        ourUser = { id: result.lastInsertRowid as number };
        console.log(`[Sync] Auto-created user: ${pUser.name} (${pUser.provider})`);
      }
      userCache.set(peanutUserId, ourUser.id);
      return ourUser.id;
    }

    const insert = db.prepare(`
      INSERT INTO media (uploaderId, filename, originalName, mimeType, type, size, width, height, duration, hash, createdAt, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'peanut')
    `);

    let synced = 0;
    let maxId = lastId;

    for (const m of newMedia) {
      maxId = m.id;

      // hash 중복 체크
      if (m.hash && ourHashes.has(m.hash)) continue;

      // user 매핑
      const ourUserId = mapUser(m.uploaderId);
      if (!ourUserId) continue;

      insert.run(ourUserId, m.filename, m.originalName, m.mimeType, m.type, m.size, m.width, m.height, m.duration, m.hash, m.createdAt);
      if (m.hash) ourHashes.add(m.hash);
      synced++;
    }

    // 커서 갱신
    db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('peanut_last_id', ?)").run(String(maxId));

    if (synced > 0) console.log(`[Sync] Synced ${synced} media from peanut (up to id ${maxId})`);
  } catch (err) {
    console.error('[Sync] Error:', err);
  }
}

// 시작 시 즉시 1회 + 30초마다
syncFromPeanut();
setInterval(syncFromPeanut, 30 * 1000);

export { peanutDb };
export default db;
