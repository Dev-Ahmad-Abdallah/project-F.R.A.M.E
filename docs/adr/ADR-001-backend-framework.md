# ADR-001: Backend Framework Selection

**Status:** Accepted
**Date:** 2026-03-18
**Deciders:** Ahmed Ali Abdallah, Mohamed Hussain, Hossam Elsayed
**Category:** Architecture

---

## 1. Decision

**Express.js with TypeScript** is the backend framework for Project F.R.A.M.E.

---

## 2. Context

Project F.R.A.M.E. (Federated Ratcheting Architecture for Messaging Encryption) is a federated E2EE messaging system built by a 3-person university team over 8 weeks. The backend's role is precisely defined: it is an **untrusted relay** that transports encrypted blobs, manages user accounts, handles device registration, coordinates cross-server federation, and maintains a key transparency log. It **never decrypts message content**.

The frontend is React with TypeScript. The deployment target is Docker containers on Railway. The team consists of three AI majors, likely comfortable with Python, working under an aggressive 8-week timeline.

The question: should the backend be built with **Django (Python)** or **Express.js (TypeScript)**?

---

## 3. Options Considered

### Option A: Django (Python) with Django REST Framework

Django is a batteries-included Python web framework with an excellent ORM, automatic migrations, an admin panel, and built-in security middleware. Django REST Framework (DRF) provides scaffolding for API development. Django Channels adds WebSocket/async support via ASGI.

### Option B: Express.js (TypeScript)

Express is a minimal, unopinionated Node.js HTTP framework. Combined with TypeScript, it provides type safety and aligns with the React/TS frontend. Node.js was architecturally designed for high-concurrency I/O workloads.

---

## 4. Comparison

| Criterion | Django (Python) | Express.js (TypeScript) | Winner |
|-----------|----------------|------------------------|--------|
| **Workload fit** | Django excels at CRUD applications with complex data models. The ORM, admin panel, and form validation are designed for server-rendered or data-heavy apps. | Node.js was built for high-concurrency I/O relay -- the exact workload of an untrusted message relay that routes encrypted blobs without processing them. | **Express** |
| **Async / real-time** | Django Channels provides WebSocket support, but it is bolted on: requires ASGI server (Daphne/Uvicorn), a channel layer (typically Redis), and additional configuration. Django's ORM is synchronous by default; `sync_to_async` wrappers add complexity. | WebSocket and long-polling are native to Node's event loop. Libraries like `ws` and `socket.io` are first-class citizens. No architectural mismatch. | **Express** |
| **Language unity** | Python backend + TypeScript frontend = two languages, two ecosystems, two CI pipelines, two dependency managers. API type contracts must be manually synchronized. Any shared validation logic must be duplicated. | TypeScript end-to-end. Shared type definitions between frontend and backend. One language across the entire codebase. No knowledge silos on a 3-person team. | **Express** |
| **Team velocity (3 people, 8 weeks)** | Language split means context-switching overhead. Ahmed works in Python, Mohamed in TypeScript -- they cannot easily review or contribute to each other's code. | Everyone reads and writes the same language. Ahmed can help Mohamed debug an API call. Mohamed can help Ahmed write a route handler. Cross-functional contribution is frictionless. | **Express** |
| **ORM and data modeling** | Django ORM is genuinely excellent: automatic migrations, model validation, query optimization, admin panel for debugging. This is Django's strongest advantage. | TypeScript ORMs (Prisma, Drizzle, TypeORM) are mature but not as polished as Django's. Prisma comes closest with auto-migrations and type-safe queries. | **Django** |
| **Built-in security** | CSRF protection, clickjacking prevention, HSTS, SQL injection guards, XSS escaping -- all enabled by default. | Security middleware must be explicitly added: `helmet`, `cors`, `express-rate-limit`, `csurf`. More manual setup, but the modules are well-documented and widely used. | **Django** |
| **Cryptography libraries** | PyNaCl, `cryptography` library -- excellent Python ecosystem for crypto. | `tweetnacl`, `libsodium-wrappers`, Node.js built-in `crypto` module. Adequate, though Python's ecosystem is slightly richer. However, F.R.A.M.E.'s backend does NOT perform cryptographic operations -- all crypto happens on the client. | **Tie** (irrelevant for relay) |
| **API scaffolding** | DRF provides serializers, viewsets, routers, pagination, throttling. Powerful but heavy for 9 REST endpoints that relay encrypted blobs. | Express routes are lightweight. For a relay with ~9 endpoints, manual route definitions are simpler and more transparent than DRF's abstraction layers. | **Express** |
| **Redis pub/sub** | `django-redis`, `channels_redis`. Functional but adds layers of abstraction. | `ioredis` -- best-in-class Redis client for Node.js. Native pub/sub integration. Direct and performant. | **Express** |
| **Docker / deployment** | Python Docker images are larger. Django requires WSGI/ASGI server configuration (Gunicorn + Uvicorn for mixed sync/async). Slower cold starts. | `node:20-alpine` images are small (~50MB). Single runtime. Fast cold starts. Railway has first-class Node.js support. The team's Dockerfiles are already written for Node. | **Express** |
| **Structure / opinion** | Django is opinionated -- project layout, settings, URL routing are all prescribed. Less decision fatigue. Good for teams that want guardrails. | Express is unopinionated -- the team must decide on project structure, error handling patterns, and middleware composition. More freedom, more responsibility. | **Django** |
| **Python familiarity** | All three team members are AI majors. They almost certainly have deeper Python experience than TypeScript experience. | TypeScript has a learning curve if the team is Python-first. However, Mohamed (frontend) already works in TypeScript, and modern TS is approachable for Python developers. | **Django** |

