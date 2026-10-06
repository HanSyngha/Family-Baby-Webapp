import type { SceneSpec } from './types';
import s from './sky.module.css';

/**
 * 방향과 하늘, 그리고 위로.
 *   나침반   인천에서 싱가포르로의 첫 방위 215° (대권 항로, 남서쪽)
 *   스카이라인 마리나 베이 저녁, 불이 하나씩 켜짐
 *   남십자성  싱가포르(북위 1.3°) 밤하늘에서 보이는 별자리
 *   발자국 · 문 · 촛불
 */

// ---------- 나침반 ----------
const BEARING = 215;
function CompassScene() {
  return (
    <div className={s.compassStage}>
      <svg className={s.compass} viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="94" fill="#0E1A30" stroke="#C9A257" strokeWidth="3" />
        <circle cx="100" cy="100" r="82" fill="none" stroke="rgba(227,194,126,0.35)" strokeWidth="1" />
        {Array.from({ length: 72 }, (_, i) => (
          <line key={i} x1="100" y1="10" x2="100" y2={i % 9 === 0 ? 22 : 16} stroke="rgba(227,194,126,0.6)" strokeWidth={i % 9 === 0 ? 2 : 1} transform={`rotate(${i * 5} 100 100)`} />
        ))}
        {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([t, a]) => (
          <text key={t} x="100" y="40" textAnchor="middle" fontSize="15" fontWeight="800" fill={t === 'N' ? '#E3C27E' : 'rgba(241,232,216,0.75)'} transform={`rotate(${a} 100 100)`}>{t}</text>
        ))}
        {/* 목표 방위 표시 */}
        <g transform={`rotate(${BEARING} 100 100)`} className={s.target}>
          <path d="M100 6L106 18H94Z" fill="#D9473A" />
        </g>
        <g className={s.needle}>
          <path d="M100 28L108 100L100 108L92 100Z" fill="#D9473A" />
          <path d="M100 172L108 100L100 92L92 100Z" fill="#E8E1D4" />
          <circle cx="100" cy="100" r="7" fill="#C9A257" stroke="#0E1A30" strokeWidth="2" />
        </g>
      </svg>
      <div className={s.bearing}>
        <span className={s.bearingDeg}>{BEARING}°</span>
        <span className={s.bearingTo}>남서쪽 · 싱가포르</span>
      </div>
    </div>
  );
}

// ---------- 싱가포르 스카이라인 ----------
function SkylineScene() {
  return (
    <div className={s.skyline}>
      <div className={s.duskSky} />
      <svg className={s.city} viewBox="0 0 400 220" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        {/* 뒤쪽 빌딩 */}
        <g fill="#0D1526">
          <rect x="8" y="96" width="30" height="104" />
          <rect x="42" y="70" width="24" height="130" />
          <rect x="70" y="110" width="34" height="90" />
          <rect x="300" y="84" width="26" height="116" />
          <rect x="330" y="104" width="34" height="96" />
          <rect x="368" y="76" width="26" height="124" />
        </g>
        {/* 마리나 베이 샌즈: 세 개의 탑 + 위에 배 모양 */}
        <g fill="#111C33">
          <path d="M150 200L156 92H176L174 200Z" />
          <path d="M190 200L196 92H216L214 200Z" />
          <path d="M230 200L236 92H256L254 200Z" />
          <path d="M140 84H270Q276 84 278 88L274 92H138Q134 88 140 84Z" />
        </g>
        {/* 가든스 바이 더 베이 슈퍼트리 */}
        {[{ x: 112, h: 66 }, { x: 128, h: 50 }, { x: 288, h: 58 }].map(t => (
          <g key={t.x} fill="#13203A">
            <path d={`M${t.x - 3} 200L${t.x - 1.5} ${200 - t.h}H${t.x + 1.5}L${t.x + 3} 200Z`} />
            <path d={`M${t.x - 12} ${200 - t.h}Q${t.x} ${200 - t.h - 10} ${t.x + 12} ${200 - t.h}L${t.x + 2} ${200 - t.h + 8}H${t.x - 2}Z`} />
          </g>
        ))}
        {/* 창문 불빛 */}
        <g className={s.lights}>
          {Array.from({ length: 46 }, (_, i) => {
            const cols = [14, 26, 48, 58, 78, 92, 160, 166, 200, 206, 240, 246, 306, 316, 338, 352, 374, 384];
            const x = cols[i % cols.length];
            const y = 100 + ((i * 37) % 90);
            return <rect key={i} x={x} y={y} width="3" height="4" rx="0.6" style={{ ['--i' as string]: i }} />;
          })}
        </g>
        <path className={s.skyparkGlow} d="M140 85H270" stroke="#FFD08A" strokeWidth="2" />
        {[112, 128, 288].map(x => <circle key={x} className={s.treeGlow} cx={x} cy="140" r="3" />)}
      </svg>
      <div className={s.water}>
        <div className={s.shimmer} />
      </div>
    </div>
  );
}

