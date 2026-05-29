const BASE = '/api';
const IS_PWA = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

async function request<T>(url: string, options?: RequestInit & { skipAuthRedirect?: boolean }): Promise<T> {
  const { skipAuthRedirect, ...fetchOptions } = options || {};
  const res = await fetch(BASE + url, {
    credentials: 'include',
    ...fetchOptions,
    headers: {
      'X-App-Mode': IS_PWA ? 'pwa' : 'browser',
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
  parentId: number | null;
  editedAt: string | null;
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
  descriptionPolished: string | null;
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
  commentCount: number;
  subtasks: Todo[];
}

export interface TodoComment {
  id: number;
  todoId: number;
  userId: number;
  content: string;
  createdAt: string;
  userName: string;
  userImage: string | null;
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
  contentPolished: string | null;
  todoId: number | null;
  isPrivate: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  creatorName: string;
  creatorImage: string | null;
  topicName?: string;
}

export interface Baby {
  id: number;
  name: string;
  birthDate: string | null;
  gender: 'M' | 'F' | null;
  createdAt: string;
}

export interface Feeding {
  id: number;
  babyId: number;
  recorderId: number;
  recorderName: string;
  recorderImage: string | null;
  type: 'formula' | 'breast';
  side: 'left' | 'right' | null;
  amountMl: number | null;
  durationSec: number | null;
  startedAt: string;
  endedAt: string | null;
  memo: string;
  createdAt: string;
}

export interface Sleep {
  id: number;
  babyId: number;
  recorderId: number;
  recorderName: string;
  recorderImage: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  memo: string;
  createdAt: string;
  isAutoSleep?: number;
}

export interface Diaper {
  id: number;
  babyId: number;
  recorderId: number;
  recorderName: string;
  recorderImage: string | null;
  type: 'pee' | 'poop' | 'both';
  changedAt: string;
  color: string | null;
  consistency: string | null;
  memo: string;
  createdAt: string;
}

export interface BabyObservation {
  id: number;
  babyId: number;
  content: string;
  severity: 'pending' | 'common' | 'watch' | 'danger';
  llmReasoning: string | null;
  status: 'active' | 'resolved';
  recordedBy: number;
  recorderName: string;
  recorderImage: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface BabyChatMessage {
  id: number;
  babyId: number;
  role: 'user' | 'assistant';
  content: string;
  userId: number | null;
  userName: string | null;
  userImage: string | null;
  createdAt: string;
}

export interface VaccineItem {
  code: string;
  name: string;
  dose: number;
  ageMonths: number;
  ageEndMonths: number;
  ageLabel: string;
  description: string;
}

export interface VaccinationCompletion {
  vaccineCode: string;
  completedDate: string;
  hospital: string;
  memo: string;
}

export interface VaccinationData {
  schedule: VaccineItem[];
  completions: VaccinationCompletion[];
  choices: { combo: string; rota: string; je: string };
}

export interface GrowthRecord {
  id: number;
  babyId: number;
  measuredDate: string;
  weightKg: number | null;
  heightCm: number | null;
  headCm: number | null;
  memo: string;
  recordedBy: number;
  recorderName: string;
  recorderImage: string | null;
  createdAt: string;
}

export interface WHOPercentiles {
  months: number[];
  P3: number[];
  P15: number[];
  P50: number[];
  P85: number[];
  P97: number[];
}

export interface WHOStandards {
  weight: WHOPercentiles;
  height: WHOPercentiles;
  head: WHOPercentiles;
}

export interface GrowthData {
  records: GrowthRecord[];
  standards: WHOStandards;
  gender: 'M' | 'F';
}

export interface BabySummary {
  today: {
    feedingCount: number;
    totalFormulaMl: number;
    breastCount: number;
    totalSleepMin: number;
    sleepCount: number;
    diaperCount: number;
    peeCount: number;
    poopCount: number;
  };
  lastFeeding: Feeding | null;
  lastSleep: Sleep | null;
  lastDiaper: Diaper | null;
  prediction: {
    feeding: { predictedAt: string; reasoning: string } | null;
    sleep: { predictedAt: string; reasoning: string } | null;
    diaper: { predictedAt: string; reasoning: string } | null;
  };
}

export interface HomeSummary {
  family: { name: string; birthDate: string | null; type: string; role?: string; profileImage: string | null }[];
  upcomingBirthdays: { name: string; monthDay: string; daysUntil: number; turningAge: number; type: string }[];
  todayEvents: { id: number; title: string; startAt: string; endAt: string; allDay: boolean; color: string }[];
  upcomingEvents: { id: number; title: string; startAt: string; endAt: string; allDay: boolean; color: string }[];
  babySummaries: {
    babyId: number;
    babyName: string;
    babyBirthDate: string | null;
    todayFeedingCount: number;
    totalFormulaMl: number;
    totalSleepMin: number;
    lastFeeding: { startedAt: string; type: string; amountMl: number | null; side: string | null; durationSec: number | null } | null;
    lastSleep: { startedAt: string; endedAt: string | null; durationSec: number | null } | null;
    todayDiaperCount: number;
    todayPeeCount: number;
    todayPoopCount: number;
    lastDiaper: { changedAt: string; type: string; color: string | null; consistency: string | null } | null;
    feedingPrediction: { predictedAt: string; reasoning: string } | null;
    sleepPrediction: { predictedAt: string; reasoning: string } | null;
    diaperPrediction: { predictedAt: string; reasoning: string } | null;
  }[];
  todoSummary: {
    activeCount: number;
    overdueCount: number;
  };
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
  // Home
  getHomeSummary: () => request<HomeSummary>('/home/summary'),

  // Auth
  getMe: () => request<User>('/auth/me', { skipAuthRedirect: true }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  // Users
  getUsers: () => request<User[]>('/users'),
  getUsersAdmin: () => request<any[]>('/users/admin'),
  banUser: (id: number, banned: boolean) =>
    request<{ ok: boolean }>(`/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ banned }) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/users/${id}`, { method: 'DELETE' }),

  // Admin
  getAdminUsers: () => request<any[]>('/admin/users'),
  getAdminActivity: () => request<any[]>('/admin/activity'),

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
      xhr.setRequestHeader('X-App-Mode', IS_PWA ? 'pwa' : 'browser');
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
  copyToPeanut: (ids: number[]) =>
    request<{ copied: number; duplicates: number; errors: string[] }>(
      '/media/copy-to-peanut',
      { method: 'POST', body: JSON.stringify({ ids }) }
    ),
  recordView: (id: number) => request<{ ok: boolean }>(`/media/${id}/view`, { method: 'POST' }),
  toggleLike: (id: number) => request<{ liked: boolean }>(`/media/${id}/like`, { method: 'POST' }),
  toggleFavorite: (id: number) => request<{ favorited: boolean }>(`/media/${id}/favorite`, { method: 'POST' }),
  recordShare: (id: number) => request<{ ok: boolean }>(`/media/${id}/share`, { method: 'POST' }),
  getComments: (id: number) => request<Comment[]>(`/media/${id}/comments`),
  addComment: (id: number, content: string, parentId?: number) =>
    request<Comment>(`/media/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, parentId }),
    }),
  editComment: (id: number, content: string) =>
    request<Comment>(`/comments/${id}`, {
      method: 'PATCH',
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
  getTodoComments: (id: number) =>
    request<TodoComment[]>(`/todos/${id}/comments`),
  addTodoComment: (id: number, content: string) =>
    request<TodoComment>(`/todos/${id}/comments`, { method: 'POST', body: JSON.stringify({ content }) }),
  deleteTodoComment: (id: number) =>
    request<{ ok: boolean }>(`/todos/comments/${id}`, { method: 'DELETE' }),

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
  deactivateLlmConfig: (id: number) =>
    request<{ ok: boolean }>(`/llm/configs/${id}/deactivate`, { method: 'POST' }),
  testLlmConfig: (id: number) =>
    request<{ ok: boolean; responseTimeMs: number; response?: string }>(`/llm/configs/${id}/test`, { method: 'POST' }),
  getLlmHealth: () =>
    request<{ configId: number; logs: { status: string; responseTimeMs: number; error: string | null; checkedAt: string }[] }>('/llm/health'),
  fetchLlmModels: (endpoint: string, apiKey: string, extraHeaders?: string) =>
    request<{ models: string[] }>('/llm/models', { method: 'POST', body: JSON.stringify({ endpoint, apiKey, extraHeaders }) }),

  // Baby - Babies
  getBabies: () => request<Baby[]>('/baby/babies'),
  createBaby: (data: { name: string; birthDate?: string; gender?: string }) =>
    request<Baby>('/baby/babies', { method: 'POST', body: JSON.stringify(data) }),
  updateBaby: (id: number, data: { name?: string; birthDate?: string; gender?: string }) =>
    request<Baby>(`/baby/babies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBaby: (id: number) =>
    request<{ ok: boolean }>(`/baby/babies/${id}`, { method: 'DELETE' }),

  // Baby - Feeding
  getFeedings: (babyId: number, date?: string) => {
    const qs = new URLSearchParams({ babyId: String(babyId) });
    if (date) qs.set('date', date);
    return request<Feeding[]>(`/baby/feedings?${qs}`);
  },
  createFeeding: (data: { babyId: number; type: string; side?: string; amountMl?: number; durationSec?: number; startedAt: string; endedAt?: string; memo?: string }) =>
    request<Feeding>('/baby/feedings', { method: 'POST', body: JSON.stringify(data) }),
  updateFeeding: (id: number, data: Partial<Feeding>) =>
    request<Feeding>(`/baby/feedings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFeeding: (id: number) =>
    request<{ ok: boolean }>(`/baby/feedings/${id}`, { method: 'DELETE' }),

  // Baby - Sleep
  getSleeps: (babyId: number, date?: string) => {
    const qs = new URLSearchParams({ babyId: String(babyId) });
    if (date) qs.set('date', date);
    return request<Sleep[]>(`/baby/sleeps?${qs}`);
  },
  createSleep: (data: { babyId: number; startedAt: string; endedAt?: string; durationSec?: number; memo?: string }) =>
    request<Sleep>('/baby/sleeps', { method: 'POST', body: JSON.stringify(data) }),
  updateSleep: (id: number, data: Partial<Sleep>) =>
    request<Sleep>(`/baby/sleeps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSleep: (id: number) =>
    request<{ ok: boolean }>(`/baby/sleeps/${id}`, { method: 'DELETE' }),
  wakeSleep: (data: { babyId: number; endedAt: string }) =>
    request<Sleep>('/baby/sleeps/wake', { method: 'POST', body: JSON.stringify(data) }),

  // Baby - Diaper
  getDiapers: (babyId: number, date?: string) => {
    const qs = new URLSearchParams({ babyId: String(babyId) });
    if (date) qs.set('date', date);
    return request<Diaper[]>(`/baby/diapers?${qs}`);
  },
  createDiaper: (data: { babyId: number; type: string; changedAt: string; color?: string; consistency?: string; memo?: string }) =>
    request<Diaper>('/baby/diapers', { method: 'POST', body: JSON.stringify(data) }),
  updateDiaper: (id: number, data: Partial<Diaper>) =>
    request<Diaper>(`/baby/diapers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDiaper: (id: number) =>
    request<{ ok: boolean }>(`/baby/diapers/${id}`, { method: 'DELETE' }),

  // Baby - Summary & Settings
  getBabySummary: (babyId: number) => request<BabySummary>(`/baby/summary?babyId=${babyId}`),
  triggerPrediction: (babyId: number, type: 'feeding' | 'sleep' | 'diaper') =>
    request<{ ok: boolean }>('/baby/predict', { method: 'POST', body: JSON.stringify({ babyId, type }) }),
  getBabySettings: () => request<{ key: string; value: string }[]>('/baby/settings'),
  updateBabySetting: (key: string, value: string) =>
    request<{ ok: boolean }>('/baby/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),

  // Baby - Auto Sleep
  resumeAutoSleep: () =>
    request<{ endedCount: number; endedSleeps: any[] }>('/baby/auto-sleep/resume', { method: 'POST' }),

  // Baby - Observations
  getObservations: (babyId: number) => request<BabyObservation[]>(`/baby/${babyId}/observations`),
  createObservation: (babyId: number, content: string) =>
    request<BabyObservation>(`/baby/${babyId}/observations`, { method: 'POST', body: JSON.stringify({ content }) }),
  toggleObservation: (id: number) =>
    request<BabyObservation>(`/baby/observations/${id}/toggle`, { method: 'PUT' }),
  deleteObservation: (id: number) =>
    request<{ ok: boolean }>(`/baby/observations/${id}`, { method: 'DELETE' }),
  evaluateObservation: (id: number) =>
    request<BabyObservation>(`/baby/observations/${id}/evaluate`, { method: 'POST' }),

  // Baby - Vaccinations
  getVaccinations: (babyId: number) => request<VaccinationData>(`/baby/${babyId}/vaccinations`),
  completeVaccination: (babyId: number, data: { vaccineCode: string; completedDate: string; hospital?: string; memo?: string }) =>
    request<{ ok: boolean }>(`/baby/${babyId}/vaccinations`, { method: 'POST', body: JSON.stringify(data) }),
  uncompleteVaccination: (babyId: number, code: string) =>
    request<{ ok: boolean }>(`/baby/${babyId}/vaccinations/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  updateVaccinationChoices: (babyId: number, choices: { combo?: string; rota?: string; je?: string }) =>
    request<{ ok: boolean }>(`/baby/${babyId}/vaccinations/choices`, { method: 'PUT', body: JSON.stringify(choices) }),

  // Baby - Growth Records
  getGrowthRecords: (babyId: number) => request<GrowthData>(`/baby/${babyId}/growth`),
  createGrowthRecord: (babyId: number, data: { measuredDate: string; weightKg?: number; heightCm?: number; headCm?: number; memo?: string }) =>
    request<{ ok: boolean; record: GrowthRecord }>(`/baby/${babyId}/growth`, { method: 'POST', body: JSON.stringify(data) }),
  deleteGrowthRecord: (babyId: number, id: number) =>
    request<{ ok: boolean }>(`/baby/${babyId}/growth/${id}`, { method: 'DELETE' }),

  // Baby - Worry Chat
  getChatMessages: (babyId: number) => request<BabyChatMessage[]>(`/baby/${babyId}/chat`),
  sendChatMessage: (babyId: number, content: string) =>
    request<{ userMessage: BabyChatMessage; assistantMessage: BabyChatMessage }>(`/baby/${babyId}/chat`, { method: 'POST', body: JSON.stringify({ content }) }),
  clearChat: (babyId: number) =>
    request<{ ok: boolean }>(`/baby/${babyId}/chat`, { method: 'DELETE' }),

  // Media URLs
  thumbUrl: (id: number, v?: string) => `${BASE}/media/${id}/thumb${v ? `?v=${v}` : ''}`,
  fileUrl: (id: number, v?: string) => `${BASE}/media/${id}/file${v ? `?v=${v}` : ''}`,
  hlsUrl: (id: number) => `${BASE}/media/${id}/hls/playlist.m3u8`,
  downloadUrl: (id: number) => `${BASE}/media/${id}/download`,
};
