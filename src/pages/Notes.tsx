import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api, type User, type NoteTopic, type Note } from '../api';
import styles from './Notes.module.css';

interface Props {
  user: User;
  embedded?: boolean;
}

// ============================================================
// Constants
// ============================================================

const EMOJI_OPTIONS = [
  '📝', '📋', '📌', '🗂️', '💡', '🎯', '📖', '✏️',
  '🏠', '👨‍👩‍👧‍👦', '🐶', '💰', '🎓', '🏥', '✈️', '🎂', '🎄',
  '🍳', '🛒', '💊', '🎵', '📸', '🏋️', '🎮', '📱', '🚗', '🌱',
];

const AUTOSAVE_DELAY = 1500;

type MobileScreen = 'topics' | 'notes' | 'editor';

// ============================================================
// SVG Icons (inline to avoid external deps)
// ============================================================

function IconChevronLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconPlus({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function IconMore() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="3" r="1.2" fill="currentColor"/>
      <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
      <circle cx="8" cy="13" r="1.2" fill="currentColor"/>
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M11.5 2.5L13.5 4.5L5 13H3V11L11.5 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 4H14M5.333 4V2.667C5.333 2.298 5.632 2 6 2H10C10.368 2 10.667 2.298 10.667 2.667V4M6.667 7.333V11.333M9.333 7.333V11.333" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3.333 4L4 13.333C4 13.702 4.298 14 4.667 14H11.333C11.702 14 12 13.702 12 13.333L12.667 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconNote() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <rect x="8" y="6" width="24" height="28" rx="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M14 14H26M14 20H22M14 26H24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 7V5C5 3.343 6.343 2 8 2C9.657 2 11 3.343 11 5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

// ============================================================
// Helpers
// ============================================================

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHr < 24) return `${diffHr}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;

  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return y === now.getFullYear() ? `${m}월 ${day}일` : `${y}.${m}.${day}`;
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return '방금 전 저장';
  if (diffMin < 60) return `${diffMin}분 전 저장`;
  if (diffHr < 24) return `${diffHr}시간 전 저장`;
  return formatDate(dateStr) + ' 저장';
}

function staggerClass(index: number): string {
  const n = Math.min(index + 1, 10);
  return styles[`stagger${n}` as keyof typeof styles] || '';
}

// ============================================================
// Notes Component
// ============================================================

export default function Notes({ user, embedded }: Props) {
  // Data state
  const [topics, setTopics] = useState<NoteTopic[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  // Selection state
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);

  // Mobile navigation
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>('topics');
  const [slideDir, setSlideDir] = useState<'forward' | 'back'>('forward');

  // Editor state
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Modal state
  const [topicModal, setTopicModal] = useState<{ mode: 'create' | 'edit'; topic?: NoteTopic } | null>(null);
  const [topicModalName, setTopicModalName] = useState('');
  const [topicModalIcon, setTopicModalIcon] = useState('📝');
  const [topicModalPrivate, setTopicModalPrivate] = useState(false);

  // Context menu
  const [contextMenuTopicId, setContextMenuTopicId] = useState<number | null>(null);

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // ============================================================
  // Data Loading
  // ============================================================

  const loadTopics = useCallback(async () => {
    try {
      const data = await api.getNoteTopics();
      setTopics(data);
    } catch (e) {
      console.error('Failed to load topics', e);
    }
  }, []);

  const loadNotes = useCallback(async (topicId: number) => {
    try {
      const data = await api.getNotes(topicId);
      setNotes(data.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    } catch (e) {
      console.error('Failed to load notes', e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadTopics();
      setLoading(false);
    })();
  }, [loadTopics]);

  useEffect(() => {
    if (selectedTopicId != null) {
      loadNotes(selectedTopicId);
    } else {
      setNotes([]);
    }
  }, [selectedTopicId, loadNotes]);

  // ============================================================
  // Derived
  // ============================================================

  const selectedTopic = useMemo(() => topics.find(t => t.id === selectedTopicId) ?? null, [topics, selectedTopicId]);

  // ============================================================
  // Topic CRUD
  // ============================================================

  const openTopicCreate = useCallback(() => {
    setTopicModal({ mode: 'create' });
    setTopicModalName('');
    setTopicModalIcon('📝');
    setTopicModalPrivate(false);
  }, []);

  const openTopicEdit = useCallback((topic: NoteTopic) => {
    setTopicModal({ mode: 'edit', topic });
    setTopicModalName(topic.name);
    setTopicModalIcon(topic.icon);
    setTopicModalPrivate(topic.isPrivate);
    setContextMenuTopicId(null);
  }, []);

  const saveTopic = useCallback(async () => {
    if (!topicModalName.trim()) return;
    try {
      if (topicModal?.mode === 'create') {
        await api.createNoteTopic({ name: topicModalName.trim(), icon: topicModalIcon, isPrivate: topicModalPrivate });
      } else if (topicModal?.mode === 'edit' && topicModal.topic) {
        await api.updateNoteTopic(topicModal.topic.id, { name: topicModalName.trim(), icon: topicModalIcon, isPrivate: topicModalPrivate });
      }
      await loadTopics();
      setTopicModal(null);
    } catch (e) {
      console.error('Failed to save topic', e);
    }
  }, [topicModal, topicModalName, topicModalIcon, loadTopics]);

  const deleteTopic = useCallback((topic: NoteTopic) => {
    setContextMenuTopicId(null);
    setConfirmDialog({
      title: '주제 삭제',
      message: `"${topic.name}" 주제와 포함된 모든 노트가 삭제됩니다.`,
      onConfirm: async () => {
        try {
          await api.deleteNoteTopic(topic.id);
          if (selectedTopicId === topic.id) {
            setSelectedTopicId(null);
            setSelectedNoteId(null);
          }
          await loadTopics();
        } catch (e) {
          console.error('Failed to delete topic', e);
        }
        setConfirmDialog(null);
      },
    });
  }, [selectedTopicId, loadTopics]);

  // ============================================================
  // Note CRUD
  // ============================================================

  const selectNote = useCallback((note: Note) => {
    // Cancel any pending auto-save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    setSelectedNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setSaveStatus('idle');
    setLastSavedAt(note.updatedAt);
  }, []);

  const createNote = useCallback(async () => {
    if (selectedTopicId == null) return;
    try {
      const note = await api.createNote({
        topicId: selectedTopicId,
        title: '새 노트',
        content: '',
      });
      await loadNotes(selectedTopicId);
      await loadTopics(); // update count
      selectNote(note);

      // On mobile, navigate to editor
      setSlideDir('forward');
      setMobileScreen('editor');

      // Focus title
      setTimeout(() => {
        titleRef.current?.focus();
        titleRef.current?.select();
      }, 400);
    } catch (e) {
      console.error('Failed to create note', e);
    }
  }, [selectedTopicId, loadNotes, loadTopics, selectNote]);

  const autoSave = useCallback(async (noteId: number, title: string, content: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        const updated = await api.updateNote(noteId, {
          title: title.trim() || '제목 없음',
          content,
        });
        setSaveStatus('saved');
        setLastSavedAt(updated.updatedAt);

        // Update note in list
        setNotes(prev => prev.map(n =>
          n.id === noteId ? { ...n, title: updated.title, content: updated.content, updatedAt: updated.updatedAt } : n
        ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));

        // Reset to idle after 2s
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (e) {
        console.error('Failed to save note', e);
        setSaveStatus('idle');
      }
    }, AUTOSAVE_DELAY);
  }, []);

  const handleTitleChange = useCallback((value: string) => {
    setEditTitle(value);
    if (selectedNoteId != null) {
      autoSave(selectedNoteId, value, editContent);
    }
  }, [selectedNoteId, editContent, autoSave]);

  const handleContentChange = useCallback((value: string) => {
    setEditContent(value);
    if (selectedNoteId != null) {
      autoSave(selectedNoteId, editTitle, value);
    }
  }, [selectedNoteId, editTitle, autoSave]);

  const deleteNote = useCallback(() => {
    if (selectedNoteId == null) return;
    const note = notes.find(n => n.id === selectedNoteId);
    if (!note) return;

    setConfirmDialog({
      title: '노트 삭제',
      message: `"${note.title}" 노트를 삭제할까요?`,
      onConfirm: async () => {
        try {
          await api.deleteNote(selectedNoteId);
          setSelectedNoteId(null);
          if (selectedTopicId != null) {
            await loadNotes(selectedTopicId);
            await loadTopics();
          }
          // Mobile: go back
          setSlideDir('back');
          setMobileScreen('notes');
        } catch (e) {
          console.error('Failed to delete note', e);
        }
        setConfirmDialog(null);
      },
    });
  }, [selectedNoteId, notes, selectedTopicId, loadNotes, loadTopics]);

  // ============================================================
  // Mobile Navigation
  // ============================================================

  const navigateToNotes = useCallback((topicId: number) => {
    setSelectedTopicId(topicId);
    setSelectedNoteId(null);
    setSlideDir('forward');
    setMobileScreen('notes');
  }, []);

  const navigateToEditor = useCallback((note: Note) => {
    selectNote(note);
    setSlideDir('forward');
    setMobileScreen('editor');
  }, [selectNote]);

  const navigateBack = useCallback(() => {
    // Flush any pending save immediately
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      if (selectedNoteId != null) {
        // Fire off immediate save
        api.updateNote(selectedNoteId, {
          title: editTitle.trim() || '제목 없음',
          content: editContent,
        }).then(() => {
          if (selectedTopicId != null) loadNotes(selectedTopicId);
          loadTopics();
        }).catch(() => {});
      }
    }

    setSlideDir('back');
    if (mobileScreen === 'editor') {
      setMobileScreen('notes');
      setSelectedNoteId(null);
    } else if (mobileScreen === 'notes') {
      setMobileScreen('topics');
      setSelectedTopicId(null);
      setSelectedNoteId(null);
    }
  }, [mobileScreen, selectedNoteId, selectedTopicId, editTitle, editContent, loadNotes, loadTopics]);

  // Close context menu on outside click
  useEffect(() => {
    if (contextMenuTopicId == null) return;
    const handle = (e: MouseEvent) => {
      // Small delay to let click handlers fire first
      setTimeout(() => setContextMenuTopicId(null), 50);
    };
    document.addEventListener('click', handle);
    return () => document.removeEventListener('click', handle);
  }, [contextMenuTopicId]);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(200, el.scrollHeight) + 'px';
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [editContent, adjustTextareaHeight]);

  // ============================================================
  // Render: Topic List (shared between mobile & desktop)
  // ============================================================

  const renderTopicCards = (compact?: boolean) => {
    if (loading) {
      return (
        <div className={styles.loading}>
          <div className={styles.loadingSpinner} />
          불러오는 중...
        </div>
      );
    }

    if (topics.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>📂</div>
          <div className={styles.emptyStateTitle}>아직 주제가 없어요</div>
          <div className={styles.emptyStateDesc}>주제를 만들어 노트를 정리하세요</div>
          <button className={styles.emptyStateBtn} onClick={openTopicCreate}>
            <IconPlus size={16} />
            주제 만들기
          </button>
        </div>
      );
    }

    if (compact) {
      return topics.map((topic) => (
        <div
          key={topic.id}
          className={`${styles.sidebarTopicItem} ${selectedTopicId === topic.id ? styles.sidebarTopicItemSelected : ''}`}
          style={{ zIndex: contextMenuTopicId === topic.id ? 50 : undefined }}
          onClick={() => {
            setSelectedTopicId(topic.id);
            setSelectedNoteId(null);
          }}
        >
          <span className={styles.sidebarTopicIcon}>{topic.icon}</span>
          <span className={styles.sidebarTopicName}>{topic.name}</span>
          <span className={styles.sidebarTopicCount}>{topic.noteCount}</span>
          <div className={styles.sidebarTopicActions} onClick={e => e.stopPropagation()}>
            <button
              className={styles.topicActionBtn}
              onClick={(e) => {
                e.stopPropagation();
                setContextMenuTopicId(contextMenuTopicId === topic.id ? null : topic.id);
              }}
            >
              <IconMore />
            </button>
          </div>
          {contextMenuTopicId === topic.id && (
            <div className={styles.contextMenu} onClick={e => e.stopPropagation()}>
              <button className={styles.contextMenuItem} onClick={() => openTopicEdit(topic)}>
                <IconEdit />
                수정
              </button>
              <button className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`} onClick={() => deleteTopic(topic)}>
                <IconTrash />
                삭제
              </button>
            </div>
          )}
        </div>
      ));
    }

    return topics.map((topic, i) => (
      <div
        key={topic.id}
        className={`${styles.topicCard} ${selectedTopicId === topic.id ? styles.topicCardSelected : ''} ${styles.noteCard} ${staggerClass(i)}`}
        style={{ flexDirection: 'row', gap: '12px', zIndex: contextMenuTopicId === topic.id ? 50 : undefined }}
        onClick={() => navigateToNotes(topic.id)}
      >
        <div className={styles.topicIcon}>{topic.icon}</div>
        <div className={styles.topicInfo}>
          <div className={styles.topicName}>
            {topic.name}
            {topic.isPrivate && (
              <span className={styles.privateBadge}><IconLock /></span>
            )}
          </div>
          <div className={styles.topicCount}>
            {topic.noteCount > 0 ? `${topic.noteCount}개의 노트` : '노트 없음'}
          </div>
        </div>
        <div className={styles.topicBadge}>{topic.noteCount}</div>
        <div className={styles.topicActions} onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
          <button
            className={styles.topicActionBtn}
            onClick={(e) => {
              e.stopPropagation();
              setContextMenuTopicId(contextMenuTopicId === topic.id ? null : topic.id);
            }}
          >
            <IconMore />
          </button>
          {contextMenuTopicId === topic.id && (
            <div className={styles.contextMenu} onClick={e => e.stopPropagation()}>
              <button className={styles.contextMenuItem} onClick={() => openTopicEdit(topic)}>
                <IconEdit />
                수정
              </button>
              <button className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`} onClick={() => deleteTopic(topic)}>
                <IconTrash />
                삭제
              </button>
            </div>
          )}
        </div>
      </div>
    ));
  };

  // ============================================================
  // Render: Note List
  // ============================================================

  const renderNoteCards = (compact?: boolean) => {
    if (notes.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>📝</div>
          <div className={styles.emptyStateTitle}>아직 노트가 없어요</div>
          <div className={styles.emptyStateDesc}>첫 번째 노트를 작성해보세요</div>
          <button className={styles.emptyStateBtn} onClick={createNote}>
            <IconPlus size={16} />
            새 노트
          </button>
        </div>
      );
    }

    if (compact) {
      return notes.map((note) => (
        <div
          key={note.id}
          className={`${styles.sidebarNoteItem} ${selectedNoteId === note.id ? styles.sidebarNoteItemSelected : ''}`}
          onClick={() => {
            selectNote(note);
          }}
        >
          <div className={styles.sidebarNoteTitle}>
            {note.title || '제목 없음'}
            {note.isPrivate && (
              <span className={styles.privateBadge}><IconLock /></span>
            )}
          </div>
          {(note.contentPolished || note.content) && (
            <div className={styles.sidebarNotePreview}>
              {(note.contentPolished || note.content).slice(0, 80)}
            </div>
          )}
          <div className={styles.sidebarNoteMeta}>
            <span>{formatDate(note.updatedAt)}</span>
            <span>·</span>
            <span>{note.creatorName}</span>
          </div>
        </div>
      ));
    }

    return notes.map((note, i) => (
      <div
        key={note.id}
        className={`${styles.noteCard} ${staggerClass(i)}`}
        onClick={() => navigateToEditor(note)}
      >
        <div className={styles.noteTitle}>
          {note.title || '제목 없음'}
          {note.isPrivate && (
            <span className={styles.privateBadge}><IconLock /></span>
          )}
        </div>
        {(note.contentPolished || note.content) && (
          <div className={styles.notePreview}>{note.contentPolished || note.content}</div>
        )}
        <div className={styles.noteMeta}>
          <span className={styles.noteDate}>{formatDate(note.updatedAt)}</span>
          <div className={styles.noteAuthor}>
            {note.creatorImage ? (
              <img src={note.creatorImage} alt="" className={styles.noteAuthorAvatar} />
            ) : (
              <span className={styles.noteAuthorAvatarFallback}>
                {note.creatorName.charAt(0)}
              </span>
            )}
            {note.creatorName}
          </div>
        </div>
      </div>
    ));
  };

  // ============================================================
  // Render: Note Editor
  // ============================================================

  const renderEditor = (showBackOnMobile?: boolean) => {
    if (selectedNoteId == null) {
      return (
        <div className={styles.emptyEditor}>
          <div className={styles.emptyEditorIcon}>
            <IconNote />
          </div>
          <div className={styles.emptyEditorText}>노트를 선택하세요</div>
        </div>
      );
    }

    return (
      <div className={styles.editor}>
        <div className={styles.editorHeader}>
          <div className={styles.editorHeaderLeft}>
            {showBackOnMobile && (
              <button className={styles.backBtn} onClick={navigateBack}>
                <span className={styles.backBtnIcon}><IconChevronLeft /></span>
                돌아가기
              </button>
            )}
            {!showBackOnMobile && (
              <div className={styles.saveIndicator}>
                {saveStatus === 'saving' && (
                  <>
                    <span className={`${styles.saveDot} ${styles.saveDotPulse}`} />
                    저장 중...
                  </>
                )}
                {saveStatus === 'saved' && (
                  <>
                    <span className={styles.saveCheck}><IconCheck /></span>
                    저장됨
                  </>
                )}
                {saveStatus === 'idle' && lastSavedAt && (
                  <>마지막 저장: {timeAgo(lastSavedAt)}</>
                )}
              </div>
            )}
          </div>
          <div className={styles.editorHeaderRight}>
            {showBackOnMobile && (
              <div className={`${styles.saveIndicator} ${saveStatus === 'saving' ? styles.saveIndicatorSaving : ''} ${saveStatus === 'saved' ? styles.saveIndicatorSaved : ''}`}>
                {saveStatus === 'saving' && (
                  <>
                    <span className={`${styles.saveDot} ${styles.saveDotPulse}`} />
                    저장 중
                  </>
                )}
                {saveStatus === 'saved' && (
                  <>
                    <span className={styles.saveCheck}><IconCheck /></span>
                    저장됨
                  </>
                )}
              </div>
            )}
            <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={deleteNote}>
              <IconTrash />
            </button>
          </div>
        </div>
        <div className={styles.editorBody}>
          <input
            ref={titleRef}
            className={styles.editorTitleInput}
            value={editTitle}
            onChange={e => handleTitleChange(e.target.value)}
            placeholder="제목"
          />
          <div className={styles.editorDivider} />
          <textarea
            ref={contentRef}
            className={styles.editorContentInput}
            value={editContent}
            onChange={e => handleContentChange(e.target.value)}
            placeholder="내용을 입력하세요..."
          />
        </div>
      </div>
    );
  };

  // ============================================================
  // Render: Topic Modal
  // ============================================================

  const renderTopicModal = () => {
    if (!topicModal) return null;
    const isEdit = topicModal.mode === 'edit';

    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={() => setTopicModal(null)} />
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <button className={styles.modalCancel} onClick={() => setTopicModal(null)}>
              취소
            </button>
            <div className={styles.modalTitle}>
              {isEdit ? '주제 수정' : '새 주제'}
            </div>
            <button
              className={styles.modalSave}
              onClick={saveTopic}
              disabled={!topicModalName.trim()}
            >
              {isEdit ? '저장' : '만들기'}
            </button>
          </div>
          <div className={styles.modalBody}>
            <div className={styles.emojiPicker}>
              <div className={styles.emojiLabel}>아이콘</div>
              <div className={styles.emojiGrid}>
                {EMOJI_OPTIONS.map(emoji => (
                  <button
                    key={emoji}
                    className={`${styles.emojiOption} ${topicModalIcon === emoji ? styles.emojiOptionSelected : ''}`}
                    onClick={() => setTopicModalIcon(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className={styles.emojiLabel} style={{ marginBottom: 8 }}>주제 이름</div>
              <input
                className={styles.topicInput}
                value={topicModalName}
                onChange={e => setTopicModalName(e.target.value)}
                placeholder="예: 장보기, 여행 계획, 회의록..."
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && topicModalName.trim()) saveTopic(); }}
              />
            </div>
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className={styles.emojiLabel}>비공개</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>나만 볼 수 있는 주제</div>
              </div>
              <button
                className={`${styles.privacyToggle} ${topicModalPrivate ? styles.privacyToggleOn : ''}`}
                onClick={() => setTopicModalPrivate(!topicModalPrivate)}
                type="button"
              >
                <div className={styles.privacyToggleKnob} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // Render: Confirm Dialog
  // ============================================================

  const renderConfirmDialog = () => {
    if (!confirmDialog) return null;
    return (
      <div className={styles.confirmOverlay}>
        <div className={styles.confirmBackdrop} onClick={() => setConfirmDialog(null)} />
        <div className={styles.confirmDialog}>
          <div className={styles.confirmTitle}>{confirmDialog.title}</div>
          <div className={styles.confirmMessage}>{confirmDialog.message}</div>
          <div className={styles.confirmActions}>
            <button className={styles.confirmCancel} onClick={() => setConfirmDialog(null)}>
              취소
            </button>
            <button className={styles.confirmDelete} onClick={confirmDialog.onConfirm}>
              삭제
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // Mobile Layout
  // ============================================================

  const renderMobile = () => {
    const enterAnim = slideDir === 'forward' ? styles.screenEnterFromRight : styles.screenEnterFromLeft;

    return (
      <div className={styles.mobileView}>
        <div className={styles.screenWrapper}>
          {mobileScreen === 'topics' && (
            <div className={`${styles.screen} ${enterAnim}`} key="topics">
              {!embedded ? (
                <div className={styles.pageHeader}>
                  <div className={styles.brand}>
                    <div className={styles.brandBlock}>
                      <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
                      <span className={styles.brandName}>땅콩패밀리</span>
                    </div>
                    <div className={styles.pageTitle}>노트</div>
                  </div>
                  <div className={styles.headerActions}>
                    <button className={styles.iconBtn} onClick={openTopicCreate}>
                      <IconPlus />
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.embeddedHeader}>
                  <button className={`${styles.iconBtn} ${styles.iconBtnPrimary}`} onClick={openTopicCreate}>
                    <IconPlus />
                  </button>
                </div>
              )}
              <div className={styles.topicList}>
                {renderTopicCards(false)}
              </div>
            </div>
          )}

          {mobileScreen === 'notes' && (
            <div className={`${styles.screen} ${enterAnim}`} key="notes">
              <div className={styles.subHeader}>
                <button className={styles.backBtn} onClick={navigateBack}>
                  <span className={styles.backBtnIcon}><IconChevronLeft /></span>
                  주제
                </button>
                <button className={`${styles.iconBtn} ${styles.iconBtnPrimary}`} onClick={createNote}>
                  <IconPlus />
                </button>
              </div>
              <div className={styles.subHeader} style={{ paddingTop: 0 }}>
                <div className={styles.subHeaderTitle}>
                  {selectedTopic && <span className={styles.subHeaderTitleIcon}>{selectedTopic.icon}</span>}
                  {selectedTopic?.name ?? ''}
                </div>
              </div>
              <div className={styles.noteList}>
                {renderNoteCards(false)}
              </div>
            </div>
          )}

          {mobileScreen === 'editor' && (
            <div className={`${styles.screen} ${enterAnim}`} key="editor" style={{ paddingBottom: 0 }}>
              {renderEditor(true)}
            </div>
          )}
        </div>

        {/* FAB only on topics screen */}
        {mobileScreen === 'topics' && topics.length > 0 && (
          <button className={styles.fab} onClick={openTopicCreate}>
            <IconPlus size={24} />
          </button>
        )}

        {/* FAB on notes screen */}
        {mobileScreen === 'notes' && selectedTopicId != null && (
          <button className={styles.fab} onClick={createNote}>
            <IconPlus size={24} />
          </button>
        )}
      </div>
    );
  };

  // ============================================================
  // Desktop Layout
  // ============================================================

  const renderDesktop = () => {
    return (
      <div className={styles.desktopView}>
        {/* Sidebar */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarTopics}>
            <div className={styles.sidebarTopicHeader}>
              <span className={styles.sidebarTopicLabel}>주제</span>
              <button className={styles.iconBtn} onClick={openTopicCreate} style={{ width: 28, height: 28 }}>
                <IconPlus size={14} />
              </button>
            </div>
            {loading ? (
              <div className={styles.loading}>
                <div className={styles.loadingSpinner} />
              </div>
            ) : topics.length === 0 ? (
              <div className={styles.emptyState} style={{ padding: '24px 16px' }}>
                <div className={styles.emptyStateIcon} style={{ fontSize: 36 }}>📂</div>
                <div className={styles.emptyStateDesc} style={{ fontSize: 13 }}>주제를 만들어 시작하세요</div>
                <button className={`${styles.emptyStateBtn}`} style={{ fontSize: 12, padding: '8px 16px' }} onClick={openTopicCreate}>
                  <IconPlus size={14} />
                  주제 만들기
                </button>
              </div>
            ) : (
              renderTopicCards(true)
            )}
          </div>

          {/* Notes list in sidebar */}
          {selectedTopicId != null && (
            <div className={styles.sidebarNotes}>
              <div className={styles.sidebarNotesHeader}>
                <span className={styles.sidebarNotesTitle}>
                  {selectedTopic?.icon} {selectedTopic?.name}
                </span>
                <button className={styles.iconBtn} onClick={createNote} style={{ width: 28, height: 28 }}>
                  <IconPlus size={14} />
                </button>
              </div>
              {renderNoteCards(true)}
            </div>
          )}
        </div>

        {/* Editor Panel */}
        <div className={styles.editorPanel}>
          {renderEditor(false)}
        </div>
      </div>
    );
  };

  // ============================================================
  // Main Render
  // ============================================================

  return (
    <div className={styles.layout}>
      {renderMobile()}
      {renderDesktop()}
      {renderTopicModal()}
      {renderConfirmDialog()}
    </div>
  );
}
