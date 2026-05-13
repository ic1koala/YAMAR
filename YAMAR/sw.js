/**
 * sw.js - YAMAR Service Worker
 * 完全オフライン動作を実現するキャッシュ戦略
 */

const CACHE_NAME = 'yamar-v1.0.5';

// プリキャッシュするファイル一覧
const PRECACHE_FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/app.js',
  './js/ar-engine.js',
  './js/camera.js',
  './js/db.js',
  './js/map.js',
  './js/sensors.js',
  './js/exif.js',
  './data/mountains.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// インストール時: 全静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  console.log('[SW] インストール中...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] プリキャッシュ中...');
        return cache.addAll(PRECACHE_FILES);
      })
      .then(() => {
        console.log('[SW] インストール完了');
        return self.skipWaiting();
      })
  );
});

// アクティベーション時: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  console.log('[SW] アクティベーション...');
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] 古いキャッシュ削除:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log('[SW] アクティベーション完了');
        return self.clients.claim();
      })
  );
});

// フェッチ時: Cache-First戦略
self.addEventListener('fetch', (event) => {
  // POSTリクエストやchrome-extension等は無視
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // キャッシュになければネットワークから取得
        return fetch(event.request)
          .then((networkResponse) => {
            // 正常なレスポンスならキャッシュに追加
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, responseClone));
            }
            return networkResponse;
          })
          .catch(() => {
            // オフラインでキャッシュもない場合
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});
