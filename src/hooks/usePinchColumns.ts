import { useState, useRef, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'grid-columns';
const MIN_COLS = 2;
const MAX_COLS = 5;

function getInitial(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = Number(v);
      if (n >= MIN_COLS && n <= MAX_COLS) return n;
    }
  } catch {}
  return 2;
}

/**
 * 두 손가락 핀치로 그리드 컬럼 수 조절 (모바일만).
 * pinch-in → 컬럼 증가 (썸네일 작아짐), pinch-out → 컬럼 감소 (썸네일 커짐).
 * ref를 터치 이벤트 바인딩 대상 엘리먼트에 연결.
 */
export function usePinchColumns() {
  const [columns, setColumns] = useState(getInitial);
  const startDist = useRef(0);
  const startCols = useRef(columns);
  const pinching = useRef(false);

  // persist
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(columns)); } catch {}
  }, [columns]);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    startDist.current = Math.hypot(dx, dy);
    startCols.current = columns;
    pinching.current = true;
  }, [columns]);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!pinching.current || e.touches.length !== 2) return;
    e.preventDefault(); // 브라우저 핀치줌 방지
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const ratio = dist / startDist.current;
    // pinch-out(벌림) → 컬럼 감소, pinch-in(오므림) → 컬럼 증가
    const delta = Math.round((1 - ratio) * 3);
    const next = Math.max(MIN_COLS, Math.min(MAX_COLS, startCols.current + delta));
    setColumns(next);
  }, []);

  const onTouchEnd = useCallback(() => {
    pinching.current = false;
  }, []);

  const bind = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  return { columns, bind };
}
