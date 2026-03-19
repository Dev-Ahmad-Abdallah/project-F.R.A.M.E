/**
 * Notification registration utilities for F.R.A.M.E.
 *
 * Handles service worker registration, browser notification permission,
 * and push subscription management.
 */

import { apiRequest } from './api/client';

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
 * to the homeserver via `apiRequest` (uses configured base URL).
 *
 * @param _homeserverUrl - Deprecated, ignored. Kept for call-site compat.
 * @returns The PushSubscription, or `null` if subscription failed.
 */
export async function subscribeToPush(
  _homeserverUrl?: string,
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

    // Fetch the VAPID public key from the server. The key MUST be served
    // by the backend so that only operators control push subscriptions.
    // Falls back to the build-time env var REACT_APP_VAPID_PUBLIC_KEY.
    let vapidPublicKey: string | undefined;
    try {
      // Use apiRequest for consistent error handling and base URL resolution.
      // noAuth: true because the VAPID public key is a public endpoint.
      const data = await apiRequest<{ publicKey?: string }>(
        '/push/vapid-key',
        { noAuth: true },
      );
      vapidPublicKey = data.publicKey;
    } catch {
      // Server may not support the endpoint yet — fall back.
    }

    if (!vapidPublicKey) {
      vapidPublicKey = process.env.REACT_APP_VAPID_PUBLIC_KEY;
    }

    if (!vapidPublicKey) {
      console.error(
        'No VAPID public key available. Set REACT_APP_VAPID_PUBLIC_KEY ' +
        'or ensure the server exposes /push/vapid-key.',
      );
      return null;
    }

    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });

    // Send subscription to homeserver via apiRequest (authenticated,
    // with automatic 401 → refresh → retry).
    await apiRequest('/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
          auth: arrayBufferToBase64(subscription.getKey('auth')),
        },
      },
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
    output[i] = raw.charCodeAt(i); // eslint-disable-line
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
    binary += String.fromCharCode(bytes[i]); // eslint-disable-line
  }
  return btoa(binary);
}

// ── Permission Check ──

/**
 * Check whether the browser has already granted notification permission.
 */
export function isNotificationPermissionGranted(): boolean {
  if (!('Notification' in window)) return false;
  return Notification.permission === 'granted';
}

// ── Local (foreground) Notification ──

/**
 * Show a local browser notification when the tab is focused or visible.
 * Falls back to a generic "New message" body if none is provided.
 * This uses the SW registration when available, or the Notification
 * constructor as a fallback.
 *
 * SECURITY NOTE: callers should NEVER pass message content or sender
 * identity. Use only generic labels.
 */
export async function sendLocalNotification(
  title = 'F.R.A.M.E.',
  body = 'New message',
): Promise<void> {
  if (!isNotificationPermissionGranted()) return;

  // Prefer going through the service worker so the notification is
  // managed by the SW lifecycle (click handling, etc.).
  if (swRegistration) {
    await swRegistration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: 'frame-new-message',
    });
    return;
  }

  // Fallback: use the Notification constructor directly.
  try {
    new Notification(title, {
      body,
      icon: '/icon-192.png',
      tag: 'frame-new-message',
    });
  } catch {
    // Notification constructor may throw in insecure contexts.
  }
}

// ── SW Message Helper ──

/**
 * Send a message to the active service worker.
 */
export function postMessageToSW(message: Record<string, unknown>): void {
  navigator.serviceWorker?.controller?.postMessage(message);
}

/**
 * Return the current ServiceWorkerRegistration (if registered).
 */
export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
  return swRegistration;
}
