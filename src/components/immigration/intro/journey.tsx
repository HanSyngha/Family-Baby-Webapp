import { useEffect, useState } from 'react';
import type { SceneSpec } from './types';
import s from './journey.module.css';

/**
 * 여정 장면 — 짐을 싸고, 날짜를 넘기고, 탑승구를 지나 창밖으로 해가 뜨기까지.
 */

// ---------- 비행기 창가 일출 ----------
function WindowScene() {
  return (
    <div className={s.windowWrap}>
      <div className={s.window}>
        <div className={s.sky} />
        <div className={s.sun} />
        <div className={`${s.wcloud} ${s.wc1}`} />
        <div className={`${s.wcloud} ${s.wc2}`} />
        <div className={`${s.wcloud} ${s.wc3}`} />
        <div className={s.shade} />
        <div className={s.glass} />
      </div>
    </div>
  );
}

// ---------- 여권 표지 열기 ----------
function PassportScene() {
  return (
    <div className={s.passport}>
      <div className={s.inside}>
        <span className={s.insideLabel}>목적지 · DESTINATION</span>
        <span className={s.insideCity}>SINGAPORE</span>
        <span className={s.insideDate}>2026. 11. 28</span>
        <span className={s.insideFamily}>한승하 · 황하람 · 한설</span>
      </div>
      <div className={s.cover}>
        <span className={s.coverTop}>대한민국</span>
        <span className={s.coverTopEn}>REPUBLIC OF KOREA</span>
        <svg className={s.emblem} viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="30" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="40" cy="40" r="22" fill="none" stroke="currentColor" strokeWidth="1" />
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d="M40 14L42.5 22H37.5Z" fill="currentColor" transform={`rotate(${i * 30} 40 40)`} />
          ))}
          <path d="M40 30L46 40L40 50L34 40Z" fill="currentColor" />
        </svg>
        <span className={s.coverBottom}>여권</span>
        <span className={s.coverBottomEn}>PASSPORT</span>
      </div>
    </div>
  );
}

// ---------- 탑승구 표지판 ----------
function GateScene() {
  return (
    <div className={s.gateStage}>
      <div className={s.sign}>
        <div className={s.signRow}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></svg>
          <span className={s.signKo}>탑승</span>
          <span className={s.signEn}>Boarding</span>
          <span className={s.signArrow}>→</span>
        </div>
        <div className={s.signRow2}>
          <span>SINGAPORE</span>
          <span className={s.nowBoarding}>NOW BOARDING</span>
        </div>
      </div>
      <div className={s.floorLane}>
        {[0, 1, 2, 3, 4, 5].map(i => <span key={i} style={{ ['--i' as string]: i }} />)}
      </div>
    </div>
  );
}

// ---------- 수하물 태그 ----------
function LuggageScene() {
  return (
    <div className={s.luggageStage}>
      <div className={s.tagSwing}>
        <div className={s.string} />
        <div className={s.bagTag}>
          <div className={s.tagHead}>
            <span>ICN</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)" /></svg>
            <span>PVG</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)" /></svg>
          </div>
          <div className={s.tagCode}>SIN</div>
          <div className={s.tagName}>HAN · FAMILY OF 3</div>
          <div className={s.barcode}>
            {Array.from({ length: 34 }, (_, i) => <i key={i} style={{ width: `${(i * 7) % 3 + 1}px` }} />)}
          </div>
        </div>
      </div>
      <div className={s.belt}>
        {Array.from({ length: 14 }, (_, i) => <span key={i} />)}
      </div>
    </div>
  );
}

// ---------- 이삿짐 상자 ----------
function MovingBoxScene() {
  return (
    <div className={s.boxStage}>
      <svg className={s.box} viewBox="0 0 220 200" aria-hidden="true">
        {/* 닫힌 윗면 · 왼쪽 앞면 · 오른쪽 앞면 */}
        <path d="M20 74L110 48L200 74L110 100Z" fill="#C9A06C" />
        <path d="M20 74L110 100V190L20 164Z" fill="#B98A57" />
        <path d="M110 100L200 74V164L110 190Z" fill="#A67A49" />
        {/* 열린 날개 두 짝 → 접혀 닫힘 */}
        <path className={s.flapL} d="M20 74L110 48L92 6L2 32Z" fill="#D2A873" stroke="#B98A57" strokeWidth="1.5" />
        <path className={s.flapR} d="M200 74L110 100L128 58L218 32Z" fill="#C59A64" stroke="#A67A49" strokeWidth="1.5" />
        {/* 가운데 이음매를 따라 테이프 */}
        <path className={s.tape} d="M65 61L155 87L155 120" fill="none" stroke="#EADCB9" strokeWidth="12" strokeLinejoin="round" />
        <g className={s.boxStamp}>
          <g transform="matrix(1 0.29 0 1 30 118)">
            <rect x="0" y="0" width="68" height="32" rx="3" fill="none" stroke="#B3262B" strokeWidth="2.4" />
            <text x="34" y="15" textAnchor="middle" fontSize="10.5" fontWeight="900" fill="#B3262B">SINGAPORE</text>
            <text x="34" y="27" textAnchor="middle" fontSize="8" fontWeight="800" fill="#B3262B">취급주의</text>
          </g>
        </g>
        <path d="M140 136L176 126M140 148L182 136" stroke="#8E6538" strokeWidth="2" opacity="0.55" />
      </svg>
    </div>
  );
}

