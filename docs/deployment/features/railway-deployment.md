# Feature: Railway Deployment

**Owner:** Hossam Elsayed (235174)
**Priority:** Week 2
**Status:** Planned

---

## Overview

Railway is the PaaS platform for deploying F.R.A.M.E. It provides managed databases (PostgreSQL, Redis), automatic TLS, and simple deployment from GitHub. Each homeserver and the frontend are deployed as separate Railway services within one project.

---

## Service Layout

```
Railway Project: "Project F.R.A.M.E."
│
├── Service: frame-homeserver-a (Web)
│   ├── Runtime: Docker (Node.js)
│   ├── Port: 3000
│   ├── Domain: frame-a.up.railway.app (or custom)
│   └── Env: DATABASE_URL, REDIS_URL, JWT_SECRET, ...
│
├── Service: frame-homeserver-b (Web)  ← Federation peer
│   ├── Runtime: Docker (Node.js)
│   ├── Port: 3000
│   ├── Domain: frame-b.up.railway.app (or custom)
│   └── Env: DATABASE_URL, REDIS_URL, JWT_SECRET, ...
│
├── Service: frame-frontend (Web)
│   ├── Runtime: Docker (nginx) or static deploy
│   ├── Port: 80
│   └── Domain: frame.up.railway.app (or custom)
│
├── Database: PostgreSQL A
│   └── Connected to: frame-homeserver-a
│
├── Database: PostgreSQL B
│   └── Connected to: frame-homeserver-b
│
├── Database: Redis A
│   └── Connected to: frame-homeserver-a
│
└── Database: Redis B
    └── Connected to: frame-homeserver-b
```

> **Federation scope:** Full federation with server discovery (`.well-known`), peer authentication (TLS + server signing keys), and cross-server encrypted event relay. Both homeservers are fully functional independent nodes that can federate with each other.

---

## Railway Configuration

### Environment Variables Per Service

| Variable | Service | Description |
|----------|---------|-------------|
| `DATABASE_URL` | Backend | PostgreSQL connection string (auto-injected by Railway) |
| `REDIS_URL` | Backend | Redis connection string (auto-injected by Railway) |
| `JWT_SECRET` | Backend | Secret for signing JWT tokens |
| `FEDERATION_SIGNING_KEY` | Backend | Ed25519 server signing key for federation |
| `HOMESERVER_DOMAIN` | Backend | This server's domain (e.g., `frame-a.up.railway.app`) |
| `FEDERATION_PEERS` | Backend | Comma-separated list of trusted peer domains |
| `PORT` | All | Railway sets this automatically |
| `NODE_ENV` | Backend | `production` |
| `REACT_APP_HOMESERVER_URL` | Frontend | Backend URL for API calls |

### Railway Features Used

| Feature | Purpose |
|---------|---------|
| **Auto-deploy on push** | Merge to main → automatic redeploy |
| **Managed PostgreSQL** | No manual DB setup; auto connection strings |
| **Managed Redis** | No manual Redis setup; auto connection strings |
| **Automatic TLS** | HTTPS on all public domains — no cert management |
| **Internal networking** | Services communicate via `*.railway.internal` |
| **Health checks** | Railway monitors service health, restarts on failure |
| **Rollback** | One-click rollback to previous deployment |
| **Logging** | Built-in log viewer per service |

---

## Deployment Strategy

### Auto-Deploy Flow
```
1. Developer merges PR to main
2. GitHub webhook triggers Railway
3. Railway pulls latest code
4. Railway builds Docker image (or Nixpacks)
5. Railway deploys new version
6. Health check: GET /health returns 200
7. If healthy → route traffic to new version
8. If unhealthy → rollback to previous version
```

### Manual Deploy (Emergency)
```
railway up                  # Deploy current directory
railway up --service <id>   # Deploy specific service
```

---

## Networking

### Public Access
- Each web service gets a `*.up.railway.app` domain
- Custom domains can be added via Railway dashboard
- TLS is automatic for all domains

### Internal Communication
- Services within the same project can use `service-name.railway.internal`
- Internal traffic doesn't go through public internet
- Used for: frontend → backend API calls (if same project), homeserver A → homeserver B

### Federation Networking
- Federation requires **public URLs** (peer servers must be reachable from the internet)
- Each homeserver needs its own public domain
- Server discovery: `https://frame-a.up.railway.app/.well-known/frame/server`

---

## Cost Considerations

| Resource | Railway Pricing Impact |
|----------|----------------------|
| 2 web services (homeservers) | Uses compute hours |
| 1 web service (frontend) | Uses compute hours |
| 2 PostgreSQL instances | Managed DB pricing |
| 2 Redis instances | Managed DB pricing |
| Network egress | May incur charges on high traffic |

**Total: 7 Railway services.** Start with Railway's free trial / hobby plan. Scale up only if demo requires it.

**Recommendation for academic project**: Start with Railway's free trial / hobby plan. Scale up only if demo requires it.

---

## Security Considerations

1. **Railway environment variables** — never commit secrets to code; set via dashboard
2. **TLS enforced** — Railway handles certificates automatically
3. **Service isolation** — each service runs in its own container
4. **Database access control** — use Railway-provided connection strings (includes auth)
5. **No public database exposure** — databases only accessible from within Railway network
6. **Deployment approvals** — consider requiring manual approval for production deploys
