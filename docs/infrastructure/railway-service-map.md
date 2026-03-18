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
Same variables, different values pointing to PG-B, Redis-B, domain `frame-b`.

### frame-frontend
| Variable | Value | Source |
|----------|-------|--------|
| `REACT_APP_HOMESERVER_URL` | `https://frame-a.up.railway.app` | Manual (build-time) |
| `PORT` | `80` | Railway auto-set |

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
