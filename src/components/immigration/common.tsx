import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, type ImmPerson, type ImmPhoto } from '../../api';
import styles from '../../pages/Immigration.module.css';

// ============================================================
// 날짜 · 사람
// ============================================================

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** '2026-10-13' → '10/13 (화)' (올해가 아니면 연도 포함) */
export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const prefix = y !== new Date().getFullYear() ? `${y}. ` : '';
  return `${prefix}${m}/${d} (${wd})`;
}

/** KST 'YYYY-MM-DD HH:MM:SS' → '방금' / 'n분 전' / 'n시간 전' / '10/6 21:30' */
export function fmtTime(ts: string): string {
  const t = new Date(ts.replace(' ', 'T') + '+09:00').getTime();
  const diff = (Date.now() - t) / 60000;
  if (diff < 1) return '방금';
  if (diff < 60) return `${Math.floor(diff)}분 전`;
  if (diff < 24 * 60) return `${Math.floor(diff / 60)}시간 전`;
  const [, m, d] = ts.slice(0, 10).split('-').map(Number);
  return `${m}/${d} ${ts.slice(11, 16)}`;
}

/** '한승하' → '승하'. 두 사람만 쓰는 화면이라 성을 빼야 칩이 짧다. */
export function shortName(name: string): string {
  return name.length === 3 ? name.slice(1) : name;
}

export function personName(people: ImmPerson[], id: number | null): string {
  if (id === null) return '둘 다';
  const p = people.find(x => x.id === id);
  return p ? shortName(p.name) : '?';
}

export function Avatar({ person, size = 24 }: { person?: ImmPerson; size?: number }) {
  if (person?.profileImage) {
    return <img src={person.profileImage} alt="" className={styles.avatar} style={{ width: size, height: size }} />;
  }
  return (
    <span className={styles.avatarFallback} style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {person ? shortName(person.name)[0] : '?'}
    </span>
  );
}

// ============================================================
// 뒤로가기로 닫히는 오버레이 (안드로이드 뒤로 버튼이 탭을 떠나지 않게)
// 열 때 history에 깊이를 쌓고, popstate로 그 깊이 밑으로 내려가면 닫힌다.
// ============================================================

