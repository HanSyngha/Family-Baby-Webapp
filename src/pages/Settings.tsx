import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type User, type LlmConfig } from '../api';
import { usePushNotification } from '../hooks/usePushNotification';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import s from './Settings.module.css';

interface Props {
  user: User;
  onLogout: () => void;
}

interface HealthLog {
  status: string;
  responseTimeMs: number;
  error: string | null;
  checkedAt: string;
}

interface TestResult {
  configId: number;
  ok: boolean;
  responseTimeMs?: number;
  error?: string;
}

const EMPTY_FORM: Partial<LlmConfig> = {
  name: '',
  endpoint: '',
  apiKey: '',
  model: '',
  maxTokens: 1000000,
  temperature: 0.7,
  extraHeaders: '',
  extraBody: '',
};

export default function Settings({ user, onLogout }: Props) {
  const isMaster = user.role === 'master';
  const { pushState, togglePush } = usePushNotification(true);
  const { canInstall, isInstalled, install } = useInstallPrompt();
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  // LLM state
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [healthConfigId, setHealthConfigId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<LlmConfig>>(EMPTY_FORM);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // Test
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const testTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Model discovery
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<LlmConfig | null>(null);

  // Admin panel
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminActivity, setAdminActivity] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);

  // Fetch configs + health
  const fetchData = useCallback(async () => {
    if (!isMaster) return;
    setLoading(true);
    try {
      const [cfgs, health] = await Promise.all([
        api.getLlmConfigs(),
        api.getLlmHealth().catch(() => ({ configId: 0, logs: [] })),
      ]);
      setConfigs(cfgs);
      setHealthLogs(health.logs || []);
      setHealthConfigId(health.configId || null);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [isMaster]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Admin data fetch
  const fetchAdminData = useCallback(async () => {
    if (!isMaster) return;
    setAdminLoading(true);
    try {
      const [users, activity] = await Promise.all([
        api.getAdminUsers(),
        api.getAdminActivity(),
      ]);
      setAdminUsers(users);
      setAdminActivity(activity);
    } catch (err) {
      console.error('[Settings] Admin data error:', err);
    } finally {
      setAdminLoading(false);
    }
  }, [isMaster]);

  useEffect(() => { fetchAdminData(); }, [fetchAdminData]);

  // Clear test timer on unmount
  useEffect(() => () => { if (testTimerRef.current) clearTimeout(testTimerRef.current); }, []);

  // Modal open/close
  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowApiKey(false);
    setAvailableModels([]);
    setModalOpen(true);
  };

  const openEdit = (cfg: LlmConfig) => {
    setEditingId(cfg.id);
    setForm({
      name: cfg.name,
      endpoint: cfg.endpoint,
      apiKey: '', // 마스킹된 값 사용 안 함, 변경 시에만 새 키 입력
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
      extraHeaders: cfg.extraHeaders || '',
      extraBody: cfg.extraBody || '',
    });
    setShowApiKey(false);
    setAvailableModels([]);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  // Save
  const handleSave = async () => {
    if (!form.name?.trim() || !form.endpoint?.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await api.updateLlmConfig(editingId, form);
      } else {
        await api.createLlmConfig(form);
      }
      closeModal();
      await fetchData();
    } catch (err: any) {
      alert(err.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  // Test
  const handleTest = async (id: number) => {
    setTestingId(id);
    setTestResult(null);
    if (testTimerRef.current) clearTimeout(testTimerRef.current);
    try {
      const res = await api.testLlmConfig(id);
      setTestResult({ configId: id, ok: res.ok, responseTimeMs: res.responseTimeMs });
    } catch (err: any) {
      setTestResult({ configId: id, ok: false, error: err.message });
    } finally {
      setTestingId(null);
      testTimerRef.current = setTimeout(() => setTestResult(null), 3000);
    }
  };

  // Activate / Deactivate
  const handleToggleActive = async (cfg: LlmConfig) => {
    try {
      if (cfg.isActive) {
        await api.deactivateLlmConfig(cfg.id);
      } else {
        await api.activateLlmConfig(cfg.id);
      }
      await fetchData();
    } catch (err: any) {
      alert(err.message || '실패');
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteLlmConfig(deleteTarget.id);
      setDeleteTarget(null);
      await fetchData();
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
  };

  // Fetch models from endpoint
  const handleFetchModels = async () => {
    if (!form.endpoint?.trim() || !form.apiKey?.trim()) return;
    setFetchingModels(true);
    try {
      const res = await api.fetchLlmModels(form.endpoint, form.apiKey, form.extraHeaders || undefined);
      setAvailableModels(res.models || []);
      if (res.models?.length > 0 && !form.model) {
        updateField('model', res.models[0]);
      }
    } catch {
      setAvailableModels([]);
    } finally {
      setFetchingModels(false);
    }
  };

  // Form field helpers
  const updateField = (key: string, value: string | number) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  // Health data
  const activeConfig = configs.find(c => c.isActive);
  const recentLogs = healthLogs.slice(-20);
  const avgTime = recentLogs.length > 0
    ? Math.round(recentLogs.filter(l => l.status === 'ok').reduce((s, l) => s + l.responseTimeMs, 0) / Math.max(1, recentLogs.filter(l => l.status === 'ok').length))
    : 0;
  const okCount = recentLogs.filter(l => l.status === 'ok').length;

  return (
    <div className={s.layout}>
      <div className={s.brand}>
        <div className={s.brandBlock}>
          <img src="/icons/logo-web.png" alt="" className={s.pageLogo} />
          <span className={s.brandName}>땅콩패밀리</span>
        </div>
        <h1 className={s.pageTitle}>설정</h1>
      </div>

      {/* Profile */}
      <div className={s.section}>
        <div className={s.profileRow}>
          {user.profileImage ? (
            <img src={user.profileImage} alt="" className={s.avatar} />
          ) : (
            <div className={s.avatarFallback}>{user.name[0]}</div>
          )}
          <div className={s.profileInfo}>
            <div className={s.profileName}>{user.name}</div>
            <span className={`${s.roleBadge} ${isMaster ? s.roleMaster : s.roleUser}`}>
              {user.role}
            </span>
          </div>
        </div>
      </div>

      {/* LLM Config (master only) */}
      {isMaster && (
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <h2 className={s.sectionTitle}>AI 설정</h2>
            <button className={s.addBtn} onClick={openAdd}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              추가
            </button>
          </div>

          {loading && configs.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.spinner} />
            </div>
          ) : configs.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4Z"/>
                  <circle cx="12" cy="14" r="2"/>
                </svg>
              </div>
              <div className={s.emptyText}>LLM 설정이 없습니다</div>
            </div>
          ) : (
            <div className={s.configList}>
              {configs.map(cfg => (
                <ConfigCard
                  key={cfg.id}
                  cfg={cfg}
                  testingId={testingId}
                  testResult={testResult}
                  onTest={handleTest}
                  onToggleActive={handleToggleActive}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Health Monitor */}
      {isMaster && activeConfig && recentLogs.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <h2 className={s.sectionTitle}>상태 모니터</h2>
          </div>
          <div className={s.healthRow}>
            {/* Pad to 20 with empty dots */}
            {Array.from({ length: 20 }).map((_, i) => {
              const log = recentLogs[i];
              const cls = log
                ? log.status === 'ok' ? s.healthOk : s.healthError
                : s.healthEmpty;
              return (
                <div
                  key={i}
                  className={`${s.healthDot} ${cls}`}
                  style={{ animationDelay: `${i * 30}ms` }}
                  title={log ? `${log.status} - ${log.responseTimeMs}ms` : ''}
                />
              );
            })}
          </div>
          <div className={s.healthStats}>
            <div className={s.healthStat}>
              성공률 <span className={s.healthStatValue}>{recentLogs.length > 0 ? Math.round((okCount / recentLogs.length) * 100) : 0}%</span>
            </div>
            <div className={s.healthStat}>
              평균 응답 <span className={s.healthStatValue}>{avgTime}ms</span>
            </div>
          </div>
        </div>
      )}

      {/* Admin Panel (master only) */}
      {isMaster && (
        <div className={`${s.section} ${s.adminSection}`}>
          <div className={s.sectionHeader}>
            <h2 className={s.sectionTitle}>사용자 관리</h2>
          </div>
          {adminLoading && adminUsers.length === 0 ? (
            <div className={s.emptyState}><div className={s.spinner} /></div>
          ) : adminUsers.length === 0 ? (
            <div className={s.emptyState}><div className={s.emptyText}>사용자가 없습니다</div></div>
          ) : (
            adminUsers.map(u => (
              <div key={u.id} className={s.userCard}>
                {u.profileImage ? (
                  <img src={u.profileImage} alt="" className={s.userAvatar} />
                ) : (
                  <div className={s.userAvatarFallback}>{u.name?.[0] || '?'}</div>
                )}
                <div className={s.userInfo}>
                  <div className={s.userName}>
                    {u.name}
                    {u.banned ? ' (차단됨)' : ''}
                  </div>
                  <div className={s.userMeta}>
                    {u.role} · {u.provider} · {u.createdAt?.split(' ')[0] || ''}
                  </div>
                  <div className={s.userStats}>
                    {u.mediaCount > 0 && <span className={s.userStat}>사진 {u.mediaCount}</span>}
                    {u.commentCount > 0 && <span className={s.userStat}>댓글 {u.commentCount}</span>}
                    {u.feedingCount > 0 && <span className={s.userStat}>수유 {u.feedingCount}</span>}
                    {u.sleepCount > 0 && <span className={s.userStat}>수면 {u.sleepCount}</span>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {isMaster && adminActivity.length > 0 && (
        <div className={`${s.section} ${s.adminSection}`}>
          <div className={s.sectionHeader}>
            <h2 className={s.sectionTitle}>활동 로그</h2>
          </div>
          <div className={s.activityList}>
            {adminActivity.map((a, i) => (
              <div key={i} className={s.activityItem}>
                <span className={s.activityIcon}>{ACTION_ICONS[a.action] || '📋'}</span>
                <div className={s.activityContent}>
                  <div className={s.activityText}>
                    <strong>{a.userName}</strong> {ACTION_LABELS[a.action] || a.action}
                    {a.detail ? ` — ${a.detail.length > 40 ? a.detail.slice(0, 40) + '...' : a.detail}` : ''}
                  </div>
                  <div className={s.activityTime}>{timeAgo(a.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* App Settings */}
      <div className={s.section}>
        <div className={s.settingsRow}>
          <div>
            <div className={s.settingsLabel}>알림</div>
            <div className={s.settingsDesc}>
              {pushState === 'unsupported' ? '이 브라우저에서 지원하지 않습니다' :
               pushState === 'denied' ? '알림 권한이 거부되었습니다' :
               '새 소식을 푸시 알림으로 받습니다'}
            </div>
          </div>
          <button
            className={`${s.toggle} ${pushState === 'on' ? s.toggleOn : ''}`}
            onClick={togglePush}
            disabled={pushState === 'unsupported' || pushState === 'denied' || pushState === 'loading'}
            aria-label="알림 토글"
          >
            <div className={s.toggleKnob} />
          </button>
        </div>
      </div>

      {/* App Install */}
      <div className={s.section}>
        <div className={s.settingsRow}>
          <div>
            <div className={s.settingsLabel}>앱 설치</div>
            <div className={s.settingsDesc}>
              {isInstalled ? '이미 설치되었습니다' : '홈 화면에 앱을 추가하세요'}
            </div>
          </div>
          {isInstalled ? (
            <div className={s.installedBadge}>설치됨</div>
          ) : (
            <button className={s.installBtn} onClick={async () => {
              const installed = await install();
              if (!installed && !canInstall) { setShowInstallGuide(true); }
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              설치
            </button>
          )}
        </div>
      </div>

      {/* App Info */}
      <div className={s.appInfo}>
        <div className={s.appName}>땅콩패밀리</div>
        <div>v1.0.0</div>
      </div>

      {/* Logout - mobile only */}
      <button className={`${s.logoutBtn} mobile-only`} onClick={onLogout}>
        로그아웃
      </button>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className={s.modal}>
            <h3 className={s.modalTitle}>{editingId ? 'LLM 수정' : 'LLM 추가'}</h3>

            <div className={s.field}>
              <label className={s.fieldLabel}>이름</label>
              <input
                className={s.fieldInput}
                value={form.name || ''}
                onChange={e => updateField('name', e.target.value)}
                placeholder="예: GPT-4o Mini"
                autoFocus
              />
            </div>

            <div className={s.field}>
              <label className={s.fieldLabel}>엔드포인트</label>
              <input
                className={s.fieldInput}
                value={form.endpoint || ''}
                onChange={e => updateField('endpoint', e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <div className={s.field}>
              <label className={s.fieldLabel}>API 키</label>
              <div className={s.passwordWrap}>
                <input
                  className={s.fieldInput}
                  type={showApiKey ? 'text' : 'password'}
                  value={form.apiKey || ''}
                  onChange={e => updateField('apiKey', e.target.value)}
                  placeholder="sk-..."
                  style={{ paddingRight: 60 }}
                />
                <button
                  className={s.passwordToggle}
                  onClick={() => setShowApiKey(!showApiKey)}
                  type="button"
                >
                  {showApiKey ? '숨기기' : '보기'}
                </button>
              </div>
            </div>

            <div className={s.field}>
              <label className={s.fieldLabel}>모델</label>
              <div className={s.modelRow}>
                {availableModels.length > 0 ? (
                  <select
                    className={s.fieldInput}
                    value={form.model || ''}
                    onChange={e => updateField('model', e.target.value)}
                  >
                    <option value="">모델 선택...</option>
                    {availableModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={s.fieldInput}
                    value={form.model || ''}
                    onChange={e => updateField('model', e.target.value)}
                    placeholder="모델 불러오기 또는 직접 입력"
                  />
                )}
                <button
                  type="button"
                  className={s.fetchModelsBtn}
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !form.endpoint?.trim() || !form.apiKey?.trim()}
                  title="엔드포인트에서 모델 목록 불러오기"
                >
                  {fetchingModels ? <div className={`${s.spinner} ${s.spinnerSmall}`} /> : '불러오기'}
                </button>
              </div>
            </div>

            <div className={s.field}>
              <label className={s.fieldLabel}>최대 토큰</label>
              <input
                className={s.fieldInput}
                type="number"
                min={100000}
                max={10000000}
                step={100000}
                value={form.maxTokens || 1000000}
                onChange={e => updateField('maxTokens', Number(e.target.value))}
                placeholder="1000000"
              />
            </div>

            <div className={s.field}>
              <label className={s.fieldLabel}>Temperature ({form.temperature})</label>
              <div className={s.sliderWrap}>
                <input
                  type="range"
                  className={s.slider}
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.temperature ?? 0.7}
                  onChange={e => updateField('temperature', Number(e.target.value))}
                />
                <span className={s.sliderValue}>{form.temperature}</span>
              </div>
            </div>

            <div className={s.field}>
              <label className={s.fieldLabel}>Extra Headers (JSON)</label>
              <textarea
                className={s.fieldTextarea}
                value={form.extraHeaders || ''}
                onChange={e => updateField('extraHeaders', e.target.value)}
                placeholder='{"X-Custom": "value"}'
                rows={2}
              />
            </div>

            <div className={s.field}>
              <label className={s.fieldLabel}>Extra Body (JSON)</label>
              <textarea
                className={s.fieldTextarea}
                value={form.extraBody || ''}
                onChange={e => updateField('extraBody', e.target.value)}
                placeholder='{"stream": false}'
                rows={2}
              />
            </div>

            <div className={s.modalActions}>
              <button className={s.cancelBtn} onClick={closeModal}>취소</button>
              <button
                className={s.saveBtn}
                onClick={handleSave}
                disabled={saving || !form.name?.trim() || !form.endpoint?.trim()}
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install Guide */}
      {showInstallGuide && (
        <div className={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowInstallGuide(false); }}>
          <div className={s.confirmBox}>
            <div className={s.confirmTitle}>앱 설치</div>
            <div className={s.confirmDesc}>
              {/iPhone|iPad/.test(navigator.userAgent)
                ? <>하단의 <strong>공유 버튼</strong>(□↑)을 누른 후<br />"<strong>홈 화면에 추가</strong>"를 선택하세요.</>
                : <>브라우저 <strong>메뉴</strong>(⋮)를 누른 후<br />"<strong>홈 화면에 추가</strong>" 또는 "<strong>앱 설치</strong>"를 선택하세요.</>
              }
            </div>
            <div className={s.confirmActions}>
              <button className={s.confirmCancel} onClick={() => setShowInstallGuide(false)} style={{ flex: 'none', padding: '11px 32px' }}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className={s.confirmBox}>
            <div className={s.confirmTitle}>설정 삭제</div>
            <div className={s.confirmDesc}>
              "{deleteTarget.name}" 설정을 삭제하시겠습니까?<br />이 작업은 되돌릴 수 없습니다.
            </div>
            <div className={s.confirmActions}>
              <button className={s.confirmCancel} onClick={() => setDeleteTarget(null)}>취소</button>
              <button className={s.confirmDelete} onClick={handleDelete}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ConfigCard Sub-component
   ============================================================ */

function ConfigCard({ cfg, testingId, testResult, onTest, onToggleActive, onEdit, onDelete }: {
  cfg: LlmConfig;
  testingId: number | null;
  testResult: TestResult | null;
  onTest: (id: number) => void;
  onToggleActive: (cfg: LlmConfig) => void;
  onEdit: (cfg: LlmConfig) => void;
  onDelete: (cfg: LlmConfig) => void;
}) {
  const isTesting = testingId === cfg.id;
  const result = testResult?.configId === cfg.id ? testResult : null;

  const statusCls = cfg.lastHealthStatus === 'ok' ? s.statusOk
    : cfg.lastHealthStatus === 'error' ? s.statusError
    : s.statusUnknown;

  // Truncate endpoint for display
  const displayEndpoint = cfg.endpoint.length > 45
    ? cfg.endpoint.slice(0, 45) + '...'
    : cfg.endpoint;

  return (
    <div className={`${s.configCard} ${cfg.isActive ? s.configCardActive : ''}`}>
      <div className={s.configTop}>
        <div className={s.configMeta}>
          <div className={s.configNameRow}>
            <div className={s.statusDot + ' ' + statusCls} />
            <span className={s.configName}>{cfg.name}</span>
            {cfg.isActive && <span className={s.activeBadge}>Active</span>}
          </div>
          <div className={s.configDetail}>
            <span>{cfg.model}</span>
            <span>{displayEndpoint}</span>
          </div>
          {cfg.lastHealthStatus === 'ok' && cfg.lastHealthCheck && (
            <span className={s.timeBadge}>
              {formatTimeAgo(cfg.lastHealthCheck)}
            </span>
          )}
        </div>
      </div>

      {/* Test result */}
      {isTesting && (
        <div className={`${s.testResult} ${s.testOk}`}>
          <div className={`${s.spinner} ${s.spinnerSmall}`} />
          테스트 중...
        </div>
      )}
      {!isTesting && result && (
        <div className={`${s.testResult} ${result.ok ? s.testOk : s.testError}`}>
          {result.ok
            ? `OK - ${result.responseTimeMs}ms`
            : `실패: ${result.error || 'Unknown error'}`}
        </div>
      )}

      <div className={s.configActions}>
        <button
          className={`${s.actionBtn} ${s.testBtn}`}
          onClick={() => onTest(cfg.id)}
          disabled={isTesting}
        >
          {isTesting ? <div className={`${s.spinner} ${s.spinnerSmall}`} /> : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          )}
          테스트
        </button>
        <button
          className={`${s.actionBtn} ${cfg.isActive ? s.deactivateBtn : s.activateBtn}`}
          onClick={() => onToggleActive(cfg)}
        >
          {cfg.isActive ? '비활성화' : '활성화'}
        </button>
        <button className={`${s.actionBtn} ${s.editBtn}`} onClick={() => onEdit(cfg)}>
          수정
        </button>
        <button className={`${s.actionBtn} ${s.deleteBtn}`} onClick={() => onDelete(cfg)}>
          삭제
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return `${Math.floor(hrs / 24)}일 전`;
}

const ACTION_ICONS: Record<string, string> = {
  upload: '\uD83D\uDCF8', comment: '\uD83D\uDCAC', feeding: '\uD83C\uDF7C', sleep: '\uD83D\uDCA4',
  calendar: '\uD83D\uDCC5', todo: '\u2705', note: '\uD83D\uDCDD',
};
const ACTION_LABELS: Record<string, string> = {
  upload: '사진 업로드', comment: '댓글', feeding: '수유 기록', sleep: '수면 기록',
  calendar: '일정 추가', todo: '할일 추가', note: '노트 작성',
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr.replace(' ', 'T') + '+09:00');
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
  return dateStr.split(' ')[0];
}
