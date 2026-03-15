/**
 * LLM Health Check - 5초 주기로 active config 체크
 */

import db from './db.js';
import { healthCheck } from './llm-client.js';

let intervalId: ReturnType<typeof setInterval> | null = null;

async function runHealthCheck() {
  const activeConfig = db.prepare('SELECT id FROM llm_configs WHERE isActive = 1').get() as { id: number } | undefined;
  if (!activeConfig) return;

  const result = await healthCheck(activeConfig.id);

  if (!result.ok) {
    console.error(`[LLM Health] Check failed: ${result.error} (${result.responseTimeMs}ms)`);
  }

  // DB에 결과 기록
  db.prepare(`
    INSERT INTO llm_health_logs (configId, status, responseTimeMs, error)
    VALUES (?, ?, ?, ?)
  `).run(
    activeConfig.id,
    result.ok ? 'ok' : 'error',
    result.responseTimeMs,
    result.error || null,
  );

  // config 업데이트
  db.prepare(`
    UPDATE llm_configs SET lastHealthCheck = datetime('now', '+9 hours'), lastHealthStatus = ? WHERE id = ?
  `).run(result.ok ? 'ok' : 'error', activeConfig.id);

  // 오래된 로그 정리 (최근 1000개만 유지)
  db.prepare(`
    DELETE FROM llm_health_logs WHERE id NOT IN (
      SELECT id FROM llm_health_logs ORDER BY id DESC LIMIT 1000
    )
  `).run();
}

export function startHealthCheck() {
  if (intervalId) return;
  intervalId = setInterval(runHealthCheck, 5000);
  console.log('[LLM Health] Started 5s interval check');
}

export function stopHealthCheck() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[LLM Health] Stopped');
  }
}
