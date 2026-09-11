import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { api, type MediaItem, type GalleryEvent } from '../../api';
import MediaCard from './MediaCard';
import EventModal from './EventModal';
import styles from './MediaGrid.module.css';

interface Props {
  items: MediaItem[];
  onItemClick: (index: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  sort?: string;
  columns?: number;
  selectMode?: boolean;
  selectedIds?: Set<number>;
  onSelectDay?: (ids: number[], select: boolean) => void;
  onLongPress?: (firstId: number) => void;
  onLikeToggle?: (id: number, liked: boolean) => void;
  isAdmin?: boolean;
  babyBirth?: string | null;
  enableEvents?: boolean;
  sectionPrefix?: string;   // 월 섹션 id 접두사. 탭(스코프)별로 달라 중복 id 방지
  markShared?: boolean;     // 개인탭에서 이미 공유된 사진에 "공유됨" 배지
}

function formatDateHeader(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-');
  return `${y.slice(2)}.${m}.${d}`;
}

// 생일 기준 "태어난지 N일" (D+1 = 생일 당일). 생일 이전이면 null.
function daysSinceBirth(dateKey: string, birth?: string | null): number | null {
  if (!birth) return null;
  const day = Math.floor((new Date(dateKey + 'T00:00:00').getTime() - new Date(birth.slice(0, 10) + 'T00:00:00').getTime()) / 86400000) + 1;
  return day >= 1 ? day : null;
}

function getDateKey(dateStr: string): string {
  return dateStr.slice(0, 10);
}

interface DateGroup {
  dateKey: string;
  label: string;
  items: { item: MediaItem; globalIndex: number }[];
}

export default function MediaGrid({ items, onItemClick, onLoadMore, hasMore, sort, columns, selectMode, selectedIds, onSelectDay, onLongPress, onLikeToggle, isAdmin, babyBirth, enableEvents, sectionPrefix = 'month-', markShared }: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 갤러리 이벤트 자막
  const [events, setEvents] = useState<GalleryEvent[]>([]);
  const [editDate, setEditDate] = useState<string | null>(null);
  const refetchEvents = useCallback(() => { api.getGalleryEvents().then(setEvents).catch(() => {}); }, []);
  useEffect(() => { if (enableEvents) refetchEvents(); }, [refetchEvents, enableEvents]);

  const eventForDate = useCallback(
    (dateKey: string) => events.find(e => dateKey >= e.startDate && dateKey <= e.endDate) ?? null,
    [events]
  );
  const captionFor = (dateKey: string): { text: string; color: string } | null => {
    const e = eventForDate(dateKey);
    if (!e) return null;
    if (e.startDate === e.endDate) return { text: e.title, color: e.color };
    const day = Math.floor((new Date(dateKey + 'T00:00:00').getTime() - new Date(e.startDate + 'T00:00:00').getTime()) / 86400000) + 1;
    return { text: `${e.title} ${day}일차`, color: e.color };
  };

  const pressTimer = useRef<number | null>(null);
  const cancelPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };
  const startPress = (dateKey: string) => { cancelPress(); pressTimer.current = window.setTimeout(() => setEditDate(dateKey), 450); };

  const groups = useMemo(() => {
    const map = new Map<string, DateGroup>();
    items.forEach((item, idx) => {
      const key = getDateKey(item.createdAt);
      if (!map.has(key)) {
        map.set(key, { dateKey: key, label: formatDateHeader(item.createdAt), items: [] });
      }
      map.get(key)!.items.push({ item, globalIndex: idx });
    });
    return Array.from(map.values());
  }, [items]);

