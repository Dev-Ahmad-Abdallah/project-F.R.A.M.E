# Deployment & Infrastructure Overview

**Owner:** Hossam Elsayed (235174)
**Role:** DevOps / Infrastructure Security
**Pillar:** Deployment, CI/CD, and Runtime Security

---

## Architectural Position

The DevOps layer ensures that the secure crypto code written by the frontend and backend teams is deployed on **equally secure infrastructure**. A perfect protocol on insecure infrastructure is still insecure. This pillar handles CI/CD automation, secrets management, containerization, TLS enforcement, monitoring, and hardened runtime environments.

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Repository                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ Source   │  │ GitHub       │  │ GitHub Advanced Security  │  │
│  │ Code     │  │ Actions CI   │  │ (SAST, Secrets, Deps)     │  │
│  └──────────┘  └──────┬───────┘  └───────────────────────────┘  │
│                        │                                         │
│   Branch Protection + PR Reviews + Merge Policies               │
└────────────────────────┼─────────────────────────────────────────┘
                         │ Deploy on merge to main
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Railway PaaS                               │
│                                                                  │
│  ┌──────────────────┐  ┌────────────────────┐                    │
│  │ Service:         │  │ Service:           │                    │
│  │ project-F.R.A.M.E│  │ frontend           │                    │
│  │ (Node.js)        │  │ (React Build)      │                    │
│  │ Port: $PORT      │  │ (nginx, $PORT via  │                    │
│  │                  │  │  envsubst)         │                    │
│  └──────┬───────────┘  └────────────────────┘                    │
│         │                                                        │
│  ┌──────┴───────┐                                                │
│  │ Postgres     │  (Railway managed DBs)                         │
│  │ Redis        │                                                │
│  └──────────────┘                             │
│                                                                  │
│  Railway handles: TLS termination, DNS, auto-scaling, logging   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose | Why This Choice |
|-----------|---------|-----------------|
| GitHub | Version control + collaboration | Industry standard, integrated security features |
| GitHub Actions | CI/CD automation | Native GitHub integration, free tier sufficient |
| GitHub Advanced Security | SAST + secret detection + dependency scanning | Catches vulnerabilities pre-merge |
| Docker | Containerization | Reproducible builds, environment consistency |
| Railway | PaaS deployment | Simple deployment, managed databases, TLS included |
| GitHub Secrets | Credential storage for CI | Encrypted, scoped to repo/environment |
| Railway Config Store | Runtime secrets | Environment variables injected at deploy time |

---

## CI/CD Pipeline Flow

```
Developer Push / PR
        │
        ▼
┌─────────────────────┐
│  GitHub Actions      │
│                      │
│  1. Lint + TypeCheck │
│  2. Unit Tests       │
│  3. GHAS Scan        │
│     - CodeQL SAST    │
│     - Secret Scan    │
│     - Dependency Chk │
│  4. Docker Build     │
│  5. Integration Test │
│                      │
│  All pass?           │
│  ├─ No → Block merge │
│  └─ Yes ↓            │
└──────────┬──────────┘
           │
    PR Review + Approval
           │
           ▼
┌──────────────────────┐
│  Merge to main       │
│  → CI runs:          │
│    railway up        │
│    --service         │
│    "project-F.R.A.M.E│
│    " / "frontend"    │
│  → Railway API       │
│    health mgmt       │
│  → Rollback if fail  │
└──────────────────────┘
```

---

## Railway Service Architecture

Railway supports multiple services within a single project. For F.R.A.M.E.:

| Service | Type | Runtime | Notes |
|---------|------|---------|-------|
| `project-F.R.A.M.E` | Web Service | Node.js (Docker) | Homeserver — `project-frame-production.up.railway.app` |
| `frontend` | Static Site | React build (nginx) | Client app — `frontend-production-29a3.up.railway.app` |
| `Postgres` | Database | PostgreSQL (managed) | Homeserver data |
| `Redis` | Database | Redis (managed) | Homeserver queue/cache |

> **Note:** There is no second homeserver on Railway. Federation peer testing (homeserver-b) is local-only via Docker Compose.

### Railway Considerations
- **TLS**: Railway provides automatic HTTPS with TLS termination — no manual cert management needed
- **Custom Domains**: Each homeserver can have its own domain for federation identity
- **Environment Variables**: Set per-service via Railway dashboard or CLI
- **Nixpacks vs Docker**: Railway supports both; Docker gives full control over build environment
- **Networking**: Services within same project can communicate via internal URLs (`service.railway.internal`)
- **Scaling**: Railway supports horizontal scaling (multiple instances per service) on paid plans
- **Health Checks**: Railway manages health monitoring via its API — no Docker `HEALTHCHECK` instruction needed
- **nginx Port Binding**: The frontend nginx config uses `envsubst` to inject `$PORT` at runtime (not hardcoded port 80)
- **CI Deploy**: The deploy step uses `railway up --service "project-F.R.A.M.E"` and `railway up --service frontend`

---

## Key Concerns & Considerations

### Security Requirements
1. **No secrets in code** — all credentials in GitHub Secrets / Railway config store
2. **Branch protection** — no direct push to main, require PR review
3. **GHAS scans must pass** before merge is allowed
4. **TLS everywhere** — no plain HTTP paths, even in staging
5. **Least privilege** — CI/CD workflows get minimal permissions
6. **Container hardening** — non-root user, minimal base image, no unnecessary packages

### Operational Concerns
- Railway has cold start on free/hobby tier — Railway manages health checks via API (no Docker HEALTHCHECK)
- Redis memory limits on Railway managed instances — monitor usage
- PostgreSQL connection limits — relevant when multiple services connect
- Docker image size affects deploy time — keep images lean
- Federation testing uses a local Docker Compose setup (no second homeserver on Railway)

### Cost Considerations
- Railway free tier: limited hours, limited resources
- Each additional service/database counts against resource limits
- Federation peer (homeserver-b) runs locally only, so no extra Railway cost
- GHAS may require GitHub Teams/Enterprise for private repos

---

## Feature Documentation

| Feature | Doc | Priority |
|---------|-----|----------|
| CI/CD Pipeline | [cicd-pipeline.md](./features/cicd-pipeline.md) | Week 1-2 |
| Docker Containerization | [docker-containerization.md](./features/docker-containerization.md) | Week 2 |
| Railway Deployment | [railway-deployment.md](./features/railway-deployment.md) | Week 2 |
| Secrets Management | [secrets-management.md](./features/secrets-management.md) | Week 1 |
| TLS & Network Security | [tls-network-security.md](./features/tls-network-security.md) | Week 3 |
| Monitoring & Logging | [monitoring-logging.md](./features/monitoring-logging.md) | Week 3 |

## Security Documentation

| Doc | Scope |
|-----|-------|
| [Infrastructure Security Model](./security/security-model.md) | CI/CD threats, deployment risks, runtime hardening |
| [Infrastructure Security Considerations](./security/security-considerations.md) | Practical safeguards, configuration checklist |

---

## Dependencies

| Dependency | From | What's Needed | When |
|-----------|------|---------------|------|
| Backend Dockerfile | Backend (Ahmed) | Working Node.js app to containerize | Week 2 |
| Frontend build | Frontend (Mohamed) | React build output to serve | Week 2 |
| API contracts | Both | Know what ports/endpoints to expose | Week 1 |
| Federation config | Backend (Ahmed) | How homeservers discover each other | Week 4 |
