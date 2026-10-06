import { useEffect, useState } from 'react';
import { api } from '../../../api';
import type { SceneProps, SceneSpec } from './types';
import s from './cheer.module.css';

/**
 * 설이가 엄마에게 — 문구 4가지, 연출도 각각 다르게.
 *   엄마 힘내세요            폴라로이드 세 장이 떨어진다
 *   엄마 사랑해요            하트 액자가 두근거리고 작은 하트들이 떠오른다
 *   엄마 할 수 있어요        금빛 고리가 차오르고 별이 터진다
 *   나는 엄마의 모든 모습이 좋아요   필름 스트립에 사진이 흘러간다
 * 사진: 하람이 갤러리에서 하트 누른 설이 사진(서버 summary.cheerPhotoIds)이 4장 이상이면 그것,
 * 아니면 아래 기본 사진. 갤러리 것을 id로 가리키기만 한다(복사 없음). 공유 사진만.
 */
// [id, 얼굴 위치 y(사진 높이 대비), x] — 액자 모양이 달라도 얼굴이 잘리지 않게 맞추는 기준점
const CHEER_PHOTOS: [number, number, number?][] = [
  // 9/26 스튜디오 촬영 (승하가 고른 65105부터) — 2026-10-06 선정, 목욕·기저귀 사진 제외
  [65105, 0.46], [65528, 0.57], [65537, 0.56], [65541, 0.47, 0.38],
  [65003, 0.36], [65690, 0.48], [65022, 0.54], [65695, 0.49],
  // 활짝 웃는 성장 사진
  [1590, 0.24], [64497, 0.2], [64698, 0.75], [66591, 0.32],
];
export const CHEER_PHOTO_IDS = CHEER_PHOTOS.map(([id]) => id);
const FOCUS = new Map(CHEER_PHOTOS.map(([id, y, x]) => [id, { y, x: x ?? 0.5 }]));
// 하람이 하트 누른 사진은 얼굴 위치를 모르니, 아기 사진에서 흔한 '위쪽 1/3'로 본다
const DEFAULT_FOCUS = { y: 0.34, x: 0.5 };

/** n장을 고르되 직전에 본 사진은 되도록 피한다 */
function pick(pool: number[], n: number): number[] {
  const src = pool.length ? pool : CHEER_PHOTO_IDS;
  let last: number[] = [];
  try { last = JSON.parse(localStorage.getItem('immCheer') ?? '[]'); } catch { /* 무시 */ }
  const fresh = src.filter(id => !last.includes(id));
  const base = fresh.length >= n ? fresh : src;
  const picked = [...base].sort(() => Math.random() - 0.5).slice(0, n);
  try { localStorage.setItem('immCheer', JSON.stringify(picked)); } catch { /* 무시 */ }
  return picked;
}

// 손글씨 폰트 (설이가 쓴 글씨)
let fontRequested = false;
function useHandFont() {
  useEffect(() => {
    if (fontRequested) return;
    fontRequested = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap';
    document.head.appendChild(link);
  }, []);
}

/**
 * object-fit: cover로 잘릴 때 얼굴(focus)이 액자 안 target 위치에 오도록 object-position을 계산한다.
 * 이미지 점 f가 상자 t에 오려면 p = (t·box − f·img) / (box − img)  (0~1로 자름)
 */
function Photo({ id, target = 0.45 }: { id: number; target?: number }) {
  const [loaded, setLoaded] = useState(false);
  const focus = FOCUS.get(id) ?? DEFAULT_FOCUS;
  const place = (img: HTMLImageElement) => {
    const { naturalWidth: nw, naturalHeight: nh, clientWidth: bw, clientHeight: bh } = img;
    if (!nw || !nh || !bw || !bh) return;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    let px = 0.5;
    let py = 0.5;
    if (nh / nw > bh / bw) {
      const h = bw * (nh / nw);
      py = clamp((target * bh - focus.y * h) / (bh - h));
    } else {
      const w = bh * (nw / nh);
      px = clamp((0.5 * bw - focus.x * w) / (bw - w));
    }
    img.style.objectPosition = `${px * 100}% ${py * 100}%`;
  };
  return (
    <img
      src={api.thumbUrl(id, undefined, 640)}
      alt=""
      className={`${s.img} ${loaded ? s.imgOn : ''}`}
      onLoad={e => { place(e.currentTarget); setLoaded(true); }}
      onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
    />
  );
}

function Signature() {
  return (
    <span className={s.from}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#F28B82"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.6 3 5 6.6 5c2 0 3.6 1.1 4.4 2.6h2C13.8 6.1 15.4 5 17.4 5 21 5 23.1 8.6 21.6 11.8 19.5 16.4 12 21 12 21z" /></svg>
      설이가
    </span>
  );
}

