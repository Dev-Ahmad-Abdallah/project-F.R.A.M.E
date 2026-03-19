# API Reference

**F.R.A.M.E. Homeserver REST API**

Base URL: `http://localhost:3000` (development) or `https://frame-a.up.railway.app` (production)

All authenticated endpoints require a `Bearer` token in the `Authorization` header. Tokens are short-lived (15 minutes) and can be refreshed via `/auth/refresh`.

Error responses follow a consistent format:

```json
{
  "error": {
    "code": "M_ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

Common error codes: `M_BAD_JSON`, `M_UNAUTHORIZED`, `M_FORBIDDEN`, `M_NOT_FOUND`, `M_UNKNOWN`.

---

## Table of Contents

- [Health](#health)
- [Auth](#auth)
- [Keys](#keys)
- [Messages](#messages)
- [Rooms](#rooms)
- [Devices](#devices)
- [To-Device Messaging](#to-device-messaging)
- [Push Notifications](#push-notifications)
- [Federation](#federation)
- [Discovery](#discovery)

---

## Health

### GET /health

Check server health and connectivity to PostgreSQL and Redis.

**Auth required:** No

**Response (200):**

```json
{
  "status": "ok",
  "uptime": 12345.678,
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

**Response (503):** Status is `"degraded"` if any backing service is disconnected.

```bash
curl http://localhost:3000/health
```

---

## Auth

### POST /auth/register

Register a new user account with initial key bundle.

**Auth required:** No
**Rate limit:** Register limiter

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | Yes | 3-32 chars, alphanumeric + `_` and `-` |
| `password` | string | Yes | 8-128 chars |
| `identityKey` | string | Yes | Curve25519 identity public key (base64) |
| `signedPrekey` | string | Yes | Signed prekey (base64) |
| `signedPrekeySig` | string | Yes | Signature over the signed prekey |
| `oneTimePrekeys` | string[] | Yes | Array of 1-100 one-time prekeys |

**Response (201):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "userId": "abc123",
  "deviceId": "A1B2C3D4E5F6",
  "homeserver": "localhost:3000"
}
```

**Errors:** `400 M_BAD_JSON` (validation), `409 M_USER_IN_USE` (username taken)

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "securepassword123",
    "identityKey": "base64-identity-key...",
    "signedPrekey": "base64-signed-prekey...",
    "signedPrekeySig": "base64-signature...",
    "oneTimePrekeys": ["otk1", "otk2", "otk3"]
  }'
```

---

### POST /auth/login

Authenticate and receive access + refresh tokens.

**Auth required:** No
**Rate limit:** Login limiter

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | Yes | Registered username |
| `password` | string | Yes | Account password |
| `deviceId` | string | No | Existing device ID to reuse (optional) |

**Response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "userId": "abc123",
  "deviceId": "A1B2C3D4E5F6",
  "homeserver": "localhost:3000"
}
```

**Errors:** `401 M_UNAUTHORIZED` (invalid credentials)

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "securepassword123"}'
```

---

### POST /auth/refresh

Exchange a refresh token for a new access token.

**Auth required:** No
**Rate limit:** Refresh limiter

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `refreshToken` | string | Yes | Valid refresh token from login/register |

**Response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:** `401 M_UNAUTHORIZED` (expired or revoked token)

---

### POST /auth/logout

Invalidate all refresh tokens for the authenticated user.

**Auth required:** Yes

**Response (200):**

```json
{ "success": true }
```

---

### GET /auth/profile

Get the authenticated user's profile information.

**Auth required:** Yes

**Response (200):**

```json
{
  "userId": "abc123",
  "username": "alice",
  "displayName": "Alice",
  "homeserver": "localhost:3000"
}
```

---

### PUT /auth/profile

Update the authenticated user's display name.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `displayName` | string | Yes | 1-64 characters |

**Response (200):**

```json
{
  "userId": "abc123",
  "displayName": "Alice Updated"
}
```

---

## Keys

