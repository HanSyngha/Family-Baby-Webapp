import { useEffect, useState, useCallback, useRef } from 'react';
import { backup, isNativeApp, type BackupStatus, type FolderInfo, type BackupConfig } from '../../lib/backup';
import s from './BackupSettings.module.css';

function relTime(ms: number): string {
  if (!ms) return '아직 없음';
  const d = Date.now() - ms;
  if (d < 60_000) return '방금 전';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}분 전`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}시간 전`;
  return `${Math.floor(d / 86_400_000)}일 전`;
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`${s.toggle} ${on ? s.toggleOn : ''}`}
      onClick={onChange}
      disabled={disabled}
      aria-pressed={on}
    >
      <span className={s.knob} />
    </button>
  );
}

export default function BackupSettings() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { setStatus(await backup.getStatus()); } catch { /* ignore */ }
  }, []);

  const loadFolders = useCallback(async (includeVideos: boolean) => {
    try { setFolders((await backup.listFolders({ includeVideos })).folders); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!isNativeApp) return;
    refresh();
    pollRef.current = setInterval(refresh, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  useEffect(() => {
    if (!isNativeApp) return;
    if (status?.hasMediaPermission && folders.length === 0) loadFolders(status.includeVideos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.hasMediaPermission]);

  if (!isNativeApp) return null;

  const apply = async (patch: Partial<BackupConfig>) => {
    if (!status) return;
    const next: BackupConfig = {
      enabled: status.enabled, wifiOnly: status.wifiOnly, chargingOnly: status.chargingOnly,
      includeVideos: status.includeVideos, batteryNotLow: status.batteryNotLow,
      backupExisting: status.backupExisting, folders: status.folders,
      intervalMinutes: status.intervalMinutes, ...patch,
    };
    setBusy(true);
    try {
      await backup.setConfig(next);
      await refresh();
      if (patch.includeVideos !== undefined) loadFolders(next.includeVideos);
    } finally { setBusy(false); }
  };

  const toggleEnabled = async () => {
    if (!status) return;
    if (!status.enabled) {
      const { granted } = await backup.ensurePermissions();
      if (!granted) return;
      await apply({ enabled: true });
      loadFolders(status.includeVideos);
    } else {
      await apply({ enabled: false });
    }
  };

  const toggleFolder = (name: string) => {
    if (!status) return;
    const set = new Set(status.folders);
    if (set.has(name)) set.delete(name); else set.add(name);
    apply({ folders: Array.from(set) });
  };

  return (
    <div className={s.section}>
      <div className={s.head}>
        <h2 className={s.title}>사진 백업</h2>
        {status?.uploading && <span className={s.badge}>백업 중</span>}
      </div>
      <p className={s.desc}>새로 찍은 사진·영상을 백그라운드에서 내 개인공간에 자동 저장합니다.</p>

      {!status ? (
        <div className={s.loading}>불러오는 중…</div>
      ) : (
        <>
          <div className={s.row}>
            <div className={s.rowMain}>
              <div className={s.rowTitle}>자동 백업</div>
              <div className={s.rowSub}>{status.enabled ? '켜짐' : '꺼짐'}</div>
            </div>
            <Toggle on={status.enabled} onChange={toggleEnabled} disabled={busy} />
          </div>

          {!status.enabled && (
            <div style={{ marginTop: 2 }}>
              <OptRow label="기존 사진·영상도 전부 백업" on={status.backupExisting} onChange={() => apply({ backupExisting: !status.backupExisting })} disabled={busy} />
              <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #636366)', margin: '6px 4px 0', lineHeight: 1.5 }}>
                {status.backupExisting
                  ? '✓ 백업을 켜면 과거 사진·영상까지 전부 올립니다 (이미 올린 건 자동으로 건너뜀).'
                  : '지금 켜두면 과거 사진·영상까지 백업합니다. 끄면 켠 시점 이후 새 항목만 백업돼요. (켜는 건 백업 시작 전에 결정하세요)'}
              </p>
            </div>
          )}

          {status.enabled && !status.hasMediaPermission && (
            <button className={s.warn} onClick={() => backup.ensurePermissions().then(refresh)}>
              ⚠️ 사진·영상 접근 권한이 필요합니다. 눌러서 허용하기
            </button>
          )}

          {status.enabled && (
            <>
              <div className={s.statusCard}>
                <div className={s.statItem}>
                  <span className={s.statLabel}>마지막 백업</span>
                  <span className={s.statValue}>{relTime(status.lastRunAt)}</span>
                </div>
                <div className={s.statItem}>
                  <span className={s.statLabel}>대기 중</span>
                  <span className={s.statValue}>{status.pending}장</span>
                </div>
              </div>
              {status.lastError && <div className={s.errText}>{status.lastError}</div>}

              {!status.uploading && status.pending === 0 && !status.lastError && status.lastRunAt > 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #636366)', lineHeight: 1.5, margin: '2px 2px 6px' }}>
                  올릴 새 항목이 없어요. 과거 사진까지 원하면 아래 <b>'기존 사진·영상도 전부 백업'</b>을 켜세요. 사진 권한이 <b>'모두 허용'</b>인지도 확인해 주세요('일부만 허용'이면 선택한 사진만 백업됩니다).
                </div>
              )}

              {status.uploading ? (
                <button className={s.stopBtn} onClick={() => backup.stopBackup().then(refresh)}>
                  ■ 백업 중지
                </button>
              ) : (
                <button className={s.runBtn} onClick={() => backup.runNow().then(refresh)} disabled={busy}>
                  지금 백업
                </button>
              )}

              <div className={s.opts}>
                <div className={s.optRow}>
                  <span className={s.optLabel}>백업 주기</span>
                  <select
                    className={s.intervalSel}
                    value={status.intervalMinutes}
                    onChange={(e) => apply({ intervalMinutes: Number(e.target.value) })}
                    disabled={busy}
                  >
                    <option value={15}>15분</option>
                    <option value={30}>30분</option>
                    <option value={60}>1시간</option>
                    <option value={120}>2시간</option>
                    <option value={360}>6시간</option>
                    <option value={720}>12시간</option>
                  </select>
                </div>
                <OptRow label="Wi-Fi에서만 백업" on={status.wifiOnly} onChange={() => apply({ wifiOnly: !status.wifiOnly })} disabled={busy} />
                <OptRow label="충전 중에만 백업" on={status.chargingOnly} onChange={() => apply({ chargingOnly: !status.chargingOnly })} disabled={busy} />
                <OptRow label="배터리 부족 시 중단" on={status.batteryNotLow} onChange={() => apply({ batteryNotLow: !status.batteryNotLow })} disabled={busy} />
                <OptRow label="영상도 백업" on={status.includeVideos} onChange={() => apply({ includeVideos: !status.includeVideos })} disabled={busy} />
                <OptRow label="기존 사진도 전부 백업" on={status.backupExisting} onChange={() => apply({ backupExisting: !status.backupExisting })} disabled={busy} />
              </div>

              <div className={s.foldersHead}>백업할 폴더</div>
              <p className={s.foldersNote}>선택하지 않으면 전체 폴더를 백업합니다.</p>
              <div className={s.folderList}>
                {folders.length === 0 && <div className={s.foldersEmpty}>폴더를 불러오는 중…</div>}
                {folders.map((f) => {
                  const checked = status.folders.includes(f.name);
                  return (
                    <button key={f.name} className={`${s.folder} ${checked ? s.folderOn : ''}`} onClick={() => toggleFolder(f.name)} disabled={busy}>
                      <span className={s.folderCheck}>{checked ? '✓' : ''}</span>
                      <span className={s.folderName}>{f.name}</span>
                      <span className={s.folderCount}>{f.count}</span>
                    </button>
                  );
                })}
              </div>

              <button className={s.batteryBtn} onClick={() => backup.openBatterySettings()}>
                백업이 자주 멈추나요? 배터리 최적화 예외 설정
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function OptRow({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <div className={s.optRow}>
      <span className={s.optLabel}>{label}</span>
      <Toggle on={on} onChange={onChange} disabled={disabled} />
    </div>
  );
}
