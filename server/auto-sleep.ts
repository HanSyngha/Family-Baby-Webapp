/**
 * 자동 수면 기록: 모든 master 사용자가 30분 이상 미접속 시 아기 수면 자동 기록
 * 사용자 복귀 시 자동 종료
 */
import db from './db.js';
import { sendPushToAll } from './push.js';

const INACTIVITY_THRESHOLD_MIN = 30;
const BACKDATE_MIN = 20;
const CHECK_INTERVAL_MS = 60 * 1000; // 60초

let intervalId: ReturnType<typeof setInterval> | null = null;

function nowKST(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function isAutoSleepEnabled(): boolean {
  const row = db.prepare("SELECT value FROM baby_settings WHERE key = 'auto_sleep_enabled'").get() as { value: string } | undefined;
  return row?.value === 'true';
}

function checkAndCreateAutoSleep() {
  try {
    if (!isAutoSleepEnabled()) return;

    // 모든 master 유저의 lastActiveAt 조회
    const masters = db.prepare(
      "SELECT id, name, lastActiveAt FROM users WHERE role = 'master' AND banned = 0"
    ).all() as { id: number; name: string; lastActiveAt: string | null }[];

    if (masters.length === 0) return;

    // 전원 30분 이상 미접속인지 확인
    const now = nowKST();
    const thresholdTime = db.prepare(
      "SELECT datetime(?, '-' || ? || ' minutes') as t"
    ).get(now, INACTIVITY_THRESHOLD_MIN) as { t: string };

    for (const m of masters) {
      if (!m.lastActiveAt) return; // 한번도 접속 안 한 유저 있으면 skip
      if (m.lastActiveAt > thresholdTime.t) return; // 최근 접속한 유저 있으면 abort
    }

    // 전원 미접속 확인됨 → 각 아기별 auto-sleep 생성
    const babies = db.prepare('SELECT id, name FROM babies').all() as { id: number; name: string }[];
    const recorderId = masters[0].id;

    // startedAt = 현재 - 20분
    const startedAt = db.prepare(
      "SELECT datetime(?, '-' || ? || ' minutes') as t"
    ).get(now, BACKDATE_MIN) as { t: string };

    let created = 0;
    for (const baby of babies) {
      // 이미 활성 수면(수동 or 자동)이 있으면 skip
      const active = db.prepare(
        'SELECT id FROM sleeps WHERE babyId = ? AND endedAt IS NULL'
      ).get(baby.id);
      if (active) continue;

      db.prepare(
        `INSERT INTO sleeps (babyId, recorderId, startedAt, memo, isAutoSleep)
         VALUES (?, ?, ?, ?, 1)`
      ).run(baby.id, recorderId, startedAt.t, '자동 수면 기록');

      created++;
      console.log(`[AutoSleep] Created auto-sleep for ${baby.name} (startedAt=${startedAt.t})`);
    }

    // 이번 사이클에 새로 생성된 경우에만 알림
    if (created > 0) {
      sendPushToAll(
        '💤 자동 수면 감지',
        '수면 모드가 자동으로 시작되었습니다. 잘못 감지된 경우 앱에 접속해서 기록을 삭제해주세요.',
        '/parenting'
      );
    }
  } catch (err) {
    console.error('[AutoSleep] Check error:', err);
  }
}

export function endAutoSleeps(): { endedCount: number; endedSleeps: any[] } {
  const now = nowKST();
  const activeSleeps = db.prepare(
    'SELECT * FROM sleeps WHERE isAutoSleep = 1 AND endedAt IS NULL'
  ).all() as any[];

  const ended: any[] = [];
  for (const sleep of activeSleeps) {
    const startMs = new Date(sleep.startedAt.replace(' ', 'T') + '+09:00').getTime();
    const endMs = new Date(now.replace(' ', 'T') + '+09:00').getTime();
    const durationSec = Math.max(0, Math.floor((endMs - startMs) / 1000));

    db.prepare(
      'UPDATE sleeps SET endedAt = ?, durationSec = ? WHERE id = ?'
    ).run(now, durationSec, sleep.id);

    ended.push({ ...sleep, endedAt: now, durationSec });
    console.log(`[AutoSleep] Ended auto-sleep id=${sleep.id}, duration=${Math.floor(durationSec / 60)}min`);
  }

  return { endedCount: ended.length, endedSleeps: ended };
}

export function startAutoSleepCheck() {
  if (intervalId) return;
  intervalId = setInterval(checkAndCreateAutoSleep, CHECK_INTERVAL_MS);
  console.log('[AutoSleep] Started 60s interval check');
}
