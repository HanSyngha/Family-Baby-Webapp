import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { api, type Comment, type MediaItem, type User } from '../../api';
import styles from './ShortsViewer.module.css';

interface Props {
  user: User;
  scope: 'shared' | 'private';
  onClose: () => void;
}

// 현재 영상 앞뒤로 몇 개를 미리 붙여둘지. 1이면 [이전, 현재, 다음] 3개가 동시에 살아 있다.
// 다음 영상이 미리 버퍼링돼 있어야 스와이프 즉시 재생된다(쇼츠/릴스 방식).
const WINDOW = 1;

function formatDate(value: string) {
  return value ? value.slice(0, 10).replaceAll('-', '.') : '';
}

function formatDuration(seconds: number | null) {
  if (!seconds) return '';
  const total = Math.max(0, Math.round(seconds));
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function ShortVideo({ item, active, muted, paused, onEnded, onTime, onTogglePause }: {
  item: MediaItem;
  active: boolean;
  muted: boolean;
  paused: boolean;
  onEnded: () => void;
  onTime?: (current: number, duration: number) => void;
  onTogglePause: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef(active);
  const pausedRef = useRef(paused);
  activeRef.current = active;
  pausedRef.current = paused;

  // 소스 연결은 item이 바뀔 때 한 번만. 활성 여부가 바뀐다고 재마운트하지 않는다
  // (예전 구조는 key={active.id}로 매번 언마운트해서 스와이프마다 버퍼링이 처음부터 다시 돌았다).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let usingFallback = false;
    let cancelled = false;
    const hlsUrl = api.hlsUrl(item.id);
    const fallbackUrl = api.fileUrl(item.id);

    const playIfActive = () => {
      if (!cancelled && activeRef.current && !pausedRef.current) video.play().catch(() => {});
    };
    const useFallback = () => {
      if (usingFallback) return;
      usingFallback = true;
      hls?.destroy();
      hls = null;
      video.src = fallbackUrl;
      video.load();
      video.addEventListener('loadedmetadata', playIfActive, { once: true });
    };

    video.muted = muted;
    video.playsInline = true;
    video.addEventListener('error', useFallback);

    if (Hls.isSupported()) {
      // 앞뒤 영상까지 3개가 동시에 버퍼링하므로 버퍼 상한을 둬서 NAS 대역폭을 아낀다.
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 20 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, playIfActive);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) useFallback();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', playIfActive, { once: true });
    } else {
      video.src = fallbackUrl;
      video.addEventListener('loadedmetadata', playIfActive, { once: true });
    }

    return () => {
      cancelled = true;
      video.removeEventListener('error', useFallback);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [item.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  // 활성 슬라이드만 재생. 벗어난 슬라이드는 정지 + 처음으로 되감아 다시 올 때 새로 시작하게 한다.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active && !paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
      if (!active) video.currentTime = 0;
    }
  }, [active, paused]);

  return (
    <video
      ref={videoRef}
      className={styles.video}
      controls={false}
      loop={false}
      playsInline
      muted={muted}
      preload="auto"
      poster={api.thumbUrl(item.id, item.filename, 640)}
      onEnded={active ? onEnded : undefined}
      onClick={onTogglePause}
      onTimeUpdate={onTime ? (e) => onTime(e.currentTarget.currentTime, e.currentTarget.duration) : undefined}
      onLoadedMetadata={onTime ? (e) => onTime(e.currentTarget.currentTime, e.currentTarget.duration) : undefined}
    />
  );
}

