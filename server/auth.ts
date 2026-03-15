import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const BASE_URL = process.env.BASE_URL || 'http://localhost:2230';

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
export function authenticate(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const cookieName = getTokenCookieName(request);
  const token = request.headers['x-app-mode']
    ? request.cookies?.[cookieName]
    : (request.cookies?.fpauth || request.cookies?.fauth);
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const user = db.prepare('SELECT id, name, banned FROM users WHERE id = ?').get(payload.userId) as any;
    if (user?.banned) {
      logAuth('BANNED', request, { userId: payload.userId });
      reply.clearCookie(cookieName, { path: '/' }).code(403).send({ error: 'Banned' });
      return;
    }
    if (request.url.startsWith('/api/auth/me')) {
      const iat = payload.iat ? new Date(payload.iat * 1000).toISOString() : '?';
      logAuth('ME', request, { userId: payload.userId, name: user?.name, cookie: cookieName, issuedAt: iat });
    }
    (request as any).user = payload;
    done();
  } catch {
    logAuth('INVALID_TOKEN', request, { cookie: cookieName });
    reply.clearCookie(cookieName, { path: '/' }).code(401).send({ error: 'Invalid token' });
    return;
  }
}

function generateToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '4h' });
}

function upsertUser(provider: string, providerId: string, name: string, profileImage: string | null) {
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
      const cookieName = getCallbackCookieName(request);
      const secure = BASE_URL.startsWith('https');

      logAuth('LOGIN', request, { provider: 'kakao', userId: user.id, name, cookie: cookieName });

      reply
        .setCookie(cookieName, token, COOKIE_OPTS(secure))
        .clearCookie('app_mode', { path: '/' })
        .redirect('/');
    } catch (err) {
      request.log.error(err, 'Kakao OAuth failed');
      reply.redirect('/login?error=oauth_failed');
    }
  });

  // --- 현재 사용자 정보 ---
  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => {
    const { userId } = (request as any).user;
    const user = db.prepare('SELECT id, name, profileImage, role, createdAt FROM users WHERE id = ?').get(userId);
    return user || null;
  });

  // --- 로그아웃 ---
  app.post('/api/auth/logout', async (request, reply) => {
    reply
      .clearCookie('fauth', { path: '/' })
      .clearCookie('fpauth', { path: '/' })
      .clearCookie('auth', { path: '/' })
      .clearCookie('pauth', { path: '/' })
      .clearCookie('token', { path: '/' })
      .send({ ok: true });
  });
}
