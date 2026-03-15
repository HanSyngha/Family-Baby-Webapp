import { useState, useCallback, useRef } from 'react';
import type { useUploadQueue } from '../../hooks/useUploadQueue';
import styles from './UploadModal.module.css';

interface Props {
  uploadQueue: ReturnType<typeof useUploadQueue>;
  onClose: () => void;
}

export default function UploadModal({ uploadQueue, onClose }: Props) {
  const { files, addFiles, activeCount, retryFile } = uploadQueue;
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(e.target.files);
      e.target.value = ''; // 같은 파일 재선택 가능
    }
  }, [addFiles]);

  const allDone = files.length > 0 && activeCount === 0;

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={allDone || files.length === 0 ? onClose : onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>사진/영상 올리기</h2>
          <button onClick={onClose} className={styles.closeBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <p>{activeCount > 0 ? '추가할 파일을 선택하세요' : '여기에 파일을 끌어다 놓거나 클릭하세요'}</p>
          <span>사진, 영상 여러 개 선택 가능</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={handleInputChange}
            style={{ display: 'none' }}
          />
        </div>

        {files.length > 0 && (
          <>
            {activeCount > 0 && (
              <div className={styles.queueInfo}>
                {uploadQueue.doneCount}/{uploadQueue.totalCount} 완료 · 나머지 큐에서 대기 중
              </div>
            )}
            <div className={styles.fileList}>
              {files.map((f, i) => (
                <div key={i} className={styles.fileItem}>
                  <div className={styles.fileName}>{f.file.name}</div>
                  <div className={styles.fileSize}>{formatSize(f.file.size)}</div>
                  <div className={styles.fileStatus}>
                    {f.status === 'hashing' && <span className={styles.hashing}>확인 중</span>}
                    {f.status === 'uploading' && (
                      <div className={styles.progressWrap}>
                        <div className={styles.progressBar}>
                          <div className={styles.progressFill} style={{ width: `${f.progress}%` }} />
                        </div>
                        <span className={styles.progressPct}>{f.progress}%</span>
                      </div>
                    )}
                    {f.status === 'done' && <span className={styles.done}>완료</span>}
                    {f.status === 'duplicate' && <span className={styles.duplicate}>중복</span>}
                    {f.status === 'error' && (
                      <span className={styles.errorWrap}>
                        <span className={styles.error}>실패</span>
                        <button className={styles.retryBtn} onClick={() => retryFile(i)}>재시도</button>
                      </span>
                    )}
                    {f.status === 'pending' && <span className={styles.pending}>대기</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {activeCount > 0 && (
          <div className={styles.uploadWarning}>
            업로드가 끝날 때까지 화면을 끄지 마세요
          </div>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}
