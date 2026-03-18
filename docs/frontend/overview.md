# Frontend Architecture Overview

**Owner:** Mohamed Hussain (235697)
**Role:** Frontend / API Security
**Pillar:** Client-Side (Trusted Component)

---

## Architectural Position

The frontend is the **only trusted component** in the F.R.A.M.E. system. All cryptographic operations — key generation, encryption, decryption, identity verification — execute exclusively on the client. The backend homeservers are treated as untrusted relays that transport encrypted blobs.

**If this layer is compromised, the entire E2EE guarantee is void.**

---

## Component Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    CLIENT APPLICATION                         │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    UI Layer (React/TSX)                  │ │
│  │  ChatWindow │ AuthFlow │ DeviceList │ VerificationBadge  │ │
│  └──────────────────────┬──────────────────────────────────┘ │
│                         │                                    │
│  ┌──────────┬───────────┼───────────┬────────────────────┐   │
│  │          │           │           │                    │   │
│  ▼          ▼           ▼           ▼                    ▼   │
│ ┌────────┐┌──────────┐┌──────────┐┌───────────┐┌──────────┐ │
│ │Crypto  ││Key Verif.││Device    ││Secure     ││API       │ │
│ │Engine  ││& Transp. ││Manager   ││Storage    ││Client    │ │
│ │(vodozem││(Merkle)  ││(QR Link) ││(IndexedDB)││(JWT/TLS) │ │
│ └────────┘└──────────┘└──────────┘└───────────┘└──────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Security Boundary Layer                     │ │
│  │  DOMPurify (XSS) │ Service Worker (Notifications)       │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose | Why This Choice |
|-----------|---------|-----------------|
| TypeScript | All client logic | Type safety for crypto code, catch errors at compile time |
| React (TSX) | UI framework | Component-based, ecosystem maturity, team familiarity |
| vodozemac (WASM) | Olm + Megolm E2EE | Maintained, audited Rust-to-WASM via `matrix-sdk-crypto-wasm`. Replaces deprecated libolm. |
| Web Crypto API | Key generation/derivation | Browser-native, no external crypto dependencies for primitives |
| IndexedDB | Local encrypted storage | Large storage capacity, structured data, async API |
| Service Workers | Background processing | Intercept push events before OS notification layer |
| DOMPurify | XSS sanitization | Industry standard, well-maintained, handles edge cases |
| Fetch API | HTTP client | Native browser API, supports streaming, clean async/await |

---

## Data Flow

### Sending a Message
```
1. User types message in ChatWindow
2. cryptoEngine.encrypt(plaintext, recipientKeys)
   → Olm session lookup / creation
   → Megolm encryption for group chats
   → Returns ciphertext blob
3. apiClient.sendMessage(roomId, ciphertext)
   → Attaches JWT Bearer token
   → HTTPS POST to /messages/send
4. Server stores encrypted blob (never reads it)
```

### Receiving a Message
```
1. Service Worker receives push event (opaque payload)
2. Service Worker calls apiClient.syncMessages()
   → HTTPS GET /messages/sync with JWT
   → Receives encrypted message events
3. cryptoEngine.decrypt(ciphertext, sessionState)
   → Olm/Megolm decryption using local ratchet state
   → Returns plaintext
4. DOMPurify.sanitize(plaintext) before rendering
5. Notification shown: "New message" (no sender, no preview)
```

---

## Key Concerns & Considerations

### Critical Security Requirements
1. **No plaintext ever leaves the client** — not in logs, not in errors, not in notifications
2. **Private keys never stored unencrypted** — IndexedDB stores must use at-rest encryption
3. **No `innerHTML` usage** — all message rendering goes through DOMPurify
4. **JWT tokens in memory only** — never in localStorage, never in cookies
5. **Service Worker must strip all metadata** from push notifications

### Performance Concerns
- vodozemac WASM operations are CPU-intensive; avoid blocking the UI thread
- IndexedDB operations are async but can still cause jank if batched poorly
- Web Crypto API key derivation (PBKDF2/scrypt) is intentionally slow — UX must account for this

### Complexity Risks
- Multi-device session management is the hardest problem — each device pair needs its own Olm session
- Key transparency verification adds latency to every new contact interaction
- Service Worker lifecycle management is tricky (updates, cache invalidation)

---

## Feature Documentation

| Feature | Doc | Priority |
|---------|-----|----------|
| E2EE with vodozemac | [e2ee-libolm.md](./features/e2ee-libolm.md) | Week 3 |
| Key Management & Verification | [key-management.md](./features/key-management.md) | Week 5 |
| Secure Local Storage | [secure-local-storage.md](./features/secure-local-storage.md) | Week 3 |
| Secure Notifications | [secure-notifications.md](./features/secure-notifications.md) | Week 3 |
| XSS Prevention | [xss-prevention.md](./features/xss-prevention.md) | Week 2 |
| Multi-Device Sync | [multi-device-sync.md](./features/multi-device-sync.md) | Week 6 |
| Secure API Communication | [secure-api-communication.md](./features/secure-api-communication.md) | Week 2 |

## Security Documentation

| Doc | Scope |
|-----|-------|
| [Frontend Security Model](./security/security-model.md) | Threat model, trust boundaries, attack surface |
| [Frontend Security Considerations](./security/security-considerations.md) | Implementation guidelines, pitfalls, hardening |

---

## Dependencies on Other Pillars

| Dependency | From | What's Needed | When |
|-----------|------|---------------|------|
| Auth endpoints | Backend (Ahmed) | `POST /auth/register`, `POST /auth/login` | Week 2 |
| Key distribution API | Backend (Ahmed) | `GET /keys/:userId`, `POST /keys/upload` | Week 3 |
| Message endpoints | Backend (Ahmed) | `POST /messages/send`, `GET /messages/sync` | Week 3 |
| Device endpoints | Backend (Ahmed) | `POST /devices/register`, `GET /devices/:userId` | Week 6 |
| Key transparency | Backend (Ahmed) | `GET /keys/transparency/:userId` | Week 5 |
| TLS in staging | DevOps (Hossam) | HTTPS certificates on Railway | Week 3 |
| Push notification infra | DevOps (Hossam) | Push subscription endpoint | Week 3 |

---

## Architectural Decisions (Frontend-Specific)

| ID | Decision | Rationale | Risk |
|----|----------|-----------|------|
| FE-001 | vodozemac (WASM) over libolm | Maintained, audited, memory-safe Rust. libolm is deprecated with no security patches. `matrix-sdk-crypto-wasm` npm package handles WASM build. | Larger binary size (~2MB WASM); acceptable for web app |
| FE-002 | IndexedDB over localStorage | Structured storage, larger capacity, async API | More complex API; needs wrapper (idb library) |
| FE-003 | DOMPurify over manual sanitization | Battle-tested, handles edge cases humans miss | Additional dependency; must stay updated |
| FE-004 | Service Worker for notifications | Only way to intercept push before OS layer | SW lifecycle complexity; debugging is harder |
| FE-005 | Web Crypto API for key generation | Browser-native, no additional crypto libs for primitives | API is low-level and verbose; easy to misuse |
| FE-006 | JWT in memory (not cookies/localStorage) | Prevents XSS token theft and CSRF | Token lost on page refresh; needs silent re-auth flow |
