# Setup Requirements & External Dependencies

**Project F.R.A.M.E.** -- What you need before you can build and run.

---

## API Keys & External Accounts

| Service | API Key Required? | What You Need | Cost |
|---------|------------------|---------------|------|
| **Railway** | No API key -- account login | Railway account (GitHub OAuth) | Free tier / Hobby ($5/mo) |
| **GitHub** | No -- GITHUB_TOKEN auto-injected in Actions | GitHub account with repo access | Free for public repos |
| **GHAS** (GitHub Advanced Security) | No | Enabled in repo settings | Free for public repos |
| **matrix-sdk-crypto-wasm** | No | npm install | Free (MIT license) |
| **PostgreSQL** | No | Railway managed or local Docker | Included in Railway |
| **Redis** | No | Railway managed or local Docker | Included in Railway |
| **Firebase / APNs** | **NOT USED** | N/A -- push is opaque wake-up via our own server | N/A |
| **Any external auth provider** | **NOT USED** | N/A -- JWT issued by our own backend | N/A |

**No external API keys are required.** The entire system is self-hosted. Zero third-party service dependencies for core functionality.

---

## Local Development Requirements

| Requirement | Version | Install Command |
|-------------|---------|----------------|
| **Node.js** | 20+ LTS | `brew install node` or [nodejs.org](https://nodejs.org) |
| **npm** | 10+ | Bundled with Node.js |
| **Docker** | 24+ | `brew install --cask docker` or [docker.com](https://www.docker.com) |
| **Docker Compose** | v2+ | Included with Docker Desktop |
| **Git** | 2.40+ | `brew install git` |
| **Railway CLI** (optional) | Latest | `npm install -g @railway/cli` |

### Optional but Recommended

| Tool | Purpose |
|------|---------|
| **VS Code** | Primary IDE |
| **Postman / Insomnia** | API testing |
| **pgAdmin / TablePlus** | Database inspection |
| **Redis Insight** | Redis inspection |

---

## Auto-Handled by Tools (No Manual Setup)

### Railway Auto-Provisions
- **TLS/HTTPS certificates** -- automatic via Let's Encrypt on all Railway domains
- **DNS** -- `*.up.railway.app` domains assigned automatically
- **`DATABASE_URL`** -- auto-injected when PostgreSQL service is linked
- **`REDIS_URL`** -- auto-injected when Redis service is linked
- **`PORT`** -- auto-set by Railway for each service
- **Health monitoring** -- Railway monitors `/health` endpoint and auto-restarts on failure
- **Log collection** -- stdout/stderr collected automatically, viewable in dashboard
- **Rollback** -- one-click rollback to previous deployment

### GitHub Auto-Provides
- **`GITHUB_TOKEN`** -- auto-injected into GitHub Actions workflows
- **CodeQL scanning** -- auto-runs when GHAS is enabled
- **Secret scanning** -- auto-runs on all pushes
- **Dependency alerts** -- auto-generated for known vulnerabilities
- **Branch protection** -- configured once in repo settings, enforced automatically

### npm Packages That Auto-Handle Security
- **`helmet`** -- sets security headers with configured CSP: `app.use(helmet({ contentSecurityPolicy: { ... } }))`
- **`bcrypt`** -- generates salts automatically: `await bcrypt.hash(password, 12)`
- **`cors`** -- handles CORS preflight automatically for configured origins
- **`express-rate-limit`** -- tracks request counts automatically per IP, with dedicated limiters per endpoint type

### matrix-sdk-crypto-wasm Auto-Handles
- **Key generation** -- identity keys created automatically on `OlmMachine.initialize()`
- **One-time prekey generation** -- auto-generated, surfaced via `outgoingRequests()`
- **Olm session creation** -- automatic when claiming keys
- **Megolm session rotation** -- internal to the state machine
- **Ratchet advancement** -- automatic on each encrypt/decrypt
- **Forward secrecy** -- guaranteed by the Double Ratchet implementation
- **Post-compromise security** -- guaranteed by ratchet healing
- **Persistent crypto state** -- OlmMachine uses IndexedDB-backed store (unique per user/device)

---

## Environment Variables (Per Service)

### Homeserver A & B (Backend)

| Variable | Source | Example | Notes |
|----------|--------|---------|-------|
| `DATABASE_URL` | Railway auto-injected | `postgresql://...` | |
| `REDIS_URL` | Railway auto-injected | `redis://...` | |
| `PORT` | Railway auto-set | `3000` | |
| `NODE_ENV` | Manual set | `production` | `development`, `production`, or `test` |
| `JWT_SECRET` | Manual set (Railway dashboard) | Random 64-char string | Minimum 32 characters (Zod-validated) |
| `BCRYPT_SALT_ROUNDS` | Manual set or default | `12` | Range: 10-15 (default: 12) |
| `HOMESERVER_DOMAIN` | Manual set | `frame-a.up.railway.app` | |
| `FEDERATION_SIGNING_KEY` | Manual set | Ed25519 private key | Used for signing federation events |
| `FEDERATION_PEERS` | Manual set | `frame-b.up.railway.app` | Comma-separated list of trusted peer domains |
| `CORS_ORIGINS` | Manual set | `https://frame.up.railway.app` | Comma-separated list of allowed origins |
| `DB_SSL_REJECT_UNAUTHORIZED` | Manual set (optional) | `true` | Default: `true`. Set to `false` for Railway PostgreSQL if needed |

### Frontend

| Variable | Source | Example | Notes |
|----------|--------|---------|-------|
| `REACT_APP_HOMESERVER_URL` | Manual set (build-time) | `https://frame-a.up.railway.app` | The homeserver URL the frontend connects to |
| `PORT` | Railway auto-set | `80` | |

---

## Project Structure

```
project-frame/
├── package.json               # Root workspace config (npm workspaces)
├── docker-compose.yml         # Full local dev stack (2 homeservers, 2 PostgreSQL, 2 Redis)
├── scripts/
│   ├── dev-pipeline.sh        # Development pipeline script
│   ├── test-all.sh            # Run all tests
│   └── watch-build.sh         # Watch mode for development
├── shared/                    # Shared TypeScript types (workspace: @frame/shared)
│   ├── package.json
│   ├── tsconfig.json
│   └── types/
│       ├── api.ts             # Auth, error, API contract types
│       ├── devices.ts         # Device types
│       ├── events.ts          # Event types
│       ├── federation.ts      # Federation types
│       ├── keys.ts            # Key bundle types
│       └── index.ts           # Re-exports
├── services/
│   ├── homeserver/            # Backend (workspace: @frame/homeserver)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   ├── railway.toml
│   │   ├── jest.config.js
│   │   ├── .env.example
│   │   ├── migrations/        # SQL migrations (001-006)
│   │   ├── src/               # Source code
│   │   └── tests/             # Unit tests
│   └── frontend/              # Frontend (workspace: @frame/frontend)
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       ├── railway.toml
│       ├── .env.example
│       ├── public/
│       └── src/               # Source code
└── docs/                      # Architecture documentation
```

---

## Recommended Developer Tools

### Optional: Pre-commit Security Scanning

For local secret detection before commits:
- Install: `pip install detect-secrets`
- Scan: `detect-secrets scan --all-files`
- Add to git hooks: `detect-secrets-hook --baseline .secrets.baseline`

---

## First-Time Setup Checklist

### Local Development
- [ ] Install Node.js 20+, Docker, Git
- [ ] Clone the repository
- [ ] Run `npm install` at the repo root (installs all workspaces: shared, homeserver, frontend)
- [ ] Copy env files: `cp services/homeserver/.env.example services/homeserver/.env`
- [ ] Copy env files: `cp services/frontend/.env.example services/frontend/.env`
- [ ] Run `docker-compose up -d` (starts 2x PostgreSQL + 2x Redis locally)
- [ ] Build shared types: `npm run build:shared`
- [ ] Run backend migrations: `cd services/homeserver && npm run migrate`
- [ ] Start backend: `npm run dev:homeserver`
- [ ] Start frontend: `npm run dev:frontend`

### Available npm Scripts (Root)
- `npm run build` -- Build shared + homeserver + frontend
- `npm run build:shared` -- Build shared types only
- `npm run dev:homeserver` -- Start homeserver in dev mode (tsx watch)
- `npm run dev:frontend` -- Start frontend in dev mode (react-scripts start)
- `npm run test` -- Run all tests (homeserver + frontend)
- `npm run docker:up` -- Start Docker services
- `npm run docker:down` -- Stop Docker services
- `npm run pipeline` -- Run full dev pipeline script
- `npm run check` -- Type-check all workspaces

### Railway Deployment (First Time)
- [ ] Create Railway project
- [ ] Add 3 web services (homeserver-a, homeserver-b, frontend) -- all connected to same GitHub repo
- [ ] Set root directory to `/` for all services (AD-016)
- [ ] Configure build commands per service (see railway.toml in each service directory)
- [ ] Provision 2 PostgreSQL instances, link to respective homeservers
- [ ] Provision 2 Redis instances, link to respective homeservers
- [ ] Set environment variables per service (see table above)
- [ ] Generate JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- [ ] Generate FEDERATION_SIGNING_KEY (Ed25519 keypair)
- [ ] Deploy and verify health checks pass (`/health` returns `{ status: "ok" }`)
