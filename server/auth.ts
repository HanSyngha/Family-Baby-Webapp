import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const BASE_URL = process.env.BASE_URL || 'http://localhost:2230';

interface JwtPayload {
  userId: number;
  role: string;
}

// JWT 검증 데코레이터
export function authenticate(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const token = request.cookies?.token;
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    // 차단된 유저 체크
    const user = db.prepare('SELECT banned FROM users WHERE id = ?').get(payload.userId) as any;
    if (user?.banned) {
      reply.clearCookie('token', { path: '/' }).code(403).send({ error: 'Banned' });
      return;
    }
    (request as any).user = payload;
    done();
  } catch {
    reply.code(401).send({ error: 'Invalid token' });
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

      // 토큰 교환
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

      // 사용자 정보
      const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json() as any;
      if (!userData.id) return reply.redirect('/login?error=user_info_failed');

      const name = userData.kakao_account?.profile?.nickname || '사용자';
      const profileImage = userData.kakao_account?.profile?.profile_image_url || null;

      const user = upsertUser('kakao', String(userData.id), name, profileImage);
      const token = generateToken(user.id, user.role);

      reply
        .setCookie('token', token, {
          path: '/',
          httpOnly: true,
          secure: BASE_URL.startsWith('https'),
          sameSite: 'lax',
          maxAge: 4 * 60 * 60,
        })
        .redirect('/');
    } catch (err) {
      request.log.error(err, 'Kakao OAuth failed');
      reply.redirect('/login?error=oauth_failed');
    }
  });

  // --- 네이버 ---
  app.get('/api/auth/naver', async (_request, reply) => {
    const clientId = process.env.NAVER_CLIENT_ID;
    const redirectUri = `${BASE_URL}/api/auth/naver/callback`;
    const state = Math.random().toString(36).substring(2);
    const url = `https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    reply.redirect(url);
  });

  app.get('/api/auth/naver/callback', async (request, reply) => {
    try {
      const { code, state } = request.query as { code: string; state: string };
      if (!code) return reply.redirect('/login?error=no_code');

      const clientId = process.env.NAVER_CLIENT_ID!;
      const clientSecret = process.env.NAVER_CLIENT_SECRET!;
      const redirectUri = `${BASE_URL}/api/auth/naver/callback`;

      // 토큰 교환
      const tokenRes = await fetch(`https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}&state=${state}`);
      const tokenData = await tokenRes.json() as any;
      if (!tokenData.access_token) return reply.redirect('/login?error=token_failed');

      // 사용자 정보
      const userRes = await fetch('https://openapi.naver.com/v1/nid/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json() as any;
      if (!userData.response?.id) return reply.redirect('/login?error=user_info_failed');

      const profile = userData.response;
      const name = profile.name || profile.nickname || '사용자';
      const profileImage = profile.profile_image || null;

      const user = upsertUser('naver', profile.id, name, profileImage);
      const token = generateToken(user.id, user.role);

      reply
        .setCookie('token', token, {
          path: '/',
          httpOnly: true,
          secure: BASE_URL.startsWith('https'),
          sameSite: 'lax',
          maxAge: 4 * 60 * 60,
        })
        .redirect('/');
    } catch (err) {
      request.log.error(err, 'Naver OAuth failed');
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
  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' }).send({ ok: true });
  });
}
