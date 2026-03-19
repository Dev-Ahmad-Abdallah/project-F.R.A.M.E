# Project F.R.A.M.E. — System Architecture Map

**Federated Ratcheting Architecture for Messaging Encryption**
**Team 47** | Computer Systems Security | 25CSCI34H

---

## System Overview

F.R.A.M.E. is a federated, decentralized end-to-end encrypted (E2EE) messaging system. The core security model: **the client is the only trusted component**. Backend homeservers are untrusted relays that transport encrypted blobs without ever accessing plaintext.

### Core Principle

```
ALL CRYPTO HAPPENS ON THE CLIENT.
The server NEVER decrypts.
If the client layer is broken, the entire E2EE promise breaks.
```

---

## High-Level Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │          CLIENT APPLICATION (Trusted)        │
                    │                                              │
                    │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
                    │  │  Crypto  │ │   UI/UX  │ │ Local Store │  │
                    │  │(vodozemac│ │   (TSX)  │ │ (IndexedDB) │  │
                    │  │  WASM)   │ │          │ │             │  │
                    │  └──────────┘ └──────────┘ └─────────────┘  │
                    │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
                    │  │ Key      │ │  Service │ │  DOMPurify  │  │
                    │  │ Transp.  │ │  Worker  │ │ (XSS guard) │  │
                    │  └──────────┘ └──────────┘ └─────────────┘  │
                    └──────────────────┬───────────────────────────┘
                                       │ HTTPS (TLS) + JWT
                                       ▼
┌───────────────────────────────────────────────────────────────────┐
│                    FEDERATION LAYER                                │
│                                                                   │
│  ┌─────────────────────┐    Federation API    ┌────────────────┐  │
│  │   Homeserver A      │◄────────────────────►│  Homeserver B  │  │
│  │  (Node.js/Express)  │   (TLS + Server Auth)│ (Node.js/Exp.) │  │
│  │                     │                      │                │  │
│  │  ┌───────────────┐  │                      │ ┌────────────┐ │  │
│  │  │ API Gateway   │  │                      │ │ API Gateway│ │  │
│  │  │ Message Queue │  │                      │ │ Msg Queue  │ │  │
│  │  │ Key Dist.     │  │                      │ │ Key Dist.  │ │  │
│  │  │ Room Service  │  │                      │ │ Room Svc   │ │  │
│  │  │ Federation Svc│  │                      │ │ Fed. Svc   │ │  │
│  │  └───────────────┘  │                      │ └────────────┘ │  │
│  │         │           │                      │       │        │  │
│  │    ┌────┴────┐      │                      │  ┌────┴────┐   │  │
│  │    │PostgreSQL│      │                      │  │PostgreSQL│  │  │
│  │    │  Redis   │      │                      │  │  Redis   │  │  │
│  │    └─────────┘      │                      │  └─────────┘   │  │
│  └─────────────────────┘                      └────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┴───────────────────┐
                    │        DEPLOYMENT LAYER              │
                    │  Railway PaaS + Docker + GitHub CI   │
                    │  GitHub Actions + GHAS + Secrets     │
                    └─────────────────────────────────────┘
