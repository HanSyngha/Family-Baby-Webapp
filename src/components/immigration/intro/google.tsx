import { useEffect, useState } from 'react';
import type { SceneSpec } from './types';
import s from './google.module.css';

/**
 * 구글 테마 — 로고·워드마크는 쓰지 않고 4색과 문화(검색창, 신입 'Noogler' 프로펠러 모자)로만.
 * 11/30 첫 출근.
 */

const WORD = 'Singapore';
const TYPE_FROM = 260;
const TYPE_STEP = 72;

function GoogleSearchScene() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const timers = Array.from(WORD, (_, i) => window.setTimeout(() => setN(i + 1), TYPE_FROM + i * TYPE_STEP));
    return () => timers.forEach(t => window.clearTimeout(t));
  }, []);
  return (
    <div className={s.searchStage}>
      <div className={s.searchBox}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9AA0A6" strokeWidth="2.2" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></svg>
        <span className={s.typed}>{WORD.slice(0, n)}</span>
        <span className={s.caret} />
      </div>
      <div className={s.dots} aria-hidden="true">
        <span style={{ background: '#4285F4' }} />
        <span style={{ background: '#EA4335' }} />
        <span style={{ background: '#FBBC05' }} />
        <span style={{ background: '#34A853' }} />
      </div>
      <div className={s.firstDay}>11.30 · 첫 출근</div>
    </div>
  );
}

function NooglerScene() {
  return (
    <div className={s.hatStage}>
      <svg className={s.hat} viewBox="0 0 200 150" aria-hidden="true">
        <rect x="96" y="22" width="8" height="30" rx="3" fill="#5F6368" />
        <g className={s.propeller}>
          <ellipse cx="66" cy="22" rx="34" ry="6.5" fill="#EA4335" />
          <ellipse cx="134" cy="22" rx="34" ry="6.5" fill="#34A853" />
          <circle cx="100" cy="22" r="6" fill="#FBBC05" />
        </g>
        <path d="M100 120L30 120A70 70 0 0 1 50.5 70.5Z" fill="#4285F4" />
        <path d="M100 120L50.5 70.5A70 70 0 0 1 100 50Z" fill="#EA4335" />
        <path d="M100 120L100 50A70 70 0 0 1 149.5 70.5Z" fill="#FBBC05" />
        <path d="M100 120L149.5 70.5A70 70 0 0 1 170 120Z" fill="#34A853" />
        <path d="M30 120A70 70 0 0 1 170 120" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
        <path d="M14 120H186Q190 134 172 136H28Q10 134 14 120Z" fill="#3367D6" />
      </svg>
      <div className={s.shadow} />
      <div className={s.noogler}>
        <span className={s.nooglerWord}>Noogler</span>
        <span className={s.nooglerSub}>11.30 · 첫 출근</span>
      </div>
    </div>
  );
}

export const GOOGLE_SCENES: Record<string, SceneSpec> = {
  'google-search': {
    name: '구글 검색',
    ms: 2150,
    haptic: [[1000, 16]],
    caption: 'late',
    bg: 'radial-gradient(70% 45% at 50% 40%, rgba(66,133,244,0.14), transparent 70%), #0E1117',
    Scene: GoogleSearchScene,
  },
  noogler: {
    name: 'Noogler 모자',
    ms: 2100,
    haptic: [[560, 26]],
    caption: 'late',
    bg: 'radial-gradient(70% 45% at 50% 40%, rgba(251,188,5,0.10), transparent 70%), #0E1117',
    Scene: NooglerScene,
  },
};
