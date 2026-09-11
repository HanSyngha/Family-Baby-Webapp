import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const BASE_URL = process.env.BASE_URL || 'http://localhost:2230';

// /api/auth/token 남용 방지: '리프레시 토큰(기기)별' 분당 한도.
// IP 기반 레이트리밋은 못 쓴다 — Synology 리버스 프록시가 모든 외부 클라이언트를 동일한
// 내부 IP(192.168.x)로 합쳐 보내서, IP 키는 '전역 캡'이 되어 한 기기의 토큰 재발급 폭주가
// 다른 기기(예: 와이프폰)까지 429로 막아버린다. 그래서 토큰 해시로 직접 기기별로 센다.
// (유효 세션 토큰만 기록 → bogus 토큰 폭주로 맵이 부풀지 않음.)
const refreshRate = new Map<string, { count: number; reset: number }>();
const REFRESH_MAX_PER_MIN = 120;
const ACCESS_TOKEN_TTL_SEC = 4 * 3600;
const REFRESH_TOKEN_TTL_SEC = 90 * 24 * 3600;
const REFRESH_COOKIE = 'frefresh';

interface JwtPayload {
  userId: number;
  role: string;
  iat?: number;
  exp?: number;
}

// 인증 이벤트 로깅 (IP/기기별 세션 추적)
function logAuth(event: string, request: FastifyRequest, extra: Record<string, any> = {}) {
  const ip = request.headers['x-real-ip'] || request.headers['x-forwarded-for'] || request.ip;
  const ua = request.headers['user-agent'] || 'unknown';
  const mode = request.headers['x-app-mode'] || 'none';
  const cookies = Object.keys(request.cookies || {}).join(',');
  console.log(`[AUTH] ${event} | ip=${ip} | mode=${mode} | ua=${ua.slice(0, 80)} | cookies=[${cookies}]`, JSON.stringify(extra));
}

// 요청의 앱 모드에 따라 쿠키 이름 결정 (PWA: fpauth, 브라우저: fauth)
// P1(peanut)과 쿠키 충돌 방지를 위해 'f' prefix 사용
function getTokenCookieName(request: FastifyRequest): string {
  const mode = request.headers['x-app-mode'];
  return mode === 'pwa' ? 'fpauth' : 'fauth';
}

// JWT 검증
// 네이티브 앱(WebView 바깥 백그라운드)은 쿠키를 못 쓰므로 Authorization: Bearer 도 허용.
// Bearer 경로에서는 쿠키를 건드리지 않는다(웹 세션 회귀 방지).
export function authenticate(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const authHeader = request.headers['authorization'];
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const cookieName = getTokenCookieName(request);
  const token = bearer
    ?? (request.headers['x-app-mode']
        ? request.cookies?.[cookieName]
        : (request.cookies?.fpauth || request.cookies?.fauth));
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const user = db.prepare('SELECT id, name, banned FROM users WHERE id = ?').get(payload.userId) as any;
    if (user?.banned) {
      logAuth('BANNED', request, { userId: payload.userId });
      if (bearer) reply.code(403).send({ error: 'Banned' });
      else reply.clearCookie(cookieName, { path: '/' }).code(403).send({ error: 'Banned' });
      return;
    }
    if (request.url.startsWith('/api/auth/me')) {
      const iat = payload.iat ? new Date(payload.iat * 1000).toISOString() : '?';
      logAuth('ME', request, { userId: payload.userId, name: user?.name, cookie: bearer ? 'bearer' : cookieName, issuedAt: iat });
    }
    (request as any).user = payload;
    done();
  } catch {
    logAuth('INVALID_TOKEN', request, { cookie: bearer ? 'bearer' : cookieName });
    if (bearer) reply.code(401).send({ error: 'Invalid token' });
    else reply.clearCookie(cookieName, { path: '/' }).code(401).send({ error: 'Invalid token' });
    return;
  }
}

function generateToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '4h' });
}

// refresh token: 256bit 랜덤. 평문은 클라이언트에만, 서버는 SHA-256 해시만 저장.
function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function upsertUser(provider: string, providerId: string, name: string, profileImage: string | null) {
  // 카카오 등은 profile_image_url을 http://로 주는데 HTTPS 사이트에선 mixed-content로 차단됨 → https로 승격
  if (profileImage && profileImage.startsWith('http://')) profileImage = 'https://' + profileImage.slice(7);
  const existing = db.prepare('SELECT id, role FROM users WHERE provider = ? AND providerId = ?').get(provider, providerId) as any;

  if (existing) {
    const MASTER_NAMES = ['황하람', '한승하'];
    const updatedRole = MASTER_NAMES.includes(name) ? 'master' : existing.role;
    db.prepare('UPDATE users SET name = ?, profileImage = ?, role = ? WHERE id = ?').run(name, profileImage, updatedRole, existing.id);
    return { id: existing.id, role: updatedRole };
  }

  const MASTER_NAMES = ['황하람', '한승하'];
  const role = MASTER_NAMES.includes(name) ? 'master' : 'member';

  const result = db.prepare('INSERT INTO users (provider, providerId, name, profileImage, role) VALUES (?, ?, ?, ?, ?)').run(provider, providerId, name, profileImage, role);
  return { id: result.lastInsertRowid as number, role };
}

