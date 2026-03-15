import type { FastifyInstance, FastifyRequest } from 'fastify';
import db from '../db.js';
import { authenticate } from '../auth.js';
import { sendPushToOthers, getUserName } from '../push.js';
import { triggerPrediction } from '../baby-predictor.js';
import { chatCompletion, nowKSTString } from '../llm-client.js';
import { endAutoSleeps } from '../auto-sleep.js';

interface FeedingRow {
  id: number;
  babyId: number;
  recorderId: number;
  type: string;
  side: string | null;
  amountMl: number | null;
  durationSec: number | null;
  startedAt: string;
  endedAt: string | null;
  memo: string;
  createdAt: string;
}

interface SleepRow {
  id: number;
  babyId: number;
  recorderId: number;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  memo: string;
  createdAt: string;
  isAutoSleep: number;
}

interface DiaperRow {
  id: number;
  babyId: number;
  recorderId: number;
  type: string;
  changedAt: string;
  color: string | null;
  consistency: string | null;
  memo: string;
  createdAt: string;
}

interface BabyRow {
  id: number;
  name: string;
  birthDate: string | null;
  gender: string | null;
  createdAt: string;
}

function enrichFeeding(row: FeedingRow) {
  const recorder = db.prepare('SELECT name, profileImage FROM users WHERE id = ?').get(row.recorderId) as { name: string; profileImage: string | null } | undefined;
  return {
    ...row,
    recorderName: recorder?.name || '누군가',
    recorderImage: recorder?.profileImage || null,
  };
}

function enrichSleep(row: SleepRow) {
  const recorder = db.prepare('SELECT name, profileImage FROM users WHERE id = ?').get(row.recorderId) as { name: string; profileImage: string | null } | undefined;
  return {
    ...row,
    recorderName: recorder?.name || '누군가',
    recorderImage: recorder?.profileImage || null,
  };
}

function enrichDiaper(row: DiaperRow) {
  const recorder = db.prepare('SELECT name, profileImage FROM users WHERE id = ?').get(row.recorderId) as { name: string; profileImage: string | null } | undefined;
  return {
    ...row,
    recorderName: recorder?.name || '누군가',
    recorderImage: recorder?.profileImage || null,
  };
}

