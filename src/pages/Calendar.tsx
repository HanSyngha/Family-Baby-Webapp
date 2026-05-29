import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, type User, type CalendarEvent } from '../api';
import styles from './Calendar.module.css';

interface Props {
  user: User;
  embedded?: boolean;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const EVENT_COLORS = [
  '#007AFF', // Blue
  '#FF3B30', // Red
  '#FF9F0A', // Orange
  '#FFCC00', // Yellow
  '#34C759', // Green
  '#5856D6', // Purple
  '#AF52DE', // Magenta
  '#00C7BE', // Teal
];

const RECURRENCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: '반복 안함' },
  { value: 'daily', label: '매일' },
  { value: 'weekly', label: '매주' },
  { value: 'monthly', label: '매월' },
  { value: 'yearly', label: '매년' },
];

const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 10, label: '10분 전' },
  { value: 30, label: '30분 전' },
  { value: 60, label: '1시간 전' },
  { value: 1440, label: '1일 전' },
];

function pad(n: number) { return n.toString().padStart(2, '0'); }

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeStr(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateKR(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

function formatTimeKR(dateStr: string) {
  const d = new Date(dateStr);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ampm} ${hour}:${pad(m)}`;
}

function getMonthDays(year: number, month: number): { date: Date; isCurrentMonth: boolean }[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay();
  const days: { date: Date; isCurrentMonth: boolean }[] = [];

  // Previous month fill
  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d, isCurrentMonth: false });
  }

  // Current month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }

  // Next month fill to complete grid (always 6 rows)
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
  }

  return days;
}

interface EventFormData {
  title: string;
  description: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  point: boolean;
  color: string;
  location: string;
  isPrivate: boolean;
  participantIds: number[];
  recurrence: string;
  reminders: number[];
}

function makeDefaultForm(selectedDate?: string): EventFormData {
  const now = new Date();
  const dateStr = selectedDate || toLocalDateStr(now);
  const nextHour = new Date(now);
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  const endHour = new Date(nextHour);
  endHour.setHours(endHour.getHours() + 1);

  return {
    title: '',
    description: '',
    startDate: dateStr,
    startTime: toLocalTimeStr(nextHour),
    endDate: dateStr,
    endTime: toLocalTimeStr(endHour),
    allDay: false,
    point: false,
    color: EVENT_COLORS[0],
    location: '',
    isPrivate: false,
    participantIds: [],
    recurrence: 'none',
    reminders: [],
  };
}

function eventToForm(ev: CalendarEvent): EventFormData {
  const start = new Date(ev.startAt);
  const end = new Date(ev.endAt);
  return {
    title: ev.title,
    description: ev.description || '',
    startDate: toLocalDateStr(start),
    startTime: toLocalTimeStr(start),
    endDate: toLocalDateStr(end),
    endTime: toLocalTimeStr(end),
    allDay: ev.allDay,
    point: !ev.allDay && start.getTime() === end.getTime(),
    color: ev.color || EVENT_COLORS[0],
    location: ev.location || '',
    isPrivate: ev.isPrivate,
    participantIds: ev.participants.map(p => p.userId),
    recurrence: ev.recurrence?.type || 'none',
    reminders: ev.reminders || [],
  };
}

export default function Calendar({ user, embedded }: Props) {
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toLocalDateStr(today), [today]);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [slideDir, setSlideDir] = useState<'left' | 'right' | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [viewingEvent, setViewingEvent] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState<EventFormData>(makeDefaultForm());
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<CalendarEvent | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  const monthStr = `${year}-${pad(month + 1)}`;

  // Load events for current month
  const loadEvents = useCallback(async (m?: string) => {
    try {
      const data = await api.getCalendarEvents(m || monthStr);
      setEvents(data);
    } catch (e) {
      console.error('Failed to load events:', e);
    }
  }, [monthStr]);

  useEffect(() => {
    setLoading(true);
    loadEvents().finally(() => setLoading(false));
  }, [monthStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load users for participant picker
  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {});
  }, []);

  // Month navigation
  const navigateMonth = useCallback((dir: -1 | 1) => {
    setSlideDir(dir === 1 ? 'left' : 'right');
    setTimeout(() => {
      setMonth(prev => {
        let newMonth = prev + dir;
        let newYear = year;
        if (newMonth < 0) { newMonth = 11; newYear--; }
        if (newMonth > 11) { newMonth = 0; newYear++; }
        setYear(newYear);
        return newMonth;
      });
      setSlideDir(dir === 1 ? 'slideInLeft' as any : 'slideInRight' as any);
      setTimeout(() => setSlideDir(null), 300);
    }, 250);
  }, [year]);

  const goToToday = useCallback(() => {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth());
    setSelectedDate(toLocalDateStr(t));
  }, []);

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  // Calendar grid data
  const days = useMemo(() => getMonthDays(year, month), [year, month]);

  // Events grouped by date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const dateKey = ev.instanceDate || toLocalDateStr(new Date(ev.startAt));
      const arr = map.get(dateKey) || [];
      arr.push(ev);
      map.set(dateKey, arr);
    }
    return map;
  }, [events]);

  // Events for selected date
  const selectedEvents = useMemo(() => {
    return eventsByDate.get(selectedDate) || [];
  }, [eventsByDate, selectedDate]);

  // Touch swipe for month navigation
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(diff) > 60) {
      navigateMonth(diff > 0 ? -1 : 1);
    }
  }, [navigateMonth]);

  // Modal management
  const openCreateModal = useCallback((date?: string) => {
    setForm(makeDefaultForm(date || selectedDate));
    setEditingEvent(null);
    setShowModal(true);
    history.pushState({ modal: 'calendar-event' }, '');
  }, [selectedDate]);

  const openEditModal = useCallback((ev: CalendarEvent) => {
    setForm(eventToForm(ev));
    setEditingEvent(ev);
    setViewingEvent(null);
    setShowModal(true);
    history.pushState({ modal: 'calendar-event' }, '');
  }, []);

  const openViewModal = useCallback((ev: CalendarEvent) => {
    setViewingEvent(ev);
    history.pushState({ modal: 'calendar-detail' }, '');
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingEvent(null);
    setViewingEvent(null);
    if (history.state?.modal?.startsWith('calendar')) history.back();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setShowModal(false);
      setEditingEvent(null);
      setViewingEvent(null);
      setConfirmDelete(null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Form handlers
  const updateForm = useCallback(<K extends keyof EventFormData>(key: K, value: EventFormData[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      // Auto-adjust end date/time when start changes
      if (key === 'startDate' && next.endDate < next.startDate) {
        next.endDate = next.startDate;
      }
      if (key === 'startDate' && next.startDate === next.endDate && next.startTime >= next.endTime) {
        const [h, m] = (next.startTime).split(':').map(Number);
        const endH = h + 1;
        next.endTime = `${pad(endH > 23 ? 23 : endH)}:${pad(m)}`;
      }
      if (key === 'startTime' && next.startDate === next.endDate && next.startTime >= next.endTime) {
        const [h, m] = (value as string).split(':').map(Number);
        const endH = h + 1;
        next.endTime = `${pad(endH > 23 ? 23 : endH)}:${pad(m)}`;
      }
      return next;
    });
  }, []);

  const toggleReminder = useCallback((val: number) => {
    setForm(prev => ({
      ...prev,
      reminders: prev.reminders.includes(val)
        ? prev.reminders.filter(r => r !== val)
        : [...prev.reminders, val],
    }));
  }, []);

  const toggleParticipant = useCallback((userId: number) => {
    setForm(prev => ({
      ...prev,
      participantIds: prev.participantIds.includes(userId)
        ? prev.participantIds.filter(id => id !== userId)
        : [...prev.participantIds, userId],
    }));
  }, []);

  // Save event
  const handleSave = useCallback(async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      const startAt = form.allDay
        ? `${form.startDate} 00:00:00`
        : `${form.startDate} ${form.startTime}:00`;
      const endAt = form.point
        ? startAt
        : form.allDay
          ? `${form.endDate} 23:59:59`
          : `${form.endDate} ${form.endTime}:00`;

      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        startAt,
        endAt,
        allDay: form.allDay,
        color: form.color,
        location: form.location.trim(),
        isPrivate: form.isPrivate,
        participantIds: form.participantIds,
        recurrence: form.recurrence !== 'none'
          ? { type: form.recurrence, interval: 1 }
          : null,
        reminders: form.reminders,
      };

      if (editingEvent) {
        await api.updateCalendarEvent(editingEvent.id, payload);
      } else {
        await api.createCalendarEvent(payload);
      }

      closeModal();
      await loadEvents();
    } catch (e) {
      console.error('Failed to save event:', e);
    } finally {
      setSaving(false);
    }
  }, [form, saving, editingEvent, closeModal, loadEvents]);

  // Delete event
  const handleDelete = useCallback(async (ev: CalendarEvent) => {
    try {
      await api.deleteCalendarEvent(ev.id);
      setConfirmDelete(null);
      setViewingEvent(null);
      setShowModal(false);
      if (history.state?.modal?.startsWith('calendar')) history.back();
      await loadEvents();
    } catch (e) {
      console.error('Failed to delete event:', e);
    }
  }, [loadEvents]);

  // Grid slide animation class
  const slideClass = slideDir === 'left' ? styles.slideLeft
    : slideDir === 'right' ? styles.slideRight
    : slideDir === ('slideInLeft' as any) ? styles.slideInLeft
    : slideDir === ('slideInRight' as any) ? styles.slideInRight
    : '';

  return (
    <div className={styles.layout}>
      {/* Page Header */}
      {!embedded && (
        <div className={styles.pageHeader}>
          <div className={styles.brand}>
            <div className={styles.brandBlock}>
              <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
              <span className={styles.brandName}>땅콩패밀리</span>
            </div>
            <h1 className={styles.pageTitle}>캘린더</h1>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.addBtn} onClick={() => openCreateModal()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              일정 추가
            </button>
          </div>
        </div>
      )}

      <div className={styles.main}>
        {/* Month Navigator */}
        <div className={styles.monthNav}>
          <button className={styles.monthNavBtn} onClick={() => navigateMonth(-1)} aria-label="이전 달">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button className={styles.monthLabel} onClick={goToToday}>
            {year}년 {month + 1}월
          </button>
          <button className={styles.monthNavBtn} onClick={() => navigateMonth(1)} aria-label="다음 달">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button
            className={`${styles.todayBtn} ${isCurrentMonth ? styles.todayBtnHidden : ''}`}
            onClick={goToToday}
          >
            오늘
          </button>
        </div>

        {/* Calendar Grid */}
        <div
          className={styles.calendarContainer}
          ref={gridRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Week Header */}
          <div className={styles.weekHeader}>
            {WEEKDAYS.map(d => (
              <div key={d} className={styles.weekDay}>{d}</div>
            ))}
          </div>

          {/* Days Grid */}
          {loading ? (
            <div className={styles.skeleton}>
              {Array.from({ length: 42 }).map((_, i) => (
                <div key={i} className={styles.skeletonCell}>
                  <div className={styles.skeletonCircle} />
                  {i % 4 === 0 && <div className={styles.skeletonDot} />}
                </div>
              ))}
            </div>
          ) : (
            <div className={`${styles.calendarGrid} ${slideClass}`}>
              {days.map(({ date, isCurrentMonth: isCurrent }, i) => {
                const dateStr = toLocalDateStr(date);
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;
                const dayEvents = eventsByDate.get(dateStr) || [];

                return (
                  <div
                    key={`${dateStr}-${i}`}
                    className={[
                      styles.dayCell,
                      !isCurrent && styles.dayCellOther,
                      isToday && styles.dayToday,
                      isSelected && styles.daySelected,
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedDate(dateStr)}
                  >
                    <span className={styles.dayNumber}>{date.getDate()}</span>
                    {dayEvents.length > 0 && (
                      <div className={styles.eventDots}>
                        {dayEvents.slice(0, 4).map((ev, j) => (
                          <span
                            key={j}
                            className={styles.eventDot}
                            style={{ background: ev.color || EVENT_COLORS[0] }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Day Events */}
        {selectedDate && (
          <div className={styles.selectedDaySection}>
            <div className={styles.selectedDayHeader}>
              <span className={styles.selectedDayTitle}>
                {(() => {
                  const d = new Date(selectedDate + 'T00:00:00');
                  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
                })()}
              </span>
              <button className={styles.addDayBtn} onClick={() => openCreateModal(selectedDate)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                추가
              </button>
            </div>

            {selectedEvents.length === 0 ? (
              <div className={styles.emptyDay}>
                <div className={styles.emptyDayIcon}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <div>일정이 없습니다</div>
              </div>
            ) : (
              <div className={styles.eventList}>
                {selectedEvents
                  .sort((a, b) => {
                    if (a.allDay && !b.allDay) return -1;
                    if (!a.allDay && b.allDay) return 1;
                    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
                  })
                  .map((ev, i) => (
                    <div
                      key={ev.id + '-' + i}
                      className={styles.eventCard}
                      style={{ animationDelay: `${i * 0.05}s` }}
                      onClick={() => openViewModal(ev)}
                    >
                      <div className={styles.eventColorBar} style={{ background: ev.color || EVENT_COLORS[0] }} />
                      <div className={styles.eventCardContent}>
                        <div className={styles.eventTitle}>
                          {ev.title}
                          {ev.isPrivate && (
                            <span className={styles.eventPrivate}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            </span>
                          )}
                          {ev.recurrence && (
                            <span className={styles.recurrenceBadge}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <path d="M17 1l4 4-4 4" />
                                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                                <path d="M7 23l-4-4 4-4" />
                                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                              </svg>
                            </span>
                          )}
                        </div>
                        <div className={styles.eventTime}>
                          {ev.allDay ? '종일' : ev.startAt === ev.endAt ? formatTimeKR(ev.startAt) : `${formatTimeKR(ev.startAt)} — ${formatTimeKR(ev.endAt)}`}
                        </div>
                        {ev.location && (
                          <div className={styles.eventLocation}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                              <circle cx="12" cy="10" r="3" />
                            </svg>
                            {ev.location}
                          </div>
                        )}
                        {ev.participants.length > 0 && (
                          <div className={styles.eventParticipants}>
                            {ev.participants.slice(0, 5).map(p => (
                              p.profileImage ? (
                                <img key={p.userId} src={p.profileImage} alt={p.name} className={styles.eventAvatar} />
                              ) : (
                                <span key={p.userId} className={styles.eventAvatarFallback}>{p.name[0]}</span>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile FAB */}
      <button className={styles.fab} onClick={() => openCreateModal()}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {/* Event Detail View */}
      {viewingEvent && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBackdrop} onClick={closeModal} />
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <button className={styles.modalCancel} onClick={closeModal}>닫기</button>
              <span className={styles.modalTitle}>일정 상세</span>
              <button className={styles.modalSave} onClick={() => openEditModal(viewingEvent)}>편집</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.detailSection}>
                <div className={styles.detailTitle}>{viewingEvent.title}</div>
                <div className={styles.detailMeta}>
                  <span className={styles.detailColorDot} style={{ background: viewingEvent.color || EVENT_COLORS[0] }} />
                  {viewingEvent.creatorName && <span>{viewingEvent.creatorName}</span>}
                </div>
              </div>

              {/* Date/Time */}
              <div className={styles.detailSection}>
                <div className={styles.detailRow}>
                  <span className={styles.detailRowIcon}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </span>
                  <div className={styles.detailRowContent}>
                    <div className={styles.detailRowTitle}>
                      {viewingEvent.allDay
                        ? formatDateKR(viewingEvent.startAt)
                        : `${formatDateKR(viewingEvent.startAt)} ${formatTimeKR(viewingEvent.startAt)}`}
                    </div>
                    {!viewingEvent.allDay && viewingEvent.startAt !== viewingEvent.endAt && (
                      <div className={styles.detailRowSub}>
                        ~ {toLocalDateStr(new Date(viewingEvent.startAt)) !== toLocalDateStr(new Date(viewingEvent.endAt))
                          ? formatDateKR(viewingEvent.endAt) + ' '
                          : ''}{formatTimeKR(viewingEvent.endAt)}
                      </div>
                    )}
                    {viewingEvent.allDay && toLocalDateStr(new Date(viewingEvent.startAt)) !== toLocalDateStr(new Date(viewingEvent.endAt)) && (
                      <div className={styles.detailRowSub}>
                        ~ {formatDateKR(viewingEvent.endAt)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Location */}
              {viewingEvent.location && (
                <div className={styles.detailSection}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </span>
                    <div className={styles.detailRowContent}>
                      <div className={styles.detailRowTitle}>{viewingEvent.location}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Description */}
              {viewingEvent.description && (
                <div className={styles.detailSection}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="17" y1="10" x2="3" y2="10" />
                        <line x1="21" y1="6" x2="3" y2="6" />
                        <line x1="21" y1="14" x2="3" y2="14" />
                        <line x1="17" y1="18" x2="3" y2="18" />
                      </svg>
                    </span>
                    <div className={styles.detailRowContent}>
                      <div className={styles.detailRowTitle}>{viewingEvent.description}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Participants */}
              {viewingEvent.participants.length > 0 && (
                <div className={styles.detailSection}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </span>
                    <div className={styles.detailRowContent}>
                      <div className={styles.detailRowTitle}>
                        {viewingEvent.participants.map(p => p.name).join(', ')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Recurrence */}
              {viewingEvent.recurrence && (
                <div className={styles.detailSection}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M17 1l4 4-4 4" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <path d="M7 23l-4-4 4-4" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    </span>
                    <div className={styles.detailRowContent}>
                      <div className={styles.detailRowTitle}>
                        {RECURRENCE_OPTIONS.find(r => r.value === viewingEvent.recurrence?.type)?.label || viewingEvent.recurrence.type}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Reminders */}
              {viewingEvent.reminders.length > 0 && (
                <div className={styles.detailSection}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    </span>
                    <div className={styles.detailRowContent}>
                      <div className={styles.detailRowTitle}>
                        {viewingEvent.reminders.map(r => REMINDER_OPTIONS.find(o => o.value === r)?.label || `${r}분 전`).join(', ')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              {(viewingEvent.creatorId === user.id || user.role === 'master') && (
                <div className={styles.detailSection}>
                  <div className={styles.detailActions}>
                    <button className={styles.detailEditBtn} onClick={() => openEditModal(viewingEvent)}>편집</button>
                    <button className={styles.detailDeleteBtn} onClick={() => setConfirmDelete(viewingEvent)}>삭제</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBackdrop} onClick={closeModal} />
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <button className={styles.modalCancel} onClick={closeModal}>취소</button>
              <span className={styles.modalTitle}>{editingEvent ? '일정 편집' : '새 일정'}</span>
              <button
                className={styles.modalSave}
                onClick={handleSave}
                disabled={!form.title.trim() || saving}
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Title */}
              <div className={styles.formSection}>
                <input
                  className={styles.titleInput}
                  type="text"
                  placeholder="제목"
                  value={form.title}
                  onChange={e => updateForm('title', e.target.value)}
                  autoFocus
                />
                <textarea
                  className={styles.descInput}
                  placeholder="메모"
                  value={form.description}
                  onChange={e => updateForm('description', e.target.value)}
                  rows={2}
                />
              </div>

              {/* Location */}
              <div className={styles.formSection}>
                <div className={styles.formRow}>
                  <span className={styles.formRowLabel}>
                    <span className={styles.formRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </span>
                  </span>
                  <input
                    className={styles.locationInput}
                    type="text"
                    placeholder="위치 추가"
                    value={form.location}
                    onChange={e => updateForm('location', e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>

              {/* All Day Toggle */}
              <div className={styles.formSection}>
                <div className={styles.formRow}>
                  <span className={styles.formRowLabel}>
                    <span className={styles.formRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </span>
                    종일
                  </span>
                  <div
                    className={`${styles.toggle} ${form.allDay ? styles.toggleActive : ''}`}
                    onClick={() => { const next = !form.allDay; updateForm('allDay', next); if (next) updateForm('point', false); }}
                  >
                    <div className={styles.toggleKnob} />
                  </div>
                </div>
                <div className={styles.formRow}>
                  <span className={styles.formRowLabel}>
                    <span className={styles.formRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                      </svg>
                    </span>
                    단발성 (시작 시각만)
                  </span>
                  <div
                    className={`${styles.toggle} ${form.point ? styles.toggleActive : ''}`}
                    onClick={() => { const next = !form.point; updateForm('point', next); if (next) updateForm('allDay', false); }}
                  >
                    <div className={styles.toggleKnob} />
                  </div>
                </div>

                {/* Date/Time Pickers */}
                <div className={styles.dateTimeRow}>
                  <div className={styles.dateTimeField}>
                    <span className={styles.dateTimeLabel}>시작</span>
                    <input
                      className={styles.dateInput}
                      type="date"
                      value={form.startDate}
                      onChange={e => updateForm('startDate', e.target.value)}
                    />
                    {!form.allDay && (
                      <input
                        className={styles.timeInput}
                        type="time"
                        value={form.startTime}
                        onChange={e => updateForm('startTime', e.target.value)}
                      />
                    )}
                  </div>
                  {!form.point && (
                  <div className={styles.dateTimeField}>
                    <span className={styles.dateTimeLabel}>종료</span>
                    <input
                      className={styles.dateInput}
                      type="date"
                      value={form.endDate}
                      min={form.startDate}
                      onChange={e => updateForm('endDate', e.target.value)}
                    />
                    {!form.allDay && (
                      <input
                        className={styles.timeInput}
                        type="time"
                        value={form.endTime}
                        onChange={e => updateForm('endTime', e.target.value)}
                      />
                    )}
                  </div>
                  )}
                </div>
              </div>

              {/* Color Picker */}
              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>
                  <span className={styles.sectionLabelIcon}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                  </span>
                  색상
                </div>
                <div className={styles.colorPicker}>
                  {EVENT_COLORS.map(c => (
                    <button
                      key={c}
                      className={`${styles.colorOption} ${form.color === c ? styles.colorOptionSelected : ''}`}
                      style={{ background: c }}
                      onClick={() => updateForm('color', c)}
                      aria-label={`색상 ${c}`}
                    />
                  ))}
                </div>
              </div>

              {/* Participants */}
              {users.length > 0 && (
                <div className={styles.formSection}>
                  <div className={styles.sectionLabel}>
                    <span className={styles.sectionLabelIcon}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </span>
                    참여자
                  </div>
                  <div className={styles.chipList}>
                    {users.map(u => (
                      <button
                        key={u.id}
                        className={`${styles.chip} ${form.participantIds.includes(u.id) ? styles.chipSelected : ''}`}
                        onClick={() => toggleParticipant(u.id)}
                      >
                        {u.profileImage ? (
                          <img src={u.profileImage} alt="" className={styles.chipAvatar} />
                        ) : (
                          <span className={styles.chipAvatarFallback}>{u.name[0]}</span>
                        )}
                        {u.name}
                        {form.participantIds.includes(u.id) && (
                          <span className={styles.chipRemove}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Recurrence */}
              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>
                  <span className={styles.sectionLabelIcon}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17 1l4 4-4 4" />
                      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                      <path d="M7 23l-4-4 4-4" />
                      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                    </svg>
                  </span>
                  반복
                </div>
                <div className={styles.selectWrap}>
                  <select
                    className={styles.selectInput}
                    value={form.recurrence}
                    onChange={e => updateForm('recurrence', e.target.value)}
                  >
                    {RECURRENCE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <span className={styles.selectArrow}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </div>
              </div>

              {/* Reminders */}
              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>
                  <span className={styles.sectionLabelIcon}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </span>
                  알림
                </div>
                <div className={styles.reminderList}>
                  {REMINDER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`${styles.reminderChip} ${form.reminders.includes(opt.value) ? styles.reminderChipActive : ''}`}
                      onClick={() => toggleReminder(opt.value)}
                    >
                      <span className={styles.reminderCheck}>
                        {form.reminders.includes(opt.value) && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Private Toggle */}
              <div className={styles.formSection}>
                <div className={styles.formRow}>
                  <span className={styles.formRowLabel}>
                    <span className={styles.formRowIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    비공개
                  </span>
                  <div
                    className={`${styles.toggle} ${form.isPrivate ? styles.toggleActive : ''}`}
                    onClick={() => updateForm('isPrivate', !form.isPrivate)}
                  >
                    <div className={styles.toggleKnob} />
                  </div>
                </div>
              </div>

              {/* Delete button for editing */}
              {editingEvent && (editingEvent.creatorId === user.id || user.role === 'master') && (
                <div className={styles.deleteSection}>
                  <button className={styles.deleteBtn} onClick={() => setConfirmDelete(editingEvent)}>
                    일정 삭제
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      {confirmDelete && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBackdrop} onClick={() => setConfirmDelete(null)} />
          <div className={styles.confirmDialog}>
            <div className={styles.confirmTitle}>일정을 삭제할까요?</div>
            <div className={styles.confirmMessage}>
              '{confirmDelete.title}' 일정이 삭제됩니다.{'\n'}이 작업은 되돌릴 수 없습니다.
            </div>
            <div className={styles.confirmActions}>
              <button className={styles.confirmCancel} onClick={() => setConfirmDelete(null)}>취소</button>
              <button className={styles.confirmDelete} onClick={() => handleDelete(confirmDelete)}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
