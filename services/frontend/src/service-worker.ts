/**
 * F.R.A.M.E. Service Worker — PWA Caching + Secure Push Notification Handler
 *
 * CACHING STRATEGY:
 *   - App shell (HTML, JS, CSS): stale-while-revalidate
 *   - WASM binary: cache-first (large, rarely changes)
 *   - API calls: network-first (never serve stale API data)
 *   - Offline fallback: show "You're offline" message when no cache and no network
 *
 * SECURITY INVARIANTS:
 *   - Push payloads are treated as OPAQUE wake-up signals only.
 *   - Notifications NEVER include sender name, message content, or room name.
 *   - Raw payload data is NEVER passed to the Notification API.
 *   - The notification is always a generic "New message" alert.
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

// Workbox precache manifest (required by CRA's build toolchain)
// Workbox precache manifest — accessed to satisfy CRA's build toolchain
// eslint-disable-next-line no-restricted-globals
void (self as unknown as { __WB_MANIFEST: unknown[] }).__WB_MANIFEST;

// ── Cache Names ──

const APP_SHELL_CACHE = 'frame-app-shell-v1';
const WASM_CACHE = 'frame-wasm-v1';
const OFFLINE_PAGE_KEY = '/offline';

// ── Offline Fallback HTML ──

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0d1117" />
  <title>F.R.A.M.E. — Offline</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #0d1117;
      color: #c9d1d9;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 32px;
      text-align: center;
    }
    .icon {
      width: 64px;
      height: 64px;
      margin-bottom: 24px;
      opacity: 0.6;
    }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; color: #f0f6fc; }
    p { font-size: 15px; color: #8b949e; max-width: 400px; line-height: 1.6; margin-bottom: 24px; }
    button {
      padding: 12px 32px;
      font-size: 14px;
      font-weight: 600;
      background: #238636;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    button:hover { background: #2ea043; }
  </style>
</head>
<body>
  <svg class="icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#58a6ff" stroke-width="2" fill="rgba(88,166,255,0.08)" />
    <path d="M22 34l8-16M42 34l-8-16M26 42h12" stroke="#8b949e" stroke-width="2.5" stroke-linecap="round" />
  </svg>
  <h1>You're offline</h1>
  <p>F.R.A.M.E. needs an internet connection to sync your encrypted messages. Please check your connection and try again.</p>
  <button onclick="window.location.reload()">Retry</button>
</body>
</html>`;

// ── Helpers ──

function isNavigationRequest(request: Request): boolean {
  return request.mode === 'navigate';
}

function isAppShellRequest(request: Request): boolean {
  const url = new URL(request.url);
  // HTML, JS, CSS files from same origin
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  return (
    path === '/' ||
    path.endsWith('.html') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.ico') ||
    path.endsWith('.json')
  );
}

function isWasmRequest(request: Request): boolean {
  return request.url.endsWith('.wasm');
}

function isApiRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_matrix/') ||
    url.pathname.startsWith('/_frame/')
  );
}

// ── Install ──

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      // Pre-cache the offline fallback page
      return cache.put(
        new Request(OFFLINE_PAGE_KEY),
        new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      );
    }).then(() => self.skipWaiting()),
  );
});

// ── Activate ──

self.addEventListener('activate', (event: ExtendableEvent) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== WASM_CACHE)
          .map((key) => caches.delete(key)),
      );
    }).then(() => self.clients.claim()),
  );
});

// ── Fetch — Caching strategies ──

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API calls: network-first (never serve stale API data)
  if (isApiRequest(request)) {
    // Don't cache API calls — let them go straight to network.
    // If network fails, the app handles errors in its own UI.
    return;
  }

  // WASM binary: cache-first (large file, rarely changes)
  if (isWasmRequest(request)) {
    event.respondWith(
      caches.open(WASM_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              void cache.put(request, response.clone());
            }
            return response;
          });
        }),
      ),
    );
    return;
  }

  // App shell: stale-while-revalidate
  if (isAppShellRequest(request) || isNavigationRequest(request)) {
    event.respondWith(
      caches.open(APP_SHELL_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request)
            .then((response) => {
              if (response.ok) {
                void cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // Network failed — if we have a cached version, that was already returned.
              // If this is a navigation and we have no cache, return offline page.
              if (!cached && isNavigationRequest(request)) {
                return cache.match(OFFLINE_PAGE_KEY) as Promise<Response>;
              }
              return cached as Response;
            });

          // Return cached immediately, update in background
          return cached || fetchPromise;
        }),
      ),
    );
    return;
  }
});

// ── Push ──

self.addEventListener('push', (event: PushEvent) => {
  // The push payload is intentionally ignored.
  // We show a fixed, generic notification regardless of what the server sent.
  const notificationPromise = self.registration.showNotification('F.R.A.M.E.', {
    body: 'New message',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: 'frame-new-message',
    // No data, no image, no actions that could leak information.
  } as NotificationOptions);

  event.waitUntil(notificationPromise);
});

// ── Message Handler (communication with main app) ──

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const type = data.type as string | undefined;

  switch (type) {
    case 'SKIP_WAITING':
      void self.skipWaiting();
      break;

    case 'SHOW_NOTIFICATION':
      // The main app can request a notification (e.g. when a sync finds new
      // messages while the tab is hidden). We still enforce the generic
      // "New message" body — no metadata is ever surfaced.
      event.waitUntil(
        self.registration.showNotification('F.R.A.M.E.', {
          body: 'New message',
          icon: '/icon-192.png',
          badge: '/badge-72.png',
          tag: 'frame-new-message',
        } as NotificationOptions),
      );
      break;

    case 'GET_CLIENTS_COUNT':
      // Let the main app know how many controlled windows exist.
      event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clients) => {
          event.source?.postMessage({
            type: 'CLIENTS_COUNT',
            count: clients.length,
          });
        }),
      );
      break;

    default:
      break;
  }
});

// ── Notification Click ──

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  // Focus an existing app window or open a new one.
  const openApp = self.clients
    .matchAll({ type: 'window', includeUncontrolled: false })
    .then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow('/');
    });

  event.waitUntil(openApp);
});

export {};
