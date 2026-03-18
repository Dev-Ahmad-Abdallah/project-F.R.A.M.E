# Feature: Secure Notification Handling (Service Workers)

**Owner:** Mohamed Hussain (235697)
**Priority:** Week 3
**Status:** Planned

---

## Overview

Push notifications are a major privacy leak. Many apps send message previews to Firebase/APNs servers before the user opens the app — exposing sender identity and content to third parties. F.R.A.M.E. uses Service Workers to intercept all push events and ensure no metadata leaks to external notification services.

---

## The Problem

```
Traditional Flow (INSECURE):
Server → Firebase/APNs: "Message from Alice: Hey, are you free?"
                          ↑ Third party sees sender + content
Firebase/APNs → Device: Shows notification with sender + preview

F.R.A.M.E. Flow (SECURE):
Server → Push Service: { type: "wake" }  ← Opaque, no content
Push Service → Service Worker: (wake-up signal)
Service Worker → Server: GET /messages/sync (with JWT)
Service Worker ← Server: { encrypted_events: [...] }
Service Worker: decrypt locally → show "New message" (no sender, no preview)
```

---

## Implementation

### Key Files

```
src/
├── service-worker.ts    # Intercepts push events, decrypts locally
└── notifications.ts     # Controls notification display content
```

### service-worker.ts

**Responsibilities:**
- Register as push event listener
- On push event: receive opaque wake-up payload (no content)
- Fetch encrypted messages from server: `GET /messages/sync`
- Decrypt messages using crypto engine (vodozemac WASM)
- Pass decrypted metadata (NOT content) to notifications.ts
- Never expose raw payload to the browser Notification API

**Push Event Handler:**
```
self.addEventListener('push', async (event) => {
  // 1. Push payload is empty/opaque — just a wake-up signal
  // 2. Fetch encrypted messages from homeserver
  // 3. Decrypt locally using stored session state
  // 4. Show generic notification: "New message"
  //    - NO sender name
  //    - NO message preview
  //    - NO room name
});
```

### notifications.ts

**Responsibilities:**
- Format notification display
- Enforce: notification body is always generic ("New message" or "You have new messages")
- Never include: sender identity, message content, room name, timestamp details
- Handle notification click → open app to relevant conversation

---

## Security Rules

1. **Push payload must be opaque** — server sends only a wake-up signal, never content
2. **Service Worker never passes raw data** to browser Notification API
3. **Notification text is always generic** — "New message" only
4. **No sender, no preview, no room name** in any notification
5. **Decryption happens in Service Worker** before any display logic

---

## Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Service Worker over main thread | SW intercepts push before app is open | Only way to process push events in background |
| Opaque push payload | Server sends empty wake-up | Prevents third-party push services from reading metadata |
| Generic notification text | "New message" only | Any specificity leaks metadata to OS notification system |
| No web push content encryption | Rely on our own E2EE | Web Push encryption (RFC 8291) protects in transit but still decrypts at push service |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Service Worker update breaks notification flow | High | Version SW carefully; test update lifecycle |
| SW can't access IndexedDB in all browsers | Medium | Check API availability; fallback to main thread |
| User disables notifications → misses messages | Low | Show in-app indicator; prompt to enable |
| Push subscription expires | Medium | Re-subscribe on app open; handle expiry gracefully |

---

## Testing

- [ ] Push notification payload contains no sender ID or message preview
- [ ] Service Worker intercepts push event and fetches messages
- [ ] Notification displayed shows only "New message"
- [ ] Clicking notification opens correct conversation
- [ ] No plaintext leaks to OS notification history
