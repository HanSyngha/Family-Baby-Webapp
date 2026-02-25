import { useState, useEffect, useCallback } from 'react';

type PushState = 'loading' | 'unsupported' | 'denied' | 'on' | 'off';

export function usePushNotification(isLoggedIn: boolean) {
  const [state, setState] = useState<PushState>('loading');

  useEffect(() => {
    if (!isLoggedIn) { setState('off'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    checkStatus().then(setState);
  }, [isLoggedIn]);

  const toggle = useCallback(async () => {
    if (state === 'unsupported' || state === 'loading') return;

    if (state === 'on') {
      // 구독 해제
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('off');
    } else {
      // 구독
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const { key } = await fetch('/api/push/vapid-key').then(r => r.json());
        if (!key) return;

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { setState('denied'); return; }

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        });

        await fetch('/api/push/subscribe', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys: {
              p256dh: arrayBufferToBase64(sub.getKey('p256dh')!),
              auth: arrayBufferToBase64(sub.getKey('auth')!),
            },
          }),
        });
        setState('on');
      } catch (err) {
        console.warn('Push subscribe failed:', err);
      }
    }
  }, [state]);

  return { pushState: state, togglePush: toggle };
}

async function checkStatus(): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