function useBackToClose(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const depthRef = useRef(0);

  useEffect(() => {
    if (!depthRef.current) {
      depthRef.current = (history.state?.immSheet ?? 0) + 1;
      history.pushState({ ...history.state, immSheet: depthRef.current }, '');
    }
    const depth = depthRef.current;
    const onPop = (e: PopStateEvent) => {
      if ((e.state?.immSheet ?? 0) < depth) onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // UI에서 닫을 때: 나와 내 위에 쌓인 history를 한 번에 걷어내면 popstate가 해당 오버레이들을 닫는다.
  // (확인창에서 '삭제' → 상세 시트까지 한 번에 닫는 경우)
  return useCallback(() => {
    const cur = history.state?.immSheet ?? 0;
    if (cur >= depthRef.current) history.go(-(cur - depthRef.current + 1));
    else onCloseRef.current();
  }, []);
}

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 오른쪽 위 버튼 (저장 등) */
  action?: ReactNode;
  /** 아래 고정 영역 (댓글 입력창 등) */
  footer?: ReactNode;
  /** 화면 전체를 쓰는 시트 (안건 상세) */
  full?: boolean;
  /** 닫기 함수를 자식에게 넘겨 저장 후 닫을 수 있게 */
  closeRef?: React.MutableRefObject<(() => void) | null>;
}

export function Sheet({ title, onClose, children, action, footer, full, closeRef }: SheetProps) {
  const close = useBackToClose(onClose);
  if (closeRef) closeRef.current = close;
  return createPortal(
    <div className={styles.sheetOverlay} data-no-tab-swipe>
      <div className={styles.sheetBackdrop} onClick={close} />
      <div className={`${styles.sheet} ${full ? styles.sheetFull : ''}`} role="dialog" aria-label={title}>
        <div className={styles.sheetHeader}>
          <button className={styles.sheetClose} onClick={close} aria-label="닫기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <span className={styles.sheetTitle}>{title}</span>
          <div className={styles.sheetAction}>{action}</div>
        </div>
        <div className={styles.sheetBody}>{children}</div>
        {footer && <div className={styles.sheetFooter}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ title, message, confirmLabel = '삭제', onConfirm, onCancel }: {
  title: string; message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const close = useBackToClose(onCancel);
  return createPortal(
    <div className={styles.confirmOverlay} data-no-tab-swipe>
      <div className={styles.sheetBackdrop} onClick={close} />
      <div className={styles.confirmDialog} role="alertdialog">
        <div className={styles.confirmTitle}>{title}</div>
        <div className={styles.confirmMessage}>{message}</div>
        <div className={styles.confirmActions}>
          <button className={styles.confirmCancel} onClick={close}>취소</button>
          <button className={styles.confirmDanger} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================
// 토스트 (되돌리기)
// ============================================================

export interface ToastData { message: string; undo?: () => void }

export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return createPortal(
    <div className={styles.toast} role="status">
      <span>{toast.message}</span>
      {toast.undo && (
        <button className={styles.toastUndo} onClick={() => { toast.undo!(); onDone(); }}>되돌리기</button>
      )}
    </div>,
    document.body,
  );
}

// ============================================================
// 사진: 고르는 즉시 올리고(서버가 webp로 변환), 글 저장 때 id로 붙인다.
// ============================================================

interface PendingPhoto { key: string; preview: string; photo?: ImmPhoto; error?: boolean }

export function usePhotoUploads() {
  const [items, setItems] = useState<PendingPhoto[]>([]);

  const add = useCallback((files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 20)) {
      const key = `${Date.now()}-${Math.random()}`;
      const preview = URL.createObjectURL(file);
      setItems(prev => [...prev, { key, preview }]);
      api.uploadImmPhoto(file)
        .then(photo => setItems(prev => prev.map(p => (p.key === key ? { ...p, photo } : p))))
        .catch(() => setItems(prev => prev.map(p => (p.key === key ? { ...p, error: true } : p))));
    }
  }, []);

  const remove = useCallback((key: string) => {
    setItems(prev => prev.filter(p => p.key !== key));
  }, []);

  const reset = useCallback(() => setItems([]), []);

  return {
    items,
    add,
    remove,
    reset,
    uploading: items.some(p => !p.photo && !p.error),
    photoIds: items.filter(p => p.photo).map(p => p.photo!.id),
  };
}

export function PhotoAddButton({ onFiles, compact }: { onFiles: (files: FileList | null) => void; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={compact ? styles.iconBtn : styles.photoAddBtn}
        onClick={() => inputRef.current?.click()}
        aria-label="사진 추가"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="15" rx="2.5" />
          <circle cx="12" cy="12.5" r="3.5" />
          <path d="M8 5l1.5-2h5L16 5" />
        </svg>
        {!compact && <span>사진</span>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => { onFiles(e.target.files); e.target.value = ''; }}
      />
    </>
  );
}

export function PendingPhotos({ uploads }: { uploads: ReturnType<typeof usePhotoUploads> }) {
  if (uploads.items.length === 0) return null;
  return (
    <div className={styles.pendingPhotos}>
      {uploads.items.map(p => (
        <div key={p.key} className={styles.pendingPhoto}>
          <img src={p.photo?.thumb ?? p.preview} alt="" />
          {!p.photo && !p.error && <span className={styles.pendingSpinner} />}
          {p.error && <span className={styles.pendingError}>실패</span>}
          <button type="button" className={styles.pendingRemove} onClick={() => uploads.remove(p.key)} aria-label="사진 빼기">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/** 썸네일 줄 + 눌러서 크게 보기 */
export function PhotoStrip({ photos, size = 'md' }: { photos: ImmPhoto[]; size?: 'sm' | 'md' }) {
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <div className={`${styles.photoStrip} ${size === 'sm' ? styles.photoStripSm : ''}`}>
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={styles.photoThumb}
            onClick={e => { e.stopPropagation(); setViewIdx(i); }}
            aria-label={`사진 ${i + 1} 크게 보기`}
          >
            <img src={p.thumb} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {viewIdx !== null && <PhotoViewer photos={photos} start={viewIdx} onClose={() => setViewIdx(null)} />}
    </>
  );
}

function PhotoViewer({ photos, start, onClose }: { photos: ImmPhoto[]; start: number; onClose: () => void }) {
  const [idx, setIdx] = useState(start);
  const close = useBackToClose(onClose);
  const touch = useRef<number | null>(null);
  const go = (d: number) => setIdx(i => Math.min(photos.length - 1, Math.max(0, i + d)));
  return createPortal(
    <div
      className={styles.viewer}
      data-no-tab-swipe
      onTouchStart={e => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
      onClick={e => { e.stopPropagation(); }}
    >
      <img key={photos[idx].id} src={photos[idx].full} alt="" className={styles.viewerImg} />
      <button className={styles.viewerClose} onClick={close} aria-label="닫기">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      {photos.length > 1 && (
        <>
          <span className={styles.viewerCount}>{idx + 1} / {photos.length}</span>
          {idx > 0 && <button className={`${styles.viewerNav} ${styles.viewerPrev}`} onClick={() => go(-1)} aria-label="이전 사진">‹</button>}
          {idx < photos.length - 1 && <button className={`${styles.viewerNav} ${styles.viewerNext}`} onClick={() => go(1)} aria-label="다음 사진">›</button>}
        </>
      )}
    </div>,
    document.body,
  );
}

// ============================================================
// 칩 선택 (사람 · 날짜 · 종류)
// ============================================================

export function ChipGroup<T extends string | number | null>({ options, value, onChange, label }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={styles.chipGroup} role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`${styles.chip} ${value === o.value ? styles.chipOn : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 오늘 · 내일(기록이면 어제) · 달력 — 탭 한 번으로 고른다 */
export function DateChips({ value, onChange, allowNone, past }: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; past?: boolean }) {
  const today = todayStr();
  const tomorrow = todayStr(past ? -1 : 1);
  const isCustom = value !== null && value !== today && value !== tomorrow;
  const dateRef = useRef<HTMLInputElement>(null);
  // 숨긴 date input 위를 '직접 눌러야' 열리던 방식은, 한 번 고른 뒤(포커스가 남아 있거나 키보드가 내려가며
  // 화면이 밀리면) 안드로이드에서 다시 안 열렸다. 칩을 누르면 달력을 명시적으로 연다.
  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    el.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };
  return (
    <div className={styles.chipGroup} role="radiogroup" aria-label="날짜">
      {allowNone && (
        <button type="button" role="radio" aria-checked={value === null} className={`${styles.chip} ${value === null ? styles.chipOn : ''}`} onClick={() => onChange(null)}>날짜 없음</button>
      )}
      <button type="button" role="radio" aria-checked={value === today} className={`${styles.chip} ${value === today ? styles.chipOn : ''}`} onClick={() => onChange(today)}>오늘</button>
      <button type="button" role="radio" aria-checked={value === tomorrow} className={`${styles.chip} ${value === tomorrow ? styles.chipOn : ''}`} onClick={() => onChange(tomorrow)}>{past ? '어제' : '내일'}</button>
      <button
        type="button"
        role="radio"
        aria-checked={isCustom}
        className={`${styles.chip} ${styles.dateChip} ${isCustom ? styles.chipOn : ''}`}
        onClick={openPicker}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        <span>{isCustom ? fmtDate(value!) : '날짜'}</span>
        <input
          ref={dateRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={value ?? ''}
          onChange={e => onChange(e.target.value || (allowNone ? null : today))}
        />
      </button>
    </div>
  );
}
