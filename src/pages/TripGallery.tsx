import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api, type User, type Album, type MediaItem, type TripPlace } from '../api';
import { usePinchColumns } from '../hooks/usePinchColumns';
import MediaGrid from '../components/gallery/MediaGrid';
import Lightbox from '../components/gallery/Lightbox';
import UploadModal from '../components/gallery/UploadModal';
import { useUploadQueue } from '../hooks/useUploadQueue';
import styles from './TripGallery.module.css';
import Icon, { type IconName } from '../components/ui/Icon';

interface Props {
  user: User;
  babyBirth?: string | null;
}

export default function TripGallery({ user }: Props) {
  const isMaster = user.role === 'master';
  const [trips, setTrips] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    api.getAlbums('trip').then(d => setTrips(d.items)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { refetch(); }, [refetch]);

  if (detailId !== null) {
    return <TripDetail tripId={detailId} user={user} onBack={() => { setDetailId(null); refetch(); }} onDeleted={() => { setDetailId(null); refetch(); }} />;
  }

  return (
    <div className={styles.list}>
      {isMaster && <NewTripRow onCreated={refetch} />}

      {loading ? (
        <div className={styles.loading}>불러오는 중...</div>
      ) : trips.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIllust}><Icon name="plane" size={34} /></div>
          <p>아직 여행이 없어요</p>
          <span className={styles.emptyHint}>{isMaster ? '위에서 새 여행을 만들어보세요' : '여행이 추가되면 여기에 표시돼요'}</span>
        </div>
      ) : (
        <div className={styles.cards}>
          {trips.map(t => (
            <button key={t.id} className={styles.card} onClick={() => setDetailId(t.id)}>
              <div className={styles.cover} style={{ background: t.color || '#E8943A' }}>
                {t.coverId ? (
                  <img src={api.thumbUrl(t.coverId)} alt="" className={styles.coverImg} loading="lazy" />
                ) : (
                  <span className={styles.coverEmpty}><Icon name="plane" size={22} /></span>
                )}
                <div className={styles.coverOverlay}>
                  <span className={styles.cardTitle}>{t.title}</span>
                  <span className={styles.cardMeta}>{formatPeriod(t)}</span>
                </div>
                <span className={styles.cardBadge}>{t.itemCount ?? 0}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPeriod(t: Album): string {
  if (!t.startDate) return '사진 없음';
  const s = t.startDate.slice(2).replace(/-/g, '.');
  if (!t.endDate || t.endDate === t.startDate) return s;
  const e = t.endDate.slice(2).replace(/-/g, '.');
  const nights = Math.round((new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / 86400000);
  return `${s}–${e.slice(6)} · ${nights}박${nights + 1}일`;
}

function NewTripRow({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try { await api.createAlbum(title.trim()); setTitle(''); setOpen(false); onCreated(); }
    catch (e: any) { alert('실패: ' + (e.message || '오류')); }
    finally { setBusy(false); }
  };

  if (!open) {
    return <button className={styles.newBtn} onClick={() => setOpen(true)}>＋ 새 여행 만들기</button>;
  }
  return (
    <div className={styles.newRow}>
      <input ref={inputRef} className={styles.newInput} value={title} maxLength={40}
        onChange={e => setTitle(e.target.value)} placeholder="여행 이름 (예: 제주 가족여행)"
        onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setOpen(false); }} />
      <button className={styles.newConfirm} onClick={create} disabled={busy || !title.trim()}>만들기</button>
      <button className={styles.newCancel} onClick={() => { setOpen(false); setTitle(''); }}>취소</button>
    </div>
  );
}

function hhmm(s?: string | null): string {
  if (!s) return '';
  const t = s.includes('T') ? s.split('T')[1] : s.split(' ')[1];
  return t ? t.slice(0, 5) : '';
}

function TripDetail({ tripId, user, onBack, onDeleted }: { tripId: number; user: User; onBack: () => void; onDeleted: () => void }) {
  const isMaster = user.role === 'master';
  const [album, setAlbum] = useState<Album | null>(null);
  const [places, setPlaces] = useState<TripPlace[]>([]);
  const [unplaced, setUnplaced] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [editPlaceId, setEditPlaceId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [shuffledItems, setShuffledItems] = useState<MediaItem[] | null>(null);
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState('');
  const { columns } = usePinchColumns();

  const load = useCallback(() => {
    setLoading(true);
    api.getAlbum(tripId).then(d => { setAlbum(d.album); setPlaces(d.places); setUnplaced(d.unplaced); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  const [showUpload, setShowUpload] = useState(false);
  // 여행에 바로 업로드(#4): 공유 사진으로 올리며 이 앨범에 추가. 올린 master 개인공간에도 들어감.
  const uploadQueue = useUploadQueue(load, 'shared', tripId);

  // 라이트박스 네비 순서: 장소(레일 순서)별 → 미배정
  const ordered = useMemo(() => [...places.flatMap(p => p.items || []), ...unplaced], [places, unplaced]);

  const applyToItem = (id: number, fn: (it: MediaItem) => MediaItem) => {
    setPlaces(ps => ps.map(p => ({ ...p, items: (p.items || []).map(it => it.id === id ? fn(it) : it) })));
    setUnplaced(u => u.map(it => it.id === id ? fn(it) : it));
  };
  const handleLikeToggle = useCallback((id: number, liked: boolean) => {
    applyToItem(id, it => ({ ...it, liked, likeCount: it.likeCount + (liked ? 1 : -1) }));
  }, []);
  const handleFavoriteToggle = useCallback((id: number, favorited: boolean) => {
    applyToItem(id, it => ({ ...it, favorited }));
  }, []);
  const handleDelete = useCallback(async (id: number) => {
    await api.deleteMedia(id);
    setPlaces(ps => ps.map(p => ({ ...p, items: (p.items || []).filter(it => it.id !== id) })));
    setUnplaced(u => u.filter(it => it.id !== id));
    setLightboxIndex(null);
  }, []);

  const openById = (id: number) => {
    const idx = ordered.findIndex(it => it.id === id);
    if (idx >= 0) { setLightboxIndex(idx); history.pushState({ modal: 'lightbox' }, ''); }
  };
  const scrollTo = (key: string) => document.getElementById('trip-sec-' + key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const deleteTrip = async () => {
    if (!confirm('이 여행을 삭제할까요? (사진은 공유 갤러리에 그대로 남습니다)')) return;
    await api.deleteAlbum(tripId); onDeleted();
  };
  const saveRename = async (id: number) => {
    const name = renameVal.trim();
    setEditPlaceId(null);
    if (name) { await api.updatePlace(id, { name }); load(); }
  };
  const removePlace = async (id: number) => {
    if (!confirm('이 장소를 삭제할까요? (사진은 여행에 남고 미배정으로 이동합니다)')) return;
    await api.deletePlace(id); load();
  };
  // 랜덤 슬라이드쇼: 여행 사진 전체를 섞어서 라이트박스 자동재생
  const startSlideshow = () => {
    if (ordered.length === 0) return;
    const arr = ordered.slice();
    for (let r = 0; r < 3; r++) for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    setShuffledItems(arr);
    setLightboxIndex(0);
    history.pushState({ modal: 'lightbox' }, '');
  };
  // 여행 이름 수정
  const saveTitle = async () => {
    const t = titleVal.trim();
    setEditTitle(false);
    if (t && t !== album?.title) { await api.updateAlbum(tripId, { title: t }); load(); }
  };
  // 표지(썸네일) 설정: 사진 길게 누르면
  const setCover = async (id: number) => {
    if (!confirm('이 사진을 여행 표지(썸네일)로 설정할까요?')) return;
    await api.updateAlbum(tripId, { coverMediaId: id }); load();
  };

  const placed = places.filter(p => p.items && p.items.length > 0);
  const railChips = [
    ...placed.map(p => ({ key: String(p.id), label: p.name, time: hhmm(p.startAt) })),
    ...(unplaced.length ? [{ key: 'etc', label: '기타', time: '' }] : []),
  ];

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <button className={styles.backBtn} onClick={onBack} aria-label="뒤로">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className={styles.detailTitleWrap}>
          {editTitle ? (
            <input autoFocus value={titleVal} maxLength={40}
              onChange={e => setTitleVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditTitle(false); }}
              onBlur={saveTitle}
              style={{ fontSize: 18, fontWeight: 700, border: 'none', borderBottom: '2px solid var(--color-primary)', background: 'transparent', color: 'var(--color-text)', width: '100%', outline: 'none', padding: '2px 0', fontFamily: 'inherit' }} />
          ) : (
            <h2 className={styles.detailTitle} onClick={isMaster ? () => { setEditTitle(true); setTitleVal(album?.title ?? ''); } : undefined} style={isMaster ? { cursor: 'pointer' } : undefined}>
              {album?.title ?? '여행'}
            </h2>
          )}
          {album && <span className={styles.detailMeta}>{formatPeriod(album)} · {ordered.length}장</span>}
        </div>
        {ordered.length > 0 && (
          <button className={styles.delBtn} onClick={startSlideshow} aria-label="랜덤 슬라이드쇼">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 4 20 12 6 20 6 4" /></svg>
          </button>
        )}
        {isMaster && (
          <button className={styles.delBtn} onClick={() => setShowUpload(true)} aria-label="이 여행에 사진 올리기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V6M5 12l7-7 7 7" /></svg>
          </button>
        )}
        {isMaster && (
          <button className={styles.delBtn} onClick={deleteTrip} aria-label="여행 삭제">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
        )}
      </div>

      {/* 타임라인 레일: 장소를 시간순 칩으로 — 탭하면 해당 섹션으로 */}
      {railChips.length > 1 && (
        <div className={styles.timelineRail}>
          {railChips.map(c => (
            <button key={c.key} className={styles.railChip} onClick={() => scrollTo(c.key)}>
              {c.time && <span className={styles.railTime}>{c.time}</span>}
              <span className={styles.railName}><Icon name="pin" size={13} /> {c.label}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>불러오는 중...</div>
      ) : ordered.length === 0 ? (
        <div className={styles.empty}>
          <p>이 여행에 사진이 없어요</p>
          <span className={styles.emptyHint}>땅땅&콩콩·개인 갤러리에서 골라 추가하거나, 바로 올리세요</span>
          {isMaster && (
            <button
              style={{ marginTop: 14, padding: '11px 20px', border: 'none', borderRadius: 999, background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              onClick={() => setShowUpload(true)}
            >이 여행에 사진 올리기</button>
          )}
        </div>
      ) : (
        <>
          {placed.map(p => (
            <section key={p.id} id={'trip-sec-' + p.id} className={styles.placeSection}>
              <div className={styles.placeHeader}>
                {editPlaceId === p.id ? (
                  <input className={styles.placeRename} value={renameVal} autoFocus
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(p.id); if (e.key === 'Escape') setEditPlaceId(null); }}
                    onBlur={() => saveRename(p.id)} maxLength={40} />
                ) : (
                  <button className={styles.placeName} onClick={isMaster ? () => { setEditPlaceId(p.id); setRenameVal(p.name); } : undefined}>
                    <Icon name="pin" size={14} /> {p.name}
                  </button>
                )}
                <span className={styles.placeMeta}>
                  {hhmm(p.startAt)}{p.endAt && hhmm(p.endAt) !== hhmm(p.startAt) ? `–${hhmm(p.endAt)}` : ''} · {p.items!.length}장
                </span>
                {isMaster && editPlaceId !== p.id && <button className={styles.placeDel} onClick={() => removePlace(p.id)} aria-label="장소 삭제">✕</button>}
              </div>
              <MediaGrid items={p.items!} onItemClick={(i) => openById(p.items![i].id)} onLoadMore={() => {}} hasMore={false} sort="flat" columns={columns} isAdmin={isMaster} onLongPress={isMaster ? setCover : undefined} />
            </section>
          ))}
          {unplaced.length > 0 && (
            <section id="trip-sec-etc" className={styles.placeSection}>
              {placed.length > 0 && (
                <div className={styles.placeHeader}>
                  <span className={styles.placeName}><Icon name="folder" size={14} /> 기타</span>
                  <span className={styles.placeMeta}>{unplaced.length}장</span>
                </div>
              )}
              <MediaGrid items={unplaced} onItemClick={(i) => openById(unplaced[i].id)} onLoadMore={() => {}} hasMore={false} sort="flat" columns={columns} isAdmin={isMaster} onLongPress={isMaster ? setCover : undefined} />
            </section>
          )}
        </>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          items={shuffledItems ?? ordered}
          index={lightboxIndex}
          user={user}
          onClose={() => { setLightboxIndex(null); setShuffledItems(null); if (history.state?.modal === 'lightbox') history.back(); }}
          onNavigate={setLightboxIndex}
          onDelete={handleDelete}
          onLikeToggle={handleLikeToggle}
          onFavoriteToggle={handleFavoriteToggle}
          onDateChange={() => {}}
          initialSlideshow={!!shuffledItems}
        />
      )}

      {showUpload && <UploadModal uploadQueue={uploadQueue} onClose={() => setShowUpload(false)} />}
      {!showUpload && uploadQueue.activeCount > 0 && (
        <div
          onClick={() => setShowUpload(true)}
          style={{ position: 'fixed', bottom: 'calc(var(--tab-bar-height, 64px) + env(safe-area-inset-bottom) + 16px)', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'var(--color-text, #1c1c1e)', color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}
        >
          {uploadQueue.doneCount}/{uploadQueue.totalCount} 업로드 중…
        </div>
      )}
    </div>
  );
}