export function registerBabyRoutes(app: FastifyInstance) {
  // ============================================================
  // 아이 CRUD
  // ============================================================

  app.get('/api/baby/babies', { preHandler: authenticate }, async () => {
    return db.prepare('SELECT * FROM babies ORDER BY id ASC').all() as BabyRow[];
  });

  app.post('/api/baby/babies', { preHandler: authenticate }, async (request) => {
    const { name, birthDate, gender } = request.body as { name: string; birthDate?: string; gender?: string };
    const result = db.prepare('INSERT INTO babies (name, birthDate, gender) VALUES (?, ?, ?)').run(name, birthDate || null, gender || null);
    const baby = db.prepare('SELECT * FROM babies WHERE id = ?').get(result.lastInsertRowid) as BabyRow;
    console.log(`[Baby] Baby created: ${name} (id=${baby.id})`);
    return baby;
  });

  app.put('/api/baby/babies/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, birthDate, gender } = request.body as { name?: string; birthDate?: string; gender?: string };
    const existing = db.prepare('SELECT id FROM babies WHERE id = ?').get(Number(id));
    if (!existing) return reply.code(404).send({ error: 'Baby not found' });
    if (name !== undefined) db.prepare('UPDATE babies SET name = ? WHERE id = ?').run(name, Number(id));
    if (birthDate !== undefined) db.prepare('UPDATE babies SET birthDate = ? WHERE id = ?').run(birthDate || null, Number(id));
    if (gender !== undefined) db.prepare('UPDATE babies SET gender = ? WHERE id = ?').run(gender || null, Number(id));
    return db.prepare('SELECT * FROM babies WHERE id = ?').get(Number(id)) as BabyRow;
  });

  app.delete('/api/baby/babies/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const babyId = Number(id);
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM babies').get() as any).cnt;
    if (count <= 1) return reply.code(400).send({ error: '최소 1명의 아이가 필요합니다' });
    db.prepare('DELETE FROM feedings WHERE babyId = ?').run(babyId);
    db.prepare('DELETE FROM sleeps WHERE babyId = ?').run(babyId);
    db.prepare('DELETE FROM diapers WHERE babyId = ?').run(babyId);
    db.prepare('DELETE FROM baby_predictions WHERE babyId = ?').run(babyId);
    db.prepare('DELETE FROM babies WHERE id = ?').run(babyId);
    console.log(`[Baby] Baby deleted: id=${babyId}`);
    return { ok: true };
  });

  // ============================================================
  // 수유 CRUD
  // ============================================================

  // 수유 목록
  app.get('/api/baby/feedings', { preHandler: authenticate }, async (request: FastifyRequest) => {
    const { date, babyId } = request.query as { date?: string; babyId?: string };
    const bid = babyId ? Number(babyId) : 1;

    let rows: FeedingRow[];
    if (date) {
      rows = db.prepare(
        `SELECT * FROM feedings WHERE babyId = ? AND startedAt LIKE ? ORDER BY startedAt DESC`
      ).all(bid, `${date}%`) as FeedingRow[];
    } else {
      // 최근 5일치
      rows = db.prepare(
        `SELECT * FROM feedings WHERE babyId = ? AND startedAt >= date('now', '+9 hours', '-4 days') ORDER BY startedAt DESC`
      ).all(bid) as FeedingRow[];
    }

    return rows.map(enrichFeeding);
  });

  // 수유 생성
  app.post('/api/baby/feedings', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const body = request.body as any;
    const { type, side, amountMl, durationSec, startedAt, endedAt, memo, babyId } = body;
    const bid = babyId || 1;

    // 모유 수유는 항상 엄마(황하람)가 기록자
    let recorderId = userId;
    if (type === 'breast') {
      const mom = db.prepare("SELECT id FROM users WHERE name = '황하람'").get() as { id: number } | undefined;
      if (mom) recorderId = mom.id;
    }

    const result = db.prepare(`
      INSERT INTO feedings (babyId, recorderId, type, side, amountMl, durationSec, startedAt, endedAt, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bid,
      recorderId,
      type,
      side || null,
      amountMl || null,
      durationSec || null,
      startedAt,
      endedAt || null,
      memo || '',
    );

    const feedingId = result.lastInsertRowid as number;
    const feeding = db.prepare('SELECT * FROM feedings WHERE id = ?').get(feedingId) as FeedingRow;

    const babyName = (db.prepare('SELECT name FROM babies WHERE id = ?').get(bid) as any)?.name || '';
    const typeLabel = type === 'formula' ? '분유' : '모유';
    const detail = type === 'formula'
      ? `${amountMl}ml`
      : `${side === 'left' ? '왼쪽' : '오른쪽'} ${Math.floor((durationSec || 0) / 60)}분`;

    console.log(`[Baby] Feeding created: ${babyName} ${typeLabel} ${detail} by userId=${userId}`);
    sendPushToOthers(userId, `${getUserName(userId)}님이 ${babyName} 수유 기록`, `${typeLabel} ${detail} 🍼`, '/parenting');

    // LLM 예측 (비동기, 메인 플로우 block 안 함)
    triggerPrediction('feeding', bid).catch(err => {
      console.error('[Baby] Prediction trigger error:', err.message);
    });

    return enrichFeeding(feeding);
  });

  // 수유 수정
  app.put('/api/baby/feedings/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const feedingId = Number(id);
    const body = request.body as any;

    const existing = db.prepare('SELECT id FROM feedings WHERE id = ?').get(feedingId) as any;
    if (!existing) return reply.code(404).send({ error: 'Feeding not found' });

    const fields: string[] = [];
    const values: any[] = [];

    for (const key of ['type', 'side', 'startedAt', 'endedAt', 'memo'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key] || null); }
    }
    if (body.amountMl !== undefined) { fields.push('amountMl = ?'); values.push(body.amountMl); }
    if (body.durationSec !== undefined) { fields.push('durationSec = ?'); values.push(body.durationSec); }

    if (fields.length > 0) {
      db.prepare(`UPDATE feedings SET ${fields.join(', ')} WHERE id = ?`).run(...values, feedingId);
    }

    console.log(`[Baby] Feeding updated: id=${feedingId}`);

    const feeding = db.prepare('SELECT * FROM feedings WHERE id = ?').get(feedingId) as FeedingRow;
    return enrichFeeding(feeding);
  });

  // 수유 삭제
  app.delete('/api/baby/feedings/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT id FROM feedings WHERE id = ?').get(Number(id)) as any;
    if (!existing) return reply.code(404).send({ error: 'Feeding not found' });

    db.prepare('DELETE FROM feedings WHERE id = ?').run(Number(id));
    console.log(`[Baby] Feeding deleted: id=${id}`);
    return { ok: true };
  });

  // ============================================================
  // 수면 CRUD
  // ============================================================

  // 수면 목록
  app.get('/api/baby/sleeps', { preHandler: authenticate }, async (request: FastifyRequest) => {
    const { date, babyId } = request.query as { date?: string; babyId?: string };
    const bid = babyId ? Number(babyId) : 1;

    let rows: SleepRow[];
    if (date) {
      rows = db.prepare(
        `SELECT * FROM sleeps WHERE babyId = ? AND startedAt LIKE ? ORDER BY startedAt DESC`
      ).all(bid, `${date}%`) as SleepRow[];
    } else {
      rows = db.prepare(
        `SELECT * FROM sleeps WHERE babyId = ? AND startedAt >= date('now', '+9 hours') ORDER BY startedAt DESC`
      ).all(bid) as SleepRow[];
    }

    return rows.map(enrichSleep);
  });

  // 수면 생성
  app.post('/api/baby/sleeps', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const body = request.body as any;
    const { startedAt, endedAt, durationSec, memo, babyId } = body;
    const bid = babyId || 1;

    const result = db.prepare(`
      INSERT INTO sleeps (babyId, recorderId, startedAt, endedAt, durationSec, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      bid,
      userId,
      startedAt,
      endedAt || null,
      durationSec || null,
      memo || '',
    );

    const sleepId = result.lastInsertRowid as number;
    const sleep = db.prepare('SELECT * FROM sleeps WHERE id = ?').get(sleepId) as SleepRow;

    const babyName = (db.prepare('SELECT name FROM babies WHERE id = ?').get(bid) as any)?.name || '';

    if (endedAt && durationSec) {
      const mins = Math.floor(durationSec / 60);
      console.log(`[Baby] Sleep recorded: ${babyName} ${mins}분 by userId=${userId}`);
      sendPushToOthers(userId, `${getUserName(userId)}님이 ${babyName} 수면 기록`, `${mins}분 수면 완료 💤`, '/parenting');

      // LLM 예측 (수면 완료 시에만)
      triggerPrediction('sleep', bid).catch(err => {
        console.error('[Baby] Prediction trigger error:', err.message);
      });
    } else {
      console.log(`[Baby] Sleep started: ${babyName} by userId=${userId}`);
      sendPushToOthers(userId, `${getUserName(userId)}님이 ${babyName} 수면 시작`, '아기가 잠들었어요 💤', '/parenting');
    }

    return enrichSleep(sleep);
  });

  // 깨어남 기록 — 24시간 내 미연결 수면에 endedAt 연결
  app.post('/api/baby/sleeps/wake', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const { endedAt, babyId } = request.body as any;
    const bid = babyId || 1;

    const unmatched = db.prepare(`
      SELECT * FROM sleeps
      WHERE babyId = ? AND endedAt IS NULL
      AND datetime(startedAt) >= datetime(?, '-24 hours')
      ORDER BY startedAt DESC LIMIT 1
    `).get(bid, endedAt) as SleepRow | undefined;

    if (!unmatched) {
      return reply.code(404).send({ error: '24시간 내 연결할 수면 기록이 없습니다' });
    }

    const startMs = new Date(unmatched.startedAt.replace(' ', 'T')).getTime();
    const endMs = new Date(endedAt.replace(' ', 'T')).getTime();
    const durationSec = Math.max(0, Math.floor((endMs - startMs) / 1000));

    db.prepare('UPDATE sleeps SET endedAt = ?, durationSec = ? WHERE id = ?')
      .run(endedAt, durationSec, unmatched.id);

    const sleep = db.prepare('SELECT * FROM sleeps WHERE id = ?').get(unmatched.id) as SleepRow;
    const babyName = (db.prepare('SELECT name FROM babies WHERE id = ?').get(bid) as any)?.name || '';
    const mins = Math.floor(durationSec / 60);
    console.log(`[Baby] Sleep wake recorded: ${babyName} ${mins}분 by userId=${userId}`);
    sendPushToOthers(userId, `${getUserName(userId)}님이 ${babyName} 수면 기록`, `${mins}분 수면 완료 💤`, '/parenting');

    triggerPrediction('sleep', bid).catch(err => {
      console.error('[Baby] Prediction trigger error:', err.message);
    });

    return enrichSleep(sleep);
  });

  // 수면 수정
  app.put('/api/baby/sleeps/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const sleepId = Number(id);
    const body = request.body as any;

    const existing = db.prepare('SELECT id FROM sleeps WHERE id = ?').get(sleepId) as any;
    if (!existing) return reply.code(404).send({ error: 'Sleep not found' });

    const fields: string[] = [];
    const values: any[] = [];

    for (const key of ['startedAt', 'endedAt', 'memo'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key] || null); }
    }
    if (body.durationSec !== undefined) { fields.push('durationSec = ?'); values.push(body.durationSec); }

    if (fields.length > 0) {
      db.prepare(`UPDATE sleeps SET ${fields.join(', ')} WHERE id = ?`).run(...values, sleepId);
    }

    console.log(`[Baby] Sleep updated: id=${sleepId}`);

    const sleep = db.prepare('SELECT * FROM sleeps WHERE id = ?').get(sleepId) as SleepRow;
    return enrichSleep(sleep);
  });

  // 수면 삭제
  app.delete('/api/baby/sleeps/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT id FROM sleeps WHERE id = ?').get(Number(id)) as any;
    if (!existing) return reply.code(404).send({ error: 'Sleep not found' });

    db.prepare('DELETE FROM sleeps WHERE id = ?').run(Number(id));
    console.log(`[Baby] Sleep deleted: id=${id}`);
    return { ok: true };
  });

  // ============================================================
  // 기저귀 CRUD
  // ============================================================

  // 기저귀 목록
  app.get('/api/baby/diapers', { preHandler: authenticate }, async (request: FastifyRequest) => {
    const { date, babyId } = request.query as { date?: string; babyId?: string };
    const bid = babyId ? Number(babyId) : 1;

    let rows: DiaperRow[];
    if (date) {
      rows = db.prepare(
        `SELECT * FROM diapers WHERE babyId = ? AND changedAt LIKE ? ORDER BY changedAt DESC`
      ).all(bid, `${date}%`) as DiaperRow[];
    } else {
      rows = db.prepare(
        `SELECT * FROM diapers WHERE babyId = ? AND changedAt >= date('now', '+9 hours', '-4 days') ORDER BY changedAt DESC`
      ).all(bid) as DiaperRow[];
    }

    return rows.map(enrichDiaper);
  });

  // 기저귀 생성
  app.post('/api/baby/diapers', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const body = request.body as any;
    const { type, changedAt, color, consistency, memo, babyId } = body;
    const bid = babyId || 1;

    const result = db.prepare(`
      INSERT INTO diapers (babyId, recorderId, type, changedAt, color, consistency, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(bid, userId, type, changedAt, color || null, consistency || null, memo || '');

    const diaperId = result.lastInsertRowid as number;
    const diaper = db.prepare('SELECT * FROM diapers WHERE id = ?').get(diaperId) as DiaperRow;

    const babyName = (db.prepare('SELECT name FROM babies WHERE id = ?').get(bid) as any)?.name || '';
    const typeLabel = type === 'pee' ? '소변' : type === 'poop' ? '대변' : '소변+대변';
    console.log(`[Baby] Diaper created: ${babyName} ${typeLabel} by userId=${userId}`);
    sendPushToOthers(userId, `${getUserName(userId)}님이 ${babyName} 기저귀 기록`, `${typeLabel} 🧷`, '/parenting');

    triggerPrediction('diaper', bid).catch(err => {
      console.error('[Baby] Prediction trigger error:', err.message);
    });

    return enrichDiaper(diaper);
  });

  // 기저귀 수정
  app.put('/api/baby/diapers/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const diaperId = Number(id);
    const body = request.body as any;

    const existing = db.prepare('SELECT id FROM diapers WHERE id = ?').get(diaperId) as any;
    if (!existing) return reply.code(404).send({ error: 'Diaper not found' });

    const fields: string[] = [];
    const values: any[] = [];

    for (const key of ['type', 'changedAt', 'color', 'consistency', 'memo'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key] || null); }
    }

    if (fields.length > 0) {
      db.prepare(`UPDATE diapers SET ${fields.join(', ')} WHERE id = ?`).run(...values, diaperId);
    }

    console.log(`[Baby] Diaper updated: id=${diaperId}`);

    const diaper = db.prepare('SELECT * FROM diapers WHERE id = ?').get(diaperId) as DiaperRow;
    return enrichDiaper(diaper);
  });

  // 기저귀 삭제
  app.delete('/api/baby/diapers/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT id FROM diapers WHERE id = ?').get(Number(id)) as any;
    if (!existing) return reply.code(404).send({ error: 'Diaper not found' });

    db.prepare('DELETE FROM diapers WHERE id = ?').run(Number(id));
    console.log(`[Baby] Diaper deleted: id=${id}`);
    return { ok: true };
  });

  // ============================================================
  // 설정
  // ============================================================

  app.get('/api/baby/settings', { preHandler: authenticate }, async () => {
    return db.prepare('SELECT key, value FROM baby_settings').all() as { key: string; value: string }[];
  });

  app.put('/api/baby/settings', { preHandler: authenticate }, async (request) => {
    const { key, value } = request.body as { key: string; value: string };
    db.prepare(`
      INSERT INTO baby_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now', '+9 hours')
    `).run(key, value);
    console.log(`[Baby] Setting updated: ${key}=${value}`);
    return { ok: true };
  });

  // ============================================================
  // 자동 수면 - 앱 복귀 시 종료
  // ============================================================

  app.post('/api/baby/auto-sleep/resume', { preHandler: authenticate }, async () => {
    return endAutoSleeps();
  });

  // ============================================================
  // 오늘 요약
  // ============================================================

  app.get('/api/baby/summary', { preHandler: authenticate }, async (request) => {
    const { babyId } = request.query as { babyId?: string };
    const bid = babyId ? Number(babyId) : 1;
    const today = `date('now', '+9 hours')`;

    // 오늘 수유 통계
    const feedingStats = db.prepare(`
      SELECT
        COUNT(*) as feedingCount,
        COALESCE(SUM(CASE WHEN type = 'formula' THEN amountMl ELSE 0 END), 0) as totalFormulaMl,
        COALESCE(SUM(CASE WHEN type = 'breast' THEN 1 ELSE 0 END), 0) as breastCount
      FROM feedings WHERE babyId = ? AND startedAt >= ${today}
    `).get(bid) as any;

    // 오늘 수면 통계
    const sleepStats = db.prepare(`
      SELECT
        COUNT(*) as sleepCount,
        COALESCE(SUM(durationSec), 0) as totalSleepSec
      FROM sleeps WHERE babyId = ? AND startedAt >= ${today} AND endedAt IS NOT NULL
    `).get(bid) as any;

    // 오늘 기저귀 통계
    const diaperStats = db.prepare(`
      SELECT
        COUNT(*) as diaperCount,
        COALESCE(SUM(CASE WHEN type IN ('pee', 'both') THEN 1 ELSE 0 END), 0) as peeCount,
        COALESCE(SUM(CASE WHEN type IN ('poop', 'both') THEN 1 ELSE 0 END), 0) as poopCount
      FROM diapers WHERE babyId = ? AND changedAt >= ${today}
    `).get(bid) as any;

    // 마지막 수유
    const lastFeeding = db.prepare(
      'SELECT * FROM feedings WHERE babyId = ? ORDER BY startedAt DESC LIMIT 1'
    ).get(bid) as FeedingRow | undefined;

    // 마지막 수면
    const lastSleep = db.prepare(
      'SELECT * FROM sleeps WHERE babyId = ? ORDER BY startedAt DESC LIMIT 1'
    ).get(bid) as SleepRow | undefined;

    // 마지막 기저귀
    const lastDiaper = db.prepare(
      'SELECT * FROM diapers WHERE babyId = ? ORDER BY changedAt DESC LIMIT 1'
    ).get(bid) as DiaperRow | undefined;

    // 최신 예측
    const feedingPrediction = db.prepare(
      `SELECT predictedAt, reasoning FROM baby_predictions WHERE babyId = ? AND type = 'feeding' ORDER BY createdAt DESC LIMIT 1`
    ).get(bid) as { predictedAt: string; reasoning: string } | undefined;

    const sleepPrediction = db.prepare(
      `SELECT predictedAt, reasoning FROM baby_predictions WHERE babyId = ? AND type = 'sleep' ORDER BY createdAt DESC LIMIT 1`
    ).get(bid) as { predictedAt: string; reasoning: string } | undefined;

    const diaperPrediction = db.prepare(
      `SELECT predictedAt, reasoning FROM baby_predictions WHERE babyId = ? AND type = 'diaper' ORDER BY createdAt DESC LIMIT 1`
    ).get(bid) as { predictedAt: string; reasoning: string } | undefined;

    return {
      today: {
        feedingCount: feedingStats.feedingCount,
        totalFormulaMl: feedingStats.totalFormulaMl,
        breastCount: feedingStats.breastCount,
        totalSleepMin: Math.floor(sleepStats.totalSleepSec / 60),
        sleepCount: sleepStats.sleepCount,
        diaperCount: diaperStats.diaperCount,
        peeCount: diaperStats.peeCount,
        poopCount: diaperStats.poopCount,
      },
      lastFeeding: lastFeeding ? enrichFeeding(lastFeeding) : null,
      lastSleep: lastSleep ? enrichSleep(lastSleep) : null,
      lastDiaper: lastDiaper ? enrichDiaper(lastDiaper) : null,
      prediction: {
        feeding: feedingPrediction || null,
        sleep: sleepPrediction || null,
        diaper: diaperPrediction || null,
      },
    };
  });

  // 예측 수동 트리거
  app.post('/api/baby/predict', { preHandler: authenticate }, async (request) => {
    const { babyId, type } = request.body as { babyId?: number; type?: string };
    const bid = babyId || 1;
    const t = (type === 'sleep' ? 'sleep' : type === 'diaper' ? 'diaper' : 'feeding') as 'feeding' | 'sleep' | 'diaper';
    console.log(`[Baby] Manual prediction trigger: babyId=${bid} type=${t}`);
    triggerPrediction(t, bid, true);
    return { ok: true };
  });

  // ============================================================
  // 특이사항 (Observations)
  // ============================================================

  function getBabyContext(babyId: number): string {
    const baby = db.prepare('SELECT name, birthDate FROM babies WHERE id = ?').get(babyId) as { name: string; birthDate: string | null } | undefined;
    if (!baby) return '';

    let ageText = '';
    if (baby.birthDate) {
      const bd = new Date(baby.birthDate);
      const now = new Date();
      const totalDays = Math.floor((now.getTime() - bd.getTime()) / 86400000);
      const months = Math.floor(totalDays / 30);
      const days = totalDays % 30;
      if (months > 0) ageText = `${months}개월 ${days}일`;
      else ageText = `${days}일`;
    }

    const observations = db.prepare(
      'SELECT content, severity, llmReasoning, status, createdAt FROM baby_observations WHERE babyId = ? ORDER BY createdAt DESC'
    ).all(babyId) as any[];

    const recentFeedings = db.prepare(
      'SELECT type, side, amountMl, durationSec, startedAt FROM feedings WHERE babyId = ? ORDER BY startedAt DESC LIMIT 50'
    ).all(babyId) as any[];

    const recentSleeps = db.prepare(
      'SELECT startedAt, endedAt, durationSec FROM sleeps WHERE babyId = ? ORDER BY startedAt DESC LIMIT 50'
    ).all(babyId) as any[];

    let ctx = `아기 이름: ${baby.name}\n`;
    if (baby.birthDate) ctx += `생년월일: ${baby.birthDate} (태어난 지 ${ageText})\n`;

    if (observations.length > 0) {
      ctx += `\n특이사항 기록 (${observations.length}건):\n`;
      observations.forEach((o, i) => {
        const sev = o.severity === 'common' ? '흔한' : o.severity === 'watch' ? '관찰필요' : o.severity === 'danger' ? '위험' : '미평가';
        ctx += `${i + 1}. [${o.status === 'resolved' ? '해소' : '진행중'}][${sev}] ${o.content} (${o.createdAt})\n`;
        if (o.llmReasoning) ctx += `   → ${o.llmReasoning}\n`;
      });
    }

    if (recentFeedings.length > 0) {
      ctx += `\n최근 수유 기록 (${recentFeedings.length}건):\n`;
      recentFeedings.slice(0, 20).forEach((f, i) => {
        const t = f.type === 'formula' ? `분유 ${f.amountMl}ml` : `모유 ${f.side === 'left' ? '왼쪽' : '오른쪽'} ${Math.floor((f.durationSec || 0) / 60)}분`;
        ctx += `${i + 1}. ${f.startedAt} | ${t}\n`;
      });
      if (recentFeedings.length > 20) ctx += `... 외 ${recentFeedings.length - 20}건\n`;
    }

    if (recentSleeps.length > 0) {
      ctx += `\n최근 수면 기록 (${recentSleeps.length}건):\n`;
      recentSleeps.slice(0, 20).forEach((s, i) => {
        const dur = s.durationSec ? `${Math.floor(s.durationSec / 60)}분` : '진행중';
        ctx += `${i + 1}. ${s.startedAt} ~ ${s.endedAt || '진행중'} | ${dur}\n`;
      });
      if (recentSleeps.length > 20) ctx += `... 외 ${recentSleeps.length - 20}건\n`;
    }

    const recentDiapers = db.prepare(
      'SELECT type, color, consistency, changedAt FROM diapers WHERE babyId = ? ORDER BY changedAt DESC LIMIT 50'
    ).all(babyId) as any[];

    if (recentDiapers.length > 0) {
      ctx += `\n최근 기저귀 기록 (${recentDiapers.length}건):\n`;
      recentDiapers.slice(0, 20).forEach((d, i) => {
        const t = d.type === 'pee' ? '소변' : d.type === 'poop' ? '대변' : '소변+대변';
        let detail = t;
        if (d.color) detail += `, 색상:${d.color}`;
        if (d.consistency) detail += `, 상태:${d.consistency}`;
        ctx += `${i + 1}. ${d.changedAt} | ${detail}\n`;
      });
      if (recentDiapers.length > 20) ctx += `... 외 ${recentDiapers.length - 20}건\n`;
    }

    ctx += '\n참고: 위 정보는 부모가 기록한 만큼만 제공되며, 누락된 정보가 있을 수 있습니다.';
    return ctx;
  }

  function enrichObservation(row: any): any {
    const recorder = db.prepare('SELECT name, profileImage FROM users WHERE id = ?').get(row.recordedBy) as { name: string; profileImage: string | null } | undefined;
    return {
      ...row,
      recorderName: recorder?.name || '누군가',
      recorderImage: recorder?.profileImage || null,
    };
  }

  app.get('/api/baby/:babyId/observations', { preHandler: authenticate }, async (request) => {
    const { babyId } = request.params as { babyId: string };
    const rows = db.prepare(
      `SELECT * FROM baby_observations WHERE babyId = ? ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, createdAt DESC`
    ).all(Number(babyId)) as any[];
    return rows.map(enrichObservation);
  });

  app.post('/api/baby/:babyId/observations', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const { babyId } = request.params as { babyId: string };
    const { content } = request.body as { content: string };
    const bid = Number(babyId);

    const result = db.prepare(
      'INSERT INTO baby_observations (babyId, content, recordedBy) VALUES (?, ?, ?)'
    ).run(bid, content, userId);
    const obsId = result.lastInsertRowid as number;
    const obs = db.prepare('SELECT * FROM baby_observations WHERE id = ?').get(obsId) as any;

    console.log(`[Baby] Observation created: babyId=${bid} "${content.slice(0, 50)}" by userId=${userId}`);

    // LLM 비동기 평가
    const babyContext = getBabyContext(bid);
    (async () => {
      try {
        const llmResult = await chatCompletion([
          {
            role: 'system',
            content: `당신은 소아과 전문의 수준의 아기 건강 관찰 도우미입니다.
부모가 기록한 아기의 특이사항을 평가해주세요.
현재 시각: ${nowKSTString()}

규칙:
- 반드시 JSON으로만 응답: {"severity": "common"|"watch"|"danger", "reasoning": "한국어 1~2문장"}
- common: 신생아/영아에게 흔한 현상, 대부분 자연스럽게 좋아짐
- watch: 관찰이 필요한 현상, 악화되면 소아과 방문 권장
- danger: 즉시 소아과 방문이 필요할 수 있는 현상
- 아기의 월령을 반드시 고려하세요
- reasoning은 부모가 안심할 수 있도록 따뜻하면서도 정확하게
- JSON 외 텍스트 절대 금지`,
          },
          {
            role: 'user',
            content: `${babyContext}\n\n새로 기록된 특이사항: "${content}"`,
          },
        ]);

        if (llmResult) {
          const jsonMatch = llmResult.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.severity && parsed.reasoning) {
              db.prepare('UPDATE baby_observations SET severity = ?, llmReasoning = ? WHERE id = ?')
                .run(parsed.severity, parsed.reasoning, obsId);
              console.log(`[Baby] Observation evaluated: id=${obsId} severity=${parsed.severity}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`[Baby] Observation LLM eval error: ${err.message}`);
      }
    })();

    return enrichObservation(obs);
  });

  app.put('/api/baby/observations/:id/toggle', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const obs = db.prepare('SELECT * FROM baby_observations WHERE id = ?').get(Number(id)) as any;
    if (!obs) return reply.code(404).send({ error: 'Observation not found' });

    const newStatus = obs.status === 'active' ? 'resolved' : 'active';
    const resolvedAt = newStatus === 'resolved' ? new Date().toISOString() : null;
    db.prepare('UPDATE baby_observations SET status = ?, resolvedAt = ? WHERE id = ?')
      .run(newStatus, resolvedAt, Number(id));

    console.log(`[Baby] Observation toggled: id=${id} → ${newStatus}`);
    const updated = db.prepare('SELECT * FROM baby_observations WHERE id = ?').get(Number(id)) as any;
    return enrichObservation(updated);
  });

  app.delete('/api/baby/observations/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT id FROM baby_observations WHERE id = ?').get(Number(id)) as any;
    if (!existing) return reply.code(404).send({ error: 'Observation not found' });

    db.prepare('DELETE FROM baby_observations WHERE id = ?').run(Number(id));
    console.log(`[Baby] Observation deleted: id=${id}`);
    return { ok: true };
  });

  // Re-evaluate observation (manual trigger or after data changes)
  app.post('/api/baby/observations/:id/evaluate', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const obs = db.prepare('SELECT * FROM baby_observations WHERE id = ?').get(Number(id)) as any;
    if (!obs) return reply.code(404).send({ error: 'Observation not found' });

    const babyContext = getBabyContext(obs.babyId);
    const llmResult = await chatCompletion([
      {
        role: 'system',
        content: `당신은 소아과 전문의 수준의 아기 건강 관찰 도우미입니다.
부모가 기록한 아기의 특이사항을 평가해주세요.
현재 시각: ${nowKSTString()}

규칙:
- 반드시 JSON으로만 응답: {"severity": "common"|"watch"|"danger", "reasoning": "한국어 1~2문장"}
- common: 신생아/영아에게 흔한 현상, 대부분 자연스럽게 좋아짐
- watch: 관찰이 필요한 현상, 악화되면 소아과 방문 권장
- danger: 즉시 소아과 방문이 필요할 수 있는 현상
- 아기의 월령을 반드시 고려하세요
- reasoning은 부모가 안심할 수 있도록 따뜻하면서도 정확하게
- JSON 외 텍스트 절대 금지`,
      },
      {
        role: 'user',
        content: `${babyContext}\n\n평가할 특이사항: "${obs.content}"`,
      },
    ]);

    if (llmResult) {
      const jsonMatch = llmResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.severity && parsed.reasoning) {
          db.prepare('UPDATE baby_observations SET severity = ?, llmReasoning = ? WHERE id = ?')
            .run(parsed.severity, parsed.reasoning, Number(id));
          const updated = db.prepare('SELECT * FROM baby_observations WHERE id = ?').get(Number(id)) as any;
          return enrichObservation(updated);
        }
      }
    }

    return enrichObservation(obs);
  });

  // ============================================================
  // 걱정 채팅 (Worry Chat)
  // ============================================================

  app.get('/api/baby/:babyId/chat', { preHandler: authenticate }, async (request) => {
    const { babyId } = request.params as { babyId: string };
    const rows = db.prepare(
      'SELECT * FROM baby_chat_messages WHERE babyId = ? ORDER BY createdAt ASC, id ASC'
    ).all(Number(babyId)) as any[];
    return rows.map(r => {
      if (r.userId) {
        const user = db.prepare('SELECT name, profileImage FROM users WHERE id = ?').get(r.userId) as any;
        return { ...r, userName: user?.name || '사용자', userImage: user?.profileImage || null };
      }
      return { ...r, userName: null, userImage: null };
    });
  });

  app.post('/api/baby/:babyId/chat', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const { babyId } = request.params as { babyId: string };
    const { content } = request.body as { content: string };
    const bid = Number(babyId);

    // Save user message
    const userResult = db.prepare(
      'INSERT INTO baby_chat_messages (babyId, role, content, userId) VALUES (?, ?, ?, ?)'
    ).run(bid, 'user', content, userId);
    const userMsg = db.prepare('SELECT * FROM baby_chat_messages WHERE id = ?').get(userResult.lastInsertRowid) as any;
    const userName = (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as any)?.name || '사용자';

    console.log(`[Baby] Chat user message: babyId=${bid} "${content.slice(0, 50)}" by ${userName}`);

    // Get all history
    const history = db.prepare(
      'SELECT role, content FROM baby_chat_messages WHERE babyId = ? ORDER BY createdAt ASC, id ASC'
    ).all(bid) as { role: string; content: string }[];

    const babyContext = getBabyContext(bid);
    const systemPrompt = `당신은 아기를 키우는 부모의 걱정을 들어주고 도와주는 따뜻한 육아 상담사입니다.
현재 시각: ${nowKSTString()}

아래는 이 아기의 정보입니다:
${babyContext}

규칙:
- 부모의 걱정에 공감하면서도 전문적으로 답변하세요
- 아기의 실제 기록(수유, 수면, 특이사항)을 참고하여 답변하세요
- 위험한 증상이 있으면 소아과 방문을 권유하세요
- 한국어로 답변, 존댓말 사용
- 간결하게 3~5문장으로 답변하세요
- 마크다운 형식은 사용하지 마세요`;

    // Build messages with chat history
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add chat history
    for (const msg of history) {
      messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }

    // Try LLM call (30s timeout for chat with long history)
    let llmResponse = await chatCompletion(messages, 120000);

    // If failed and history is long, try trimming oldest pair once (possible context overflow)
    if (!llmResponse && history.length > 4) {
      const oldestPair = db.prepare(
        'SELECT id FROM baby_chat_messages WHERE babyId = ? ORDER BY createdAt ASC, id ASC LIMIT 2'
      ).all(bid) as { id: number }[];

      if (oldestPair.length >= 2) {
        for (const row of oldestPair) {
          db.prepare('DELETE FROM baby_chat_messages WHERE id = ?').run(row.id);
        }
        console.log(`[Baby] Chat trimmed oldest pair for babyId=${bid}, retrying`);

        const trimmedHistory = db.prepare(
          'SELECT role, content FROM baby_chat_messages WHERE babyId = ? ORDER BY createdAt ASC, id ASC'
        ).all(bid) as { role: string; content: string }[];
        messages.length = 1; // Keep system prompt
        for (const msg of trimmedHistory) {
          messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
        }

        llmResponse = await chatCompletion(messages, 120000);
      }
    }

    const reply = llmResponse || '죄송해요, 지금은 답변을 드리기 어려워요. 잠시 후 다시 시도해주세요.';

    // Save assistant message
    const assistantResult = db.prepare(
      'INSERT INTO baby_chat_messages (babyId, role, content) VALUES (?, ?, ?)'
    ).run(bid, 'assistant', reply);
    const assistantMsg = db.prepare('SELECT * FROM baby_chat_messages WHERE id = ?').get(assistantResult.lastInsertRowid) as any;

    console.log(`[Baby] Chat assistant reply: babyId=${bid} "${reply.slice(0, 50)}"`);

    return {
      userMessage: { ...userMsg, userName, userImage: null },
      assistantMessage: { ...assistantMsg, userName: null, userImage: null },
    };
  });

  app.delete('/api/baby/:babyId/chat', { preHandler: authenticate }, async (request) => {
    const { babyId } = request.params as { babyId: string };
    db.prepare('DELETE FROM baby_chat_messages WHERE babyId = ?').run(Number(babyId));
    console.log(`[Baby] Chat cleared: babyId=${babyId}`);
    return { ok: true };
  });

  // ============================================================
  // Vaccination Schedule + CRUD
  // ============================================================

  app.get('/api/baby/:babyId/vaccinations', { preHandler: authenticate }, async (request) => {
    const { babyId } = request.params as { babyId: string };
    const bid = Number(babyId);

    const comboSetting = db.prepare("SELECT value FROM baby_settings WHERE key = ?").get(`vacc_combo_${bid}`) as { value: string } | undefined;
    const rotaSetting = db.prepare("SELECT value FROM baby_settings WHERE key = ?").get(`vacc_rota_${bid}`) as { value: string } | undefined;
    const jeSetting = db.prepare("SELECT value FROM baby_settings WHERE key = ?").get(`vacc_je_${bid}`) as { value: string } | undefined;

    const choices = {
      combo: comboSetting?.value || 'hexa',
      rota: rotaSetting?.value || 'rv5',
      je: jeSetting?.value || 'ijev',
    };

    const schedule = getVaccineSchedule(choices.combo, choices.rota, choices.je);
    const completions = db.prepare('SELECT vaccineCode, completedDate, hospital, memo FROM baby_vaccinations WHERE babyId = ?').all(bid) as any[];

    return { schedule, completions, choices };
  });

  app.post('/api/baby/:babyId/vaccinations', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const { babyId } = request.params as { babyId: string };
    const { vaccineCode, completedDate, hospital, memo } = request.body as any;
    const bid = Number(babyId);

    const existing = db.prepare('SELECT id FROM baby_vaccinations WHERE babyId = ? AND vaccineCode = ?').get(bid, vaccineCode) as any;
    if (existing) {
      db.prepare('UPDATE baby_vaccinations SET completedDate = ?, hospital = ?, memo = ?, completedBy = ? WHERE id = ?')
        .run(completedDate, hospital || '', memo || '', userId, existing.id);
    } else {
      db.prepare('INSERT INTO baby_vaccinations (babyId, vaccineCode, completedDate, hospital, memo, completedBy) VALUES (?, ?, ?, ?, ?, ?)')
        .run(bid, vaccineCode, completedDate, hospital || '', memo || '', userId);
    }

    const babyName = (db.prepare('SELECT name FROM babies WHERE id = ?').get(bid) as any)?.name || '아기';
    console.log(`[Baby] Vaccination completed: ${babyName} ${vaccineCode} on ${completedDate} by userId=${userId}`);
    sendPushToOthers(userId, `${getUserName(userId)}님이 ${babyName} 예방접종 기록`, `${vaccineCode} 완료 💉`, '/parenting');

    return { ok: true };
  });

  app.delete('/api/baby/:babyId/vaccinations/:code', { preHandler: authenticate }, async (request) => {
    const { babyId, code } = request.params as { babyId: string; code: string };
    db.prepare('DELETE FROM baby_vaccinations WHERE babyId = ? AND vaccineCode = ?').run(Number(babyId), code);
    console.log(`[Baby] Vaccination unchecked: babyId=${babyId} ${code}`);
    return { ok: true };
  });

  app.put('/api/baby/:babyId/vaccinations/choices', { preHandler: authenticate }, async (request) => {
    const { babyId } = request.params as { babyId: string };
    const { combo, rota, je } = request.body as { combo?: string; rota?: string; je?: string };
    const bid = Number(babyId);

    const upsert = db.prepare(`INSERT INTO baby_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now', '+9 hours')`);
    if (combo) upsert.run(`vacc_combo_${bid}`, combo);
    if (rota) upsert.run(`vacc_rota_${bid}`, rota);
    if (je) upsert.run(`vacc_je_${bid}`, je);

    console.log(`[Baby] Vaccination choices updated: babyId=${bid} combo=${combo} rota=${rota} je=${je}`);
    return { ok: true };
  });

  // ============================================================
  // 성장 기록 CRUD
  // ============================================================

  interface GrowthRow {
    id: number;
    babyId: number;
    measuredDate: string;
    weightKg: number | null;
    heightCm: number | null;
    headCm: number | null;
    memo: string;
    recordedBy: number;
    createdAt: string;
  }

  app.get('/api/baby/:babyId/growth', { preHandler: authenticate }, async (request) => {
    const { babyId } = request.params as { babyId: string };
    const bid = Number(babyId);
    const baby = db.prepare('SELECT * FROM babies WHERE id = ?').get(bid) as BabyRow | undefined;
    const gender = (baby?.gender === 'M' || baby?.gender === 'F') ? baby.gender : 'F';

    const records = db.prepare(
      'SELECT * FROM baby_growth_records WHERE babyId = ? ORDER BY measuredDate ASC'
    ).all(bid) as GrowthRow[];

    const enriched = records.map(r => {
      const recorder = db.prepare('SELECT name, profileImage FROM users WHERE id = ?')
        .get(r.recordedBy) as { name: string; profileImage: string | null } | undefined;
      return { ...r, recorderName: recorder?.name || '누군가', recorderImage: recorder?.profileImage || null };
    });

    return { records: enriched, standards: getWHOStandards(gender), gender };
  });

  app.post('/api/baby/:babyId/growth', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const { babyId } = request.params as { babyId: string };
    const { measuredDate, weightKg, heightCm, headCm, memo } = request.body as {
      measuredDate: string; weightKg?: number; heightCm?: number; headCm?: number; memo?: string;
    };
    const bid = Number(babyId);

    if (weightKg == null && heightCm == null && headCm == null) {
      return reply.code(400).send({ error: '최소 하나의 측정값이 필요합니다' });
    }

    const result = db.prepare(
      'INSERT INTO baby_growth_records (babyId, measuredDate, weightKg, heightCm, headCm, memo, recordedBy) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(bid, measuredDate, weightKg ?? null, heightCm ?? null, headCm ?? null, memo || '', userId);

    const record = db.prepare('SELECT * FROM baby_growth_records WHERE id = ?').get(result.lastInsertRowid) as GrowthRow;
    const babyName = (db.prepare('SELECT name FROM babies WHERE id = ?').get(bid) as any)?.name || '아기';
    const parts: string[] = [];
    if (weightKg != null) parts.push(`${weightKg}kg`);
    if (heightCm != null) parts.push(`${heightCm}cm`);
    if (headCm != null) parts.push(`머리둘레 ${headCm}cm`);
    console.log(`[Baby] Growth recorded: ${babyName} ${parts.join(', ')} on ${measuredDate} by userId=${userId}`);
    sendPushToOthers(userId, `${getUserName(userId)}님이 ${babyName} 성장 기록`, parts.join(', ') + ' 📏', '/parenting');

    return { ok: true, record };
  });

  app.delete('/api/baby/:babyId/growth/:id', { preHandler: authenticate }, async (request) => {
    const { babyId, id } = request.params as { babyId: string; id: string };
    db.prepare('DELETE FROM baby_growth_records WHERE id = ? AND babyId = ?').run(Number(id), Number(babyId));
    console.log(`[Baby] Growth record deleted: id=${id} babyId=${babyId}`);
    return { ok: true };
  });
}