All key endpoints set `Cache-Control: no-store` to prevent proxy caching of key material.

### POST /keys/upload

Upload device keys and/or one-time prekeys. Supports both the F.R.A.M.E. native format and the Matrix-compatible `device_keys` / `one_time_keys` format used by vodozemac's OlmMachine.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `device_keys` | object | No | Signed device keys object (Matrix format with `keys`, `signatures`, `unsigned`) |
| `one_time_keys` | object | No | Map of `algorithm:id` to signed key objects |
| `identityKey` | string | No | Curve25519 identity key (native format) |
| `signedPrekey` | string | No | Signed prekey (native format) |
| `signedPrekeySig` | string | No | Prekey signature (native format) |
| `oneTimePrekeys` | string[] | No | Array of up to 100 one-time prekeys (native format) |

When `device_keys` includes an Ed25519 signing key, the server verifies the self-signature before storing. The identity key is logged to the Merkle transparency tree.

**Response (200):**

```json
{
  "oneTimeKeyCount": 42
}
```

**Errors:** `400 M_MISSING_PARAM` (missing signatures), `400 M_UNKNOWN` (signature verification failed)

```bash
curl -X POST http://localhost:3000/keys/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "oneTimePrekeys": ["key1", "key2", "key3"],
    "signedPrekey": "base64-prekey...",
    "signedPrekeySig": "base64-sig..."
  }'
```

---

### POST /keys/query

Query device keys for one or more users. Required by vodozemac OlmMachine for establishing Olm sessions.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `device_keys` | object | Yes | Map of user IDs to device ID arrays or empty objects |

**Response (200):**

```json
{
  "device_keys": {
    "@bob:localhost:3000": {
      "DEVICE_ID": {
        "user_id": "@bob:localhost:3000",
        "device_id": "DEVICE_ID",
        "algorithms": ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"],
        "keys": {
          "curve25519:DEVICE_ID": "base64...",
          "ed25519:DEVICE_ID": "base64..."
        },
        "signatures": { ... }
      }
    }
  }
}
```

---

### POST /keys/claim

Claim one-time keys for devices to establish Olm sessions. Each one-time key can only be claimed once.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `one_time_keys` | object | Yes | Map of `userId` -> `deviceId` -> `algorithm` |

**Response (200):**

```json
{
  "one_time_keys": {
    "@bob:localhost:3000": {
      "DEVICE_ID": {
        "signed_curve25519:AAAAAQ": { "key": "base64...", "signatures": { ... } }
      }
    }
  }
}
```

---

### GET /keys/count

Get the remaining one-time prekey count for the authenticated device.

**Auth required:** Yes

**Response (200):**

```json
{
  "oneTimeKeyCount": 37
}
```

---

### POST /keys/revoke

Revoke all keys for a specified device. Marks the device as revoked and deletes its key bundle.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deviceId` | string | Yes | Device ID to revoke keys for |

**Response (200):**

```json
{
  "revoked": true,
  "deviceId": "A1B2C3D4"
}
```

---

### GET /keys/:userId

Fetch a user's key bundle, claiming one one-time prekey in the process.

**Auth required:** Yes

**Response (200):**

```json
{
  "userId": "abc123",
  "deviceId": "A1B2C3D4",
  "identityKey": "base64...",
  "signedPrekey": "base64...",
  "signedPrekeySignature": "base64...",
  "oneTimePrekey": "base64..."
}
```

**Errors:** `404 M_NOT_FOUND` (no key bundle for user)

```bash
curl http://localhost:3000/keys/bob123 \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /keys/transparency/:userId

Fetch the Merkle tree proof for a user's public key. Clients use this to verify the server has not substituted keys.

**Auth required:** Yes

**Response (200):**

```json
{
  "userId": "abc123",
  "publicKeyHash": "sha256...",
  "merkleRoot": "sha256...",
  "merkleProof": ["hash1", "hash2", "hash3"],
  "timestamp": "2026-03-19T00:00:00Z"
}
```

