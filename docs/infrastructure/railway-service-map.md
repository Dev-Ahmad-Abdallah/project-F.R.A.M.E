# Railway Service Map

Maps every Railway service to its configuration, domain, and connections.

---

## Services Overview

| # | Service Name | Type | Code Directory | Domain |
|---|-------------|------|---------------|--------|
| 1 | `frame-homeserver-a` | Web (Docker) | `services/homeserver/` | `frame-a.up.railway.app` |
| 2 | `frame-homeserver-b` | Web (Docker) | `services/homeserver/` | `frame-b.up.railway.app` |
| 3 | `frame-frontend` | Web (Docker) | `services/frontend/` | `frame.up.railway.app` |
| 4 | `PostgreSQL A` | Managed Database | N/A | Internal only |
| 5 | `PostgreSQL B` | Managed Database | N/A | Internal only |
| 6 | `Redis A` | Managed Database | N/A | Internal only |
| 7 | `Redis B` | Managed Database | N/A | Internal only |

---

## Connection Map

```
frame-frontend ──HTTPS──► frame-homeserver-a ◄──Federation──► frame-homeserver-b
                                │                                    │
                           ┌────┴────┐                          ┌────┴────┐
                           │  PG-A   │                          │  PG-B   │
                           │ Redis-A │                          │ Redis-B │
                           └─────────┘                          └─────────┘
```

---

## Environment Variables Per Service

### frame-homeserver-a
| Variable | Value | Source |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://...` | Railway auto-injected (linked to PG-A) |
| `REDIS_URL` | `redis://...` | Railway auto-injected (linked to Redis-A) |
| `PORT` | `3000` | Railway auto-set |
| `NODE_ENV` | `production` | Manual |
| `JWT_SECRET` | `<random 64 chars>` | Manual |
| `HOMESERVER_DOMAIN` | `frame-a.up.railway.app` | Manual |
| `FEDERATION_SIGNING_KEY` | `<Ed25519 private key>` | Manual |
| `FEDERATION_PEERS` | `frame-b.up.railway.app` | Manual |
| `CORS_ORIGINS` | `https://frame.up.railway.app` | Manual |

### frame-homeserver-b
| Variable | Value | Source |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://...` | Railway auto-injected (linked to PG-B) |
| `REDIS_URL` | `redis://...` | Railway auto-injected (linked to Redis-B) |
| `PORT` | `3000` | Railway auto-set |
| `NODE_ENV` | `production` | Manual |
| `JWT_SECRET` | `<random 64 chars>` (unique, different from Server A) | Manual |
| `BCRYPT_SALT_ROUNDS` | `12` | Manual |
| `HOMESERVER_DOMAIN` | `frame-b.up.railway.app` | Manual |
| `FEDERATION_SIGNING_KEY` | `<Ed25519 private key>` (unique, different from Server A) | Manual |
| `FEDERATION_PEERS` | `frame-a.up.railway.app` | Manual |
| `CORS_ORIGINS` | `https://frame.up.railway.app` | Manual |

> Generate signing keys with `./scripts/generate-federation-keys.sh`. Each server must have its own unique key. See `docs/operations/federation-deployment.md` for the full deployment guide.

### frame-frontend
| Variable | Value | Source |
|----------|-------|--------|
| `REACT_APP_HOMESERVER_URL` | `https://frame-a.up.railway.app` | Manual (build-time) |
| `PORT` | `80` | Railway auto-set |

---

## Federation Network Topology

```
                    Public Internet (HTTPS/TLS)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────┐
  │ Homeserver A │  │ Homeserver B │  │ Frontend │
  │ :3000        │  │ :3000        │  │ :80      │
  │ frame-a.up.  │  │ frame-b.up.  │  │ frame.up.│
  │ railway.app  │  │ railway.app  │  │ rail.app │
  └──────┬───────┘  └──────┬───────┘  └────┬─────┘
         │                 │               │
    ┌────┴────┐       ┌────┴────┐          │
    │  PG-A   │       │  PG-B   │     Connects to
    │ Redis-A │       │ Redis-B │     Homeserver A
    └─────────┘       └─────────┘

  Homeserver A ◄─── Federation (HTTPS) ───► Homeserver B
  FEDERATION_PEERS:                        FEDERATION_PEERS:
  frame-b.up.railway.app                   frame-a.up.railway.app
```

Federation traffic flows over the public internet using Railway's automatic TLS. Each homeserver discovers its peer via `GET /.well-known/frame/server`, which returns the peer's host, port, and Ed25519 public key. Events are relayed via `POST /federation/send` with Ed25519 signatures for authentication.

---

## Build Configuration Per Service

### frame-homeserver-a and frame-homeserver-b

Both homeserver services share the same build configuration:

| Setting | Value |
|---------|-------|
| Builder | Dockerfile |
| Dockerfile Path | `services/homeserver/Dockerfile` |
| Watch Patterns | `services/homeserver/**`, `shared/**` |
| Health Check Path | `/health` |
| Health Check Timeout | 30s |
| Restart Policy | `ON_FAILURE` (max 5 retries) |

### frame-frontend

| Setting | Value |
|---------|-------|
| Builder | Dockerfile |
| Dockerfile Path | `services/frontend/Dockerfile` |
| Watch Patterns | `services/frontend/**`, `shared/**` |

---

## Railway Dashboard Setup Steps

1. Create project "Project F.R.A.M.E."
2. Add service `frame-homeserver-a` → connect to GitHub repo → set root dir `/`
3. Add service `frame-homeserver-b` → connect to same repo → set root dir `/`
4. Add service `frame-frontend` → connect to same repo → set root dir `/`
5. Add PostgreSQL plugin → name `PG-A` → link to `frame-homeserver-a`
6. Add PostgreSQL plugin → name `PG-B` → link to `frame-homeserver-b`
7. Add Redis plugin → name `Redis-A` → link to `frame-homeserver-a`
8. Add Redis plugin → name `Redis-B` → link to `frame-homeserver-b`
9. Set build commands per service (see project-structure.md)
10. Set environment variables per service (see tables above)
11. Deploy