function getCallbackCookieName(request: FastifyRequest): string {
  return request.cookies?.app_mode === 'pwa' ? 'fpauth' : 'fauth';
}

const COOKIE_OPTS = (secure: boolean) => ({
  path: '/' as const,
  httpOnly: true,
  secure,
  sameSite: 'lax' as const,
});
const ACCESS_COOKIE_OPTS = (secure: boolean) => ({
  ...COOKIE_OPTS(secure),
  maxAge: ACCESS_TOKEN_TTL_SEC,
});
const REFRESH_COOKIE_OPTS = (secure: boolean) => ({
  ...COOKIE_OPTS(secure),
  maxAge: REFRESH_TOKEN_TTL_SEC,
});

function revokeRefreshToken(refreshToken?: string) {
  if (!refreshToken) return;
  const tokenHash = hashToken(refreshToken);
  db.prepare("UPDATE device_sessions SET revokedAt = datetime('now', '+9 hours') WHERE tokenHash = ? AND revokedAt IS NULL")
    .run(tokenHash);
}

function createRefreshSession(userId: number, deviceName: string | null) {
  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);
  db.prepare('INSERT INTO device_sessions (userId, tokenHash, deviceName) VALUES (?, ?, ?)')
    .run(userId, tokenHash, deviceName?.slice(0, 80) || null);
  return refreshToken;
}

function refreshAccessToken(refreshToken: string, request: FastifyRequest) {
  const tokenHash = hashToken(refreshToken);
  const session = db.prepare('SELECT id, userId, revokedAt FROM device_sessions WHERE tokenHash = ?').get(tokenHash) as any;
  if (!session || session.revokedAt) {
    logAuth('REFRESH_INVALID', request, {});
    return null;
  }

  const nowMs = Date.now();
  const rl = refreshRate.get(tokenHash);
  if (!rl || nowMs > rl.reset) {
    refreshRate.set(tokenHash, { count: 1, reset: nowMs + 60000 });
  } else if (rl.count >= REFRESH_MAX_PER_MIN) {
    return 'rate-limited';
  } else {
    rl.count++;
  }

  const user = db.prepare('SELECT id, role, banned FROM users WHERE id = ?').get(session.userId) as any;
  if (!user || user.banned) return null;
  db.prepare("UPDATE device_sessions SET lastUsedAt = datetime('now', '+9 hours') WHERE id = ?").run(session.id);
  return generateToken(user.id, user.role);
}

