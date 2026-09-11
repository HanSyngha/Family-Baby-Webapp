import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'me.synology.syngha.peanutfamily',
  appName: '땅콩페밀리',
  webDir: 'dist/public',
  server: {
    // WebView가 NAS 라이브 사이트를 직접 로드한다.
    // → UI/기능 변경은 웹 배포만으로 앱에 즉시 반영(APK 재설치 불필요).
    // → 쿠키/OAuth는 해당 origin의 일반 브라우저 컨텍스트라 그대로 동작.
    url: 'https://syngha.synology.me:2290',
    androidScheme: 'https',
    // 서버 못 닿을 때 흰 화면 대신 번들된 안내 페이지(webDir 기준 경로)
    errorPath: 'offline.html',
    // 카카오/네이버 OAuth 도메인을 WebView 내부에서 열도록 허용.
    // (없으면 server.url 호스트 밖 이동을 외부 크롬으로 던져서 로그인이 앱을 이탈한다)
    allowNavigation: [
      'kauth.kakao.com', 'accounts.kakao.com', '*.kakao.com', '*.kakaocdn.net', '*.daumcdn.net',
      'nid.naver.com', '*.naver.com', '*.pstatic.net',
      'syngha.synology.me', 'syngha.synology.me:2280',
    ],
  },
  android: {
    // targetSdk 36(Play 필수)부터 Android 15+ 기기에서 엣지투엣지가 강제된다.
    // WebView가 상태바/내비게이션바 아래로 깔리지 않게 Capacitor가 마진을 넣어 준다.
    adjustMarginsForEdgeToEdge: 'auto',
  },
};

export default config;
