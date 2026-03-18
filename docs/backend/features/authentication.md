# Feature: Authentication & Authorization

**Owner:** Ahmed Ali Abdallah (234742)
**Priority:** Week 2
**Status:** Planned

---

## Overview

Authentication verifies user identity; authorization controls what authenticated users can do. F.R.A.M.E. uses JWT (JSON Web Tokens) for stateless authentication that works across federated homeservers.

---

## Auth Flow

### Registration
```
Client                          Homeserver
  │                                │
  │  POST /auth/register           │
  │  {                             │
  │    username,                   │
  │    password,                   │
  │    identity_key,               │
  │    signed_prekey,              │
  │    one_time_prekeys[]          │
  │  }                             │
  │───────────────────────────────►│
  │                                │  Hash password (bcrypt)
  │                                │  Store user record
  │                                │  Store key bundle
  │                                │  Generate JWT
  │  { accessToken, refreshToken } │
  │◄───────────────────────────────│
```

### Login
```
Client                          Homeserver
  │                                │
  │  POST /auth/login              │
  │  { username, password }        │
  │───────────────────────────────►│
  │                                │  Verify password hash
  │                                │  Generate JWT pair
  │  { accessToken, refreshToken } │
  │◄───────────────────────────────│
```

### Token Refresh
```
Client                          Homeserver
  │                                │
  │  POST /auth/refresh            │
  │  { refreshToken }              │
  │───────────────────────────────►│
  │                                │  Validate refresh token
  │                                │  Generate new access token
  │  { accessToken }               │
  │◄───────────────────────────────│
```

---

## JWT Structure

### Access Token (short-lived: 15 minutes)
```json
{
  "sub": "@alice:frame-a.railway.app",
  "device_id": "DEVICE_A1",
  "iat": 1711234567,
  "exp": 1711235467,
  "iss": "frame-a.railway.app"
}
```

### Refresh Token (longer-lived: 7 days)
- Stored server-side (in Redis or PostgreSQL)
- One refresh token per device
- Revocable: on logout, device removal, or security event

---

## Password Security

| Measure | Implementation |
|---------|---------------|
| Hashing | bcrypt with cost factor 12 |
| Salt | Per-user random salt (built into bcrypt) |
| Min length | 8 characters minimum |
| No plaintext | Password never stored or logged in plaintext |
| Rate limiting | 5 login attempts per 15 minutes per IP |

---

## Authorization Model

| Action | Who Can Do It |
|--------|--------------|
| Read own messages | Authenticated user (own rooms only) |
| Send messages | Authenticated user (member of room) |
| Fetch keys | Any authenticated user |
| Register device | Authenticated user (own account) |
| Remove device | Authenticated user (own devices) |
| Federation relay | Authenticated peer server |

---

## Security Considerations

1. **bcrypt for password hashing** — not MD5, not SHA-256 alone
2. **Short-lived access tokens** — limit window of stolen token usefulness
3. **Refresh token rotation** — issue new refresh token on each use; invalidate old one
4. **Revocation on security events** — logout, password change, device removal invalidates tokens
5. **No sensitive data in JWT payload** — no password, no private keys
6. **JWT secret stored securely** — in environment variable, not in code
7. **Rate limit login endpoint** — prevent brute force attacks
