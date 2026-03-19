# Railway Service Map

Maps every Railway service to its configuration, domain, and connections.

---

## Services Overview

| # | Service Name | Type | Code Directory | Domain |
|---|-------------|------|---------------|--------|
| 1 | `project-F.R.A.M.E` | Web (Docker) | `services/homeserver/` | `project-frame-production.up.railway.app` |
| 2 | `frontend` | Web (Docker) | `services/frontend/` | `frontend-production-29a3.up.railway.app` |
| 3 | `Postgres` | Managed Database | N/A | Internal only |
| 4 | `Redis` | Managed Database | N/A | Internal only |

---

## Connection Map

```
frontend ──HTTPS──► project-F.R.A.M.E (homeserver)
                              │
                         ┌────┴────┐
                         │Postgres │
                         │  Redis  │
                         └─────────┘
```

---

## Environment Variables Per Service

### project-F.R.A.M.E (homeserver)
| Variable | Value | Source |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://...` | Railway auto-injected (linked to Postgres) |
| `REDIS_URL` | `redis://...` | Railway auto-injected (linked to Redis) |
| `PORT` | `3000` | Railway auto-set |
| `NODE_ENV` | `production` | Manual |
| `JWT_SECRET` | `<random 64 chars>` | Manual |
| `BCRYPT_SALT_ROUNDS` | `12` | Manual |
| `HOMESERVER_DOMAIN` | `project-frame-production.up.railway.app` | Manual |
| `FEDERATION_SIGNING_KEY` | `<Ed25519 private key>` | Manual |
| `CORS_ORIGINS` | `https://frontend-production-29a3.up.railway.app` | Manual |
| `DB_SSL_REJECT_UNAUTHORIZED` | `'true'` or `'1'` | Manual (note: uses string comparison, not boolean coercion) |

> Generate signing keys with `./scripts/generate-federation-keys.sh`. See `docs/operations/federation-deployment.md` for the full deployment guide.

### frontend
| Variable | Value | Source |
|----------|-------|--------|
| `REACT_APP_HOMESERVER_URL` | `https://project-frame-production.up.railway.app` | Manual (build-time) |
| `PORT` | `$PORT` (Railway-assigned) | Railway auto-set; nginx uses `envsubst` at runtime to substitute `$PORT` |

---

## Federation Network Topology

```
                 Public Internet (HTTPS/TLS)
                           │
               ┌───────────┼───────────┐
               │                       │
               ▼                       ▼
  ┌────────────────────┐      ┌──────────────────┐
  │ project-F.R.A.M.E  │      │    frontend       │
  │ (homeserver)       │      │ :$PORT (nginx)    │
  │ :3000              │      │ frontend-prod...  │
  │ project-frame-     │      │ .up.railway.app   │
  │ production.up.     │      └────────┬──────────┘
  │ railway.app        │               │
  └────────┬───────────┘          Connects to
           │                      Homeserver
      ┌────┴────┐
      │Postgres │
      │  Redis  │
      └─────────┘
```

Traffic flows over the public internet using Railway's automatic TLS. The frontend connects to the homeserver via its public domain. Federation with other homeservers (if configured) uses `GET /.well-known/frame/server` for discovery and `POST /federation/send` with Ed25519 signatures for authentication.

---

## Build Configuration Per Service

### project-F.R.A.M.E (homeserver)

| Setting | Value |
|---------|-------|
| Builder | Dockerfile |
| Dockerfile Path | `services/homeserver/Dockerfile` |
| Watch Patterns | `services/homeserver/**`, `shared/**` |
| Health Check Path | `/health` |
| Health Check Timeout | 30s |
| Restart Policy | `ON_FAILURE` (max 5 retries) |

### frontend

| Setting | Value |
|---------|-------|
| Builder | Dockerfile |
| Dockerfile Path | `services/frontend/Dockerfile` |
| Watch Patterns | `services/frontend/**`, `shared/**` |

---

## Railway Dashboard Setup Steps

1. Create project "Project F.R.A.M.E."
2. Add service `project-F.R.A.M.E` → connect to GitHub repo → set root dir `/`
3. Add service `frontend` → connect to same repo → set root dir `/`
4. Add PostgreSQL plugin → name `Postgres` → link to `project-F.R.A.M.E`
5. Add Redis plugin → name `Redis` → link to `project-F.R.A.M.E`
6. Set build commands per service (see project-structure.md)
7. Set environment variables per service (see tables above)
8. Deploy