// ============================================================
// WHO 2006 성장 표준 (= 한국 2017 소아 성장도표 0-24개월)
// ============================================================

interface WHOPercentiles {
  months: number[];
  P3: number[];
  P15: number[];
  P50: number[];
  P85: number[];
  P97: number[];
}

interface WHOStandards {
  weight: WHOPercentiles;
  height: WHOPercentiles;
  head: WHOPercentiles;
}

const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

// WHO Child Growth Standards (2006) — Boys
const WHO_BOYS: WHOStandards = {
  weight: {
    months: MONTHS,
    P3:  [2.5, 3.4, 4.3, 5.0, 5.6, 6.0, 6.4, 6.7, 6.9, 7.1, 7.4, 7.6, 7.7, 7.9, 8.1, 8.3, 8.4, 8.6, 8.8, 8.9, 9.1, 9.2, 9.4, 9.5, 9.7],
    P15: [2.9, 3.9, 4.9, 5.7, 6.2, 6.7, 7.1, 7.4, 7.7, 7.9, 8.2, 8.4, 8.6, 8.8, 9.0, 9.2, 9.4, 9.6, 9.8, 10.0, 10.1, 10.3, 10.5, 10.7, 10.8],
    P50: [3.3, 4.5, 5.6, 6.4, 7.0, 7.5, 7.9, 8.3, 8.6, 8.9, 9.2, 9.4, 9.6, 9.9, 10.1, 10.3, 10.5, 10.7, 10.9, 11.1, 11.3, 11.5, 11.8, 12.0, 12.2],
    P85: [3.9, 5.1, 6.3, 7.2, 7.8, 8.4, 8.8, 9.2, 9.6, 9.9, 10.2, 10.5, 10.8, 11.0, 11.3, 11.5, 11.8, 12.0, 12.2, 12.5, 12.7, 12.9, 13.2, 13.4, 13.7],
    P97: [4.4, 5.8, 7.1, 8.0, 8.7, 9.3, 9.8, 10.3, 10.7, 11.0, 11.4, 11.7, 12.0, 12.3, 12.6, 12.8, 13.1, 13.4, 13.7, 13.9, 14.2, 14.5, 14.7, 15.0, 15.3],
  },
  height: {
    months: MONTHS,
    P3:  [46.1, 50.8, 54.4, 57.3, 59.7, 61.7, 63.3, 64.8, 66.2, 67.5, 68.7, 69.9, 71.0, 72.1, 73.1, 74.1, 75.0, 75.9, 76.7, 77.5, 78.4, 79.2, 79.9, 80.7, 81.4],
    P15: [47.9, 52.7, 56.4, 59.4, 61.8, 63.8, 65.5, 67.0, 68.4, 69.7, 71.0, 72.2, 73.4, 74.5, 75.6, 76.6, 77.5, 78.4, 79.3, 80.2, 81.0, 81.8, 82.5, 83.3, 84.1],
    P50: [49.9, 54.7, 58.4, 61.4, 63.9, 65.9, 67.6, 69.2, 70.6, 72.0, 73.3, 74.5, 75.7, 76.9, 78.0, 79.1, 80.2, 81.2, 82.3, 83.2, 84.2, 85.1, 86.0, 86.9, 87.8],
    P85: [51.8, 56.7, 60.4, 63.5, 66.0, 68.0, 69.8, 71.3, 72.8, 74.2, 75.6, 76.9, 78.1, 79.3, 80.5, 81.7, 82.8, 83.9, 85.0, 86.0, 87.0, 87.9, 88.8, 89.7, 90.6],
    P97: [53.7, 58.6, 62.4, 65.5, 68.0, 70.1, 71.9, 73.5, 75.0, 76.5, 77.9, 79.2, 80.5, 81.8, 83.0, 84.2, 85.4, 86.5, 87.7, 88.8, 89.8, 90.9, 91.9, 92.9, 93.8],
  },
  head: {
    months: MONTHS,
    P3:  [31.9, 34.4, 36.2, 37.5, 38.6, 39.4, 40.1, 40.7, 41.2, 41.6, 42.0, 42.3, 42.6, 42.9, 43.1, 43.4, 43.6, 43.8, 44.0, 44.2, 44.4, 44.6, 44.7, 44.9, 45.0],
    P15: [33.0, 35.5, 37.3, 38.7, 39.7, 40.5, 41.2, 41.7, 42.2, 42.6, 43.0, 43.4, 43.7, 43.9, 44.2, 44.4, 44.6, 44.8, 45.0, 45.2, 45.4, 45.5, 45.7, 45.8, 46.0],
    P50: [34.5, 36.9, 38.8, 40.1, 41.1, 41.9, 42.6, 43.1, 43.5, 43.9, 44.3, 44.6, 44.9, 45.2, 45.4, 45.7, 45.9, 46.1, 46.2, 46.4, 46.6, 46.7, 46.9, 47.0, 47.2],
    P85: [35.8, 38.3, 40.1, 41.5, 42.5, 43.3, 44.0, 44.5, 44.9, 45.3, 45.6, 46.0, 46.3, 46.5, 46.7, 46.9, 47.1, 47.3, 47.5, 47.6, 47.8, 47.9, 48.1, 48.2, 48.4],
    P97: [37.0, 39.5, 41.3, 42.7, 43.8, 44.6, 45.3, 45.8, 46.3, 46.6, 47.0, 47.3, 47.6, 47.8, 48.1, 48.3, 48.5, 48.7, 48.8, 49.0, 49.2, 49.3, 49.5, 49.6, 49.8],
  },
};

