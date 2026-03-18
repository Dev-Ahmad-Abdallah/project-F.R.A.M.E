# Feature: Database Schema & Storage

**Owner:** Ahmed Ali Abdallah (234742)
**Priority:** Week 1-2
**Status:** Planned

---

## Overview

PostgreSQL serves as the persistent storage layer for all homeserver data. The database stores user accounts, device registrations, room membership, encrypted message events, key bundles, and delivery state. **No plaintext message content is ever stored** — only encrypted blobs.

---

## Schema

### Core Tables

```sql
-- Users
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,              -- @username:homeserver.domain
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,           -- bcrypt
  homeserver TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Devices
CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  device_public_key TEXT NOT NULL,       -- Curve25519
  device_signing_key TEXT NOT NULL,      -- Ed25519
  display_name TEXT,
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_devices_user ON devices(user_id);

-- Rooms
CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY,              -- !roomid:homeserver.domain
  room_type TEXT NOT NULL DEFAULT 'direct', -- direct | group
  created_by TEXT REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Room Membership
CREATE TABLE room_members (
  room_id TEXT REFERENCES rooms(room_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',            -- member | admin
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- Encrypted Events (Messages)
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,             -- $eventid
  room_id TEXT REFERENCES rooms(room_id),
  sender_id TEXT REFERENCES users(user_id),
  sender_device_id TEXT REFERENCES devices(device_id),
  event_type TEXT NOT NULL,              -- m.room.encrypted, m.room.member, etc.
  ciphertext BYTEA,                      -- Encrypted blob (NEVER decrypted by server)
  sequence_id BIGSERIAL,                 -- Monotonically increasing per room
  origin_server TEXT,                    -- For federated events
  origin_ts TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_events_room_seq ON events(room_id, sequence_id);
CREATE INDEX idx_events_room_ts ON events(room_id, origin_ts);

-- Key Bundles
CREATE TABLE key_bundles (
  user_id TEXT REFERENCES users(user_id),
  device_id TEXT REFERENCES devices(device_id),
  identity_key TEXT NOT NULL,
  signed_prekey TEXT NOT NULL,
  signed_prekey_signature TEXT NOT NULL,
  one_time_prekeys JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id)
);

-- Key Transparency Log (Append-Only)
CREATE TABLE key_transparency_log (
  log_id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  merkle_proof JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_ktl_user ON key_transparency_log(user_id);

-- Delivery State
CREATE TABLE delivery_state (
  event_id TEXT REFERENCES events(event_id),
  device_id TEXT REFERENCES devices(device_id),
  status TEXT DEFAULT 'pending',         -- pending | delivered | failed
  attempts INT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (event_id, device_id)
);
CREATE INDEX idx_delivery_pending ON delivery_state(device_id, status) WHERE status = 'pending';
```

### Redis Structures

```
# Message delivery queue per device
LPUSH queue:device:{device_id} {event_id}

# Online status
SET online:{device_id} 1 EX 300

# Rate limiting
INCR ratelimit:{ip}:{endpoint}
EXPIRE ratelimit:{ip}:{endpoint} 60

# Refresh tokens
SET refresh:{token_hash} {user_id}:{device_id} EX 604800
```

---

## Data Privacy Rules

| Data | Stored | Encrypted | Retention |
|------|--------|-----------|-----------|
| User credentials | password_hash only | bcrypt | Until account deletion |
| Device public keys | Yes | No (public data) | Until device removal |
| Message content | Ciphertext only | E2EE by client | Configurable (default: 30 days) |
| Delivery state | Yes | No | Purge after confirmation |
| Key transparency log | Yes | No (public proofs) | Permanent (append-only) |
| Session state | No (client-only) | N/A | N/A |

---

## Security Considerations

1. **No plaintext messages in database** — only ciphertext blobs
2. **Parameterized queries only** — prevent SQL injection
3. **Connection pooling** — use pg pool to manage connections
4. **Encrypted connections** — PostgreSQL SSL enabled
5. **Minimal indexes** — only what's needed for query performance
6. **Backup encryption** — database backups must be encrypted at rest
7. **Audit trail** — key_transparency_log is never modified or deleted