**Score: Express wins 6 criteria, Django wins 3, 1 tie.**

---

## 5. Recommendation: Express.js with TypeScript

The recommendation is Express.js, and it is not close. Here is why:

### The workload is the deciding factor

F.R.A.M.E.'s backend is not a CRUD application. It does not serve HTML. It does not have complex business logic. It does not need an admin panel. It routes encrypted blobs from sender to recipient without ever reading them. This is an I/O relay -- precisely the workload Node.js was designed for. Django's greatest strengths (ORM, admin, form validation, template rendering) solve problems that do not exist in this project.

### The timeline demands language unity

Eight weeks. Three developers. With Django, Ahmed writes Python while Mohamed writes TypeScript. They cannot review each other's code effectively. They cannot share type definitions. They cannot help each other debug. API contracts must be manually synchronized -- a source of bugs that will consume hours during integration.

With Express/TypeScript, the entire team works in one language. Shared interfaces ensure the frontend and backend agree on payload shapes at compile time. When Mohamed's API client receives a malformed response, he can open Ahmed's route handler and read it directly. This cross-functional fluidity is not a nice-to-have on a 3-person team -- it is survival.

### Django's advantages are real but misaligned

Django's ORM is excellent, but Prisma provides type-safe database access with auto-migrations that integrate naturally with TypeScript. Django's built-in security middleware is valuable, but `helmet` + `cors` + `express-rate-limit` cover the same ground with a few lines of configuration. Django's structure reduces decision fatigue, but Express's simplicity means there are fewer decisions to make in the first place when the backend is a thin relay.

### The one honest concern

The team members are AI majors with likely stronger Python skills. TypeScript will have a learning curve for Ahmed and Hossam. This is a real cost. However, Mohamed already works in TypeScript daily, and modern TypeScript is syntactically familiar to Python developers (type annotations, async/await, arrow functions). The ramp-up cost is measured in days, not weeks, and is repaid many times over by eliminating the integration tax of a bilingual codebase.

---

## 6. What the Team Should Know About the Chosen Stack

### Project structure (recommended)

```
server/
  src/
    index.ts                  # Entry point
    config/                   # Environment, constants
    middleware/                # Auth, rate-limit, validation, error handling
    routes/                   # Route definitions (auth, keys, messages, devices, federation)
    services/                 # Business logic layer
    models/                   # Prisma schema + generated types
    types/                    # Shared TypeScript interfaces (importable by frontend)
    utils/                    # Helpers, logger
  prisma/
    schema.prisma             # Database schema
  tests/
  Dockerfile
  tsconfig.json
  package.json
```

### Essential packages

| Package | Purpose |
|---------|---------|
| `express` | HTTP framework |
| `typescript` + `tsx` | Language + dev runner |
| `prisma` + `@prisma/client` | Type-safe ORM with auto-migrations |
| `ioredis` | Redis client for pub/sub and message queue |
| `jsonwebtoken` + `bcrypt` | JWT auth + password hashing |
| `helmet` | Security headers (HSTS, CSP, X-Frame-Options, etc.) |
| `cors` | Cross-origin configuration |
| `express-rate-limit` | Rate limiting per IP/user |
| `zod` | Runtime request validation with TypeScript type inference |
| `ws` | WebSocket server (if needed for real-time delivery) |
| `pino` | Structured logging (never log ciphertext or keys) |
| `vitest` | Testing framework |

