// service-worker.js
// Progressive Web App Service Worker for HEXAEQUO
// Provides offline functionality and caching strategies

const CACHE_VERSION = 'hexaequo-v1.0.9';
const CACHE_STATIC = `${CACHE_VERSION}-static`;
const CACHE_DYNAMIC = `${CACHE_VERSION}-dynamic`;
const CACHE_API = `${CACHE_VERSION}-api`;

// Static assets to cache on install
const STATIC_ASSETS = [
	'/',
	'/index.html',
	'/frontend/index.html',
	'/frontend/css/base.css',
	'/frontend/css/auth.css',
	'/frontend/css/game.css',
	'/frontend/css/lobby.css',
	'/frontend/css/profile.css',
	'/frontend/js/app.js',
	'/frontend/js/main.js',
	'/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
	console.log('[Service Worker] Installing version:', CACHE_VERSION);
	
	event.waitUntil(
		caches.open(CACHE_STATIC)
			.then((cache) => {
				console.log('[Service Worker] Caching static assets');
				return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
			})
			.catch((error) => {
				console.error('[Service Worker] Cache installation failed:', error);
			})
			.then(() => self.skipWaiting())
	);
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
	console.log('[Service Worker] Activating version:', CACHE_VERSION);
	
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames
					.filter((name) => name.startsWith('hexaequo-') && name !== CACHE_STATIC && name !== CACHE_DYNAMIC && name !== CACHE_API)
					.map((name) => {
						console.log('[Service Worker] Removing old cache:', name);
						return caches.delete(name);
					})
			);
		}).then(() => self.clients.claim())
	);
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Skip non-GET requests
	if (request.method !== 'GET') {
		return;
	}

	// API requests - network first, cache fallback
	if (url.pathname.startsWith('/api/')) {
		event.respondWith(networkFirstStrategy(request, CACHE_API));
		return;
	}

	// Socket.io requests - network only
	if (url.pathname.includes('socket.io')) {
		event.respondWith(fetch(request));
		return;
	}

	// Static assets - cache first, network fallback
	if (STATIC_ASSETS.some(asset => url.pathname === asset || url.pathname.endsWith(asset))) {
		event.respondWith(cacheFirstStrategy(request, CACHE_STATIC));
		return;
	}

	// Dynamic content - stale while revalidate
	event.respondWith(staleWhileRevalidateStrategy(request, CACHE_DYNAMIC));
});

/**
 * Cache first strategy - serve from cache, fallback to network
 */
async function cacheFirstStrategy(request, cacheName) {
	const cachedResponse = await caches.match(request);
	
	if (cachedResponse) {
		return cachedResponse;
	}

	try {
		const networkResponse = await fetch(request);
		
		if (networkResponse && networkResponse.status === 200) {
			const cache = await caches.open(cacheName);
			cache.put(request, networkResponse.clone());
		}
		
		return networkResponse;
	} catch (error) {
		console.error('[Service Worker] Fetch failed:', error);
		
		// Return offline fallback if available
		if (request.destination === 'document') {
			const offlinePage = await caches.match('/offline.html');
			if (offlinePage) return offlinePage;
		}
		
		throw error;
	}
}

/**
 * Network first strategy - try network, fallback to cache
 */
async function networkFirstStrategy(request, cacheName) {
	try {
		const networkResponse = await fetch(request);
		
		if (networkResponse && networkResponse.status === 200) {
			const cache = await caches.open(cacheName);
			cache.put(request, networkResponse.clone());
		}
		
		return networkResponse;
	} catch (error) {
		console.log('[Service Worker] Network failed, trying cache:', request.url);
		
		const cachedResponse = await caches.match(request);
		
		if (cachedResponse) {
			return cachedResponse;
		}
		
		throw error;
	}
}

/**
 * Stale while revalidate - serve from cache, update in background
 */
async function staleWhileRevalidateStrategy(request, cacheName) {
	const cachedResponse = await caches.match(request);
	
	const fetchPromise = fetch(request).then((networkResponse) => {
		if (networkResponse && networkResponse.status === 200) {
			const cache = caches.open(cacheName);
			cache.then(c => c.put(request, networkResponse.clone()));
		}
		return networkResponse;
	}).catch(() => {
		// Network failed, return cached if available
		return cachedResponse;
	});

	return cachedResponse || fetchPromise;
}

// Message event - handle messages from clients
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
	
	if (event.data && event.data.type === 'CLEAR_CACHE') {
		event.waitUntil(
			caches.keys().then((cacheNames) => {
				return Promise.all(cacheNames.map((name) => caches.delete(name)));
			}).then(() => {
				event.ports[0].postMessage({ success: true });
			})
		);
	}
});
