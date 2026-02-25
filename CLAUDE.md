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

---

## Project: 땅콩페밀리

가족용 종합 웹앱. 갤러리, 캘린더, 할일, 노트, LLM 연동을 포함하는 가족 플랫폼.
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
  routes/
    media.ts         # 갤러리 업로드/목록/삭제
    interaction.ts   # 좋아요/댓글/확인/다운로드
    user.ts          # 사용자 관리
    calendar.ts      # 캘린더 CRUD + 반복일정
    todo.ts          # 할일 CRUD + 완료 플로우
    note.ts          # 노트 CRUD
    llm.ts           # LLM 설정 관리

src/                 # React frontend
  pages/Login, Gallery, Calendar, Todos, Notes, Settings
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
**LLM**: llm_configs, llm_health_logs

### NAS 접속

```bash
# SSH
ssh -i ~/.ssh/nas_key -p 2222 syngha_han@syngha.synology.me

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
rsync -avz --rsync-path=/usr/bin/rsync -e "ssh -i ~/.ssh/nas_key -p 2222" --exclude=node_modules --exclude=dist --exclude=data --exclude=.git --exclude=.env ./ syngha_han@syngha.synology.me:/volume1/docker/peanut-family/

# 2. NAS에서 빌드 & 재시작
ssh -i ~/.ssh/nas_key -p 2222 syngha_han@syngha.synology.me "cd /volume1/docker/peanut-family && export PATH=/usr/local/bin:\$PATH && docker compose build && docker compose down && docker compose up -d"
```

#### rsync "Permission denied" 트러블슈팅

1. SSH 단독 테스트: `ssh -i ~/.ssh/nas_key -p 2222 syngha_han@syngha.synology.me "echo ok"`
2. rsync에 `--rsync-path=/usr/bin/rsync` 추가
3. `-e "ssh -v -i ..."` 로 verbose 로그 확인
4. NAS DSM > Control Panel > Terminal & SNMP > rsync 서비스 확인

### Commands

```bash
# Dev
npm run dev          # Vite dev server (frontend, port 5174)
npm run dev:server   # Fastify dev server (backend, port 2290)

# Build & Deploy
docker compose up --build
```
