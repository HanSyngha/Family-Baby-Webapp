import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { api, type User, type MediaItem } from '../api';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { useProcessingStatus } from '../hooks/useProcessingStatus';
import { usePinchColumns } from '../hooks/usePinchColumns';
import { usePushNotification } from '../hooks/usePushNotification';
import MediaGrid from '../components/gallery/MediaGrid';
import Lightbox from '../components/gallery/Lightbox';
import UploadModal from '../components/gallery/UploadModal';
import styles from './Gallery.module.css';

interface Props {
  user: User;
}

type SortMode = 'recent' | 'likes' | 'views' | 'favorites';

export default function Gallery({ user }: Props) {
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
  const [shuffledItems, setShuffledItems] = useState<{ id: number; filename: string; type: string }[] | null>(null);
  const initialLoad = useRef(false);

  const loadMore = useCallback(async (cursor?: string | null, sortMode?: SortMode) => {
    const s = sortMode ?? sort;
    const data = await api.getMedia(cursor, s);
    if (cursor) {
      setItems(prev => [...prev, ...data.items]);
    } else {
      setItems(data.items);
    }
    setNextCursor(data.nextCursor);
  }, [sort]);

  const [pollingActive, setPollingActive] = useState(false);
  const processing = useProcessingStatus(pollingActive);

  const handleUploaded = useCallback(() => {
    setPollingActive(true);
    setTimeout(() => loadMore(null, sort), 1500);
  }, [loadMore, sort]);

  const uploadQueue = useUploadQueue(handleUploaded);
  const { columns, bind: bindPinch } = usePinchColumns();
  const { pushState, togglePush } = usePushNotification(true);
  const gridRef = useRef<HTMLElement>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    loadMore().finally(() => setLoading(false));
  }, [loadMore]);

  useEffect(() => {
    return bindPinch(gridRef.current);
  }, [bindPinch]);

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
      if (result.copied > 0) parts.push(`${result.copied}개 복사 완료`);
      if (result.duplicates > 0) parts.push(`${result.duplicates}개 중복`);
      if (result.errors.length > 0) parts.push(`${result.errors.length}개 실패`);
      alert(parts.join(', '));
      exitSelectMode();
    } catch (e: any) {
      alert('복사 실패: ' + (e.message || '알 수 없는 오류'));
    } finally {
      setCopying(false);
    }
  }, [selectedIds, exitSelectMode]);

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

  const months = useMemo(() => {
    if (sort !== 'recent') return [];
    const seen = new Set<string>();
    return items.reduce<string[]>((acc, item) => {
      const m = item.createdAt.slice(0, 7);
      if (!seen.has(m)) { seen.add(m); acc.push(m); }
      return acc;
    }, []);
  }, [items, sort]);

  const scrollToMonth = useCallback((month: string) => {
    document.getElementById(`month-${month}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

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
    const data = await api.getMediaIds();
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
  }, []);

  // 선택한 항목만 무한 반복 재생 (슬라이드쇼는 마지막에서 0으로 되돌아가며 무한 루프)
  const playSelected = useCallback(() => {
    const sel = items.filter(i => selectedIds.has(i.id));
    if (sel.length === 0) return;
    setShuffledItems(sel as any);
    setLightboxIndex(0);
    history.pushState({ modal: 'lightbox' }, '');
    exitSelectMode();
  }, [items, selectedIds, exitSelectMode]);

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
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div className={styles.brand}>
          <div className={styles.brandBlock}>
            <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
            <span className={styles.brandName}>땅콩패밀리</span>
          </div>
          <h1 className={styles.pageTitle}>갤러리</h1>
        </div>
        <div className={styles.headerActions}>
          {!selectMode && items.length > 0 && (
            <button className={styles.iconBtn} onClick={startRandomSlideshow} title="랜덤 재생">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}
          {canShare && !selectMode && (
            <button className={styles.iconBtn} onClick={() => enterSelectMode()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M17.5 14v7M14 17.5h7" />
              </svg>
            </button>
          )}
          {selectMode && (
            <button className={styles.cancelBtn} onClick={exitSelectMode}>취소</button>
          )}
          <button className={styles.uploadBtn} onClick={() => openUpload()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            올리기
          </button>
        </div>
      </div>

      <div className={styles.main} ref={gridRef as React.RefObject<HTMLDivElement>}>
        {/* 앱 설치 배너 */}
        {installPrompt && (
          <div className={styles.banner}>
            <span>땅콩패밀리 앱을 설치해보세요</span>
            <button className={styles.bannerBtn} onClick={() => { installPrompt.prompt(); installPrompt.userChoice.then(() => setInstallPrompt(null)); }}>설치</button>
          </div>
        )}

        {/* 알림 배너 */}
        {pushState === 'off' && (
          <div className={styles.banner}>
            <span>새 사진이 올라오면 알림을 받아보세요</span>
            <button onClick={togglePush} className={styles.bannerBtn}>알림 켜기</button>
          </div>
        )}

        {/* Sort Bar */}
        {!loading && (items.length > 0 || sort !== 'recent') && (
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
        )}

        {/* Month timeline */}
        {months.length > 1 && (
          <div className={styles.monthBar}>
            {months.map(m => (
              <button key={m} className={styles.monthChip} onClick={() => scrollToMonth(m)}>
                {m.slice(2).replace('-', '.')}
              </button>
            ))}
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
            <p>{sort === 'favorites' ? '즐겨찾기한 사진이 없어요' : '아직 사진이 없어요'}</p>
            {sort !== 'favorites' && <button className={styles.emptyBtn} onClick={() => openUpload()}>첫 사진 올리기</button>}
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
            onLongPress={canShare ? enterSelectMode : undefined}
            onLikeToggle={handleLikeToggle}
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
            <button className={styles.copyBtn} onClick={handleCopyToPeanut} disabled={selectedIds.size === 0 || copying}>
              {copying ? '복사 중...' : '땅콩콩땅'}
            </button>
            <button className={styles.shareBtn} onClick={handleShare} disabled={selectedIds.size === 0 || sharing}>
              {sharing ? '공유 중...' : '공유'}
            </button>
          </div>
        </div>
      )}

      {/* Mobile FAB */}
      {!selectMode && (
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
    </div>
  );
}
