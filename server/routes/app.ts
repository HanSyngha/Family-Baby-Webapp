import type { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve('data');

/**
 * 안드로이드 앱 자동 업데이트.
 * - GET /api/app/version : data/app-release.json 의 버전 정보 반환(없으면 versionCode 0 = 업데이트 없음)
 * - GET /api/app/download : data/app-release.apk 스트리밍
 * 배포 시 새 APK를 data/app-release.apk 로, 버전을 data/app-release.json 으로 올린다.
 */
export function registerAppRoutes(app: FastifyInstance) {
  app.get('/api/app/version', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async () => {
    const file = path.join(DATA_DIR, 'app-release.json');
    if (fs.existsSync(file)) {
      try {
        const j = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return {
          versionCode: j.versionCode ?? 0,
          versionName: j.versionName ?? '',
          notes: j.notes ?? '',
          url: j.url ?? '/api/app/download',
        };
      } catch { /* 형식 오류 시 아래 기본값 */ }
    }
    return { versionCode: 0, versionName: '', notes: '', url: '/api/app/download' };
  });

  // APK 다운로드 (공개 — APK엔 비밀 없음, 인증은 앱 내부에서 처리)
  app.get('/api/app/download', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (_request, reply) => {
    const apk = path.join(DATA_DIR, 'app-release.apk');
    if (!fs.existsSync(apk)) return reply.code(404).send({ error: 'No APK' });
    const stat = fs.statSync(apk);
    reply.headers({
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="peanut-family.apk"',
    });
    return reply.send(fs.createReadStream(apk));
  });
}
