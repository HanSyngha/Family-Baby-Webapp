import type { FastifyInstance, FastifyRequest } from 'fastify';
import db from '../db.js';
import { authenticate } from '../auth.js';
import { chatCompletion, polishCompletionNote, polishText, nowKSTString } from '../llm-client.js';
import { sendPushToOthers, getUserName } from '../push.js';

interface TodoRow {
  id: number;
  parentId: number | null;
  creatorId: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  completionNote: string | null;
  completionNotePolished: string | null;
  topicName: string | null;
  isPrivate: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  creatorName: string;
  creatorImage: string | null;
}

function enrichTodo(todo: TodoRow, userId: number): any {
  const assignees = db.prepare(`
    SELECT ta.userId, u.name, u.profileImage
    FROM todo_assignees ta JOIN users u ON ta.userId = u.id
    WHERE ta.todoId = ?
  `).all(todo.id) as { userId: number; name: string; profileImage: string | null }[];

  const subtasks = db.prepare(`
    SELECT t.*, u.name as creatorName, u.profileImage as creatorImage
    FROM todos t JOIN users u ON t.creatorId = u.id
    WHERE t.parentId = ?
    AND (t.isPrivate = 0 OR t.creatorId = ? OR EXISTS(SELECT 1 FROM todo_assignees WHERE todoId = t.id AND userId = ?))
    ORDER BY t.sortOrder, t.createdAt
  `).all(todo.id, userId, userId) as TodoRow[];

  const commentCount = (db.prepare('SELECT COUNT(*) as cnt FROM todo_comments WHERE todoId = ?').get(todo.id) as { cnt: number }).cnt;

  return {
    ...todo,
    isPrivate: !!todo.isPrivate,
    assignees,
    commentCount,
    subtasks: subtasks.map(st => enrichTodo(st, userId)),
  };
}

/**
 * 나이 계산 (birthDate → "N년 N개월 N일")
 */
