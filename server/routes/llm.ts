import type { FastifyInstance } from 'fastify';
import db from '../db.js';
import { authenticate } from '../auth.js';
import { healthCheck, fetchModels } from '../llm-client.js';
import { startHealthCheck, stopHealthCheck } from '../llm-health.js';

interface LlmConfigRow {
  id: number;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  extraHeaders: string;
  extraBody: string;
  isActive: number;
  lastHealthCheck: string | null;
  lastHealthStatus: string;
  createdAt: string;
}

export function registerLlmRoutes(app: FastifyInstance) {
  // LLM 설정 목록
  app.get('/api/llm/configs', { preHandler: authenticate }, async () => {
    const configs = db.prepare('SELECT * FROM llm_configs ORDER BY createdAt DESC').all() as LlmConfigRow[];
    return configs.map(c => ({
      ...c,
      isActive: !!c.isActive,
      apiKey: c.apiKey.slice(0, 8) + '...' + c.apiKey.slice(-4), // 마스킹
    }));
  });

  // LLM 설정 생성
  app.post('/api/llm/configs', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user;
    if (user.role !== 'master') return reply.code(403).send({ error: 'Master only' });

    const body = request.body as any;
    const { name, endpoint, apiKey, model, maxTokens, temperature, extraHeaders, extraBody } = body;

    if (!name || !endpoint || !apiKey) {
      return reply.code(400).send({ error: 'name, endpoint, apiKey required' });
    }

    const result = db.prepare(`
      INSERT INTO llm_configs (name, endpoint, apiKey, model, maxTokens, temperature, extraHeaders, extraBody)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, endpoint, apiKey,
      model || '',
      maxTokens || 1024,
      temperature ?? 0.7,
      extraHeaders || '{}',
      extraBody || '{}',
    );

    console.log(`[LLM] Config created: "${name}" id=${result.lastInsertRowid}`);

    const config = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(result.lastInsertRowid) as LlmConfigRow;
    return { ...config, isActive: !!config.isActive };
  });

  // LLM 설정 수정
  app.put('/api/llm/configs/:id', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user;
    if (user.role !== 'master') return reply.code(403).send({ error: 'Master only' });

    const { id } = request.params as { id: string };
    const configId = Number(id);
    const body = request.body as any;

    const existing = db.prepare('SELECT id FROM llm_configs WHERE id = ?').get(configId);
    if (!existing) return reply.code(404).send({ error: 'Config not found' });

    const fields: string[] = [];
    const values: any[] = [];

    for (const key of ['name', 'endpoint', 'model', 'extraHeaders', 'extraBody'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
    }
    // apiKey: 빈 문자열이면 업데이트 안 함 (마스킹된 값 보호)
    if (body.apiKey && body.apiKey.trim()) { fields.push('apiKey = ?'); values.push(body.apiKey); }
    if (body.maxTokens !== undefined) { fields.push('maxTokens = ?'); values.push(body.maxTokens); }
    if (body.temperature !== undefined) { fields.push('temperature = ?'); values.push(body.temperature); }

    if (fields.length > 0) {
      db.prepare(`UPDATE llm_configs SET ${fields.join(', ')} WHERE id = ?`).run(...values, configId);
    }

    console.log(`[LLM] Config updated: id=${configId}`);

    const config = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(configId) as LlmConfigRow;
    return { ...config, isActive: !!config.isActive };
  });

  // LLM 설정 삭제
  app.delete('/api/llm/configs/:id', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user;
    if (user.role !== 'master') return reply.code(403).send({ error: 'Master only' });

    const { id } = request.params as { id: string };
    const configId = Number(id);

    const config = db.prepare('SELECT isActive FROM llm_configs WHERE id = ?').get(configId) as { isActive: number } | undefined;
    if (!config) return reply.code(404).send({ error: 'Config not found' });

    db.prepare('DELETE FROM llm_configs WHERE id = ?').run(configId);

    if (config.isActive) {
      stopHealthCheck();
    }

    console.log(`[LLM] Config deleted: id=${id}`);
    return { ok: true };
  });

  // LLM 활성화
  app.post('/api/llm/configs/:id/activate', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user;
    if (user.role !== 'master') return reply.code(403).send({ error: 'Master only' });

    const { id } = request.params as { id: string };
    const configId = Number(id);

    const existing = db.prepare('SELECT id FROM llm_configs WHERE id = ?').get(configId);
    if (!existing) return reply.code(404).send({ error: 'Config not found' });

    // 기존 active 해제
    db.prepare('UPDATE llm_configs SET isActive = 0').run();
    // 새로 활성화
    db.prepare('UPDATE llm_configs SET isActive = 1 WHERE id = ?').run(configId);

    startHealthCheck();

    console.log(`[LLM] Config activated: id=${configId}`);
    return { ok: true };
  });

  // LLM 비활성화
  app.post('/api/llm/configs/:id/deactivate', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user;
    if (user.role !== 'master') return reply.code(403).send({ error: 'Master only' });

    const { id } = request.params as { id: string };
    db.prepare('UPDATE llm_configs SET isActive = 0 WHERE id = ?').run(Number(id));
    stopHealthCheck();

    console.log(`[LLM] Config deactivated: id=${id}`);
    return { ok: true };
  });

  // LLM 테스트
  app.post('/api/llm/configs/:id/test', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user;
    if (user.role !== 'master') return reply.code(403).send({ error: 'Master only' });

    const { id } = request.params as { id: string };
    const result = await healthCheck(Number(id));

    return {
      ok: result.ok,
      responseTimeMs: result.responseTimeMs,
      error: result.error,
    };
  });

  // LLM 모델 목록 조회
  app.post('/api/llm/models', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user;
    if (user.role !== 'master') return reply.code(403).send({ error: 'Master only' });

    const { endpoint, apiKey, extraHeaders } = request.body as any;
    if (!endpoint || !apiKey) return reply.code(400).send({ error: 'endpoint and apiKey required' });

    const models = await fetchModels(endpoint, apiKey, extraHeaders);
    return { models };
  });

  // LLM Health 로그
  app.get('/api/llm/health', { preHandler: authenticate }, async () => {
    const activeConfig = db.prepare('SELECT id FROM llm_configs WHERE isActive = 1').get() as { id: number } | undefined;
    if (!activeConfig) return { configId: null, logs: [] };

    const logs = db.prepare(`
      SELECT status, responseTimeMs, error, checkedAt
      FROM llm_health_logs
      WHERE configId = ?
      ORDER BY id DESC
      LIMIT 50
    `).all(activeConfig.id);

    return { configId: activeConfig.id, logs };
  });

  // 서버 시작시 active config가 있으면 health check 시작
  const hasActive = db.prepare('SELECT id FROM llm_configs WHERE isActive = 1').get();
  if (hasActive) {
    startHealthCheck();
  }
}
