import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type User, type HomeSummary } from '../api';
import styles from './Home.module.css';

interface Props {
  user: User;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr.replace(' ', 'T'));
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  return `${Math.floor(diffH / 24)}일 전`;
}

function babyAge(birthDate: string): string {
  const bd = new Date(birthDate);
  const now = new Date();
  const months = (now.getFullYear() - bd.getFullYear()) * 12 + now.getMonth() - bd.getMonth();
  if (months < 1) {
    const days = Math.floor((now.getTime() - bd.getTime()) / 86400000);
    return `${days}일`;
  }
  if (months < 24) return `${months}개월`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}세 ${rem}개월` : `${years}세`;
}

function formatEventTime(startAt: string, allDay: boolean): string {
  if (allDay) return '종일';
  const parts = startAt.split(' ');
  if (parts.length < 2) return startAt;
  const time = parts[1].split(':');
  return `${time[0]}:${time[1]}`;
}

function formatEventDate(startAt: string): string {
  const parts = startAt.split(' ')[0].split('-');
  if (parts.length < 3) return startAt;
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

const LS_BREAST_TIMER = 'peanut_breast_timer';

export default function Home({ user }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [breastActive, setBreastActive] = useState<{ side: string; startedAt: number } | null>(null);

  // Check if breast timer is already running
  useEffect(() => {
    const saved = localStorage.getItem(LS_BREAST_TIMER);
    if (saved) {
      try { setBreastActive(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  const startBreast = (side: 'left' | 'right') => {
    const now = Date.now();
    const timer = { startedAt: now, side, isPaused: false, accumulatedMs: 0, lastResumedAt: now };
    localStorage.setItem(LS_BREAST_TIMER, JSON.stringify(timer));
    navigate('/parenting');
  };

  useEffect(() => {
    api.getHomeSummary()
      .then(setData)
      .catch(err => console.error('[Home] Load error:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className={styles.layout}>
        <div className={styles.pageHeader}>
          <div className={styles.brand}>
            <div className={styles.brandBlock}>
              <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
              <span className={styles.brandName}>땅콩패밀리</span>
            </div>
            <h1 className={styles.pageTitle}>홈</h1>
          </div>
        </div>
        <div className={styles.loading}><div className={styles.loadingSpinner} /></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.layout}>
        <div className={styles.pageHeader}>
          <div className={styles.brand}>
            <div className={styles.brandBlock}>
              <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
              <span className={styles.brandName}>땅콩패밀리</span>
            </div>
            <h1 className={styles.pageTitle}>홈</h1>
          </div>
        </div>
        <div className={styles.emptyText}>데이터를 불러오지 못했어요</div>
      </div>
    );
  }

  const { upcomingBirthdays, todayEvents, upcomingEvents, todoSummary } = data;
  const babySummaries = data.babySummaries || [];

  return (
    <div className={styles.layout}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.brand}>
          <div className={styles.brandBlock}>
            <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
            <span className={styles.brandName}>땅콩패밀리</span>
          </div>
          <h1 className={styles.pageTitle}>홈</h1>
        </div>
        <div className={styles.greeting}>
          {user.profileImage
            ? <img src={user.profileImage} alt="" className={styles.userAvatar} />
            : <div className={styles.userAvatarFallback}>{user.name[0]}</div>
          }
        </div>
      </div>

      {/* Baby Summaries (youngest first, always on top) */}
      {babySummaries.map((bs) => (
        <div key={bs.babyId} className={`${styles.card} ${styles.cardStagger1}`} onClick={() => navigate('/parenting')}>
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>👶</span>
            <span className={styles.cardTitle}>{bs.babyName}</span>
            {bs.babyBirthDate && (
              <span className={styles.cardBadge}>{babyAge(bs.babyBirthDate)}</span>
            )}
            <span className={styles.cardArrow}>›</span>
          </div>

          {/* Quick Breast Feeding inside baby card */}
          <div className={styles.quickFeedingInCard}>
            {breastActive ? (
              <button className={styles.quickFeedingActive} onClick={(e) => { e.stopPropagation(); navigate('/parenting'); }}>
                <span className={styles.quickFeedingPulse} />
                <span className={styles.quickFeedingIcon}>🤱</span>
                <span className={styles.quickFeedingText}>
                  수유 중 ({breastActive.side === 'left' ? '왼쪽' : '오른쪽'})
                </span>
                <span className={styles.quickFeedingArrow}>›</span>
              </button>
            ) : (
              <div className={styles.quickFeedingBtns}>
                <button className={styles.quickFeedingBtn} onClick={(e) => { e.stopPropagation(); startBreast('left'); }}>
                  <span className={styles.quickFeedingIcon}>🤱</span>
                  <span className={styles.quickFeedingLabel}>왼쪽 시작</span>
                </button>
                <button className={styles.quickFeedingBtn} onClick={(e) => { e.stopPropagation(); startBreast('right'); }}>
                  <span className={styles.quickFeedingIcon}>🤱</span>
                  <span className={styles.quickFeedingLabel}>오른쪽 시작</span>
                </button>
              </div>
            )}
          </div>

          <div className={styles.babyStats}>
            <div className={styles.babyStat}>
              <div className={styles.babyStatValue}>{bs.todayFeedingCount}</div>
              <div className={styles.babyStatLabel}>수유</div>
            </div>
            <div className={styles.babyStat}>
              <div className={styles.babyStatValue}>{bs.totalFormulaMl}<span className={styles.babyStatUnit}>ml</span></div>
              <div className={styles.babyStatLabel}>분유</div>
            </div>
            <div className={styles.babyStat}>
              <div className={styles.babyStatValue}>{bs.totalSleepMin}<span className={styles.babyStatUnit}>분</span></div>
              <div className={styles.babyStatLabel}>수면</div>
            </div>
          </div>

          {(bs.lastFeeding || bs.lastSleep) && (
            <div className={styles.babyRecent}>
              {bs.lastFeeding && (
                <div className={styles.babyRecentItem}>
                  <span className={styles.babyRecentIcon}>🍼</span>
                  <span className={styles.babyRecentText}>
                    마지막 수유 {timeAgo(bs.lastFeeding.startedAt)}
                    {bs.lastFeeding.type === 'formula' && bs.lastFeeding.amountMl
                      ? ` · ${bs.lastFeeding.amountMl}ml`
                      : ''
                    }
                  </span>
                </div>
              )}
              {bs.lastSleep && (
                <div className={styles.babyRecentItem}>
                  <span className={styles.babyRecentIcon}>💤</span>
                  <span className={styles.babyRecentText}>
                    {bs.lastSleep.endedAt
                      ? `마지막 수면 ${timeAgo(bs.lastSleep.endedAt)} · ${bs.lastSleep.durationSec ? Math.floor(bs.lastSleep.durationSec / 60) + '분' : ''}`
                      : '수면 중...'
                    }
                  </span>
                </div>
              )}
            </div>
          )}

          {(bs.feedingPrediction || bs.sleepPrediction) && (
            <div className={styles.predictions}>
              {bs.feedingPrediction && (
                <div className={styles.predictionChip}>
                  🍼 다음 수유 <strong>{bs.feedingPrediction.predictedAt.split(' ')[1]?.slice(0, 5) || bs.feedingPrediction.predictedAt}</strong>
                </div>
              )}
              {bs.sleepPrediction && (
                <div className={styles.predictionChip}>
                  💤 다음 수면 <strong>{bs.sleepPrediction.predictedAt.split(' ')[1]?.slice(0, 5) || bs.sleepPrediction.predictedAt}</strong>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Birthday Section */}
      {upcomingBirthdays.length > 0 && (
        <div className={`${styles.card} ${styles.cardStagger2}`}>
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>🎂</span>
            <span className={styles.cardTitle}>생일</span>
          </div>
          <div className={styles.birthdayList}>
            {upcomingBirthdays.map((b, i) => (
              <div key={i} className={styles.birthdayItem}>
                <div className={styles.birthdayEmoji}>
                  {b.type === 'baby' ? '👶' : b.daysUntil === 0 ? '🎉' : '🎂'}
                </div>
                <div className={styles.birthdayInfo}>
                  <div className={styles.birthdayName}>{b.name}</div>
                  <div className={styles.birthdayDate}>{b.monthDay}</div>
                </div>
                <div className={styles.birthdayDday}>
                  {b.daysUntil === 0
                    ? <span className={styles.birthdayToday}>오늘!</span>
                    : <span className={styles.birthdayCount}>D-{b.daysUntil}</span>
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's Events */}
      <div className={`${styles.card} ${styles.cardStagger3}`} onClick={() => navigate('/life', { state: { tab: 'calendar' } })}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>📅</span>
          <span className={styles.cardTitle}>오늘 일정</span>
          <span className={styles.cardArrow}>›</span>
        </div>
        {todayEvents.length === 0 ? (
          <div className={styles.cardEmpty}>오늘 일정이 없어요</div>
        ) : (
          <div className={styles.eventList}>
            {todayEvents.map((evt, i) => (
              <div key={`today-${i}`} className={styles.eventItem}>
                <div className={styles.eventDot} style={{ background: evt.color || '#007AFF' }} />
                <div className={styles.eventTitle}>{evt.title}</div>
                <div className={styles.eventTime}>{formatEventTime(evt.startAt, evt.allDay)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && (
        <div className={`${styles.card} ${styles.cardStagger4}`} onClick={() => navigate('/life', { state: { tab: 'calendar' } })}>
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>📋</span>
            <span className={styles.cardTitle}>다가오는 일정</span>
            <span className={styles.cardArrow}>›</span>
          </div>
          <div className={styles.eventList}>
            {upcomingEvents.slice(0, 5).map((evt, i) => (
              <div key={`upcoming-${i}`} className={styles.eventItem}>
                <div className={styles.eventDot} style={{ background: evt.color || '#007AFF' }} />
                <div className={styles.eventTitle}>{evt.title}</div>
                <div className={styles.eventDate}>{formatEventDate(evt.startAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Todo Summary */}
      <div className={`${styles.card} ${styles.cardStagger5}`} onClick={() => navigate('/life', { state: { tab: 'todos' } })}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>✅</span>
          <span className={styles.cardTitle}>할 일</span>
          <span className={styles.cardArrow}>›</span>
        </div>
        <div className={styles.todoStats}>
          <div className={styles.todoStat}>
            <div className={styles.todoStatValue}>{todoSummary.activeCount}</div>
            <div className={styles.todoStatLabel}>진행 중</div>
          </div>
          {todoSummary.overdueCount > 0 && (
            <div className={`${styles.todoStat} ${styles.todoStatOverdue}`}>
              <div className={styles.todoStatValue}>{todoSummary.overdueCount}</div>
              <div className={styles.todoStatLabel}>마감 지남</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
