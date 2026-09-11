import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { api, type User, type MediaItem } from '../api';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { useProcessingStatus } from '../hooks/useProcessingStatus';
import { usePinchColumns } from '../hooks/usePinchColumns';
import { usePushNotification } from '../hooks/usePushNotification';
import MediaGrid from '../components/gallery/MediaGrid';
import Lightbox from '../components/gallery/Lightbox';
import ShortsViewer from '../components/gallery/ShortsViewer';
import UploadModal from '../components/gallery/UploadModal';
import AddToAlbumSheet from '../components/gallery/AddToAlbumSheet';
import ShareSheet from '../components/gallery/ShareSheet';
import DateScrubber from '../components/gallery/DateScrubber';
import type { GalleryEvent } from '../api';
import styles from './Gallery.module.css';

interface Props {
  user: User;
  scope: 'shared' | 'private';
  embedded?: boolean;
  babyBirth?: string | null;
}

type SortMode = 'recent' | 'likes' | 'views' | 'favorites';

const SHORTS_LAUNCH_KEY = 'peanut-family:shorts-launch:v1';

export default function GalleryView({ user, scope, embedded, babyBirth }: Props) {
  const isPrivate = scope === 'private';
  const isMaster = user.role === 'master';
  // 공유/개인 탭이 동시에 마운트(display:none)되므로 월 섹션 id를 스코프별로 고유하게 → 중복 id 방지
  const sectionPrefix = `${scope}-month-`;
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showShorts, setShowShorts] = useState(false);
  const [showShortsLaunch, setShowShortsLaunch] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [sort, setSort] = useState<SortMode>('recent');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAddToAlbum, setShowAddToAlbum] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [events, setEvents] = useState<GalleryEvent[]>([]);
  const [shuffledItems, setShuffledItems] = useState<{ id: number; filename: string; type: string }[] | null>(null);
  const initialLoad = useRef(false);
  const nextCursorRef = useRef<string | null>(null);
  const [allMedia, setAllMedia] = useState<{ id: number; filename: string; type: string; createdAt: string }[]>([]);
  const [jumping, setJumping] = useState(false);

  const loadMore = useCallback(async (cursor?: string | null, sortMode?: SortMode) => {
    const s = sortMode ?? sort;
    const data = await api.getMedia(cursor, s, scope);
    if (cursor) {
      setItems(prev => [...prev, ...data.items]);
    } else {
      setItems(data.items);
    }
    setNextCursor(data.nextCursor);
    nextCursorRef.current = data.nextCursor;
    return data.nextCursor;
  }, [sort, scope]);

  // 전체 미디어 날짜(달) — 날짜 이동 달력이 '아직 안 불러온 과거 달'도 보여주도록
  useEffect(() => {
    let alive = true;
    api.getMediaIds(scope).then(d => { if (alive) setAllMedia(d.items); }).catch(() => {});
    return () => { alive = false; };
  }, [scope]);

  const allMonths = useMemo(() => {
    const set = new Set<string>();
    for (const m of allMedia) { const ym = (m.createdAt || '').slice(0, 7); if (ym) set.add(ym); }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allMedia]);

  const allDays = useMemo(() => {
    const set = new Set<string>();
    for (const m of allMedia) { const d = (m.createdAt || '').slice(0, 10); if (d) set.add(d); }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allMedia]);

  // 특정 날짜로 '바로' 점프: 서버 커서를 그 날짜로 세팅 → 요청 1번으로 그 지점부터 로드.
  // (예전 방식은 지금~그 날짜까지 페이지를 전부 순차 로드해서 옛날일수록 끝없이 걸렸음)
  const jumpToDate = useCallback(async (cursor: string) => {
    setJumping(true);
    try {
      const data = await api.getMedia(cursor, 'recent', scope);
      setItems(data.items);
      setNextCursor(data.nextCursor);
      nextCursorRef.current = data.nextCursor;
      requestAnimationFrame(() => { const el = getScrollEl(); if (el) el.scrollTop = 0; });
    } catch { /* 무시 */ } finally {
      setJumping(false);
    }
    // getScrollEl은 stable(useCallback [])이라 deps 생략
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  // 월: 그 달 끝(YYYY-MM-99)부터 / 일: 그 날 끝(YYYY-MM-DD 99)부터 — createdAt < cursor 문자열 비교
  const jumpToMonth = useCallback((month: string) => jumpToDate(`${month}-99`), [jumpToDate]);
  const jumpToDay = useCallback((day: string) => jumpToDate(`${day} 99`), [jumpToDate]);

  const [pollingActive, setPollingActive] = useState(false);
  const processing = useProcessingStatus(pollingActive);

  const handleUploaded = useCallback(() => {
    setPollingActive(true);
    setTimeout(() => loadMore(null, sort), 1500);
  }, [loadMore, sort]);

  const uploadQueue = useUploadQueue(handleUploaded, isPrivate ? 'private' : undefined);
  const { columns, bind: bindPinch } = usePinchColumns();
  const { pushState, togglePush } = usePushNotification(!isPrivate);
  const gridRef = useRef<HTMLElement>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    if (isPrivate) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [isPrivate]);

  useEffect(() => {
    if (scope !== 'shared') return;
    const key = `${SHORTS_LAUNCH_KEY}:user:${user.id}`;
    try {
      if (localStorage.getItem(key) === 'seen') return;
      localStorage.setItem(key, 'seen');
      setShowShortsLaunch(true);
    } catch {
      setShowShortsLaunch(true);
    }
  }, [scope, user.id]);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    loadMore().finally(() => setLoading(false));
  }, [loadMore]);

  useEffect(() => {
    return bindPinch(gridRef.current);
  }, [bindPinch]);

  // 스크러버 풍선용 이벤트 자막 (땅땅&콩콩 탭에서만)
  useEffect(() => {
    if (scope === 'shared') api.getGalleryEvents().then(setEvents).catch(() => {});
  }, [scope]);

  // 스크롤 컨테이너(AppShell .content) — 그리드의 가장 가까운 스크롤 부모
  const getScrollEl = useCallback((): HTMLElement | null => {
    let el = gridRef.current as HTMLElement | null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return document.scrollingElement as HTMLElement | null;
  }, []);

  useEffect(() => {
    if (processing.justFinished) {
      loadMore(null, sort);
      setPollingActive(false);
    }
  }, [processing.justFinished, loadMore, sort]);

  const handleSortChange = useCallback((newSort: SortMode) => {
    if (newSort === sort) return;
    setSort(newSort);
    setLoading(true);
    loadMore(null, newSort).finally(() => setLoading(false));
  }, [sort, loadMore]);

  const loadingMoreRef = useRef(false);
  const handleLoadMore = useCallback(() => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    loadMore(nextCursor).finally(() => { loadingMoreRef.current = false; });
  }, [nextCursor, loadMore]);

  const handleDelete = useCallback(async (id: number) => {
    await api.deleteMedia(id);
    setItems(prev => prev.filter(i => i.id !== id));
    setAllMedia(prev => prev.filter(m => m.id !== id));
    setShuffledItems(prev => prev ? prev.filter(m => m.id !== id) : prev);
    setLightboxIndex(null);
  }, []);

  const handleLikeToggle = useCallback((id: number, liked: boolean) => {
    setItems(prev =>
      prev.map(item =>
        item.id === id
          ? { ...item, liked, likeCount: item.likeCount + (liked ? 1 : -1) }
          : item
      )
    );
  }, []);

  const handleFavoriteToggle = useCallback((id: number, favorited: boolean) => {
    setItems(prev =>
      prev.map(item =>
        item.id === id ? { ...item, favorited } : item
      )
    );
  }, []);

  const handleDateChange = useCallback((id: number, createdAt: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, createdAt } : item));
  }, []);

  const enterSelectMode = useCallback((firstId?: number) => {
    setSelectMode(true);
    if (firstId) setSelectedIds(new Set([firstId]));
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 한 날짜의 사진 전체 선택/해제
  const selectDay = useCallback((ids: number[], select: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => { if (select) next.add(id); else next.delete(id); });
      return next;
    });
  }, []);

  const handleItemClick = useCallback((index: number) => {
    if (selectMode) {
      toggleSelect(items[index].id);
    } else {
      openLightbox(index);
    }
  }, [selectMode, items]);

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  const handleCopyToPeanut = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setCopying(true);
    try {
      const result = await api.copyToPeanut(Array.from(selectedIds));
      const parts: string[] = [];
      if (result.copied > 0) parts.push(`${result.copied}개 공유 완료`);
      if (result.duplicates > 0) parts.push(`${result.duplicates}개 중복`);
      if (result.errors.length > 0) parts.push(`${result.errors.length}개 실패`);
      alert(parts.join(', '));
      exitSelectMode();
    } catch (e: any) {
      alert('공유 실패: ' + (e.message || '알 수 없는 오류'));
    } finally {
      setCopying(false);
    }
  }, [selectedIds, exitSelectMode]);

  // 공유 완료: 새 모델에선 공유해도 내 개인공간(uploaderId)에 그대로 남는다.
  // 제거하지 말고 in-place로 shared 표시만(서버 상태와 일치 + 새로고침 시 안 사라짐).
  const handleShareDone = useCallback((movedIds: number[]) => {
    setItems(prev => prev.map(i => movedIds.includes(i.id) ? { ...i, visibility: 'shared' as const, ownerId: null } : i));
    setShowShareSheet(false);
    exitSelectMode();
  }, [exitSelectMode]);

  // 공유 취소: 다시 나만 보게(땅땅&콩콩·여행·땅콩땅콩에서 모두 내림)
  const handleUnshare = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`${ids.length}장을 공유 취소할까요?\n땅땅&콩콩·여행·땅콩땅콩에서 내려가고 나만 보게 됩니다.`)) return;
    await api.unshare(ids);
    setItems(prev => prev.map(i => ids.includes(i.id) ? { ...i, visibility: 'private' as const, ownerId: user.id, inTrip: false, inPeanut: false } : i));
    exitSelectMode();
  }, [selectedIds, exitSelectMode, user.id]);

  // 공유 갤러리 → 여행에 추가 완료: 항목은 그대로 유지(공유 상태 변화 없음)
  const handleAddedToTrip = useCallback(() => {
    setShowAddToAlbum(false);
    exitSelectMode();
  }, [exitSelectMode]);

  const handleShare = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setSharing(true);
    try {
      const files = await Promise.all(
        Array.from(selectedIds).map(async (id) => {
          const item = items.find(i => i.id === id)!;
          const res = await fetch(api.fileUrl(id, item.filename), { credentials: 'include' });
          const blob = await res.blob();
          return new File([blob], item.originalName, { type: item.mimeType });
        })
      );
      await navigator.share({ files } as any);
      Array.from(selectedIds).forEach(id => api.recordShare(id).catch(() => {}));
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error('Share failed:', e);
    } finally {
      setSharing(false);
    }
  }, [selectedIds, items]);


  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
    history.pushState({ modal: 'lightbox' }, '');
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
    setShuffledItems(null);
    if (history.state?.modal === 'lightbox') history.back();
  }, []);

  const startRandomSlideshow = useCallback(async () => {
    const arr = allMedia.length ? allMedia.slice() : (await api.getMediaIds(scope)).items;
    if (arr.length === 0) return;
    for (let round = 0; round < 3; round++) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    setShuffledItems(arr);
    setLightboxIndex(0);
    history.pushState({ modal: 'lightbox' }, '');
  }, [scope, allMedia]);

  const playSelected = useCallback(() => {
    const sel = items.filter(i => selectedIds.has(i.id));
    if (sel.length === 0) return;
    setShuffledItems(sel as any);
    setLightboxIndex(0);
    history.pushState({ modal: 'lightbox' }, '');
    exitSelectMode();
  }, [items, selectedIds, exitSelectMode]);

  const downloadSelected = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    ids.forEach((id, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = api.downloadUrl(id);
        a.setAttribute('download', '');
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 500);
    });
  }, [selectedIds]);

  // 선택 항목 일괄 삭제. 삭제분은 서버에서 묘비(hash) 기록 → 폰 자동백업이 다시 안 올림(수동 업로드는 가능).
  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}장을 삭제할까요?\n되돌릴 수 없어요. (삭제분은 자동 백업으로 다시 올라오지 않습니다)`)) return;
    setDeleting(true);
    const results = await Promise.allSettled(ids.map(id => api.deleteMedia(id)));
    const okIds = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'));
    const failed = ids.length - okIds.size;
    setItems(prev => prev.filter(i => !okIds.has(i.id)));
    // 스크러버 달력/랜덤 슬라이드쇼가 삭제된 사진을 계속 보여주지 않게 보조 목록도 정리.
    setAllMedia(prev => prev.filter(m => !okIds.has(m.id)));
    setShuffledItems(prev => prev ? prev.filter(m => !okIds.has(m.id)) : prev);
    setDeleting(false);
    exitSelectMode();
    if (failed > 0) alert(`${failed}장 삭제에 실패했어요.`);
  }, [selectedIds, exitSelectMode]);

  const openUpload = useCallback(() => {
    setShowUpload(true);
    history.pushState({ modal: 'upload' }, '');
  }, []);

  const closeUpload = useCallback(() => {
    setShowUpload(false);
    if (history.state?.modal === 'upload') history.back();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setLightboxIndex(null);
      setShowUpload(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div className={styles.layout}>
      <div className={styles.main} ref={gridRef as React.RefObject<HTMLDivElement>}>
        {/* 개인 공간 안내 */}
        {isPrivate && (
          <div className={styles.privateHint}>
            📥 여기에 올린 뒤, 선택해서 <b>땅땅&콩콩 · 여행 · 땅콩땅콩</b>에 공유하세요!
          </div>
        )}

        {/* 앱 설치 배너 */}
        {installPrompt && (
          <div className={styles.banner}>
            <span>땅콩패밀리 앱을 설치해보세요</span>
            <button className={styles.bannerBtn} onClick={() => { installPrompt.prompt(); installPrompt.userChoice.then(() => setInstallPrompt(null)); }}>설치</button>
          </div>
        )}

        {/* 알림 배너 */}
        {!isPrivate && pushState === 'off' && (
          <div className={styles.banner}>
            <span>새 사진이 올라오면 알림을 받아보세요</span>
            <button onClick={togglePush} className={styles.bannerBtn}>알림 켜기</button>
          </div>
        )}

        {showShortsLaunch && (
          <div className={styles.shortsLaunchBanner}>
            <div>
              <strong>신규 기능론칭! (땅땅쇼츠)</strong>
              <span>영상만 쇼츠처럼 넘겨볼 수 있어요.</span>
            </div>
            <div className={styles.shortsLaunchActions}>
              <button
                onClick={() => {
                  setShowShortsLaunch(false);
                  setShowShorts(true);
                }}
              >
                보기
              </button>
              <button className={styles.shortsLaunchClose} onClick={() => setShowShortsLaunch(false)} aria-label="런칭 안내 닫기">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* 툴바: 정렬(왼쪽) + 액션 아이콘(오른쪽) — 한 줄로 */}
        {!loading && (items.length > 0 || sort !== 'recent') && (
          <div className={styles.toolbar}>
            <div className={styles.sortBar}>
              {(['recent', 'likes', 'views', 'favorites'] as SortMode[]).map(s => (
                <button
                  key={s}
                  className={`${styles.sortBtn} ${sort === s ? styles.sortActive : ''}`}
                  onClick={() => handleSortChange(s)}
                >
                  {s === 'recent' && '최신'}
                  {s === 'likes' && '좋아요'}
                  {s === 'views' && '조회'}
                  {s === 'favorites' && '즐겨찾기'}
                </button>
              ))}
            </div>
            <div className={styles.toolbarIcons}>
              {!selectMode && items.length > 0 && (
                <button
                  className={`${styles.iconBtn} ${showShortsLaunch ? styles.shortsLaunchBtn : ''}`}
                  onClick={() => {
                    setShowShortsLaunch(false);
                    setShowShorts(true);
                  }}
                  aria-label="영상 쇼츠"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m10 9 5 3-5 3V9z" fill="currentColor" stroke="none" /></svg>
                </button>
              )}
              {!selectMode && items.length > 0 && (
                <button className={styles.iconBtn} onClick={startRandomSlideshow} aria-label="랜덤 재생">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                </button>
              )}
              {!selectMode && (
                <button className={styles.iconBtn} onClick={() => enterSelectMode()} aria-label="선택">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M17.5 14v7M14 17.5h7" /></svg>
                </button>
              )}
              {selectMode && (
                <button className={styles.cancelBtn} onClick={exitSelectMode}>취소</button>
              )}
            </div>
          </div>
        )}

        {/* 빠른 날짜 이동: 사이드 스크러버 + 캘린더 (가로 monthBar 대체) */}
        {sort === 'recent' && items.length > 0 && (
          <DateScrubber
            items={items}
            events={scope === 'shared' ? events : undefined}
            babyBirth={isPrivate ? null : babyBirth}
            getScrollEl={getScrollEl}
            hasMore={!!nextCursor}
            allMonths={allMonths}
            onJumpToMonth={jumpToMonth}
            allDays={allDays}
            onJumpToDay={jumpToDay}
            sectionPrefix={sectionPrefix}
          />
        )}
        {jumping && (
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1100, background: 'var(--color-text, #1c1c1e)', color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 700, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
            과거 사진 불러오는 중…
          </div>
        )}

        {/* Processing banner */}
        {processing.isProcessing && (
          <div className={styles.processingBanner}>
            <div className={styles.spinner} />
            <span>
              {processing.current
                ? `'${processing.current.originalName}' 처리 중...`
                : '처리 대기 중...'}
              {processing.queueCount > 0 && ` (대기 ${processing.queueCount}개)`}
            </span>
          </div>
        )}

        {/* Error banners */}
        {processing.recentErrors.map(err => (
          <div key={err.filename} className={styles.errorBanner}>
            <span>'{err.originalName}' 처리 실패</span>
            <button className={styles.errorDismiss} onClick={() => processing.dismissError(err.filename)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {/* Grid */}
        {loading ? (
          <div className={styles.empty}>불러오는 중...</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <p>{isPrivate ? '내가 올린 사진이 없어요' : sort === 'favorites' ? '즐겨찾기한 사진이 없어요' : '아직 공유된 사진이 없어요'}</p>
            {isPrivate && sort !== 'favorites' && <button className={styles.emptyBtn} onClick={() => openUpload()}>사진 올리기</button>}
          </div>
        ) : (
          <MediaGrid
            items={items}
            onItemClick={handleItemClick}
            onLoadMore={handleLoadMore}
            hasMore={!!nextCursor}
            sort={sort}
            columns={columns}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onSelectDay={selectDay}
            onLongPress={enterSelectMode}
            onLikeToggle={handleLikeToggle}
            isAdmin={user.role === 'master'}
            babyBirth={isPrivate ? null : babyBirth}
            enableEvents={scope === 'shared'}
            sectionPrefix={sectionPrefix}
            markShared={isPrivate}
          />
        )}
      </div>

      {/* Select bar */}
      {selectMode && (
        <div className={styles.selectBar}>
          <span className={styles.selectCount}>{selectedIds.size}개 선택됨</span>
          <div className={styles.selectActions}>
            <button className={styles.playBtn} onClick={playSelected} disabled={selectedIds.size === 0} title="선택 항목 반복재생">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              재생
            </button>
            <button className={styles.downloadBtn} onClick={downloadSelected} disabled={selectedIds.size === 0} title="선택 항목 다운로드">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
              저장
            </button>
            {canShare && (
              <button className={styles.shareBtn} onClick={handleShare} disabled={selectedIds.size === 0 || sharing}>
                {sharing ? '내보내는 중...' : '외부 공유'}
              </button>
            )}
            {/* 개인: 체크박스로 한설/여행/땅콩땅콩 공유 */}
            {isPrivate && (
              <button className={styles.copyBtn} onClick={() => setShowShareSheet(true)} disabled={selectedIds.size === 0}>
                공유하기
              </button>
            )}
            {isPrivate && (
              <button className={styles.copyBtn} onClick={handleUnshare} disabled={selectedIds.size === 0}>
                공유 취소
              </button>
            )}
            {/* 공유 갤러리(땅땅&콩콩): 관리자만 여행 추가 / 땅콩땅콩 게시 */}
            {!isPrivate && isMaster && (
              <button className={styles.shareBtn} onClick={() => setShowAddToAlbum(true)} disabled={selectedIds.size === 0}>
                여행에 추가
              </button>
            )}
            {!isPrivate && isMaster && (
              <button className={styles.copyBtn} onClick={handleCopyToPeanut} disabled={selectedIds.size === 0 || copying}>
                {copying ? '공유 중...' : '땅콩콩땅'}
              </button>
            )}
            {/* 일괄 삭제 — 개인공간(항상) + 공유는 master만 */}
            {(isPrivate || isMaster) && (
              <button className={styles.deleteSelBtn} onClick={deleteSelected} disabled={selectedIds.size === 0 || deleting}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                {deleting ? '삭제 중...' : '삭제'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mobile FAB — 개인 공간(비밀) + master는 땅땅&콩콩(공유)에도 업로드.
          공유 화면 업로드는 visibility=shared로 올라가 땅땅&콩콩 + 올린 master 개인공간 둘 다에 들어감(#4) */}
      {!selectMode && (isPrivate || isMaster) && (
        <button className={styles.fab} onClick={() => openUpload()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      {/* Upload toast */}
      {!showUpload && uploadQueue.activeCount > 0 && (
        <div className={styles.uploadToast} onClick={() => openUpload()}>
          <div className={styles.toastSpinner} />
          <span>{uploadQueue.doneCount}/{uploadQueue.totalCount} 업로드 중...</span>
          {uploadQueue.currentFile && (
            <div className={styles.toastProgress}>
              <div className={styles.toastProgressFill} style={{ width: `${uploadQueue.currentFile.progress}%` }} />
            </div>
          )}
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          items={(shuffledItems as any) ?? items}
          index={lightboxIndex}
          user={user}
          onClose={closeLightbox}
          onNavigate={setLightboxIndex}
          onDelete={handleDelete}
          onLikeToggle={handleLikeToggle}
          onFavoriteToggle={handleFavoriteToggle}
          onDateChange={handleDateChange}
          initialSlideshow={!!shuffledItems}
          hasMore={!shuffledItems && !!nextCursor}
          onLoadMore={handleLoadMore}
        />
      )}

      {showShorts && (
        <ShortsViewer
          user={user}
          scope={scope}
          onClose={() => setShowShorts(false)}
        />
      )}

      {showUpload && (
        <UploadModal
          uploadQueue={uploadQueue}
          onClose={closeUpload}
        />
      )}

      {/* 개인 → 한설/여행/땅콩땅콩 체크박스 공유 */}
      {showShareSheet && (
        <ShareSheet
          mediaIds={Array.from(selectedIds)}
          onClose={() => setShowShareSheet(false)}
          onDone={handleShareDone}
        />
      )}

      {/* 공유 갤러리 → 여행에 추가 */}
      {showAddToAlbum && (
        <AddToAlbumSheet
          mode="add"
          mediaIds={Array.from(selectedIds)}
          onClose={() => setShowAddToAlbum(false)}
          onDone={handleAddedToTrip}
        />
      )}
    </div>
  );
}
