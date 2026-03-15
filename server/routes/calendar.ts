import type { FastifyInstance, FastifyRequest } from 'fastify';
import db from '../db.js';
import { authenticate } from '../auth.js';
import { sendPushToOthers, getUserName } from '../push.js';

interface EventRow {
  id: number;
  creatorId: number;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: number;
  color: string;
  location: string;
  isPrivate: number;
  createdAt: string;
  updatedAt: string;
  creatorName: string;
  creatorImage: string | null;
}

interface RecurrenceRow {
  type: string;
  interval: number;
  daysOfWeek: string | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  endDate: string | null;
  count: number | null;
}

// 반복 일정을 월별로 확장
function expandRecurrence(event: EventRow, recurrence: RecurrenceRow, monthStart: Date, monthEnd: Date) {
  const instances: any[] = [];
  const baseStart = new Date(event.startAt);
  const baseDuration = new Date(event.endAt).getTime() - baseStart.getTime();
  const { type, interval, endDate, count } = recurrence;
  const recEnd = endDate ? new Date(endDate + ' 23:59:59') : null;
  let maxCount = count || 1000;
  let generated = 0;

  const addInstance = (date: Date) => {
    if (date < monthStart || date > monthEnd) return false;
    if (recEnd && date > recEnd) return false;
    if (generated >= maxCount) return false;
    const end = new Date(date.getTime() + baseDuration);
    instances.push({
      ...event,
      allDay: !!event.allDay,
      isPrivate: !!event.isPrivate,
      startAt: formatKST(date),
      endAt: formatKST(end),
      instanceDate: formatKST(date).slice(0, 10),
      originalEventId: event.id,
    });
    generated++;
    return true;
  };

  // 기본 이벤트 날짜부터 monthEnd까지 반복
  const cur = new Date(baseStart);

  if (type === 'daily') {
    while (cur <= monthEnd) {
      if (cur >= monthStart) addInstance(new Date(cur));
      cur.setDate(cur.getDate() + interval);
      if (recEnd && cur > recEnd) break;
      if (generated >= maxCount) break;
    }
  } else if (type === 'weekly') {
    const days = recurrence.daysOfWeek ? JSON.parse(recurrence.daysOfWeek) as number[] : [cur.getDay()];
    // 주 시작점 계산
    const weekStart = new Date(cur);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    while (weekStart <= monthEnd) {
      for (const day of days) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + day);
        d.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
        if (d >= baseStart && d >= monthStart && d <= monthEnd) {
          addInstance(d);
        }
      }
      weekStart.setDate(weekStart.getDate() + 7 * interval);
      if (recEnd && weekStart > recEnd) break;
      if (generated >= maxCount) break;
    }
  } else if (type === 'monthly') {
    const dayOfMonth = recurrence.dayOfMonth || baseStart.getDate();
    while (cur <= monthEnd) {
      const d = new Date(cur.getFullYear(), cur.getMonth(), dayOfMonth, baseStart.getHours(), baseStart.getMinutes());
      if (d >= baseStart && d >= monthStart && d <= monthEnd) {
        addInstance(d);
      }
      cur.setMonth(cur.getMonth() + interval);
      if (recEnd && cur > recEnd) break;
      if (generated >= maxCount) break;
    }
  } else if (type === 'yearly') {
    const month = recurrence.monthOfYear ? recurrence.monthOfYear - 1 : baseStart.getMonth();
    const day = recurrence.dayOfMonth || baseStart.getDate();
    let year = baseStart.getFullYear();
    while (year <= monthEnd.getFullYear() + 1) {
      const d = new Date(year, month, day, baseStart.getHours(), baseStart.getMinutes());
      if (d >= baseStart && d >= monthStart && d <= monthEnd) {
        addInstance(d);
      }
      year += interval;
      if (recEnd && new Date(year, month, day) > recEnd) break;
      if (generated >= maxCount) break;
    }
  }

  return instances;
}

