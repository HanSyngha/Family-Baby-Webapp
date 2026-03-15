import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import path from 'path';
import fs from 'fs';
import { registerAuthRoutes } from './auth.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerInteractionRoutes } from './routes/interaction.js';
import { registerUserRoutes } from './routes/user.js';
import { registerPushRoutes } from './push.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerTodoRoutes } from './routes/todo.js';
import { registerNoteRoutes } from './routes/note.js';
import { registerLlmRoutes } from './routes/llm.js';
import { registerBabyRoutes } from './routes/baby.js';
import { registerHomeRoutes } from './routes/home.js';
import { startHealthCheck } from './llm-health.js';
import { startAutoSleepCheck } from './auto-sleep.js';

const app = Fastify({ logger: true });

// 플러그인 등록
await app.register(fastifyCors, { origin: true, credentials: true });
await app.register(fastifyCookie);
await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 * 1024 } }); // 10GB

// 캐시 제어
app.addHook('onSend', (request, reply, _payload, done) => {
  if (request.url.startsWith('/api/')) {
    reply.header('Cache-Control', 'no-store');
    reply.header('Vary', 'Cookie');
  }
  if (request.url === '/sw.js') {
    reply.header('Cache-Control', 'no-cache, no-store');
  }
  done();
});

// API 라우트 등록
registerAuthRoutes(app);
registerMediaRoutes(app);
registerInteractionRoutes(app);
registerUserRoutes(app);
registerPushRoutes(app);
registerCalendarRoutes(app);
registerTodoRoutes(app);
registerNoteRoutes(app);
registerLlmRoutes(app);
registerBabyRoutes(app);
registerHomeRoutes(app);

// SPA 정적 파일 서빙 (production)
const publicDir = path.resolve('dist/public');
if (fs.existsSync(publicDir)) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  // SPA fallback: API가 아닌 모든 요청을 index.html로
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });
}

// 인증된 요청마다 lastActiveAt 갱신 (자동 수면 감지용)
import db from './db.js';
const updateLastActive = db.prepare("UPDATE users SET lastActiveAt = datetime('now', '+9 hours') WHERE id = ?");
app.addHook('onResponse', (request, _reply, done) => {
  const userId = (request as any).user?.userId;
  if (userId) updateLastActive.run(userId);
  done();
});

// 임시 파일 정리 (30분마다) - DB에 없는 고아 파일 삭제

function cleanupOrphanFiles() {
  const originalsDir = path.resolve('data/originals');
  const thumbsDir = path.resolve('data/thumbnails');
  const hlsDir = path.resolve('data/hls');
  if (!fs.existsSync(originalsDir)) return;

  const dbFiles = new Set(
    (db.prepare('SELECT filename FROM media').all() as { filename: string }[]).map(r => r.filename)
  );

  const now = Date.now();
  const THIRTY_MIN = 30 * 60 * 1000;

  for (const file of fs.readdirSync(originalsDir)) {
    if (dbFiles.has(file)) continue;

    const filePath = path.join(originalsDir, file);
    const stat = fs.statSync(filePath);

    if (now - stat.mtimeMs > THIRTY_MIN) {
      fs.unlinkSync(filePath);
      const thumbPath = path.join(thumbsDir, file + '.webp');
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      const hlsPath = path.join(hlsDir, file);
      if (fs.existsSync(hlsPath)) fs.rmSync(hlsPath, { recursive: true });
      console.log('Cleaned orphan file:', file);
    }
  }

  if (fs.existsSync(hlsDir)) {
    for (const dir of fs.readdirSync(hlsDir)) {
      if (!dbFiles.has(dir) && !fs.existsSync(path.join(originalsDir, dir))) {
        fs.rmSync(path.join(hlsDir, dir), { recursive: true });
        console.log('Cleaned orphan HLS dir:', dir);
      }
    }
  }
}

setInterval(cleanupOrphanFiles, 30 * 60 * 1000);

// LLM Health Check 시작 (active config 있으면 5초 주기)
startHealthCheck();

// 자동 수면 체커 시작 (60초 주기)
startAutoSleepCheck();

const port = parseInt(process.env.PORT || '2290');
await app.listen({ port, host: '0.0.0.0' });
console.log(`Server running on port ${port}`);
