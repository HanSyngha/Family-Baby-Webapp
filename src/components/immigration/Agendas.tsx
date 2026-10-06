import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ImmAgenda, type ImmComment, type ImmCommentKind, type ImmPerson, type ImmVote } from '../../api';
import styles from '../../pages/Immigration.module.css';
import {
  Avatar, ConfirmDialog, PendingPhotos, PhotoAddButton, PhotoStrip, Sheet,
  fmtTime, shortName, usePhotoUploads,
} from './common';

interface Props {
  people: ImmPerson[];
  myId: number;
  onChanged: () => void;
}

/** 안건 상태: 확정 = 두 사람 모두 찬성. 반대가 하나라도 있으면 확정되지 않고 남는다. */
function agendaState(a: ImmAgenda, people: ImmPerson[]) {
  const confirmed = !!a.confirmedAt;
  const opposed = Object.values(a.votes).includes('no');
  const needYes = people.filter(p => a.votes[p.id] !== 'yes');
  return { confirmed, opposed, needYes };
}

export default function Agendas({ people, myId, onChanged }: Props) {
  const [agendas, setAgendas] = useState<ImmAgenda[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState<{ agenda?: ImmAgenda } | null>(null);
  const [showConfirmed, setShowConfirmed] = useState(true);
  const [version, setVersion] = useState(0); // 수정 저장 → 열려 있는 상세도 다시 읽게

  const load = useCallback(() => {
    api.getImmAgendas()
      .then(r => { setAgendas(r.agendas); setError(false); })
      .catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => { load(); onChanged(); }, [load, onChanged]);

  if (error && !agendas) {
    return <div className={styles.empty}><p>안건을 불러오지 못했어요.</p><button className={styles.textBtn} onClick={load}>다시 시도</button></div>;
  }
  if (!agendas) return <SkeletonCards />;

  const open = agendas.filter(a => !a.confirmedAt);
  const confirmed = agendas.filter(a => a.confirmedAt).sort((x, y) => (y.confirmedAt! > x.confirmedAt! ? 1 : -1));

  return (
    <div className={styles.section}>
      <button className={styles.primaryBlock} onClick={() => setForm({})}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        안건 올리기
      </button>

      {open.length === 0 && confirmed.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>아직 올라온 안건이 없어요</p>
          <p>둘이 정해야 할 일을 올리고, 둘 다 찬성하면 확정돼요.</p>
        </div>
      )}

      {open.length > 0 && (
        <>
          <div className={styles.groupLabel}>진행 중 <span>{open.length}</span></div>
          <div className={styles.cardList}>
            {open.map(a => <AgendaCard key={a.id} agenda={a} people={people} myId={myId} onOpen={() => setOpenId(a.id)} />)}
          </div>
        </>
      )}

      {confirmed.length > 0 && (
        <>
          <button className={styles.groupToggle} onClick={() => setShowConfirmed(v => !v)} aria-expanded={showConfirmed}>
            <span className={styles.groupLabelInline}>확정 <span>{confirmed.length}</span></span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: showConfirmed ? 'rotate(180deg)' : undefined }}><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {showConfirmed && (
            <div className={styles.cardList}>
              {confirmed.map(a => <AgendaCard key={a.id} agenda={a} people={people} myId={myId} onOpen={() => setOpenId(a.id)} />)}
            </div>
          )}
        </>
      )}

      {openId !== null && (
        <AgendaDetail
          id={openId}
          people={people}
          myId={myId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onEdit={agenda => setForm({ agenda })}
          version={version}
        />
      )}
      {form && (
        <AgendaForm
          agenda={form.agenda}
          onClose={() => setForm(null)}
          onSaved={() => { refresh(); setVersion(v => v + 1); }}
        />
      )}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className={styles.section}>
      {[0, 1].map(i => <div key={i} className={styles.skeletonCard} />)}
    </div>
  );
}

function VoteChips({ agenda, people }: { agenda: ImmAgenda; people: ImmPerson[] }) {
  return (
    <div className={styles.voteChips}>
      {people.map(p => {
        const v = agenda.votes[p.id];
        return (
          <span key={p.id} className={`${styles.voteChip} ${v === 'yes' ? styles.voteYes : v === 'no' ? styles.voteNo : styles.votePending}`}>
            <Avatar person={p} size={18} />
            {shortName(p.name)} {v === 'yes' ? '찬성' : v === 'no' ? '반대' : '아직'}
          </span>
        );
      })}
    </div>
  );
}

