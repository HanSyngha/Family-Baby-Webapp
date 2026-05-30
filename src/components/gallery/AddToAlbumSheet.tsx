import { useEffect, useRef, useState } from 'react';
import { api, type Album } from '../../api';
import styles from './AddToAlbumSheet.module.css';

interface Props {
  // promote: 개인 → 공유(한설/여행). add: 이미 공유된 미디어를 여행에 추가.
  mode: 'promote' | 'add';
  mediaIds: number[];
  onClose: () => void;
  onDone: (movedIds: number[]) => void;
}

export default function AddToAlbumSheet({ mode, mediaIds, onClose, onDone }: Props) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getAlbums('trip').then(d => setAlbums(d.items)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const commit = async (albumId: number | null) => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'promote') {
        await api.promoteToShared(mediaIds, albumId);
      } else if (albumId) {
        await api.addAlbumItems(albumId, mediaIds);
      }
      onDone(mediaIds);
    } catch (e: any) {
      alert('실패: ' + (e.message || '알 수 없는 오류'));
      setBusy(false);
    }
  };

  const createAndCommit = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const album = await api.createAlbum(title);
      if (mode === 'promote') await api.promoteToShared(mediaIds, album.id);
      else await api.addAlbumItems(album.id, mediaIds);
      onDone(mediaIds);
    } catch (e: any) {
      alert('실패: ' + (e.message || '알 수 없는 오류'));
      setBusy(false);
    }
  };

  const fmtPeriod = (a: Album) => {
    if (!a.startDate) return `${a.itemCount ?? 0}장`;
    const s = a.startDate.slice(5).replace('-', '.');
    const e = a.endDate ? a.endDate.slice(5).replace('-', '.') : s;
    return s === e ? `${s} · ${a.itemCount ?? 0}장` : `${s}–${e} · ${a.itemCount ?? 0}장`;
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.handle} />
        <div className={styles.header}>
          <h2 className={styles.title}>{mode === 'promote' ? '공유 갤러리로 보내기' : '여행에 추가'}</h2>
          <span className={styles.count}>{mediaIds.length}개 선택</span>
        </div>

        <div className={styles.list}>
          {mode === 'promote' && (
            <button className={styles.option} onClick={() => commit(null)} disabled={busy}>
              <span className={styles.optIcon}>🥜</span>
              <span className={styles.optBody}>
                <span className={styles.optLabel}>땅땅&콩콩 (공유 갤러리)</span>
                <span className={styles.optSub}>모두에게 공개</span>
              </span>
            </button>
          )}

          {loading ? (
            <div className={styles.loading}>불러오는 중...</div>
          ) : (
            albums.map(a => (
              <button key={a.id} className={styles.option} onClick={() => commit(a.id)} disabled={busy}>
                <span className={styles.optIcon} style={{ background: a.color || '#E8943A' }}>✈️</span>
                <span className={styles.optBody}>
                  <span className={styles.optLabel}>{a.title}</span>
                  <span className={styles.optSub}>{fmtPeriod(a)}</span>
                </span>
              </button>
            ))
          )}

          {creating ? (
            <div className={styles.createRow}>
              <input
                ref={inputRef}
                className={styles.createInput}
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="여행 이름 (예: 제주 가족여행)"
                onKeyDown={e => { if (e.key === 'Enter') createAndCommit(); }}
                maxLength={40}
              />
              <button className={styles.createBtn} onClick={createAndCommit} disabled={busy || !newTitle.trim()}>만들기</button>
            </div>
          ) : (
            <button className={styles.newTrip} onClick={() => setCreating(true)} disabled={busy}>
              <span className={styles.optIcon}>＋</span>
              <span className={styles.optLabel}>새 여행 만들기</span>
            </button>
          )}
        </div>

        <button className={styles.cancel} onClick={onClose} disabled={busy}>취소</button>
      </div>
    </div>
  );
}
