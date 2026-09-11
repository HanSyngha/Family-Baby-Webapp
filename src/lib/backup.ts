import { Capacitor, registerPlugin } from '@capacitor/core';
import { api, type User } from '../api';

export interface FolderInfo {
  name: string;
  count: number;
}

export interface BackupStatus {
  enabled: boolean;
  wifiOnly: boolean;
  chargingOnly: boolean;
  includeVideos: boolean;
  batteryNotLow: boolean;
  backupExisting: boolean;
  folders: string[];
  intervalMinutes: number;
  uploading: boolean;
  pending: number;
  lastRunAt: number;
  lastError?: string;
  hasAuth: boolean;
  hasMediaPermission: boolean;
}

export interface BackupConfig {
  enabled: boolean;
  wifiOnly: boolean;
  chargingOnly: boolean;
  includeVideos: boolean;
  batteryNotLow: boolean;
  backupExisting: boolean;
  folders: string[];
  intervalMinutes: number;
}

export interface UpdateInfo {
  available: boolean;
  versionCode?: number;
  versionName?: string;
  notes?: string;
  url?: string;
}

interface PeanutBackupPlugin {
  getStatus(): Promise<BackupStatus>;
  setAuth(opts: { refreshToken: string | null }): Promise<void>;
  setConfig(cfg: BackupConfig): Promise<void>;
  runNow(): Promise<void>;
  stopBackup(): Promise<void>;
  listFolders(opts: { includeVideos: boolean }): Promise<{ folders: FolderInfo[] }>;
  ensurePermissions(): Promise<{ granted: boolean }>;
  openBatterySettings(): Promise<void>;
  checkUpdate(): Promise<UpdateInfo>;
  downloadAndInstall(opts: { url: string }): Promise<void>;
}

export const backup = registerPlugin<PeanutBackupPlugin>('PeanutBackup');

/** Capacitor 네이티브 앱(안드로이드 APK) 안에서 실행 중인지. */
export const isNativeApp = Capacitor.isNativePlatform();

/** 로그인 상태와 네이티브 백업 refresh token을 같은 사용자로 맞춘다. */
export async function syncBackupAuth(user: User): Promise<void> {
  if (!isNativeApp) return;
  try {
    if (user.role !== 'master') {
      await backup.setAuth({ refreshToken: null });
      return;
    }
    const deviceName = (navigator.userAgent || 'Android').slice(0, 60);
    const { refreshToken } = await api.registerDevice(deviceName);
    await backup.setAuth({ refreshToken });
  } catch {
    // 실패해도 앱 동작엔 영향 없음. 다음 실행 때 재시도.
  }
}

export async function clearBackupAuth(): Promise<void> {
  if (!isNativeApp) return;
  try {
    await backup.setAuth({ refreshToken: null });
  } catch {
    // 로그아웃은 서버 쿠키 정리가 우선이다.
  }
}