  // 월별 점프용: 같은 월의 첫 그룹에만 month id 부여
  const monthFirstKeys = useMemo(() => {
    const seen = new Set<string>();
    const result = new Map<string, string>();
    for (const g of groups) {
      const month = g.dateKey.slice(0, 7);
      if (!seen.has(month)) {
        seen.add(month);
        result.set(g.dateKey, month);
      }
    }
    return result;
  }, [groups]);

  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) loadMoreRef.current();
    }, { rootMargin: '400px' });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, items.length]);

  const gridStyle = columns ? { '--grid-cols': columns } as React.CSSProperties : undefined;

  // srcset이 올바른 해상도를 고르려면 셀이 화면에서 차지하는 실제 너비를 알려줘야 한다.
  // 640px 이상에선 CSS가 !important로 열 수를 고정하므로 그 값을, 그 아래에선 columns를 쓴다.
  const cellSizes = `(min-width:1400px) 20vw, (min-width:1024px) 25vw, (min-width:640px) 33vw, ${Math.round(100 / (columns || 2))}vw`;

  const renderCard = (item: MediaItem, globalIndex: number, animIndex: number) => (
    <MediaCard
      key={item.id}
      item={item}
      index={animIndex}
      onClick={() => onItemClick(globalIndex)}
      selectMode={selectMode}
      selected={selectedIds?.has(item.id)}
      onLongPress={onLongPress ? () => onLongPress(item.id) : undefined}
      onLikeToggle={onLikeToggle}
      sizes={cellSizes}
      markShared={markShared}
    />
  );

  // 좋아요순/조회순/즐겨찾기: 날짜 그룹 없이 flat 그리드
  if (sort && sort !== 'recent') {
    return (
      <div className={styles.container}>
        <div className={styles.grid} style={gridStyle}>
          {items.map((item, idx) => renderCard(item, idx, idx))}
        </div>
      </div>
    );
  }

  // 최신순: 날짜별 그룹
  return (
    <div className={styles.container}>
      {groups.map((group) => {
        const monthId = monthFirstKeys.get(group.dateKey);
        return (
          <section key={group.dateKey} className={styles.section} id={monthId ? `${sectionPrefix}${monthId}` : undefined}>
            <span id={`${sectionPrefix}${group.dateKey}`} aria-hidden="true" style={{ display: 'block', height: 0 }} />
            <div
              className={styles.dateHeader}
              onPointerDown={isAdmin && enableEvents ? () => startPress(group.dateKey) : undefined}
              onPointerUp={isAdmin && enableEvents ? cancelPress : undefined}
              onPointerLeave={isAdmin && enableEvents ? cancelPress : undefined}
              onPointerCancel={isAdmin && enableEvents ? cancelPress : undefined}
            >
              <span className={styles.dateLine} />
              <span className={styles.dateLabel}>{group.label}</span>
              <span className={styles.dateCount}>{group.items.length}장</span>
              {(() => { const d = daysSinceBirth(group.dateKey, babyBirth); return d ? <span className={styles.seolBadge}>👶 {d}일</span> : null; })()}
              {selectMode && (() => {
                const ids = group.items.map(({ item }) => item.id);
                const anySel = ids.some(id => selectedIds?.has(id));
                if (!anySel) return null;
                const allSel = ids.every(id => selectedIds?.has(id));
                return (
                  <button
                    type="button"
                    className={styles.daySelectBtn}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); onSelectDay?.(ids, !allSel); }}
                  >
                    {allSel ? '이 날짜 해제' : '이 날짜 전체'}
                  </button>
                );
              })()}
              <span className={styles.dateLine} />
            </div>
            {enableEvents && (() => {
              const cap = captionFor(group.dateKey);
              return cap ? (
                <div className={styles.eventCaption} style={{ color: cap.color, cursor: isAdmin ? 'pointer' : 'default' }} onClick={isAdmin ? () => setEditDate(group.dateKey) : undefined}>
                  {cap.text}
                </div>
              ) : null;
            })()}
            <div className={styles.grid} style={gridStyle}>
              {group.items.map(({ item, globalIndex }, i) => renderCard(item, globalIndex, i))}
            </div>
          </section>
        );
      })}
      {hasMore && <div ref={sentinelRef} className={styles.sentinel} />}
      {isAdmin && enableEvents && editDate && (
        <EventModal
          date={editDate}
          event={eventForDate(editDate)}
          onSaved={() => { refetchEvents(); setEditDate(null); }}
          onClose={() => setEditDate(null)}
          onShareToPeanut={async (id) => { await api.applyEventToPeanut(id); }}
        />
      )}
    </div>
  );
}
