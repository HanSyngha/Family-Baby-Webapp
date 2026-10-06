// 이민 탭 초기 기록 (2026-10-06, 승하 확인). 이민 테이블이 비어 있을 때만 한 번 넣는다.
// 사용: node scripts/seed_immigration.mjs [DB 경로]   (컨테이너: docker exec -i <c> node --input-type=module - < 이 파일)
// DB에 직접 넣으므로 '새 안건' 알림은 나가지 않는다. 안건 미투표 알림은 4시간 뒤부터 정상 동작.
import Database from 'better-sqlite3';

const dbPath = process.argv[2] || 'data/peanut-family.db';
const db = new Database(dbPath);
db.pragma('busy_timeout = 10000');

const SEUNGHA = 1;
const HARAM = 3;

const names = db.prepare('SELECT id, name FROM users WHERE id IN (?, ?)').all(SEUNGHA, HARAM);
if (names.length !== 2 || !names.some(u => u.id === SEUNGHA && u.name === '한승하') || !names.some(u => u.id === HARAM && u.name === '황하람')) {
  console.error('사용자 id가 예상과 다릅니다 — 중단', names);
  process.exit(1);
}

const existing = db.prepare('SELECT (SELECT COUNT(*) FROM imm_items) + (SELECT COUNT(*) FROM imm_agendas) AS n').get().n;
if (existing > 0) {
  console.log(`이미 이민 기록이 ${existing}건 있어 건너뜁니다.`);
  process.exit(0);
}

const done = [
  ['2026-09-10', 'done', '구글 오퍼 레터 서명', ''],
  ['2026-09-11', 'done', '비자 서류 3인분 제출', '딜로이트 Cobalt'],
  ['2026-09-16', 'done', '학력 검증 완료 · Cartus 이사 지원 웰컴콜', '포인트 85'],
  ['2026-09-23', 'done', '이사 지원 패키지 확정', '임시숙소 2BR 90일 · 해상 이삿짐 · 집 구하기 대행 · 중개수수료 · 보관 연장 · 현금'],
  ['2026-09-28', 'done', '임시숙소 Quincy House 선택', '홀랜드빌리지'],
  ['2026-09-29', 'done', 'MOM에 EP 접수', ''],
  ['2026-09-30', 'done', '이삿짐 답사 일정 확정', '11/4(수) 10:30 · Moves Korea'],
  ['2026-10-05', 'done', '입사일 11/30 확정 요청 → Gordon 동의', '새 레터 서명 대기'],
  ['2026-10-06', 'done', 'EP 승인(IPA)', 'MOM 조회 · 만료 2027-04-02'],
  ['2026-10-06', 'done', '항공권 결제', '11/28 중국동방 비즈니스 3인 · 인천 12:55 → 상하이 → 창이 22:00'],
  ['2026-10-06', 'done', '구글 사용자 이름 확정', 'syngha@google.com'],
  ['2026-10-06', 'waiting', 'DP(아내·아기) 대기중', 'MOM 조회에 아직 기록 없음'],
];

const todo = [
  ['2026-10-07', SEUNGHA, '딜로이트에 IPA 레터·DP 문의', ''],
  ['2026-10-07', SEUNGHA, 'Cartus에 임시숙소 하루 당기기·택배 보관 문의', '11/28~2/25'],
  ['2026-10-13', SEUNGHA, '회사 통보', ''],
  ['2026-10-26', SEUNGHA, '노트북 주문 제출', ''],
  ['2026-11-04', null, '이삿짐 답사', '10:30'],
  ['2026-11-27', null, '이삿짐 포장', ''],
  ['2026-11-28', null, '출국', ''],
];

db.transaction(() => {
  const insDone = db.prepare('INSERT INTO imm_items (title, memo, status, doneDate, creatorId) VALUES (?, ?, ?, ?, ?)');
  for (const [date, status, title, memo] of done) insDone.run(title, memo, status, date, SEUNGHA);

  const insTodo = db.prepare("INSERT INTO imm_items (title, memo, dueDate, assigneeId, status, creatorId) VALUES (?, ?, ?, ?, 'todo', ?)");
  for (const [date, who, title, memo] of todo) insTodo.run(title, memo, date, who, SEUNGHA);

  db.prepare('INSERT INTO imm_agendas (authorId, title, body) VALUES (?, ?, ?)').run(
    SEUNGHA,
    '하람이 싱가포르에서 미리 살 물건',
    '임시숙소로 택배 주문 — 체크인 전에 보관되는지 확인 중',
  );
})();

console.log(`넣음: 완료 ${done.length}건 · 할 일 ${todo.length}건 · 안건 1건`);