function calcAge(birthDate: string): string {
  const bd = new Date(birthDate);
  const now = new Date();
  const totalDays = Math.floor((now.getTime() - bd.getTime()) / 86400000);
  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days = totalDays % 30;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}년`);
  if (months > 0) parts.push(`${months}개월`);
  parts.push(`${days}일`);
  return parts.join(' ');
}

/**
 * 할일 완료 시 LLM을 통해 자동으로 노트 생성/업데이트
 */
async function generateCompletionNote(todoId: number, userId: number) {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId) as any;
  if (!todo) return;

  // ── 가족 정보 ──
  const familyMembers = db.prepare('SELECT id, name, role, birthDate, profileImage FROM users').all() as { id: number; name: string; role: string; birthDate: string | null; profileImage: string | null }[];
  const babies = db.prepare('SELECT id, name, birthDate FROM babies').all() as { id: number; name: string; birthDate: string | null }[];

  let familyText = '가족 구성원:\n';
  for (const m of familyMembers) {
    const age = m.birthDate ? calcAge(m.birthDate) : '나이 미상';
    familyText += `- ${m.name} (${m.role || '멤버'}, ${age})\n`;
  }
  for (const b of babies) {
    const age = b.birthDate ? calcAge(b.birthDate) : '나이 미상';
    familyText += `- ${b.name} (아기, ${age})\n`;
  }

  // ── 캘린더 일정 (과거 10 + 미래 10) ──
  const pastEvents = db.prepare(`
    SELECT title, startAt, endAt, allDay FROM calendar_events
    WHERE startAt <= datetime('now', '+9 hours')
    ORDER BY startAt DESC LIMIT 10
  `).all() as { title: string; startAt: string; endAt: string; allDay: number }[];

  const futureEvents = db.prepare(`
    SELECT title, startAt, endAt, allDay FROM calendar_events
    WHERE startAt > datetime('now', '+9 hours')
    ORDER BY startAt ASC LIMIT 10
  `).all() as { title: string; startAt: string; endAt: string; allDay: number }[];

  let calendarText = '';
  if (pastEvents.length > 0) {
    calendarText += '최근 지난 일정:\n' + pastEvents.reverse().map(e =>
      `- ${e.startAt.slice(0, 16)} ${e.title}${e.allDay ? ' (종일)' : ''}`
    ).join('\n') + '\n';
  }
  if (futureEvents.length > 0) {
    calendarText += '다가오는 일정:\n' + futureEvents.map(e =>
      `- ${e.startAt.slice(0, 16)} ${e.title}${e.allDay ? ' (종일)' : ''}`
    ).join('\n') + '\n';
  }
  if (!calendarText) calendarText = '(일정 없음)\n';

  // ── 할일 상세 (등록자, 담당자, 댓글) ──
  const creatorName = (db.prepare('SELECT name FROM users WHERE id = ?').get(todo.creatorId) as { name: string })?.name || '';

  const assignees = db.prepare(`
    SELECT u.name FROM todo_assignees ta JOIN users u ON ta.userId = u.id WHERE ta.todoId = ?
  `).all(todoId) as { name: string }[];
  const assigneeText = assignees.length > 0 ? assignees.map(a => a.name).join(', ') : '(없음)';

  const comments = db.prepare(`
    SELECT c.content, c.createdAt, u.name as userName
    FROM todo_comments c JOIN users u ON c.userId = u.id
    WHERE c.todoId = ? ORDER BY c.createdAt ASC
  `).all(todoId) as { content: string; createdAt: string; userName: string }[];
  const commentText = comments.length > 0
    ? comments.map(c => `[${c.userName} ${c.createdAt.slice(0, 16)}] ${c.content}`).join('\n')
    : '(댓글 없음)';

  // ── 기존 토픽 + 각 토픽의 최근 노트 ──
  const topics = db.prepare('SELECT id, name, icon FROM note_topics ORDER BY name').all() as { id: number; name: string; icon: string }[];
  let topicListText = '';
  for (const t of topics) {
    const recentNotes = db.prepare(
      'SELECT id, title, content FROM notes WHERE topicId = ? ORDER BY updatedAt DESC LIMIT 3'
    ).all(t.id) as { id: number; title: string; content: string }[];
    topicListText += `- id:${t.id} ${t.icon} ${t.name}\n`;
    for (const n of recentNotes) {
      topicListText += `    노트 id:${n.id} "${n.title}" — ${n.content.slice(0, 60)}${n.content.length > 60 ? '...' : ''}\n`;
    }
  }
  if (!topicListText) topicListText = '(토픽 없음)';

  // ── 이 할일에 연결된 기존 노트 확인 ──
  const existingNote = db.prepare('SELECT id, topicId, title, content FROM notes WHERE todoId = ?').get(todoId) as { id: number; topicId: number; title: string; content: string } | undefined;

  const result = await chatCompletion([
    {
      role: 'system',
      content: `당신은 가족 앱의 할일 완료 기록을 노트로 정리하는 도우미입니다.
현재 시각: ${nowKSTString()}

반드시 JSON으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.

응답 형식:
{
  "action": "create" | "update",
  "noteId": number | null,
  "topicId": number | null,
  "newTopicName": string | null,
  "newTopicIcon": string | null,
  "noteTitle": string,
  "noteContent": string
}

규칙:
- action "update": 기존 노트(noteId 필수)의 내용을 업데이트. 해당 토픽에 이 할일과 관련된 노트가 이미 있으면 업데이트하세요.
- action "create": 새 노트 생성.
- **기존 토픽을 최대한 재활용하세요.** 조금이라도 관련 있으면 기존 topicId를 사용하세요.
- 새 토픽은 기존 토픽 중 전혀 맞는 것이 없을 때만 만드세요. (newTopicName + newTopicIcon)
- noteTitle: 간결한 제목 (20자 이내)
- noteContent: 핵심만 간결하게 (100자 이내, 줄바꿈 가능, 반말/편한말투 OK)
- 불필요한 수식어 없이 사실 위주로 짧게
- 누가 뭘 했는지만 포함`,
    },
    {
      role: 'user',
      content: `${familyText}
${calendarText}
── 완료된 할일 ──
제목: ${todo.title}
설명: ${todo.description || '(없음)'}
등록일: ${todo.createdAt}
완료일: ${todo.completedAt || '방금'}
만든 사람: ${creatorName}
담당자: ${assigneeText}
댓글:
${commentText}