// WHO Child Growth Standards (2006) — Girls
const WHO_GIRLS: WHOStandards = {
  weight: {
    months: MONTHS,
    P3:  [2.4, 3.2, 3.9, 4.5, 5.0, 5.4, 5.7, 6.0, 6.3, 6.5, 6.7, 6.9, 7.0, 7.2, 7.4, 7.6, 7.7, 7.9, 8.1, 8.2, 8.4, 8.6, 8.7, 8.9, 9.0],
    P15: [2.8, 3.6, 4.5, 5.2, 5.7, 6.1, 6.5, 6.8, 7.0, 7.3, 7.5, 7.7, 7.9, 8.1, 8.3, 8.5, 8.7, 8.8, 9.0, 9.2, 9.4, 9.5, 9.7, 9.9, 10.0],
    P50: [3.2, 4.2, 5.1, 5.8, 6.4, 6.9, 7.3, 7.6, 7.9, 8.2, 8.5, 8.7, 8.9, 9.2, 9.4, 9.6, 9.8, 10.0, 10.2, 10.4, 10.6, 10.9, 11.1, 11.3, 11.5],
    P85: [3.7, 4.8, 5.8, 6.6, 7.3, 7.8, 8.2, 8.6, 9.0, 9.3, 9.6, 9.9, 10.1, 10.4, 10.6, 10.9, 11.1, 11.4, 11.6, 11.8, 12.1, 12.3, 12.5, 12.8, 13.0],
    P97: [4.2, 5.5, 6.6, 7.5, 8.2, 8.8, 9.3, 9.8, 10.2, 10.5, 10.9, 11.2, 11.5, 11.8, 12.1, 12.4, 12.6, 12.9, 13.2, 13.5, 13.7, 14.0, 14.3, 14.6, 14.8],
  },
  height: {
    months: MONTHS,
    P3:  [45.4, 49.8, 53.0, 55.6, 57.8, 59.6, 61.2, 62.7, 64.0, 65.3, 66.5, 67.7, 68.9, 70.0, 71.0, 72.0, 73.0, 73.9, 74.8, 75.6, 76.4, 77.2, 78.0, 78.7, 79.3],
    P15: [47.2, 51.7, 55.0, 57.7, 59.9, 61.8, 63.5, 65.0, 66.4, 67.7, 69.0, 70.3, 71.4, 72.6, 73.7, 74.7, 75.8, 76.7, 77.7, 78.6, 79.5, 80.3, 81.1, 81.9, 82.5],
    P50: [49.1, 53.7, 57.1, 59.8, 62.1, 64.0, 65.7, 67.3, 68.7, 70.1, 71.5, 72.8, 74.0, 75.2, 76.4, 77.5, 78.6, 79.7, 80.7, 81.7, 82.7, 83.7, 84.6, 85.5, 86.4],
    P85: [51.0, 55.6, 59.1, 61.9, 64.3, 66.2, 68.0, 69.6, 71.1, 72.6, 74.0, 73.3, 76.7, 77.9, 79.1, 80.3, 81.5, 82.7, 83.8, 84.9, 85.9, 87.0, 88.0, 89.0, 90.0],
    P97: [52.9, 57.6, 61.1, 64.0, 66.4, 68.5, 70.3, 71.9, 73.5, 75.0, 76.4, 77.8, 79.2, 80.5, 81.7, 83.0, 84.2, 85.4, 86.5, 87.6, 88.7, 89.8, 90.8, 91.8, 92.9],
  },
  head: {
    months: MONTHS,
    P3:  [31.5, 33.9, 35.6, 36.9, 37.9, 38.7, 39.3, 39.8, 40.3, 40.7, 41.0, 41.3, 41.5, 41.8, 42.0, 42.2, 42.4, 42.5, 42.7, 42.9, 43.0, 43.2, 43.3, 43.4, 43.6],
    P15: [32.7, 35.1, 36.8, 38.2, 39.2, 40.0, 40.6, 41.2, 41.6, 42.0, 42.3, 42.6, 42.9, 43.1, 43.3, 43.5, 43.7, 43.9, 44.0, 44.2, 44.3, 44.5, 44.6, 44.7, 44.9],
    P50: [33.9, 36.5, 38.3, 39.5, 40.6, 41.5, 42.0, 42.5, 43.0, 43.3, 43.7, 44.0, 44.2, 44.5, 44.7, 44.9, 45.1, 45.2, 45.4, 45.5, 45.7, 45.8, 46.0, 46.1, 46.2],
    P85: [35.1, 37.7, 39.5, 40.9, 42.0, 42.8, 43.4, 43.9, 44.4, 44.7, 45.1, 45.4, 45.6, 45.9, 46.1, 46.3, 46.5, 46.6, 46.8, 46.9, 47.1, 47.2, 47.4, 47.5, 47.6],
    P97: [36.2, 38.9, 40.7, 42.1, 43.3, 44.1, 44.7, 45.2, 45.6, 46.0, 46.4, 46.7, 46.9, 47.2, 47.4, 47.6, 47.8, 47.9, 48.1, 48.2, 48.4, 48.5, 48.7, 48.8, 49.0],
  },
};

