import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VERSES, loadVerseFont, rememberVerse } from './verses';
import styles from './Departure.module.css';

import type { SceneSpec } from './intro/types';
import { PEANUT_SCENES } from './intro/peanut';
import { GOOGLE_SCENES } from './intro/google';
import { JOURNEY_SCENES } from './intro/journey';
import { SKY_SCENES } from './intro/sky';
import { CHEER_SCENES } from './intro/cheer';

/**
 * 이민 탭의 분위기: 돌아오지 않는 편도 출국.
 *   진입 연출 21가지 중 하나(직전과 다른 것) → 말씀 한 구절(또는 설이 응원) → 탭이 열린다.
 *     여기   stamp 출국 도장 · board 출발 안내판 · runway 밤 활주로 · route 항로
 *     intro/ 땅콩 가족 3 · 구글 2 · 여정 6 · 하늘·위로 6 · 설이 응원 1
 *   탭 머리 — 편도 탑승권(누르면 다음 연출 다시 보기) + 그날의 말씀 카드.
 */

// 출국: 2026-11-28 (토) 인천 12:55 → 상하이 경유 → 창이 22:00, 가족 3인.
const DEPARTURE = new Date(2026, 10, 28);

export function daysToDeparture(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((DEPARTURE.getTime() - today.getTime()) / 86400000);
}

const NAVY = 'radial-gradient(90% 60% at 50% 42%, rgba(40, 70, 120, 0.35), transparent 70%), #070D18';

const CLASSIC_SCENES: Record<string, SceneSpec> = {
  stamp: { name: '출국 도장', ms: 1750, haptic: [[500, 38]], caption: 'mid', bg: NAVY, Scene: StampScene },
  board: { name: '출발 안내판', ms: 1900, haptic: [[200, [6, 45, 6, 45, 6, 45, 6, 45, 6]]], caption: 'late', bg: 'radial-gradient(70% 45% at 50% 30%, rgba(255, 196, 110, 0.10), transparent 70%), #08090B', Scene: BoardScene },
  runway: { name: '밤 활주로', ms: 1900, haptic: [[150, [14, 40, 14, 40, 16, 40, 18, 40, 20]], [1050, 30]], caption: 'top', bg: '#02040B', Scene: RunwayScene },
  route: { name: '항로', ms: 2050, haptic: [[1180, 22]], caption: 'late', bg: 'radial-gradient(80% 60% at 60% 40%, rgba(40, 90, 160, 0.30), transparent 70%), #050C19', Scene: RouteScene },
};

export const SCENES: Record<string, SceneSpec> = {
  ...CLASSIC_SCENES,
  ...PEANUT_SCENES,
  ...GOOGLE_SCENES,
  ...JOURNEY_SCENES,
  ...SKY_SCENES,
  ...CHEER_SCENES,
};

export type IntroStyle = string;
export const INTRO_STYLES: IntroStyle[] = Object.keys(SCENES);

const STYLE_KEY = 'immIntro';

/** 직전과 다른 연출 하나 */
export function pickIntroStyle(): IntroStyle {
  let last = '';
  try { last = localStorage.getItem(STYLE_KEY) ?? ''; } catch { /* 무시 */ }
  const pool = INTRO_STYLES.filter(st => st !== last);
  const style = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem(STYLE_KEY, style); } catch { /* 무시 */ }
  return style;
}

export function nextIntroStyle(cur: IntroStyle): IntroStyle {
  const style = INTRO_STYLES[(INTRO_STYLES.indexOf(cur) + 1) % INTRO_STYLES.length];
  try { localStorage.setItem(STYLE_KEY, style); } catch { /* 무시 */ }
  return style;
}

// 장면이 끝난 뒤 마지막 화면을 붙잡아 두는 시간 — 말씀(또는 설이 문구)을 끝까지 읽을 수 있게
const HOLD_MS = 1200;

const CAPTION_CLASS: Record<string, string | undefined> = {
  mid: undefined,
  late: styles.c_late,
  top: styles.c_top,
  bottom: styles.c_bottom,
};

