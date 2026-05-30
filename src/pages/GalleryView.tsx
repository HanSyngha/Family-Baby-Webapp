import { useState, useCallback, useEffect, useRef } from 'react';
import { api, type User, type MediaItem } from '../api';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { useProcessingStatus } from '../hooks/useProcessingStatus';
import { usePinchColumns } from '../hooks/usePinchColumns';
import { usePushNotification } from '../hooks/usePushNotification';
import MediaGrid from '../components/gallery/MediaGrid';
import Lightbox from '../components/gallery/Lightbox';
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

export default function GalleryView({ user, scope, embedded, babyBirth }: Props) {
  const isPrivate = scope === 'private';
  const isMaster = user.role === 'master';
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [sort, setSort] = useState<SortMode>('recent');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [showAddToAlbum, setShowAddToAlbum] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [events, setEvents] = useState<GalleryEvent[]>([]);
  const [shuffledItems, setShuffledItems] = useState<{ id: number; filename: string; type: string }[] | null>(null);
  const initialLoad = useRef(false);

  const loadMore = useCallback(async (cursor?: string | null, sortMode?: SortMode) => {
    const s = sortMode ?? sort;
    const data = await api.getMedia(cursor, s, scope);
    if (cursor) {
      setItems(prev => [...prev, ...data.items]);
    } else {
      setItems(data.items);
    }
    setNextCursor(data.nextCursor);
  }, [sort, scope]);

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

  const handleLoadMore = useCallback(() => {
    if (nextCursor) loadMore(nextCursor);
  }, [nextCursor, loadMore]);

  const handleDelete = useCallback(async (id: number) => {
    await api.deleteMedia(id);
    setItems(prev => prev.filter(i => i.id !== id));
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

  // 개인 → 공유 완료: 공유된 항목은 개인 뷰에서 제거(이제 공유 갤러리 소속)
  const handleShareDone = useCallback((movedIds: number[]) => {
    setItems(prev => prev.filter(i => !movedIds.includes(i.id)));
    setShowShareSheet(false);
    exitSelectMode();
  }, [exitSelectMode]);

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
    const data = await api.getMediaIds(scope);
    const arr = data.items;
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
  }, [scope]);

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
          />
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
            <p>{isPrivate ? '개인 사진이 없어요' : sort === 'favorites' ? '즐겨찾기한 사진이 없어요' : '아직 공유된 사진이 없어요'}</p>
            {isPrivate && sort !== 'favorites' && <button className={styles.emptyBtn} onClick={() => openUpload()}>개인 사진 올리기</button>}
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
            onLongPress={enterSelectMode}
            onLikeToggle={handleLikeToggle}
            isAdmin={user.role === 'master'}
            babyBirth={isPrivate ? null : babyBirth}
            enableEvents={scope === 'shared'}
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
          </div>
        </div>
      )}

      {/* Mobile FAB — 업로드는 개인 공간만 */}
      {!selectMode && isPrivate && (
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
