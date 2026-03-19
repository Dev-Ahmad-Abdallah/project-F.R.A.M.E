/**
 * F.R.A.M.E. Service Worker — Secure Push Notification Handler
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

// ── Install ──

self.addEventListener('install', (event: ExtendableEvent) => {
  // Activate immediately — do not wait for existing clients to close.
  event.waitUntil(self.skipWaiting());
});

// ── Activate ──

self.addEventListener('activate', (event: ExtendableEvent) => {
  // Claim all open clients so the SW controls them without a reload.
  event.waitUntil(self.clients.claim());
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
