import { useEffect, useRef, useState } from 'react';
import { api, type Album } from '../../api';
import styles from './ShareSheet.module.css';

interface Props {
  mediaIds: number[];
  onClose: () => void;
  onDone: (sharedIds: number[]) => void;
}

// 개인 → 다중선택 공유. 체크박스로 한설/여행/땅콩땅콩 범위 조절.
export default function ShareSheet({ mediaIds, onClose, onDone }: Props) {
  const [trips, setTrips] = useState<Album[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [seol, setSeol] = useState(true);
  const [tripOn, setTripOn] = useState(false);
  const [peanutOn, setPeanutOn] = useState(false);

  const [tripMode, setTripMode] = useState<'existing' | 'new'>('existing');
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [autoPlace, setAutoPlace] = useState(true);
  const newRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getAlbums('trip').then(d => {
      setTrips(d.items);
      if (d.items.length === 0) setTripMode('new');
    }).catch(() => {});
  }, []);
  useEffect(() => { if (tripOn && tripMode === 'new') newRef.current?.focus(); }, [tripOn, tripMode]);

  // 여행/땅콩땅콩은 공유(한설) 전제 → 한설 자동 체크 & 잠금
  const seolLocked = tripOn || peanutOn;
  const seolChecked = seol || seolLocked;

  const tripReady = !tripOn || (tripMode === 'existing' ? !!selectedTripId : !!newTitle.trim());
  const canConfirm = (seolChecked || tripOn || peanutOn) && tripReady && !busy;

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setErr(null);
    try {
      let albumId: number | null = null;
      if (tripOn) {
        if (tripMode === 'new') {
          const a = await api.createAlbum(newTitle.trim());
          albumId = a.id;
        } else {
          albumId = selectedTripId;
        }
      }
      // 공유(한설) 승격 + (선택 시) 여행 배정
      await api.promoteToShared(mediaIds, albumId);
      // 여행 + GPS 자동 장소 분류
      if (albumId && autoPlace) {
        try {
          const sug = await api.suggestPlaces(mediaIds);
          if (sug.clusters.length) {
            await api.createPlacesBulk(albumId, sug.clusters.map(c => ({ name: c.suggestedName, lat: c.lat, lng: c.lng, mediaIds: c.mediaIds })));
          }
        } catch { /* 장소 자동분류 실패는 무시 (사진은 여행에 추가됨) */ }
      }
      // 땅콩땅콩 게시 (공유된 뒤이므로 허용됨)
      if (peanutOn) {
        try { await api.copyToPeanut(mediaIds); }
        catch (e: any) { setErr('땅콩땅콩 공유는 실패했지만 공유 갤러리에는 추가됐어요: ' + (e.message || '')); }
      }
      onDone(mediaIds);
    } catch (e: any) {
      setErr('공유 실패: ' + (e.message || '알 수 없는 오류'));
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.handle} />
        <div className={styles.header}>
          <h2 className={styles.title}>공유하기</h2>
          <span className={styles.count}>{mediaIds.length}개 선택</span>
        </div>

        <div className={styles.list}>
          {/* 땅땅&콩콩 (공유 갤러리) */}
          <label className={`${styles.row} ${seolChecked ? styles.rowOn : ''}`}>
            <span className={`${styles.rowIcon} ${styles.rowIconLogo}`}><img className={styles.logoImg} src="/icons/logo-web.png" alt="" /></span>
            <span className={styles.rowBody}>
              <span className={styles.rowLabel}>땅땅&콩콩 (공유 갤러리)</span>
              <span className={styles.rowSub}>가족 모두에게 공개</span>
            </span>
            <input type="checkbox" className={styles.check} checked={seolChecked} disabled={seolLocked}
              onChange={e => setSeol(e.target.checked)} />
          </label>

          {/* 여행 */}
          <label className={`${styles.row} ${tripOn ? styles.rowOn : ''}`}>
            <span className={styles.rowIcon}>✈️</span>
            <span className={styles.rowBody}>
              <span className={styles.rowLabel}>여행</span>
              <span className={styles.rowSub}>특정 여행 앨범에 추가</span>
            </span>
            <input type="checkbox" className={styles.check} checked={tripOn} onChange={e => setTripOn(e.target.checked)} />
          </label>

          {tripOn && (
            <div className={styles.tripPicker}>
              {trips.length > 0 && (
                <div className={styles.tripChips}>
                  {trips.map(t => (
                    <button key={t.id} type="button"
                      className={`${styles.tripChip} ${tripMode === 'existing' && selectedTripId === t.id ? styles.tripChipOn : ''}`}
                      onClick={() => { setTripMode('existing'); setSelectedTripId(t.id); }}>
                      {t.title}
                    </button>
                  ))}
                  <button type="button" className={`${styles.tripChip} ${tripMode === 'new' ? styles.tripChipOn : ''}`}
                    onClick={() => setTripMode('new')}>＋ 새 여행</button>
                </div>
              )}
              {tripMode === 'new' && (
                <input ref={newRef} className={styles.newInput} value={newTitle} maxLength={40}
                  placeholder="새 여행 이름 (예: 제주 가족여행)"
                  onChange={e => setNewTitle(e.target.value)} />
              )}
              <label className={styles.autoPlace}>
                <input type="checkbox" checked={autoPlace} onChange={e => setAutoPlace(e.target.checked)} />
                <span>📍 GPS로 장소 자동 분류</span>
              </label>
            </div>
          )}

          {/* 땅콩땅콩땅콩콩땅 (외부 앱) */}
          <label className={`${styles.row} ${peanutOn ? styles.rowOn : ''}`}>
            <span className={`${styles.rowIcon} ${styles.rowIconLogo}`}><img className={styles.logoImg} src="/icons/peanut-app-logo.png" alt="" /></span>
            <span className={styles.rowBody}>
              <span className={styles.rowLabel}>땅콩땅콩땅콩콩땅</span>
              <span className={styles.rowSub}>외부 공유 갤러리에도 게시</span>
            </span>
            <input type="checkbox" className={styles.check} checked={peanutOn} onChange={e => setPeanutOn(e.target.checked)} />
          </label>
        </div>

        {err && <div className={styles.err}>{err}</div>}

        <button className={styles.confirm} onClick={confirm} disabled={!canConfirm}>
          {busy ? '공유 중...' : '공유'}
        </button>
        <button className={styles.cancel} onClick={onClose} disabled={busy}>취소</button>
      </div>
    </div>
  );
}
