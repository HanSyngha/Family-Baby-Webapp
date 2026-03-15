/**
 * LLM Client - OpenAI-compatible chat completion
 * Retry 2회, timeout 120s, 실패시 null 반환
 */

import db from './db.js';

/** 현재 KST 날짜+시간 문자열 (프롬프트 주입용) */
export function nowKSTString(): string {
  // TZ=Asia/Seoul이므로 new Date()가 이미 KST
  const now = new Date();
  const y = now.getFullYear();
  const M = now.getMonth() + 1;
  const d = now.getDate();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${y}년 ${M}월 ${d}일 ${h}:${m} (KST)`;
}

interface LlmConfig {
  id: number;
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  extraHeaders: string;
  extraBody: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

function getActiveConfig(): LlmConfig | null {
  return db.prepare('SELECT * FROM llm_configs WHERE isActive = 1').get() as LlmConfig | null;
}

/** endpoint에 /chat/completions 자동 추가 */
function chatUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

/** endpoint에서 /models URL 추출 */
function modelsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  // /v1/chat/completions -> /v1/models, /v4 -> /v4/models
  const stripped = base.replace(/\/chat\/completions$/, '');
  return `${stripped}/models`;
}

/** 모델 목록 조회 */
export async function fetchModels(endpoint: string, apiKey: string, extraHeaders?: string): Promise<string[]> {
  let headers: Record<string, string> = {};
  try { headers = JSON.parse(extraHeaders || '{}'); } catch {}

  const url = modelsUrl(endpoint);
  console.log(`[LLM] Fetching models from: ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, ...headers },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[LLM] Models fetch failed: HTTP ${res.status} ${errText.slice(0, 200)}`);
      return [];
    }
    const data = await res.json() as any;
    console.log(`[LLM] Models response keys: ${Object.keys(data || {}).join(', ')}`);
    // OpenAI-compatible: { data: [{ id: "model-name" }] }
    if (Array.isArray(data?.data)) {
      const models = data.data.map((m: any) => m.id).filter(Boolean);
      console.log(`[LLM] Found ${models.length} models: ${models.slice(0, 10).join(', ')}`);
      return models;
    }
    // 일부 API는 data가 아닌 다른 형태일 수 있음
    if (Array.isArray(data)) {
      const models = data.map((m: any) => m.id || m.name || m).filter(Boolean);
      console.log(`[LLM] Found ${models.length} models (array): ${models.slice(0, 10).join(', ')}`);
      return models;
    }
    console.warn(`[LLM] Unexpected models response format:`, JSON.stringify(data).slice(0, 300));
    return [];
  } catch (err: any) {
    clearTimeout(timer);
    console.error(`[LLM] Models fetch error: ${err.message}`);
    return [];
  }
}

export async function chatCompletion(
  messages: ChatMessage[],
  timeoutMs: number = 120000,
): Promise<string | null> {
  const config = getActiveConfig();
  if (!config) return null;

  const MAX_RETRIES = 2;
  const TIMEOUT_MS = timeoutMs;

  let extraHeaders: Record<string, string> = {};
  let extraBody: Record<string, any> = {};
  try { extraHeaders = JSON.parse(config.extraHeaders || '{}'); } catch {}
  try { extraBody = JSON.parse(config.extraBody || '{}'); } catch {}

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const body = {
        model: config.model,
        messages,
        temperature: 0.5,
        ...extraBody,
      };

      const res = await fetch(chatUrl(config.endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[LLM] Attempt ${attempt + 1} failed: ${res.status} ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json() as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.error(`[LLM] Attempt ${attempt + 1}: empty response`);
        continue;
      }

      return content;
    } catch (err: any) {
      console.error(`[LLM] Attempt ${attempt + 1} error:`, err.message);
    }
  }

  console.error('[LLM] All retries failed');
  return null;
}

/**
 * 할일 완료 노트 교정
 */
export async function polishCompletionNote(
  todoTitle: string,
  rawNote: string,
  userName: string,
): Promise<string> {
  const result = await chatCompletion([
    {
      role: 'system',
      content: `당신은 가족 앱의 할일 완료 메모를 깔끔하게 교정하는 도우미입니다.
- 오타를 고치고, 문장을 자연스럽게 다듬어주세요.
- 원래 의미를 변경하지 마세요.
- 짧고 간결하게 유지하세요.
- 마크다운 형식은 사용하지 마세요.
현재 시각: ${nowKSTString()}, 작성자: ${userName}`,
    },
    {
      role: 'user',
      content: `할일: "${todoTitle}"\n완료 메모:\n${rawNote}`,
    },
  ]);

  // LLM 실패시 원본 반환
  return result || rawNote;
}

/**
 * 범용 텍스트 교정 (노트, 할일 등)
 */
export async function polishText(
  rawText: string,
  context: string = '',
): Promise<string> {
  if (!rawText || rawText.trim().length < 5) return rawText;

  const result = await chatCompletion([
    {
      role: 'system',
      content: `당신은 가족 앱의 텍스트를 깔끔하게 교정하는 도우미입니다.
- 오타를 고치고, 문장을 자연스럽게 다듬어주세요.
- 원래 의미를 절대 변경하지 마세요.
- 마크다운 형식은 사용하지 마세요.
- 줄바꿈과 단락 구조는 유지하세요.
- 교정할 게 없으면 원본 그대로 반환하세요.
현재 시각: ${nowKSTString()}${context ? `\n참고: ${context}` : ''}`,
    },
    {
      role: 'user',
      content: rawText,
    },
  ]);

  return result || rawText;
}

/**
 * Health check - chat completion 테스트
 */
export async function healthCheck(configId?: number): Promise<{
  ok: boolean;
  responseTimeMs: number;
  error?: string;
}> {
  const config = configId
    ? db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(configId) as LlmConfig | null
    : getActiveConfig();

  if (!config) {
    return { ok: false, responseTimeMs: 0, error: 'No config found' };
  }

  const start = Date.now();

  let extraHeaders: Record<string, string> = {};
  let extraBody: Record<string, any> = {};
  try { extraHeaders = JSON.parse(config.extraHeaders || '{}'); } catch {}
  try { extraBody = JSON.parse(config.extraBody || '{}'); } catch {}

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(chatUrl(config.endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
        ...extraBody,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const elapsed = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, responseTimeMs: elapsed, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }

    return { ok: true, responseTimeMs: elapsed };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}