**Errors:** `404 M_NOT_FOUND` (no transparency log entry)

---

## Messages

### POST /messages/send

Send an encrypted message to a room. The content is an opaque encrypted blob -- the server stores it without reading it.

**Auth required:** Yes
**Rate limit:** Message limiter

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `roomId` | string | Yes | Target room ID |
| `eventType` | string | Yes | Event type (e.g., `m.room.encrypted`) |
| `content` | object | Yes | Encrypted content payload |

**Response (200):**

```json
{
  "eventId": "evt_abc123",
  "sequenceId": 42
}
```

```bash
curl -X POST http://localhost:3000/messages/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "room123",
    "eventType": "m.room.encrypted",
    "content": {"algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "..."}
  }'
```

---

### GET /messages/sync

Long-poll for new messages since a given sequence ID. Returns room events and to-device messages.

**Auth required:** Yes

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `since` | string | `"0"` | Sequence ID to sync from |
| `timeout` | number | `0` | Long-poll timeout in ms (max 30000) |
| `limit` | number | `50` | Max events to return (1-100) |

**Response (200):**

```json
{
  "events": [
    {
      "eventId": "evt_abc123",
      "roomId": "room123",
      "sender": "alice123",
      "eventType": "m.room.encrypted",
      "content": { ... },
      "sequenceId": 42,
      "timestamp": "2026-03-19T12:00:00Z"
    }
  ],
  "toDeviceMessages": [ ... ],
  "nextBatch": "43"
}
```

```bash
curl "http://localhost:3000/messages/sync?since=0&timeout=30000" \
  -H "Authorization: Bearer $TOKEN"
```

---

### DELETE /messages/:eventId

Soft-delete a message. Only the original sender can delete their own messages.

**Auth required:** Yes

**Response:** `204 No Content`

**Errors:** `403 M_FORBIDDEN` (not the sender), `404 M_NOT_FOUND`

---

### POST /messages/ack-to-device

