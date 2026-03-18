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
| **Ahmed Ali Abdallah** (234742) | Backend & DB Security | Homeserver, APIs, PostgreSQL, Redis, Federation, Key Distribution |
| **Mohamed Hussain** (235697) | Frontend / API Security | Client app, Crypto layer, UI, Local storage, Notifications |
| **Hossam Elsayed** (235174) | DevOps / Infrastructure | CI/CD, Docker, Railway, Secrets, Monitoring, TLS |

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend** | Node.js + Express.js | Federated homeserver, REST APIs |
| **Backend** | PostgreSQL | Users, devices, rooms, encrypted events |
| **Backend** | Redis | Message queue (store-and-forward), session temp storage, rate limiting |
| **Backend** | JWT / OAuth2 | Authentication & authorization |
| **Backend** | Merkle Tree Logs | Key transparency / consistency proofs |
| **Frontend** | TypeScript / React | Client application & UI |
| **Frontend** | vodozemac (WASM) | Olm (1:1) + Megolm (group) E2EE via `matrix-sdk-crypto-wasm` |
| **Frontend** | Web Crypto API | Key generation, derivation, hashing |
| **Frontend** | IndexedDB | Encrypted local storage |
| **Frontend** | Service Workers | Secure push notification handling |
| **Frontend** | DOMPurify | XSS prevention |
| **DevOps** | GitHub + GitHub Actions | Version control + CI/CD |
| **DevOps** | GitHub Advanced Security | SAST, secret detection, dependency scanning |
| **DevOps** | Docker | Containerization |
| **DevOps** | Railway | PaaS deployment |

---

## Architecture Critique

**[Architecture Critique — Round 1](./architecture-critique.md)** — Initial devil's advocate analysis on the original architecture.
**[Architecture Decisions — Phase 2](./architecture-decisions-phase2.md)** — Revised decisions after second `/am-i-wrong` critique (Express 4, long-polling, Railway root config, migrations, CORS).
**[Setup Requirements](./setup-requirements.md)** — External dependencies, API keys (none needed), auto-handled features, environment variables, first-time setup checklist.
**[Project Structure](./project-structure.md)** — Service directory layout, Railway service mapping, shared types strategy, why homeservers share one codebase.
**[ADR-001: Backend Framework](./adr/ADR-001-backend-framework.md)** — Django vs Express.js decision. Express (TypeScript) chosen for workload fit, language unity, and timeline.
**[Railway Service Map](./infrastructure/railway-service-map.md)** — Every Railway service mapped to its config, domain, env vars, and connections.

---

## Documentation Navigation

### Frontend (Mohamed)
- **[Frontend Overview](./frontend/overview.md)** — Central navigation, concerns, architecture decisions
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
- **[Backend Overview](./backend/overview.md)** — Central navigation, concerns, architecture decisions
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
- **[Deployment Overview](./deployment/overview.md)** — Central navigation, concerns, architecture decisions
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

## Key Source Files (Planned Structure)

```
src/
├── api/
│   ├── client.ts              # Central fetch wrapper (JWT, HTTPS enforcement)
│   ├── authAPI.ts             # Login, register, logout
│   ├── keysAPI.ts             # Key upload, fetch, transparency proofs
│   ├── messagesAPI.ts         # Send ciphertext, sync messages
│   └── devicesAPI.ts          # Device registration, device list
├── crypto/
│   ├── keyManager.ts          # Key generation, storage, rotation
│   ├── olmSession.ts          # Olm 1:1 session management
│   ├── megolmSession.ts       # Megolm group session management
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
│   ├── ChatWindow.tsx         # Main chat UI with encryption indicator
│   ├── AuthFlow.tsx           # Login/register flow
│   ├── DeviceList.tsx         # Linked devices settings view
│   └── VerificationBadge.tsx  # Contact verification status
├── service-worker.ts          # Push interception + local decryption
└── notifications.ts           # Notification display logic
```

---

## API Contract (Frontend <-> Backend)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/register` | POST | Register user + upload initial public keys |
| `/auth/login` | POST | Authenticate, receive JWT |
| `/keys/upload` | POST | Upload replenishment one-time prekeys |
| `/keys/:userId` | GET | Fetch contact's public key bundle |
| `/keys/transparency/:userId` | GET | Fetch Merkle proof for key verification |
| `/messages/send` | POST | Send encrypted message payload |
| `/messages/sync` | GET | Fetch queued messages since last sync |
| `/devices/register` | POST | Register new device public key |
| `/devices/:userId` | GET | List all known devices for a user |

---

## Timeline (8 Weeks)

