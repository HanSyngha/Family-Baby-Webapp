import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../auth.js';
import db from '../db.js';

const PHOTO_DIR = path.resolve('data', 'trip-photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

/**
 * 여행 계획(견적).
 *
 * - 작성/수정/삭제는 **플래너(한승하) 본인 + 에이전트 토큰**만. 다른 master는 published 건만 읽기 전용.
 * - `displayDiscountPct`: 플래너가 아닌 사람에게 보일 때 서버가 금액에 일괄 적용한다.
 *   실가격은 DB에만 남고 응답에서 아예 빠지므로, 뷰어 쪽 네트워크 탭에도 노출되지 않는다.
 * - 에이전트(Claude)는 `Authorization: Bearer $AGENT_TOKEN`으로 플래너 권한을 얻어
 *   조사 결과를 `/import`로 한 번에 밀어넣는다.
 */

const PLANNER_NAME = '한승하';
const CATEGORIES = ['flight', 'lodging', 'transport', 'activity', 'food', 'etc'];
const STATUSES = ['draft', 'published', 'archived'];

interface TripAuth {
  userId: number;
  isPlanner: boolean;
  isAgent: boolean;
}

function getPlanner(): { id: number } | undefined {
  return db.prepare('SELECT id FROM users WHERE name = ? ORDER BY id LIMIT 1').get(PLANNER_NAME) as any;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// 에이전트 토큰(Bearer) → 플래너 권한, 아니면 일반 세션 인증(master만).
function tripAuth(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const agentToken = process.env.AGENT_TOKEN;
  const header = request.headers['authorization'];
  const bearer = header && header.startsWith('Bearer ') ? header.slice(7) : null;

  if (agentToken && bearer && safeEqual(bearer, agentToken)) {
    const planner = getPlanner();
    if (!planner) {
      reply.code(503).send({ error: `플래너(${PLANNER_NAME}) 계정을 찾을 수 없습니다` });
      return;
    }
    (request as any).trip = { userId: planner.id, isPlanner: true, isAgent: true } as TripAuth;
    console.log(`[TripPlan] agent request: ${request.method} ${request.url}`);
    done();
    return;
  }

  authenticate(request, reply, () => {
    const { userId, role } = (request as any).user;
    if (role !== 'master') {
      reply.code(403).send({ error: '여행 계획은 관리자만 볼 수 있습니다' });
      return;
    }
    const planner = getPlanner();
    (request as any).trip = { userId, isPlanner: !!planner && planner.id === userId, isAgent: false } as TripAuth;
    done();
  });
}

function auth(request: FastifyRequest): TripAuth {
  return (request as any).trip as TripAuth;
}

// '와이프 뷰' 미리보기: 플래너가 ?viewAs=viewer로 요청하면 상대가 보는 그대로(할인 적용,
// 요청 숨김, 편집 불가)를 서버가 만들어 내려준다. 클라에서 흉내내지 않고 서버가 만들어야
// 실제 상대 화면과 100% 일치한다.
function isViewerPreview(request: FastifyRequest): boolean {
  return (request.query as any)?.viewAs === 'viewer' && auth(request).isPlanner;
}

function requirePlanner(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!auth(request).isPlanner) {
    reply.code(403).send({ error: `견적은 ${PLANNER_NAME}만 작성할 수 있습니다` });
    return false;
  }
  return true;
}

// ============================================================
// 표시 금액 (플래너가 아닌 사람에게만 할인 적용)
// ============================================================

function roundPrice(v: number): number {
  if (v >= 50000) return Math.round(v / 1000) * 1000;
  if (v >= 5000) return Math.round(v / 100) * 100;
  return Math.round(v / 10) * 10;
}

function shown(value: number | null | undefined, pct: number): number | null {
  if (value === null || value === undefined) return null;
  if (!pct) return Math.round(value);
  return roundPrice(value * (1 - pct / 100));
}

// 제목·메모 같은 자유 텍스트에 적힌 금액도 같이 깎는다.
// (숫자 필드만 깎으면 "TOP1 알뜰안 (293만)" 같은 제목으로 실제 금액이 그대로 새어나간다)
// 원/만원/만 으로 끝나는 표기만 건드린다 — 리뷰 수(2,007개)·치수(4,545mm)·시간(2시간 20분)은 그대로.
function scaleMoneyText(text: any, pct: number): any {
  if (typeof text !== 'string' || !text || !pct) return text;
  const f = 1 - pct / 100;
  return text
    // 1,240,000원 → 992,000원 (1,000원 미만은 금액 표기가 아닐 확률이 높아 건너뜀)
    .replace(/(\d[\d,]*)\s*원/g, (m, num) => {
      const v = Number(String(num).replace(/,/g, ''));
      if (!Number.isFinite(v) || v < 1000) return m;
      return roundPrice(v * f).toLocaleString('ko-KR') + '원';
    })
    // 293만 / 21.5만원 → 비율대로 ('원'이 없으면 뒤 공백을 먹지 않도록 그룹으로 묶는다)
    .replace(/(\d+(?:\.\d+)?)\s*만(?:\s*원)?/g, (m, num) => {
      const v = Number(num);
      if (!Number.isFinite(v)) return m;
      const scaled = v * f;
      const s = Number.isInteger(scaled) ? String(scaled) : String(Math.round(scaled * 10) / 10);
      return s + (m.includes('원') ? '만원' : '만');
    });
}

function scaleFields<T extends Record<string, any>>(row: T, pct: number, fields: string[]): T {
  if (!pct) return row;
  const out: any = { ...row };
  for (const f of fields) out[f] = scaleMoneyText(out[f], pct);
  return out;
}

function toInt(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

function nowKst(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

function touchPlan(planId: number) {
  db.prepare('UPDATE trip_plans SET updatedAt = ? WHERE id = ?').run(nowKst(), planId);
}

// 뷰어에겐 실제 할인율을 숨긴다(0으로 내려보냄).
function mapPlan(plan: any, isPlanner: boolean) {
  const pct = isPlanner ? 0 : plan.displayDiscountPct;
  return {
    ...scaleFields(plan, pct, ['title', 'memo']),
    displayDiscountPct: isPlanner ? plan.displayDiscountPct : 0,
    canEdit: isPlanner,
  };
}

function mapOption(row: any, pct: number) {
  return { ...scaleFields(row, pct, ['title', 'priceNote', 'pros', 'cons', 'memo']), priceKrw: shown(row.priceKrw, pct) };
}

function mapItem(row: any, pct: number) {
  return { ...scaleFields(row, pct, ['title', 'memo']), costKrw: shown(row.costKrw, pct) };
}

// 조합 총액: 후보 가격 × 수량 + 기타비용. 뷰어에겐 '할인 후 개별 금액'을 더해
// 목록 합계와 총액이 어긋나지 않게 한다.
function scenarioTotals(scenarioId: number, extraKrw: number, pct: number) {
  const rows = db.prepare(`
    SELECT so.optionId, so.qty, o.priceKrw
    FROM trip_plan_scenario_options so
    JOIN trip_plan_options o ON o.id = so.optionId
    WHERE so.scenarioId = ?
  `).all(scenarioId) as { optionId: number; qty: number; priceKrw: number | null }[];

  let optionsKrw = 0;
  for (const r of rows) {
    const price = shown(r.priceKrw, pct);
    if (price !== null) optionsKrw += price * (r.qty || 1);
  }
  const extra = shown(extraKrw, pct) ?? 0;
  return {
    optionIds: rows.map(r => r.optionId),
    optionQty: Object.fromEntries(rows.map(r => [r.optionId, r.qty || 1])),
    optionsKrw,
    extraKrw: extra,
    totalKrw: optionsKrw + extra,
  };
}

// 목록 카드용: 선호 조합(없으면 최저가 조합) 총액
function planHeadline(planId: number, pct: number): { totalKrw: number | null; scenarioCount: number; optionCount: number } {
  const scenarios = db.prepare('SELECT id, extraKrw, isPreferred FROM trip_plan_scenarios WHERE planId = ? ORDER BY sortOrder, id').all(planId) as any[];
  const optionCount = (db.prepare('SELECT COUNT(*) c FROM trip_plan_options WHERE planId = ?').get(planId) as any).c;
  if (scenarios.length === 0) return { totalKrw: null, scenarioCount: 0, optionCount };

  const totals = scenarios.map(s => ({ isPreferred: !!s.isPreferred, total: scenarioTotals(s.id, s.extraKrw, pct).totalKrw }));
  const preferred = totals.find(t => t.isPreferred);
  const totalKrw = preferred ? preferred.total : Math.min(...totals.map(t => t.total));
  return { totalKrw, scenarioCount: scenarios.length, optionCount };
}

// PATCH 공통: 허용된 컬럼만 부분 갱신
function patchRow(table: string, allowed: string[], id: number, body: any): boolean {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const key of allowed) {
    if (body[key] === undefined) continue;
    sets.push(`${key} = ?`);
    vals.push(body[key]);
  }
  if (sets.length === 0) return false;
  vals.push(id);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return true;
}

function normalizeOption(o: any) {
  const category = CATEGORIES.includes(o.category) ? o.category : 'etc';
  return {
    category,
    title: String(o.title ?? '').trim().slice(0, 200),
    provider: String(o.provider ?? '').slice(0, 120),
    priceKrw: toInt(o.priceKrw),
    priceNote: String(o.priceNote ?? '').slice(0, 200),
    startAt: o.startAt ?? null,
    endAt: o.endAt ?? null,
    durationMin: toInt(o.durationMin),
    location: String(o.location ?? '').slice(0, 200),
    url: String(o.url ?? '').slice(0, 1000),
    rating: o.rating === null || o.rating === undefined || o.rating === '' ? null : Number(o.rating),
    pros: String(o.pros ?? '').slice(0, 2000),
    cons: String(o.cons ?? '').slice(0, 2000),
    memo: String(o.memo ?? '').slice(0, 4000),
    sortOrder: toInt(o.sortOrder) ?? 0,
    lat: o.lat === null || o.lat === undefined || o.lat === '' ? null : Number(o.lat),
    lng: o.lng === null || o.lng === undefined || o.lng === '' ? null : Number(o.lng),
  };
}

function insertOption(planId: number, o: any, createdBy: string): number {
  const n = normalizeOption(o);
  const r = db.prepare(`
    INSERT INTO trip_plan_options
      (planId, category, title, provider, priceKrw, priceNote, startAt, endAt, durationMin, location, url, rating, pros, cons, memo, createdBy, sortOrder, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(planId, n.category, n.title, n.provider, n.priceKrw, n.priceNote, n.startAt, n.endAt, n.durationMin,
    n.location, n.url, n.rating, n.pros, n.cons, n.memo, createdBy, n.sortOrder, n.lat, n.lng);
  return r.lastInsertRowid as number;
}

function insertItem(planId: number, it: any, scenarioId: number | null, optionId: number | null): number {
  const r = db.prepare(`
    INSERT INTO trip_plan_items (planId, scenarioId, optionId, dayIndex, date, startTime, endTime, title, place, costKrw, memo, sortOrder, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    planId, scenarioId, optionId,
    toInt(it.dayIndex) ?? 1,
    it.date ?? null,
    it.startTime ?? null,
    it.endTime ?? null,
    String(it.title ?? '').trim().slice(0, 200),
    String(it.place ?? '').slice(0, 200),
    toInt(it.costKrw),
    String(it.memo ?? '').slice(0, 2000),
    toInt(it.sortOrder) ?? 0,
    it.lat === null || it.lat === undefined || it.lat === '' ? null : Number(it.lat),
    it.lng === null || it.lng === undefined || it.lng === '' ? null : Number(it.lng),
  );
  return r.lastInsertRowid as number;
}

// 외부 이미지를 받아 webp로 줄여 NAS에 저장. 실패해도 나머지 사진은 계속 처리한다.
async function savePhoto(optionId: number, url: string, caption: string, sortOrder: number): Promise<boolean> {
  try {
    if (!/^https?:\/\//i.test(url)) return false;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://kr.trip.com/' } });
    if (!res.ok) { console.warn(`[TripPhoto] fetch 실패 ${res.status}: ${url.slice(0, 80)}`); return false; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return false;
    const filename = uuidv4() + '.webp';
    await sharp(buf).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 })
      .toFile(path.join(PHOTO_DIR, filename));
    db.prepare('INSERT INTO trip_plan_option_photos (optionId, filename, caption, sortOrder) VALUES (?, ?, ?, ?)')
      .run(optionId, filename, String(caption ?? '').slice(0, 100), sortOrder);
    return true;
  } catch (e) {
    console.warn(`[TripPhoto] 저장 실패: ${url.slice(0, 80)} — ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

function photosByOption(planId: number): Map<number, any[]> {
  const rows = db.prepare(`
    SELECT p.id, p.optionId, p.filename, p.caption
    FROM trip_plan_option_photos p JOIN trip_plan_options o ON o.id = p.optionId
    WHERE o.planId = ? ORDER BY p.sortOrder, p.id
  `).all(planId) as any[];
  const map = new Map<number, any[]>();
  for (const r of rows) {
    if (!map.has(r.optionId)) map.set(r.optionId, []);
    map.get(r.optionId)!.push({ id: r.id, filename: r.filename, caption: r.caption });
  }
  return map;
}

// 계획 조회 + 접근 판정 (draft는 플래너만)
function loadPlan(planId: number, a: TripAuth): any | null {
  const plan = db.prepare('SELECT * FROM trip_plans WHERE id = ?').get(planId) as any;
  if (!plan) return null;
  if (!a.isPlanner && plan.status !== 'published') return null;
  return plan;
}

export function registerTripPlanRoutes(app: FastifyInstance) {
  // ---------- 계획 ----------

  // 목록. 뷰어에겐 published만.
  app.get('/api/trip-plans', { preHandler: tripAuth }, async (request) => {
    const a = auth(request);
    const preview = isViewerPreview(request);
    const asPlanner = a.isPlanner && !preview;

    // 미리보기에서도 '공개된 것만' 보여야 상대 화면과 같아진다.
    const rows = asPlanner
      ? db.prepare('SELECT * FROM trip_plans ORDER BY sortOrder, COALESCE(startDate, createdAt) DESC, id DESC').all() as any[]
      : db.prepare("SELECT * FROM trip_plans WHERE status = 'published' ORDER BY sortOrder, COALESCE(startDate, createdAt) DESC, id DESC").all() as any[];

    const items = rows.map(p => {
      const pct = asPlanner ? 0 : p.displayDiscountPct;
      return { ...mapPlan(p, asPlanner), ...planHeadline(p.id, pct) };
    });
    return { items, isPlanner: a.isPlanner, asPlanner, preview, plannerName: PLANNER_NAME };
  });

  // 상세: 후보 + 조합(총액) + 일정 + 요청
  app.get('/api/trip-plans/:id', { preHandler: tripAuth }, async (request, reply) => {
    const a = auth(request);
    const preview = isViewerPreview(request);
    const asPlanner = a.isPlanner && !preview;
    const planId = parseInt((request.params as any).id);
    const plan = loadPlan(planId, a);
    if (!plan) return reply.code(404).send({ error: 'Not found' });
    const pct = asPlanner ? 0 : plan.displayDiscountPct;

    const photoMap = photosByOption(planId);
    const options = (db.prepare('SELECT * FROM trip_plan_options WHERE planId = ? ORDER BY category, sortOrder, id').all(planId) as any[])
      .map(o => ({ ...mapOption(o, pct), photos: photoMap.get(o.id) ?? [] }));

    const scenarios = (db.prepare('SELECT * FROM trip_plan_scenarios WHERE planId = ? ORDER BY sortOrder, id').all(planId) as any[])
      .map(s => ({ ...scaleFields(s, pct, ['title', 'memo']), isPreferred: !!s.isPreferred, ...scenarioTotals(s.id, s.extraKrw, pct) }));

    const items = (db.prepare('SELECT * FROM trip_plan_items WHERE planId = ? ORDER BY dayIndex, (startTime IS NULL), startTime, sortOrder, id').all(planId) as any[])
      .map(i => mapItem(i, pct));

    // 리서치 요청은 플래너 작업용이라 뷰어(및 미리보기)에겐 안 보낸다.
    const requests = asPlanner
      ? db.prepare("SELECT * FROM trip_plan_requests WHERE planId = ? ORDER BY (status = 'done'), id DESC").all(planId)
      : [];

    return {
      plan: mapPlan(plan, asPlanner),
      options, scenarios, items, requests,
      isPlanner: a.isPlanner,
      asPlanner,
      preview,
      // 미리보기 중인데 아직 공개 전이면, 실제로는 상대에게 안 보인다는 걸 알려준다.
      previewNotVisibleYet: preview && plan.status !== 'published',
    };
  });

  app.post('/api/trip-plans', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const a = auth(request);
    const b = request.body as any;
    if (!b?.title?.trim()) return reply.code(400).send({ error: '여행 이름을 입력하세요' });
    const r = db.prepare(`
      INSERT INTO trip_plans (ownerId, title, destination, startDate, endDate, adults, children, budgetKrw, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      a.userId, b.title.trim().slice(0, 100), String(b.destination ?? '').slice(0, 100),
      b.startDate ?? null, b.endDate ?? null,
      toInt(b.adults) ?? 2, toInt(b.children) ?? 1, toInt(b.budgetKrw), String(b.memo ?? '').slice(0, 4000),
    );
    const plan = db.prepare('SELECT * FROM trip_plans WHERE id = ?').get(r.lastInsertRowid);
    return mapPlan(plan, true);
  });

  app.patch('/api/trip-plans/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const planId = parseInt((request.params as any).id);
    if (!db.prepare('SELECT id FROM trip_plans WHERE id = ?').get(planId)) return reply.code(404).send({ error: 'Not found' });
    const b = { ...(request.body as any) };

    if (b.status !== undefined && !STATUSES.includes(b.status)) return reply.code(400).send({ error: '잘못된 상태' });
    if (b.displayDiscountPct !== undefined) {
      const pct = Number(b.displayDiscountPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 90) return reply.code(400).send({ error: '할인율은 0~90% 사이여야 합니다' });
      b.displayDiscountPct = pct;
    }
    for (const k of ['adults', 'children', 'budgetKrw', 'sortOrder']) if (b[k] !== undefined) b[k] = toInt(b[k]);
    if (b.status === 'published') b.publishedAt = nowKst();
    b.updatedAt = nowKst();

    patchRow('trip_plans', ['title', 'destination', 'startDate', 'endDate', 'adults', 'children', 'budgetKrw', 'memo', 'status', 'displayDiscountPct', 'albumId', 'sortOrder', 'publishedAt', 'updatedAt'], planId, b);
    return mapPlan(db.prepare('SELECT * FROM trip_plans WHERE id = ?').get(planId), true);
  });

  app.delete('/api/trip-plans/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    db.prepare('DELETE FROM trip_plans WHERE id = ?').run(parseInt((request.params as any).id));
    return { ok: true };
  });

  // ---------- 후보 ----------

  app.post('/api/trip-plans/:id/options', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const a = auth(request);
    const planId = parseInt((request.params as any).id);
    if (!db.prepare('SELECT id FROM trip_plans WHERE id = ?').get(planId)) return reply.code(404).send({ error: 'Not found' });
    const b = request.body as any;
    const list: any[] = Array.isArray(b) ? b : Array.isArray(b?.options) ? b.options : [b];
    const valid = list.filter(o => String(o?.title ?? '').trim());
    if (valid.length === 0) return reply.code(400).send({ error: '후보 이름을 입력하세요' });

    const createdBy = a.isAgent ? 'agent' : 'manual';
    const ids = db.transaction(() => valid.map(o => insertOption(planId, o, createdBy)))();
    touchPlan(planId);
    const rows = db.prepare(`SELECT * FROM trip_plan_options WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    return { ok: true, added: ids.length, options: rows };
  });

  app.patch('/api/trip-plan-options/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    const row = db.prepare('SELECT planId FROM trip_plan_options WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    const b = { ...(request.body as any) };
    if (b.category !== undefined && !CATEGORIES.includes(b.category)) return reply.code(400).send({ error: '잘못된 분류' });
    for (const k of ['priceKrw', 'durationMin', 'sortOrder']) if (b[k] !== undefined) b[k] = toInt(b[k]);
    b.updatedAt = nowKst();
    patchRow('trip_plan_options', ['category', 'title', 'provider', 'priceKrw', 'priceNote', 'startAt', 'endAt', 'durationMin', 'location', 'url', 'rating', 'pros', 'cons', 'memo', 'sortOrder', 'lat', 'lng', 'updatedAt'], id, b);
    touchPlan(row.planId);
    return db.prepare('SELECT * FROM trip_plan_options WHERE id = ?').get(id);
  });

  app.delete('/api/trip-plan-options/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    const row = db.prepare('SELECT planId FROM trip_plan_options WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    for (const p of db.prepare('SELECT filename FROM trip_plan_option_photos WHERE optionId = ?').all(id) as any[]) {
      try { fs.unlinkSync(path.join(PHOTO_DIR, p.filename)); } catch {}
    }
    db.prepare('DELETE FROM trip_plan_options WHERE id = ?').run(id);
    touchPlan(row.planId);
    return { ok: true };
  });

  // ---------- 후보 사진 (숙소 수영장/객실 등) ----------

  // URL 목록을 주면 서버가 받아서 webp로 저장한다. 에이전트가 조사하며 한 번에 넣는 용도.
  app.post('/api/trip-plan-options/:id/photos', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    if (!db.prepare('SELECT id FROM trip_plan_options WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Not found' });
    const body = request.body as any;
    const list: any[] = Array.isArray(body) ? body : Array.isArray(body?.photos) ? body.photos : [];
    if (list.length === 0) return reply.code(400).send({ error: '사진 URL이 없습니다' });
    if (list.length > 30) return reply.code(400).send({ error: '한 번에 30장까지' });

    const base = (db.prepare('SELECT COALESCE(MAX(sortOrder), 0) m FROM trip_plan_option_photos WHERE optionId = ?').get(id) as any).m;
    let saved = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const ok = await savePhoto(id, typeof p === 'string' ? p : p?.url, typeof p === 'string' ? '' : p?.caption, base + i + 1);
      if (ok) saved++;
    }
    console.log(`[TripPhoto] option=${id} 요청 ${list.length}장 → 저장 ${saved}장`);
    return { ok: true, saved, requested: list.length, photos: db.prepare('SELECT id, filename, caption FROM trip_plan_option_photos WHERE optionId = ? ORDER BY sortOrder, id').all(id) };
  });

  app.delete('/api/trip-plan-photos/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    const row = db.prepare('SELECT filename FROM trip_plan_option_photos WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    db.prepare('DELETE FROM trip_plan_option_photos WHERE id = ?').run(id);
    try { fs.unlinkSync(path.join(PHOTO_DIR, row.filename)); } catch {}
    return { ok: true };
  });

  // 사진 서빙. 파일명은 UUID라 캐시 immutable.
  app.get('/api/trip-photos/:filename', { preHandler: tripAuth }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    if (!/^[a-f0-9-]{36}\.webp$/.test(filename)) return reply.code(400).send({ error: 'Invalid' });
    const file = path.join(PHOTO_DIR, filename);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'Not found' });
    reply.headers({ 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=31536000, immutable' });
    return reply.send(fs.createReadStream(file));
  });

  // ---------- 조합(시나리오) ----------

  app.post('/api/trip-plans/:id/scenarios', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const planId = parseInt((request.params as any).id);
    if (!db.prepare('SELECT id FROM trip_plans WHERE id = ?').get(planId)) return reply.code(404).send({ error: 'Not found' });
    const b = request.body as any;
    if (!b?.title?.trim()) return reply.code(400).send({ error: '조합 이름을 입력하세요' });
    const order = (db.prepare('SELECT COALESCE(MAX(sortOrder), 0) m FROM trip_plan_scenarios WHERE planId = ?').get(planId) as any).m;
    const r = db.prepare('INSERT INTO trip_plan_scenarios (planId, title, memo, extraKrw, sortOrder) VALUES (?, ?, ?, ?, ?)')
      .run(planId, b.title.trim().slice(0, 100), String(b.memo ?? '').slice(0, 2000), toInt(b.extraKrw) ?? 0, order + 1);
    const scenarioId = r.lastInsertRowid as number;
    if (Array.isArray(b.optionIds)) setScenarioOptions(scenarioId, planId, b.optionIds);
    touchPlan(planId);
    const s = db.prepare('SELECT * FROM trip_plan_scenarios WHERE id = ?').get(scenarioId) as any;
    return { ...s, isPreferred: !!s.isPreferred, ...scenarioTotals(scenarioId, s.extraKrw, 0) };
  });

  app.patch('/api/trip-plan-scenarios/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    const row = db.prepare('SELECT planId FROM trip_plan_scenarios WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    const b = { ...(request.body as any) };
    for (const k of ['extraKrw', 'sortOrder']) if (b[k] !== undefined) b[k] = toInt(b[k]);
    if (b.isPreferred !== undefined) {
      b.isPreferred = b.isPreferred ? 1 : 0;
      // 선호 조합은 계획당 하나
      if (b.isPreferred) db.prepare('UPDATE trip_plan_scenarios SET isPreferred = 0 WHERE planId = ?').run(row.planId);
    }
    patchRow('trip_plan_scenarios', ['title', 'memo', 'extraKrw', 'isPreferred', 'sortOrder'], id, b);
    if (Array.isArray(b.optionIds)) setScenarioOptions(id, row.planId, b.optionIds);
    touchPlan(row.planId);
    const s = db.prepare('SELECT * FROM trip_plan_scenarios WHERE id = ?').get(id) as any;
    return { ...s, isPreferred: !!s.isPreferred, ...scenarioTotals(id, s.extraKrw, 0) };
  });

  app.delete('/api/trip-plan-scenarios/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    const row = db.prepare('SELECT planId FROM trip_plan_scenarios WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    db.prepare('DELETE FROM trip_plan_scenarios WHERE id = ?').run(id);
    touchPlan(row.planId);
    return { ok: true };
  });

  // ---------- 일정표 ----------

  app.post('/api/trip-plans/:id/items', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const planId = parseInt((request.params as any).id);
    if (!db.prepare('SELECT id FROM trip_plans WHERE id = ?').get(planId)) return reply.code(404).send({ error: 'Not found' });
    const b = request.body as any;
    const list: any[] = Array.isArray(b) ? b : Array.isArray(b?.items) ? b.items : [b];
    const valid = list.filter(i => String(i?.title ?? '').trim());
    if (valid.length === 0) return reply.code(400).send({ error: '일정 이름을 입력하세요' });
    const ids = db.transaction(() => valid.map(i => insertItem(planId, i, toInt(i.scenarioId), toInt(i.optionId))))();
    touchPlan(planId);
    return { ok: true, added: ids.length, items: db.prepare(`SELECT * FROM trip_plan_items WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) };
  });

  app.patch('/api/trip-plan-items/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    const row = db.prepare('SELECT planId FROM trip_plan_items WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    const b = { ...(request.body as any) };
    for (const k of ['dayIndex', 'costKrw', 'sortOrder', 'scenarioId', 'optionId']) if (b[k] !== undefined) b[k] = toInt(b[k]);
    patchRow('trip_plan_items', ['scenarioId', 'optionId', 'dayIndex', 'date', 'startTime', 'endTime', 'title', 'place', 'costKrw', 'memo', 'sortOrder', 'lat', 'lng'], id, b);
    touchPlan(row.planId);
    return db.prepare('SELECT * FROM trip_plan_items WHERE id = ?').get(id);
  });

  app.delete('/api/trip-plan-items/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    const row = db.prepare('SELECT planId FROM trip_plan_items WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    db.prepare('DELETE FROM trip_plan_items WHERE id = ?').run(id);
    touchPlan(row.planId);
    return { ok: true };
  });

  // ---------- 리서치 요청 (사용자 → 에이전트) ----------

  // 에이전트가 전체 계획을 가로질러 열린 요청을 가져간다.
  app.get('/api/trip-plans/requests/open', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    return db.prepare(`
      SELECT r.*, p.title as planTitle, p.destination, p.startDate, p.endDate, p.adults, p.children, p.budgetKrw
      FROM trip_plan_requests r JOIN trip_plans p ON p.id = r.planId
      WHERE r.status = 'open' ORDER BY r.id ASC
    `).all();
  });

  app.post('/api/trip-plans/:id/requests', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const a = auth(request);
    const planId = parseInt((request.params as any).id);
    if (!db.prepare('SELECT id FROM trip_plans WHERE id = ?').get(planId)) return reply.code(404).send({ error: 'Not found' });
    const content = String((request.body as any)?.content ?? '').trim();
    if (!content) return reply.code(400).send({ error: '요청 내용을 입력하세요' });
    const r = db.prepare('INSERT INTO trip_plan_requests (planId, content, createdBy) VALUES (?, ?, ?)')
      .run(planId, content.slice(0, 2000), a.userId);
    return db.prepare('SELECT * FROM trip_plan_requests WHERE id = ?').get(r.lastInsertRowid);
  });

  app.patch('/api/trip-plan-requests/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const id = parseInt((request.params as any).id);
    const row = db.prepare('SELECT planId FROM trip_plan_requests WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    const b = { ...(request.body as any) };
    if (b.status !== undefined && !['open', 'done'].includes(b.status)) return reply.code(400).send({ error: '잘못된 상태' });
    if (b.status === 'done') b.resolvedAt = nowKst();
    patchRow('trip_plan_requests', ['content', 'status', 'resultNote', 'resolvedAt'], id, b);
    return db.prepare('SELECT * FROM trip_plan_requests WHERE id = ?').get(id);
  });

  app.delete('/api/trip-plan-requests/:id', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    db.prepare('DELETE FROM trip_plan_requests WHERE id = ?').run(parseInt((request.params as any).id));
    return { ok: true };
  });

  // ---------- 에이전트 일괄 주입 ----------
  // 조사 결과(후보 + 조합 + 일정)를 한 번에. 후보는 ref 문자열로 조합/일정에서 참조한다.
  // replace: true면 기존 후보/조합/일정을 싹 지우고 새로 넣는다(재조사).
  app.post('/api/trip-plans/:id/import', { preHandler: tripAuth }, async (request, reply) => {
    if (!requirePlanner(request, reply)) return;
    const a = auth(request);
    const planId = parseInt((request.params as any).id);
    if (!db.prepare('SELECT id FROM trip_plans WHERE id = ?').get(planId)) return reply.code(404).send({ error: 'Not found' });

    const b = request.body as any;
    const options: any[] = Array.isArray(b?.options) ? b.options : [];
    const scenarios: any[] = Array.isArray(b?.scenarios) ? b.scenarios : [];
    const items: any[] = Array.isArray(b?.items) ? b.items : [];
    const createdBy = a.isAgent ? 'agent' : 'manual';
    const photoJobs: { optionId: number; photos: any[] }[] = [];

    const result = db.transaction(() => {
      if (b?.replace) {
        // 사진 행은 CASCADE로 지워지지만 파일은 남으므로 먼저 정리한다.
        for (const [, list] of photosByOption(planId)) {
          for (const p of list) { try { fs.unlinkSync(path.join(PHOTO_DIR, p.filename)); } catch {} }
        }
        db.prepare('DELETE FROM trip_plan_items WHERE planId = ?').run(planId);
        db.prepare('DELETE FROM trip_plan_scenarios WHERE planId = ?').run(planId);
        db.prepare('DELETE FROM trip_plan_options WHERE planId = ?').run(planId);
      }

      const refToId = new Map<string, number>();
      let optionCount = 0;
      for (const o of options) {
        if (!String(o?.title ?? '').trim()) continue;
        const id = insertOption(planId, o, createdBy);
        if (o.ref) refToId.set(String(o.ref), id);
        // 사진 다운로드는 비동기라 트랜잭션 밖에서 처리한다.
        if (Array.isArray(o.photos) && o.photos.length) photoJobs.push({ optionId: id, photos: o.photos.slice(0, 30) });
        optionCount++;
      }

      const resolveOptionId = (ref: any, id: any): number | null => {
        const direct = toInt(id);
        if (direct) return direct;
        if (ref && refToId.has(String(ref))) return refToId.get(String(ref))!;
        return null;
      };

      const scenarioRefToId = new Map<string, number>();
      let baseOrder = (db.prepare('SELECT COALESCE(MAX(sortOrder), 0) m FROM trip_plan_scenarios WHERE planId = ?').get(planId) as any).m;
      let scenarioCount = 0;
      for (const s of scenarios) {
        if (!String(s?.title ?? '').trim()) continue;
        baseOrder++;
        const sr = db.prepare('INSERT INTO trip_plan_scenarios (planId, title, memo, extraKrw, isPreferred, sortOrder) VALUES (?, ?, ?, ?, ?, ?)')
          .run(planId, String(s.title).trim().slice(0, 100), String(s.memo ?? '').slice(0, 2000), toInt(s.extraKrw) ?? 0, s.isPreferred ? 1 : 0, baseOrder);
        const scenarioId = sr.lastInsertRowid as number;
        if (s.ref) scenarioRefToId.set(String(s.ref), scenarioId);

        const refs: any[] = Array.isArray(s.optionRefs) ? s.optionRefs : [];
        const ids: any[] = Array.isArray(s.optionIds) ? s.optionIds : [];
        const optionIds = [
          ...refs.map(r => resolveOptionId(r, null)),
          ...ids.map(i => resolveOptionId(null, i)),
        ].filter((v): v is number => !!v);
        setScenarioOptions(scenarioId, planId, optionIds);
        scenarioCount++;
      }

      // 선호 조합은 하나만 유지
      const preferred = db.prepare('SELECT id FROM trip_plan_scenarios WHERE planId = ? AND isPreferred = 1 ORDER BY id DESC LIMIT 1').get(planId) as any;
      if (preferred) db.prepare('UPDATE trip_plan_scenarios SET isPreferred = 0 WHERE planId = ? AND id != ?').run(planId, preferred.id);

      let itemCount = 0;
      for (const it of items) {
        if (!String(it?.title ?? '').trim()) continue;
        const scenarioId = it.scenarioRef && scenarioRefToId.has(String(it.scenarioRef))
          ? scenarioRefToId.get(String(it.scenarioRef))!
          : toInt(it.scenarioId);
        insertItem(planId, it, scenarioId, resolveOptionId(it.optionRef, it.optionId));
        itemCount++;
      }

      if (b?.plan && typeof b.plan === 'object') {
        const p = { ...b.plan };
        for (const k of ['adults', 'children', 'budgetKrw']) if (p[k] !== undefined) p[k] = toInt(p[k]);
        delete p.status; delete p.displayDiscountPct;   // 공개/할인은 import로 못 바꾼다
        p.updatedAt = nowKst();
        patchRow('trip_plans', ['title', 'destination', 'startDate', 'endDate', 'adults', 'children', 'budgetKrw', 'memo', 'updatedAt'], planId, p);
      }

      if (toInt(b?.resolveRequestId)) {
        db.prepare("UPDATE trip_plan_requests SET status = 'done', resolvedAt = ?, resultNote = ? WHERE id = ? AND planId = ?")
          .run(nowKst(), String(b.resultNote ?? '').slice(0, 2000), toInt(b.resolveRequestId), planId);
      }

      return { optionCount, scenarioCount, itemCount };
    })();

    let photoSaved = 0;
    for (const job of photoJobs) {
      for (let i = 0; i < job.photos.length; i++) {
        const p = job.photos[i];
        if (await savePhoto(job.optionId, typeof p === 'string' ? p : p?.url, typeof p === 'string' ? '' : p?.caption, i + 1)) photoSaved++;
      }
    }

    touchPlan(planId);
    console.log(`[TripPlan] import plan=${planId} by=${createdBy} options=${result.optionCount} scenarios=${result.scenarioCount} items=${result.itemCount} photos=${photoSaved} replace=${!!b?.replace}`);
    return { ok: true, ...result, photoSaved };
  });
}

// 조합의 후보 목록 교체 (해당 계획의 후보만 허용)
function setScenarioOptions(scenarioId: number, planId: number, optionIds: any[]) {
  db.prepare('DELETE FROM trip_plan_scenario_options WHERE scenarioId = ?').run(scenarioId);
  const ins = db.prepare(`
    INSERT OR IGNORE INTO trip_plan_scenario_options (scenarioId, optionId, qty)
    SELECT ?, ?, ? WHERE EXISTS(SELECT 1 FROM trip_plan_options WHERE id = ? AND planId = ?)
  `);
  for (const raw of optionIds) {
    const id = typeof raw === 'object' && raw ? toInt(raw.optionId) : toInt(raw);
    const qty = typeof raw === 'object' && raw ? (toInt(raw.qty) ?? 1) : 1;
    if (id) ins.run(scenarioId, id, Math.max(1, qty), id, planId);
  }
}