### Security checklist (replacing Django's built-ins)

Since Express does not provide security middleware by default, the team must explicitly configure:

1. **`helmet()`** -- sets security headers (HSTS, X-Content-Type-Options, X-Frame-Options, CSP)
2. **`cors()`** -- restrict origins to the frontend domain only
3. **`express-rate-limit`** -- rate limit all endpoints, especially `/keys/*` and `/messages/send`
4. **`zod` schemas** -- validate every request body, reject malformed input early
5. **Parameterized queries** -- Prisma handles this automatically, never use raw SQL
6. **Error responses** -- never leak stack traces or internal state in production
7. **Log sanitization** -- never log JWT tokens, ciphertext, keys, or passwords

### Shared types (the key advantage)

Create a `shared/` or `types/` directory that both frontend and backend import:

```typescript
// types/api.ts
export interface SendMessageRequest {
  roomId: string;
  ciphertext: string;       // Encrypted blob -- server never reads this
  eventType: 'olm' | 'megolm';
  deviceId: string;
}

export interface SyncResponse {
  events: EncryptedEvent[];
  nextBatch: string;
}

export interface EncryptedEvent {
  eventId: string;
  roomId: string;
  senderDeviceId: string;
  ciphertext: string;
  eventType: string;
  timestamp: number;
}
```

When Ahmed changes a response shape, Mohamed's frontend will show a compile error immediately. No manual synchronization. No runtime surprises during integration week.

### Prisma schema (maps directly to the existing database design)

```prisma
model User {
  id           String   @id @default(uuid())
  username     String   @unique
  passwordHash String
  homeserverId String
  createdAt    DateTime @default(now())
  devices      Device[]
  rooms        RoomMember[]
}

model Device {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  devicePublicKey String
  displayName     String?
  createdAt       DateTime @default(now())
  lastSeen        DateTime @default(now())
  keyBundle       KeyBundle?
}

model Event {
  eventId        String   @id @default(uuid())
  roomId         String
  room           Room     @relation(fields: [roomId], references: [id])
  senderDeviceId String
  ciphertext     String   // Encrypted blob -- NEVER decrypted by server
  eventType      String
  sequenceId     Int      @default(autoincrement())
  timestamp      DateTime @default(now())
  deliveryStates DeliveryState[]
}
```

### What NOT to worry about

- **CPU-bound crypto on Node's event loop**: The backend does not perform crypto operations. All encryption/decryption happens on the client. Node's single-threaded model is not a bottleneck for blob relay.
- **"Express is not opinionated enough"**: For a relay with 9 endpoints, there are not many opinions to have. The structure above is sufficient.
- **"Python has better crypto libraries"**: Irrelevant. The backend never touches plaintext. It stores and forwards encrypted blobs. The only crypto the backend does is JWT signing (Node's `jsonwebtoken` handles this) and password hashing (`bcrypt`, identical across both ecosystems).

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Ahmed/Hossam less familiar with TypeScript | Mohamed provides TS guidance. Modern TS syntax is intuitive for Python developers. Budget 2-3 days for ramp-up. |
| Express lacks Django's built-in guardrails | Use the security checklist above. Add `helmet`, `cors`, `rate-limit` on day one. |
| Prisma is less mature than Django ORM | Prisma handles the project's schema complexity comfortably. Auto-migrations, type-safe queries, and relation handling are all production-ready. |
| No admin panel for debugging | Use Prisma Studio (`npx prisma studio`) for database inspection during development. Structured logging with `pino` for production debugging. |

---

## 8. Decision Outcome

Express.js with TypeScript is selected because:

1. The backend is an I/O relay, not a CRUD app -- Node.js is architecturally designed for this workload.
2. TypeScript end-to-end eliminates the integration tax of a bilingual codebase on a 3-person, 8-week timeline.
3. Django's strongest features (ORM, admin, form validation) solve problems that do not exist in this project.
4. The existing project documentation, Dockerfiles, and architecture diagrams already specify Node.js + Express.

This is not a general recommendation that Express is better than Django. Django would be the stronger choice for a data-heavy CRUD application, an internal tool with an admin interface, or a team of Python specialists building a monolith. For this specific project -- an untrusted encrypted relay built by a small team on a tight timeline with a TypeScript frontend -- Express is the right tool.
