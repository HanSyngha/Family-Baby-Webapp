import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type User, type Todo, type TodoComment } from '../api';
import styles from './Todos.module.css';

interface Props {
  user: User;
  embedded?: boolean;
}

type StatusFilter = 'todo' | 'in_progress' | 'done';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'todo', label: '해야할일' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'done', label: '완료' },
];

const PRIORITY_OPTIONS: { value: Todo['priority']; label: string; color: string }[] = [
  { value: 'low', label: '낮음', color: 'var(--color-priority-low)' },
  { value: 'medium', label: '보통', color: 'var(--color-priority-medium)' },
  { value: 'high', label: '높음', color: 'var(--color-priority-high)' },
  { value: 'urgent', label: '긴급', color: 'var(--color-priority-urgent)' },
];

function pad(n: number) { return n.toString().padStart(2, '0'); }

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDueDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getDueDateStatus(dateStr: string): 'overdue' | 'today' | 'soon' | 'normal' {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  due.setHours(0, 0, 0, 0);
  const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 3) return 'soon';
  return 'normal';
}

function getDueDateLabel(dateStr: string): string {
  const status = getDueDateStatus(dateStr);
  const formatted = formatDueDate(dateStr);
  if (status === 'overdue') return `${formatted} 지남`;
  if (status === 'today') return '오늘';
  return formatted;
}

const priorityClass: Record<Todo['priority'], string> = {
  urgent: styles.priorityUrgent,
  high: styles.priorityHigh,
  medium: styles.priorityMedium,
  low: styles.priorityLow,
};

const priorityPillActiveClass: Record<Todo['priority'], string> = {
  low: styles.priorityPillActiveLow,
  medium: styles.priorityPillActiveMedium,
  high: styles.priorityPillActiveHigh,
  urgent: styles.priorityPillActiveUrgent,
};

// ============================================================
// Form state
// ============================================================

interface TodoFormData {
  title: string;
  description: string;
  priority: Todo['priority'];
  dueDate: string;
  isPrivate: boolean;
  assigneeIds: number[];
  parentId: number | null;
  status: StatusFilter;
}

function makeDefaultForm(parentId?: number | null): TodoFormData {
  return {
    title: '',
    description: '',
    priority: 'medium',
    dueDate: '',
    isPrivate: false,
    assigneeIds: [],
    parentId: parentId ?? null,
    status: 'todo',
  };
}

function todoToForm(todo: Todo): TodoFormData {
  return {
    title: todo.title,
    description: todo.description || '',
    priority: todo.priority,
    dueDate: todo.dueDate ? todo.dueDate.slice(0, 10) : '',
    isPrivate: todo.isPrivate,
    assigneeIds: todo.assignees.map(a => a.userId),
    parentId: todo.parentId,
    status: todo.status as StatusFilter,
  };
}

// ============================================================
// Main Component
// ============================================================

