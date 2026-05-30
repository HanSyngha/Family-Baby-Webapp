import { useState, useEffect } from 'react';
import { api, type User } from '../api';
import GalleryView from './GalleryView';
import TripGallery from './TripGallery';
import styles from './Gallery.module.css';

interface Props {
  user: User;
}

type Tab = 'seol' | 'trip' | 'private';

export default function Gallery({ user }: Props) {
  const isMaster = user.role === 'master';
  const [tab, setTab] = useState<Tab>('seol');
  const [babyBirth, setBabyBirth] = useState<string | null>(null);

  useEffect(() => {
    api.getBabies()
      .then(bs => { const b = bs.find(x => x.name === '한설') ?? bs[0]; setBabyBirth(b?.birthDate ?? null); })
      .catch(() => {});
  }, []);

  const TABS: { value: Tab; label: string; lock?: boolean }[] = [
    { value: 'seol', label: '땅땅&콩콩' },
    { value: 'trip', label: '여행' },
    ...(isMaster ? [{ value: 'private' as Tab, label: '개인', lock: true }] : []),
  ];
  const activeIdx = Math.max(0, TABS.findIndex(t => t.value === tab));

  return (
    <div className={styles.galleryWrap}>
      {/* Sub-tabs (바텀탭 5개는 고정, 갤러리 내부 서브탭) */}
      <div className={styles.subTabs}>
        <div className={styles.subTabTrack}>
          {TABS.map(t => (
            <button
              key={t.value}
              className={`${styles.subTab} ${tab === t.value ? styles.subTabActive : ''}`}
              onClick={() => setTab(t.value)}
            >
              {t.lock && <span className={styles.lockIcon}>🔒</span>}
              {t.label}
            </button>
          ))}
          <div
            className={styles.subTabIndicator}
            style={{ transform: `translateX(${activeIdx * 100}%)`, width: `${100 / TABS.length}%` }}
          />
        </div>
      </div>

      {/* 한설 = 공유 갤러리 전체 */}
      <div className={styles.tabContent} style={{ display: tab === 'seol' ? 'block' : 'none' }}>
        <GalleryView user={user} scope="shared" embedded babyBirth={babyBirth} />
      </div>
      {/* 여행 */}
      <div className={styles.tabContent} style={{ display: tab === 'trip' ? 'block' : 'none' }}>
        <TripGallery user={user} babyBirth={babyBirth} />
      </div>
      {/* 개인 (관리자만) */}
      {isMaster && (
        <div className={styles.tabContent} style={{ display: tab === 'private' ? 'block' : 'none' }}>
          <GalleryView user={user} scope="private" embedded />
        </div>
      )}
    </div>
  );
}