${existingNote ? `── 이 할일에 연결된 기존 노트 ──\nnoteId: ${existingNote.id}\n제목: ${existingNote.title}\n내용: ${existingNote.content}\n→ 업데이트가 적절하면 action:"update"로 응답하세요.\n` : ''}
── 기존 토픽과 노트 목록 ──
${topicListText}`,
    },
  ]);

  let action = 'create';
  let noteId: number | null = existingNote?.id || null;
  let topicId: number | null = null;
  let noteTitle = `${todo.title} - 완료`;
  let noteContent = `할일 "${todo.title}"이(가) 완료되었습니다.`;

  if (result) {
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result);
      action = parsed.action || 'create';
      noteId = parsed.noteId || noteId;
      topicId = parsed.topicId || null;
      noteTitle = parsed.noteTitle || noteTitle;
      noteContent = parsed.noteContent || noteContent;

      // 새 토픽 생성
      if (!topicId && parsed.newTopicName) {
        const existing = db.prepare('SELECT id FROM note_topics WHERE name = ?').get(parsed.newTopicName) as { id: number } | undefined;
        if (existing) {
          topicId = existing.id;
        } else {
          const topicResult = db.prepare('INSERT INTO note_topics (creatorId, name, icon) VALUES (?, ?, ?)').run(userId, parsed.newTopicName, parsed.newTopicIcon || '📝');
          topicId = topicResult.lastInsertRowid as number;
          console.log(`[Todo] Auto-created topic: "${parsed.newTopicName}" id=${topicId}`);
        }
      }
    } catch (err: any) {
      console.error(`[Todo] LLM JSON parse error: ${err.message}, raw: ${result?.slice(0, 200)}`);
    }
  }

  // fallback 토픽
  if (!topicId) {
    const fallbackTopic = db.prepare("SELECT id FROM note_topics WHERE name = '할일 완료 기록'").get() as { id: number } | undefined;
    if (fallbackTopic) {
      topicId = fallbackTopic.id;
    } else {
      const topicResult = db.prepare("INSERT INTO note_topics (creatorId, name, icon) VALUES (?, '할일 완료 기록', '✅')").run(userId);
      topicId = topicResult.lastInsertRowid as number;
      console.log(`[Todo] Fallback topic created: id=${topicId}`);
    }
  }

  // update 또는 create (noteId 실존 검증)
  const noteExists = noteId ? db.prepare('SELECT id FROM notes WHERE id = ?').get(noteId) : null;
  if (action === 'update' && noteId && noteExists) {
    db.prepare("UPDATE notes SET title = ?, content = ?, topicId = ?, updatedAt = datetime('now', '+9 hours') WHERE id = ?").run(noteTitle, noteContent, topicId, noteId);
    console.log(`[Todo] Auto-note updated: noteId=${noteId} for todoId=${todoId} title="${noteTitle}"`);
  } else {
    db.prepare('INSERT INTO notes (topicId, creatorId, title, content, todoId) VALUES (?, ?, ?, ?, ?)').run(topicId, userId, noteTitle, noteContent, todoId);
    console.log(`[Todo] Auto-note created for todoId=${todoId} topicId=${topicId} title="${noteTitle}"`);
  }
}

export function registerTodoRoutes(app: FastifyInstance) {
  // 할일 목록
  app.get('/api/todos', { preHandler: authenticate }, async (request: FastifyRequest) => {
    const userId = (request as any).user.userId;
    const { status, assigneeId } = request.query as { status?: string; assigneeId?: string };

    let where = `t.parentId IS NULL
      AND (t.isPrivate = 0 OR t.creatorId = ? OR EXISTS(SELECT 1 FROM todo_assignees WHERE todoId = t.id AND userId = ?))`;
    const params: any[] = [userId, userId];

    if (status) {
      where += ' AND t.status = ?';
      params.push(status);
    }
    if (assigneeId) {
      where += ' AND EXISTS(SELECT 1 FROM todo_assignees WHERE todoId = t.id AND userId = ?)';
      params.push(Number(assigneeId));
    }

    const todos = db.prepare(`
      SELECT t.*, u.name as creatorName, u.profileImage as creatorImage
      FROM todos t JOIN users u ON t.creatorId = u.id
      WHERE ${where}
      ORDER BY t.sortOrder, t.createdAt DESC
    `).all(...params) as TodoRow[];

    return todos.map(t => enrichTodo(t, userId));
  });

  // 단일 할일 조회
  app.get('/api/todos/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).user.userId;

    const todo = db.prepare(`
      SELECT t.*, u.name as creatorName, u.profileImage as creatorImage
      FROM todos t JOIN users u ON t.creatorId = u.id WHERE t.id = ?
    `).get(Number(id)) as TodoRow | undefined;

    if (!todo) return reply.code(404).send({ error: 'Todo not found' });
    // 비공개 할일: 생성자 또는 담당자만 접근
    if (todo.isPrivate && todo.creatorId !== userId) {
      const isAssignee = db.prepare('SELECT 1 FROM todo_assignees WHERE todoId = ? AND userId = ?').get(todo.id, userId);
      if (!isAssignee) return reply.code(403).send({ error: 'Private todo' });
    }
    return enrichTodo(todo, userId);
  });

  // 할일 생성
  app.post('/api/todos', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).user.userId;
    const body = request.body as any;
    const { title, description, parentId, priority, dueDate, topicName, isPrivate, sortOrder, assigneeIds } = body;

    const result = db.prepare(`
      INSERT INTO todos (creatorId, parentId, title, description, priority, dueDate, topicName, isPrivate, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      parentId || null,
      title,
      description || '',
      priority || 'medium',
      dueDate || null,
      topicName || null,
      isPrivate ? 1 : 0,
      sortOrder || 0,
    );

    const todoId = result.lastInsertRowid as number;

    if (assigneeIds?.length) {
      const ins = db.prepare('INSERT OR IGNORE INTO todo_assignees (todoId, userId) VALUES (?, ?)');
      for (const aid of assigneeIds) ins.run(todoId, aid);
    }

    console.log(`[Todo] Created: "${title}" by userId=${userId}`);
    sendPushToOthers(userId, `${getUserName(userId)}님이 할일 추가`, `"${title}" ✅`, '/todos');

    // 설명 교정 (비동기)
    if (description && description.trim().length >= 5) {
      polishText(description, `할일: ${title}`).then(polished => {
        if (polished && polished !== description) {
          db.prepare('UPDATE todos SET descriptionPolished = ? WHERE id = ?').run(polished, todoId);
          console.log(`[Todo] Description polished: id=${todoId}`);
        }
      }).catch(err => console.error('[Todo] Polish error:', err.message));
    }

    const todo = db.prepare(`
      SELECT t.*, u.name as creatorName, u.profileImage as creatorImage
      FROM todos t JOIN users u ON t.creatorId = u.id WHERE t.id = ?
    `).get(todoId) as TodoRow;
    return enrichTodo(todo, userId);
  });

  // 할일 수정
  app.put('/api/todos/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const todoId = Number(id);
    const userId = (request as any).user.userId;
    const body = request.body as any;

    const existing = db.prepare('SELECT id, isPrivate, creatorId, title, status FROM todos WHERE id = ?').get(todoId) as { id: number; isPrivate: number; creatorId: number; title: string; status: string } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Todo not found' });
    // 비공개 할일: 생성자만 수정
    if (existing.isPrivate && existing.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private todo' });
    }

    const fields: string[] = [];
    const values: any[] = [];
    const oldStatus = existing.status;
    const newStatus = body.status;

    for (const key of ['title', 'description', 'status', 'priority', 'dueDate', 'topicName'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
    }
    if (body.parentId !== undefined) { fields.push('parentId = ?'); values.push(body.parentId || null); }
    if (body.isPrivate !== undefined) { fields.push('isPrivate = ?'); values.push(body.isPrivate ? 1 : 0); }
    if (body.sortOrder !== undefined) { fields.push('sortOrder = ?'); values.push(body.sortOrder); }

    // 상태 전환: → done
    if (newStatus === 'done' && oldStatus !== 'done') {
      fields.push("completedAt = datetime('now', '+9 hours')");
    }
    // 상태 전환: done → 다른 상태
    if (newStatus && newStatus !== 'done' && oldStatus === 'done') {
      fields.push('completedAt = NULL');
    }

    if (fields.length > 0) {
      fields.push("updatedAt = datetime('now', '+9 hours')");
      db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...values, todoId);
    }

    // 담당자 갱신
    if (body.assigneeIds !== undefined) {
      db.prepare('DELETE FROM todo_assignees WHERE todoId = ?').run(todoId);
      const ins = db.prepare('INSERT OR IGNORE INTO todo_assignees (todoId, userId) VALUES (?, ?)');
      for (const aid of body.assigneeIds) ins.run(todoId, aid);
    }

    console.log(`[Todo] Updated: id=${todoId}${newStatus && newStatus !== oldStatus ? ` status: ${oldStatus}→${newStatus}` : ''}`);

    // 상태별 푸시 알림
    if (newStatus === 'done' && oldStatus !== 'done') {
      if (!existing.isPrivate) sendPushToOthers(userId, `${getUserName(userId)}님이 할일 완료!`, `"${existing.title}" 🎉`, '/todos');
      // LLM 자동 노트 생성 (비동기)
      generateCompletionNote(todoId, userId).catch(err => console.error('[Todo] Auto-note error:', err.message));
    } else if (!existing.isPrivate) {
      sendPushToOthers(userId, `${getUserName(userId)}님이 할일 수정`, `"${existing.title}" ✏️`, '/todos');
    }

    // description 변경 시 재교정 (비동기)
    if (body.description && body.description.trim().length >= 5) {
      const todoTitle = body.title || existing.title;
      polishText(body.description, `할일: ${todoTitle}`).then(polished => {
        if (polished && polished !== body.description) {
          db.prepare('UPDATE todos SET descriptionPolished = ? WHERE id = ?').run(polished, todoId);
          console.log(`[Todo] Description re-polished: id=${todoId}`);
        } else {
          db.prepare('UPDATE todos SET descriptionPolished = NULL WHERE id = ?').run(todoId);
        }
      }).catch(err => console.error('[Todo] Polish error:', err.message));
    }

    const todo = db.prepare(`
      SELECT t.*, u.name as creatorName, u.profileImage as creatorImage
      FROM todos t JOIN users u ON t.creatorId = u.id WHERE t.id = ?
    `).get(todoId) as TodoRow;
    return enrichTodo(todo, userId);
  });

  // 할일 삭제
  app.delete('/api/todos/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).user.userId;
    const existing = db.prepare('SELECT id, isPrivate, creatorId, title FROM todos WHERE id = ?').get(Number(id)) as { id: number; isPrivate: number; creatorId: number; title: string } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Todo not found' });
    // 비공개 할일: 생성자만 삭제
    if (existing.isPrivate && existing.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private todo' });
    }
    db.prepare('DELETE FROM todos WHERE id = ?').run(Number(id));
    console.log(`[Todo] Deleted: id=${id}`);
    if (!existing.isPrivate) sendPushToOthers(userId, `${getUserName(userId)}님이 할일 삭제`, `"${existing.title}" 🗑️`, '/todos');
    return { ok: true };
  });

  // ============================================================
  // 댓글 CRUD
  // ============================================================

  // 댓글 목록
  app.get('/api/todos/:id/comments', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    return db.prepare(`
      SELECT c.id, c.todoId, c.userId, c.content, c.createdAt, u.name as userName, u.profileImage as userImage
      FROM todo_comments c JOIN users u ON c.userId = u.id
      WHERE c.todoId = ? ORDER BY c.createdAt ASC
    `).all(Number(id));
  });

  // 댓글 작성
  app.post('/api/todos/:id/comments', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const todoId = Number(id);
    const userId = (request as any).user.userId;
    const { content } = request.body as { content: string };

    if (!content?.trim()) return reply.code(400).send({ error: 'Content required' });

    const todo = db.prepare('SELECT id, title, isPrivate, creatorId FROM todos WHERE id = ?').get(todoId) as { id: number; title: string; isPrivate: number; creatorId: number } | undefined;
    if (!todo) return reply.code(404).send({ error: 'Todo not found' });

    const result = db.prepare('INSERT INTO todo_comments (todoId, userId, content) VALUES (?, ?, ?)').run(todoId, userId, content.trim());
    console.log(`[Todo] Comment added: todoId=${todoId} by userId=${userId}`);

    if (!todo.isPrivate) sendPushToOthers(userId, `${getUserName(userId)}님이 댓글`, `"${content.trim().slice(0, 50)}" 💬`, '/todos');

    return db.prepare(`
      SELECT c.id, c.todoId, c.userId, c.content, c.createdAt, u.name as userName, u.profileImage as userImage
      FROM todo_comments c JOIN users u ON c.userId = u.id WHERE c.id = ?
    `).get(result.lastInsertRowid);
  });

  // 댓글 삭제
  app.delete('/api/todos/comments/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT id FROM todo_comments WHERE id = ?').get(Number(id));
    if (!existing) return reply.code(404).send({ error: 'Comment not found' });
    db.prepare('DELETE FROM todo_comments WHERE id = ?').run(Number(id));
    console.log(`[Todo] Comment deleted: id=${id}`);
    return { ok: true };
  });

  // 할일 완료 (deprecated - PUT /api/todos/:id의 status='done'으로 대체)
  app.post('/api/todos/:id/complete', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const todoId = Number(id);
    const userId = (request as any).user.userId;
    const body = request.body as any;
    const { completionNote, createNote, noteTopicId, noteTopicName, noteTitle } = body;

    const existing = db.prepare('SELECT id, title, isPrivate, creatorId FROM todos WHERE id = ?').get(todoId) as { id: number; title: string; isPrivate: number; creatorId: number } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Todo not found' });
    // 비공개 할일: 생성자만 완료
    if (existing.isPrivate && existing.creatorId !== userId) {
      return reply.code(403).send({ error: 'Private todo' });
    }

    // LLM 교정 (비동기, 실패시 원본 사용)
    const userName = (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string })?.name || '';
    let polished: string | null = null;
    if (completionNote) {
      polished = await polishCompletionNote(existing.title, completionNote, userName);
      if (polished === completionNote) polished = null; // 변경 없으면 null
    }

    // 할일 완료 처리
    db.prepare(`
      UPDATE todos SET status = 'done', completedAt = datetime('now', '+9 hours'), completionNote = ?, completionNotePolished = ?, updatedAt = datetime('now', '+9 hours')
      WHERE id = ?
    `).run(completionNote || null, polished, todoId);

    console.log(`[Todo] Completed: id=${todoId} title="${existing.title}" by userId=${userId}${polished ? ' (LLM polished)' : ''}`);
    sendPushToOthers(userId, `${getUserName(userId)}님이 할일 완료!`, `"${existing.title}" 🎉`, '/todos');

    // 완료 노트 생성
    if (createNote && completionNote) {
      let topicId = noteTopicId;

      // 토픽이 이름으로 지정된 경우 생성 또는 조회
      if (!topicId && noteTopicName) {
        const existingTopic = db.prepare('SELECT id FROM note_topics WHERE name = ? AND creatorId = ?').get(noteTopicName, userId) as { id: number } | undefined;
        if (existingTopic) {
          topicId = existingTopic.id;
        } else {
          const topicResult = db.prepare(`
            INSERT INTO note_topics (creatorId, name) VALUES (?, ?)
          `).run(userId, noteTopicName);
          topicId = topicResult.lastInsertRowid as number;
          console.log(`[Todo] Created note topic: "${noteTopicName}" id=${topicId}`);
        }
      }

      if (topicId) {
        const title = noteTitle || `${existing.title} - 완료 노트`;
        const noteContent = polished || completionNote;
        const noteResult = db.prepare(`
          INSERT INTO notes (topicId, creatorId, title, content, todoId)
          VALUES (?, ?, ?, ?, ?)
        `).run(topicId, userId, title, noteContent, todoId);
        console.log(`[Todo] Created completion note: id=${noteResult.lastInsertRowid} for todoId=${todoId}`);
      }
    }

    const todo = db.prepare(`
      SELECT t.*, u.name as creatorName, u.profileImage as creatorImage
      FROM todos t JOIN users u ON t.creatorId = u.id WHERE t.id = ?
    `).get(todoId) as TodoRow;
    return enrichTodo(todo, userId);
  });
}