// ---------- 남십자성 ----------
// 남쪽 하늘을 보고 십자가가 섰을 때의 실제 배치: 위 가크룩스, 아래 아크룩스(가장 밝음),
// 왼쪽 미모사, 오른쪽 이마이, 오른쪽 아래 작은 지난. 반지름은 밝기 순.
const CRUX = [
  { x: 150, y: 40, r: 4.4 },   // 가크룩스 γ
  { x: 160, y: 252, r: 5.2 },  // 아크룩스 α
  { x: 70, y: 140, r: 4.8 },   // 미모사 β
  { x: 226, y: 118, r: 3.2 },  // 이마이 δ
  { x: 192, y: 188, r: 2.2 },  // 지난 ε
];
function SouthernCrossScene() {
  return (
    <div className={s.crossStage}>
      <div className={s.starfield} />
      <svg className={s.crux} viewBox="0 0 300 300" aria-hidden="true">
        <line className={s.cruxLine} x1={CRUX[0].x} y1={CRUX[0].y} x2={CRUX[1].x} y2={CRUX[1].y} />
        <line className={`${s.cruxLine} ${s.cruxLine2}`} x1={CRUX[2].x} y1={CRUX[2].y} x2={CRUX[3].x} y2={CRUX[3].y} />
        {CRUX.map((st, i) => (
          <g key={i} className={s.cruxStar} style={{ ['--i' as string]: i }}>
            <circle cx={st.x} cy={st.y} r={st.r * 3.2} fill="rgba(200,220,255,0.12)" />
            <circle cx={st.x} cy={st.y} r={st.r} fill="#F4F7FF" />
          </g>
        ))}
      </svg>
      <div className={s.crossLabel}>
        <span className={s.crossName}>남십자성</span>
        <span className={s.crossSub}>싱가포르 밤하늘에서 보이는 별</span>
      </div>
    </div>
  );
}

// ---------- 모래 위 발자국 ----------
function FootprintsScene() {
  const steps = Array.from({ length: 8 }, (_, i) => i);
  return (
    <div className={s.beach}>
      <div className={s.sea}>
        <div className={s.wave} />
      </div>
      <div className={s.sand}>
        {steps.map(i => (
          <div key={i} className={s.stepPair} style={{ ['--i' as string]: i }}>
            <span className={`${s.foot} ${i % 2 ? s.footR : s.footL}`} />
            <span className={`${s.foot} ${s.footSmall} ${i % 2 ? s.footL : s.footR}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 열리는 문 ----------
function DoorScene() {
  return (
    <div className={s.doorStage}>
      <div className={s.beam} />
      <div className={s.doorFrame}>
        <div className={s.doorLight} />
        <div className={s.door}>
          <span className={s.knob} />
        </div>
      </div>
      <div className={s.floorLight} />
    </div>
  );
}

// ---------- 촛불 ----------
function CandleScene() {
  return (
    <div className={s.candleStage}>
      <div className={s.halo} />
      <div className={s.spark} />
      <div className={s.flameWrap}>
        <div className={s.flame} />
        <div className={s.flameCore} />
      </div>
      <div className={s.wick} />
      <div className={s.candle} />
      <div className={s.plate} />
    </div>
  );
}

export const SKY_SCENES: Record<string, SceneSpec> = {
  compass: {
    name: '나침반',
    ms: 2200,
    haptic: [[1150, 20]],
    caption: 'late',
    bg: 'radial-gradient(70% 50% at 50% 40%, rgba(46,82,140,0.35), transparent 70%), #060B15',
    Scene: CompassScene,
  },
  skyline: {
    name: '싱가포르 스카이라인',
    ms: 2300,
    haptic: [],
    caption: 'top',
    bg: '#0A0F1C',
    Scene: SkylineScene,
  },
  'southern-cross': {
    name: '남십자성',
    ms: 2300,
    haptic: [],
    caption: 'bottom',
    bg: 'radial-gradient(90% 70% at 50% 40%, #0E1A38, #03060E 75%)',
    Scene: SouthernCrossScene,
  },
  footprints: {
    name: '발자국',
    ms: 2300,
    haptic: [],
    caption: 'top',
    bg: '#0B1220',
    Scene: FootprintsScene,
  },
  door: {
    name: '열리는 문',
    ms: 2100,
    haptic: [[500, 16]],
    caption: 'bottom',
    bg: '#050608',
    Scene: DoorScene,
  },
  candle: {
    name: '촛불',
    ms: 2400,
    haptic: [[420, 10]],
    caption: 'bottom',
    bg: '#030304',
    Scene: CandleScene,
  },
};