Acknowledge receipt of to-device messages so they are not re-delivered.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messageIds` | number[] | Yes | Array of to-device message IDs (max 500) |

**Response (200):**

```json
{ "acknowledged": 5 }
```

---

### POST /messages/:eventId/react

Add or toggle a reaction on a message. User must be a member of the message's room.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `emoji` | string | Yes | Reaction emoji (1-8 chars) |

**Response (200):**

```json
{
  "eventId": "evt_abc123",
  "reactions": { ... }
}
```

**Errors:** `404 M_NOT_FOUND` (event not found), `403 M_FORBIDDEN` (not a room member)

---

### POST /messages/:eventId/read

Mark a message as read (read receipt). User must be a member of the message's room.

**Auth required:** Yes

**Response (200):**

```json
{ "success": true }
```

---

### GET /messages/read-receipts/:roomId

Get all read receipts for a room.

**Auth required:** Yes

**Response (200):**

```json
{
  "receipts": [
    { "userId": "alice123", "eventId": "evt_abc123", "timestamp": "..." }
  ]
}
```

**Errors:** `403 M_FORBIDDEN` (not a room member)

---

## Rooms

### POST /rooms/create

Create a new direct or group room.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `roomType` | string | Yes | `"direct"` or `"group"` |
| `inviteUserIds` | string[] | Yes | Array of user IDs to invite (1-50) |
| `name` | string | No | Room name (max 128 chars, for group rooms) |
| `isPrivate` | boolean | No | Whether the room is private (invite-only) |
| `password` | string | No | Room password (max 128 chars) |

**Response (201):**

```json
{
  "roomId": "room_abc123",
  "roomType": "group",
  "name": "Project Chat"
}
```

```bash
curl -X POST http://localhost:3000/rooms/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roomType": "direct", "inviteUserIds": ["bob123"]}'
```

---

### GET /rooms

List all rooms the authenticated user belongs to.

**Auth required:** Yes

**Response (200):**

```json
{
  "rooms": [
    {
      "roomId": "room_abc123",
      "roomType": "direct",
      "name": null,
      "lastEvent": { ... }
    }
  ]
}
```

---

### POST /rooms/:roomId/invite

Invite a user to a room. Only existing members can invite.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID to invite |

**Response (200):**

```json
{ "invited": true, "userId": "bob123", "roomId": "room_abc123" }
```

---

### POST /rooms/:roomId/join

Join a room the user has been invited to.

**Auth required:** Yes

**Response (200):**

```json
{ "joined": true, "roomId": "room_abc123" }
```

---

### POST /rooms/:roomId/join-with-password

Join a password-protected room.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `password` | string | Yes | Room password (1-128 chars) |

**Response (200):**

```json
{ "joined": true, "roomId": "room_abc123" }
```

**Errors:** `403 M_FORBIDDEN` (wrong password)

---

### PUT /rooms/:roomId/name

Rename a room. Only members can rename.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | New room name (1-128 chars) |

**Response (200):**

```json
{ "roomId": "room_abc123", "name": "New Name" }
```

---

### PUT /rooms/:roomId/settings

Update room settings (disappearing messages, privacy, password).

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `disappearingMessages` | object | No | `{ enabled: boolean, timeoutSeconds: number }` (max 604800 = 7 days) |
| `isPrivate` | boolean | No | Toggle room privacy |
| `password` | string | No | Set or change room password |

**Response (200):**

```json
{ "roomId": "room_abc123", "settings": { ... } }
```

---

### GET /rooms/:roomId/settings

Get current room settings.

**Auth required:** Yes

**Response (200):**

```json
{
  "settings": {
    "disappearingMessages": { "enabled": false, "timeoutSeconds": 0 },
    "isPrivate": false
  }
}
```

---

### DELETE /rooms/:roomId/leave

Leave a room.

**Auth required:** Yes

**Response (200):**

```json
{ "left": true, "roomId": "room_abc123" }
```

---

### GET /rooms/:roomId/members

List all members of a room. Only members can view the list.

**Auth required:** Yes

**Response (200):**

```json
{
  "members": [
    { "userId": "alice123", "displayName": "Alice", "joinedAt": "..." }
  ]
}
```

---

## Devices

### POST /devices/register

Register a new device with its public keys.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deviceId` | string | Yes | Unique device identifier |
| `devicePublicKey` | string | Yes | Curve25519 device public key |
| `deviceSigningKey` | string | Yes | Ed25519 device signing key |
| `deviceDisplayName` | string | No | Human-readable name (max 64 chars) |

**Response (201):**

```json
{
  "deviceId": "A1B2C3D4",
  "registered": true
}
```

---

### GET /devices/:userId

List all devices for a user. Users can view their own devices or devices of users they share a room with.

**Auth required:** Yes

**Response (200):**

```json
{
  "devices": [
    {
      "deviceId": "A1B2C3D4",
      "displayName": "Chrome on MacBook",
      "lastSeen": "2026-03-19T12:00:00Z"
    }
  ]
}
```

**Errors:** `403 M_FORBIDDEN` (no shared room with target user)

```bash
curl http://localhost:3000/devices/alice123 \
  -H "Authorization: Bearer $TOKEN"
```

---

### DELETE /devices/:deviceId

Remove and revoke a device. Only the device owner can remove it.

**Auth required:** Yes

**Response (200):**

```json
{ "removed": true, "deviceId": "A1B2C3D4" }
```

---

### POST /devices/heartbeat

Update the device's last-seen timestamp.

**Auth required:** Yes

**Response (200):**

```json
{ "ok": true }
```

---

## To-Device Messaging

### PUT /sendToDevice/:eventType/:txnId

Send messages directly to specific user devices. Used by vodozemac for Megolm room key sharing and Olm session establishment.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | object | Yes | Map of `userId` -> `deviceId` -> content (max 100 recipients) |

**Response (200):**

```json
{}
```

Messages are stored in PostgreSQL for reliable delivery and recipients are notified via Redis pub/sub.

