import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ImmItem, type ImmItemStatus, type ImmPerson } from '../../api';
import styles from '../../pages/Immigration.module.css';
import { ChipGroup, ConfirmDialog, DateChips, Sheet, Toast, fmtDate, personName, todayStr, type ToastData } from './common';

/**
 * 할 일과 완료 기록은 한 테이블(imm_items)이다. 할 일을 체크하면 status만 'done'으로 바뀌어
 * 완료 탭으로 넘어간다. 그래서 두 탭이 같은 상태를 공유한다.
 */
export function useImmItems() {
  const [data, setData] = useState<{ todo: ImmItem[]; done: ImmItem[] } | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(() => {
    return api.getImmItems().then(d => { setData(d); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

type Items = ReturnType<typeof useImmItems>;

function assigneeOptions(people: ImmPerson[]) {
  return [
    ...people.map(p => ({ value: p.id as number | null, label: personName(people, p.id) })),
    { value: null as number | null, label: '둘 다' },
  ];
}

function AssigneeTag({ people, id }: { people: ImmPerson[]; id: number | null }) {
  return <span className={`${styles.personTag} ${id === null ? styles.personBoth : ''}`}>{personName(people, id)}</span>;
}

// ============================================================
// 해야 할 일
// ============================================================

export function TodoTab({ items, people, myId }: { items: Items; people: ImmPerson[]; myId: number }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<string | null>(todayStr());
  const [assignee, setAssignee] = useState<number | null>(myId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ImmItem | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [leaving, setLeaving] = useState<number[]>([]);
  const clearToast = useCallback(() => setToast(null), []);

  const add = async () => {
    if (!title.trim() || adding) return;
    setAdding(true);
    try {
      await api.createImmItem({ title: title.trim(), dueDate: due, assigneeId: assignee, status: 'todo' });
      setTitle('');
      await items.reload();
    } finally {
      setAdding(false);
    }
  };

  const complete = async (item: ImmItem) => {
    setLeaving(l => [...l, item.id]);
    try {
      await api.updateImmItem(item.id, { status: 'done' });
      await items.reload();
      setToast({
        message: `'${item.title}' 완료로 옮겼어요`,
        undo: () => { api.updateImmItem(item.id, { status: 'todo' }).then(() => items.reload()); },
      });
    } finally {
      setLeaving(l => l.filter(id => id !== item.id));
    }
  };

  const today = todayStr();
  const list = items.data?.todo ?? [];
  const groups: { key: string; label: string; tone?: 'late' | 'today'; items: ImmItem[] }[] = [];
  const late = list.filter(i => i.dueDate && i.dueDate < today);
  if (late.length) groups.push({ key: 'late', label: '지난 일', tone: 'late', items: late });
  for (const i of list.filter(i => i.dueDate && i.dueDate >= today)) {
    let g = groups.find(x => x.key === i.dueDate);
    if (!g) {
      const rel = i.dueDate === today ? '오늘 · ' : i.dueDate === todayStr(1) ? '내일 · ' : '';
      g = { key: i.dueDate!, label: rel + fmtDate(i.dueDate!), tone: i.dueDate === today ? 'today' : undefined, items: [] };
      groups.push(g);
    }
    g.items.push(i);
  }
  const noDate = list.filter(i => !i.dueDate);
  if (noDate.length) groups.push({ key: 'none', label: '날짜 없음', items: noDate });

  return (
    <div className={styles.section}>
      <div className={`${styles.card} ${styles.quickAdd}`}>
        <div className={styles.quickRow}>
          <input
            className={styles.quickInput}
            placeholder="할 일 추가"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
            maxLength={200}
            enterKeyHint="done"
          />
          <button className={styles.addBtn} onClick={add} disabled={!title.trim() || adding} aria-label="추가">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
        <DateChips value={due} onChange={setDue} allowNone />
        <ChipGroup label="진행할 사람" options={assigneeOptions(people)} value={assignee} onChange={setAssignee} />
      </div>

      {items.error && !items.data && <div className={styles.empty}><p>불러오지 못했어요.</p><button className={styles.textBtn} onClick={items.reload}>다시 시도</button></div>}
      {!items.data && !items.error && <div className={styles.skeletonCard} />}
      {items.data && list.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>남은 할 일이 없어요</p>
          <p>위에서 추가하면 날짜순으로 정리돼요.</p>
        </div>
      )}

      {groups.map(g => (
        <div key={g.key}>
          <div className={`${styles.groupLabel} ${g.tone === 'late' ? styles.groupLate : g.tone === 'today' ? styles.groupToday : ''}`}>
            {g.label} <span>{g.items.length}</span>
          </div>
          <div className={`${styles.card} ${styles.rowList}`}>
            {g.items.map(item => (
              <div key={item.id} className={`${styles.row} ${leaving.includes(item.id) ? styles.rowLeaving : ''}`}>
                <button className={styles.check} onClick={() => complete(item)} aria-label={`'${item.title}' 완료`}>
                  <span className={styles.checkCircle}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                </button>
                <button className={styles.rowMain} onClick={() => setEditing(item)}>
                  <span className={styles.rowTitle}>{item.title}</span>
                  {item.memo && <span className={styles.rowMemo}>{item.memo}</span>}
                </button>
                <AssigneeTag people={people} id={item.assigneeId} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {editing && <ItemSheet item={editing} people={people} onClose={() => setEditing(null)} onSaved={items.reload} />}
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

// ============================================================
// 완료 — 이미 한 일 + "DP 대기중" 같은 상태 메모. 최신순.
// ============================================================

const DONE_KINDS: { value: Exclude<ImmItemStatus, 'todo'>; label: string }[] = [
  { value: 'done', label: '완료' },
  { value: 'waiting', label: '대기중' },
];

export function DoneTab({ items, people }: { items: Items; people: ImmPerson[] }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'done' | 'waiting'>('done');
  const [date, setDate] = useState<string | null>(todayStr());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ImmItem | null>(null);

  const add = async () => {
    if (!title.trim() || adding) return;
    setAdding(true);
    try {
      await api.createImmItem({ title: title.trim(), status: kind, doneDate: date ?? todayStr() });
      setTitle('');
      await items.reload();
    } finally {
      setAdding(false);
    }
  };

  const list = items.data?.done ?? [];
  const groups: { date: string; items: ImmItem[] }[] = [];
  for (const i of list) {
    const d = i.doneDate ?? i.updatedAt.slice(0, 10);
    let g = groups.find(x => x.date === d);
    if (!g) { g = { date: d, items: [] }; groups.push(g); }
    g.items.push(i);
  }

  return (
    <div className={styles.section}>
      <div className={`${styles.card} ${styles.quickAdd}`}>
        <div className={styles.quickRow}>
          <input
            className={styles.quickInput}
            placeholder={kind === 'waiting' ? '예: DP 대기중' : '예: 항공권 발급됨'}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
            maxLength={200}
            enterKeyHint="done"
          />
          <button className={styles.addBtn} onClick={add} disabled={!title.trim() || adding} aria-label="기록 추가">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
        <ChipGroup label="종류" options={DONE_KINDS} value={kind} onChange={setKind} />
        <DateChips value={date} onChange={setDate} past />
      </div>

      {items.error && !items.data && <div className={styles.empty}><p>불러오지 못했어요.</p><button className={styles.textBtn} onClick={items.reload}>다시 시도</button></div>}
      {!items.data && !items.error && <div className={styles.skeletonCard} />}
      {items.data && list.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>아직 기록이 없어요</p>
          <p>할 일을 체크하거나 여기서 바로 추가하면 쌓여요.</p>
        </div>
      )}

      <div className={styles.timeline}>
        {groups.map(g => (
          <div key={g.date} className={styles.timelineGroup}>
            <div className={styles.timelineDate}>{fmtDate(g.date)}</div>
            {g.items.map(item => (
              <button key={item.id} className={styles.timelineItem} onClick={() => setEditing(item)}>
                <span className={`${styles.timelineDot} ${item.status === 'waiting' ? styles.dotWaiting : styles.dotDone}`}>
                  {item.status === 'waiting' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 2h12M6 22h12M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10" /></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  )}
                </span>
                <span className={styles.timelineText}>
                  <span className={styles.timelineTitle}>
                    {item.status === 'waiting' && <span className={styles.waitingTag}>대기중</span>}
                    {item.title}
                  </span>
                  {item.memo && <span className={styles.rowMemo}>{item.memo}</span>}
                </span>
                {item.assigneeId !== null && <AssigneeTag people={people} id={item.assigneeId} />}
              </button>
            ))}
          </div>
        ))}
      </div>

      {editing && <ItemSheet item={editing} people={people} onClose={() => setEditing(null)} onSaved={items.reload} />}
    </div>
  );
}

// ============================================================
// 편집 시트 (할 일·완료 공통)
// ============================================================

const STATUS_OPTIONS: { value: ImmItemStatus; label: string }[] = [
  { value: 'todo', label: '할 일' },
  { value: 'done', label: '완료' },
  { value: 'waiting', label: '대기중' },
];

function ItemSheet({ item, people, onClose, onSaved }: { item: ImmItem; people: ImmPerson[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [memo, setMemo] = useState(item.memo);
  const [status, setStatus] = useState<ImmItemStatus>(item.status);
  const [dueDate, setDueDate] = useState<string | null>(item.dueDate);
  const [doneDate, setDoneDate] = useState<string | null>(item.doneDate ?? todayStr());
  const [assignee, setAssignee] = useState<number | null>(item.assigneeId);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closeRef = useRef<(() => void) | null>(null);

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await api.updateImmItem(item.id, {
        title: title.trim(), memo: memo.trim(), status, dueDate, assigneeId: assignee,
        doneDate: status === 'todo' ? null : doneDate,
      });
      onSaved();
      closeRef.current?.();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    await api.deleteImmItem(item.id).catch(() => {});
    onSaved();
    closeRef.current?.();
  };

  return (
    <Sheet
      title={item.status === 'todo' ? '할 일' : '기록'}
      onClose={onClose}
      closeRef={closeRef}
      action={<button className={styles.saveBtn} onClick={save} disabled={!title.trim() || saving}>{saving ? '저장 중' : '저장'}</button>}
    >
      <div className={styles.form}>
        <input className={styles.input} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="내용" />
        <textarea className={`${styles.input} ${styles.textarea}`} value={memo} onChange={e => setMemo(e.target.value)} rows={3} placeholder="메모 (선택)" />
        <div className={styles.field}>
          <span className={styles.fieldLabel}>상태</span>
          <ChipGroup label="상태" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        </div>
        {status === 'todo' ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>날짜</span>
            <DateChips value={dueDate} onChange={setDueDate} allowNone />
          </div>
        ) : (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{status === 'waiting' ? '기록한 날' : '완료한 날'}</span>
            <DateChips value={doneDate} onChange={setDoneDate} past />
          </div>
        )}
        <div className={styles.field}>
          <span className={styles.fieldLabel}>진행할 사람</span>
          <ChipGroup label="진행할 사람" options={assigneeOptions(people)} value={assignee} onChange={setAssignee} />
        </div>
        <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>삭제</button>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="삭제"
          message={`'${item.title}'을(를) 지울까요? 되돌릴 수 없어요.`}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Sheet>
  );
}