export default function ShortsViewer({ user, scope, onClose }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const loadedCursors = useRef(new Set<string | null>());
  const viewedIds = useRef(new Set<number>());
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);

  const active = items[index] ?? null;
  const title = scope === 'private' ? '내 영상' : '공유 영상';
  const canEdit = active && (active.uploaderId === user.id || user.role === 'master');

  const loadVideos = useCallback(async (cursor: string | null, append: boolean) => {
    if (loadedCursors.current.has(cursor)) return;
    loadedCursors.current.add(cursor);
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const data = await api.getVideoFeed(cursor, scope);
      setItems(prev => append ? [...prev, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
    } catch (err) {
      loadedCursors.current.delete(cursor);
      throw err;
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    loadVideos(null, false).catch(() => setLoading(false));
    return () => { document.body.style.overflow = ''; };
  }, [loadVideos]);

  useEffect(() => {
    if (!active || viewedIds.current.has(active.id)) return;
    viewedIds.current.add(active.id);
    api.recordView(active.id).catch(() => {});
  }, [active?.id]);

  useEffect(() => {
    if (!showComments || !active) return;
    let alive = true;
    setCommentsLoading(true);
    api.getComments(active.id)
      .then(data => { if (alive) setComments(data); })
      .catch(() => { if (alive) setComments([]); })
      .finally(() => { if (alive) setCommentsLoading(false); });
    return () => { alive = false; };
  }, [showComments, active?.id]);

  useEffect(() => {
    if (nextCursor && items.length > 0 && index >= items.length - 3) {
      loadVideos(nextCursor, true).catch(() => {});
    }
  }, [index, items.length, nextCursor, loadVideos]);

  // 화면에 가장 많이 걸친 슬라이드를 현재 영상으로 삼는다.
  // 스크롤 자체는 브라우저의 scroll-snap이 처리하므로 손가락을 그대로 따라오고 관성도 살아 있다.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || items.length === 0) return;

    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = Number((entry.target as HTMLElement).dataset.idx);
        if (!Number.isNaN(idx)) {
          setIndex(prev => {
            if (prev === idx) return prev;
            setProgress({ current: 0, duration: 0 });
            setPaused(false);
            return idx;
          });
        }
      }
    }, { root: track, threshold: 0.6 });

    slideRefs.current.forEach(el => { if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [items.length]);

  const go = useCallback((delta: number) => {
    const target = Math.min(Math.max(index + delta, 0), Math.max(items.length - 1, 0));
    slideRefs.current[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [index, items.length]);

  const handleLike = useCallback(async () => {
    if (!active) return;
    const before = active.liked;
    const beforeCount = active.likeCount;
    setItems(prev => prev.map(item => item.id === active.id
      ? { ...item, liked: !before, likeCount: Math.max(0, beforeCount + (before ? -1 : 1)) }
      : item));
    try {
      const res = await api.toggleLike(active.id);
      setItems(prev => prev.map(item => item.id === active.id
        ? { ...item, liked: res.liked, likeCount: Math.max(0, beforeCount + (res.liked === before ? 0 : res.liked ? 1 : -1)) }
        : item));
    } catch {
      setItems(prev => prev.map(item => item.id === active.id
        ? { ...item, liked: before, likeCount: beforeCount }
        : item));
    }
  }, [active]);

  const handleFavorite = useCallback(async () => {
    if (!active) return;
    const before = active.favorited;
    setItems(prev => prev.map(item => item.id === active.id ? { ...item, favorited: !before } : item));
    try {
      const res = await api.toggleFavorite(active.id);
      setItems(prev => prev.map(item => item.id === active.id ? { ...item, favorited: res.favorited } : item));
    } catch {
      setItems(prev => prev.map(item => item.id === active.id ? { ...item, favorited: before } : item));
    }
  }, [active]);

  const handleAddComment = useCallback(async () => {
    if (!active) return;
    const text = commentText.trim();
    if (!text || commentSending) return;
    setCommentSending(true);
    try {
      const created = await api.addComment(active.id, text);
      setComments(prev => [...prev, created]);
      setCommentText('');
      setItems(prev => prev.map(item => item.id === active.id ? { ...item, commentCount: item.commentCount + 1 } : item));
    } finally {
      setCommentSending(false);
    }
  }, [active, commentSending, commentText]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowDown') go(1);
      if (event.key === 'ArrowUp') go(-1);
      if (event.key === ' ') {
        event.preventDefault();
        setPaused(prev => !prev);
      }
      if (event.key.toLowerCase() === 'm') setMuted(prev => !prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const progressPct = useMemo(() => (
    progress.duration > 0 ? Math.min(100, (progress.current / progress.duration) * 100) : 0
  ), [progress]);

  return (
    <div className={`${styles.root} shorts-viewer-root`}>
      <div className={styles.topBar}>
        <button className={styles.roundBtn} onClick={onClose} aria-label="닫기">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
        <div className={styles.heading}>
          <strong>{title}</strong>
          <span>{items.length ? `${index + 1}/${items.length}${nextCursor ? '+' : ''}` : '0'}</span>
        </div>
        <button className={styles.roundBtn} onClick={() => setMuted(prev => !prev)} aria-label={muted ? '음소거 해제' : '음소거'}>
          {muted ? (
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="m23 9-6 6M17 9l6 6" /></svg>
          ) : (
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>
          )}
        </button>
      </div>

      {loading ? (
        <div className={styles.empty}>영상 불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>볼 수 있는 영상이 없어요</div>
      ) : (
        <div className={styles.track} ref={trackRef}>
          {items.map((item, i) => {
            const near = Math.abs(i - index) <= WINDOW;
            return (
              <section
                key={item.id}
                className={styles.slide}
                data-idx={i}
                ref={el => { slideRefs.current[i] = el; }}
              >
                {near ? (
                  <ShortVideo
                    item={item}
                    active={i === index}
                    muted={muted}
                    paused={paused && i === index}
                    onEnded={() => go(1)}
                    onTime={i === index
                      ? (current, duration) => setProgress({ current, duration: Number.isFinite(duration) ? duration : 0 })
                      : undefined}
                    onTogglePause={() => setPaused(prev => !prev)}
                  />
                ) : (
                  // 창 밖 슬라이드는 포스터만 — 트랙 높이는 유지하되 비디오는 안 만든다
                  <img className={styles.slidePoster} src={api.thumbUrl(item.id, item.filename, 640)} alt="" loading="lazy" decoding="async" />
                )}
                {i === index && paused && (
                  <div className={styles.playBadge}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {active && (
        <>
          <div className={styles.progress} aria-hidden="true"><span style={{ width: `${progressPct}%` }} /></div>
          <aside className={styles.actions}>
            <button className={`${styles.actionBtn} ${active.liked ? styles.activeAction : ''}`} onClick={handleLike} aria-label="좋아요">
              <svg width="24" height="24" viewBox="0 0 24 24" fill={active.liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" /></svg>
              <span>{active.likeCount}</span>
            </button>
            <button className={`${styles.actionBtn} ${active.favorited ? styles.activeAction : ''}`} onClick={handleFavorite} aria-label="즐겨찾기">
              <svg width="24" height="24" viewBox="0 0 24 24" fill={active.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
            </button>
            <button className={styles.actionBtn} onClick={() => setShowComments(true)} aria-label="댓글 보기">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
              <span>{active.commentCount}</span>
            </button>
            <a className={styles.actionBtn} href={api.downloadUrl(active.id)} download aria-label="다운로드">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            </a>
            <button className={styles.actionBtn} onClick={() => setPaused(prev => !prev)} aria-label={paused ? '재생' : '일시정지'}>
              {paused ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg> : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>}
            </button>
          </aside>

          <div className={styles.meta}>
            <div className={styles.uploader}>
              {active.uploaderImage ? <img src={active.uploaderImage} alt="" /> : <span>{active.uploaderName[0]}</span>}
              <strong>{active.uploaderName}</strong>
              {canEdit && <em>관리 가능</em>}
            </div>
            <div className={styles.name}>{active.originalName}</div>
            <div className={styles.stats}>
              <span>{formatDate(active.createdAt)}</span>
              {formatDuration(active.duration) && <span>{formatDuration(active.duration)}</span>}
              <span>조회 {active.viewCount}</span>
              <span>댓글 {active.commentCount}</span>
              {loadingMore && <span>더 불러오는 중</span>}
            </div>
          </div>

          <div className={styles.navHints}>
            <button onClick={() => go(-1)} disabled={index === 0} aria-label="이전 영상">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
            </button>
            <button onClick={() => go(1)} disabled={index >= items.length - 1 && !nextCursor} aria-label="다음 영상">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
        </>
      )}

      {showComments && active && (
        <div className={styles.commentsShade} onClick={() => setShowComments(false)}>
          <section
            className={styles.commentsPanel}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.commentsHeader}>
              <strong>댓글 {active.commentCount}</strong>
              <button onClick={() => setShowComments(false)} aria-label="댓글 닫기">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className={styles.commentsList}>
              {commentsLoading ? (
                <div className={styles.commentEmpty}>댓글 불러오는 중...</div>
              ) : comments.length === 0 ? (
                <div className={styles.commentEmpty}>아직 댓글이 없어요</div>
              ) : comments.map(comment => (
                <div key={comment.id} className={styles.commentItem}>
                  <div className={styles.commentAvatar}>
                    {comment.profileImage ? <img src={comment.profileImage} alt="" /> : <span>{comment.name[0]}</span>}
                  </div>
                  <div className={styles.commentBody}>
                    <div className={styles.commentMeta}>
                      <strong>{comment.name}</strong>
                      <span>{formatDate(comment.createdAt)}</span>
                    </div>
                    <p>{comment.content}</p>
                  </div>
                </div>
              ))}
            </div>
            <form
              className={styles.commentForm}
              onSubmit={(event) => {
                event.preventDefault();
                handleAddComment().catch(() => {});
              }}
            >
              <input
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="댓글 쓰기"
                maxLength={500}
              />
              <button disabled={!commentText.trim() || commentSending}>
                {commentSending ? '...' : '등록'}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
