# Project Structure — Service Directory Layout

**Decision:** Each code service has its own directory under `services/`. Managed services (PostgreSQL, Redis) are Railway plugins with documentation only.

---

## Directory Tree

```
project-F.R.A.M.E/
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # Lint + test + typecheck on PR
│   │   └── security.yml              # GHAS / dependency scanning
│   └── CODEOWNERS                    # PR review routing
│
├── docs/                             # Architecture documentation (exists)
│   ├── main.md                       # System map + navigation
│   ├── architecture-critique.md      # /am-i-wrong round 1
│   ├── architecture-decisions-phase2.md  # Phase 2 revised decisions
│   ├── setup-requirements.md         # External deps, env vars, setup checklist
│   ├── project-structure.md          # THIS FILE
│   ├── adr/                          # Architecture Decision Records
│   │   └── ADR-001-backend-framework.md  # Django vs Express decision
│   ├── infrastructure/               # Managed service docs
│   │   ├── postgresql.md             # Schema, connections, backups
│   │   ├── redis.md                  # Key patterns, TTL, pub/sub channels
│   │   └── railway-service-map.md    # Service → env var → domain mapping
│   ├── frontend/                     # Frontend feature + security docs
│   ├── backend/                      # Backend feature + security docs
│   └── deployment/                   # DevOps feature + security docs
│
├── shared/                           # Shared TypeScript interfaces (NO runtime code)
│   ├── package.json                  # name: "@frame/shared"
│   ├── tsconfig.json
│   └── types/
│       ├── index.ts                  # Re-exports all types
│       ├── api.ts                    # API request/response interfaces
│       ├── events.ts                 # Encrypted event envelope types
│       ├── keys.ts                   # Key bundle, Merkle proof types
│       ├── devices.ts                # Device registration types
│       └── federation.ts             # Federation event types
│
├── services/
│   │
│   ├── homeserver/                   # Backend — BOTH Railway homeserver services point here
│   │   ├── package.json              # name: "@frame/homeserver"
│   │   ├── tsconfig.json
│   │   ├── Dockerfile                # Multi-stage: build + node:20-alpine production
│   │   ├── railway.toml              # Healthcheck, restart policy
│   │   ├── .env.example              # Documents all required env vars
│   │   ├── src/
│   │   │   ├── server.ts             # Express 4 app entry + graceful shutdown
│   │   │   ├── config.ts             # Env var parsing + validation (zod)
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts           # POST /auth/register, POST /auth/login
│   │   │   │   ├── keys.ts           # POST /keys/upload, GET /keys/:userId
│   │   │   │   ├── messages.ts       # POST /messages/send, GET /messages/sync
│   │   │   │   ├── devices.ts        # POST /devices/register, GET /devices/:userId
│   │   │   │   ├── federation.ts     # POST /federation/send, GET /.well-known
│   │   │   │   └── health.ts         # GET /health
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           # JWT verification middleware
│   │   │   │   ├── rateLimit.ts      # express-rate-limit config
│   │   │   │   ├── cors.ts           # Explicit origin allowlist
│   │   │   │   └── errorHandler.ts   # Async error wrapper + centralized handler
│   │   │   ├── services/
│   │   │   │   ├── authService.ts    # Registration, login, JWT issuance
│   │   │   │   ├── keyService.ts     # Key bundles, Merkle tree operations
│   │   │   │   ├── messageService.ts # Store-and-forward, delivery, sync
│   │   │   │   ├── deviceService.ts  # Device registry, fan-out
│   │   │   │   └── federationService.ts # Peer auth, event relay, discovery
│   │   │   ├── db/
│   │   │   │   ├── pool.ts           # pg connection pool setup
│   │   │   │   └── queries/          # Raw parameterized SQL
│   │   │   │       ├── users.ts
│   │   │   │       ├── devices.ts
│   │   │   │       ├── events.ts
│   │   │   │       ├── keys.ts
│   │   │   │       └── rooms.ts
│   │   │   └── redis/
│   │   │       ├── client.ts         # ioredis connection (commands)
│   │   │       └── pubsub.ts         # Dedicated ioredis subscriber for delivery
│   │   ├── migrations/               # node-pg-migrate SQL files
│   │   │   ├── 001_initial-schema.sql
│   │   │   ├── 002_scalability-indexes.sql
│   │   │   ├── 003_to-device-messages.sql
│   │   │   ├── 004_to-device-claimed-at.sql
│   │   │   ├── 005_room-name.sql
│   │   │   ├── 006_device-keys-json.sql
│   │   │   ├── 007_event-chain.sql
│   │   │   ├── 008_push-subscriptions.sql
│   │   │   └── 009_reactions-readreceipts-displayname.sql
│   │   └── tests/
│   │       ├── routes/
│   │       ├── services/
│   │       └── integration/
│   │
│   └── frontend/                     # React/TypeScript client app
│       ├── package.json              # name: "@frame/frontend"
│       ├── tsconfig.json
│       ├── Dockerfile                # Multi-stage: build React + serve production
│       ├── railway.toml
│       ├── .env.example
│       ├── public/
│       │   └── index.html
│       └── src/
│           ├── index.tsx
│           ├── App.tsx
│           ├── api/
│           │   ├── client.ts         # Fetch wrapper (JWT, HTTPS enforcement)
│           │   ├── authAPI.ts
│           │   ├── keysAPI.ts
│           │   ├── messagesAPI.ts
│           │   └── devicesAPI.ts
│           ├── crypto/
│           │   ├── olmMachine.ts      # vodozemac OlmMachine lifecycle
│           │   ├── keyManager.ts      # Key generation, upload, fetch
│           │   ├── sessionManager.ts  # Olm/Megolm session coordination
│           │   └── cryptoUtils.ts     # Web Crypto API wrappers
│           ├── verification/
│           │   ├── keyTransparency.ts
│           │   ├── fingerprintUI.tsx
│           │   └── keyChangeAlert.tsx
│           ├── storage/
│           │   └── secureStorage.ts   # IndexedDB wrapper with at-rest encryption
│           ├── devices/
│           │   ├── deviceManager.ts
│           │   ├── deviceLinking.tsx
│           │   └── deviceAlert.tsx
│           ├── components/
│           │   ├── AuthFlow.tsx
│           │   ├── ChatWindow.tsx
│           │   ├── DeviceList.tsx
│           │   ├── NewChatDialog.tsx
│           │   ├── ProfileSettings.tsx
│           │   ├── RoomList.tsx
│           │   ├── RoomSettings.tsx
│           │   ├── SessionSettings.tsx
│           │   ├── Skeleton.tsx
│           │   ├── Toast.tsx
│           │   └── VerificationBadge.tsx
│           ├── pages/
│           │   ├── LandingPage.tsx
│           │   └── SignInPage.tsx
│           ├── hooks/
│           │   ├── useAppInit.ts
│           │   ├── useInstallPrompt.ts
│           │   ├── useIsMobile.ts
│           │   ├── useNotifications.ts
│           │   ├── useSessionTimeout.ts
│           │   └── useToast.ts
│           ├── service-worker.ts
│           └── notifications.ts
│
├── docker-compose.yml                # Local dev: homeserver + PG + Redis
├── .gitignore
├── .gitattributes                    # Exists
├── package.json                      # Root workspace config (npm workspaces)
└── README.md                         # Exists
```

