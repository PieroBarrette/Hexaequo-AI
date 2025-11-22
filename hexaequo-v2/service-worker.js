// service-worker.js
// Service Worker for caching and offline functionality

const CACHE_NAME = 'hexaequo-v1';
const urlsToCache = [
    './',
    './index.html',
    './game.js',
    './ai.js',
    './ai-worker.js',
    './styles.css',
    './logo.png',
    './manifest.json',
    './sounds/button_click.mp3',
    './sounds/capture.mp3',
    './sounds/game_end.mp3',
    './sounds/move.mp3',
    './sounds/piece_placement.mp3',
    './sounds/tile_placement.mp3'
];

// Install event - cache resources
self.addEventListener('install', function(event) {
    console.log('[ServiceWorker] Install');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                console.log('[ServiceWorker] Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .catch(function(error) {
                console.log('[ServiceWorker] Cache failed:', error);
            })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
    console.log('[ServiceWorker] Activate');
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[ServiceWorker] Removing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request)
            .then(function(response) {
                // Cache hit - return response
                if (response) {
                    return response;
                }

                // Clone the request
                const fetchRequest = event.request.clone();

                return fetch(fetchRequest).then(
                    function(response) {
                        // Check if valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone the response
                        const responseToCache = response.clone();

                        caches.open(CACHE_NAME)
                            .then(function(cache) {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    }
                );
            })
            .catch(function() {
                // Offline fallback
                console.log('[ServiceWorker] Fetch failed; returning offline page instead.');
            })
    );
});

