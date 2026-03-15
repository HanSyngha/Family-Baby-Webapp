# CLAUDE.md

## Behavioral Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

**CRITICAL: NAS 데이터 절대 삭제 금지.** `/data/originals`, `/data/thumbnails`, `peanut-family.db`를 삭제하거나 초기화하지 마라. 스키마 변경이 필요하면 마이그레이션으로 처리. 사용자가 명시적으로 요청하더라도 반드시 한 번 더 확인받아라.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

### 5. 배포 후 테스트 필수 (CRITICAL)

**기능 구현 완료 후 반드시 NAS에 배포하고, 실제 프로덕션 URL(https://syngha.synology.me:2290)에서 테스트한다.**

- 로컬 dev 서버 테스트만으로 "완료" 보고 절대 금지
- 배포: rsync → docker compose build → docker compose up -d
- 테스트: Playwright로 프로덕션 URL 접속, 실 유저처럼 다양한 폼팩터에서 검증
  - Galaxy S (360px), Galaxy Fold 접힌 (280px), 태블릿 (768px), TV (1920px)
- 모든 CRUD 동작, 네비게이션, 애니메이션, 반응형 레이아웃 확인
- 테스트 통과 전까지 완료 보고하지 않는다

---

## UI/UX 최우선 원칙

**이 앱에서 가장 중요한 것은 UI/UX. 세계 최고 수준을 목표로 한다.**

모든 기능 구현 시 아래 원칙을 반드시 따른다:

### 디자인 퀄리티
- 모든 UI는 프리미엄 네이티브 앱 수준으로 구현 (iOS Human Interface Guidelines 참고)
- 애니메이션/트랜지션은 자연스럽고 의도적으로. 없는 것보다 어설픈 게 나쁘다
- 터치 타겟 최소 44px. 모바일 우선. 한 손 조작 최적화
- 색상, 타이포그래피, 여백 일관성 유지. 디자인 토큰 기반
- 로딩/빈 상태/에러 상태 모두 디자인된 UI로 처리 (skeleton, empty state illustration 등)

### 반응형 디자인 검증 (필수)

**모든 UI 변경 시 아래 디바이스에서 깨짐 없이 완벽하게 동작하는지 확인한다:**

- **Galaxy S 시리즈** (360~412px) — 모바일 기본 타겟
- **Galaxy Fold** (280px 접힌 상태 / 717px 펼친 상태) — 폴더블 대응 필수
- **태블릿** (768~1024px) — 사이드바 전환 구간, 레이아웃 깨짐 주의
- **TV/대형 화면** (1920px+) — 과도한 여백, 콘텐츠 늘어짐 방지

체크리스트:
- 텍스트 잘림/넘침 없음
- 터치 타겟 겹침 없음
- 모달/오버레이 정상 표시
- 가로/세로 전환 시 레이아웃 유지
- Fold 접힌 상태(280px)에서도 핵심 기능 사용 가능

### 네비게이션 아키텍처

기능이 계속 추가되므로 바텀 탭은 **최대 5개 카테고리로 영원히 고정**. 새 기능은 카테고리 안에 서브탭/섹션으로 추가한다.

```
바텀 탭 (고정, 절대 늘리지 않음)
──────────────────────────────
  홈      갤러리    육아     생활     설정
──────────────────────────────
```

- **홈**: 대시보드. 오늘 요약 위젯 (마지막 수유, 오늘 일정, 할일 등). 퀵액션 버튼
- **갤러리**: 사진/영상 (현재 그대로)
- **육아**: 수유/수면/이유식/성장기록 등. 페이지 내 서브탭으로 확장. 아이가 크면서 기능 추가
- **생활**: 캘린더/할일/노트. 페이지 내 서브탭으로 묶음
- **설정**: 설정, LLM 관리, 사용자 정보

카테고리 내 서브탭은 페이지 상단 pill/segment 스타일로 구현. 깊이는 최대 2단계.

### 인터랙션 원칙
- 중요한 액션(수유 시작 등)은 FAB 또는 눈에 띄는 CTA로
- 파괴적 액션(삭제)은 반드시 확인 단계
- 즉각적인 피드백 (optimistic update, haptic-style 반응)
- 자주 쓰는 기능일수록 적은 탭으로 도달 가능하게

---

## Project: 땅콩페밀리

가족용 종합 웹앱. 갤러리, 캘린더, 할일, 노트, 육아(수유/성장), LLM 연동을 포함하는 가족 플랫폼.
아이(설이)가 크면서 육아 기능이 계속 확장될 예정.
Synology DS720+ NAS에서 Docker로 운영. PWA로 제공.
서비스명: 땅콩페밀리

### Tech Stack

- **Backend**: Node.js + Fastify (TypeScript)
- **Frontend**: React 19 + Vite (TypeScript)
- **DB**: SQLite (better-sqlite3), WAL mode
- **Image Processing**: Sharp (libvips) - 300px WebP thumbnails
- **Video Thumbnails**: ffmpeg
- **Auth**: Kakao/Naver OAuth -> JWT
- **Deployment**: Docker Compose, single container, port 2290

### Architecture

단일 컨테이너. Nginx 없음. Fastify가 API + SPA 정적 파일 + 미디어 서빙 전부 처리.

```
/data/originals/   - 원본 사진/영상
/data/thumbnails/  - 300px WebP 썸네일
/data/hls/         - HLS 비디오 세그먼트
/data/peanut-family.db - SQLite DB
```

### Project Structure

```
server/              # Fastify backend
  index.ts           # 서버 진입점
  db.ts              # SQLite 초기화 + 전체 스키마
  auth.ts            # OAuth + JWT
  push.ts            # Web Push 알림
  media-processor.ts # Sharp + ffmpeg
  upload-queue.ts    # FIFO 처리 큐
  llm-client.ts      # LLM API 클라이언트 (OpenAI-compatible)
  llm-health.ts      # LLM 헬스체크 (5초 주기)
  baby-predictor.ts  # LLM 기반 수유/수면 예측
  routes/
    media.ts         # 갤러리 업로드/목록/삭제
    interaction.ts   # 좋아요/댓글/확인/다운로드
    user.ts          # 사용자 관리
    calendar.ts      # 캘린더 CRUD + 반복일정
    todo.ts          # 할일 CRUD + 완료 플로우
    note.ts          # 노트 CRUD
    llm.ts           # LLM 설정 관리
    baby.ts          # 수유/수면/설정/요약 CRUD

src/                 # React frontend
  pages/Login, Gallery, Home, Parenting, Life, Settings
  components/layout/AppShell, Sidebar, BottomTab
  components/gallery/MediaGrid, MediaCard, Lightbox, UploadModal
  components/calendar/CalendarGrid, EventModal
  components/todos/TodoList, TodoItem, CompletionDialog
  components/notes/TopicList, NoteEditor, NoteView
  hooks/useAuth, useUploadQueue, useCalendarEvents, useTodos, useNotes
  api.ts             # API 클라이언트
```

### Key Conventions

- 모든 시스템 KST 기준 고정
- 파일명은 UUID 기반 (캐시 immutable 전략)
- 커서 기반 페이지네이션 (offset 사용 금지)
- LLM 실패시 retry 2회 후 raw input 기반 fallback
- 수정/삭제는 모두에게 개방 (가족 전용)
- isPrivate 컬럼으로 개인 공간 제공
- 로그를 꼼꼼하게 (모든 상황 디버깅 가능)

### OAuth 설정

- **Kakao**: 개발자콘솔 앱 이름 "Hanseol Dashboard" (ID 1378312)
  - Client ID(REST API KEY) + Redirect URI + 클라이언트 시크릿
- **Naver**: 네이버 개발자센터
- `.env`의 `BASE_URL`이 OAuth 콜백 URL의 기반 (현재 `https://syngha.synology.me:2290`)
- **주의**: 새 포트(2290)에 대해 Kakao/Naver 개발자콘솔에서 Redirect URI 추가 필요

### HTTPS 구성

- Synology DSM 내장 Reverse Proxy 사용 (Control Panel > Login Portal > Advanced > Reverse Proxy)
- 규칙: `https://*:2290` → `http://localhost:12290`
- Docker는 `127.0.0.1:12290:2290`으로 바인딩 (외부 직접 접근 차단)
- **Reverse Proxy는 반드시 켜둬야 함** (SSL 처리 담당, 끄면 HTTPS 안 됨)
- SSL 인증서: Let's Encrypt (`syngha.synology.me`), 90일 자동갱신
  - 발급/관리: Control Panel > Security > Certificate
  - Reverse Proxy에 할당: Certificate > Settings > `*:2290` → `syngha.synology.me` 인증서 선택
- crypto.subtle (클라이언트 해시) 사용을 위해 HTTPS 필수

### DB Tables

**기존 (갤러리)**: users, media, views, downloads, likes, comments, favorites, shares, push_subscriptions
**캘린더**: calendar_events, calendar_recurrence, calendar_participants, calendar_reminders
**할일**: todos, todo_assignees
**노트**: note_topics, notes
**육아**: feedings, sleeps, baby_predictions, baby_settings
**LLM**: llm_configs, llm_health_logs

### NAS 접속

```bash
# SSH
ssh -p 7348 syngha_han@syngha.synology.me

# 프로젝트 경로
/volume1/docker/peanut-family/

# Docker 명령 (PATH 필요)
export PATH=/usr/local/bin:$PATH
docker compose build
docker compose down && docker compose up -d
docker logs peanut-family-peanut-family-1
```

### 배포 플로우

```bash
# 1. NAS로 rsync (변경분만 전송)
rsync -avz --rsync-path=/usr/bin/rsync -e "ssh -i ~/.ssh/nas_key -p 7348" --exclude=node_modules --exclude=dist --exclude=data --exclude=.git --exclude=.env ./ syngha_han@syngha.synology.me:/volume1/docker/peanut-family/

# 2. NAS에서 빌드 & 재시작
ssh -i ~/.ssh/nas_key -p 7348 syngha_han@syngha.synology.me "cd /volume1/docker/peanut-family && export PATH=/usr/local/bin:\$PATH && docker compose build && docker compose down && docker compose up -d"
```

#### NAS SSH 접속 정보
- **호스트**: syngha.synology.me (또는 122.38.19.77)
- **포트**: 7348
- **계정**: syngha_han
- **SSH 키**: `~/.ssh/nas_key` (ed25519)
- **비밀번호 (fallback)**: Test1234! (paramiko 사용 시)
- **홈 디렉토리**: 퍼미션 반드시 755 유지 (777이면 SSH 키 인증 거부됨)
- **Auto Block**: 10회 실패 / 5분 기준 IP 차단 주의

### Commands

```bash
# Dev
npm run dev          # Vite dev server (frontend, port 5174)
npm run dev:server   # Fastify dev server (backend, port 2290)

# Build & Deploy
docker compose up --build
```
