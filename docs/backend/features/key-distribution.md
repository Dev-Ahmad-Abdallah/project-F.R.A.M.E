# Feature: Key Distribution & Transparency

**Owner:** Ahmed Ali Abdallah (234742)
**Priority:** Week 5
**Status:** Planned

---

## Overview

The Key Distribution Layer stores and serves user public key bundles. The Key Transparency mechanism (Merkle Tree append-only log) ensures the server cannot silently substitute keys. Clients fetch keys from this layer and verify them against the transparency log before establishing encrypted sessions.

---

## Key Bundle Structure

Each user/device publishes a key bundle:

```json
{
  "user_id": "@alice:frame-a.railway.app",
  "device_id": "DEVICE_A1",
  "identity_key": "Curve25519:...",         // Long-term identity key
  "signed_prekey": "Curve25519:...",         // Rotated periodically
  "signed_prekey_signature": "Ed25519:...",  // Signature over signed_prekey
  "one_time_prekeys": [                     // Consumed on use
    "Curve25519:...",
    "Curve25519:...",
    // ... (50 initially)
  ]
}
```

---

## Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/keys/upload` | POST | JWT | Upload/replenish key bundle |
| `/keys/:userId` | GET | JWT | Fetch user's key bundle (claims one OTK) |
| `/keys/transparency/:userId` | GET | JWT | Fetch Merkle proof for key verification |

### Key Claim Flow

When Alice wants to message Bob:
```
1. Alice's client: GET /keys/@bob:frame-b.railway.app
2. Server returns Bob's key bundle:
   - identity_key
   - signed_prekey + signature
   - ONE one-time prekey (consumed — removed from available pool)
3. Alice's client: GET /keys/transparency/@bob:frame-b.railway.app
4. Server returns Merkle proof for Bob's identity key
5. Alice's client verifies proof → if valid, proceeds to create Olm session
6. If proof invalid → ALERT: possible key substitution
```

### One-Time Prekey Management
- Initial upload: 50 prekeys
- Server tracks available count
- When count drops below threshold → notify client to replenish
- Client uploads new batch: `POST /keys/upload`
- If no OTKs available → fall back to signed prekey only (less forward secrecy for first message)

---

## Key Transparency (Merkle Tree)

### Purpose
Prevent the server from silently substituting a user's public key (MitM attack). The Merkle Tree creates a cryptographic commitment to the current state of all published keys.

### How It Works

```
Merkle Tree:
                    [Root Hash]
                   /           \
            [Hash AB]          [Hash CD]
            /      \           /      \
      [Hash A]  [Hash B]  [Hash C]  [Hash D]
         │         │         │         │
      Alice's   Bob's    Carol's   Dave's
      key hash  key hash  key hash key hash
```

- Each leaf = hash of a user's current public identity key
- Internal nodes = hash of their children
- Root hash = commitment to ALL keys in the system
- **Append-only**: new keys add leaves; old entries never removed or modified

### Merkle Proof

A proof that a specific key is in the tree:

```json
{
  "user_id": "@bob:frame-b.railway.app",
  "key_hash": "sha256:...",
  "proof_path": [
    { "position": "left", "hash": "sha256:..." },
    { "position": "right", "hash": "sha256:..." }
  ],
  "root": "sha256:...",
  "timestamp": "2026-03-18T12:00:00Z"
}
```

Client walks the proof path from leaf to root. If computed root matches claimed root → key is consistent with the log.

---

## Database Schema

```sql
-- Key bundles
CREATE TABLE key_bundles (
  user_id TEXT REFERENCES users(user_id),
  device_id TEXT REFERENCES devices(device_id),
  identity_key TEXT NOT NULL,
  signed_prekey TEXT NOT NULL,
  signed_prekey_signature TEXT NOT NULL,
  one_time_prekeys JSONB DEFAULT '[]',
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id)
);

-- Key transparency log (append-only)
CREATE TABLE key_transparency_log (
  log_id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  merkle_proof JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Security Considerations

1. **Log is append-only** — never delete or modify entries
2. **One-time prekeys are single-use** — once claimed, removed from pool
3. **Key bundle served over HTTPS only** — TLS required
4. **Rate limit key fetch** — prevent scraping of all user keys
5. **Server publishes keys but clients verify** — server cannot guarantee its own honesty
6. **Merkle root must be consistent** — if different clients see different roots, log is corrupted
