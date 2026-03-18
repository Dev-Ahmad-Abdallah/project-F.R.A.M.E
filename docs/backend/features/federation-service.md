# Feature: Federation Service

**Owner:** Ahmed Ali Abdallah (234742)
**Priority:** Week 4
**Status:** Planned

---

## Overview

Federation enables users on different homeservers to communicate. When User A (on Homeserver 1) sends a message to User B (on Homeserver 2), the federation service relays the encrypted event between servers. The federation protocol handles peer authentication, event relay, and backfill.

---

## Architecture

```
┌──────────────┐     Federation API      ┌──────────────┐
│ Homeserver A │◄──────────────────────►│ Homeserver B │
│              │   (TLS + Server Auth)   │              │
│  Users:      │                         │  Users:      │
│  @alice:a.io │                         │  @bob:b.io   │
│  @carol:a.io │                         │  @dave:b.io  │
└──────────────┘                         └──────────────┘
```

---

## How Federation Works

### User Addressing
- Users are identified as `@username:homeserver.domain`
- The domain part tells the system which homeserver owns this user
- Example: `@alice:frame-a.railway.app` → routed to Homeserver A

### Message Relay Flow

```
1. Alice (@alice:a.io) sends message in shared room with Bob (@bob:b.io)
2. Homeserver A receives encrypted event from Alice's client
3. Homeserver A checks room membership → Bob is on Homeserver B
4. Homeserver A authenticates with Homeserver B (TLS + server signing key)
5. Homeserver A sends event to Homeserver B: POST /federation/send
6. Homeserver B validates the event + server signature
7. Homeserver B stores event and queues it for Bob's devices
8. Bob's client syncs and receives the encrypted event
```

### Server Authentication
- Each homeserver has a **server signing key** (Ed25519)
- Federation requests are signed with this key
- Receiving server verifies the signature against the sender's published key
- Server keys discovered via well-known URL or DNS

### Event Format (Federation)

```json
{
  "origin": "frame-a.railway.app",
  "origin_server_ts": 1711234567890,
  "event_id": "$abc123",
  "room_id": "!room1:frame-a.railway.app",
  "sender": "@alice:frame-a.railway.app",
  "type": "m.room.encrypted",
  "content": {
    "algorithm": "m.megolm.v1.aes-sha2",
    "ciphertext": "...",
    "device_id": "DEVICE_A1",
    "session_id": "..."
  },
  "signatures": {
    "frame-a.railway.app": {
      "ed25519:key_id": "..."
    }
  }
}
```

---

## Federation Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/federation/send` | POST | Relay encrypted event from peer |
| `/federation/keys/:userId` | GET | Fetch user's public keys for remote server |
| `/federation/backfill` | GET | Retrieve missed events |
| `/federation/query/directory` | GET | Look up room/user on remote server |
| `/.well-known/frame/server` | GET | Server discovery (port, key) |

---

## Trust Model

- **Federation peers are semi-trusted**: they relay events but cannot read encrypted content
- **Server signatures prevent forgery**: a peer can't fabricate events from another server
- **Peer allowlisting**: homeservers can restrict which peers they federate with
- **Rate limiting on federation endpoints**: prevent peer abuse or amplification attacks

---

## Railway Deployment Considerations

- Two separate Railway services: `frame-homeserver-a` and `frame-homeserver-b`
- Each gets its own Railway domain (e.g., `frame-a.up.railway.app`)
- Internal networking: Railway services can communicate via internal URLs
- External networking: federation may require public URLs for server discovery
- TLS: Railway provides automatic TLS termination

---

## Security Considerations

1. **Validate all federation events** — check signatures, event format, room membership
2. **Rate limit federation endpoints** — prevent amplification attacks
3. **Log federation events** — but only metadata (origin, event_id, room_id), not ciphertext
4. **Peer authentication is mandatory** — reject unsigned federation requests
5. **Backfill limits** — cap the number of events returned to prevent resource exhaustion
6. **Federation circuit breaker** — if a peer is misbehaving, temporarily block it
