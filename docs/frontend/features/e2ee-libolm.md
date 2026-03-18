# Feature: End-to-End Encryption with vodozemac (WASM)

**Owner:** Mohamed Hussain (235697)
**Priority:** Week 3 (Core)
**Status:** Planned

---

## Overview

Every message is encrypted on the sender's device and can only be decrypted on the recipient's device. The server never sees plaintext. This is the foundational feature of F.R.A.M.E. — everything else depends on this working correctly.

> **Decision (AD-002):** We use **vodozemac** (via `matrix-sdk-crypto-wasm`) instead of the deprecated libolm. vodozemac is a maintained, audited Rust implementation compiled to WASM. libolm is no longer receiving security patches. See [architecture-critique.md](../../architecture-critique.md) for full rationale.

---

## Protocols

### Olm Protocol (1-to-1 Sessions)
- Based on Signal's **Double Ratchet Algorithm**
- Each device-to-device pair gets its own independent Olm session
- Provides **forward secrecy**: each message uses a fresh key derived from ratchet state
- Provides **post-compromise security**: ratchet heals after key compromise
- vodozemac includes fixes for race conditions during simultaneous session initiation that libolm never received

### Megolm Protocol (Group Sessions)
- Optimized for group chats — sender generates one ratchet key shared with the group
- Avoids N separate encryptions per message (only one encryption + N key distributions)
- Outbound session: sender creates and shares with room members
- Inbound session: recipients receive key to decrypt sender's messages
- **Key rotation**: new outbound session when membership changes or after N messages

---

## Implementation

### Key Files

```
src/crypto/
├── keyManager.ts        # Key generation, storage, rotation
├── olmSession.ts        # Olm 1:1 session lifecycle
├── megolmSession.ts     # Megolm group session management
└── cryptoUtils.ts       # Web Crypto API wrappers
```

### keyManager.ts

**Responsibilities:**
- Generate identity key pair (Curve25519) on first launch using Web Crypto API
- Generate batch of one-time prekeys (e.g., 50 at a time)
- Generate signed prekey (rotated periodically)
- Publish public keys to backend: `POST /keys/upload`
- Store private keys in IndexedDB (encrypted at rest)
- Monitor one-time prekey count — replenish when below threshold

**Key Generation Flow:**
```
First Launch:
1. Generate Curve25519 identity key pair (Web Crypto API)
2. Generate Ed25519 signing key pair
3. Generate signed prekey + signature
4. Generate 50 one-time prekeys
5. Store all private keys in encrypted IndexedDB
6. Upload public keys to homeserver: POST /keys/upload
   Payload: { identityKey, signedPrekey, signedPrekeySig, oneTimePrekeys[] }
```

### olmSession.ts

**Responsibilities:**
- Create outbound Olm session (initiator side)
- Create inbound Olm session (responder side)
- Encrypt/decrypt individual messages within a session
- Persist session state to IndexedDB after each operation
- Handle session recovery and fallback keys

**Session Creation Flow:**
```
Sender (Alice) → Recipient (Bob):
1. Alice fetches Bob's key bundle: GET /keys/:bobId
   Response: { identityKey, signedPrekey, oneTimePrekey }
2. Alice creates outbound Olm session using Bob's keys
3. Alice encrypts first message → produces Olm prekey message
4. Alice sends ciphertext: POST /messages/send
5. Bob receives ciphertext: GET /messages/sync
6. Bob creates inbound Olm session from prekey message
7. Bob decrypts → gets plaintext
8. Ratchet advances on both sides
```

### megolmSession.ts

**Responsibilities:**
- Create outbound Megolm session for a room
- Distribute session key to all room members via Olm 1:1 sessions
- Encrypt messages using outbound session
- Decrypt messages using inbound session
- Rotate outbound session on: member join/leave, after N messages, periodically

**Group Encryption Flow:**
```
Sender encrypts for group:
1. Check if outbound Megolm session exists for this room
2. If not → create new session, distribute key to all members via Olm
3. Encrypt plaintext with Megolm outbound session
4. Send ciphertext to room: POST /messages/send
5. Each recipient decrypts using their inbound Megolm session
```

### cryptoUtils.ts

**Responsibilities:**
- Wrapper around Web Crypto API for common operations
- `generateKeyPair()` — Curve25519 key pair generation
- `deriveKey(passphrase, salt)` — PBKDF2 key derivation for at-rest encryption
- `hash(data)` — SHA-256 hashing for fingerprints
- `sign(data, privateKey)` / `verify(data, signature, publicKey)` — Ed25519 signatures
- `randomBytes(n)` — Cryptographically secure random generation

---

## Security Properties

| Property | How Achieved |
|----------|-------------|
| **Confidentiality** | Messages encrypted with Olm/Megolm; only recipient can decrypt |
| **Forward Secrecy** | Double Ratchet: each message uses derived key; compromised key doesn't expose past messages |
| **Post-Compromise Security** | Ratchet heals: after compromise, future messages become secure again |
| **Deniability** | Olm provides deniable authentication (sender can't be cryptographically proven) |
| **Replay Protection** | Ratchet state advances; replayed ciphertext fails decryption |

---

## Architectural Decisions

| Decision | Choice | Alternative Considered | Rationale |
|----------|--------|----------------------|-----------|
| Crypto library | vodozemac (Rust/WASM) via `matrix-sdk-crypto-wasm` | libolm (JS, deprecated) | vodozemac is maintained, audited, memory-safe. libolm is deprecated with no security patches. WASM build is handled by the npm package. |
| Key type | Curve25519 | X25519/Ed25519 via Web Crypto | vodozemac uses Curve25519 natively; Web Crypto for supplementary operations |
| Session persistence | IndexedDB | In-memory only | Sessions must survive page reloads; IndexedDB is persistent |
| Prekey count | 50 initial | 100+ | Sufficient for expected user count; replenish at 10 remaining |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| WASM binary size may be large | Medium | Lazy-load crypto module; acceptable for web app |
| Ratchet state corruption (browser crash mid-update) | High | Atomic IndexedDB transactions; backup session state |
| One-time prekey exhaustion | Medium | Monitor count; auto-replenish when below threshold |
| CPU blocking during crypto operations | Medium | Use Web Workers for heavy crypto; keep UI responsive |
| Memory exposure of private keys | High | Zero-out key material after use; minimize key lifetime in memory |

---

## Testing

- [ ] Key generation produces valid Curve25519 identity keys
- [ ] Olm session: encrypt on Device A, decrypt on Device B produces original plaintext
- [ ] Megolm: sender encrypts once, multiple recipients decrypt correctly
- [ ] Ratchet advances: same plaintext encrypted twice produces different ciphertext
- [ ] Session survives IndexedDB persistence and reload
- [ ] Prekey replenishment triggers at correct threshold
- [ ] Corrupted ciphertext is rejected (does not crash, returns error)
