# Setup Requirements & External Dependencies

**Project F.R.A.M.E.** — What you need before you can build and run.

---

## API Keys & External Accounts

| Service | API Key Required? | What You Need | Cost |
|---------|------------------|---------------|------|
| **Railway** | No API key — account login | Railway account (GitHub OAuth) | Free tier / Hobby ($5/mo) |
| **GitHub** | No — GITHUB_TOKEN auto-injected in Actions | GitHub account with repo access | Free for public repos |
| **GHAS** (GitHub Advanced Security) | No | Enabled in repo settings | Free for public repos |
| **matrix-sdk-crypto-wasm** | No | npm install | Free (MIT license) |
| **PostgreSQL** | No | Railway managed or local Docker | Included in Railway |
| **Redis** | No | Railway managed or local Docker | Included in Railway |
| **Firebase / APNs** | **NOT USED** | N/A — push is opaque wake-up via our own server | N/A |
| **Any external auth provider** | **NOT USED** | N/A — JWT issued by our own backend | N/A |

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
- **TLS/HTTPS certificates** — automatic via Let's Encrypt on all Railway domains
- **DNS** — `*.up.railway.app` domains assigned automatically
- **`DATABASE_URL`** — auto-injected when PostgreSQL service is linked
- **`REDIS_URL`** — auto-injected when Redis service is linked
- **`PORT`** — auto-set by Railway for each service
- **Health monitoring** — Railway monitors `/health` endpoint and auto-restarts on failure
- **Log collection** — stdout/stderr collected automatically, viewable in dashboard
- **Rollback** — one-click rollback to previous deployment

### GitHub Auto-Provides
- **`GITHUB_TOKEN`** — auto-injected into GitHub Actions workflows
- **CodeQL scanning** — auto-runs when GHAS is enabled
- **Secret scanning** — auto-runs on all pushes
- **Dependency alerts** — auto-generated for known vulnerabilities
- **Branch protection** — configured once in repo settings, enforced automatically

### npm Packages That Auto-Handle Security
- **`helmet`** — sets 13 security headers with zero config: `app.use(helmet())`
- **`bcrypt`** — generates salts automatically: `await bcrypt.hash(password, 12)`
- **`cors`** — handles CORS preflight automatically for configured origins
- **`express-rate-limit`** — tracks request counts automatically per IP

### matrix-sdk-crypto-wasm Auto-Handles
- **Key generation** — identity keys created automatically on `OlmMachine.initialize()`
- **One-time prekey generation** — auto-generated, surfaced via `outgoingRequests()`
- **Olm session creation** — automatic when claiming keys
- **Megolm session rotation** — internal to the state machine
- **Ratchet advancement** — automatic on each encrypt/decrypt
- **Forward secrecy** — guaranteed by the Double Ratchet implementation
- **Post-compromise security** — guaranteed by ratchet healing

---

## Environment Variables (Per Service)

### Homeserver A & B (Backend)

| Variable | Source | Example |
|----------|--------|---------|
| `DATABASE_URL` | Railway auto-injected | `postgresql://...` |
| `REDIS_URL` | Railway auto-injected | `redis://...` |
| `PORT` | Railway auto-set | `3000` |
| `NODE_ENV` | Manual set | `production` |
| `JWT_SECRET` | Manual set (Railway dashboard) | Random 64-char string |
| `BCRYPT_SALT_ROUNDS` | Manual set or default | `12` |
| `HOMESERVER_DOMAIN` | Manual set | `frame-a.up.railway.app` |
| `FEDERATION_SIGNING_KEY` | Manual set | Ed25519 private key |
| `FEDERATION_PEERS` | Manual set | `frame-b.up.railway.app` |
| `CORS_ORIGINS` | Manual set | `https://frame.up.railway.app` |

### Frontend

| Variable | Source | Example |
|----------|--------|---------|
| `REACT_APP_HOMESERVER_URL` | Manual set (build-time) | `https://frame-a.up.railway.app` |
| `PORT` | Railway auto-set | `80` |

---

## First-Time Setup Checklist

### Local Development
- [ ] Install Node.js 20+, Docker, Git
- [ ] Clone the repository
- [ ] Run `npm install` in both `backend/` and `frontend/`
- [ ] Run `docker-compose up` (starts PostgreSQL + Redis locally)
- [ ] Run backend migrations: `npm run migrate` in `backend/`
- [ ] Start backend: `npm run dev` in `backend/`
- [ ] Start frontend: `npm run dev` in `frontend/`

### Railway Deployment (First Time)
- [ ] Create Railway project
- [ ] Add 3 web services (homeserver-a, homeserver-b, frontend) — all connected to same GitHub repo
- [ ] Set root directory to `/` for all services
- [ ] Configure build commands per service (see railway.toml)
- [ ] Provision 2 PostgreSQL instances, link to respective homeservers
- [ ] Provision 2 Redis instances, link to respective homeservers
- [ ] Set environment variables per service (see table above)
- [ ] Generate JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- [ ] Generate FEDERATION_SIGNING_KEY (Ed25519 keypair)
- [ ] Deploy and verify health checks pass
