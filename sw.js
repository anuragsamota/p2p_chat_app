/**
 * PeerWave Service Worker
 * Enables offline caching and PWA installation
 */

const CACHE_NAME = 'peerwave-v2';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon.svg',
    './icon-192.png',
    './icon-512.png'
];

// Install: Cache core static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate: Clean up older cache versions
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Network-first for local assets, fallback to cache when offline
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // Skip WebRTC signaling/WebSocket or non-http requests
    const url = new URL(event.request.url);
    if (!url.protocol.startsWith('http')) return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Cache successful responses
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // If network fails (offline), return cached version
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // If requesting HTML page and offline, serve cached index.html
                    if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
