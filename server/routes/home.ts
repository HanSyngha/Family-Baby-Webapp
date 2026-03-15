import type { FastifyInstance } from 'fastify';
import db from '../db.js';
import { authenticate } from '../auth.js';
import { checkVaccinationTodos } from './baby.js';

function pad(n: number) { return String(n).padStart(2, '0'); }

function todayKST(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function registerHomeRoutes(app: FastifyInstance) {
  app.get('/api/home/summary', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const today = todayKST();
    const now = new Date();

    // 1. Family: users + babies
    const users = db.prepare('SELECT id, name, profileImage, role, birthDate FROM users WHERE banned = 0').all() as any[];
    const babies = db.prepare('SELECT id, name, birthDate FROM babies').all() as any[];

    const family: any[] = [
      ...users.map(u => ({ name: u.name, birthDate: u.birthDate, type: 'parent', role: u.role, profileImage: u.profileImage })),
      ...babies.map(b => ({ name: b.name, birthDate: b.birthDate, type: 'baby', profileImage: null })),
    ];

    // 2. Upcoming birthdays
    const upcomingBirthdays: any[] = [];
    for (const member of family) {
      if (!member.birthDate) continue;
      const bd = new Date(member.birthDate);
      const thisYearBd = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
      let nextBd = thisYearBd;
      const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (thisYearBd.getTime() < todayDate.getTime()) {
        nextBd = new Date(now.getFullYear() + 1, bd.getMonth(), bd.getDate());
      }
      const daysUntil = Math.round((nextBd.getTime() - todayDate.getTime()) / 86400000);
      const turningAge = nextBd.getFullYear() - bd.getFullYear();
      upcomingBirthdays.push({
        name: member.name,
        monthDay: `${pad(bd.getMonth() + 1)}-${pad(bd.getDate())}`,
        daysUntil,
        turningAge,
        type: member.type,
      });
    }
    upcomingBirthdays.sort((a: any, b: any) => a.daysUntil - b.daysUntil);

    // 3. Today's events + upcoming 5 events
    const todayStart = today + ' 00:00:00';
    const todayEnd = today + ' 23:59:59';

    const todayEvents = db.prepare(`
      SELECT e.id, e.title, e.startAt, e.endAt, e.allDay, e.color
      FROM calendar_events e
      WHERE e.id NOT IN (SELECT eventId FROM calendar_recurrence)
      AND e.startAt <= ? AND e.endAt >= ?
      AND (e.isPrivate = 0 OR e.creatorId = ?)
    `).all(todayEnd, todayStart, userId) as any[];

    // All recurring events (no date filter on base — hitsDate handles it)
    const recurringAll = db.prepare(`
      SELECT e.id, e.title, e.startAt, e.endAt, e.allDay, e.color,
        cr.type as recType, cr.interval as recInterval, cr.daysOfWeek, cr.dayOfMonth, cr.monthOfYear, cr.endDate
      FROM calendar_events e
      JOIN calendar_recurrence cr ON cr.eventId = e.id
      WHERE (e.isPrivate = 0 OR e.creatorId = ?)
    `).all(userId) as any[];

    const todayDate = new Date(today);
    for (const evt of recurringAll) {
      if (hitsDate(evt, todayDate)) {
        todayEvents.push({ id: evt.id, title: evt.title, startAt: evt.startAt, endAt: evt.endAt, allDay: !!evt.allDay, color: evt.color });
      }
    }

    // Upcoming events (next 5 after today, including recurring)
    const upcomingNonRec = db.prepare(`
      SELECT e.id, e.title, e.startAt, e.endAt, e.allDay, e.color
      FROM calendar_events e
      WHERE e.id NOT IN (SELECT eventId FROM calendar_recurrence)
      AND e.startAt > ?
      AND (e.isPrivate = 0 OR e.creatorId = ?)
      ORDER BY e.startAt ASC
      LIMIT 10
    `).all(todayEnd, userId) as any[];

    // Expand recurring events for next 90 days
    const upcomingEvents: any[] = [...upcomingNonRec];
    const futureEnd = new Date(now.getTime() + 90 * 86400000);
    for (const evt of recurringAll) {
      const base = new Date(evt.startAt);
      const baseDuration = new Date(evt.endAt).getTime() - base.getTime();
      // Check each day from tomorrow to futureEnd
      for (let d = new Date(todayDate.getTime() + 86400000); d <= futureEnd; d.setDate(d.getDate() + 1)) {
        if (hitsDate(evt, d)) {
          const instEnd = new Date(d.getTime() + baseDuration);
          upcomingEvents.push({
            id: evt.id,
            title: evt.title,
            startAt: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(base.getHours())}:${pad(base.getMinutes())}:00`,
            endAt: `${instEnd.getFullYear()}-${pad(instEnd.getMonth()+1)}-${pad(instEnd.getDate())} ${pad(instEnd.getHours())}:${pad(instEnd.getMinutes())}:00`,
            allDay: !!evt.allDay,
            color: evt.color,
          });
        }
      }
    }
    upcomingEvents.sort((a: any, b: any) => a.startAt.localeCompare(b.startAt));
    upcomingEvents.splice(5); // keep top 5

    // 4. Baby summaries (all babies, younger first)
    const sortedBabies = [...babies].sort((a: any, b: any) => {
      if (!a.birthDate) return 1;
      if (!b.birthDate) return -1;
      return b.birthDate.localeCompare(a.birthDate); // newer birthDate = younger = first
    });

    const babySummaries: any[] = [];
    const todaySql = `date('now', '+9 hours')`;

    for (const baby of sortedBabies) {
      const bid = baby.id;

      const fStats = db.prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(CASE WHEN type='formula' THEN amountMl ELSE 0 END), 0) as totalMl
        FROM feedings WHERE babyId = ? AND startedAt >= ${todaySql}
      `).get(bid) as any;

      const sStats = db.prepare(`
        SELECT COALESCE(SUM(durationSec), 0) as totalSec
        FROM sleeps WHERE babyId = ? AND startedAt >= ${todaySql} AND endedAt IS NOT NULL
      `).get(bid) as any;

      const dStats = db.prepare(`
        SELECT COUNT(*) as cnt,
          COALESCE(SUM(CASE WHEN type IN ('pee','both') THEN 1 ELSE 0 END), 0) as pee,
          COALESCE(SUM(CASE WHEN type IN ('poop','both') THEN 1 ELSE 0 END), 0) as poop
        FROM diapers WHERE babyId = ? AND changedAt >= ${todaySql}
      `).get(bid) as any;

      const lastF = db.prepare('SELECT startedAt, type, amountMl, side, durationSec FROM feedings WHERE babyId = ? ORDER BY startedAt DESC LIMIT 1').get(bid) as any;
      const lastS = db.prepare('SELECT startedAt, endedAt, durationSec FROM sleeps WHERE babyId = ? ORDER BY startedAt DESC LIMIT 1').get(bid) as any;
      const lastD = db.prepare('SELECT changedAt, type, color, consistency FROM diapers WHERE babyId = ? ORDER BY changedAt DESC LIMIT 1').get(bid) as any;
      const fPred = db.prepare("SELECT predictedAt, reasoning FROM baby_predictions WHERE babyId = ? AND type='feeding' ORDER BY createdAt DESC LIMIT 1").get(bid) as any;
      const sPred = db.prepare("SELECT predictedAt, reasoning FROM baby_predictions WHERE babyId = ? AND type='sleep' ORDER BY createdAt DESC LIMIT 1").get(bid) as any;
      const dPred = db.prepare("SELECT predictedAt, reasoning FROM baby_predictions WHERE babyId = ? AND type='diaper' ORDER BY createdAt DESC LIMIT 1").get(bid) as any;

      babySummaries.push({
        babyId: baby.id,
        babyName: baby.name,
        babyBirthDate: baby.birthDate,
        todayFeedingCount: fStats.cnt,
        totalFormulaMl: fStats.totalMl,
        totalSleepMin: Math.floor(sStats.totalSec / 60),
        todayDiaperCount: dStats.cnt,
        todayPeeCount: dStats.pee,
        todayPoopCount: dStats.poop,
        lastFeeding: lastF || null,
        lastSleep: lastS || null,
        lastDiaper: lastD || null,
        feedingPrediction: fPred ? { predictedAt: fPred.predictedAt, reasoning: fPred.reasoning } : null,
        sleepPrediction: sPred ? { predictedAt: sPred.predictedAt, reasoning: sPred.reasoning } : null,
        diaperPrediction: dPred ? { predictedAt: dPred.predictedAt, reasoning: dPred.reasoning } : null,
      });
    }

    // 4.5. Auto-create vaccination todos (runs on each home load)
    try { checkVaccinationTodos(); } catch (err: any) { console.error('[Home] Vaccination todo check error:', err.message); }

    // 5. Todo summary
    const todoActive = db.prepare("SELECT COUNT(*) as cnt FROM todos WHERE status != 'done'").get() as any;
    const todoOverdue = db.prepare(`
      SELECT COUNT(*) as cnt FROM todos WHERE status != 'done' AND dueDate IS NOT NULL AND dueDate < date('now', '+9 hours')
    `).get() as any;

    return {
      family,
      upcomingBirthdays,
      todayEvents,
      upcomingEvents,
      babySummaries,
      todoSummary: {
        activeCount: todoActive.cnt,
        overdueCount: todoOverdue.cnt,
      },
    };
  });
}

function hitsDate(evt: any, targetDate: Date): boolean {
  const base = new Date(evt.startAt);
  const { recType, recInterval, endDate } = evt;

  if (endDate && new Date(endDate) < targetDate) return false;

  if (recType === 'daily') {
    const daysDiff = Math.floor((targetDate.getTime() - new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) / 86400000);
    return daysDiff >= 0 && daysDiff % recInterval === 0;
  } else if (recType === 'weekly') {
    const days = evt.daysOfWeek ? JSON.parse(evt.daysOfWeek) : [base.getDay()];
    if (!days.includes(targetDate.getDay())) return false;
    const weeksDiff = Math.floor((targetDate.getTime() - new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) / (7 * 86400000));
    return weeksDiff >= 0 && weeksDiff % recInterval === 0;
  } else if (recType === 'monthly') {
    const dayOfMonth = evt.dayOfMonth || base.getDate();
    if (targetDate.getDate() !== dayOfMonth) return false;
    const monthsDiff = (targetDate.getFullYear() - base.getFullYear()) * 12 + targetDate.getMonth() - base.getMonth();
    return monthsDiff >= 0 && monthsDiff % recInterval === 0;
  } else if (recType === 'yearly') {
    const month = evt.monthOfYear ? evt.monthOfYear - 1 : base.getMonth();
    const day = evt.dayOfMonth || base.getDate();
    if (targetDate.getMonth() !== month || targetDate.getDate() !== day) return false;
    const yearsDiff = targetDate.getFullYear() - base.getFullYear();
    return yearsDiff >= 0 && yearsDiff % recInterval === 0;
  }
  return false;
}
