const BASE = '/api';

async function request<T>(url: string, options?: RequestInit & { skipAuthRedirect?: boolean }): Promise<T> {
  const { skipAuthRedirect, ...fetchOptions } = options || {};
  const res = await fetch(BASE + url, {
    credentials: 'include',
    ...fetchOptions,
    headers: {
      ...(!fetchOptions?.body || fetchOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...fetchOptions?.headers,
    },
  });
  if (res.status === 401) {
    if (!skipAuthRedirect && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || res.statusText);
  }
  return res.json();
}

// ============================================================
// Types
// ============================================================

export interface User {
  id: number;
  name: string;
  profileImage: string | null;
  role: string;
  createdAt: string;
}

export interface MediaItem {
  id: number;
  uploaderId: number;
  filename: string;
  originalName: string;
  mimeType: string;
  type: 'image' | 'video';
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
  uploadedAt: string | null;
  uploaderName: string;
  uploaderImage: string | null;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  shareCount: number;
  liked: boolean;
  favorited: boolean;
  viewers: { userId: number; name: string; profileImage: string | null }[];
  downloaders: { userId: number; name: string; profileImage: string | null }[];
}

export interface Comment {
  id: number;
  content: string;
  createdAt: string;
  userId: number;
  name: string;
  profileImage: string | null;
}

export interface CalendarEvent {
  id: number;
  creatorId: number;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  color: string;
  location: string;
  isPrivate: boolean;
  createdAt: string;
  creatorName?: string;
  creatorImage?: string | null;
  participants: { userId: number; name: string; profileImage: string | null; status: string }[];
  recurrence?: {
    type: string;
    interval: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    monthOfYear?: number;
    endDate?: string;
    count?: number;
  } | null;
  reminders: number[];
  instanceDate?: string; // 반복 일정 인스턴스의 실제 날짜
  originalEventId?: number;
}

export interface Todo {
  id: number;
  parentId: number | null;
  creatorId: number;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string | null;
  completedAt: string | null;
  completionNote: string | null;
  completionNotePolished: string | null;
  topicName: string | null;
  isPrivate: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  creatorName: string;
  creatorImage: string | null;
  assignees: { userId: number; name: string; profileImage: string | null }[];
  subtasks: Todo[];
}

export interface NoteTopic {
  id: number;
  creatorId: number;
  name: string;
  icon: string;
  isPrivate: boolean;
  sortOrder: number;
  createdAt: string;
  noteCount: number;
}

export interface Note {
  id: number;
  topicId: number;
  creatorId: number;
  title: string;
  content: string;
  todoId: number | null;
  isPrivate: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  creatorName: string;
  creatorImage: string | null;
  topicName?: string;
}

export interface LlmConfig {
  id: number;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  extraHeaders: string;
  extraBody: string;
  isActive: boolean;
  lastHealthCheck: string | null;
  lastHealthStatus: string;
  createdAt: string;
}

// ============================================================
// API
// ============================================================

export const api = {
  // Auth
  getMe: () => request<User>('/auth/me', { skipAuthRedirect: true }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  // Users
  getUsers: () => request<User[]>('/users'),
  getUsersAdmin: () => request<any[]>('/users/admin'),
  banUser: (id: number, banned: boolean) =>
    request<{ ok: boolean }>(`/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ banned }) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/users/${id}`, { method: 'DELETE' }),

  // Media (Gallery)
  getMedia: (cursor?: string | null, sort?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (sort) params.set('sort', sort);
    const qs = params.toString();
    return request<{ items: MediaItem[]; nextCursor: string | null }>(
      `/media${qs ? `?${qs}` : ''}`,
    );
  },
  getMediaDetail: (id: number) => request<MediaItem>(`/media/${id}`),
  getMediaIds: () => request<{ items: { id: number; filename: string; type: string; createdAt: string }[] }>('/media/ids'),
  uploadFile: (file: File, onProgress?: (pct: number) => void) => {
    return new Promise<{ ok: boolean; filename?: string; duplicate?: boolean }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/media/upload`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    });
  },
  checkDuplicate: (hash: string) =>
    request<{ duplicate: boolean; existingId: number | null }>('/media/check-duplicate', {
      method: 'POST',
      body: JSON.stringify({ hash }),
    }),
  hashFile: async (file: File): Promise<string> => {
    const CHUNK = 4 * 1024 * 1024;
    if (file.size <= CHUNK) {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const head = await file.slice(0, CHUNK).arrayBuffer();
    const tail = await file.slice(-CHUNK).arrayBuffer();
    const sizeBuf = new ArrayBuffer(8);
    new DataView(sizeBuf).setFloat64(0, file.size);
    const combined = new Uint8Array(head.byteLength + tail.byteLength + 8);
    combined.set(new Uint8Array(head), 0);
    combined.set(new Uint8Array(tail), head.byteLength);
    combined.set(new Uint8Array(sizeBuf), head.byteLength + tail.byteLength);
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  getProcessingStatus: () => request<{
    current: { filename: string; originalName: string; startedAt: number } | null;
    queue: { filename: string; originalName: string }[];
    recentResults: { filename: string; originalName: string; status: 'done' | 'error'; error?: string; elapsed: number }[];
  }>('/media/processing'),
  updateMediaDate: (id: number, createdAt: string) =>
    request<{ ok: boolean; createdAt: string }>(`/media/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ createdAt }),
    }),
  deleteMedia: (id: number) => request<{ ok: boolean }>(`/media/${id}`, { method: 'DELETE' }),
  recordView: (id: number) => request<{ ok: boolean }>(`/media/${id}/view`, { method: 'POST' }),
  toggleLike: (id: number) => request<{ liked: boolean }>(`/media/${id}/like`, { method: 'POST' }),
  toggleFavorite: (id: number) => request<{ favorited: boolean }>(`/media/${id}/favorite`, { method: 'POST' }),
  recordShare: (id: number) => request<{ ok: boolean }>(`/media/${id}/share`, { method: 'POST' }),
  getComments: (id: number) => request<Comment[]>(`/media/${id}/comments`),
  addComment: (id: number, content: string) =>
    request<Comment>(`/media/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  deleteComment: (id: number) =>
    request<{ ok: boolean }>(`/comments/${id}`, { method: 'DELETE' }),

  // Calendar
  getCalendarEvents: (month: string) =>
    request<CalendarEvent[]>(`/calendar/events?month=${month}`),
  getCalendarEvent: (id: number) =>
    request<CalendarEvent>(`/calendar/events/${id}`),
  createCalendarEvent: (data: Partial<CalendarEvent> & { participantIds?: number[]; recurrence?: any; reminders?: number[] }) =>
    request<CalendarEvent>('/calendar/events', { method: 'POST', body: JSON.stringify(data) }),
  updateCalendarEvent: (id: number, data: Partial<CalendarEvent> & { participantIds?: number[]; recurrence?: any; reminders?: number[] }) =>
    request<CalendarEvent>(`/calendar/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCalendarEvent: (id: number) =>
    request<{ ok: boolean }>(`/calendar/events/${id}`, { method: 'DELETE' }),
  respondCalendarEvent: (id: number, status: string) =>
    request<{ ok: boolean }>(`/calendar/events/${id}/respond`, { method: 'POST', body: JSON.stringify({ status }) }),

  // Todos
  getTodos: (params?: { status?: string; parentId?: string; assigneeId?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.parentId !== undefined) qs.set('parentId', params.parentId);
    if (params?.assigneeId) qs.set('assigneeId', String(params.assigneeId));
    const q = qs.toString();
    return request<Todo[]>(`/todos${q ? `?${q}` : ''}`);
  },
  getTodo: (id: number) => request<Todo>(`/todos/${id}`),
  createTodo: (data: Partial<Todo> & { assigneeIds?: number[] }) =>
    request<Todo>('/todos', { method: 'POST', body: JSON.stringify(data) }),
  updateTodo: (id: number, data: Partial<Todo> & { assigneeIds?: number[] }) =>
    request<Todo>(`/todos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTodo: (id: number) =>
    request<{ ok: boolean }>(`/todos/${id}`, { method: 'DELETE' }),
  completeTodo: (id: number, data: { completionNote: string; createNote?: boolean; noteTopicId?: number; noteTopicName?: string; noteTitle?: string }) =>
    request<{ ok: boolean; noteId?: number; polished?: string }>(`/todos/${id}/complete`, { method: 'POST', body: JSON.stringify(data) }),

  // Notes
  getNoteTopics: () => request<NoteTopic[]>('/notes/topics'),
  createNoteTopic: (data: { name: string; icon?: string; isPrivate?: boolean }) =>
    request<NoteTopic>('/notes/topics', { method: 'POST', body: JSON.stringify(data) }),
  updateNoteTopic: (id: number, data: { name?: string; icon?: string; isPrivate?: boolean }) =>
    request<NoteTopic>(`/notes/topics/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNoteTopic: (id: number) =>
    request<{ ok: boolean }>(`/notes/topics/${id}`, { method: 'DELETE' }),
  getNotes: (topicId?: number) => {
    const qs = topicId ? `?topicId=${topicId}` : '';
    return request<Note[]>(`/notes${qs}`);
  },
  getNote: (id: number) => request<Note>(`/notes/${id}`),
  createNote: (data: { topicId: number; title: string; content?: string; isPrivate?: boolean }) =>
    request<Note>('/notes', { method: 'POST', body: JSON.stringify(data) }),
  updateNote: (id: number, data: { title?: string; content?: string; topicId?: number; isPrivate?: boolean }) =>
    request<Note>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNote: (id: number) =>
    request<{ ok: boolean }>(`/notes/${id}`, { method: 'DELETE' }),

  // LLM
  getLlmConfigs: () => request<LlmConfig[]>('/llm/configs'),
  createLlmConfig: (data: Partial<LlmConfig>) =>
    request<LlmConfig>('/llm/configs', { method: 'POST', body: JSON.stringify(data) }),
  updateLlmConfig: (id: number, data: Partial<LlmConfig>) =>
    request<LlmConfig>(`/llm/configs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLlmConfig: (id: number) =>
    request<{ ok: boolean }>(`/llm/configs/${id}`, { method: 'DELETE' }),
  activateLlmConfig: (id: number) =>
    request<{ ok: boolean }>(`/llm/configs/${id}/activate`, { method: 'POST' }),
  testLlmConfig: (id: number) =>
    request<{ ok: boolean; responseTimeMs: number; response?: string }>(`/llm/configs/${id}/test`, { method: 'POST' }),
  getLlmHealth: () =>
    request<{ configId: number; logs: { status: string; responseTimeMs: number; error: string | null; checkedAt: string }[] }>('/llm/health'),

  // Media URLs
  thumbUrl: (id: number, v?: string) => `${BASE}/media/${id}/thumb${v ? `?v=${v}` : ''}`,
  fileUrl: (id: number, v?: string) => `${BASE}/media/${id}/file${v ? `?v=${v}` : ''}`,
  hlsUrl: (id: number) => `${BASE}/media/${id}/hls/playlist.m3u8`,
  downloadUrl: (id: number) => `${BASE}/media/${id}/download`,
};
