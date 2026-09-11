import { useState } from 'react';
import type { User } from '../api';
import TripPlans from './TripPlans';
import TripGallery from './TripGallery';
import styles from './Trip.module.css';

interface Props {
  user: User;
}

type SubTab = 'plan' | 'album';

const SUB_TABS: { value: SubTab; label: string; icon: string }[] = [
  { value: 'plan', label: '계획', icon: '🗺️' },
  { value: 'album', label: '앨범', icon: '📸' },
];

export default function Trip({ user }: Props) {
  const [activeTab, setActiveTab] = useState<SubTab>('plan');

  return (
    <div className={styles.layout}>
      <div className={styles.pageHeader}>
        <div className={styles.brand}>
          <div className={styles.brandBlock}>
            <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
            <span className={styles.brandName}>땅콩패밀리</span>
          </div>
          <h1 className={styles.pageTitle}>여행</h1>
        </div>
      </div>

      <div className={styles.subTabs}>
        <div className={styles.subTabTrack}>
          {SUB_TABS.map(({ value, label, icon }) => (
            <button
              key={value}
              className={`${styles.subTab} ${activeTab === value ? styles.subTabActive : ''}`}
              onClick={() => setActiveTab(value)}
            >
              <span className={styles.subTabIcon}>{icon}</span>
              {label}
            </button>
          ))}
          <div
            className={styles.subTabIndicator}
            style={{
              transform: `translateX(${SUB_TABS.findIndex(t => t.value === activeTab) * 100}%)`,
              width: `${100 / SUB_TABS.length}%`,
            }}
          />
        </div>
      </div>

      {/* display:none로 숨겨 탭 전환 시 상태 유지 */}
      <div className={styles.tabContent} style={{ display: activeTab === 'plan' ? 'flex' : 'none' }}>
        <TripPlans user={user} />
      </div>
      <div className={styles.tabContent} style={{ display: activeTab === 'album' ? 'flex' : 'none' }}>
        <TripGallery user={user} />
      </div>
    </div>
  );
}