function getWHOStandards(gender: 'M' | 'F'): WHOStandards {
  return gender === 'M' ? WHO_BOYS : WHO_GIRLS;
}

// ============================================================
// Vaccination Schedule Data (질병관리청 2026 기준)
// ============================================================

interface VaccineItem {
  code: string;
  name: string;
  dose: number;
  ageMonths: number;
  ageEndMonths: number;
  ageLabel: string;
  description: string;
}

function getVaccineSchedule(combo: string, rota: string, je: string): VaccineItem[] {
  const schedule: VaccineItem[] = [
    // 출생~1개월
    { code: 'BCG_1', name: 'BCG', dose: 1, ageMonths: 0, ageEndMonths: 1, ageLabel: '출생~1개월', description: '결핵 (피내용)' },
    { code: 'HepB_1', name: 'B형간염', dose: 1, ageMonths: 0, ageEndMonths: 1, ageLabel: '출생~1개월', description: 'B형간염(HepB)' },
    // 1개월
    { code: 'HepB_2', name: 'B형간염', dose: 2, ageMonths: 1, ageEndMonths: 2, ageLabel: '1개월', description: 'B형간염(HepB)' },
  ];

  // 2개월
  if (combo === 'hexa') {
    schedule.push({ code: 'HEXA_1', name: '헥사심(6가)', dose: 1, ageMonths: 2, ageEndMonths: 3, ageLabel: '2개월', description: 'DTaP + IPV + Hib + HepB' });
  } else {
    schedule.push({ code: 'PENTA_1', name: '5가 혼합', dose: 1, ageMonths: 2, ageEndMonths: 3, ageLabel: '2개월', description: 'DTaP + IPV + Hib' });
  }
  schedule.push({ code: 'PCV_1', name: '폐렴구균', dose: 1, ageMonths: 2, ageEndMonths: 3, ageLabel: '2개월', description: 'PCV' });
  if (rota === 'rv1') {
    schedule.push({ code: 'RV1_1', name: '로타(RV1)', dose: 1, ageMonths: 2, ageEndMonths: 3, ageLabel: '2개월', description: '로타바이러스 (경구)' });
  } else {
    schedule.push({ code: 'RV5_1', name: '로타(RV5)', dose: 1, ageMonths: 2, ageEndMonths: 3, ageLabel: '2개월', description: '로타바이러스 (경구)' });
  }

  // 4개월
  if (combo === 'hexa') {
    schedule.push({ code: 'HEXA_2', name: '헥사심(6가)', dose: 2, ageMonths: 4, ageEndMonths: 5, ageLabel: '4개월', description: 'DTaP + IPV + Hib + HepB' });
  } else {
    schedule.push({ code: 'PENTA_2', name: '5가 혼합', dose: 2, ageMonths: 4, ageEndMonths: 5, ageLabel: '4개월', description: 'DTaP + IPV + Hib' });
  }
  schedule.push({ code: 'PCV_2', name: '폐렴구균', dose: 2, ageMonths: 4, ageEndMonths: 5, ageLabel: '4개월', description: 'PCV' });
  if (rota === 'rv1') {
    schedule.push({ code: 'RV1_2', name: '로타(RV1)', dose: 2, ageMonths: 4, ageEndMonths: 5, ageLabel: '4개월', description: '로타바이러스 (경구, 마지막)' });
  } else {
    schedule.push({ code: 'RV5_2', name: '로타(RV5)', dose: 2, ageMonths: 4, ageEndMonths: 5, ageLabel: '4개월', description: '로타바이러스 (경구)' });
  }

  // 6개월
  if (combo === 'hexa') {
    schedule.push({ code: 'HEXA_3', name: '헥사심(6가)', dose: 3, ageMonths: 6, ageEndMonths: 7, ageLabel: '6개월', description: 'DTaP + IPV + Hib + HepB' });
  } else {
    schedule.push({ code: 'PENTA_3', name: '5가 혼합', dose: 3, ageMonths: 6, ageEndMonths: 7, ageLabel: '6개월', description: 'DTaP + IPV + Hib' });
    schedule.push({ code: 'HepB_3', name: 'B형간염', dose: 3, ageMonths: 6, ageEndMonths: 7, ageLabel: '6개월', description: 'B형간염(HepB) - 분리접종' });
  }
  schedule.push({ code: 'PCV_3', name: '폐렴구균', dose: 3, ageMonths: 6, ageEndMonths: 7, ageLabel: '6개월', description: 'PCV' });
  if (rota === 'rv5') {
    schedule.push({ code: 'RV5_3', name: '로타(RV5)', dose: 3, ageMonths: 6, ageEndMonths: 7, ageLabel: '6개월', description: '로타바이러스 (경구, 마지막)' });
  }

  // 12~15개월
  schedule.push(
    { code: 'Hib_4', name: 'Hib', dose: 4, ageMonths: 12, ageEndMonths: 15, ageLabel: '12~15개월', description: 'b형헤모필루스인플루엔자 (추가)' },
    { code: 'PCV_4', name: '폐렴구균', dose: 4, ageMonths: 12, ageEndMonths: 15, ageLabel: '12~15개월', description: 'PCV (추가)' },
    { code: 'MMR_1', name: 'MMR', dose: 1, ageMonths: 12, ageEndMonths: 15, ageLabel: '12~15개월', description: '홍역 + 볼거리 + 풍진' },
    { code: 'VAR_1', name: '수두', dose: 1, ageMonths: 12, ageEndMonths: 15, ageLabel: '12~15개월', description: '수두(VAR)' },
  );

  // 12~23개월
  schedule.push(
    { code: 'HepA_1', name: 'A형간염', dose: 1, ageMonths: 12, ageEndMonths: 23, ageLabel: '12~23개월', description: 'A형간염(HepA)' },
    { code: 'HepA_2', name: 'A형간염', dose: 2, ageMonths: 18, ageEndMonths: 23, ageLabel: '12~23개월', description: 'A형간염(HepA) - 1차 후 6개월 이후' },
  );

  // 일본뇌염 (12~23개월 / 12~35개월)
  if (je === 'ijev') {
    schedule.push(
      { code: 'IJEV_1', name: '일본뇌염(사백신)', dose: 1, ageMonths: 12, ageEndMonths: 23, ageLabel: '12~23개월', description: '불활성화 백신' },
      { code: 'IJEV_2', name: '일본뇌염(사백신)', dose: 2, ageMonths: 12, ageEndMonths: 23, ageLabel: '12~23개월', description: '불활성화 백신 (1차 후 7~30일)' },
    );
  } else {
    schedule.push(
      { code: 'LJEV_1', name: '일본뇌염(생백신)', dose: 1, ageMonths: 12, ageEndMonths: 35, ageLabel: '12~35개월', description: '약독화 생백신' },
    );
  }

  // 15~18개월
  schedule.push({ code: 'DTaP_4', name: 'DTaP', dose: 4, ageMonths: 15, ageEndMonths: 18, ageLabel: '15~18개월', description: '디프테리아/파상풍/백일해 (추가)' });

  // 24~35개월
  if (je === 'ijev') {
    schedule.push({ code: 'IJEV_3', name: '일본뇌염(사백신)', dose: 3, ageMonths: 24, ageEndMonths: 35, ageLabel: '24~35개월', description: '불활성화 백신' });
  } else {
    schedule.push({ code: 'LJEV_2', name: '일본뇌염(생백신)', dose: 2, ageMonths: 24, ageEndMonths: 35, ageLabel: '24~35개월', description: '약독화 생백신' });
  }

  // 4~6세
  schedule.push(
    { code: 'DTaP_5', name: 'DTaP', dose: 5, ageMonths: 48, ageEndMonths: 72, ageLabel: '4~6세', description: '디프테리아/파상풍/백일해' },
    { code: 'IPV_4', name: 'IPV', dose: 4, ageMonths: 48, ageEndMonths: 72, ageLabel: '4~6세', description: '폴리오' },
    { code: 'MMR_2', name: 'MMR', dose: 2, ageMonths: 48, ageEndMonths: 72, ageLabel: '4~6세', description: '홍역 + 볼거리 + 풍진' },
  );

  // 6세 (IJEV only)
  if (je === 'ijev') {
    schedule.push({ code: 'IJEV_4', name: '일본뇌염(사백신)', dose: 4, ageMonths: 72, ageEndMonths: 84, ageLabel: '6세', description: '불활성화 백신' });
  }

  // 11~12세
  schedule.push({ code: 'Tdap_1', name: 'Tdap', dose: 1, ageMonths: 132, ageEndMonths: 144, ageLabel: '11~12세', description: '파상풍/디프테리아/백일해 (청소년)' });

  // 12세
  if (je === 'ijev') {
    schedule.push({ code: 'IJEV_5', name: '일본뇌염(사백신)', dose: 5, ageMonths: 144, ageEndMonths: 156, ageLabel: '12세', description: '불활성화 백신 (마지막)' });
  }
  schedule.push(
    { code: 'HPV_1', name: 'HPV', dose: 1, ageMonths: 144, ageEndMonths: 156, ageLabel: '12세', description: '사람유두종바이러스' },
    { code: 'HPV_2', name: 'HPV', dose: 2, ageMonths: 144, ageEndMonths: 156, ageLabel: '12세', description: '사람유두종바이러스' },
  );

  return schedule;
}

