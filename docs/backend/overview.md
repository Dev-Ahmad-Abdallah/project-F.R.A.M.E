# Backend Architecture Overview

**Owner:** Ahmed Ali Abdallah (234742)
**Role:** Backend & Database Security
**Pillar:** Server-Side (Untrusted Relay)

---

## Architectural Position

The backend consists of **federated homeservers** that act as untrusted relays. They transport encrypted blobs, manage user accounts, handle device registration, and coordinate cross-server message delivery. The backend **never decrypts message content** — all cryptographic operations happen on the client.

**The backend's job: reliable, authenticated delivery of encrypted payloads without ever reading them.**

---

## Component Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      HOMESERVER (Node.js + Express)            │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   API Gateway Layer                       │  │
│  │  Auth │ Keys │ Messages │ Devices │ Federation │ Health   │  │
│  │  Rate Limiting │ JWT Validation │ Request Validation      │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                              │                                  │
│  ┌───────────┬───────────────┼───────────────┬──────────────┐  │
│  │           │               │               │              │  │
│  ▼           ▼               ▼               ▼              ▼  │
│ ┌─────────┐┌─────────────┐┌─────────────┐┌───────────┐┌─────┐ │
│ │ Auth    ││ Key Dist.   ││ Message     ││ Device    ││Fed. │ │
│ │ Service ││ & Transp.   ││ Queue       ││ Registry  ││ Svc │ │
│ │ (JWT)   ││ (Merkle)    ││(Store+Fwd)  ││           ││     │ │
│ └─────────┘└─────────────┘└─────────────┘└───────────┘└─────┘ │
│       │           │              │              │         │    │
│       └───────────┴──────────────┴──────────────┴─────────┘    │
│                              │                                  │
│                    ┌─────────┴─────────┐                       │
│                    │   Data Layer       │                       │
│                    │  PostgreSQL + Redis│                       │
│                    └───────────────────┘                        │
└────────────────────────────────────────────────────────────────┘
         │                                        │
         │ Federation API (TLS + Server Auth)      │
         ▼                                        ▼
  ┌──────────────┐                        ┌──────────────┐
  │ Homeserver B │                        │ Homeserver C │
  └──────────────┘                        └──────────────┘
```

---

## Tech Stack

| Technology | Purpose | Why This Choice |
|-----------|---------|-----------------|
| Node.js + Express.js | Application server | Async I/O for message relay, team familiarity |
| PostgreSQL | Persistent storage | Relational integrity for users, devices, rooms, events |
| Redis | Message queue + temp cache | Fast pub/sub for delivery notifications, session temp state |
| JWT / OAuth2 | Authentication | Stateless auth, works across federated nodes |
| Merkle Tree | Key transparency logs | Append-only proof of key consistency |
| Express Middleware | Rate limiting | Prevent API abuse and flood attacks |
| TLS (HTTPS) | Transport security | All traffic encrypted in transit |

---

## Core Components

### 1. API Gateway / Application Server
- Exposes REST endpoints for client operations (auth, messaging, keys, devices)
- JWT validation on all authenticated routes
- Rate limiting per user/IP
- Request validation and sanitization
- Error responses never leak internal state

### 2. Message Queue (Store-and-Forward)
- Redis-backed queue for pending message delivery
- Fast pub/sub for real-time delivery notifications
- Messages stored as encrypted blobs — server never reads content
- Sequenced identifiers for client sync (incremental sync support)
- Delivery state tracking per device
- Retry logic for failed deliveries

### 3. Federation Service
- Server-to-server API for cross-homeserver message relay
- Peer authentication (TLS + server identity verification)
- Federation trust rules and peer allowlisting
- Encrypted event relay without content inspection
- Backfill support for missed events

### 4. Key Distribution & Transparency Layer
- Stores and serves user public key bundles (identity key + signed prekey + one-time prekeys)
- Maintains Merkle Tree append-only log of all published keys
- Provides cryptographic proofs (Merkle proofs) that clients verify
- One-time prekey replenishment endpoint
- **Server publishes keys but clients verify them — server cannot silently substitute**

### 5. Device & Session Registry
- Tracks registered devices per user
- Stores device public keys (never private keys)
- Fan-out: delivers encrypted events to all user devices
- Device list exposed to clients for verification

---

## Database Schema (Conceptual)

```
users
├── user_id (PK)
├── username
├── password_hash
├── created_at
└── homeserver_id