```

---

## Team & Responsibilities

| Member | Role | Owns |
|--------|------|------|
| **Ahmed Ali Abdallah** (234742) | Backend & DB Security | Homeserver, APIs, PostgreSQL, Redis, Federation, Key Distribution, Room Service |
| **Mohamed Hussain** (235697) | Frontend / API Security | Client app, Crypto layer, UI, Local storage, Notifications |
| **Hossam Elsayed** (235174) | DevOps / Infrastructure | CI/CD, Docker, Railway, Secrets, Monitoring, TLS |

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Backend** | Node.js + Express.js | Express ^4.21 | Federated homeserver, REST APIs (AD-013: Express 4, not v5) |
| **Backend** | PostgreSQL | 16 (Alpine) | Users, devices, rooms, encrypted events, to-device messages, key transparency log |
| **Backend** | Redis (ioredis) | 7 (Alpine) / ^5.10 | Pub/sub for to-device delivery, session temp storage, rate limiting |
| **Backend** | JWT (jsonwebtoken) | ^9.0.3 | Authentication (access + refresh tokens). No OAuth2 — custom JWT only |
| **Backend** | bcrypt | ^6.0.0 | Password hashing (configurable salt rounds) + room password hashing |
| **Backend** | Zod | ^3.23 | Request validation (backend-only; AD-015) |
| **Backend** | node-pg-migrate | ^7.9.0 | SQL-based database migrations (AD-017) |
| **Backend** | helmet | ^8.1.0 | Security headers (CSP, HSTS, etc.) |
| **Backend** | express-rate-limit | ^7.5.0 | Per-IP rate limiting with dedicated limiters per endpoint category |
| **Backend** | Merkle Tree (custom) | -- | Key transparency / consistency proofs |
| **Frontend** | TypeScript / React | React ^19.0, TS ^5.4 | Client application & UI |
| **Frontend** | vodozemac (WASM) | `@matrix-org/matrix-sdk-crypto-wasm` ^18.0 | Olm (1:1) + Megolm (group) E2EE |
| **Frontend** | Web Crypto API | -- | Key derivation, hashing (SHA-256 for storage passphrase) |
| **Frontend** | IndexedDB (`idb` ^8.0) | -- | Encrypted local storage + OlmMachine persistent crypto state |
| **Frontend** | Service Workers | -- | Secure push notification handling |
| **Frontend** | DOMPurify | ^3.2.0 | XSS prevention on all rendered message/room content |
| **Frontend** | qrcode.react | ^4.1.0 | QR codes for device linking + fingerprint verification |
| **Frontend** | react-scripts | 5.0.1 | Build toolchain (CRA) |
| **DevOps** | GitHub + GitHub Actions | -- | Version control + CI/CD |
| **DevOps** | GitHub Advanced Security | -- | SAST, secret detection, dependency scanning |
| **DevOps** | Docker + Docker Compose | Compose 3.8 | Containerization (2 homeservers, 2 PostgreSQL, 2 Redis) |
| **DevOps** | Railway | -- | PaaS deployment |

---

## Architecture Critique

**[Architecture Critique -- Round 1](./architecture-critique.md)** -- Initial devil's advocate analysis on the original architecture.
**[Architecture Decisions -- Phase 2](./architecture-decisions-phase2.md)** -- Revised decisions after second `/am-i-wrong` critique (Express 4, long-polling, Railway root config, migrations, CORS).
**[Setup Requirements](./setup-requirements.md)** -- External dependencies, API keys (none needed), auto-handled features, environment variables, first-time setup checklist.
**[Project Structure](./project-structure.md)** -- Service directory layout, Railway service mapping, shared types strategy, why homeservers share one codebase.
**[ADR-001: Backend Framework](./adr/ADR-001-backend-framework.md)** -- Django vs Express.js decision. Express (TypeScript) chosen for workload fit, language unity, and timeline.
**[Railway Service Map](./infrastructure/railway-service-map.md)** -- Every Railway service mapped to its config, domain, env vars, and connections.

---

## Documentation Navigation

### Frontend (Mohamed)
- **[Frontend Overview](./frontend/overview.md)** -- Central navigation, concerns, architecture decisions
- **Features:**
  - [E2EE with vodozemac](./frontend/features/e2ee-libolm.md)
  - [Key Management & Verification](./frontend/features/key-management.md)
  - [Secure Local Storage](./frontend/features/secure-local-storage.md)
  - [Secure Notifications](./frontend/features/secure-notifications.md)
  - [XSS Prevention](./frontend/features/xss-prevention.md)
  - [Multi-Device Sync](./frontend/features/multi-device-sync.md)
  - [Secure API Communication](./frontend/features/secure-api-communication.md)
- **Security:**
  - [Frontend Security Model](./frontend/security/security-model.md)
  - [Frontend Security Considerations](./frontend/security/security-considerations.md)

### Backend (Ahmed)
- **[Backend Overview](./backend/overview.md)** -- Central navigation, concerns, architecture decisions
- **Features:**
  - [API Gateway & Application Server](./backend/features/api-gateway.md)
  - [Message Queue & Store-and-Forward](./backend/features/message-queue.md)
  - [Federation Service](./backend/features/federation-service.md)
  - [Key Distribution & Transparency](./backend/features/key-distribution.md)
  - [Device & Session Management](./backend/features/device-session-management.md)
  - [Authentication & Authorization](./backend/features/authentication.md)
  - [Database Schema & Storage](./backend/features/database-schema.md)
- **Security:**
  - [Backend Security Model](./backend/security/security-model.md)
  - [Backend Security Considerations](./backend/security/security-considerations.md)

### Deployment (Hossam)
- **[Deployment Overview](./deployment/overview.md)** -- Central navigation, concerns, architecture decisions
- **Features:**
  - [CI/CD Pipeline](./deployment/features/cicd-pipeline.md)
  - [Docker Containerization](./deployment/features/docker-containerization.md)
  - [Railway Deployment](./deployment/features/railway-deployment.md)
  - [Secrets Management](./deployment/features/secrets-management.md)
  - [TLS & Network Security](./deployment/features/tls-network-security.md)
  - [Monitoring & Logging](./deployment/features/monitoring-logging.md)
- **Security:**
  - [Infrastructure Security Model](./deployment/security/security-model.md)
  - [Infrastructure Security Considerations](./deployment/security/security-considerations.md)

---

## Key Source Files (Actual Structure)

### Frontend (`services/frontend/src/`)

```
services/frontend/src/
├── api/
│   ├── client.ts              # Central fetch wrapper (JWT, HTTPS enforcement, session timeout, token refresh)
│   ├── authAPI.ts             # Login, register, logout
│   ├── keysAPI.ts             # Key upload, fetch, query, claim, transparency proofs
│   ├── messagesAPI.ts         # Send ciphertext, delete messages, long-poll sync
│   ├── devicesAPI.ts          # Device registration, device list
│   └── roomsAPI.ts            # Room create, list, join, invite, leave, rename, settings, password-join
├── crypto/
│   ├── keyManager.ts          # Key generation, upload, rotation via OlmMachine
│   ├── olmMachine.ts          # OlmMachine lifecycle (WASM init, outgoing requests, mutex, multi-tab BroadcastChannel)
│   ├── sessionManager.ts     # Megolm group session coordination (establish, encrypt, decrypt, sync processing)
│   └── cryptoUtils.ts         # Web Crypto API wrappers
├── verification/
│   ├── keyTransparency.ts     # Merkle proof verification
│   ├── fingerprintUI.tsx      # QR code + safety numbers UI
│   └── keyChangeAlert.tsx     # Key change warning component
├── storage/
│   └── secureStorage.ts       # IndexedDB wrapper with at-rest encryption
├── devices/
│   ├── deviceManager.ts       # Register, list, verify, remove devices
│   ├── deviceLinking.tsx      # QR-based device linking UI
│   └── deviceAlert.tsx        # Unknown device alert
├── components/
│   ├── ChatWindow.tsx         # Main chat UI (encryption, decryption, view-once, disappearing messages, message delete, context menu)
│   ├── AuthFlow.tsx           # Login/register flow
│   ├── DeviceList.tsx         # Linked devices settings view
│   ├── VerificationBadge.tsx  # Contact verification status
│   ├── RoomList.tsx           # Room sidebar (starred/pinned, all conversations, archived sections)
│   ├── RoomSettings.tsx       # Room settings panel (rename, members, invite, leave, disappearing messages toggle)
│   ├── SessionSettings.tsx    # Session timeout & auto-lock settings
│   └── NewChatDialog.tsx      # Create new direct/group chat dialog
├── pages/
│   ├── LandingPage.tsx        # Marketing splash page (pre-auth)
│   └── SignInPage.tsx         # Sign-in / registration page
├── hooks/
│   ├── useAppInit.ts          # One-time app initialisation hook
│   ├── useIsMobile.ts         # Responsive breakpoint hook
│   ├── useNotifications.ts    # Notification state (unread counts, permission, per-room tracking)
│   └── useSessionTimeout.ts   # Inactivity timer (configurable timeout, auto-lock, warning banner)
├── utils/
│   └── displayName.ts         # Format @user:server display names
├── globalStyles.ts            # Shared style constants
├── App.tsx                    # Root component (page routing, session lock, init overlay, sidebar layout)
├── index.tsx                  # React entry point
├── service-worker.ts          # Push interception + local decryption
└── notifications.ts           # Service worker registration + notification display logic
```

### Backend (`services/homeserver/src/`)

```
services/homeserver/src/
├── config.ts                  # Zod-validated environment config
├── server.ts                  # Express app setup, route mounting, graceful shutdown, sendToDevice endpoint, well-known discovery
├── logger.ts                  # Structured JSON logging (level, timestamp, service, metadata)
├── routes/
│   ├── auth.ts                # /auth/* (register, login, logout, refresh)
│   ├── keys.ts                # /keys/* (upload, query, claim, count, fetch bundle, transparency)
│   ├── messages.ts            # /messages/* (send, delete, sync)
│   ├── rooms.ts               # /rooms/* (create, list, join, invite, rename, settings, password-join, leave, members)
│   ├── devices.ts             # /devices/* (register, list, delete, heartbeat)
│   ├── federation.ts          # /federation/* (send events, key exchange, backfill with peer auth)
│   ├── push.ts                # /push/* (vapid-key, subscribe, unsubscribe)
│   └── health.ts              # /health (PostgreSQL + Redis status; returns 503 when degraded)
├── services/
│   ├── authService.ts         # User registration, login, refresh tokens, token revocation
│   ├── keyService.ts          # Key bundle CRUD, OTK management, device key query, key claiming
│   ├── messageService.ts      # Message storage, sync with long-polling, soft-delete
│   ├── roomService.ts         # Room CRUD, membership, invites, password rooms, room settings
│   ├── deviceService.ts       # Device registration, listing, removal, heartbeat
│   ├── federationService.ts   # Peer trust verification, event signing, incoming event handling
│   └── merkleTree.ts          # Merkle tree for key transparency proofs
├── middleware/
│   ├── auth.ts                # JWT verification middleware (requireAuth)
│   ├── errorHandler.ts        # Centralized error handler + asyncHandler wrapper
│   ├── rateLimit.ts           # Rate limiters (login, register, refresh, message, API)
│   └── validation.ts          # Zod schemas for all request types
├── db/
│   ├── pool.ts                # PostgreSQL connection pool
│   └── queries/
│       ├── users.ts           # User CRUD queries
│       ├── devices.ts         # Device CRUD queries
│       ├── keys.ts            # Key bundle + OTK queries
│       ├── rooms.ts           # Room + membership queries
│       └── events.ts          # Event storage + sync queries
└── redis/
    └── client.ts              # Redis client (main + subscriber for pub/sub)