| Week | Phase | Key Milestone |
|------|-------|--------------|
| 1 | Planning & Setup | Architecture locked, repo ready, API contracts defined |
| 2 | Core Skeletons | Auth working, client calls APIs, basic chat UI |
| 3 | E2EE Lifecycle | Encrypted send/receive on same server |
| 4 | Federation | Cross-server delivery working in staging |
| 5 | Verification | Key publishing, transparency log, client proofs |
| 6 | Multi-Device | Device fan-out, linking flow, hardening |
| 7 | Testing | Security test cases, demo script |
| 8 | Final Delivery | Stable demo, final report |

---

## Threat Model Summary

| Threat | Layer | Defense |
|--------|-------|---------|
| MitM key substitution | Frontend + Backend | Key Transparency Merkle Log + fingerprint verification |
| XSS via malicious messages | Frontend | DOMPurify sanitization |
| Metadata leak via push | Frontend | Opaque push + Service Worker local decrypt |
| Fake device injection | Frontend | QR-based device authentication |
| Session/ratchet state corruption | Frontend | Per-device isolated Olm sessions in IndexedDB |
| Credential theft | Frontend + DevOps | JWT in memory only, HTTPS enforced, no localStorage secrets |
| Clone attack via session state | Backend | Formal session management, device list verification |
| Communication pattern analysis | Backend | Minimal metadata retention, no content logging. **Known limitation**: server still sees sender/recipient/timing metadata. Full metadata protection (sealed sender, mixnets) is out of scope. |
| CI/CD pipeline compromise | DevOps | Branch protection, GHAS scanning, least-privilege workflows |
| Secret leakage | DevOps | GitHub Secrets + Railway config store, no hardcoded secrets |
| Infrastructure attack | DevOps | Docker isolation, TLS everywhere, rate limiting |

---

## Architectural Decisions Log

| Decision | Choice | Rationale | Status |
|----------|--------|-----------|--------|
| AD-001 | Express.js (TypeScript) over Django | Backend is an untrusted relay, not CRUD. TS end-to-end eliminates type sync. Node designed for I/O relay. See [ADR-001](./adr/ADR-001-backend-framework.md) | **Confirmed** (formalized) |
| AD-002 | vodozemac (WASM) for E2EE | Maintained, audited Rust-to-WASM; libolm is deprecated and unpatched | **Confirmed** (changed from libolm) |
| AD-003 | Railway for deployment | PaaS simplicity, team has experience, auto TLS | **Confirmed** |
| AD-004 | PostgreSQL for persistence | Relational integrity for users, devices, rooms, events | **Confirmed** |
| AD-005 | Redis for message queue + cache | Fast pub/sub for delivery notifications, session temp state, rate limiting | **Confirmed** |
| AD-006 | Client-only crypto | Zero-trust backend model | **Confirmed** |
| AD-007 | Docker containerization | Reproducible builds, Railway compatibility | **Confirmed** |
| AD-008 | GitHub Actions CI/CD | Integrated with repo, GHAS available | **Confirmed** |
| AD-009 | IndexedDB + at-rest encryption | Browser-native, protects against device theft (not active browser compromise — documented limitation) | **Confirmed** |
| AD-010 | Service Worker for notifications | Prevents metadata leak to APNs/FCM | **Confirmed** |
| AD-011 | Full federation implementation | Two homeservers with server discovery, peer authentication, and cross-server message relay. Ambitious but required by project scope. | **Confirmed** |
| AD-012 | Metadata privacy acknowledged as limitation | Server sees sender/recipient/timing. Sealed sender and mixnets are out of scope for 8 weeks. Documented honestly | **Confirmed** |
| AD-013 | Express 4 (not v5) | Express 5 is beta — ecosystem risk. Async error handling achieved with 3-line wrapper in v4 | **Confirmed** (Phase 2) |
| AD-014 | Long-polling for sync (not WebSockets) | Works through all proxies, uses Express middleware pipeline, avoids Railway WS timeout issues | **Confirmed** (Phase 2) |
| AD-015 | Zod backend-only, plain TS interfaces shared | Avoids shipping Zod runtime to frontend. Share types, not validation | **Confirmed** (Phase 2) |
| AD-016 | Railway root = `/` (repo root) | Solves shared package access. Per-service build/start commands target subdirectories | **Confirmed** (Phase 2) |
| AD-017 | node-pg-migrate for DB migrations | Lightweight, SQL-based, no ORM magic | **Confirmed** (Phase 2) |
| AD-018 | CORS middleware with explicit origins | Frontend/backend on different Railway subdomains. Explicit allowlist, no open CORS | **Confirmed** (Phase 2) |
| AD-019 | Graceful shutdown handler (SIGTERM) | Railway sends SIGTERM before kill. Drain connections, close DB/Redis cleanly | **Confirmed** (Phase 2) |
| AD-020 | Budget 2 weeks for vodozemac integration | v18 API is unstable, docs sparse. Start spike Week 2, expect integration through Week 3-4 | **Confirmed** (Phase 2) |
