const CACHE_VERSION = 'v4';
const CACHE_NAME = `peanut-family-${CACHE_VERSION}`;

// 설치 시: 즉시 활성화
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 활성화 시: 모든 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// fetch: API는 캐시 무시, 나머지는 network-first
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // API 요청: 브라우저 HTTP 캐시 무시하고 반드시 서버에서 가져옴
  if (request.url.includes('/api/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Push Notification
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '땅콩패밀리';
  const options = {
    body: data.body || '새로운 알림이 있어요!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'notification',
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: '보러가기' },
    ],
    vibrate: [100, 50, 100],
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
