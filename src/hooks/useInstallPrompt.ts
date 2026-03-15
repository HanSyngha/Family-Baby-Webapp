/**
 * PWA 설치 프롬프트 - 글로벌 싱글톤
 * beforeinstallprompt는 한 번만 발생하므로, 앱 전체에서 공유해야 함
 */

let deferredPrompt: any = null;
let isInstalledGlobal = false;
const listeners = new Set<() => void>();

// 앱 로드 시 즉시 이벤트 캡처 (컴포넌트 마운트 전에도)
if (typeof window !== 'undefined') {
  if (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true) {
    isInstalledGlobal = true;
  } else {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
      console.log('[PWA] beforeinstallprompt captured');
      listeners.forEach(fn => fn());
    });
  }
  window.addEventListener('appinstalled', () => {
    isInstalledGlobal = true;
    deferredPrompt = null;
    console.log('[PWA] App installed');
    listeners.forEach(fn => fn());
  });
}

function notify() {
  listeners.forEach(fn => fn());
}

export async function triggerInstall(): Promise<boolean> {
  if (!deferredPrompt) {
    console.log('[PWA] No deferred prompt available');
    return false;
  }
  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Install outcome:', outcome);
    // prompt()는 한 번만 호출 가능, 이후 재사용 불가
    deferredPrompt = null;
    notify();
    return outcome === 'accepted';
  } catch (err) {
    console.error('[PWA] Install error:', err);
    deferredPrompt = null;
    notify();
    return false;
  }
}

import { useState, useEffect } from 'react';

export function useInstallPrompt() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const handler = () => forceUpdate(n => n + 1);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return {
    canInstall: !!deferredPrompt && !isInstalledGlobal,
    isInstalled: isInstalledGlobal,
    install: triggerInstall,
  };
}