export function registerAuthRoutes(app: FastifyInstance) {
  // --- 카카오 ---
  app.get('/api/auth/kakao', async (_request, reply) => {
    const clientId = process.env.KAKAO_CLIENT_ID;
    const redirectUri = `${BASE_URL}/api/auth/kakao/callback`;
    const url = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    reply.redirect(url);
  });

  app.get('/api/auth/kakao/callback', async (request, reply) => {
    try {
      const { code } = request.query as { code: string };
      if (!code) return reply.redirect('/login?error=no_code');

      const clientId = process.env.KAKAO_CLIENT_ID!;
      const clientSecret = process.env.KAKAO_CLIENT_SECRET!;
      const redirectUri = `${BASE_URL}/api/auth/kakao/callback`;

      const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
        }),
      });
      const tokenData = await tokenRes.json() as any;
      if (!tokenData.access_token) return reply.redirect('/login?error=token_failed');

      const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json() as any;
      if (!userData.id) return reply.redirect('/login?error=user_info_failed');

      const name = userData.kakao_account?.profile?.nickname || '사용자';
      const profileImage = userData.kakao_account?.profile?.profile_image_url || null;

      const user = upsertUser('kakao', String(userData.id), name, profileImage);
      const token = generateToken(user.id, user.role);
      const refreshToken = createRefreshSession(user.id, `web:${request.headers['user-agent'] || 'unknown'}`);
      const cookieName = getCallbackCookieName(request);
      const secure = BASE_URL.startsWith('https');

      logAuth('LOGIN', request, { provider: 'kakao', userId: user.id, name, cookie: cookieName });

      revokeRefreshToken(request.cookies?.[REFRESH_COOKIE]);
      reply
        .clearCookie('fauth', { path: '/' })
        .clearCookie('fpauth', { path: '/' })
        .clearCookie(REFRESH_COOKIE, { path: '/' })
        .setCookie(cookieName, token, ACCESS_COOKIE_OPTS(secure))
        .setCookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTS(secure))
        .clearCookie('app_mode', { path: '/' })
        .redirect('/');
    } catch (err) {
      request.log.error(err, 'Kakao OAuth failed');
      reply.redirect('/login?error=oauth_failed');
    }
  });

  // --- 현재 사용자 정보 ---
  app.get('/api/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const { userId } = (request as any).user;
    const user = db.prepare('SELECT id, name, profileImage, role, createdAt FROM users WHERE id = ?').get(userId) as any;
    if (user && !request.headers['authorization'] && !request.cookies?.[REFRESH_COOKIE]) {
      const secure = BASE_URL.startsWith('https');
      const refreshToken = createRefreshSession(user.id, `web:${request.headers['user-agent'] || 'unknown'}`);
      reply.setCookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTS(secure));
      logAuth('WEB_REFRESH_BOOTSTRAP', request, { userId: user.id, name: user.name });
    }
    return user || null;
  });

  // --- 로그아웃 ---
  app.post('/api/auth/logout', async (request, reply) => {
    revokeRefreshToken(request.cookies?.[REFRESH_COOKIE]);
    reply
      .clearCookie('fauth', { path: '/' })
      .clearCookie('fpauth', { path: '/' })
      .clearCookie(REFRESH_COOKIE, { path: '/' })
      .clearCookie('auth', { path: '/' })
      .clearCookie('pauth', { path: '/' })
      .clearCookie('token', { path: '/' })
      .send({ ok: true });
  });

  // 웹/PWA 세션 자동 갱신. refresh token은 httpOnly 쿠키로만 전달한다.
  app.post('/api/auth/refresh', async (request, reply) => {
    const refreshToken = request.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) return reply.code(401).send({ error: 'No refresh token' });
    const accessToken = refreshAccessToken(refreshToken, request);
    if (!accessToken) {
      return reply
        .clearCookie('fauth', { path: '/' })
        .clearCookie('fpauth', { path: '/' })
        .clearCookie(REFRESH_COOKIE, { path: '/' })
        .code(401)
        .send({ error: 'Invalid refresh token' });
    }
    if (accessToken === 'rate-limited') return reply.code(429).send({ error: 'Too many token refreshes' });

    const cookieName = getTokenCookieName(request);
    const secure = BASE_URL.startsWith('https');
    reply
      .clearCookie('fauth', { path: '/' })
      .clearCookie('fpauth', { path: '/' })
      .setCookie(cookieName, accessToken, ACCESS_COOKIE_OPTS(secure))
      .send({ ok: true, expiresIn: ACCESS_TOKEN_TTL_SEC });
  });

  // ============================================================
  // 기기 세션 (영속 로그인 + 네이티브 백그라운드 백업용 refresh token)
  // ============================================================

  // 기기 등록: 쿠키 세션으로 인증된 사용자가 호출 → refresh token 평문 1회 반환.
  // (WebView 로그인 직후 네이티브가 받아 보안 저장소에 저장)
  app.post('/api/auth/device', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { userId, role } = (request as any).user;
    // 백업은 master 전용 → 기기 토큰 발급도 서버에서 master로 강제(클라 가드만으론 부족, WebView 브리지 노출 대비).
    if (role !== 'master') return reply.code(403).send({ error: 'master only' });
    const { deviceName } = (request.body as { deviceName?: string }) || {};
    const refreshToken = createRefreshSession(userId, deviceName || null);
    logAuth('DEVICE_REGISTERED', request, { userId, deviceName: deviceName?.slice(0, 80) });
    return reply.send({ refreshToken });
  });

  // access token 갱신: refresh token으로 새 access token 발급.
  // 백그라운드 워커/앱 시작 시 호출. refresh token은 폐기 전까지 유효(회전 없음).
  // 레이트리밋은 IP 플러그인 대신 핸들러에서 토큰별로 직접(위 refreshRate 주석 참고).
  app.post('/api/auth/token', async (request, reply) => {
    const { refreshToken } = (request.body as { refreshToken?: string }) || {};
    if (!refreshToken) return reply.code(400).send({ error: 'No refresh token' });
    const accessToken = refreshAccessToken(refreshToken, request);
    if (!accessToken) return reply.code(401).send({ error: 'Invalid refresh token' });
    if (accessToken === 'rate-limited') return reply.code(429).send({ error: 'Too many token refreshes' });
    return reply.send({ accessToken, expiresIn: ACCESS_TOKEN_TTL_SEC });
  });

  // 내 기기 세션 목록 (원격 로그아웃 UI용)
  app.get('/api/auth/sessions', { preHandler: authenticate }, async (request) => {
    const { userId } = (request as any).user;
    return db.prepare(
      'SELECT id, deviceName, createdAt, lastUsedAt, revokedAt FROM device_sessions WHERE userId = ? ORDER BY id DESC'
    ).all(userId);
  });

  // 기기 세션 폐기 (원격 로그아웃). 본인 세션만.
  app.post('/api/auth/sessions/:id/revoke', { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const sid = parseInt(id);
    if (!Number.isInteger(sid)) return reply.code(404).send({ error: 'Not found' });
    const session = db.prepare('SELECT userId FROM device_sessions WHERE id = ?').get(sid) as any;
    if (!session || session.userId !== userId) return reply.code(404).send({ error: 'Not found' });
    db.prepare("UPDATE device_sessions SET revokedAt = datetime('now', '+9 hours') WHERE id = ?").run(sid);
    logAuth('DEVICE_REVOKED', request, { userId, sessionId: sid });
    return { ok: true };
  });
}
