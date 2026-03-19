# Contributing to Project F.R.A.M.E.

Thank you for your interest in contributing to F.R.A.M.E. This guide covers the development environment setup, code style expectations, pull request process, and testing requirements.

---

## Development Environment Setup

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ LTS | `brew install node` or [nodejs.org](https://nodejs.org) |
| npm | 10+ | Bundled with Node.js |
| Docker | 24+ | `brew install --cask docker` or [docker.com](https://www.docker.com) |
| Docker Compose | v2+ | Included with Docker Desktop |
| Git | 2.40+ | `brew install git` |

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/your-org/project-frame.git
cd project-frame

# 2. Install all workspace dependencies
npm install

# 3. Copy environment files
cp services/homeserver/.env.example services/homeserver/.env
cp services/frontend/.env.example services/frontend/.env

# 4. Start backing services (PostgreSQL + Redis)
docker-compose up -d postgres-a redis-a

# 5. Build shared types (required before homeserver or frontend)
npm run build:shared

# 6. Run database migrations
cd services/homeserver && npm run migrate && cd ../..

# 7. Start development servers
npm run dev:homeserver   # http://localhost:3000
npm run dev:frontend     # http://localhost:5173
```

### Full Docker Development

To run everything in containers (including both federated homeservers):

```bash
docker-compose up -d
```

This starts: homeserver-a (port 3000), homeserver-b (port 3001), frontend (port 3002), two PostgreSQL instances, and two Redis instances.

### Useful npm Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build shared + homeserver + frontend |
| `npm run build:shared` | Build shared types only |
| `npm run dev:homeserver` | Start homeserver with tsx watch |
| `npm run dev:frontend` | Start React dev server |
| `npm test` | Run all tests (homeserver + frontend) |
| `npm run test:homeserver` | Run homeserver tests only |
| `npm run test:frontend` | Run frontend tests only |
| `npm run check` | TypeScript type-check all workspaces |
| `npm run docker:up` | Start Docker services |
| `npm run docker:down` | Stop Docker services |

---

## Project Structure

The project uses npm workspaces with three packages:

- **`shared/`** (`@frame/shared`) -- TypeScript interfaces only. No runtime code. Both homeserver and frontend import these at compile time.
- **`services/homeserver/`** (`@frame/homeserver`) -- Express.js backend API with PostgreSQL and Redis.
- **`services/frontend/`** (`@frame/frontend`) -- React 19 client with vodozemac WASM encryption.

When adding shared types, edit files in `shared/types/` and re-export from `shared/types/index.ts`. Then rebuild with `npm run build:shared`.

---

## Code Style Guidelines

### TypeScript

- **Strict mode** is enabled in all `tsconfig.json` files.
- Use explicit return types on exported functions.
- Prefer `interface` over `type` for object shapes.
- Use `unknown` instead of `any`. If you must use `any`, add a comment explaining why.
- Import shared types with `import type { ... }` to ensure zero runtime cost.

### Backend Conventions

- **Route files** (`src/routes/`) define HTTP endpoints and delegate to service functions. Keep route handlers thin.
- **Service files** (`src/services/`) contain business logic. No `req`/`res` objects in service code.
- **Query files** (`src/db/queries/`) contain parameterized SQL. Never concatenate user input into SQL strings.
- **Validation** uses Zod schemas defined in `src/middleware/validation.ts`. Every endpoint that accepts a body or query params must validate through Zod.
- **Error handling** uses the `asyncHandler` wrapper and `ApiError` class from `src/middleware/errorHandler.ts`. Never let raw exceptions leak to the client.
- **Rate limiting** is applied per endpoint category. Use the appropriate limiter from `src/middleware/rateLimit.ts`.

### Frontend Conventions

- All message content must pass through DOMPurify before rendering. Never use `innerHTML` or `dangerouslySetInnerHTML`.
- JWT tokens are held in memory only -- never in `localStorage` or cookies.
- Crypto operations run through the vodozemac OlmMachine. Do not implement custom crypto.
- Use the `idb` library for IndexedDB access. Raw IndexedDB API calls are error-prone.

### Naming

- Files: `camelCase.ts` for source, `kebab-case.sql` for migrations.
- Variables and functions: `camelCase`.
- Types and interfaces: `PascalCase`.
- Database columns: `snake_case`.
- API error codes: `M_UPPER_SNAKE_CASE` (following Matrix convention).

### Commits

- Write commit messages in the imperative mood: "Add key transparency endpoint" not "Added key transparency endpoint."
- Keep the first line under 72 characters.
- Reference issue numbers when applicable.

---

## Pull Request Process

### Before Submitting

1. **Run the type checker** to catch compile errors:
   ```bash
   npm run check
   ```

2. **Run all tests** and ensure they pass:
   ```bash
   npm test
   ```

3. **Build the project** to verify nothing is broken:
   ```bash
   npm run build
   ```

4. **Check for secrets** -- never commit `.env` files, credentials, private keys, or JWT secrets. The `.gitignore` should catch most of these, but double-check your diff.

### Submitting a PR

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in small, focused commits.

3. Push your branch and open a pull request against `main`.

4. In the PR description, include:
   - A summary of what changed and why.
   - Any new environment variables or migration files added.
   - How to test the changes.

### Review Criteria

- All CI checks must pass (lint, typecheck, tests).
- At least one team member must review and approve.
- Security-sensitive changes (auth, crypto, key handling, federation) require review from the relevant pillar owner.
- New endpoints must include Zod validation, rate limiting, and auth middleware.
- New database schema changes must include a numbered migration file in `services/homeserver/migrations/`.

---

## Testing Requirements

### Backend Tests

Backend tests use Jest with `supertest` for HTTP endpoint testing. Tests live in `services/homeserver/tests/`.

```bash
# Run all homeserver tests
npm run test:homeserver

# Run a specific test file
cd services/homeserver && npx jest tests/routes/auth.test.ts
```

**What to test:**

- Route handlers: valid requests, invalid payloads (Zod rejection), auth enforcement, rate limiting.
- Service functions: business logic, edge cases, error conditions.
- Database queries: ensure parameterized queries return expected shapes.

### Frontend Tests

Frontend tests use Jest via react-scripts.

```bash
npm run test:frontend
```

### Writing New Tests

- Place test files adjacent to the code they test or in the `tests/` directory mirroring the source structure.
- Name test files `*.test.ts` or `*.test.tsx`.
- Mock external dependencies (database, Redis, network) rather than requiring live services.
- For E2EE-related tests, mock the OlmMachine interface -- do not require WASM initialization in unit tests.

---

## Database Migrations

When changing the database schema:

1. Create a new SQL file in `services/homeserver/migrations/` with the next sequence number:
   ```
   010_your-migration-name.sql
   ```

2. Write idempotent SQL (use `IF NOT EXISTS`, `ON CONFLICT`, etc. where appropriate).

3. Run the migration locally:
   ```bash
   cd services/homeserver && npm run migrate
   ```

4. Include the migration file in your PR. Never modify existing migration files that have already been deployed.

---

## Security Considerations

This is a security-focused project. When contributing, keep in mind:

- **Never log sensitive data**: no passwords, keys, tokens, or message content in console output.
- **Validate all input**: every endpoint must use Zod validation. Never trust client data.
- **Parameterize all SQL**: use `$1, $2, ...` placeholders. String concatenation in SQL is a security bug.
- **Respect trust boundaries**: the backend never decrypts message content. If you find yourself accessing plaintext on the server, stop and reconsider the design.
- **Error responses must not leak internals**: use `ApiError` with appropriate codes. Never send stack traces or raw database errors to clients.
- **Rate limit new endpoints**: choose the appropriate limiter based on sensitivity (auth endpoints get stricter limits).

---

## Getting Help

- Check existing docs in the `docs/` directory for architecture context.
- Review `docs/API.md` for the full API reference.
- Look at `docs/architecture-decisions-phase2.md` for rationale behind key technical decisions.
- Ask questions in the project's communication channel before making large architectural changes.
