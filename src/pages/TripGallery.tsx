import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api, type User, type Album, type MediaItem, type TripPlace } from '../api';
import { usePinchColumns } from '../hooks/usePinchColumns';
import MediaGrid from '../components/gallery/MediaGrid';
import Lightbox from '../components/gallery/Lightbox';
import styles from './TripGallery.module.css';

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
          <div className={styles.emptyIllust}>✈️</div>
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
                  <span className={styles.coverEmpty}>✈️</span>
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
  const { columns } = usePinchColumns();

  const load = useCallback(() => {
    setLoading(true);
    api.getAlbum(tripId).then(d => { setAlbum(d.album); setPlaces(d.places); setUnplaced(d.unplaced); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

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
          <h2 className={styles.detailTitle}>{album?.title ?? '여행'}</h2>
          {album && <span className={styles.detailMeta}>{formatPeriod(album)} · {ordered.length}장</span>}
        </div>
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
              <span className={styles.railName}>📍 {c.label}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>불러오는 중...</div>
      ) : ordered.length === 0 ? (
        <div className={styles.empty}>
          <p>이 여행에 사진이 없어요</p>
          <span className={styles.emptyHint}>땅땅&콩콩이나 개인 갤러리에서 사진을 선택해 이 여행에 추가하세요</span>
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
                    📍 {p.name}
                  </button>
                )}
                <span className={styles.placeMeta}>
                  {hhmm(p.startAt)}{p.endAt && hhmm(p.endAt) !== hhmm(p.startAt) ? `–${hhmm(p.endAt)}` : ''} · {p.items!.length}장
                </span>
                {isMaster && editPlaceId !== p.id && <button className={styles.placeDel} onClick={() => removePlace(p.id)} aria-label="장소 삭제">✕</button>}
              </div>
              <MediaGrid items={p.items!} onItemClick={(i) => openById(p.items![i].id)} onLoadMore={() => {}} hasMore={false} sort="flat" columns={columns} onLikeToggle={handleLikeToggle} isAdmin={isMaster} />
            </section>
          ))}
          {unplaced.length > 0 && (
            <section id="trip-sec-etc" className={styles.placeSection}>
              {placed.length > 0 && (
                <div className={styles.placeHeader}>
                  <span className={styles.placeName}>🗂 기타</span>
                  <span className={styles.placeMeta}>{unplaced.length}장</span>
                </div>
              )}
              <MediaGrid items={unplaced} onItemClick={(i) => openById(unplaced[i].id)} onLoadMore={() => {}} hasMore={false} sort="flat" columns={columns} onLikeToggle={handleLikeToggle} isAdmin={isMaster} />
            </section>
          )}
        </>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          items={ordered}
          index={lightboxIndex}
          user={user}
          onClose={() => { setLightboxIndex(null); if (history.state?.modal === 'lightbox') history.back(); }}
          onNavigate={setLightboxIndex}
          onDelete={handleDelete}
          onLikeToggle={handleLikeToggle}
          onFavoriteToggle={handleFavoriteToggle}
          onDateChange={() => {}}
        />
      )}
    </div>
  );
}