```

### Shared (`shared/types/`)

```
shared/types/
├── api.ts                     # AuthResponse, ErrorResponse, API contract types
├── devices.ts                 # Device types
├── events.ts                  # Event types
├── federation.ts              # Federation event + request types
├── keys.ts                    # Key bundle types
└── index.ts                   # Re-exports
```

### Database Migrations (`services/homeserver/migrations/`)

```
migrations/
├── 001_initial-schema.sql     # Users, devices, rooms, room_members, events, key_bundles, key_transparency_log, delivery_state, refresh_tokens
├── 002_scalability-indexes.sql # Additional performance indexes
├── 003_to-device-messages.sql # to_device_messages table for Megolm key delivery
├── 004_to-device-claimed-at.sql # Claimed-at tracking for to-device messages
├── 005_room-name.sql          # Room name + settings JSONB columns
├── 006_device-keys-json.sql   # Full signed device_keys JSON storage for /keys/query
├── 007_event-chain.sql        # prev_event_id column for event chain integrity
└── 008_push-subscriptions.sql # push_subscriptions table for Web Push subscriptions
```

---

## API Contract (Frontend <-> Backend)

### Authentication

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/register` | POST | Register user + upload initial public keys |
| `/auth/login` | POST | Authenticate, receive access + refresh JWT |
| `/auth/logout` | POST | Invalidate all refresh tokens server-side |
| `/auth/refresh` | POST | Refresh access token using refresh token |