// ---------- 엄마 힘내세요: 폴라로이드 ----------
function FightScene({ photos }: SceneProps) {
  useHandFont();
  const [ids] = useState(() => pick(photos, 3));
  return (
    <div className={s.stage}>
      <div className={s.photos}>
        {ids.map((id, i) => (
          <div key={id} className={`${s.polaroid} ${s[`p${i}`]}`}>
            <div className={s.polaroidPhoto}><Photo id={id} /></div>
          </div>
        ))}
      </div>
      <div className={`${s.message} ${s.messageFight}`}>
        <span className={s.big}>엄마 힘내세요!</span>
        <Signature />
      </div>
    </div>
  );
}

// ---------- 엄마 사랑해요: 하트 액자 ----------
const HEART = 'M50 90C20 68 3 50 3 30C3 15 15 4 29 4C39 4 46 10 50 18C54 10 61 4 71 4C85 4 97 15 97 30C97 50 80 68 50 90Z';

function LoveScene({ photos }: SceneProps) {
  useHandFont();
  const [[id]] = useState(() => pick(photos, 1));
  return (
    <div className={s.stage}>
      <div className={s.floatHearts} aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <svg key={i} viewBox="0 0 100 92" style={{ ['--i' as string]: i }}><path d={HEART} /></svg>
        ))}
      </div>
      <div className={s.heartFrame}>
        <div className={s.heartPhoto}><Photo id={id} /></div>
        <svg className={s.heartLine} viewBox="0 0 100 92" aria-hidden="true">
          <path d={HEART} fill="none" stroke="#FFE3D6" strokeWidth="2.4" strokeLinejoin="round" />
        </svg>
      </div>
      <div className={`${s.message} ${s.messageLove}`}>
        <span className={s.big}>엄마 사랑해요</span>
        <Signature />
      </div>
    </div>
  );
}

// ---------- 엄마 할 수 있어요: 차오르는 고리 + 별 ----------
function CanDoScene({ photos }: SceneProps) {
  useHandFont();
  const [[id]] = useState(() => pick(photos, 1));
  return (
    <div className={s.stage}>
      <div className={s.canDo}>
        <div className={s.rays} aria-hidden="true" />
        <div className={s.ring} aria-hidden="true" />
        <div className={s.circlePhoto}><Photo id={id} target={0.5} /></div>
        <div className={s.burst} aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <svg key={i} viewBox="0 0 24 24" style={{ ['--i' as string]: i }}><path d="M12 2l2.9 6.6 7.1.7-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.3l7.1-.7z" /></svg>
          ))}
        </div>
      </div>
      <div className={`${s.message} ${s.messageCanDo}`}>
        <span className={s.big}>
          <span className={s.word1}>엄마</span> <span className={s.word2}>할 수 있어요!</span>
        </span>
        <Signature />
      </div>
    </div>
  );
}

// ---------- 나는 엄마의 모든 모습이 좋아요: 필름 스트립 ----------
function AllOfYouScene({ photos }: SceneProps) {
  useHandFont();
  const [ids] = useState(() => pick(photos, 6));
  return (
    <div className={s.filmStage}>
      <div className={s.film}>
        <div className={s.filmTrack}>
          {[...ids, ...ids.slice(0, 2)].map((id, i) => (
            <div key={`${id}-${i}`} className={s.frame}><Photo id={id} /></div>
          ))}
        </div>
      </div>
      <div className={`${s.message} ${s.messageAll}`}>
        <span className={`${s.big} ${s.line1}`}>나는 엄마의</span>
        <span className={`${s.big} ${s.line2}`}>모든 모습이 좋아요</span>
        <Signature />
      </div>
    </div>
  );
}

const WARM = 'radial-gradient(80% 60% at 50% 40%, rgba(242,139,130,0.18), transparent 70%), radial-gradient(60% 40% at 50% 100%, rgba(227,194,126,0.12), transparent 70%), #0E0B12';

export const CHEER_SCENES: Record<string, SceneSpec> = {
  'cheer-fight': {
    name: '엄마 힘내세요',
    ms: 3200,
    haptic: [[420, 10], [700, 10], [980, 10]],
    caption: 'none',
    bg: WARM,
    Scene: FightScene,
  },
  'cheer-love': {
    name: '엄마 사랑해요',
    ms: 3200,
    haptic: [[1300, [16, 90, 16]], [1800, [16, 90, 16]]],
    caption: 'none',
    bg: 'radial-gradient(70% 55% at 50% 42%, rgba(255,120,150,0.22), transparent 70%), #120A10',
    Scene: LoveScene,
  },
  'cheer-cando': {
    name: '엄마 할 수 있어요',
    ms: 3000,
    haptic: [[1700, 40]],
    caption: 'none',
    bg: 'radial-gradient(70% 55% at 50% 40%, rgba(255,196,110,0.22), transparent 70%), #110D07',
    Scene: CanDoScene,
  },
  'cheer-all': {
    name: '나는 엄마의 모든 모습이 좋아요',
    ms: 3800,
    haptic: [],
    caption: 'none',
    bg: WARM,
    Scene: AllOfYouScene,
  },
};
