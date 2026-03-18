# Feature: Secure API Communication (Fetch + HTTPS)

**Owner:** Mohamed Hussain (235697)
**Priority:** Week 2
**Status:** Planned

---

## Overview

All communication between the frontend and homeserver must be authenticated and encrypted in transit. A central API client enforces HTTPS, attaches JWT authentication, handles token refresh, and prevents credential leakage.

---

## Implementation

### Key Files

```
src/api/
├── client.ts          # Central fetch wrapper
├── authAPI.ts         # Login, register, logout
├── keysAPI.ts         # Key upload, fetch, transparency proofs
├── messagesAPI.ts     # Send ciphertext, sync messages
└── devicesAPI.ts      # Device registration, device list
```

### client.ts — Central API Client

**Responsibilities:**
- All HTTP requests go through this single module — no raw `fetch()` calls elsewhere
- Attach JWT Bearer token to every authenticated request
- Enforce HTTPS — reject any plain HTTP URL
- Handle 401 responses → trigger token refresh or re-auth
- Standardized error handling — never leak internal details to UI
- Request/response logging for debugging (no sensitive data in logs)

```typescript
// src/api/client.ts
const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
  const token = getJWT(); // from secure in-memory storage

  if (!HOMESERVER_URL.startsWith('https://')) {
    throw new Error('HTTPS required');
  }

  const response = await fetch(`${HOMESERVER_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) {
    // Token expired → attempt refresh or redirect to login
    await handleTokenRefresh();
    return apiRequest(endpoint, options); // retry once
  }

  if (!response.ok) {
    // Standardized error — never expose raw server errors to UI
    throw new ApiError(response.status, 'Request failed');
  }

  return response.json();
};
```

### API Endpoints

| Module | Endpoint | Method | Purpose |
|--------|----------|--------|---------|
| authAPI | `/auth/register` | POST | Register + upload initial keys |
| authAPI | `/auth/login` | POST | Authenticate, receive JWT |
| keysAPI | `/keys/upload` | POST | Upload one-time prekeys |
| keysAPI | `/keys/:userId` | GET | Fetch contact's key bundle |
| keysAPI | `/keys/transparency/:userId` | GET | Fetch Merkle proof |
| messagesAPI | `/messages/send` | POST | Send encrypted payload |
| messagesAPI | `/messages/sync` | GET | Fetch queued messages |
| devicesAPI | `/devices/register` | POST | Register new device key |
| devicesAPI | `/devices/:userId` | GET | List devices for a user |

---

## Security Rules

1. **All requests through `client.ts`** — no raw `fetch()` calls with hardcoded URLs
2. **HTTPS enforced** — client rejects plain HTTP
3. **JWT in memory only** — not in localStorage, not in cookies
4. **Token refresh handled automatically** — 401 triggers refresh flow
5. **Error responses sanitized** — never leak server internals to UI
6. **No credentials in URL parameters** — always in headers or body
7. **CORS headers expected** — server must set appropriate CORS policy

---

## JWT Token Management

```
Login Flow:
1. User enters credentials
2. POST /auth/login → server returns { accessToken, refreshToken }
3. accessToken stored in memory (JavaScript variable)
4. refreshToken stored in memory (or secure httpOnly cookie if available)
5. accessToken attached to all subsequent requests

Refresh Flow:
1. API call returns 401 (token expired)
2. Client uses refreshToken to get new accessToken
3. Retry original request with new token
4. If refresh fails → redirect to login
```

---

## Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| JWT over session cookies | Stateless, works across federated servers | Session cookies tied to single domain |
| Token in memory | Prevents XSS token theft | Lost on page refresh; needs silent re-auth |
| Central API client | Single enforcement point for auth + HTTPS | Prevents missed security checks in individual calls |
| Fetch API over Axios | Native, no additional dependency | Axios is unnecessary abstraction for this scope |

---

## Testing

- [ ] All API calls fail gracefully when JWT is invalid (no leaked error details)
- [ ] Plain HTTP URLs are rejected by the client
- [ ] 401 response triggers token refresh automatically
- [ ] No raw `fetch()` calls exist outside of `client.ts` (code review check)
- [ ] JWT is not stored in localStorage or cookies
