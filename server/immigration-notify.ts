/**
 * 이민 탭 알림: 알림함(imm_outbox) + 미투표 리마인더 스케줄러.
 *
 * - 이민 알림은 전부 알림함을 거친다. 밤(KST 23~8시)엔 쌓아 두고, 아침 8시 이후 첫 회차에
 *   사람별로 한 통으로 묶어 보낸다.
 * - 리마인더: 안건이 올라오거나 수정된 뒤 4시간 넘게 찬성/반대를 안 누른 사람에게 1회,
 *   그 뒤로도 안 누르면 4시간마다. 제시자 본인도 대상.
 * - 받는 사람은 IMMIGRATION_USER_IDS 뿐. sendPushToAll/Others는 절대 쓰지 않는다(친척에게 샌다).
 */
import db from './db.js';
import { sendPushToUser } from './push.js';

// 이민 탭을 볼 수 있는 계정: 1 = 한승하, 3 = 황하람 (2026-10-06 DB 확인).
// role='master'로 판단하지 않는다 — master는 이름으로 부여돼 같은 이름의 새 계정도 master가 된다.
export const IMMIGRATION_USER_IDS = [1, 3];

export function canUseImmigration(userId: number | undefined): boolean {
  return !!userId && IMMIGRATION_USER_IDS.includes(userId);
}

const REMIND_AFTER_MIN = 240;
const QUIET_START_HOUR = 23;
const QUIET_END_HOUR = 8;
const TICK_MS = 5 * 60 * 1000;
const URL = '/immigration?tab=agenda';

function kstHour(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
}

export function isQuietHours(): boolean {
  const h = kstHour();
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

// 알림함에 넣고, 조용한 시간이 아니면 바로 보낸다.
export function enqueueImmigrationPush(userId: number, title: string, body: string, agendaId: number) {
  if (!canUseImmigration(userId)) return;
  db.prepare('INSERT INTO imm_outbox (userId, agendaId, title, body) VALUES (?, ?, ?, ?)').run(userId, agendaId, title, body);
  console.log(`[Immigration] 알림함 추가 user=${userId} "${title}"`);
  if (!isQuietHours()) flushOutbox().catch(e => console.error('[Immigration] flush 실패:', e));
}

let flushing = false;

export async function flushOutbox() {
  if (flushing || isQuietHours()) return;
  flushing = true;
  try {
    const rows = db.prepare('SELECT id, userId, title, body FROM imm_outbox WHERE sentAt IS NULL ORDER BY id').all() as
      { id: number; userId: number; title: string; body: string }[];
    const byUser = new Map<number, typeof rows>();
    for (const r of rows) {
      if (!canUseImmigration(r.userId)) continue;
      if (!byUser.has(r.userId)) byUser.set(r.userId, []);
      byUser.get(r.userId)!.push(r);
    }
    const markSent = db.prepare("UPDATE imm_outbox SET sentAt = datetime('now', '+9 hours') WHERE id = ?");
    for (const [userId, list] of byUser) {
      const title = list.length === 1 ? list[0].title : `이민 알림 ${list.length}건`;
      const body = list.length === 1 ? list[0].body : list.map(r => `· ${r.title}`).join('\n');
      const result = await sendPushToUser(userId, title, body, URL, 'immigration');
      for (const r of list) markSent.run(r.id);
      console.log(`[Immigration] 알림 발송 user=${userId} 묶음=${list.length} 구독=${result.subs} 성공=${result.sent} 실패=${result.failed}`);
    }
  } finally {
    flushing = false;
  }
}

// 미투표 리마인더 대상 계산 → 알림함에 사람별 한 건으로 넣는다.
export function queueVoteReminders() {
  if (isQuietHours()) return;

  // 확정 안 된 안건 × 두 사람 중 아직 안 누른 사람. 4시간 기준은 '올린/수정한 시각' 또는 '마지막 알림 시각'.
  const placeholders = IMMIGRATION_USER_IDS.map(() => '?').join(',');
  const due = db.prepare(`
    SELECT a.id AS agendaId, a.title, a.revision, u.id AS userId
    FROM imm_agendas a
    JOIN users u ON u.id IN (${placeholders})
    LEFT JOIN imm_votes v ON v.agendaId = a.id AND v.userId = u.id
    LEFT JOIN imm_reminders r ON r.agendaId = a.id AND r.userId = u.id
    WHERE a.confirmedAt IS NULL
      AND v.userId IS NULL
      AND (
        (r.agendaId IS NULL OR r.revision != a.revision)
          AND a.revisedAt <= datetime('now', '+9 hours', '-${REMIND_AFTER_MIN} minutes')
        OR (r.revision = a.revision
          AND r.lastSentAt <= datetime('now', '+9 hours', '-${REMIND_AFTER_MIN} minutes'))
      )
    ORDER BY a.id
  `).all(...IMMIGRATION_USER_IDS) as { agendaId: number; title: string; revision: number; userId: number }[];

  if (due.length === 0) return;

  const byUser = new Map<number, typeof due>();
  for (const d of due) {
    if (!byUser.has(d.userId)) byUser.set(d.userId, []);
    byUser.get(d.userId)!.push(d);
  }

  const upsert = db.prepare(`
    INSERT INTO imm_reminders (agendaId, userId, revision, lastSentAt) VALUES (?, ?, ?, datetime('now', '+9 hours'))
    ON CONFLICT(agendaId, userId) DO UPDATE SET revision = excluded.revision, lastSentAt = excluded.lastSentAt
  `);
  db.transaction(() => {
    for (const [userId, list] of byUser) {
      const title = list.length === 1 ? '투표를 기다리는 안건' : `투표를 기다리는 안건 ${list.length}건`;
      const body = list.map(d => d.title).join(', ');
      db.prepare('INSERT INTO imm_outbox (userId, title, body) VALUES (?, ?, ?)').run(userId, title, body);
      for (const d of list) upsert.run(d.agendaId, userId, d.revision);
      console.log(`[Immigration] 미투표 리마인더 user=${userId} 안건=[${list.map(d => d.agendaId).join(',')}]`);
    }
  })();
}

// 사진은 먼저 올리고 글 저장 때 붙인다. 하루 넘게 안 붙은 사진은 버려진 것.
function cleanupDetachedPhotos(removeFile: (filename: string) => void) {
  const rows = db.prepare(`
    SELECT id, filename FROM imm_photos
    WHERE agendaId IS NULL AND commentId IS NULL AND createdAt <= datetime('now', '+9 hours', '-1 day')
  `).all() as { id: number; filename: string }[];
  for (const r of rows) {
    db.prepare('DELETE FROM imm_photos WHERE id = ?').run(r.id);
    removeFile(r.filename);
  }
  if (rows.length) console.log(`[Immigration] 붙지 않은 사진 ${rows.length}장 정리`);
}

export function startImmigrationScheduler(removeFile: (filename: string) => void) {
  const tick = async () => {
    try {
      queueVoteReminders();
      await flushOutbox();
      cleanupDetachedPhotos(removeFile);
    } catch (e) {
      console.error('[Immigration] 스케줄러 오류:', e);
    }
  };
  setTimeout(tick, 30 * 1000);
  setInterval(tick, TICK_MS);
  console.log(`[Immigration] 스케줄러 시작 (${TICK_MS / 60000}분 주기, 미투표 ${REMIND_AFTER_MIN}분, 조용한 시간 ${QUIET_START_HOUR}~${QUIET_END_HOUR}시)`);
}
