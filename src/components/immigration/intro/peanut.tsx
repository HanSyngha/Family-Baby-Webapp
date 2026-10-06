import { useId } from 'react';
import type { SceneSpec } from './types';
import s from './peanut.module.css';

/**
 * 땅콩패밀리 마크(public/icons/peanut-app-logo.png)를 SVG로 다시 그린 캐릭터.
 * 그림을 코드로 가지고 있어야 몸·눈·기울기를 따로 움직일 수 있다.
 *   Peanut      큰 땅콩 (승하·하람)
 *   BabyPeanut  포대기에 싸인 아기 땅콩 (설이)
 *   PeanutHead  비행기 창문에 보이는 얼굴만
 */

const SHELL = '#D69E62';
const LINE = '#A85A21';
const NET = '#F7E6C8';
const INK = '#2A1A10';

const BODY =
  'M50 6C74 6 88 24 86 46C84 64 72 72 72 86C72 100 90 108 90 132C90 154 72 166 50 166' +
  'C28 166 10 154 10 132C10 108 28 100 28 86C28 72 16 64 14 46C12 24 26 6 50 6Z';

function Face({ cx, cy, scale = 1 }: { cx: number; cy: number; scale?: number }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`}>
      <g className={s.eyes}>
        <ellipse cx="-12" cy="0" rx="3.6" ry="4.3" fill={INK} />
        <ellipse cx="12" cy="0" rx="3.6" ry="4.3" fill={INK} />
      </g>
      <path d="M-3.4 6.5L3.4 6.5L0 11Z" fill={INK} strokeLinejoin="round" />
      <path d="M-6 14Q0 19.5 6 14" fill="none" stroke={INK} strokeWidth="2.3" strokeLinecap="round" />
    </g>
  );
}

export function Peanut({ className }: { className?: string }) {
  const clip = useId();
  return (
    <svg className={className} viewBox="0 0 100 172" aria-hidden="true">
      <defs>
        <clipPath id={clip}><path d={BODY} /></clipPath>
      </defs>
      <path d={BODY} fill={SHELL} />
      <g clipPath={`url(#${clip})`} fill="none" stroke={NET} strokeWidth="2.6" strokeLinecap="round" opacity="0.92">
        <path d="M31 14C22 60 40 102 25 160" />
        <path d="M69 14C78 60 60 102 75 160" />
        <path d="M18 34Q50 42 82 34" />
        <path d="M22 66Q50 72 78 66" />
        <path d="M30 94Q50 98 70 94" />
        <path d="M16 118Q50 126 84 118" />
        <path d="M14 144Q50 152 86 144" />
      </g>
      <path d={BODY} fill="none" stroke={LINE} strokeWidth="6" strokeLinejoin="round" />
      <Face cx={50} cy={46} />
    </svg>
  );
}

