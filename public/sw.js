const CACHE_NAME = 'herdr-web-v4';
const APP_SHELL = ['/tui/', '/tui/manifest.webmanifest', '/tui/icon.svg', '/tui/icon-192.png', '/tui/icon-512.png', '/tui/icon-maskable-512.png', '/tui/apple-touch-icon-180.png', '/tui/fonts/SymbolsNerdFontMono-Regular.woff2'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))),
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.pathname === '/tui/ws') {
        return;
    }
    // network-first so fresh builds win; cache is the offline fallback
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches
                        .open(CACHE_NAME)
                        .then((cache) => cache.put(event.request, copy))
                        .catch(() => {});
                }
                return response;
            })
            .catch(() => caches.match(event.request).then((cached) => cached || Response.error())),
    );
});

// real Web Push: the server sends these through the browser's push service,
// so they arrive even when the page is closed
self.addEventListener('push', (event) => {
    let payload = { title: 'herdr', body: '' };
    try {
        payload = { ...payload, ...event.data.json() };
    } catch {}
    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: '/tui/icon-192.png',
            tag: payload.tag || 'herdr-web',
        }),
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            const existing = clientList.find((client) => 'focus' in client);
            if (existing) {
                return existing.focus();
            }
            return self.clients.openWindow('/tui/');
        }),
    );
});
