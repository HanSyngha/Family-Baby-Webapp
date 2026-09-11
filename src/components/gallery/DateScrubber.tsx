import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { MediaItem, GalleryEvent } from '../../api';
import styles from './DateScrubber.module.css';

interface Props {
  items: MediaItem[];
  events?: GalleryEvent[];          // 이벤트 자막(서브타이틀) — 풍선 우선 표시
  babyBirth?: string | null;        // 생일 → "설이 N일" 라벨 (이게 있으면 일 목록에 설이 표시)
  getScrollEl: () => HTMLElement | null; // 스크롤 컨테이너(AppShell .content)
  sectionPrefix?: string;           // 섹션 id 접두사 (기본 'month-')
  hasMore?: boolean;                // 더 로드할 게 있으면 스크러버 항상 표시
  allMonths?: string[];             // 전체 미디어의 달 목록(아직 안 불러온 과거 달 포함) — 달력 표시용
  onJumpToMonth?: (m: string) => void; // 달 선택 시(미로드면 로드 후 점프)
  allDays?: string[];               // 전체 미디어의 일 목록(YYYY-MM-DD, desc) — 일 선택용
  onJumpToDay?: (d: string) => void;   // 특정 일 선택 시(미로드면 로드 후 점프)
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
function ymLabel(dateKey: string) { return dateKey.slice(2, 7).replace('-', '.'); } // 24.08
function ymdLabel(dateKey: string) { return dateKey.slice(2).replace(/-/g, '.'); }  // 24.08.15

export default function DateScrubber({ items, events, babyBirth, getScrollEl, sectionPrefix = 'month-', hasMore, allMonths, onJumpToMonth, allDays, onJumpToDay }: Props) {
  const [dragging, setDragging] = useState(false);
  const [bubble, setBubble] = useState<{ y: number; text: string } | null>(null);
  const [showCal, setShowCal] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);   // 드래그 판정은 ref로(상태 클로저 타이밍 때문에 첫 move가 누락됨)