### Keys

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/keys/upload` | POST | Upload one-time prekeys + device_keys (OlmMachine KeysUploadRequest) |
| `/keys/query` | POST | Query device keys for users (OlmMachine KeysQueryRequest) |
| `/keys/claim` | POST | Claim one-time keys for devices (OlmMachine KeysClaimRequest) |
| `/keys/count` | GET | Get remaining OTK count for own device |
| `/keys/:userId` | GET | Fetch contact's public key bundle (claims one OTK) |
| `/keys/transparency/:userId` | GET | Fetch Merkle proof for key verification |

### Messages

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/messages/send` | POST | Send encrypted message payload to a room |
| `/messages/:eventId` | DELETE | Soft-delete a message (sender only) |
| `/messages/sync` | GET | Long-poll for queued messages since last sync (AD-014) |

### Rooms

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rooms/create` | POST | Create a new room (direct or group, optional password/privacy) |
| `/rooms` | GET | List all rooms the authenticated user belongs to |
| `/rooms/:roomId/invite` | POST | Invite a user to a room |
| `/rooms/:roomId/join` | POST | Join a room by invite |
| `/rooms/:roomId/join-with-password` | POST | Join a password-protected room |
| `/rooms/:roomId/name` | PUT | Rename a room |
| `/rooms/:roomId/settings` | PUT | Update room settings (disappearing messages, privacy, password) |
| `/rooms/:roomId/settings` | GET | Get room settings |
| `/rooms/:roomId/leave` | DELETE | Leave a room |
| `/rooms/:roomId/members` | GET | List members of a room |

### Devices

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/devices/register` | POST | Register new device public key |
| `/devices/:userId` | GET | List all devices for a user (own or shared-room users only) |
| `/devices/:deviceId` | DELETE | Remove/revoke a device |
| `/devices/heartbeat` | POST | Update device last-seen timestamp |