---

## Railway Service Mapping

| Railway Service | Type | Root Dir (Dashboard) | Points To | Watch Paths |
|----------------|------|---------------------|-----------|-------------|
| `frame-homeserver-a` | Web | `/` | `services/homeserver/` | `services/homeserver/**`, `shared/**` |
| `frame-homeserver-b` | Web | `/` | `services/homeserver/` | `services/homeserver/**`, `shared/**` |
| `frame-frontend` | Web | `/` | `services/frontend/` | `services/frontend/**`, `shared/**` |
| `PostgreSQL A` | Managed DB | N/A | Railway plugin | N/A |
| `PostgreSQL B` | Managed DB | N/A | Railway plugin | N/A |
| `Redis A` | Managed DB | N/A | Railway plugin | N/A |
| `Redis B` | Managed DB | N/A | Railway plugin | N/A |

### Homeserver A vs B — Environment Variables Only

| Env Var | homeserver-a | homeserver-b |
|---------|-------------|-------------|
| `HOMESERVER_DOMAIN` | `frame-a.up.railway.app` | `frame-b.up.railway.app` |
| `DATABASE_URL` | → PostgreSQL A | → PostgreSQL B |
| `REDIS_URL` | → Redis A | → Redis B |
| `FEDERATION_PEERS` | `frame-b.up.railway.app` | `frame-a.up.railway.app` |
| `JWT_SECRET` | Unique to A | Unique to B |
| `FEDERATION_SIGNING_KEY` | Unique Ed25519 key | Unique Ed25519 key |

Same code, same Dockerfile, same railway.toml. 100% differentiated by env vars.

---

## Shared Types (npm Workspaces)

Root `package.json`:
```json
{
  "name": "project-frame",
  "private": true,
  "workspaces": [
    "shared",
    "services/homeserver",
    "services/frontend"
  ]
}
```

Services import shared types at compile-time only:
```typescript
import type { EncryptedEvent } from '@frame/shared/events';
```

No runtime cost. No Zod in the frontend bundle. Just TypeScript interfaces.

---

## Why Not Separate Directories for Homeserver A and B?

Both homeservers run **identical code** — federation means every node implements the same protocol. Duplicating the code would mean:
- Every bug fix applied twice
- Every schema change applied twice
- Every dependency bump applied twice
- Guaranteed drift in an 8-week timeline with 3 people

The `/am-i-wrong` analysis unanimously recommended a single `services/homeserver/` directory.
