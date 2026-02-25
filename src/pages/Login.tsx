import styles from './Login.module.css';

export default function Login() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrap}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#007AFF" />
            <text x="24" y="33" textAnchor="middle" fill="white" fontSize="24">P</text>
          </svg>
        </div>
        <h1 className={styles.title}>땅콩페밀리</h1>
        <p className={styles.subtitle}>우리 가족 종합 앱</p>

        <div className={styles.buttons}>
          <a href="/api/auth/kakao" className={styles.kakao}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#3d1d00">
              <path d="M12 3C6.48 3 2 6.36 2 10.44c0 2.62 1.75 4.93 4.38 6.24l-1.12 4.16c-.1.36.3.65.62.45l4.97-3.27c.37.03.75.05 1.15.05 5.52 0 10-3.36 10-7.63S17.52 3 12 3z"/>
            </svg>
            카카오로 시작하기
            <span className={styles.recommend}>권장</span>
          </a>
          <a href="/api/auth/naver" className={styles.naver}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff">
              <path d="M14.4 12.6L9.3 5H5v14h4.6v-7.6L14.7 19H19V5h-4.6z"/>
            </svg>
            네이버로 시작하기
          </a>
        </div>
      </div>
    </div>
  );
}
