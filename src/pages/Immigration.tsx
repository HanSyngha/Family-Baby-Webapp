import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ImmSummary, User } from '../api';
import { isNativeApp } from '../lib/backup';
import { usePushNotification } from '../hooks/usePushNotification';
import Agendas from '../components/immigration/Agendas';
import { DoneTab, TodoTab, useImmItems } from '../components/immigration/Items';
import { BoardingPass, DepartureIntro, INTRO_STYLES, SCENES, VerseCard, nextIntroStyle, pickIntroStyle } from '../components/immigration/Departure';
import { pickVerseIndex } from '../components/immigration/verses';
import { CHEER_PHOTO_IDS } from '../components/immigration/intro/cheer';
import styles from './Immigration.module.css';

/**
 * 이민 탭 — 승하·하람 둘이 싱가포르 이주 준비를 같이 결정하고 기록하는 곳.
 *   안건: 올리고 → 의견/질문 → 둘 다 찬성하면 확정
 *   할 일: 날짜·사람 칩으로 빠르게 추가 → 체크하면 완료로
 *   완료: 한 일과 "대기중" 같은 상태 기록, 최신순
 */

interface Props {
  user: User;
  summary: ImmSummary | null;
  onChanged: () => void;
}

type SubTab = 'agenda' | 'todo' | 'done';
const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'todo', label: '할 일' },
  { value: 'done', label: '완료' },
];
const TAB_KEY = 'immTab';

export default function Immigration({ user, summary, onChanged }: Props) {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<SubTab>(() => {
    const q = params.get('tab');
    if (q === 'agenda' || q === 'todo' || q === 'done') return q;
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === 'agenda' || saved === 'todo' || saved === 'done') return saved;
    } catch { /* 무시 */ }
    return 'agenda';
  });
  const items = useImmItems();
  // 들어올 때마다 다른 말씀 — 도장 직후 짧게, 탭 머리엔 전체 구절
  const [verse, setVerse] = useState(pickVerseIndex);
  // 진입 연출: 4가지 중 직전과 다른 것. 탑승권을 누르면 다음 연출 + 새 말씀으로 다시 본다.
  const [intro, setIntro] = useState(() => ({ style: pickIntroStyle(), run: 0 }));
  const replayIntro = () => {
    setVerse(pickVerseIndex());
    setIntro(cur => ({ style: nextIntroStyle(cur.style), run: cur.run + 1 }));
  };

  // 알림을 눌러 ?tab=agenda로 들어오면 그 탭으로 (주소는 깔끔하게 되돌린다)
  useEffect(() => {
    const q = params.get('tab');
    if (q === 'agenda' || q === 'todo' || q === 'done') {
      setTab(q);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  // 이 탭만 '밤의 출국장' 테마: body 배경·시트(포털)까지 어둡게, 브라우저 상단 색도 맞춘다.
  useEffect(() => {
    document.body.classList.add('immDark');
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute('content');
    meta?.setAttribute('content', '#070D18');
    return () => {
      document.body.classList.remove('immDark');
      if (prev) meta?.setAttribute('content', prev);
    };
  }, []);

  const choose = (t: SubTab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* 무시 */ }
  };

  const people = summary?.people ?? [];
  // 하람이 하트 누른 설이 사진이 4장 이상이면 그걸로, 아니면 기본 사진으로 '엄마' 응원 연출
  const cheerPhotos = (summary?.cheerPhotoIds?.length ?? 0) >= 4 ? summary!.cheerPhotoIds : CHEER_PHOTO_IDS;
  const counts: Record<SubTab, number> = {
    agenda: summary?.pendingVotes ?? 0,
    todo: items.data?.todo.length ?? 0,
    done: 0,
  };

  return (
    <div className={styles.layout}>
      <DepartureIntro
        key={intro.run}
        style={intro.style}
        verseIndex={verse}
        photos={cheerPhotos}
        label={intro.run > 0 ? `${INTRO_STYLES.indexOf(intro.style) + 1}/${INTRO_STYLES.length} · ${SCENES[intro.style]?.name}` : undefined}
      />
      <h1 className={styles.srOnly}>이민</h1>
      <BoardingPass onReplay={replayIntro} />
      <VerseCard index={verse} onChange={setVerse} />

      <div className={styles.subTabs}>
        <div className={styles.subTabTrack} role="tablist">
          {SUB_TABS.map(({ value, label }) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className={`${styles.subTab} ${tab === value ? styles.subTabActive : ''}`}
              onClick={() => choose(value)}
            >
              {label}
              {counts[value] > 0 && (
                <span className={value === 'agenda' ? styles.subTabBadgeAlert : styles.subTabBadge}>{counts[value]}</span>
              )}
            </button>
          ))}
          <div
            className={styles.subTabIndicator}
            style={{ transform: `translateX(${SUB_TABS.findIndex(t => t.value === tab) * 100}%)`, width: `${100 / SUB_TABS.length}%` }}
          />
        </div>
      </div>

      <PushNotice />

      {people.length === 0 ? (
        <div className={styles.section}><div className={styles.skeletonCard} /></div>
      ) : (
        <>
          <div style={{ display: tab === 'agenda' ? 'block' : 'none' }}>
            <Agendas people={people} myId={user.id} onChanged={onChanged} />
          </div>
          <div style={{ display: tab === 'todo' ? 'block' : 'none' }}>
            <TodoTab items={items} people={people} myId={user.id} />
          </div>
          <div style={{ display: tab === 'done' ? 'block' : 'none' }}>
            <DoneTab items={items} people={people} />
          </div>
        </>
      )}
    </div>
  );
}

// 안드로이드 앱(WebView)은 웹 푸시를 받을 수 없다. 알림은 크롬에서 한 번 켜 둬야 온다.
const HINT_KEY = 'immPushHintDismissed';
const SITE = 'https://syngha.synology.me:2290/immigration';

function PushNotice() {
  const { pushState, togglePush } = usePushNotification(true);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
  });
  const [copied, setCopied] = useState(false);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* 무시 */ }
  };

  if (dismissed) return null;

  if (isNativeApp) {
    return (
      <div className={styles.notice} role="note">
        <span className={styles.noticeText}>
          앱에서는 알림이 안 와요. 크롬에서 이 주소를 열고 <b>알림 켜기</b>를 한 번 눌러 두세요.
        </span>
        <div className={styles.noticeActions}>
          <button
            className={styles.noticeBtn}
            onClick={() => {
              navigator.clipboard?.writeText(SITE).then(() => setCopied(true)).catch(() => {});
            }}
          >
            {copied ? '복사됨' : '주소 복사'}
          </button>
          <button className={styles.noticeClose} onClick={dismiss} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    );
  }

  if (pushState === 'off') {
    return (
      <div className={styles.notice} role="note">
        <span className={styles.noticeText}>투표 알림을 받으려면 이 기기에서 알림을 켜 주세요.</span>
        <div className={styles.noticeActions}>
          <button className={styles.noticeBtn} onClick={togglePush}>알림 켜기</button>
          <button className={styles.noticeClose} onClick={dismiss} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    );
  }

  if (pushState === 'denied') {
    return (
      <div className={styles.notice} role="note">
        <span className={styles.noticeText}>알림이 차단돼 있어요. 브라우저 사이트 설정에서 알림을 허용해 주세요.</span>
        <div className={styles.noticeActions}>
          <button className={styles.noticeClose} onClick={dismiss} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    );
  }

  return null;
}