// ---------- 달력 ----------
const DAY_MS = 86400000;
function CalendarScene() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dep = new Date(2026, 10, 28);
  const total = Math.max(0, Math.round((dep.getTime() - today.getTime()) / DAY_MS));
  const [k, setK] = useState(0);
  useEffect(() => {
    // 0.25s부터 0.9s 동안 오늘 → 11/28로 넘긴다 (뒤로 갈수록 느려짐)
    const steps = Math.min(total, 24);
    const timers = Array.from({ length: steps + 1 }, (_, i) => {
      const p = i / Math.max(1, steps);
      return window.setTimeout(() => setK(Math.round(p * total)), 250 + 900 * (1 - Math.pow(1 - p, 2.2)));
    });
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [total]);
  const d = new Date(today.getTime() + k * DAY_MS);
  const done = k >= total;
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  return (
    <div className={s.calStage}>
      <div className={s.cal}>
        <div className={s.calHead}>{d.getFullYear()}. {d.getMonth() + 1}월</div>
        <div key={k} className={`${s.calDay} ${done ? s.calDayFinal : ''}`}>
          {d.getDate()}
          {done && (
            <svg className={s.circle} viewBox="0 0 120 100" aria-hidden="true">
              <path d="M60 8C92 6 114 26 112 50C110 76 86 94 58 92C30 90 8 72 10 48C12 26 34 10 66 12" fill="none" stroke="#D9473A" strokeWidth="5" strokeLinecap="round" />
            </svg>
          )}
        </div>
        <div className={s.calWd}>{WD[d.getDay()]}요일</div>
        <div className={`${s.calNote} ${done ? s.calNoteOn : ''}`}>출국</div>
      </div>
    </div>
  );
}

export const JOURNEY_SCENES: Record<string, SceneSpec> = {
  window: {
    name: '창가 일출',
    ms: 2300,
    haptic: [],
    caption: 'late',
    bg: 'radial-gradient(70% 50% at 50% 42%, rgba(255,170,90,0.12), transparent 70%), #080C14',
    Scene: WindowScene,
  },
  passport: {
    name: '여권 표지',
    ms: 2100,
    haptic: [[650, 14]],
    caption: 'late',
    bg: 'radial-gradient(70% 50% at 50% 42%, rgba(46,82,140,0.35), transparent 70%), #060B15',
    Scene: PassportScene,
  },
  gate: {
    name: '탑승구',
    ms: 2000,
    haptic: [[420, [10, 60, 10]]],
    caption: 'late',
    bg: 'linear-gradient(180deg, #0D0F12 0%, #15181D 60%, #0B0C0F 100%)',
    Scene: GateScene,
  },
  luggage: {
    name: '수하물 태그',
    ms: 2100,
    haptic: [[700, 12]],
    caption: 'late',
    bg: 'radial-gradient(70% 50% at 50% 40%, rgba(227,194,126,0.10), transparent 70%), #0B0F17',
    Scene: LuggageScene,
  },
  box: {
    name: '이삿짐 상자',
    ms: 2100,
    haptic: [[560, 10], [1020, 34]],
    caption: 'late',
    bg: 'radial-gradient(70% 50% at 50% 45%, rgba(185,138,87,0.18), transparent 70%), #0C0A08',
    Scene: MovingBoxScene,
  },
  calendar: {
    name: '달력',
    ms: 2200,
    haptic: [[1180, 24]],
    caption: 'late',
    bg: 'radial-gradient(70% 50% at 50% 42%, rgba(217,71,58,0.10), transparent 70%), #0B0D12',
    Scene: CalendarScene,
  },
};