function StatusLine({ agenda, people }: { agenda: ImmAgenda; people: ImmPerson[] }) {
  const { confirmed, opposed, needYes } = agendaState(agenda, people);
  if (confirmed) return <span className={`${styles.statusPill} ${styles.statusConfirmed}`}>확정 · {fmtTime(agenda.confirmedAt!)}</span>;
  if (opposed) return <span className={`${styles.statusPill} ${styles.statusOpposed}`}>반대 있음 · 수정 후 다시 투표</span>;
  return (
    <span className={`${styles.statusPill} ${styles.statusOpen}`}>
      확정까지 {needYes.map(p => shortName(p.name)).join('·')} 찬성
    </span>
  );
}

function AgendaCard({ agenda, people, myId, onOpen }: { agenda: ImmAgenda; people: ImmPerson[]; myId: number; onOpen: () => void }) {
  const myTurn = !agenda.confirmedAt && !agenda.votes[myId];
  return (
    <article
      className={`${styles.card} ${styles.agendaCard} ${myTurn ? styles.cardMyTurn : ''} ${agenda.confirmedAt ? styles.cardConfirmed : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
    >
      <div className={styles.cardTop}>
        <h3 className={styles.cardTitle}>{agenda.title}</h3>
        {myTurn && <span className={styles.myTurn}>내 투표</span>}
      </div>
      {agenda.body && <p className={styles.cardBody}>{agenda.body}</p>}
      <PhotoStrip photos={agenda.photos} size="sm" />
      <VoteChips agenda={agenda} people={people} />
      <div className={styles.cardMeta}>
        <StatusLine agenda={agenda} people={people} />
        <span className={styles.metaCounts}>
          {agenda.opinionCount > 0 && <span>의견 {agenda.opinionCount}</span>}
          {agenda.questionCount > 0 && <span className={styles.qCount}>질문 {agenda.questionCount}</span>}
        </span>
      </div>
    </article>
  );
}

// ============================================================
// 상세: 본문 · 사진 · 찬반 · 의견/질문
// ============================================================

function AgendaDetail({ id, people, myId, onClose, onChanged, onEdit, version }: {
  id: number; people: ImmPerson[]; myId: number;
  onClose: () => void; onChanged: () => void; onEdit: (a: ImmAgenda) => void; version: number;
}) {
  const [data, setData] = useState<{ agenda: ImmAgenda; comments: ImmComment[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [voting, setVoting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteComment, setDeleteComment] = useState<ImmComment | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeRef = useRef<(() => void) | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    return api.getImmAgenda(id).then(setData).catch(() => setMissing(true));
  }, [id]);
  useEffect(() => { load(); }, [load, version]);

  const vote = async (value: ImmVote) => {
    if (!data || voting) return;
    const next = data.agenda.votes[myId] === value ? null : value; // 같은 버튼 다시 누르면 취소
    setVoting(true);
    // 즉시 반영 (optimistic)
    const votes = { ...data.agenda.votes };
    if (next) votes[myId] = next; else delete votes[myId];
    setData({ ...data, agenda: { ...data.agenda, votes } });
    try {
      const agenda = await api.voteImmAgenda(id, next);
      setData(d => (d ? { ...d, agenda } : d));
      onChanged();
    } catch {
      load();
    } finally {
      setVoting(false);
    }
  };

  const remove = async () => {
    await api.deleteImmAgenda(id).catch(() => {});
    onChanged();
    closeRef.current?.();
  };

  const removeComment = async () => {
    if (!deleteComment) return;
    await api.deleteImmComment(deleteComment.id).catch(() => {});
    setDeleteComment(null);
    load();
    onChanged();
  };

  const agenda = data?.agenda;
  const myVote = agenda?.votes[myId];

  return (
    <Sheet
      title="안건"
      full
      onClose={onClose}
      closeRef={closeRef}
      action={agenda && (
        <div className={styles.menuWrap}>
          <button className={styles.iconBtn} onClick={() => setMenuOpen(v => !v)} aria-label="더보기" aria-expanded={menuOpen}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button role="menuitem" onClick={() => { setMenuOpen(false); onEdit(agenda); }}>수정</button>
              <button role="menuitem" className={styles.menuDanger} onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>삭제</button>
            </div>
          )}
        </div>
      )}
      footer={agenda && <CommentComposer agendaId={id} onSent={() => { load().then(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' })); onChanged(); }} />}
    >
      {missing && <div className={styles.empty}><p>지워졌거나 찾을 수 없는 안건이에요.</p></div>}
      {!agenda && !missing && <div className={styles.skeletonCard} />}
      {agenda && (
        <div className={styles.detail}>
          <h2 className={styles.detailTitle}>{agenda.title}</h2>
          <div className={styles.detailMeta}>
            <Avatar person={people.find(p => p.id === agenda.authorId)} size={20} />
            <span>{shortName(agenda.authorName)}</span>
            <span>·</span>
            <span>{fmtTime(agenda.createdAt)}</span>
            {agenda.revision > 1 && <span className={styles.editedTag}>수정됨 {fmtTime(agenda.revisedAt)}</span>}
          </div>
          {agenda.body && <p className={styles.detailBody}>{agenda.body}</p>}
          <PhotoStrip photos={agenda.photos} />

          <div className={styles.voteBox}>
            <div className={styles.voteButtons}>
              <button
                className={`${styles.voteBtn} ${styles.voteBtnYes} ${myVote === 'yes' ? styles.voteBtnOn : ''}`}
                onClick={() => vote('yes')}
                aria-pressed={myVote === 'yes'}
                disabled={voting}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                찬성
              </button>
              <button
                className={`${styles.voteBtn} ${styles.voteBtnNo} ${myVote === 'no' ? styles.voteBtnOn : ''}`}
                onClick={() => vote('no')}
                aria-pressed={myVote === 'no'}
                disabled={voting}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                반대
              </button>
            </div>
            <VoteChips agenda={agenda} people={people} />
            <StatusLine agenda={agenda} people={people} />
            {myVote && <p className={styles.voteHint}>같은 버튼을 다시 누르면 취소돼요.</p>}
          </div>

          <div className={styles.commentHeader}>
            의견·질문 <span>{data!.comments.length}</span>
          </div>
          {data!.comments.length === 0 && <p className={styles.mutedText}>아직 없어요. 아래에서 남겨 주세요.</p>}
          <div className={styles.comments}>
            {data!.comments.map(c => (
              <div key={c.id} className={`${styles.comment} ${c.kind === 'question' ? styles.commentQ : ''}`}>
                <div className={styles.commentHead}>
                  <Avatar person={people.find(p => p.id === c.authorId)} size={22} />
                  <span className={styles.commentAuthor}>{shortName(c.authorName)}</span>
                  <span className={c.kind === 'question' ? styles.kindQ : styles.kindO}>{c.kind === 'question' ? '질문' : '의견'}</span>
                  <span className={styles.commentTime}>{fmtTime(c.createdAt)}</span>
                  <button className={styles.commentDelete} onClick={() => setDeleteComment(c)} aria-label="삭제">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </button>
                </div>
                {c.body && <p className={styles.commentBody}>{c.body}</p>}
                <PhotoStrip photos={c.photos} size="sm" />
              </div>
            ))}
            <div ref={listEndRef} />
          </div>
        </div>
      )}
      {confirmDelete && agenda && (
        <ConfirmDialog
          title="안건 삭제"
          message={`'${agenda.title}'을(를) 지울까요? 의견·질문·사진도 함께 지워지고 되돌릴 수 없어요.`}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {deleteComment && (
        <ConfirmDialog
          title={deleteComment.kind === 'question' ? '질문 삭제' : '의견 삭제'}
          message="지우면 되돌릴 수 없어요."
          onConfirm={removeComment}
          onCancel={() => setDeleteComment(null)}
        />
      )}
    </Sheet>
  );
}

function CommentComposer({ agendaId, onSent }: { agendaId: number; onSent: () => void }) {
  const [kind, setKind] = useState<ImmCommentKind>('opinion');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const uploads = usePhotoUploads();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !sending && !uploads.uploading && (body.trim() !== '' || uploads.photoIds.length > 0);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await api.addImmComment(agendaId, { kind, body: body.trim(), photoIds: uploads.photoIds });
      setBody('');
      uploads.reset();
      if (taRef.current) taRef.current.style.height = '';
      onSent();
    } catch {
      /* 입력 내용은 그대로 둔다 */
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.composer}>
      <PendingPhotos uploads={uploads} />
      <div className={styles.composerKinds} role="radiogroup" aria-label="종류">
        <button type="button" role="radio" aria-checked={kind === 'opinion'} className={`${styles.kindToggle} ${kind === 'opinion' ? styles.kindToggleOn : ''}`} onClick={() => setKind('opinion')}>의견</button>
        <button type="button" role="radio" aria-checked={kind === 'question'} className={`${styles.kindToggle} ${styles.kindToggleQ} ${kind === 'question' ? styles.kindToggleOn : ''}`} onClick={() => setKind('question')}>질문</button>
        <span className={styles.composerHint}>{kind === 'question' ? '상대에게 알림이 가요' : ''}</span>
      </div>
      <div className={styles.composerRow}>
        <PhotoAddButton onFiles={uploads.add} compact />
        <textarea
          ref={taRef}
          className={styles.composerInput}
          rows={1}
          placeholder={kind === 'question' ? '질문을 남겨 주세요' : '의견을 남겨 주세요'}
          value={body}
          onChange={e => {
            setBody(e.target.value);
            e.target.style.height = '';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
        />
        <button className={styles.sendBtn} onClick={send} disabled={!canSend} aria-label="보내기">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 올리기 / 수정
// ============================================================

function AgendaForm({ agenda, onClose, onSaved }: { agenda?: ImmAgenda; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(agenda?.title ?? '');
  const [body, setBody] = useState(agenda?.body ?? '');
  const [removed, setRemoved] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const uploads = usePhotoUploads();
  const closeRef = useRef<(() => void) | null>(null);
  const hasVotes = !!agenda && Object.keys(agenda.votes).length > 0;

  const save = async () => {
    if (!title.trim() || saving || uploads.uploading) return;
    setSaving(true);
    setErr('');
    try {
      if (agenda) {
        await api.updateImmAgenda(agenda.id, { title: title.trim(), body: body.trim(), photoIds: uploads.photoIds, removePhotoIds: removed });
      } else {
        await api.createImmAgenda({ title: title.trim(), body: body.trim(), photoIds: uploads.photoIds });
      }
      onSaved();
      closeRef.current?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했어요');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={agenda ? '안건 수정' : '새 안건'}
      onClose={onClose}
      closeRef={closeRef}
      action={
        <button className={styles.saveBtn} onClick={save} disabled={!title.trim() || saving || uploads.uploading}>
          {saving ? '저장 중' : agenda ? '저장' : '올리기'}
        </button>
      }
    >
      <div className={styles.form}>
        {agenda && (
          <p className={styles.formNotice}>
            {hasVotes ? '저장하면 지금까지의 찬성·반대가 모두 초기화되고, 둘 다 다시 눌러야 해요.' : '저장하면 내용이 바뀐 것으로 보고 투표를 처음부터 받아요.'}
          </p>
        )}
        <input
          className={styles.input}
          placeholder="무엇을 정할까요?"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={200}
          autoFocus={!agenda}
        />
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          placeholder="자세한 내용 (선택)"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={5}
        />
        {agenda && agenda.photos.filter(p => !removed.includes(p.id)).length > 0 && (
          <div className={styles.pendingPhotos}>
            {agenda.photos.filter(p => !removed.includes(p.id)).map(p => (
              <div key={p.id} className={styles.pendingPhoto}>
                <img src={p.thumb} alt="" />
                <button type="button" className={styles.pendingRemove} onClick={() => setRemoved(r => [...r, p.id])} aria-label="사진 빼기">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <PendingPhotos uploads={uploads} />
        <PhotoAddButton onFiles={uploads.add} />
        {err && <p className={styles.errorText}>{err}</p>}
      </div>
    </Sheet>
  );
}
