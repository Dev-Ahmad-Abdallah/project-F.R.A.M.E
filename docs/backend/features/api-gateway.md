# Feature: API Gateway & Application Server

**Owner:** Ahmed Ali Abdallah (234742)
**Priority:** Week 2
**Status:** Planned

---

## Overview

The API Gateway is the front door of each homeserver. It exposes REST endpoints for client operations (auth, messaging, keys, devices) and federation endpoints for server-to-server communication. All requests are validated, authenticated, and rate-limited before reaching business logic.

---

## Architecture

```
Client Request (HTTPS)
        │
        ▼
┌──────────────────────────┐
│      Express.js App      │
│                          │
│  ┌────────────────────┐  │
│  │   Middleware Stack  │  │
│  │                    │  │
│  │  1. TLS Check      │  │
│  │  2. Rate Limiter   │  │
│  │  3. JWT Validator  │  │
│  │  4. Request Valid. │  │
│  │  5. CORS Handler   │  │
│  └────────┬───────────┘  │
│           │              │
│  ┌────────▼───────────┐  │
│  │    Route Handlers  │  │
│  │                    │  │
│  │  /auth/*           │  │
│  │  /keys/*           │  │
│  │  /messages/*       │  │
│  │  /devices/*        │  │
│  │  /federation/*     │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

---

## Middleware Stack

| Order | Middleware | Purpose |
|-------|-----------|---------|
| 1 | HTTPS enforcement | Reject plain HTTP requests |
| 2 | CORS handler | Control which origins can call the API |
| 3 | Rate limiter | Prevent API abuse (per IP + per user) |
| 4 | Body parser | Parse JSON request bodies with size limits |
| 5 | JWT validator | Verify Bearer token on authenticated routes |
| 6 | Request validator | Validate request body schema |

### Rate Limiting Strategy

| Endpoint Group | Limit | Window | Rationale |
|----------------|-------|--------|-----------|
| `/auth/login` | 5 requests | 15 min | Prevent brute force |
| `/auth/register` | 3 requests | 1 hour | Prevent spam accounts |
| `/keys/*` | 60 requests | 1 min | Key fetches are frequent but bounded |
| `/messages/send` | 30 requests | 1 min | Prevent message flooding |
| `/messages/sync` | 60 requests | 1 min | Polling endpoint |
| `/federation/*` | 100 requests | 1 min | Server-to-server traffic |

---

## Endpoints

### Public (No Auth Required)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/register` | POST | Register new user + upload initial keys |
| `/auth/login` | POST | Authenticate, return JWT |
| `/health` | GET | Health check for Railway |

### Authenticated (JWT Required)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/keys/upload` | POST | Upload one-time prekeys |
| `/keys/:userId` | GET | Fetch user's key bundle |
| `/keys/transparency/:userId` | GET | Fetch Merkle proof |
| `/messages/send` | POST | Send encrypted payload |
| `/messages/sync` | GET | Fetch queued messages since sequence ID |
| `/devices/register` | POST | Register new device |
| `/devices/:userId` | GET | List user's devices |

### Federation (Server Auth Required)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/federation/send` | POST | Relay encrypted event from peer server |
| `/federation/keys/:userId` | GET | Fetch user's keys for remote server |
| `/federation/backfill` | GET | Backfill missed events |

---

## Error Response Format

```json
{
  "error": {
    "code": "M_FORBIDDEN",
    "message": "Access denied"
  }
}
```

**Rules:**
- Never expose stack traces in production
- Never include internal database errors
- Use standardized error codes (M_FORBIDDEN, M_NOT_FOUND, M_RATE_LIMITED, etc.)
- Include retry-after header for rate limit responses

---

## Security Considerations

1. **Input validation on every endpoint** — reject malformed requests before processing
2. **Request body size limits** — prevent large payload attacks (max 64KB for messages, 10MB for attachments)
3. **CORS configured strictly** — only allow known frontend origins
4. **Helmet.js** — set security headers (X-Content-Type-Options, X-Frame-Options, etc.)
5. **No sensitive data in logs** — log request paths and status codes, not bodies or tokens