```bash
curl -X PUT "http://localhost:3000/sendToDevice/m.room_key/txn001" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": {
      "bob123": {
        "DEVICE_XYZ": {
          "algorithm": "m.olm.v1.curve25519-aes-sha2",
          "ciphertext": { ... }
        }
      }
    }
  }'
```

---

## Push Notifications

### GET /push/vapid-key

Get the server's VAPID public key for Web Push subscription.

**Auth required:** Yes

**Response (200):**

```json
{ "publicKey": "BNr..." }
```

**Errors:** `503 M_NOT_CONFIGURED` (VAPID keys not set)

---

### POST /push/subscribe

Register a Web Push subscription for the authenticated device.

**Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | Yes | Push service endpoint URL |
| `keys.p256dh` | string | Yes | Client public key |
| `keys.auth` | string | Yes | Auth secret |

**Response (201):**

```json
{ "success": true }
```

---

### DELETE /push/unsubscribe

Remove the push subscription for the authenticated device.

**Auth required:** Yes

**Response (200):**

```json
{ "success": true }
```

**Errors:** `404 M_NOT_FOUND` (no subscription for this device)

---

## Federation

Federation endpoints are used for server-to-server communication. They do not require user JWT auth but verify peer identity through trusted peer lists and origin headers.

### POST /federation/send

Accept signed events from a trusted peer server.

**Auth required:** No (peer trust verification via origin)

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `events` | array | Yes | Array of 1-100 signed federation events |

Each event must include: `origin`, `originServerTs`, `eventId`, `roomId`, `sender`, `eventType`, `content`, `signatures`.

**Response (200):**

```json
{
  "results": [
    { "eventId": "evt_abc", "status": "ok" },
    { "eventId": "evt_def", "status": "error", "error": "..." }
  ]
}
```

**Errors:** `403 M_FORBIDDEN` (origin is not a trusted peer)

---

### GET /federation/keys/:userId

Fetch a user's public key bundle for cross-server key exchange.

**Auth required:** No

**Response (200):**

```json
{
  "userId": "alice123",
  "deviceId": "A1B2C3D4",
  "identityKey": "base64...",
  "signingKey": "base64...",
  "signedPrekey": "base64...",
  "signedPrekeySignature": "base64...",
  "oneTimePrekeys": ["otk1", "otk2"]
}
```

---

### GET /federation/backfill

Backfill events for a room from a peer server. Requires `X-Origin-Server` header from a trusted peer.

**Auth required:** No (peer trust verification)

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `roomId` | string | required | Room to backfill |
| `since` | number | `0` | Sequence ID to start from |
| `limit` | number | `50` | Max events (1-100) |

**Response (200):**

```json
{
  "events": [ ... ],
  "hasMore": true
}
```

---

### GET /federation/query/directory

Look up a user and their room memberships. Used for cross-server room resolution.

**Auth required:** No (peer trust verification)

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID to look up |

**Response (200):**

```json
{
  "exists": true,
  "userId": "alice123",
  "displayName": "alice",
  "rooms": [{ "roomId": "room_abc" }]
}
```

---

## Discovery

### GET /.well-known/frame/server

Server discovery endpoint for federation. Returns server identity and public key.

**Auth required:** No

**Response (200):**

```json
{
  "frame.server": {
    "host": "localhost:3000",
    "port": 3000,
    "publicKey": "base64-ed25519-public-key..."
  }
}
```

---

### GET /

Root endpoint returning server info and available API paths.

**Auth required:** No

**Response (200):**

```json
{
  "name": "F.R.A.M.E. Homeserver",
  "version": "1.0.0",
  "domain": "localhost:3000",
  "endpoints": {
    "health": "/health",
    "auth": "/auth",
    "keys": "/keys",
    "messages": "/messages",
    "devices": "/devices",
    "rooms": "/rooms",
    "federation": "/federation",
    "push": "/push",
    "discovery": "/.well-known/frame/server"
  }
}
```