export function BabyPeanut({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 78" aria-hidden="true">
      <path d="M30 5C42 5 48 15 46 25C45 31 40 35 30 35C20 35 15 31 14 25C12 15 18 5 30 5Z" fill={SHELL} stroke={LINE} strokeWidth="3.4" />
      <Face cx={30} cy={20} scale={0.5} />
      <path d="M9 33C9 28 51 28 51 33C55 50 50 70 30 74C10 70 5 50 9 33Z" fill="#FBF1E2" stroke="#C98A4B" strokeWidth="3" strokeLinejoin="round" />
      <path d="M11 44Q30 52 49 40M13 57Q30 63 47 52" fill="none" stroke="#E2C6A0" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function PeanutHead({ baby }: { baby?: boolean }) {
  return (
    <g>
      <circle r="12" fill={SHELL} stroke={LINE} strokeWidth="2" />
      <Face cx={0} cy={-2} scale={baby ? 0.36 : 0.42} />
    </g>
  );
}

// ============================================================
// 장면 1. 땅콩 가족 — 둘이 깡충 뛰어와 하트로 기대고, 설이가 앞에 쏙
// ============================================================

function PeanutFamilyScene() {
  return (
    <div className={s.familyStage}>
      <div className={s.spot} />
      <div className={`${s.parent} ${s.parentL}`}><Peanut className={s.peanutSvg} /></div>
      <div className={`${s.parent} ${s.parentR}`}><Peanut className={s.peanutSvg} /></div>
      <div className={s.baby}><BabyPeanut className={s.babySvg} /></div>
      <div className={s.sparkles}>
        {[0, 1, 2, 3, 4, 5].map(i => <span key={i} style={{ ['--i' as string]: i }} />)}
      </div>
    </div>
  );
}

// ============================================================
// 장면 2. 땅콩 가족 비행기 — 창문마다 우리 얼굴, 잠깐 떠 있다가 이륙
// ============================================================

function PeanutPlaneScene() {
  return (
    <div className={s.planeStage}>
      <div className={`${s.cloud} ${s.cloud1}`} />
      <div className={`${s.cloud} ${s.cloud2}`} />
      <div className={`${s.cloud} ${s.cloud3}`} />
      <div className={s.planeFly}>
        <div className={s.contrail} />
        <svg className={s.plane} viewBox="0 0 260 112" aria-hidden="true">
          {/* 꼬리날개 */}
          <path d="M42 44L24 8H48L76 42Z" fill="#17305A" />
          <path d="M30 10H46L60 28H40Z" fill="#E3C27E" opacity="0.9" />
          {/* 동체 */}
          <path d="M18 62C18 48 38 40 68 40H202C230 40 250 50 252 61C250 72 230 80 202 80H60C32 80 18 74 18 62Z" fill="#F6F1E8" stroke="#22324D" strokeWidth="2.6" />
          <path d="M30 70H226" stroke="#17305A" strokeWidth="3" strokeLinecap="round" />
          <path d="M34 74H220" stroke="#E3C27E" strokeWidth="1.4" strokeLinecap="round" />
          {/* 조종석 */}
          <path d="M226 50Q240 52 245 59H226Z" fill="#22324D" />
          {/* 창문 + 우리 */}
          {[{ x: 96, b: false }, { x: 130, b: false }, { x: 164, b: true }].map(({ x, b }) => (
            <g key={x} transform={`translate(${x} 56)`}>
              <circle r="12.5" fill="#BFD6F2" stroke="#22324D" strokeWidth="2.4" />
              <g className={s.windowFace} style={{ ['--d' as string]: `${(x - 96) * 4}ms` }}>
                <g transform={`translate(0 ${b ? 5 : 3}) scale(${b ? 0.7 : 0.88})`}><PeanutHead baby={b} /></g>
              </g>
              <circle r="12.5" fill="none" stroke="#22324D" strokeWidth="2.4" />
            </g>
          ))}
          {/* 날개 · 엔진 */}
          <path d="M118 66L158 104H184L150 64Z" fill="#DCE2EB" stroke="#22324D" strokeWidth="2.2" strokeLinejoin="round" />
          <rect x="138" y="84" width="26" height="11" rx="5.5" fill="#B9C3D2" stroke="#22324D" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
}

// ============================================================
// 장면 3. 캐리어 — 굴러 들어온 캐리어 위로 하나씩 올라타고 출발
// ============================================================

function PeanutSuitcaseScene() {
  return (
    <div className={s.caseStage}>
      <div className={s.floor} />
      <div className={s.caseGroup}>
        <div className={s.speedLines}>
          {[0, 1, 2, 3].map(i => <span key={i} style={{ ['--i' as string]: i }} />)}
        </div>
        <div className={`${s.rider} ${s.riderL}`}><Peanut className={s.peanutSvg} /></div>
        <div className={`${s.rider} ${s.riderR}`}><Peanut className={s.peanutSvg} /></div>
        <svg className={s.suitcase} viewBox="0 0 160 150" aria-hidden="true">
          <rect x="62" y="0" width="36" height="14" rx="6" fill="none" stroke="#C9A257" strokeWidth="5" />
          <rect x="8" y="12" width="144" height="118" rx="16" fill="#17305A" stroke="#0B1528" strokeWidth="3" />
          {[42, 80, 118].map(x => <path key={x} d={`M${x} 18V124`} stroke="#22427A" strokeWidth="6" strokeLinecap="round" />)}
          <path d="M8 34H152M8 108H152" stroke="#C9A257" strokeWidth="2" opacity="0.7" />
          <circle cx="30" cy="138" r="9" fill="#0B1528" stroke="#5B6B86" strokeWidth="3" />
          <circle cx="130" cy="138" r="9" fill="#0B1528" stroke="#5B6B86" strokeWidth="3" />
          {/* 수하물 태그 */}
          <g className={s.tag}>
            <path d="M118 20L132 44" stroke="#E3C27E" strokeWidth="2" />
            <rect x="122" y="42" width="28" height="18" rx="3" fill="#F6EFDF" stroke="#C9A257" strokeWidth="1.5" />
            <text x="136" y="55" textAnchor="middle" fontSize="10" fontWeight="900" fill="#17305A">SIN</text>
          </g>
        </svg>
        <div className={s.pocketBaby}><BabyPeanut className={s.babySvg} /></div>
      </div>
    </div>
  );
}

export const PEANUT_SCENES: Record<string, SceneSpec> = {
  'peanut-family': {
    name: '땅콩 가족',
    ms: 2200,
    haptic: [[880, 18]],
    caption: 'late',
    bg: 'radial-gradient(70% 50% at 50% 45%, rgba(227,194,126,0.16), transparent 70%), #0A1220',
    Scene: PeanutFamilyScene,
  },
  'peanut-plane': {
    name: '땅콩 가족 비행기',
    ms: 2300,
    haptic: [[1150, [12, 30, 16, 30, 22]]],
    caption: 'bottom',
    bg: 'linear-gradient(180deg, #0B1630 0%, #1B2E55 55%, #E39A62 100%)',
    Scene: PeanutPlaneScene,
  },
  'peanut-suitcase': {
    name: '땅콩 가족 캐리어',
    ms: 2200,
    haptic: [[620, 14], [820, 14], [1300, [10, 30, 10, 30, 10]]],
    caption: 'late',
    bg: 'radial-gradient(80% 50% at 50% 55%, rgba(46,82,140,0.35), transparent 70%), #070D18',
    Scene: PeanutSuitcaseScene,
  },
};
