/**
 * Notification registration utilities for F.R.A.M.E.
 *
 * Handles service worker registration, browser notification permission,
 * and push subscription management.
 */

// ── Service Worker Registration ──

let swRegistration: ServiceWorkerRegistration | null = null;

/**
 * Register the F.R.A.M.E. service worker.
 *
 * Returns the registration object, or `null` if service workers are not
 * supported by the browser.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers are not supported in this browser.');
    return null;
  }

  try {
    // Use PUBLIC_URL to resolve the service worker path correctly.
    // In CRA production builds, the compiled service-worker.ts is output
    // as service-worker.js at the public root. In development, the
    // service worker may not be available (CRA serves it only in production).
    const swUrl = `${process.env.PUBLIC_URL || ''}/service-worker.js`;
    const registration = await navigator.serviceWorker.register(
      swUrl,
      { scope: `${process.env.PUBLIC_URL || ''}/` },
    );

    swRegistration = registration;

    // Listen for updates and apply them gracefully
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (
          newWorker.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          // A new version is available — it will activate on next navigation.
          // In a real app we could prompt the user to refresh.
          console.info('New F.R.A.M.E. service worker available.');
        }
      });
    });

    return registration;
  } catch (err) {
    console.error('Service worker registration failed:', err);
    return null;
  }
}

// ── Notification Permission ──

/**
 * Request browser notification permission.
 *
 * @returns The permission state: 'granted', 'denied', or 'default'.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.warn('Notifications API not supported.');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    // Cannot re-prompt once denied — the user must change it in browser settings.
    return 'denied';
  }

  const result = await Notification.requestPermission();
  return result;
}

// ── Push Subscription ──

/**
 * Subscribe to push notifications and send the subscription endpoint
 * to the homeserver.
 *
 * @param homeserverUrl - Base URL of the Matrix-style homeserver
 * @returns The PushSubscription, or `null` if subscription failed.
 */
export async function subscribeToPush(
  homeserverUrl: string,
): Promise<PushSubscription | null> {
  if (!swRegistration) {
    console.warn('Service worker not registered. Call registerServiceWorker() first.');
    return null;
  }

  try {
    // Check for an existing subscription first
    const existing = await swRegistration.pushManager.getSubscription();
    if (existing) {
      return existing;
    }

    // Subscribe with a placeholder VAPID public key.
    // In production the server provides its real VAPID public key.
    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      // Placeholder: replace with server-provided VAPID public key
      applicationServerKey: urlBase64ToUint8Array(
        'BPlaceholderVAPIDKeyThatShouldBeReplacedWithRealKey00000000000000000000000000000000000000',
      ) as BufferSource,
    });

    // Send subscription to homeserver (placeholder endpoint)
    await fetch(`${homeserverUrl}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
          auth: arrayBufferToBase64(subscription.getKey('auth')),
        },
      }),
    });

    return subscription;
  } catch (err) {
    console.error('Push subscription failed:', err);
    return null;
  }
}

// ── Helpers ──

/**
 * Convert a URL-safe base64 string to a Uint8Array (for applicationServerKey).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/**
 * Convert an ArrayBuffer (or null) to a base64 string for transmission.
 */
function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
