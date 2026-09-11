import { useMemo } from 'react';
import styles from './TripMap.module.css';

/**
 * 오키나와 본섬 약도 (축척 아님).
 * 외부 지도 타일을 쓰지 않고 SVG로 직접 그린다 — 앱(WebView)에서도 오프라인·CSP 걱정 없이 뜨고,
 * 일정 동선을 '한눈에' 보여주는 게 목적이라 정밀 지도보다 이쪽이 읽기 쉽다.
 */

export interface MapPoint {
  id: number | string;
  lat: number;
  lng: number;
  label: string;
  order?: number;
  kind?: 'stay' | 'spot' | 'airport';
}

// 본섬을 감싸는 좌표 범위 (남단 이토만 ~ 북부 모토부)
const LAT_TOP = 26.92;
const LAT_BOTTOM = 26.04;
const LNG_LEFT = 127.58;
const LNG_RIGHT = 128.38;

const W = 300;
const H = 420;

// 본섬 해안선을 실제 위경도로 찍어 폴리곤을 만든다.
// (좌표 없이 손으로 그린 path를 쓰면 섬 그림과 점이 서로 다른 좌표계로 놀아 점이 바다에 찍힌다)
const ISLAND_COORDS: [number, number][] = [
  [26.09, 127.66], [26.14, 127.65], [26.22, 127.68], [26.28, 127.72], [26.34, 127.74],
  [26.43, 127.78], [26.50, 127.85], [26.58, 127.91], [26.65, 127.90], [26.70, 127.87],
  [26.72, 127.93], [26.68, 127.99], [26.74, 128.07], [26.80, 128.16], [26.87, 128.26],
  [26.84, 128.28], [26.76, 128.18], [26.70, 128.10], [26.62, 128.05], [26.55, 127.97],
  [26.47, 127.90], [26.40, 127.86], [26.35, 127.85], [26.28, 127.80], [26.21, 127.76],
  [26.15, 127.74], [26.10, 127.72],
];

const AREAS = [
  { name: '모토부', lat: 26.68, lng: 127.90 },
  { name: '나고', lat: 26.58, lng: 127.98 },
  { name: '온나', lat: 26.44, lng: 127.82 },
  { name: '자탄', lat: 26.32, lng: 127.78 },
  { name: '나하', lat: 26.21, lng: 127.71 },
];

function project(lat: number, lng: number) {
  const x = ((lng - LNG_LEFT) / (LNG_RIGHT - LNG_LEFT)) * W;
  const y = ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * H;
  return { x, y };
}

// 점 마커는 화면 밖으로 나가지 않게 살짝 물려둔다
function clampPoint(lat: number, lng: number) {
  const { x, y } = project(lat, lng);
  return { x: Math.max(16, Math.min(W - 16, x)), y: Math.max(16, Math.min(H - 16, y)) };
}

const ISLAND = ISLAND_COORDS.map(([la, ln], i) => {
  const { x, y } = project(la, ln);
  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
}).join(' ') + ' Z';

export default function TripMap({ points, title }: { points: MapPoint[]; title?: string }) {
  // 같은 곳을 여러 번 가면(숙소 왕복 등) 점이 겹쳐 읽을 수 없다 → 1km 이내는 한 점으로 묶고
  // 방문 순서를 함께 표기한다.
  const pts = useMemo(() => {
    const merged: (MapPoint & { x: number; y: number; orders: number[]; labels: string[] })[] = [];
    points
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .forEach((p, i) => {
        const order = p.order ?? i + 1;
        const near = merged.find(m => Math.abs(m.lat - p.lat) < 0.01 && Math.abs(m.lng - p.lng) < 0.01);
        if (near) {
          near.orders.push(order);
          if (!near.labels.includes(p.label)) near.labels.push(p.label);
          if (p.kind === 'stay') near.kind = 'stay';
          return;
        }
        merged.push({ ...p, ...clampPoint(p.lat, p.lng), orders: [order], labels: [p.label] });
      });
    return merged;
  }, [points]);

  if (pts.length === 0) return null;

  // 선은 실제 방문 순서대로
  const ordered = [...pts].sort((a, b) => Math.min(...a.orders) - Math.min(...b.orders));
  const path = ordered.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.title}>{title ?? '동선 약도'}</span>
        <span className={styles.note}>축척 아님 · 순서대로 이동</span>
      </div>
      <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="오키나와 동선 약도">
        <defs>
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#DCEEF7" />
            <stop offset="100%" stopColor="#C6E3F2" />
          </linearGradient>
          <linearGradient id="land" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#EBF3E2" />
            <stop offset="100%" stopColor="#DCEBCB" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="url(#sea)" rx="14" />
        <path d={ISLAND} fill="url(#land)" stroke="#A8C99A" strokeWidth="1.5" strokeLinejoin="round" />

        {AREAS.map(a => {
          const { x, y } = project(a.lat, a.lng);
          return (
            <text key={a.name} x={x + 10} y={y - 2} className={styles.area}>
              {a.name}
            </text>
          );
        })}

        {pts.length > 1 && <path d={path} className={styles.route} />}

        {pts.map(p => {
          const label = p.orders.length > 2 ? `${Math.min(...p.orders)}+` : p.orders.join('·');
          const r = label.length > 2 ? 14 : 11;
          return (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r={r} className={p.kind === 'stay' ? styles.dotStay : styles.dot} />
              <text x={p.x} y={p.y + 4} className={styles.dotNum}>{label}</text>
            </g>
          );
        })}
      </svg>
      <ol className={styles.legend}>
        {ordered.map(p => (
          <li key={p.id}>
            <span className={p.kind === 'stay' ? styles.badgeStay : styles.badge}>
              {p.orders.length > 2 ? `${Math.min(...p.orders)}+` : p.orders.join('·')}
            </span>
            {p.labels.slice(0, 2).join(' · ')}
            {p.labels.length > 2 && ` 외 ${p.labels.length - 2}`}
          </li>
        ))}
      </ol>
    </div>
  );
}