function formatKST(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function enrichEvent(event: EventRow) {
  const participants = (db.prepare(`
    SELECT cp.userId, cp.status, u.name, u.profileImage
    FROM calendar_participants cp JOIN users u ON cp.userId = u.id
    WHERE cp.eventId = ?
  `).all(event.id) as any[]);

  const recurrence = db.prepare('SELECT * FROM calendar_recurrence WHERE eventId = ?').get(event.id) as RecurrenceRow | undefined;

  const reminders = (db.prepare('SELECT minutesBefore FROM calendar_reminders WHERE eventId = ?').all(event.id) as { minutesBefore: number }[])
    .map(r => r.minutesBefore);

  return {
    ...event,
    allDay: !!event.allDay,
    isPrivate: !!event.isPrivate,
    participants,
    recurrence: recurrence ? {
      type: recurrence.type,
      interval: recurrence.interval,
      daysOfWeek: recurrence.daysOfWeek ? JSON.parse(recurrence.daysOfWeek) : undefined,
      dayOfMonth: recurrence.dayOfMonth,
      monthOfYear: recurrence.monthOfYear,
      endDate: recurrence.endDate,
      count: recurrence.count,
    } : null,
    reminders,
  };
}

export function registerCalendarRoutes(app: FastifyInstance) {
  // 월별 이벤트 목록 (반복 일정 확장 포함)
  app.get('/api/calendar/events', { preHandler: authenticate }, async (request: FastifyRequest, reply) => {
    const { month } = request.query as { month?: string };
    const userId = (request as any).user.userId;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return reply.code(400).send({ error: 'month required (YYYY-MM)' });
    }

    const monthStart = new Date(`${month}-01T00:00:00`);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);
    const startStr = formatKST(monthStart);
    const endStr = formatKST(monthEnd);

    // 비반복 이벤트: 해당 월에 걸치는 것
    const nonRecurring = db.prepare(`
      SELECT e.*, u.name as creatorName, u.profileImage as creatorImage
      FROM calendar_events e
      JOIN users u ON e.creatorId = u.id
      WHERE e.id NOT IN (SELECT eventId FROM calendar_recurrence)
      AND e.startAt <= ? AND e.endAt >= ?
      AND (e.isPrivate = 0 OR e.creatorId = ? OR EXISTS(SELECT 1 FROM calendar_participants cp WHERE cp.eventId = e.id AND cp.userId = ?))
    `).all(endStr, startStr, userId, userId) as EventRow[];

    // 반복 이벤트: base 이벤트
    const recurring = db.prepare(`
      SELECT e.*, u.name as creatorName, u.profileImage as creatorImage
      FROM calendar_events e
      JOIN users u ON e.creatorId = u.id
      JOIN calendar_recurrence cr ON cr.eventId = e.id
      WHERE e.startAt <= ?
      AND (e.isPrivate = 0 OR e.creatorId = ? OR EXISTS(SELECT 1 FROM calendar_participants cp WHERE cp.eventId = e.id AND cp.userId = ?))
    `).all(endStr, userId, userId) as EventRow[];

    const results: any[] = [];

    for (const event of nonRecurring) {
      results.push(enrichEvent(event));
    }

    for (const event of recurring) {
      const recurrence = db.prepare('SELECT * FROM calendar_recurrence WHERE eventId = ?').get(event.id) as RecurrenceRow;
      const instances = expandRecurrence(event, recurrence, monthStart, monthEnd);
      for (const inst of instances) {
        const participants = (db.prepare(`
          SELECT cp.userId, cp.status, u.name, u.profileImage
          FROM calendar_participants cp JOIN users u ON cp.userId = u.id
          WHERE cp.eventId = ?
        `).all(event.id) as any[]);
        const reminders = (db.prepare('SELECT minutesBefore FROM calendar_reminders WHERE eventId = ?').all(event.id) as { minutesBefore: number }[])
          .map(r => r.minutesBefore);
        inst.participants = participants;
        inst.reminders = reminders;
        inst.recurrence = { type: recurrence.type, interval: recurrence.interval };
        results.push(inst);
      }
    }

    results.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return results;
  });

  // 단일 이벤트 조회
  app.get('/api/calendar/events/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).user.userId;
    const event = db.prepare(`
      SELECT e.*, u.name as creatorName, u.profileImage as creatorImage
      FROM calendar_events e JOIN users u ON e.creatorId = u.id WHERE e.id = ?
    `).get(Number(id)) as EventRow | undefined;
    if (!event) return reply.code(404).send({ error: 'Event not found' });
    // 비공개 이벤트: 생성자 또는 참여자만 접근
    if (event.isPrivate && event.creatorId !== userId) {
      const isParticipant = db.prepare('SELECT 1 FROM calendar_participants WHERE eventId = ? AND userId = ?').get(event.id, userId);
      if (!isParticipant) return reply.code(403).send({ error: 'Private event' });
    }
    return enrichEvent(event);
  });

  // 이벤트 생성
  app.post('/api/calendar/events', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const body = request.body as any;
    const { title, description, startAt, endAt, allDay, color, location, isPrivate, participantIds, recurrence, reminders } = body;

    if (!title || !startAt || !endAt) {
      return reply.code(400).send({ error: 'title, startAt, endAt required' });
    }

    const result = db.prepare(`
      INSERT INTO calendar_events (creatorId, title, description, startAt, endAt, allDay, color, location, isPrivate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, title, description || '', startAt, endAt, allDay ? 1 : 0, color || '#007AFF', location || '', isPrivate ? 1 : 0);

    const eventId = result.lastInsertRowid as number;

    // 참여자
    if (participantIds?.length) {
      const insertParticipant = db.prepare('INSERT OR IGNORE INTO calendar_participants (eventId, userId) VALUES (?, ?)');
      for (const pid of participantIds) {
        insertParticipant.run(eventId, pid);
      }
    }

    // 반복 규칙
    if (recurrence?.type) {
      db.prepare(`
        INSERT INTO calendar_recurrence (eventId, type, interval, daysOfWeek, dayOfMonth, monthOfYear, endDate, count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        recurrence.type,
        recurrence.interval || 1,
        recurrence.daysOfWeek ? JSON.stringify(recurrence.daysOfWeek) : null,
        recurrence.dayOfMonth || null,
        recurrence.monthOfYear || null,
        recurrence.endDate || null,
        recurrence.count || null,
      );
    }

    // 리마인더
    if (reminders?.length) {
      const insertReminder = db.prepare('INSERT OR IGNORE INTO calendar_reminders (eventId, minutesBefore) VALUES (?, ?)');
      for (const mins of reminders) {
        insertReminder.run(eventId, mins);
      }
    }

    console.log(`[Calendar] Event created: ${title} by userId=${userId}`);
    sendPushToOthers(userId, `${getUserName(userId)}님이 일정 추가`, `"${title}" 📅`, '/calendar');
    const event = db.prepare(`
      SELECT e.*, u.name as creatorName, u.profileImage as creatorImage
      FROM calendar_events e JOIN users u ON e.creatorId = u.id WHERE e.id = ?
    `).get(eventId) as EventRow;
    return enrichEvent(event);
  });

  // 이벤트 수정
  app.put('/api/calendar/events/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    const body = request.body as any;

    const userId = (request as any).user.userId;
    const existing = db.prepare('SELECT id, isPrivate, creatorId FROM calendar_events WHERE id = ?').get(eventId) as { id: number; isPrivate: number; creatorId: number } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Event not found' });
    // 비공개 이벤트: 생성자만 수정
    if (existing.isPrivate && existing.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private event' });
    }

    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, col] of [['title', 'title'], ['description', 'description'], ['startAt', 'startAt'], ['endAt', 'endAt'], ['color', 'color'], ['location', 'location']] as const) {
      if (body[key] !== undefined) { fields.push(`${col} = ?`); values.push(body[key]); }
    }
    if (body.allDay !== undefined) { fields.push('allDay = ?'); values.push(body.allDay ? 1 : 0); }
    if (body.isPrivate !== undefined) { fields.push('isPrivate = ?'); values.push(body.isPrivate ? 1 : 0); }

    if (fields.length > 0) {
      fields.push("updatedAt = datetime('now', '+9 hours')");
      db.prepare(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ?`).run(...values, eventId);
    }

    // 참여자 갱신
    if (body.participantIds !== undefined) {
      db.prepare('DELETE FROM calendar_participants WHERE eventId = ?').run(eventId);
      const ins = db.prepare('INSERT INTO calendar_participants (eventId, userId) VALUES (?, ?)');
      for (const pid of body.participantIds) ins.run(eventId, pid);
    }

    // 반복 규칙 갱신
    if (body.recurrence !== undefined) {
      db.prepare('DELETE FROM calendar_recurrence WHERE eventId = ?').run(eventId);
      if (body.recurrence?.type) {
        db.prepare(`
          INSERT INTO calendar_recurrence (eventId, type, interval, daysOfWeek, dayOfMonth, monthOfYear, endDate, count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId, body.recurrence.type, body.recurrence.interval || 1,
          body.recurrence.daysOfWeek ? JSON.stringify(body.recurrence.daysOfWeek) : null,
          body.recurrence.dayOfMonth || null, body.recurrence.monthOfYear || null,
          body.recurrence.endDate || null, body.recurrence.count || null,
        );
      }
    }

    // 리마인더 갱신
    if (body.reminders !== undefined) {
      db.prepare('DELETE FROM calendar_reminders WHERE eventId = ?').run(eventId);
      const ins = db.prepare('INSERT INTO calendar_reminders (eventId, minutesBefore) VALUES (?, ?)');
      for (const mins of body.reminders) ins.run(eventId, mins);
    }

    console.log(`[Calendar] Event updated: id=${eventId}`);
    const event = db.prepare(`
      SELECT e.*, u.name as creatorName, u.profileImage as creatorImage
      FROM calendar_events e JOIN users u ON e.creatorId = u.id WHERE e.id = ?
    `).get(eventId) as EventRow;
    sendPushToOthers((request as any).user.userId, `${getUserName((request as any).user.userId)}님이 일정 수정`, `"${event.title}" 📅`, '/calendar');
    return enrichEvent(event);
  });

  // 이벤트 삭제
  app.delete('/api/calendar/events/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).user.userId;
    const eventBefore = db.prepare('SELECT title, isPrivate, creatorId FROM calendar_events WHERE id = ?').get(Number(id)) as { title: string; isPrivate: number; creatorId: number } | undefined;
    if (!eventBefore) return reply.code(404).send({ error: 'Event not found' });
    // 비공개 이벤트: 생성자만 삭제
    if (eventBefore.isPrivate && eventBefore.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private event' });
    }
    const result = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(Number(id));
    if (result.changes === 0) return reply.code(404).send({ error: 'Event not found' });
    console.log(`[Calendar] Event deleted: id=${id}`);
    if (!eventBefore.isPrivate) sendPushToOthers(userId, `${getUserName(userId)}님이 일정 삭제`, `"${eventBefore.title}" 🗑️`, '/calendar');
    return { ok: true };
  });

  // 참석 응답
  app.post('/api/calendar/events/:id/respond', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).user.userId;
    const { status } = request.body as { status: string };
    if (!['accepted', 'declined', 'pending'].includes(status)) {
      return reply.code(400).send({ error: 'Invalid status' });
    }
    db.prepare('UPDATE calendar_participants SET status = ? WHERE eventId = ? AND userId = ?').run(status, Number(id), userId);
    console.log(`[Calendar] Event ${id} response: userId=${userId} status=${status}`);
    return { ok: true };
  });
}
