# Feature: TLS & Network Security

**Owner:** Hossam Elsayed (235174)
**Priority:** Week 3
**Status:** Planned

---

## Overview

All communication in F.R.A.M.E. is encrypted in transit using TLS (Transport Layer Security). This applies to client-server connections, server-server federation, and database connections. Railway provides automatic TLS termination for public endpoints.

---

## TLS Architecture

```
Client Browser ──── HTTPS (TLS 1.3) ────► Railway Edge ──── Internal ────► Homeserver
                                          (TLS termination)

Homeserver A ──── HTTPS (TLS) ────► Railway Edge ────► Homeserver B
                  (Federation)       (TLS termination)

Homeserver ──── SSL ────► PostgreSQL (Railway managed)
Homeserver ──── TLS ────► Redis (Railway managed)
```

---

## TLS Layers

### Layer 1: Client ↔ Server (HTTPS)
- **Provider:** Railway automatic TLS
- **Protocol:** TLS 1.2+ (Railway default), prefer TLS 1.3
- **Certificates:** Auto-provisioned by Railway (Let's Encrypt)
- **Enforcement:** Frontend client rejects non-HTTPS URLs; backend serves HTTPS only

### Layer 2: Server ↔ Server (Federation)
- **Provider:** Railway automatic TLS on public endpoints
- **Verification:** Federation service verifies peer server certificates
- **Additional:** Server signing keys provide application-level authentication on top of TLS

### Layer 3: Server ↔ Database
- **PostgreSQL:** Railway provides SSL connections by default
- **Redis:** Railway provides TLS connections for managed Redis
- **Enforcement:** Connection strings include SSL parameters

---

## HTTPS Enforcement

### Backend (Express.js)
- Set `Strict-Transport-Security` header (HSTS)
- Redirect HTTP to HTTPS (Railway handles at edge, but app should also enforce)
- Reject API calls without TLS (defense in depth)

### Frontend
- API client enforces `https://` prefix on all requests
- Service Worker registered only on HTTPS origins (browser requirement)
- CSP headers prevent mixed content

---

## Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Force HTTPS for 1 year |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-XSS-Protection` | `0` | Disable browser XSS filter (DOMPurify handles it) |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'` | Restrict resource loading |
| `Referrer-Policy` | `no-referrer` | Don't leak URLs to third parties |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disable unused browser APIs |

---

## Network Isolation

| Traffic | Path | Encryption |
|---------|------|-----------|
| Client → Backend | Public internet | TLS (Railway edge) |
| Backend → Backend (federation) | Public internet | TLS (Railway edge) |
| Backend → PostgreSQL | Railway internal | SSL |
| Backend → Redis | Railway internal | TLS |
| CI/CD → Railway | Public internet | HTTPS (Railway API) |

---

## Security Considerations

1. **No plain HTTP — ever** — not in development, not in staging, not in production
2. **Certificate pinning** — not needed (Railway auto-manages certs with Let's Encrypt)
3. **TLS version minimum** — TLS 1.2 minimum; Railway handles this at the edge
4. **HSTS preloading** — consider submitting to HSTS preload list for custom domains
5. **Database SSL mode** — set `sslmode=require` in PostgreSQL connection string
