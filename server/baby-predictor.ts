/**
 * Baby Predictor - LLM 기반 수유/수면 예측
 * 3건 이상 기록 시 최근 100건 분석 → 다음 시간 예측 → 푸시 알림
 */

import db from './db.js';
import { sendPushToAll } from './push.js';

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

interface PredictionResult {
  predictedAt: string;
  reasoning: string;
}

function getActiveConfig(): LlmConfig | null {
  return db.prepare('SELECT * FROM llm_configs WHERE isActive = 1').get() as LlmConfig | null;
}

function chatUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

function formatKST(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

function nowKST(): string {
  // TZ=Asia/Seoul이므로 new Date()가 이미 KST
  return formatKST(new Date());
}

async function callLlmWithRetry(
  messages: { role: string; content: string }[],
  config: LlmConfig,
): Promise<PredictionResult | null> {
  const MAX_RETRIES = 2;
  const TIMEOUT_MS = 120_000; // 2분

  let extraHeaders: Record<string, string> = {};
  let extraBody: Record<string, any> = {};
  try { extraHeaders = JSON.parse(config.extraHeaders || '{}'); } catch {}
  try { extraBody = JSON.parse(config.extraBody || '{}'); } catch {}

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const body: Record<string, any> = {
        model: config.model,
        messages,
        temperature: 0.5,
        ...extraBody,
      };
      // max_tokens 제한 없음 — body에 추가하지 않음

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
        console.error(`[BabyPredictor] Attempt ${attempt + 1} HTTP error: ${res.status} ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.error(`[BabyPredictor] Attempt ${attempt + 1}: empty response`);
        continue;
      }

      // JSON 파싱 시도
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[BabyPredictor] Attempt ${attempt + 1}: no JSON in response: ${content.slice(0, 200)}`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]) as PredictionResult;
      if (!parsed.predictedAt || !parsed.reasoning) {
        console.error(`[BabyPredictor] Attempt ${attempt + 1}: invalid JSON structure: ${jsonMatch[0].slice(0, 200)}`);
        continue;
      }

      return parsed;
    } catch (err: any) {
      console.error(`[BabyPredictor] Attempt ${attempt + 1} error: ${err.message}`);
    }
  }

  console.error('[BabyPredictor] All retries failed');
  return null;
}