// Auto-create vaccination todos for upcoming vaccinations (within 14 days)
export function checkVaccinationTodos() {
  const babies = db.prepare('SELECT id, name, birthDate FROM babies').all() as BabyRow[];
  const now = new Date();

  for (const baby of babies) {
    if (!baby.birthDate) continue;
    const birthDate = new Date(baby.birthDate);
    const bid = baby.id;

    const comboSetting = db.prepare("SELECT value FROM baby_settings WHERE key = ?").get(`vacc_combo_${bid}`) as { value: string } | undefined;
    const rotaSetting = db.prepare("SELECT value FROM baby_settings WHERE key = ?").get(`vacc_rota_${bid}`) as { value: string } | undefined;
    const jeSetting = db.prepare("SELECT value FROM baby_settings WHERE key = ?").get(`vacc_je_${bid}`) as { value: string } | undefined;

    const schedule = getVaccineSchedule(
      comboSetting?.value || 'hexa',
      rotaSetting?.value || 'rv5',
      jeSetting?.value || 'ijev',
    );

    const completions = db.prepare('SELECT vaccineCode FROM baby_vaccinations WHERE babyId = ?').all(bid) as { vaccineCode: string }[];
    const completedSet = new Set(completions.map(c => c.vaccineCode));

    for (const vacc of schedule) {
      if (completedSet.has(vacc.code)) continue;

      const scheduledDate = new Date(birthDate);
      scheduledDate.setMonth(scheduledDate.getMonth() + vacc.ageMonths);

      const daysUntil = Math.floor((scheduledDate.getTime() - now.getTime()) / 86400000);
      // Within 14 days ahead or up to 30 days overdue
      if (daysUntil <= 14 && daysUntil >= -30) {
        const todoTitle = `${baby.name} ${vacc.name} ${vacc.dose}차 접종`;
        const existing = db.prepare(
          "SELECT id FROM todos WHERE title = ? AND status != 'done'"
        ).get(todoTitle) as { id: number } | undefined;

        if (!existing) {
          const dueDate = `${scheduledDate.getFullYear()}-${String(scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(scheduledDate.getDate()).padStart(2, '0')}`;
          const result = db.prepare(
            "INSERT INTO todos (creatorId, title, description, priority, dueDate) VALUES (1, ?, ?, 'high', ?)"
          ).run(todoTitle, `예방접종: ${vacc.description} (${vacc.ageLabel})`, dueDate);
          const todoId = result.lastInsertRowid as number;

          // Assign to all active users
          const users = db.prepare('SELECT id FROM users WHERE banned = 0').all() as { id: number }[];
          for (const u of users) {
            try { db.prepare('INSERT INTO todo_assignees (todoId, userId) VALUES (?, ?)').run(todoId, u.id); } catch {}
          }

          console.log(`[Baby] Auto-created vaccination todo: "${todoTitle}" due ${dueDate}`);
        }
      }
    }
  }
}