  // 날짜 그룹 + 각 그룹의 스크롤 위치 매핑은 실시간 계산(레이아웃 변동 대응)
  const months = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const it of items) { const m = (it.createdAt || '').slice(0, 7); if (m && !seen.has(m)) { seen.add(m); out.push(m); } }
    return out;
  }, [items]);

  // 달력에 표시할 달: 전체 달(미로드 포함)이 있으면 그걸, 없으면 로드된 달
  const calendarMonths = useMemo(
    () => (allMonths && allMonths.length ? allMonths : months),
    [allMonths, months]
  );

  // 일(day) 라벨 두 조각: 설이 N일(생일 있을 때) + 이벤트 자막(subtitle)
  const dayLabelParts = useCallback((dateKey: string): { seol: string | null; subtitle: string | null } => {
    let subtitle: string | null = null;
    if (events && events.length) {
      const e = events.find(ev => dateKey >= ev.startDate && dateKey <= ev.endDate);
      if (e) {
        if (e.startDate === e.endDate) subtitle = e.title;
        else {
          const day = Math.floor((new Date(dateKey + 'T00:00:00').getTime() - new Date(e.startDate + 'T00:00:00').getTime()) / 86400000) + 1;
          subtitle = `${e.title} ${day}일차`;
        }
      }
    }
    let seol: string | null = null;
    if (babyBirth) {
      const d = Math.floor((new Date(dateKey + 'T00:00:00').getTime() - new Date(babyBirth.slice(0, 10) + 'T00:00:00').getTime()) / 86400000) + 1;
      if (d >= 1) seol = `설이 ${d}일`;
    }
    return { seol, subtitle };
  }, [events, babyBirth]);

  // dateKey(YYYY-MM-DD 또는 YYYY-MM)에 해당하는 풍선 라벨: 이벤트 자막 우선
  const labelFor = useCallback((dateKey: string): string => {
    const { seol, subtitle } = dayLabelParts(dateKey);
    if (subtitle) return subtitle;
    if (seol) return `${ymLabel(dateKey)} · ${seol.replace('설이 ', '')}`;
    return dateKey.length > 7 ? ymdLabel(dateKey) : ymLabel(dateKey);
  }, [dayLabelParts]);

  // 현재 스크롤 비율 → 보이는 첫 섹션의 dateKey 추정
  const dateKeyAtScroll = useCallback((el: HTMLElement): string => {
    const top = el.scrollTop;
    let best = ''; let bestTop = -Infinity;
    for (const m of months) {
      const sec = document.getElementById(sectionPrefix + m);
      if (!sec) continue;
      const offset = (sec as HTMLElement).offsetTop;
      if (offset <= top + 4 && offset > bestTop) { bestTop = offset; best = m; }
    }
    return best || months[0] || '';
  }, [months, sectionPrefix]);

  // 트랙 위 y비율 → 스크롤 위치로 점프
  const scrubTo = useCallback((clientY: number) => {
    const el = getScrollEl(); const track = trackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const target = ratio * (el.scrollHeight - el.clientHeight);
    el.scrollTop = target;
    // 풍선 위치 + 라벨
    const dk = dateKeyAtScroll(el);
    setBubble({ y: clientY - rect.top, text: dk ? labelFor(dk) : '' });
  }, [getScrollEl, dateKeyAtScroll, labelFor]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    trackRef.current?.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    scrubTo(e.clientY);
  }, [scrubTo]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const y = e.clientY;
    rafRef.current = requestAnimationFrame(() => scrubTo(y));
  }, [scrubTo]);
  const onPointerUp = useCallback(() => { draggingRef.current = false; setDragging(false); setTimeout(() => setBubble(null), 600); }, []);

  const jumpToMonth = useCallback((m: string) => {
    setShowCal(false);
    if (onJumpToMonth) { onJumpToMonth(m); return; }   // 미로드 달이면 로드 후 점프
    document.getElementById(sectionPrefix + m)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sectionPrefix, onJumpToMonth]);

  const jumpToDay = useCallback((d: string) => {
    setShowCal(false);
    if (onJumpToDay) { onJumpToDay(d); return; }        // 미로드 일이면 로드 후 점프
    document.getElementById(sectionPrefix + d)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sectionPrefix, onJumpToDay]);

  // 콘텐츠가 화면보다 길어 실제 스크롤이 생기는지 추적 (월이 1개여도 표시)
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = getScrollEl();
      setScrollable(!!el && el.scrollHeight > el.clientHeight + 200);
    };
    check();
    const t = setTimeout(check, 300);
    return () => clearTimeout(t);
  }, [items.length, getScrollEl]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // 월이 2개 이상이거나, 더 불러올 게 있거나, 스크롤이 실제로 생기면 표시
  if (calendarMonths.length < 2 && !hasMore && !scrollable) return null;

  return (
    <>
      {/* 우측 사이드 스크러버 */}
      <div
        ref={trackRef}
        className={`${styles.track} ${dragging ? styles.dragging : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className={styles.handle} aria-label="빠른 날짜 이동">
          <span /><span /><span />
        </div>
      </div>

      {bubble && (
        <div className={styles.bubble} style={{ top: bubble.y }}>{bubble.text}</div>
      )}

      {/* 캘린더 버튼 */}
      <button className={styles.calBtn} onClick={() => setShowCal(true)} aria-label="달력으로 이동">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {showCal && (
        <MonthCalendar
          months={calendarMonths}
          allDays={allDays ?? []}
          labelParts={dayLabelParts}
          onPickMonth={jumpToMonth}
          onPickDay={jumpToDay}
          onClose={() => setShowCal(false)}
        />
      )}
    </>
  );
}

// 월 그리드 → 월 선택 시 일(day) 목록으로 드릴다운. 미디어 있는 월/일만 활성.
function MonthCalendar({ months, allDays, labelParts, onPickMonth, onPickDay, onClose }: {
  months: string[];
  allDays: string[];
  labelParts: (dateKey: string) => { seol: string | null; subtitle: string | null };
  onPickMonth: (m: string) => void;
  onPickDay: (d: string) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);   // 선택된 월(YYYY-MM)
  const available = new Set(months);
  const years = useMemo(() => {
    const ys = new Set<number>(); months.forEach(m => ys.add(parseInt(m.slice(0, 4))));
    return Array.from(ys).sort((a, b) => b - a);
  }, [months]);

  // 선택된 월의 일자들 (최신순)
  const daysOfMonth = useMemo(
    () => (expanded ? allDays.filter(d => d.slice(0, 7) === expanded) : []),
    [expanded, allDays]
  );

  // 월 탭: 그 달의 일 데이터가 있으면 일 목록으로, 없으면 바로 월 점프
  const onMonthTap = (key: string) => {
    if (allDays.some(d => d.slice(0, 7) === key)) setExpanded(key);
    else { onPickMonth(key); }
  };

  return (
    <div className={styles.calBackdrop} onClick={onClose}>
      <div className={styles.calSheet} onClick={e => e.stopPropagation()}>
        <div className={styles.calHandle} />

        {!expanded ? (
          <>
            <div className={styles.calTitle}>날짜로 이동</div>
            <div className={styles.calScroll}>
              {years.map(y => (
                <div key={y} className={styles.calYear}>
                  <div className={styles.calYearLabel}>{y}</div>
                  <div className={styles.calMonths}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(mo => {
                      const key = `${y}-${String(mo).padStart(2, '0')}`;
                      const has = available.has(key);
                      return (
                        <button key={mo} disabled={!has}
                          className={`${styles.calMonth} ${has ? styles.calMonthOn : ''}`}
                          onClick={() => has && onMonthTap(key)}>
                          {mo}월
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className={styles.calDayHead}>
              <button className={styles.calBackBtn} onClick={() => setExpanded(null)} aria-label="월 선택으로">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                <span>{expanded.slice(0, 4)}년 {parseInt(expanded.slice(5, 7))}월</span>
              </button>
              <button className={styles.calMonthAll} onClick={() => onPickMonth(expanded)}>이 달 처음으로</button>
            </div>
            <div className={styles.calDayScroll}>
              {daysOfMonth.map(d => {
                const { seol, subtitle } = labelParts(d);
                const wd = WD[new Date(d + 'T00:00:00').getDay()];
                const dow = new Date(d + 'T00:00:00').getDay();
                return (
                  <button key={d} className={styles.calDayRow} onClick={() => onPickDay(d)}>
                    <span className={styles.calDayDate}>
                      <span className={styles.calDayNum}>{parseInt(d.slice(8, 10))}</span>
                      <span className={styles.calDayWd} style={dow === 0 ? { color: '#e5484d' } : dow === 6 ? { color: '#3b82f6' } : undefined}>{wd}</span>
                    </span>
                    <span className={styles.calDayLabels}>
                      {seol && <span className={styles.calSeol}>{seol}</span>}
                      {subtitle && <span className={styles.calSub}>{subtitle}</span>}
                      {!seol && !subtitle && <span className={styles.calDayPlain}>{d.slice(5).replace('-', '.')}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <button className={styles.calClose} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