/** label: 탑승권을 눌러 다시 볼 때만 '3/22 · 출발 안내판'처럼 이름을 띄운다 */
export function DepartureIntro({ style, verseIndex, label, photos }: { style: IntroStyle; verseIndex: number; label?: string; photos: number[] }) {
  const [on, setOn] = useState(() => {
    try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
  });
  const spec = SCENES[style] ?? SCENES.stamp;
  const { ms, haptic } = spec;
  const total = ms + HOLD_MS;

  useEffect(() => { loadVerseFont(); }, []);

  useEffect(() => {
    if (!on) return;
    // 진동은 사용자가 화면을 한 번이라도 누른 뒤에만 허용된다(안 그러면 크롬이 콘솔 오류를 낸다)
    const canVibrate = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
    const timers = canVibrate ? haptic.map(([at, pattern]) => window.setTimeout(() => {
      try { navigator.vibrate?.(pattern); } catch { /* 미지원 */ }
    }, at)) : [];
    timers.push(window.setTimeout(() => setOn(false), total));
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [on, total, haptic]);

  if (!on) return null;
  const verse = VERSES[verseIndex];
  const Scene = spec.Scene;
  return createPortal(
    <div
      className={styles.overlay}
      style={{ ['--dur' as string]: `${ms}ms`, ['--total' as string]: `${total}ms`, background: spec.bg }}
      data-no-tab-swipe
      onClick={() => setOn(false)}
      aria-hidden="true"
    >
      {label && <div className={styles.sceneLabel}>{label}</div>}
      <Scene photos={photos} />
      {spec.caption !== 'none' && (
        <div className={`${styles.caption} ${CAPTION_CLASS[spec.caption] ?? ''}`}>
          <p className={styles.captionText}>{verse.short}</p>
          <p className={styles.captionRef}>{verse.ref}</p>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ============================================================
// 1) 출국 도장
// ============================================================

function StampScene() {
  return (
    <div className={styles.stage}>
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <span>사증</span>
          <span>VISAS</span>
        </div>
        <PastStamp />
        <DepartureStamp />
        <div className={styles.pageNo}>17</div>
      </div>
    </div>
  );
}

function DepartureStamp() {
  return (
    <div className={styles.stampWrap}>
      <svg className={styles.stamp} viewBox="0 0 220 140" role="img" aria-label="출국 도장">
        <defs>
          {/* 잉크 질감: 미세한 빈틈 + 가장자리 번짐 */}
          <filter id="immInk" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.4 0 0 0 2.05" result="speckle" />
            <feComposite in="SourceGraphic" in2="speckle" operator="in" result="inked" />
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" result="warp" />
            <feDisplacementMap in="inked" in2="warp" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <g filter="url(#immInk)">
          <rect x="5" y="5" width="210" height="130" rx="16" fill="none" stroke="currentColor" strokeWidth="5" />
          <rect x="14" y="14" width="192" height="112" rx="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <text x="110" y="36" textAnchor="middle" fontSize="10.5" fontWeight="700" letterSpacing="1.6" fill="currentColor">대한민국 · REPUBLIC OF KOREA</text>
          {/* 비행기 */}
          <path d="M40 66l14-4 9-11h4l-5 11 9-2 3-4h3l-2 6 2 6h-3l-3-4-9-2 5 11h-4l-9-11-14-4z" fill="currentColor" transform="translate(-6 0)" />
          <text x="118" y="78" textAnchor="middle" fontSize="36" fontWeight="900" letterSpacing="10" fill="currentColor">출국</text>
          <text x="118" y="96" textAnchor="middle" fontSize="11" fontWeight="800" letterSpacing="5" fill="currentColor">DEPARTURE</text>
          <line x1="28" y1="104" x2="192" y2="104" stroke="currentColor" strokeWidth="1.4" />
          <text x="110" y="121" textAnchor="middle" fontSize="14.5" fontWeight="800" letterSpacing="2" fill="currentColor">2026.11.28 · ICN</text>
        </g>
      </svg>
      {/* 찍히는 순간 번지는 잉크 */}
      <div className={styles.inkBloom} />
    </div>
  );
}

/** 예전에 찍힌 듯 흐릿한 도장 하나 — 여권이 실제로 쓰던 것처럼 */
function PastStamp() {
  return (
    <svg className={styles.pastStamp} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="50" cy="50" r="37" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <text x="50" y="47" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor">입국</text>
      <text x="50" y="61" textAnchor="middle" fontSize="8" fontWeight="700" letterSpacing="1" fill="currentColor">ARRIVAL</text>
    </svg>
  );
}

// ============================================================
// 2) 출발 안내판 (스플릿 플랩)
// ============================================================

const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BOARD_ROWS = [
  { label: 'TO', ko: '목적지', value: 'SINGAPORE' },
  { label: 'VIA', ko: '경유', value: 'SHANGHAI' },
  { label: 'DEP', ko: '출발', value: '11/28 12:55' },
  { label: 'TYPE', ko: '구분', value: 'ONE WAY' },
];
const BOARD_W = 11;
const FLAP_STEP_MS = 45;

function flapStop(row: number, col: number) {
  return 260 + row * 130 + col * 32;
}

function BoardScene() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const el = now - start;
      setT(el);
      if (el < 1100) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const step = Math.floor(t / FLAP_STEP_MS);

  return (
    <div className={styles.board}>
      <div className={styles.boardHead}>
        <span className={styles.boardTitle}>DEPARTURES</span>
        <span className={styles.boardKo}>출발</span>
      </div>
      {BOARD_ROWS.map((row, r) => {
        const value = row.value.padEnd(BOARD_W, ' ');
        const settled = t >= flapStop(r, BOARD_W - 1);
        return (
          <div key={row.label} className={`${styles.boardRow} ${settled && r === BOARD_ROWS.length - 1 ? styles.boardRowLit : ''}`}>
            <span className={styles.boardLabel}>{row.label}<i>{row.ko}</i></span>
            <span className={styles.flaps}>
              {Array.from(value).map((ch, c) => {
                const done = t >= flapStop(r, c);
                const shown = done ? ch : t < r * 90 ? ' ' : FLAP_CHARS[(c * 7 + r * 13 + step * 17) % FLAP_CHARS.length];
                return (
                  <span key={c} className={styles.flap}>
                    <span key={done ? 'f' : step} className={styles.flapChar}>{shown}</span>
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// 3) 밤 활주로 이륙 (canvas)
//    가속하며 활주로 불빛이 다가오다가 1.0s에 기수가 들려 지평선이 내려가고 별이 뜬다.
// ============================================================

function RunwayScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // 고정 난수 (매 프레임 같은 별·도시 불빛)
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const city = Array.from({ length: 70 }, () => ({ x: rnd() * W, dy: rnd() * 6, r: 0.5 + rnd() * 1.1, warm: rnd() > 0.3 }));
    const stars = Array.from({ length: 90 }, () => ({ x: rnd() * W, y: rnd(), r: 0.4 + rnd() * 1.1, tw: rnd() }));

    const cx = W / 2;
    const f = Math.min(W, H) * 0.9;     // 초점 거리
    const halfW = 5;                    // 활주로 반폭 (월드 단위) — 좁을수록 불빛이 비스듬히 쏟아진다
    const spacing = 6;                  // 불빛 간격
    const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const start = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = now - start;
      const lift = ease((t - 1000) / 650);           // 0 → 1 기수 들림
      const horizon = H * (0.56 + 0.42 * lift);      // 지평선이 내려간다
      const camH = 4.5 + 60 * lift * lift;           // 고도
      const s = 0.00009 * t * t;                     // 가속 (월드 이동량)

      // 하늘
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#02040B');
      sky.addColorStop(0.75, '#0A1430');
      sky.addColorStop(1, '#1D2B55');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, horizon);
      // 지평선 빛
      const glow = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 6);
      glow.addColorStop(0, 'rgba(255,170,90,0)');
      glow.addColorStop(1, 'rgba(255,170,90,0.18)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, horizon - 40, W, 46);
      // 땅 + 활주로 노면
      ctx.fillStyle = '#030509';
      ctx.fillRect(0, horizon, W, H - horizon);
      const kNear = f / 1.5;
      ctx.fillStyle = '#0A0D13';
      ctx.beginPath();
      ctx.moveTo(cx - 1, horizon);
      ctx.lineTo(cx + 1, horizon);
      ctx.lineTo(cx + halfW * kNear, horizon + camH * kNear);
      ctx.lineTo(cx - halfW * kNear, horizon + camH * kNear);
      ctx.closePath();
      ctx.fill();

      // 별 (이륙하며 나타남)
      const starA = ease((t - 1050) / 500);
      if (starA > 0) {
        for (const st of stars) {
          ctx.globalAlpha = starA * (0.45 + 0.55 * st.tw);
          ctx.fillStyle = '#E8EEFF';
          ctx.beginPath();
          ctx.arc(st.x, st.y * horizon * 0.9, st.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // 먼 도시 불빛
      for (const c of city) {
        ctx.fillStyle = c.warm ? 'rgba(255,196,120,0.85)' : 'rgba(200,220,255,0.7)';
        ctx.beginPath();
        ctx.arc(c.x, horizon - 1 - c.dy * (1 - lift), c.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 활주로 불빛: 가장자리(흰, 가까울수록 크게 번짐) + 중앙선(흰 점선)
      const off = s % spacing;
      for (let i = 80; i >= 1; i--) {
        const z = i * spacing - off;
        if (z < 1.5) continue;
        const k = f / z;
        const y = horizon + camH * k;
        if (y > H + 40) continue;
        const near = Math.min(1, 8 / z);
        const r = Math.min(7, Math.max(0.7, 0.055 * k));
        for (const side of [-1, 1]) {
          const x = cx + side * halfW * k;
          if (x < -20 || x > W + 20) continue;
          ctx.fillStyle = `rgba(255,236,200,${0.12 * near})`;
          ctx.beginPath();
          ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(255,250,240,${0.45 + 0.55 * near})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        const k2 = f / (z + 4);
        ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.5 * near})`;
        ctx.lineWidth = Math.max(0.6, 0.035 * k);
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx, horizon + camH * k2);
        ctx.stroke();
      }
      // 먼 끝 주황 접근등
      ctx.fillStyle = 'rgba(255,150,60,0.9)';
      for (let j = -3; j <= 3; j++) {
        ctx.beginPath();
        ctx.arc(cx + j * 5, horizon + camH * (f / 480), 1, 0, Math.PI * 2);
        ctx.fill();
      }

      if (t < 2000) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className={styles.runwayCanvas} />;
}

// ============================================================
// 4) 항로 — 인천 → 상하이 → 싱가포르 (실제 좌표를 단순 투영)
// ============================================================

// x = 20 + (경도-100)·8.6,  y = 20 + (40-위도)·7.5
const ROUTE_PATH = 'M247.4 39 Q240 62 207.6 86.5 Q196 225 54.3 309.8';
const PORTS = [
  { code: 'ICN', ko: '인천', x: 247.4, y: 39, lat: 37.46, lng: 126.44, at: 0 },
  { code: 'PVG', ko: '상하이', x: 207.6, y: 86.5, lat: 31.14, lng: 121.81, at: 0.2 },
  { code: 'SIN', ko: '싱가포르', x: 54.3, y: 309.8, lat: 1.36, lng: 103.99, at: 1 },
];
const FLY_FROM = 300;
const FLY_MS = 880;

function RouteScene() {
  const pathRef = useRef<SVGPathElement>(null);
  const planeRef = useRef<SVGGElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const len = path.getTotalLength();
    const start = performance.now();
    let raf = 0;
    const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const loop = (now: number) => {
      const raw = Math.min(1, Math.max(0, (now - start - FLY_FROM) / FLY_MS));
      const p = easeInOut(raw);
      const pt = path.getPointAtLength(p * len);
      const ahead = path.getPointAtLength(Math.min(len, p * len + 1));
      const angle = (Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180) / Math.PI;
      planeRef.current?.setAttribute('transform', `translate(${pt.x} ${pt.y}) rotate(${angle})`);
      setProgress(p);
      if (raw < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 좌표 표시: 지나온 구간 사이를 보간
  const seg = progress <= PORTS[1].at ? 0 : 1;
  const a = PORTS[seg];
  const b = PORTS[seg + 1];
  const u = (progress - a.at) / (b.at - a.at || 1);
  const lat = a.lat + (b.lat - a.lat) * u;
  const lng = a.lng + (b.lng - a.lng) * u;

  return (
    <div className={styles.routeBox}>
      <svg className={styles.routeMap} viewBox="0 0 300 340">
        <g className={styles.graticule}>
          {[0, 1, 2, 3, 4].map(i => <line key={`h${i}`} x1="0" x2="300" y1={20 + i * 75} y2={20 + i * 75} />)}
          {[0, 1, 2, 3].map(i => <line key={`v${i}`} y1="0" y2="340" x1={20 + i * 86} x2={20 + i * 86} />)}
        </g>
        <path ref={pathRef} d={ROUTE_PATH} className={styles.routeTrail} />
        <path d={ROUTE_PATH} pathLength={1} className={styles.routeLine} />
        {PORTS.map(p => (
          <g key={p.code} className={`${styles.routePort} ${progress >= p.at - 0.001 ? styles.portOn : ''}`}>
            <circle cx={p.x} cy={p.y} r="4.5" className={styles.portDot} />
            {p.code === 'SIN' && progress >= 1 && <circle cx={p.x} cy={p.y} r="4.5" className={styles.portPulse} />}
            <text x={p.x + (p.code === 'SIN' ? 12 : -12)} y={p.y + 4} textAnchor={p.code === 'SIN' ? 'start' : 'end'} className={styles.portLabel}>
              {p.ko} <tspan className={styles.portCode}>{p.code}</tspan>
            </text>
          </g>
        ))}
        <g ref={planeRef} transform={`translate(${PORTS[0].x} ${PORTS[0].y})`}>
          <path d="M8 0 L-5 -5.5 L-2.5 0 L-5 5.5 Z" className={styles.routePlane} />
        </g>
      </svg>
      <div className={styles.routeCoord}>
        {Math.abs(lat).toFixed(2)}°N&nbsp;&nbsp;{lng.toFixed(2)}°E
      </div>
    </div>
  );
}

/** 탭 머리: 편도 탑승권 */
export function BoardingPass({ onReplay }: { onReplay: () => void }) {
  const d = daysToDeparture();
  return (
    <button className={styles.pass} onClick={onReplay} aria-label="편도 탑승권 — 누르면 출국 연출 다시 보기">
      <div className={styles.passMain}>
        <div className={styles.passTop}>
          <span className={styles.oneWay}>편도 · ONE WAY</span>
          <span className={styles.passDate}>11/28 (토)</span>
        </div>
        <div className={styles.route}>
          <div className={styles.port}>
            <span className={styles.code}>ICN</span>
            <span className={styles.portSub}>인천 12:55</span>
          </div>
          <div className={styles.flightPath} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)" /></svg>
          </div>
          <div className={`${styles.port} ${styles.portEnd}`}>
            <span className={styles.code}>SIN</span>
            <span className={styles.portSub}>창이 22:00</span>
          </div>
        </div>
        <div className={styles.passMeta}>가족 3명 · 상하이 경유 · 11/30 입사</div>
      </div>
      {d >= 0 && (
        <div className={styles.stub}>
          <span className={styles.dNum}>{d === 0 ? 'D-DAY' : `D-${d}`}</span>
          <span className={styles.dLabel}>출국까지</span>
        </div>
      )}
    </button>
  );
}

/** 그날의 말씀 — 누르면 다음 구절 */
export function VerseCard({ index, onChange }: { index: number; onChange: (i: number) => void }) {
  useEffect(() => { loadVerseFont(); }, []);
  const verse = VERSES[index];
  const next = () => {
    const i = (index + 1) % VERSES.length;
    rememberVerse(i);
    onChange(i);
  };
  return (
    <button className={styles.verse} onClick={next} aria-label={`${verse.ref} 말씀. 누르면 다음 말씀`}>
      <span key={index} className={styles.verseInner}>
        <span className={styles.verseText}>{verse.text}</span>
        <span className={styles.verseFoot}>
          <span className={styles.verseRef}>{verse.ref}</span>
          <span className={styles.verseNext}>다음 말씀</span>
        </span>
      </span>
    </button>
  );
}
