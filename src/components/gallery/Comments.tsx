import { useState, useEffect, useCallback } from 'react';
import { api, type Comment as CommentType, type User } from '../../api';
import styles from './Comments.module.css';

interface Props {
  mediaId: number;
  user: User;
}

export default function Comments({ mediaId, user }: Props) {
  const [comments, setComments] = useState<CommentType[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    api.getComments(mediaId).then(setComments).catch(() => {});
  }, [mediaId]);

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;
    const comment = await api.addComment(mediaId, text.trim());
    setComments(prev => [...prev, comment]);
    setText('');
  }, [mediaId, text]);

  const handleDelete = useCallback(async (id: number) => {
    await api.deleteComment(id);
    setComments(prev => prev.filter(c => c.id !== id));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className={styles.comments}>
      <div className={styles.label}>댓글 ({comments.length})</div>
      <div className={styles.list}>
        {comments.map(c => (
          <div key={c.id} className={styles.comment}>
            <div className={styles.commentHeader}>
              <span className={styles.commentName}>{c.name}</span>
              <span className={styles.commentTime}>
                {c.createdAt.slice(2, 10).replace(/-/g, '.')}
              </span>
              {(c.userId === user.id || user.role === 'master') && (
                <button className={styles.deleteBtn} onClick={() => handleDelete(c.id)}>삭제</button>
              )}
            </div>
            <div className={styles.commentText}>{c.content}</div>
          </div>
        ))}
      </div>
      <div className={styles.inputWrap}>
        <input
          className={styles.input}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="댓글 입력..."
        />
        <button className={styles.sendBtn} onClick={handleSubmit} disabled={!text.trim()}>
          전송
        </button>
      </div>
    </div>
  );
}