export async function triggerPrediction(type: 'feeding' | 'sleep' | 'diaper', babyId: number = 1, force: boolean = false): Promise<void> {
  try {
    const table = type === 'feeding' ? 'feedings' : type === 'sleep' ? 'sleeps' : 'diapers';
    const label = type === 'feeding' ? '수유' : type === 'sleep' ? '수면' : '기저귀';

    // 아이 이름 + 나이
    const baby = db.prepare('SELECT name, birthDate FROM babies WHERE id = ?').get(babyId) as { name: string; birthDate: string | null } | undefined;
    const babyName = baby?.name || '';
    let babyAgeText = '';
    if (baby?.birthDate) {
      const bd = new Date(baby.birthDate);
      const now = new Date();
      const totalDays = Math.floor((now.getTime() - bd.getTime()) / 86400000);
      const years = Math.floor(totalDays / 365);
      const months = Math.floor((totalDays % 365) / 30);
      const days = totalDays % 30;
      const parts: string[] = [];
      if (years > 0) parts.push(`${years}년`);
      if (months > 0) parts.push(`${months}개월`);
      parts.push(`${days}일`);
      babyAgeText = parts.join(' ');
    }

    // 기록 수 확인
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE babyId = ?`).get(babyId) as { cnt: number };
    if (countRow.cnt < 3) {
      console.log(`[BabyPredictor] ${babyName} ${label} 기록 ${countRow.cnt}건 — 3건 미만, skip`);
      return;
    }

    // 30분 내 동일 타입+아이 예측 있으면 skip (force일 때는 무시)
    if (!force) {
      const recent = db.prepare(
        `SELECT id FROM baby_predictions WHERE babyId = ? AND type = ? AND createdAt > datetime('now', '+9 hours', '-30 minutes') LIMIT 1`
      ).get(babyId, type) as any;
      if (recent) {
        console.log(`[BabyPredictor] ${babyName} ${label} 예측이 30분 이내에 있음, skip`);
        return;
      }
    }

    // LLM config 확인
    const config = getActiveConfig();
    if (!config) {
      console.log('[BabyPredictor] Active LLM config 없음, skip');
      return;
    }

    // 최근 100건 (또는 전부) 조회
    const orderCol = type === 'diaper' ? 'changedAt' : 'startedAt';
    const records = db.prepare(
      `SELECT * FROM ${table} WHERE babyId = ? ORDER BY ${orderCol} DESC LIMIT 100`
    ).all(babyId) as any[];

    // 기록을 문자열로 포맷
    let recordsText: string;
    if (type === 'feeding') {
      recordsText = records.reverse().map((r: any, i: number) => {
        const typeLabel = r.type === 'formula' ? '분유' : '모유';
        const detail = r.type === 'formula'
          ? `${r.amountMl}ml`
          : `${r.side === 'left' ? '왼쪽' : '오른쪽'}, ${Math.floor((r.durationSec || 0) / 60)}분 ${(r.durationSec || 0) % 60}초`;
        return `${i + 1}. ${r.startedAt} | ${typeLabel} | ${detail}`;
      }).join('\n');
    } else if (type === 'sleep') {
      recordsText = records.reverse().map((r: any, i: number) => {
        const dur = r.durationSec ? `${Math.floor(r.durationSec / 60)}분` : '진행중';
        return `${i + 1}. ${r.startedAt} ~ ${r.endedAt || '진행중'} | ${dur}`;
      }).join('\n');
    } else {
      recordsText = records.reverse().map((r: any, i: number) => {
        const typeLabel = r.type === 'pee' ? '소변' : r.type === 'poop' ? '대변' : '소변+대변';
        let detail = typeLabel;
        if ((r.type === 'poop' || r.type === 'both') && r.color) detail += `, 색상: ${r.color}`;
        if ((r.type === 'poop' || r.type === 'both') && r.consistency) detail += `, 상태: ${r.consistency}`;
        return `${i + 1}. ${r.changedAt} | ${detail}`;
      }).join('\n');
    }

    const systemPrompt = `당신은 아기 돌봄 패턴 분석 전문가입니다.
주어진 ${label} 기록을 분석하여 다음 ${label} 시간을 예측하세요.

규칙:
- 반드시 JSON으로만 응답하세요: {"predictedAt": "YYYY-MM-DD HH:mm", "reasoning": "간단한 이유"}
- predictedAt은 KST 기준입니다
- 최근 패턴의 간격(interval)을 분석하세요
- 시간대별 패턴도 고려하세요 (낮/밤 차이)
- ${type === 'diaper'
  ? '기저귀 교환 주기는 보통 2~4시간 간격입니다\n- 수유 후 기저귀 교환이 잦은 패턴도 참고하세요'
  : `아기의 월령에 맞는 ${label} 간격을 참고하세요 (신생아: 2~3시간, 3~6개월: 3~4시간, 6개월+: 4~5시간)`}
- reasoning은 한국어로, 1~2문장으로 간결하게
- JSON 외의 텍스트는 절대 포함하지 마세요`;

    const userPrompt = `현재 시각(KST): ${nowKST()}
아기 이름: ${babyName}${babyAgeText ? `\n태어난 지: ${babyAgeText} (생년월일: ${baby?.birthDate})` : ''}

최근 ${label} 기록 (${records.length}건):
${recordsText}

다음 ${label} 예상 시각을 예측해주세요.`;

    console.log(`[BabyPredictor] ${label} 예측 요청 (${records.length}건 기록)`);

    const result = await callLlmWithRetry(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      config,
    );

    if (!result) return;

    // DB 저장
    db.prepare(
      `INSERT INTO baby_predictions (babyId, type, predictedAt, reasoning) VALUES (?, ?, ?, ?)`
    ).run(babyId, type, result.predictedAt, result.reasoning);

    console.log(`[BabyPredictor] ${babyName} ${label} 예측 완료: ${result.predictedAt} — ${result.reasoning}`);

    // 푸시 알림 전송
    const icon = type === 'feeding' ? '🍼' : type === 'sleep' ? '💤' : '🧷';
    sendPushToAll(
      `${icon} 다음 ${label} 예측`,
      `약 ${result.predictedAt.split(' ')[1]}경 ${label}이 필요할 것 같아요. ${result.reasoning}`,
      '/parenting',
    );
  } catch (err: any) {
    console.error(`[BabyPredictor] Unexpected error: ${err.message}`);
  }
}
