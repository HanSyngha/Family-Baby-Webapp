# 땅콩페밀리

가족 전용 올인원 웹앱. 사진 갤러리, 육아 기록, 캘린더, 할일, 노트를 하나의 앱에서.

PWA로 설치하면 네이티브 앱처럼 사용 가능합니다.

## 주요 기능

- **갤러리** — 사진/영상 업로드, 자동 썸네일, HLS 스트리밍, 좋아요/댓글
- **육아** — 수유/수면 기록, LLM 기반 다음 수유 예측, 성장 요약
- **캘린더** — 일정 관리, 반복 일정, 참여자 지정
- **할일** — 할당/완료 플로우, 가족 간 공유
- **노트** — 토픽별 메모, 마크다운 지원
- **푸시 알림** — Web Push로 새 사진/일정 알림
- **카카오/네이버 로그인** — OAuth 소셜 로그인

## 빠른 시작

### 1. 클론

```bash
git clone git@github.com:HanSyngha/Family-Baby-Webapp.git
cd Family-Baby-Webapp
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열고 값을 채웁니다:

| 변수 | 설명 | 필수 |
|------|------|------|
| `KAKAO_CLIENT_ID` | [Kakao Developers](https://developers.kakao.com) REST API 키 | O |
| `KAKAO_CLIENT_SECRET` | Kakao 클라이언트 시크릿 | O |
| `NAVER_CLIENT_ID` | [Naver Developers](https://developers.naver.com) Client ID | - |
| `NAVER_CLIENT_SECRET` | Naver Client Secret | - |
| `JWT_SECRET` | JWT 서명용 랜덤 문자열 | O |
| `BASE_URL` | 서비스 접속 URL (예: `https://my.domain:2290`) | O |
| `VAPID_PUBLIC_KEY` | Web Push 공개키 | - |
| `VAPID_PRIVATE_KEY` | Web Push 비밀키 | - |

> **VAPID 키 생성**: `npx web-push generate-vapid-keys`

### 3. 실행

```bash
docker compose up -d
```

`http://localhost:2290` 으로 접속합니다.

## OAuth 설정 가이드

### Kakao 로그인

1. [Kakao Developers](https://developers.kakao.com)에서 애플리케이션 생성
2. **앱 키** > REST API 키 → `KAKAO_CLIENT_ID`
3. **보안** > Client Secret 생성 → `KAKAO_CLIENT_SECRET`
4. **카카오 로그인** > 활성화
5. **Redirect URI** 추가: `{BASE_URL}/api/auth/kakao/callback`
6. **동의항목**: 프로필 정보, 닉네임 활성화

### Naver 로그인 (선택)

1. [Naver Developers](https://developers.naver.com)에서 애플리케이션 등록
2. **사용 API**: 네아로 (네이버 아이디로 로그인)
3. Client ID / Secret → `.env`에 입력
4. **Callback URL**: `{BASE_URL}/api/auth/naver/callback`

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | React 19 + Vite + TypeScript |
| Backend | Fastify + TypeScript |
| Database | SQLite (WAL mode, better-sqlite3) |
| 이미지 처리 | Sharp (WebP 썸네일) |
| 비디오 | ffmpeg (HLS 변환) |
| 인증 | Kakao/Naver OAuth → JWT |
| 배포 | Docker (단일 컨테이너) |

## 데이터

모든 데이터는 `./data/` 디렉토리에 저장됩니다:

```
data/
├── originals/        # 원본 사진/영상
├── thumbnails/       # WebP 썸네일
├── hls/              # HLS 비디오 세그먼트
└── peanut-family.db  # SQLite DB
```

볼륨 마운트이므로 컨테이너를 재빌드해도 데이터가 유지됩니다.

## 갤러리 앱 연동 (선택)

친척/지인과 사진을 공유하고 싶다면 [Family-Baby-Gallery](https://github.com/HanSyngha/Family-Baby-Gallery)를 함께 사용할 수 있습니다.

Family-Baby-Gallery는 사진/영상 공유에 특화된 별도 앱으로, 이 앱과 데이터를 공유하여 연동할 수 있습니다.

연동 방법은 [Family-Baby-Gallery README](https://github.com/HanSyngha/Family-Baby-Gallery)를 참고하세요.

## 로컬 개발

```bash
npm install

# 프론트엔드 (port 5174)
npm run dev

# 백엔드 (port 2290)
npm run dev:server
```

## 라이선스

MIT
