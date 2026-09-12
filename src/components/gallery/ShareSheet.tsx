import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Album, type MediaItem } from '../../api';
import styles from './ShareSheet.module.css';
import Icon, { type IconName } from '../ui/Icon';

interface Props {
  items: MediaItem[];
  onClose: () => void;
  onDone: (changedIds: number[]) => void;
}

/** 선택한 사진들이 한 범위에 '전부 / 일부만 / 전혀' 들어 있는지 */
type Tri = 'on' | 'mixed' | 'off';

function tri(items: MediaItem[], pred: (m: MediaItem) => boolean): Tri {
  if (items.length === 0) return 'off';
  const n = items.filter(pred).length;
  return n === 0 ? 'off' : n === items.length ? 'on' : 'mixed';
}

interface ScopeDef {
  key: 'shared' | 'peanut' | 'world';
  icon: IconName;
  label: string;
  sub: string;
  /** 이 범위가 켜지려면 땅땅&콩콩이 먼저 켜져 있어야 하는가 */
  needsShared: boolean;
}

// 좁은 순 → 넓은 순. 이 순서가 곧 화면의 위→아래 순서이고, 사용자가 '얼마나 넓게
// 퍼지는지'를 읽는 단서다. 여행 앨범은 공개 범위가 아니라 분류라서 아래에 따로 둔다.
const SCOPES: ScopeDef[] = [
  { key: 'shared', icon: 'home',  label: '땅땅&콩콩',   sub: '우리 가족',           needsShared: false },
  { key: 'peanut', icon: 'users', label: '땅콩땅콩',     sub: '부모님 · 친척',       needsShared: true },
  { key: 'world',  icon: 'globe', label: 'Peanut World', sub: '승인받은 지인까지',   needsShared: true },
];

