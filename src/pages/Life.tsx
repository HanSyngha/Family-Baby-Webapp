import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { User } from '../api';
import Calendar from './Calendar';
import Todos from './Todos';
import Notes from './Notes';
import styles from './Life.module.css';

interface Props {
  user: User;
}

type SubTab = 'calendar' | 'todos' | 'notes';

const SUB_TABS: { value: SubTab; label: string; icon: string }[] = [
  { value: 'calendar', label: '캘린더', icon: '📅' },
  { value: 'todos', label: '할일', icon: '✅' },
  { value: 'notes', label: '노트', icon: '📝' },
];

export default function Life({ user }: Props) {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<SubTab>(() => {
    const st = (location.state as { tab?: string } | null)?.tab;
    return st === 'todos' || st === 'notes' ? st : 'calendar';
  });

  useEffect(() => {
    const st = (location.state as { tab?: string } | null)?.tab;
    if (st === 'calendar' || st === 'todos' || st === 'notes') {
      setActiveTab(st);
    }
  }, [location.state]);

  return (
    <div className={styles.layout}>
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div className={styles.brand}>
          <div className={styles.brandBlock}>
            <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
            <span className={styles.brandName}>땅콩패밀리</span>
          </div>
          <h1 className={styles.pageTitle}>생활</h1>
        </div>
      </div>

      {/* Sub-tabs */}
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

      {/* Tab Content — display:none로 숨겨서 상태 유지 */}
      <div className={styles.tabContent} style={{ display: activeTab === 'calendar' ? 'flex' : 'none' }}>
        <Calendar user={user} embedded />
      </div>
      <div className={styles.tabContent} style={{ display: activeTab === 'todos' ? 'flex' : 'none' }}>
        <Todos user={user} embedded />
      </div>
      <div className={styles.tabContent} style={{ display: activeTab === 'notes' ? 'flex' : 'none' }}>
        <Notes user={user} embedded />
      </div>
    </div>
  );
}
