import MORE from './verses-more.json';

/**
 * 이민 탭에 띄우는 말씀 (개역개정) 104구절. 하람이 불안할 때 마음을 붙잡아 줄 구절 —
 * 두려움·염려·떠남·지키심. `short`는 진입 연출 끝에 잠깐 보이는 구절로, 반드시 본문의 일부 그대로.
 * 본문은 대한성서공회(bskorea.or.kr, 개역개정) 원문과 대조했다(2026-10-06). 끝의 인용 어미
 * ('하시니라' '하고' 등)만 뺐다. 추가 88구절은 verses-more.json.
 */
export interface Verse {
  ref: string;
  text: string;
  short: string;
}

export const VERSES: Verse[] = [
  {
    ref: '여호수아 1:9',
    text: '내가 네게 명령한 것이 아니냐 강하고 담대하라 두려워하지 말며 놀라지 말라 네가 어디로 가든지 네 하나님 여호와가 너와 함께 하느니라',
    short: '강하고 담대하라',
  },
  {
    ref: '이사야 41:10',
    text: '두려워하지 말라 내가 너와 함께 함이라 놀라지 말라 나는 네 하나님이 됨이라 내가 너를 굳세게 하리라 참으로 너를 도와 주리라 참으로 나의 의로운 오른손으로 너를 붙들리라',
    short: '두려워하지 말라 내가 너와 함께 함이라',
  },
  {
    ref: '시편 139:9-10',
    text: '내가 새벽 날개를 치며 바다 끝에 가서 거주할지라도 거기서도 주의 손이 나를 인도하시며 주의 오른손이 나를 붙드시리이다',
    short: '거기서도 주의 손이 나를 인도하시며',
  },
  {
    ref: '시편 121:8',
    text: '여호와께서 너의 출입을 지금부터 영원까지 지키시리로다',
    short: '너의 출입을 지금부터 영원까지 지키시리로다',
  },
  {
    ref: '창세기 28:15',
    text: '내가 너와 함께 있어 네가 어디로 가든지 너를 지키며 너를 이끌어 이 땅으로 돌아오게 할지라 내가 네게 허락한 것을 다 이루기까지 너를 떠나지 아니하리라',
    short: '네가 어디로 가든지 너를 지키며',
  },
  {
    ref: '신명기 31:8',
    text: '그리하면 여호와 그가 네 앞에서 가시며 너와 함께 하사 너를 떠나지 아니하시며 버리지 아니하시리니 너는 두려워하지 말라 놀라지 말라',
    short: '여호와 그가 네 앞에서 가시며',
  },
  {
    ref: '빌립보서 4:6-7',
    text: '아무 것도 염려하지 말고 다만 모든 일에 기도와 간구로 너희 구할 것을 감사함으로 하나님께 아뢰라 그리하면 모든 지각에 뛰어난 하나님의 평강이 그리스도 예수 안에서 너희 마음과 생각을 지키시리라',
    short: '아무 것도 염려하지 말고',
  },
  {
    ref: '베드로전서 5:7',
    text: '너희 염려를 다 주께 맡기라 이는 그가 너희를 돌보심이라',
    short: '너희 염려를 다 주께 맡기라',
  },
  {
    ref: '마태복음 6:34',
    text: '그러므로 내일 일을 위하여 염려하지 말라 내일 일은 내일이 염려할 것이요 한 날의 괴로움은 그 날로 족하니라',
    short: '내일 일은 내일이 염려할 것이요',
  },
  {
    ref: '잠언 3:5-6',
    text: '너는 마음을 다하여 여호와를 신뢰하고 네 명철을 의지하지 말라 너는 범사에 그를 인정하라 그리하면 네 길을 지도하시리라',
    short: '네 길을 지도하시리라',
  },
  {
    ref: '요한복음 14:27',
    text: '평안을 너희에게 끼치노니 곧 나의 평안을 너희에게 주노라 내가 너희에게 주는 것은 세상이 주는 것과 같지 아니하니라 너희는 마음에 근심하지도 말고 두려워하지도 말라',
    short: '너희는 마음에 근심하지도 말고 두려워하지도 말라',
  },
  {
    ref: '이사야 40:31',
    text: '오직 여호와를 앙망하는 자는 새 힘을 얻으리니 독수리가 날개치며 올라감 같을 것이요 달음박질하여도 곤비하지 아니하겠고 걸어가도 피곤하지 아니하리로다',
    short: '여호와를 앙망하는 자는 새 힘을 얻으리니',
  },
  {
    ref: '예레미야 29:11',
    text: '여호와의 말씀이니라 너희를 향한 나의 생각을 내가 아나니 평안이요 재앙이 아니니라 너희에게 미래와 희망을 주는 것이니라',
    short: '너희에게 미래와 희망을 주는 것이니라',
  },
  {
    ref: '시편 46:1',
    text: '하나님은 우리의 피난처시요 힘이시니 환난 중에 만날 큰 도움이시라',
    short: '하나님은 우리의 피난처시요 힘이시니',
  },
  {
    ref: '로마서 8:28',
    text: '우리가 알거니와 하나님을 사랑하는 자 곧 그의 뜻대로 부르심을 입은 자들에게는 모든 것이 합력하여 선을 이루느니라',
    short: '모든 것이 합력하여 선을 이루느니라',
  },
  {
    ref: '시편 23:1',
    text: '여호와는 나의 목자시니 내게 부족함이 없으리로다',
    short: '여호와는 나의 목자시니',
  },
  ...(MORE as Verse[]),
];

// 들어올 때마다 다른 말씀. 바로 전에 본 구절은 피한다.
const LAST_KEY = 'immVerse';

export function pickVerseIndex(): number {
  let last = -1;
  try { last = Number(localStorage.getItem(LAST_KEY) ?? -1); } catch { /* 무시 */ }
  let i = Math.floor(Math.random() * VERSES.length);
  if (i === last) i = (i + 1) % VERSES.length;
  rememberVerse(i);
  return i;
}

export function rememberVerse(i: number) {
  try { localStorage.setItem(LAST_KEY, String(i)); } catch { /* 무시 */ }
}

// 말씀은 명조(고운바탕)로. 구글 폰트가 글자 범위별로 쪼개 주므로 화면에 나온 글자 조각만 내려받는다.
let fontRequested = false;
export function loadVerseFont() {
  if (fontRequested || typeof document === 'undefined') return;
  fontRequested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap';
  document.head.appendChild(link);
}