devices
├── device_id (PK)
├── user_id (FK → users)
├── device_public_key
├── display_name
├── created_at
└── last_seen

rooms
├── room_id (PK)
├── room_type (direct | group)
└── created_at

room_members
├── room_id (FK → rooms)
├── user_id (FK → users)
└── joined_at

events (encrypted messages)
├── event_id (PK)
├── room_id (FK → rooms)
├── sender_device_id (FK → devices)
├── ciphertext (BLOB — never decrypted by server)
├── event_type
├── sequence_id
└── timestamp

key_bundles
├── user_id (FK → users)
├── device_id (FK → devices)
├── identity_key
├── signed_prekey
├── signed_prekey_signature
└── one_time_prekeys (JSON array)

key_transparency_log
├── log_id (PK)
├── user_id (FK → users)
├── public_key_hash
├── merkle_root
├── merkle_proof
└── timestamp

delivery_state
├── event_id (FK → events)
├── device_id (FK → devices)
├── status (pending | delivered | failed)
└── updated_at
```

---

## Key Concerns & Considerations

### Security Requirements
1. **Never log message content** — only metadata needed for routing
2. **Minimal metadata retention** — purge delivery state after confirmation
3. **Rate limiting on all endpoints** — especially key fetch and message send
4. **Federation peer authentication** — TLS + server identity, never trust blindly
5. **Key transparency log is append-only** — once a key is published, it cannot be silently modified

### Operational Concerns
- Redis as single instance per homeserver for both queue and cache — monitor memory carefully
- PostgreSQL connection pooling needed under concurrent load
- Federation creates server-to-server connections — peer authentication and connection management are critical
- Background workers needed for: retry delivery, attachment housekeeping, federation backfill

### Data Privacy
- Server stores encrypted blobs — never plaintext
- Minimal metadata: sender, recipient, timestamp, room — no message content
- Log sanitization: no keys, no ciphertext in application logs
- Retention policies: define max storage duration for encrypted events

---

## Feature Documentation

| Feature | Doc | Priority |
|---------|-----|----------|
| API Gateway | [api-gateway.md](./features/api-gateway.md) | Week 2 |
| Message Queue | [message-queue.md](./features/message-queue.md) | Week 3 |
| Federation Service | [federation-service.md](./features/federation-service.md) | Week 4 |
| Key Distribution | [key-distribution.md](./features/key-distribution.md) | Week 5 |
| Device/Session Management | [device-session-management.md](./features/device-session-management.md) | Week 6 |
| Authentication | [authentication.md](./features/authentication.md) | Week 2 |
| Database Schema | [database-schema.md](./features/database-schema.md) | Week 1-2 |

## Security Documentation

| Doc | Scope |
|-----|-------|
| [Backend Security Model](./security/security-model.md) | Trust boundaries, threat surface, server-side guarantees |
| [Backend Security Considerations](./security/security-considerations.md) | Implementation safeguards, attack mitigations |

---

## Dependencies

| Dependency | From | What's Needed | When |
|-----------|------|---------------|------|
| API contract agreement | Frontend (Mohamed) | Endpoint specs, payload formats | Week 1 |
| TLS certificates | DevOps (Hossam) | HTTPS on staging/production | Week 3 |
| Docker containers | DevOps (Hossam) | Backend + DB containerization | Week 2 |
| CI/CD pipeline | DevOps (Hossam) | Automated test + deploy | Week 2 |
| Federation staging | DevOps (Hossam) | Two-node deployment | Week 4 |
| Secrets management | DevOps (Hossam) | DB credentials, JWT secrets | Week 1 |
