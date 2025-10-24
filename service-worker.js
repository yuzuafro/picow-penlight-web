const CACHE_NAME = 'colorlight-v1.0.1';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script_multi.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-72x72.png',
  './icons/icon-96x96.png',
  './icons/icon-128x128.png',
  './icons/icon-144x144.png',
  './icons/icon-152x152.png',
  './icons/icon-192x192.png',
  './icons/icon-384x384.png',
  './icons/icon-512x512.png'
];

// インストール時: 必要なファイルをキャッシュ
self.addEventListener('install', (event) => {
  console.log('[Service Worker] インストール中...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] ファイルをキャッシュしています...');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('[Service Worker] キャッシュ完了');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[Service Worker] キャッシュエラー:', error);
      })
  );
});

// アクティベート時: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] アクティベート中...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] 古いキャッシュを削除:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] アクティベート完了');
      return self.clients.claim();
    })
  );
});

// フェッチ時: キャッシュファースト戦略
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // キャッシュにあればそれを返す
        if (response) {
          console.log('[Service Worker] キャッシュから取得:', event.request.url);
          return response;
        }

        // キャッシュになければネットワークから取得
        console.log('[Service Worker] ネットワークから取得:', event.request.url);
        return fetch(event.request).then((response) => {
          // 有効なレスポンスでない場合はそのまま返す
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // レスポンスをキャッシュに保存
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        });
      })
      .catch((error) => {
        console.error('[Service Worker] フェッチエラー:', error);
        // オフライン時のフォールバック（必要に応じて）
        return caches.match('./index.html');
      })
  );
});
