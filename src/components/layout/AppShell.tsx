import { useRef, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, type User } from '../../api';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import styles from './AppShell.module.css';
import Gallery from '../../pages/Gallery';
import Home from '../../pages/Home';
import Parenting from '../../pages/Parenting';
import Life from '../../pages/Life';
import Settings from '../../pages/Settings';

interface Props {
  user: User;
  onLogout: () => void;
}

const NAV_ITEMS = [
  { path: '/home', label: '홈', icon: HomeIcon },
  { path: '/gallery', label: '갤러리', icon: GalleryIcon },
  { path: '/parenting', label: '육아', icon: ParentingIcon },
  { path: '/life', label: '생활', icon: LifeIcon },
  { path: '/settings', label: '설정', icon: SettingsIcon },
];

const EXTERNAL_URL = 'https://syngha.synology.me:2280';

export default function AppShell({ user, onLogout }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { canInstall, install } = useInstallPrompt();
  const contentRef = useRef<HTMLElement>(null);
  const touchRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Wake Lock: 앱 사용 중 화면 꺼짐 방지
  useEffect(() => {
    let wl: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        if ('wakeLock' in navigator) {
          wl = await navigator.wakeLock.request('screen');
        }
      } catch { /* 권한 거부 또는 미지원 */ }
    };
    request();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        request();
        api.resumeAutoSleep().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      wl?.release();
    };
  }, []);

  // 세로 고정: Screen Orientation API (Android PWA)
  useEffect(() => {
    try {
      screen.orientation?.lock?.('portrait').catch(() => {});
    } catch { /* 미지원 브라우저 */ }
  }, []);

  const handleSwipe = useCallback((dx: number) => {
    const currentIdx = NAV_ITEMS.findIndex(item => location.pathname.startsWith(item.path));
    if (currentIdx < 0) return;
    if (dx < 0 && currentIdx < NAV_ITEMS.length - 1) {
      navigate(NAV_ITEMS[currentIdx + 1].path);
    } else if (dx > 0 && currentIdx > 0) {
      navigate(NAV_ITEMS[currentIdx - 1].path);
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      const start = touchRef.current;
      if (!start) return;
      const end = e.changedTouches[0];
      const dx = end.clientX - start.x;
      const dy = end.clientY - start.y;
      const dt = Date.now() - start.time;
      // Primarily horizontal, >70px, <400ms
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && dt < 400) {
        handleSwipe(dx);
      }
      touchRef.current = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [handleSwipe]);

  return (
    <div className={styles.shell}>
      {/* Desktop Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.logo}>땅콩패밀리</span>
        </div>
        <nav className={styles.sidebarNav}>
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
          <a
            href={EXTERNAL_URL}
            className={styles.navItem}
            target="_blank"
            rel="noopener noreferrer"
          >
            <PeanutIcon />
            <span>콩땅</span>
          </a>
        </nav>
        <div className={styles.sidebarFooter}>
          {canInstall && (
            <button onClick={install} className={styles.installBtn}>
              <DownloadIcon />
              앱 설치하기
            </button>
          )}
          <div className={styles.userInfo}>
            {user.profileImage ? (
              <img src={user.profileImage} alt="" className={styles.avatar} />
            ) : (
              <div className={styles.avatarFallback}>{user.name[0]}</div>
            )}
            <span className={styles.userName}>{user.name}</span>
          </div>
          <button onClick={onLogout} className={styles.logoutBtn}>로그아웃</button>
        </div>
      </aside>

      {/* Mobile Install Banner */}
      {canInstall && (
        <div className={styles.installBanner}>
          <span>땅콩패밀리 앱을 설치하세요!</span>
          <button onClick={install}>설치</button>
        </div>
      )}

      {/* Content */}
      <main ref={contentRef} className={styles.content}>
        <Routes>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home/*" element={<Home user={user} />} />
          <Route path="gallery/*" element={<Gallery user={user} />} />
          <Route path="parenting/*" element={<Parenting user={user} />} />
          <Route path="life/*" element={<Life user={user} />} />
          <Route path="settings/*" element={<Settings user={user} onLogout={onLogout} />} />
        </Routes>
      </main>

      {/* Mobile Bottom Tab */}
      <nav className={styles.bottomTab}>
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `${styles.tabItem} ${isActive ? styles.tabItemActive : ''}`
            }
          >
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
        <a
          href={EXTERNAL_URL}
          className={styles.tabItem}
          target="_blank"
          rel="noopener noreferrer"
        >
          <PeanutIcon />
          <span>콩땅</span>
        </a>
      </nav>
    </div>
  );
}

// ============================================================
// Icons (simple SVG)
// ============================================================

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function TodoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function ParentingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4-4z" />
      <path d="M16 22v-1a4 4 0 0 0-8 0v1" />
      <circle cx="17.5" cy="15.5" r="2.5" />
      <path d="M20 22v-.5a2.5 2.5 0 0 0-5 0v.5" />
    </svg>
  );
}

function LifeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function PeanutIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="7.5" r="4.5" />
      <circle cx="12" cy="16.5" r="4.5" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
