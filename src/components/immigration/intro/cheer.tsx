import { useEffect, useState } from 'react';
import { api } from '../../../api';
import type { SceneSpec } from './types';
import s from './cheer.module.css';

/**
 * 설이 응원 — 갤러리(땅땅&콩콩, 공유)에 있는 설이 사진 세 장이 폴라로이드로 떨어지고
 * "엄마 힘내세요!" (보는 사람과 상관없이 늘 엄마 — 승하 요청). 사진은 갤러리 것을 가리키기만 한다(복사 없음).
 * 사진 고르기: 2026-10-06, 9/26 스튜디오 촬영분 + 성장 사진에서 (목욕·기저귀 사진 제외).
 */
export const CHEER_PHOTO_IDS: number[] = [
  // 9/26 스튜디오 촬영 (승하가 고른 65105부터)
  65105, 65528, 65537, 65541, 65003, 65690, 65022, 65695,
  // 활짝 웃는 성장 사진
  1590, 64497, 64698, 66591,
];

const LAST_KEY = 'immCheer';

function pickThree(): number[] {
  let last: number[] = [];
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? '[]'); } catch { /* 무시 */ }
  const fresh = CHEER_PHOTO_IDS.filter(id => !last.includes(id));
  const pool = fresh.length >= 3 ? fresh : CHEER_PHOTO_IDS;
  const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
  try { localStorage.setItem(LAST_KEY, JSON.stringify(picked)); } catch { /* 무시 */ }
  return picked;
}

// 손글씨 폰트 (이 장면에서만)
let fontRequested = false;
function loadHandFont() {
  if (fontRequested) return;
  fontRequested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap';
  document.head.appendChild(link);
}

function Polaroid({ id, i }: { id: number; i: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`${s.polaroid} ${s[`p${i}`]}`}>
      <div className={s.photo}>
        <img
          src={api.thumbUrl(id, undefined, 640)}
          alt=""
          className={loaded ? s.imgOn : ''}
          onLoad={() => setLoaded(true)}
          onError={e => { (e.currentTarget.parentElement as HTMLElement).style.visibility = 'hidden'; }}
        />
      </div>
    </div>
  );
}

function CheerScene() {
  const [ids] = useState(pickThree);
  useEffect(() => { loadHandFont(); }, []);
  return (
    <div className={s.stage}>
      <div className={s.photos}>
        {ids.map((id, i) => <Polaroid key={id} id={id} i={i} />)}
      </div>
      <div className={s.message}>
        <span className={s.big}>엄마 힘내세요!</span>
        <span className={s.from}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#F28B82"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.6 3 5 6.6 5c2 0 3.6 1.1 4.4 2.6h2C13.8 6.1 15.4 5 17.4 5 21 5 23.1 8.6 21.6 11.8 19.5 16.4 12 21 12 21z" /></svg>
          설이가
        </span>
      </div>
    </div>
  );
}

export const CHEER_SCENES: Record<string, SceneSpec> = {
  cheer: {
    name: '설이 응원',
    ms: 3200,
    haptic: [[420, 10], [700, 10], [980, 10]],
    caption: 'none',
    bg: 'radial-gradient(80% 60% at 50% 40%, rgba(242,139,130,0.18), transparent 70%), radial-gradient(60% 40% at 50% 100%, rgba(227,194,126,0.12), transparent 70%), #0E0B12',
    Scene: CheerScene,
  },
};