export default function ShareSheet({ items, onClose, onDone }: Props) {
  const mediaIds = useMemo(() => items.map(i => i.id), [items]);

  // 현재 상태를 그대로 읽어와 초기값으로 쓴다. 그래야 이 시트가 '공유하기'가 아니라
  // '지금 어디까지 나가 있는지 보고 고치는' 화면이 된다.
  const initial = useMemo(() => ({
    shared: tri(items, m => m.visibility === 'shared'),
    peanut: tri(items, m => !!m.inPeanut),
    world:  tri(items, m => !!m.externalShared),
  }), [items]);

  const [state, setState] = useState<Record<ScopeDef['key'], Tri>>(initial);
  const [tripOn, setTripOn] = useState(false);
  const [trips, setTrips] = useState<Album[]>([]);
  const [tripMode, setTripMode] = useState<'existing' | 'new'>('existing');
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [autoPlace, setAutoPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const inTrip = tri(items, m => !!m.inTrip);

  useEffect(() => {
    api.getAlbums('trip').then(d => {
      setTrips(d.items);
      if (d.items.length === 0) setTripMode('new');
    }).catch(() => {});
  }, []);
  useEffect(() => { if (tripOn && tripMode === 'new') newRef.current?.focus(); }, [tripOn, tripMode]);

  const toggle = (key: ScopeDef['key']) => {
    setState(prev => {
      const next = { ...prev };
      next[key] = prev[key] === 'on' ? 'off' : 'on';
      // 땅땅&콩콩을 내리면 그보다 넓은 범위는 남아 있을 수 없다(서버도 그렇게 동작).
      // 화면에서 먼저 같이 꺼줘야 사용자가 결과를 예측할 수 있다.
      if (key === 'shared' && next.shared === 'off') {
        next.peanut = 'off';
        next.world = 'off';
      }
      // 더 넓은 범위를 켜면 땅땅&콩콩은 전제 조건이라 자동으로 켜진다.
      if (key !== 'shared' && next[key] === 'on') next.shared = 'on';
      return next;
    });
  };

  const changed = (k: ScopeDef['key']) => state[k] !== initial[k];
  const willUnshare = initial.shared !== 'off' && state.shared === 'off';
  const tripReady = !tripOn || (tripMode === 'existing' ? !!selectedTripId : !!newTitle.trim());
  const hasChange = SCOPES.some(s => changed(s.key)) || tripOn;
  const canConfirm = hasChange && tripReady && !busy;

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setErr(null);
    const problems: string[] = [];

    try {
      // 1) 넓히기 먼저: 땅땅&콩콩 → 여행 → 땅콩땅콩 → Peanut World
      if (state.shared === 'on' && initial.shared !== 'on') {
        await api.promoteToShared(mediaIds);
      }

      if (tripOn) {
        let albumId = selectedTripId;
        if (tripMode === 'new') {
          const a = await api.createAlbum(newTitle.trim());
          albumId = a.id;
        }
        if (albumId) {
          await api.addAlbumItems(albumId, mediaIds);
          if (autoPlace) {
            try {
              const sug = await api.suggestPlaces(mediaIds);
              if (sug.clusters.length) {
                await api.createPlacesBulk(albumId, sug.clusters.map(c => ({ name: c.suggestedName, lat: c.lat, lng: c.lng, mediaIds: c.mediaIds })));
              }
            } catch { /* 장소 자동분류 실패는 무시 — 사진은 이미 여행에 들어갔다 */ }
          }
        }
      }

      if (changed('peanut')) {
        try {
          if (state.peanut === 'on') await api.copyToPeanut(mediaIds);
          else await api.removeFromPeanut(mediaIds);
        } catch (e: any) { problems.push('땅콩땅콩: ' + (e.message || '실패')); }
      }

      if (changed('world')) {
        try {
          await api.externalShare(mediaIds, state.world === 'on');
        } catch (e: any) { problems.push('Peanut World: ' + (e.message || '실패')); }
      }

      // 2) 좁히기는 마지막. unshare는 여행·땅콩땅콩·Peanut World에서 한 번에 내리므로
      //    위 작업들보다 먼저 돌면 방금 한 일을 되돌려버린다.
      if (willUnshare) {
        await api.unshare(mediaIds);
      }

      if (problems.length) {
        setErr(problems.join('\n'));
        setBusy(false);
        return;
      }
      onDone(mediaIds);
    } catch (e: any) {
      setErr(e.message || '변경하지 못했어요');
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()} role="dialog" aria-label="공유 범위">
        <div className={styles.handle} />

        <div className={styles.header}>
          <h2 className={styles.title}>공유 범위</h2>
          <span className={styles.count}>{items.length}개 선택</span>
        </div>

        <div className={styles.list}>
          {SCOPES.map(scope => {
            const st = state[scope.key];
            const locked = scope.needsShared && state.shared === 'off' && st === 'off';
            return (
              <button
                key={scope.key}
                type="button"
                className={`${styles.row} ${st === 'on' ? styles.rowOn : ''} ${st === 'mixed' ? styles.rowMixed : ''}`}
                onClick={() => toggle(scope.key)}
                aria-pressed={st === 'on'}
              >
                <span className={styles.rowIcon}><Icon name={scope.icon} size={19} /></span>
                <span className={styles.rowBody}>
                  <span className={styles.rowLabel}>
                    {scope.label}
                    {st === 'mixed' && <span className={styles.mixedTag}>일부만</span>}
                    {changed(scope.key) && <span className={styles.changedTag}>{st === 'on' ? '공개' : '해제'}</span>}
                  </span>
                  <span className={styles.rowSub}>
                    {locked ? '땅땅&콩콩을 켜면 함께 켜져요' : scope.sub}
                  </span>
                </span>
                <span className={`${styles.switch} ${st === 'on' ? styles.switchOn : ''} ${st === 'mixed' ? styles.switchMixed : ''}`}>
                  <span className={styles.knob} />
                </span>
              </button>
            );
          })}
        </div>

        {/* 여행은 '얼마나 넓게 보이나'가 아니라 '어떻게 묶이나'라서 범위 목록과 분리한다. */}
        <div className={styles.tripSection}>
          <button
            type="button"
            className={`${styles.row} ${tripOn ? styles.rowOn : ''}`}
            onClick={() => setTripOn(v => !v)}
            aria-pressed={tripOn}
          >
            <span className={styles.rowIcon}><Icon name="plane" size={19} /></span>
            <span className={styles.rowBody}>
              <span className={styles.rowLabel}>여행 앨범에 추가</span>
              <span className={styles.rowSub}>
                {inTrip === 'on' ? '이미 여행에 담겨 있어요 · 빼기는 여행 탭에서'
                  : inTrip === 'mixed' ? '일부는 이미 여행에 담겨 있어요'
                  : '공개 범위와는 별개인 분류예요'}
              </span>
            </span>
            <span className={`${styles.switch} ${tripOn ? styles.switchOn : ''}`}><span className={styles.knob} /></span>
          </button>

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
                <span><Icon name="pin" size={14} /> GPS로 장소 자동 분류</span>
              </label>
            </div>
          )}
        </div>

        {willUnshare && (
          <div className={styles.warn}>
            <Icon name="alert" size={15} />
            <span>땅땅&콩콩에서 내리면 여행·땅콩땅콩·Peanut World에서도 함께 사라지고, 내 개인공간으로 돌아갑니다.</span>
          </div>
        )}

        {err && <div className={styles.err}>{err}</div>}

        <button className={`${styles.confirm} ${willUnshare ? styles.confirmDanger : ''}`} onClick={confirm} disabled={!canConfirm}>
          {busy ? '적용 중...' : hasChange ? '적용' : '변경한 내용 없음'}
        </button>
        <button className={styles.cancel} onClick={onClose} disabled={busy}>닫기</button>
      </div>
    </div>
  );
}
