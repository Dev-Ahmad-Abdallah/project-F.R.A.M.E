# Architecture Decisions — Phase 2 (Post-Critique Revisions)

**Date:** 2026-03-18
**Context:** Forge Phase 2 — Architecture + /am-i-wrong challenge

---

## Decisions Made

### AD-013: Express 4 (not Express 5)
- **Decision:** Downgrade from Express 5 to Express 4
- **Rationale:** Express 5 is still beta-tagged on npm. Ecosystem compatibility is uncertain (helmet, cors, express-rate-limit may break silently). The async error handling benefit is achieved with a 3-line wrapper in Express 4.
- **Risk mitigated:** Ecosystem incompatibility, sparse documentation, StackOverflow answers all targeting v4

### AD-014: Long-polling (not WebSockets) for message sync
- **Decision:** Use HTTP long-polling (`GET /messages/sync?since=X&timeout=30000`) instead of WebSocket via `ws`
- **Rationale:** Long-polling works through all proxies and load balancers, uses Express's existing middleware pipeline (auth, rate limiting, validation), avoids Railway's 5-minute WebSocket timeout issue. This is how Matrix's actual sync protocol works.
- **Risk mitigated:** WebSocket auth bypass, Railway proxy timeouts, middleware duplication

### AD-015: Zod backend-only, plain TypeScript interfaces shared
- **Decision:** Use Zod for request validation on the backend only. Share plain TypeScript interfaces (not Zod schemas) between frontend and backend.
- **Rationale:** Avoids shipping Zod's 13KB runtime to the frontend bundle. Frontend trusts its own backend's response shape. Shared types are compile-time only, zero runtime cost.
- **Risk mitigated:** Frontend bundle bloat, unnecessary runtime validation

### AD-016: Railway root directory set to `/` (repo root)
- **Decision:** All Railway services use the repo root as their root directory, with per-service build/start commands
- **Rationale:** Solves the shared package access problem. When root is set to a subdirectory, the Docker build context cannot access `shared/` or sibling directories. Setting root to `/` gives full repo access.
- **Implementation:**
  - Homeserver A: `buildCommand = "cd backend && npm run build"`, `startCommand = "cd backend && node dist/server.js"`
  - Homeserver B: Same build/start commands, different env vars
  - Frontend: `buildCommand = "cd frontend && npm run build"`, `startCommand = "cd frontend && npx serve -s build"`

### AD-017: node-pg-migrate for database migrations
- **Decision:** Use `node-pg-migrate` for schema migrations
- **Rationale:** Lightweight, SQL-based (not an ORM), supports up/down migrations, integrates with `pg` connection pool. Team writes raw SQL which aligns with the security analysis (no ORM magic hiding queries).

### AD-018: CORS middleware with explicit origins
- **Decision:** Add `cors` middleware configured with explicit Railway domain allowlist
- **Rationale:** Frontend and backend are on different Railway subdomains. Without CORS, all API calls would be blocked by browser preflight. Explicit origin list prevents open CORS.

### AD-019: Graceful shutdown handler
- **Decision:** Add SIGTERM handler with connection draining
- **Rationale:** Railway sends SIGTERM before killing containers. Without graceful shutdown, active database transactions are abandoned, long-poll connections dropped without notice, and Redis subscriptions leak.

### AD-020: Budget 2 weeks for matrix-sdk-crypto-wasm integration
- **Decision:** Start vodozemac spike in Week 2, expect integration through Week 3-4
- **Rationale:** v18 API is unstable (18 major versions = 18 breaking changes). Documentation outside Element's codebase is sparse. WASM loading, OlmMachine initialization, and first encrypt/decrypt round-trip will take longer than expected.

---

## Revised Tech Stack

### Backend
| Package | Version | Purpose |
|---------|---------|---------|
| `express` | `4.x` | HTTP framework (not v5 — beta risk) |
| `pg` | `8.20` | PostgreSQL client with connection pooling |
| `ioredis` | `5.10` | Redis client for pub/sub + cache |
| `jsonwebtoken` | `9.0.3` | JWT creation and verification |
| `bcrypt` | `6.0.0` | Password hashing (salt rounds 12) |
| `helmet` | `8.1.0` | Security headers (13 headers) |
| `cors` | `2.x` | CORS middleware |
| `express-rate-limit` | `7.x` | Rate limiting middleware |
| `zod` | `3.x` | Request validation (backend only) |
| `node-pg-migrate` | `7.x` | Database migrations |
| `typescript` | `5.x` | Type safety |

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | `19` | UI framework |
| `react-dom` | `19` | React DOM renderer |
| `typescript` | `5.x` | Type safety |
| `@matrix-org/matrix-sdk-crypto-wasm` | `18.0.0` | vodozemac E2EE (Olm/Megolm) |
| `dompurify` | `3.x` | XSS sanitization |
| `idb` | `8.x` | IndexedDB wrapper |
| `qrcode.react` | `4.x` | QR code generation for device linking |

### Shared (TypeScript interfaces only — no runtime code)
| File | Purpose |
|------|---------|
| `shared/types/api.ts` | API request/response interfaces |
| `shared/types/events.ts` | Encrypted event envelope types |
| `shared/types/keys.ts` | Key bundle, Merkle proof types |
| `shared/types/devices.ts` | Device registration types |
| `shared/types/federation.ts` | Federation event types |

---

## Revised Railway Configuration

### All services use repo root as Railway root directory

**Homeserver A:**
- Root Directory: `/`
- Build Command: `cd backend && npm ci && npm run build`
- Start Command: `cd backend && node dist/server.js`
- Watch Paths: `backend/**`, `shared/**`

**Homeserver B:**
- Root Directory: `/`
- Build Command: `cd backend && npm ci && npm run build`
- Start Command: `cd backend && node dist/server.js`
- Watch Paths: `backend/**`, `shared/**`
- (Same code, different env vars)

**Frontend:**
- Root Directory: `/`
- Build Command: `cd frontend && npm ci && npm run build`
- Start Command: `cd frontend && npx serve -s build -l $PORT`
- Watch Paths: `frontend/**`, `shared/**`