export default function Todos({ user, embedded }: Props) {
  const [status, setStatus] = useState<StatusFilter>('todo');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [form, setForm] = useState<TodoFormData>(makeDefaultForm());
  const [saving, setSaving] = useState(false);

  // Comments
  const [comments, setComments] = useState<TodoComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState<Todo | null>(null);

  // Expand state for subtasks
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Removing animation state
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set());

  // Counts per status
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({ todo: 0, in_progress: 0, done: 0 });

  // ============================================================
  // Data loading
  // ============================================================

  const loadTodos = useCallback(async (s?: StatusFilter) => {
    try {
      const data = await api.getTodos({ status: s || status });
      setTodos(data);
    } catch (e) {
      console.error('Failed to load todos:', e);
    }
  }, [status]);

  const loadCounts = useCallback(async () => {
    try {
      const [todoList, progressList, doneList] = await Promise.all([
        api.getTodos({ status: 'todo' }),
        api.getTodos({ status: 'in_progress' }),
        api.getTodos({ status: 'done' }),
      ]);
      setCounts({
        todo: todoList.length,
        in_progress: progressList.length,
        done: doneList.length,
      });
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadTodos().finally(() => setLoading(false));
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCounts();
    api.getUsers().then(setUsers).catch(() => {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // Status tab change
  // ============================================================

  const handleStatusChange = useCallback((s: StatusFilter) => {
    if (s === status) return;
    setStatus(s);
  }, [status]);

  // ============================================================
  // Toggle expand
  // ============================================================

  const toggleExpand = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ============================================================
  // Checkbox handling
  // ============================================================

  const handleCheck = useCallback((todo: Todo, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextStatus = todo.status === 'todo' ? 'in_progress' : todo.status === 'in_progress' ? 'done' : 'todo';
    // 애니메이션 처리 (현재 탭에서 사라지는 경우)
    if (nextStatus !== status) {
      setRemovingIds(prev => new Set(prev).add(todo.id));
      setTimeout(() => {
        setRemovingIds(prev => {
          const next = new Set(prev);
          next.delete(todo.id);
          return next;
        });
        loadTodos();
        loadCounts();
      }, 350);
    }
    api.updateTodo(todo.id, { status: nextStatus }).then(() => {
      if (nextStatus === status) {
        loadTodos();
      }
      loadCounts();
    }).catch(() => {});
  }, [status, loadTodos, loadCounts]);

  // ============================================================
  // Create / Edit Modal
  // ============================================================

  const openCreateModal = useCallback((parentId?: number | null) => {
    setForm(makeDefaultForm(parentId));
    setEditingTodo(null);
    setShowModal(true);
    history.pushState({ modal: 'todo-form' }, '');
  }, []);

  const openEditModal = useCallback((todo: Todo, e: React.MouseEvent) => {
    e.stopPropagation();
    setForm(todoToForm(todo));
    setEditingTodo(todo);
    setComments([]);
    setCommentText('');
    setShowModal(true);
    history.pushState({ modal: 'todo-form' }, '');
    // 댓글 로드
    api.getTodoComments(todo.id).then(setComments).catch(() => {});
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingTodo(null);
    if (history.state?.modal === 'todo-form') history.back();
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        dueDate: form.dueDate || null,
        isPrivate: form.isPrivate,
        assigneeIds: form.assigneeIds,
        parentId: form.parentId,
      };
      if (editingTodo) {
        if (form.status !== editingTodo.status) {
          payload.status = form.status;
        }
        await api.updateTodo(editingTodo.id, payload);
      } else {
        await api.createTodo(payload);
      }
      closeModal();
      loadTodos();
      loadCounts();
    } catch (e) {
      console.error('Failed to save todo:', e);
    } finally {
      setSaving(false);
    }
  }, [form, editingTodo, closeModal, loadTodos, loadCounts]);

  // ============================================================
  // Delete
  // ============================================================

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      await api.deleteTodo(confirmDelete.id);
      setConfirmDelete(null);
      closeModal();
      loadTodos();
      loadCounts();
    } catch (e) {
      console.error('Failed to delete todo:', e);
    }
  }, [confirmDelete, closeModal, loadTodos, loadCounts]);

  // ============================================================
  // popstate handler
  // ============================================================

  useEffect(() => {
    const onPopState = () => {
      setShowModal(false);
      setEditingTodo(null);
      setConfirmDelete(null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ============================================================
  // Form updater
  // ============================================================

  const updateForm = useCallback(<K extends keyof TodoFormData>(key: K, value: TodoFormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleAssignee = useCallback((userId: number) => {
    setForm(prev => {
      const ids = prev.assigneeIds.includes(userId)
        ? prev.assigneeIds.filter(id => id !== userId)
        : [...prev.assigneeIds, userId];
      return { ...prev, assigneeIds: ids };
    });
  }, []);

  const handleAddComment = useCallback(async () => {
    if (!editingTodo || !commentText.trim()) return;
    setCommentLoading(true);
    try {
      const c = await api.addTodoComment(editingTodo.id, commentText.trim());
      setComments(prev => [...prev, c]);
      setCommentText('');
      loadTodos(); // commentCount 갱신
    } catch (e) {
      console.error('Failed to add comment:', e);
    } finally {
      setCommentLoading(false);
    }
  }, [editingTodo, commentText, loadTodos]);

  const handleDeleteComment = useCallback(async (commentId: number) => {
    try {
      await api.deleteTodoComment(commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
      loadTodos(); // commentCount 갱신
    } catch (e) {
      console.error('Failed to delete comment:', e);
    }
  }, [loadTodos]);

  // ============================================================
  // Render
  // ============================================================

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
            <h1 className={styles.pageTitle}>해야할일</h1>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.addBtn} onClick={() => openCreateModal()}>
              <PlusIcon />
              <span>새 할일</span>
            </button>
          </div>
        </div>
      )}

      <div className={styles.main}>
        {/* Status Tabs */}
        <div className={styles.statusTabs}>
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              className={`${styles.statusTab} ${status === tab.value ? styles.statusTabActive : ''}`}
              onClick={() => handleStatusChange(tab.value)}
            >
              {tab.label}
              <span className={styles.statusBadge}>{counts[tab.value]}</span>
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading ? (
          <div className={styles.skeleton}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={styles.skeletonCard}>
                <div className={styles.skeletonCircle} />
                <div className={styles.skeletonContent}>
                  <div className={styles.skeletonLineShort} />
                  <div className={styles.skeletonLineTiny} />
                </div>
              </div>
            ))}
          </div>
        ) : todos.length === 0 ? (
          /* Empty State */
          <div className={styles.emptyState}>
            <EmptyIcon />
            <div className={styles.emptyTitle}>
              {status === 'todo' && '해야할일이 없어요'}
              {status === 'in_progress' && '진행 중인 일이 없어요'}
              {status === 'done' && '완료된 일이 없어요'}
            </div>
            <div className={styles.emptyDesc}>
              {status === 'todo' && '새 할일을 만들어 가족과 함께 관리해보세요'}
              {status === 'in_progress' && '해야할일을 체크하면 진행 중으로 이동해요'}
              {status === 'done' && '완료된 일이 여기에 표시돼요'}
            </div>
            {status === 'todo' && (
              <button className={styles.emptyBtn} onClick={() => openCreateModal()}>
                <PlusIcon />
                새 할일 만들기
              </button>
            )}
          </div>
        ) : (
          /* Todo List */
          <div className={styles.todoList}>
            {todos.map(todo => (
              <TodoItem
                key={todo.id}
                todo={todo}
                status={status}
                expanded={expanded}
                removingIds={removingIds}
                onCheck={handleCheck}
                onToggleExpand={toggleExpand}
                onEdit={openEditModal}
                onCardClick={openEditModal}
              />
            ))}
          </div>
        )}
      </div>

      {/* FAB (mobile) */}
      <button className={styles.fab} onClick={() => openCreateModal()}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBackdrop} onClick={closeModal} />
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <button className={styles.modalCancel} onClick={closeModal}>취소</button>
              <span className={styles.modalTitle}>
                {editingTodo ? '편집' : '새 해야할일'}
              </span>
              <button
                className={styles.modalSave}
                disabled={!form.title.trim() || saving}
                onClick={handleSave}
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
            <div className={styles.modalBody}>
              {/* Title */}
              <div className={styles.formSection}>
                <input
                  className={styles.titleInput}
                  placeholder="할일 제목"
                  value={form.title}
                  onChange={e => updateForm('title', e.target.value)}
                  autoFocus
                />
                <textarea
                  className={styles.descInput}
                  placeholder="설명 (선택)"
                  value={form.description}
                  onChange={e => updateForm('description', e.target.value)}
                  rows={2}
                />
              </div>

              {/* Priority */}
              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>
                  <span className={styles.sectionLabelIcon}><FlagIcon /></span>
                  우선순위
                </div>
                <div className={styles.priorityPicker}>
                  {PRIORITY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`${styles.priorityPill} ${form.priority === opt.value ? priorityPillActiveClass[opt.value] : ''}`}
                      onClick={() => updateForm('priority', opt.value)}
                    >
                      {form.priority !== opt.value && (
                        <span className={styles.priorityPillDot} style={{ background: opt.color }} />
                      )}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Due Date */}
              <div className={styles.formSection}>
                <div className={styles.formRow}>
                  <div className={styles.formRowLabel}>
                    <span className={styles.formRowIcon}><CalendarSmallIcon /></span>
                    마감일
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={form.dueDate}
                      onChange={e => updateForm('dueDate', e.target.value)}
                    />
                    {form.dueDate && (
                      <button
                        className={styles.dateClearBtn}
                        onClick={() => updateForm('dueDate', '')}
                      >
                        <XIcon />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Assignees */}
              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>
                  <span className={styles.sectionLabelIcon}><UsersIcon /></span>
                  담당자
                </div>
                <div className={styles.chipList}>
                  {users.map(u => {
                    const selected = form.assigneeIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        className={`${styles.chip} ${selected ? styles.chipSelected : ''}`}
                        onClick={() => toggleAssignee(u.id)}
                      >
                        {u.profileImage ? (
                          <img src={u.profileImage} alt="" className={styles.chipAvatar} />
                        ) : (
                          <span className={styles.chipAvatarFallback}>{u.name[0]}</span>
                        )}
                        {u.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Status (edit mode only) */}
              {editingTodo && (
                <div className={styles.formSection}>
                  <div className={styles.sectionLabel}>
                    <span className={styles.sectionLabelIcon}>📊</span>
                    상태
                  </div>
                  <div className={styles.statusPicker}>
                    {STATUS_TABS.map(tab => (
                      <button
                        key={tab.value}
                        className={`${styles.statusPill} ${form.status === tab.value ? styles.statusPillActive : ''}`}
                        onClick={() => updateForm('status', tab.value)}
                      >
                        {tab.value === 'todo' && <span className={styles.statusPillDot} style={{ background: 'var(--color-text-tertiary)' }} />}
                        {tab.value === 'in_progress' && <span className={styles.statusPillDot} style={{ background: 'var(--color-warning)' }} />}
                        {tab.value === 'done' && <span className={styles.statusPillDot} style={{ background: 'var(--color-success)' }} />}
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Private toggle */}
              <div className={styles.formSection}>
                <div className={styles.formRow}>
                  <div className={styles.formRowLabel}>
                    <span className={styles.formRowIcon}><LockIcon /></span>
                    비공개
                  </div>
                  <div
                    className={`${styles.toggle} ${form.isPrivate ? styles.toggleActive : ''}`}
                    onClick={() => updateForm('isPrivate', !form.isPrivate)}
                  >
                    <div className={styles.toggleKnob} />
                  </div>
                </div>
              </div>

              {/* Comments (edit mode only) */}
              {editingTodo && (
                <div className={styles.formSection}>
                  <div className={styles.sectionLabel}>
                    <span className={styles.sectionLabelIcon}>💬</span>
                    댓글 {comments.length > 0 && <span className={styles.commentBadge}>{comments.length}</span>}
                  </div>
                  <div className={styles.commentList}>
                    {comments.map(c => (
                      <div key={c.id} className={styles.commentItem}>
                        <div className={styles.commentHeader}>
                          {c.userImage
                            ? <img src={c.userImage} alt="" className={styles.commentAvatar} />
                            : <span className={styles.commentAvatarFallback}>{c.userName[0]}</span>
                          }
                          <span className={styles.commentName}>{c.userName}</span>
                          <span className={styles.commentTime}>{c.createdAt.slice(5, 16).replace(' ', ' ')}</span>
                          <button className={styles.commentDeleteBtn} onClick={() => handleDeleteComment(c.id)}>×</button>
                        </div>
                        <div className={styles.commentContent}>{c.content}</div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.commentInput}>
                    <input
                      className={styles.commentInputField}
                      placeholder="댓글 입력..."
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddComment(); }}
                    />
                    <button
                      className={styles.commentSendBtn}
                      disabled={!commentText.trim() || commentLoading}
                      onClick={handleAddComment}
                    >
                      {commentLoading ? '...' : '전송'}
                    </button>
                  </div>
                </div>
              )}

              {/* Delete button (edit mode only) */}
              {editingTodo && (
                <div className={styles.deleteSection}>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => setConfirmDelete(editingTodo)}
                  >
                    삭제
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
            <div className={styles.confirmTitle}>할일 삭제</div>
            <div className={styles.confirmMessage}>
              "{confirmDelete.title}"을(를) 삭제할까요?
              {confirmDelete.subtasks.length > 0 && (
                <><br />하위 작업 {confirmDelete.subtasks.length}개도 함께 삭제됩니다.</>
              )}
            </div>
            <div className={styles.confirmActions}>
              <button className={styles.confirmCancel} onClick={() => setConfirmDelete(null)}>취소</button>
              <button className={styles.confirmDelete} onClick={handleDelete}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TodoItem component
// ============================================================

interface TodoItemProps {
  todo: Todo;
  status: StatusFilter;
  expanded: Set<number>;
  removingIds: Set<number>;
  isSubtask?: boolean;
  onCheck: (todo: Todo, e: React.MouseEvent) => void;
  onToggleExpand: (id: number, e: React.MouseEvent) => void;
  onEdit: (todo: Todo, e: React.MouseEvent) => void;
  onCardClick: (todo: Todo, e: React.MouseEvent) => void;
}

function TodoItem({ todo, status, expanded, removingIds, isSubtask, onCheck, onToggleExpand, onEdit, onCardClick }: TodoItemProps) {
  const isExpanded = expanded.has(todo.id);
  const hasSubtasks = todo.subtasks && todo.subtasks.length > 0;
  const doneSubtasks = hasSubtasks ? todo.subtasks.filter(s => s.status === 'done').length : 0;
  const totalSubtasks = hasSubtasks ? todo.subtasks.length : 0;
  const isRemoving = removingIds.has(todo.id);
  const subtaskListRef = useRef<HTMLDivElement>(null);

  const cardClasses = [
    isSubtask ? styles.subtaskCard : styles.todoCard,
    priorityClass[todo.priority],
    todo.status === 'done' ? styles.todoCardDone : '',
    isRemoving ? styles.todoCardRemoving : '',
  ].filter(Boolean).join(' ');

  // Checkbox state
  const checkboxClass = [
    styles.checkbox,
    todo.status === 'done' ? styles.checkboxChecked : '',
    todo.status === 'in_progress' ? styles.checkboxProgress : '',
  ].filter(Boolean).join(' ');

  // Assignee rendering (max 3)
  const visibleAssignees = todo.assignees.slice(0, 3);
  const moreCount = todo.assignees.length - 3;

  return (
    <>
      <div className={cardClasses} onClick={(e) => onCardClick(todo, e)}>
        {/* Checkbox */}
        <div className={checkboxClass} onClick={(e) => onCheck(todo, e)}>
          <div className={styles.checkboxCircle}>
            {todo.status === 'done' ? (
              <svg className={styles.checkmark} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 6 5 9 10 3" />
              </svg>
            ) : todo.status === 'in_progress' ? (
              <div className={styles.progressDot} />
            ) : null}
          </div>
        </div>

        {/* Content */}
        <div className={styles.cardContent}>
          <div className={`${styles.cardTitle} ${todo.status === 'done' ? styles.cardTitleDone : ''}`}>
            {todo.isPrivate && <span className={styles.privateBadge}><LockSmallIcon /></span>}
            {todo.title}
          </div>
          {(todo.descriptionPolished || todo.description) && (
            <div className={styles.cardDesc}>{todo.descriptionPolished || todo.description}</div>
          )}
          <div className={styles.cardMeta}>
            {/* Due date badge */}
            {todo.dueDate && todo.status !== 'done' && (
              <DueBadge dateStr={todo.dueDate} />
            )}
            {/* Subtask progress */}
            {hasSubtasks && (
              <div className={styles.subtaskBadge}>
                <div className={styles.subtaskProgress}>
                  <div
                    className={styles.subtaskProgressFill}
                    style={{ width: `${totalSubtasks > 0 ? (doneSubtasks / totalSubtasks) * 100 : 0}%` }}
                  />
                </div>
                {doneSubtasks}/{totalSubtasks} 하위
              </div>
            )}
            {/* Comment count */}
            {todo.commentCount > 0 && (
              <span className={styles.commentCountBadge}>💬 {todo.commentCount}</span>
            )}
            {/* Assignees */}
            {todo.assignees.length > 0 && (
              <div className={styles.assignees}>
                {visibleAssignees.map(a =>
                  a.profileImage ? (
                    <img key={a.userId} src={a.profileImage} alt={a.name} className={styles.assigneeAvatar} />
                  ) : (
                    <span key={a.userId} className={styles.assigneeFallback}>{a.name[0]}</span>
                  )
                )}
                {moreCount > 0 && (
                  <span className={styles.assigneeMore}>+{moreCount}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Expand button for subtasks */}
        {hasSubtasks && !isSubtask && (
          <button className={styles.expandBtn} onClick={(e) => onToggleExpand(todo.id, e)}>
            <svg
              className={`${styles.expandIcon} ${isExpanded ? styles.expandIconOpen : ''}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 4 10 8 6 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Subtasks */}
      {hasSubtasks && !isSubtask && (
        <div
          ref={subtaskListRef}
          className={`${styles.subtaskList} ${!isExpanded ? styles.subtaskListHidden : ''}`}
          style={{ maxHeight: isExpanded ? (totalSubtasks * 120) + 'px' : 0 }}
        >
          <div className={styles.subtaskWrapper}>
            {todo.subtasks.map(sub => (
              <TodoItem
                key={sub.id}
                todo={sub}
                status={status}
                expanded={expanded}
                removingIds={removingIds}
                isSubtask
                onCheck={onCheck}
                onToggleExpand={onToggleExpand}
                onEdit={onEdit}
                onCardClick={onCardClick}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// DueBadge component
// ============================================================

function DueBadge({ dateStr }: { dateStr: string }) {
  const dateStatus = getDueDateStatus(dateStr);
  const label = getDueDateLabel(dateStr);
  const cls = [
    styles.dueBadge,
    dateStatus === 'overdue' ? styles.dueBadgeOverdue : '',
    dateStatus === 'today' ? styles.dueBadgeToday : '',
    dateStatus === 'soon' ? styles.dueBadgeSoon : '',
  ].filter(Boolean).join(' ');

  return (
    <span className={cls}>
      <svg className={styles.dueBadgeIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="12" height="12" rx="2" />
        <line x1="2" y1="7" x2="14" y2="7" />
        <line x1="5" y1="1" x2="5" y2="5" />
        <line x1="11" y1="1" x2="11" y2="5" />
      </svg>
      {label}
    </span>
  );
}

// ============================================================
// Icons
// ============================================================

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

function CalendarSmallIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function LockSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3, verticalAlign: 'middle', display: 'inline' }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg className={styles.emptyIcon} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="12" width="48" height="44" rx="6" />
      <line x1="8" y1="24" x2="56" y2="24" />
      <line x1="20" y1="6" x2="20" y2="18" />
      <line x1="44" y1="6" x2="44" y2="18" />
      <polyline points="24 38 30 44 42 32" />
    </svg>
  );
}