### To-Device Messaging

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sendToDevice/:eventType/:txnId` | PUT | Send to-device messages (Megolm key sharing via Olm) |

### Federation

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/federation/send` | POST | Accept signed events from peer servers |
| `/federation/keys/:userId` | GET | Return key bundle for cross-server key exchange |
| `/federation/backfill` | GET | Return events for a room since a sequence ID |

### Push Notifications

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/push/vapid-key` | GET | Get server's VAPID public key for push subscription |
| `/push/subscribe` | POST | Store push subscription for authenticated user's device |
| `/push/unsubscribe` | DELETE | Remove push subscription for authenticated user's device |

### Infrastructure

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check (PostgreSQL + Redis connectivity; returns 503 when degraded) |
| `/` | GET | Server info + available endpoints |
| `/.well-known/frame/server` | GET | Federation discovery (domain, port, public key) |

---

## Implemented Features

### Core Messaging
- **E2EE with vodozemac** -- Olm (1:1) + Megolm (group) encryption via `@matrix-org/matrix-sdk-crypto-wasm`
- **Room-based conversations** -- Direct messages and group chats with room creation, invites, joins, and leaving
- **Real-time sync** -- Long-polling message sync with configurable timeout (AD-014)
- **Message delete** -- Soft-delete messages (sender only, server-side + client-side)

### Room Features
- **Room renaming** -- Editable room names for group chats
- **Password-protected rooms** -- Optional bcrypt-hashed password on room creation, password-gated join
- **Room settings** -- JSONB-stored per-room settings (privacy, disappearing messages, password)
- **Disappearing messages** -- Configurable auto-delete timer (30s to 7 days), client-side expiry enforcement
- **Room member management** -- Invite, join, leave, member listing with device counts

### Chat UX
- **View-once messages** -- Toggle to send messages that auto-hide after 5 seconds of viewing
- **Starred/pinned conversations** -- Pin rooms to top of sidebar (localStorage-persisted)
- **Archived conversations** -- Archive rooms into a collapsible section (localStorage-persisted)
- **Context menu** -- Right-click message actions (delete)
- **Connection status banner** -- Online/offline detection with user notification

### Security Features
- **Session timeout** -- Configurable inactivity timeout (5 min to 4 hours, or never)
- **Auto-lock** -- Lock screen on inactivity requiring user ID to unlock
- **Session warning banner** -- 60-second countdown warning before session expiry
- **Token refresh** -- Access + refresh token flow with dedicated rate limiter
- **Token revocation** -- Server-side logout invalidates all refresh tokens
- **Multi-tab coordination** -- BroadcastChannel warning when multiple tabs run OlmMachine
- **Device heartbeat** -- Periodic last-seen updates for device liveness tracking
- **Device access control** -- Users can only list devices of users they share a room with
- **Device limit enforcement** -- Server-side maximum of 10 devices per user (M_LIMIT_EXCEEDED error)
- **DOMPurify strict config** -- Shared `PURIFY_CONFIG` with explicit ALLOWED_TAGS, FORBID_TAGS, FORBID_ATTR, and ALLOW_DATA_ATTR: false on all sanitization calls

### Federation
- **Circuit breaker** -- Per-peer failure tracking with threshold (5 failures), cooldown (60s), and state machine (closed/open/half-open) to prevent cascading failures
- **Backfill peer authentication** -- `/federation/backfill` verifies requesting server is a trusted peer via `isPeerTrusted()` check

### Push Notifications
- **Push subscription endpoints** -- Server-side `/push/subscribe`, `/push/vapid-key`, and `/push/unsubscribe` endpoints with Zod validation, backed by `push_subscriptions` table
- **VAPID configuration** -- VAPID keys documented in `.env.example` for both homeserver and frontend

### Infrastructure
- **Structured logging** -- JSON-structured log output via `logger.ts` with level, timestamp, service name, and metadata fields. Production uses single-line JSON; development uses pretty-print
- **CodeQL SAST** -- Integrated into CI pipeline (security job) plus dedicated `security.yml` with extended queries and Semgrep scanning
- **Container scanning** -- Trivy vulnerability scanning for both homeserver and frontend Docker images, with SARIF upload to GitHub Advanced Security
- **Migration runner** -- `migrate.sh` runs all SQL migrations in order, idempotent (IF NOT EXISTS), with psql/Node.js fallback

### UI/UX
- **Landing page** -- Marketing splash with feature highlights, how-it-works flow, security overview
- **Sign-in page** -- Dedicated authentication page with back navigation
- **Initialization overlay** -- Phased loading indicator (keys, storage, rooms)
- **Responsive design** -- Mobile-first with sidebar toggle, back button, breakpoint detection
- **Dark theme** -- Consistent dark color scheme (#0d1117 bg, #58a6ff accent)

---

## Timeline (8 Weeks)

| Week | Phase | Key Milestone | Actual Status |
|------|-------|--------------|---------------|
| 1 | Planning & Setup | Architecture locked, repo ready, API contracts defined | Completed |
| 2 | Core Skeletons | Auth working, client calls APIs, basic chat UI | Completed |
| 3 | E2EE Lifecycle | Encrypted send/receive on same server | Completed |
| 4 | Federation | Cross-server delivery working in staging | Completed |
| 5 | Verification | Key publishing, transparency log, client proofs | Completed |
| 6 | Multi-Device | Device fan-out, linking flow, hardening | Completed |
| 7 | Testing & Features | Rooms, disappearing messages, view-once, star/archive, session timeout | Completed (scope expanded) |
| 8 | Final Delivery | Stable demo, final report | Completed |

---

## Threat Model Summary

| Threat | Layer | Defense |
|--------|-------|---------|
| MitM key substitution | Frontend + Backend | Key Transparency Merkle Log + fingerprint verification |
| XSS via malicious messages | Frontend | DOMPurify sanitization on all rendered content (messages, room names, member names) |
| Metadata leak via push | Frontend | Opaque push + Service Worker local decrypt |
| Fake device injection | Frontend | QR-based device authentication + unknown device alert dialog |
| Session/ratchet state corruption | Frontend | Per-device isolated OlmMachine in IndexedDB (store name unique per user/device) |
| Credential theft | Frontend + DevOps | JWT in memory only, HTTPS enforced, no localStorage secrets (only non-sensitive preferences stored) |
| Clone attack via session state | Backend | Formal session management, device list verification, heartbeat tracking |
| Communication pattern analysis | Backend | Minimal metadata retention, no content logging. **Known limitation**: server still sees sender/recipient/timing metadata. Full metadata protection (sealed sender, mixnets) is out of scope. |
| Brute-force attacks | Backend | Dedicated rate limiters per endpoint type (login, register, refresh, message, API) |
| Session hijacking | Frontend | Configurable session timeout with auto-lock, refresh token rotation, server-side token revocation |
| Unauthorized room access | Backend | Password-protected rooms with bcrypt hashing, membership checks on all room operations |
| Multi-tab key conflicts | Frontend | BroadcastChannel coordination warns when multiple OlmMachine instances are active |
| Stale device access | Backend | Device heartbeat tracking, device removal capability, access-controlled device listing |
| CI/CD pipeline compromise | DevOps | Branch protection, GHAS scanning, least-privilege workflows |
| Secret leakage | DevOps | GitHub Secrets + Railway config store, no hardcoded secrets |
| Infrastructure attack | DevOps | Docker isolation, TLS everywhere, rate limiting, helmet security headers with CSP |

---

## Architectural Decisions Log

| Decision | Choice | Rationale | Status |
|----------|--------|-----------|--------|
| AD-001 | Express.js (TypeScript) over Django | Backend is an untrusted relay, not CRUD. TS end-to-end eliminates type sync. Node designed for I/O relay. See [ADR-001](./adr/ADR-001-backend-framework.md) | **Confirmed** (formalized) |
| AD-002 | vodozemac (WASM) for E2EE | Maintained, audited Rust-to-WASM; libolm is deprecated and unpatched | **Confirmed** (changed from libolm) |
| AD-003 | Railway for deployment | PaaS simplicity, team has experience, auto TLS | **Confirmed** |
| AD-004 | PostgreSQL for persistence | Relational integrity for users, devices, rooms, events | **Confirmed** |
| AD-005 | Redis for message queue + cache | Fast pub/sub for to-device delivery notifications, session temp state, rate limiting | **Confirmed** |
| AD-006 | Client-only crypto | Zero-trust backend model | **Confirmed** |
| AD-007 | Docker containerization | Reproducible builds, Railway compatibility | **Confirmed** |
| AD-008 | GitHub Actions CI/CD | Integrated with repo, GHAS available | **Confirmed** |
| AD-009 | IndexedDB + at-rest encryption | Browser-native, protects against device theft (not active browser compromise -- documented limitation) | **Confirmed** |
| AD-010 | Service Worker for notifications | Prevents metadata leak to APNs/FCM | **Confirmed** |
| AD-011 | Full federation implementation | Two homeservers with server discovery, peer authentication, and cross-server message relay. Ambitious but required by project scope. | **Confirmed** |
| AD-012 | Metadata privacy acknowledged as limitation | Server sees sender/recipient/timing. Sealed sender and mixnets are out of scope for 8 weeks. Documented honestly | **Confirmed** |
| AD-013 | Express 4 (not v5) | Express 5 is beta -- ecosystem risk. Async error handling achieved with 3-line wrapper in v4. Using Express ^4.21.0 | **Confirmed** (Phase 2) |
| AD-014 | Long-polling for sync (not WebSockets) | Works through all proxies, uses Express middleware pipeline, avoids Railway WS timeout issues | **Confirmed** (Phase 2) |
| AD-015 | Zod backend-only, plain TS interfaces shared | Avoids shipping Zod runtime to frontend. Share types, not validation | **Confirmed** (Phase 2) |
| AD-016 | Railway root = `/` (repo root) | Solves shared package access. Per-service build/start commands target subdirectories | **Confirmed** (Phase 2) |
| AD-017 | node-pg-migrate for DB migrations | Lightweight, SQL-based, no ORM magic. 8 migrations implemented (001-008). Custom `migrate.sh` runner for idempotent execution | **Confirmed** (Phase 2) |
| AD-018 | CORS middleware with explicit origins | Frontend/backend on different Railway subdomains. Explicit allowlist, no open CORS | **Confirmed** (Phase 2) |
| AD-019 | Graceful shutdown handler (SIGTERM) | Railway sends SIGTERM before kill. Drain connections, close DB/Redis cleanly. 10-second forced shutdown timeout | **Confirmed** (Phase 2) |
| AD-020 | Budget 2 weeks for vodozemac integration | v18 API is unstable, docs sparse. Start spike Week 2, expect integration through Week 3-4 | **Confirmed** (Phase 2) |
| AD-021 | npm workspaces monorepo | Root `package.json` orchestrates `shared`, `services/homeserver`, and `services/frontend` as workspaces. Shared types compiled once, consumed by both services | **Implemented** |
| AD-022 | React 19 for frontend | Latest stable React with concurrent features. CRA (react-scripts 5.0.1) as build toolchain | **Implemented** |
| AD-023 | Access + refresh token auth model | Short-lived access tokens with long-lived refresh tokens. Dedicated rate limiter for refresh endpoint. Server-side revocation on logout | **Implemented** |
| AD-024 | To-device messaging via database | Megolm room keys shared via Olm to-device messages. Stored in `to_device_messages` table for reliable delivery. Redis pub/sub for instant notification | **Implemented** |
| AD-025 | Room settings as JSONB | Flexible per-room settings (disappearing messages, privacy, password) stored as JSONB column. Avoids schema changes for new settings | **Implemented** |
| AD-026 | Client-side session timeout | Configurable inactivity timeout with auto-lock feature. Non-sensitive preferences (duration, auto-lock toggle) stored in localStorage. Sensitive state (tokens) kept in memory only | **Implemented** |
| AD-027 | Starred/archived rooms client-side | Room organization (star, archive) stored in localStorage. No server-side support needed -- purely a UI concern | **Implemented** |
