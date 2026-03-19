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
├── olmMachine.ts        # WASM OlmMachine lifecycle, outgoing-request processing, multi-tab coordination
├── keyManager.ts        # Orchestrates OlmMachine init, key upload, and contact key retrieval
├── sessionManager.ts    # Olm/Megolm session establishment and message encrypt/decrypt
└── cryptoUtils.ts       # Web Crypto API wrappers (AES-GCM, PBKDF2, fingerprints)
```

### olmMachine.ts

**Responsibilities:**
- Initialise the WASM runtime (`initAsync`) and create the `OlmMachine` singleton
- OlmMachine auto-generates Curve25519 + Ed25519 identity keys inside the WASM boundary
- Process outgoing requests (KeysUpload, KeysQuery, KeysClaim, ToDevice) and feed responses back via `markRequestAsSent`
- Mutex-protect concurrent access to OlmMachine methods
- Multi-tab coordination via BroadcastChannel to prevent concurrent instances
- Monitor one-time prekey count and auto-replenish when below threshold

**Outgoing Request Flow:**
```
processOutgoingRequests():
1. Acquire mutex (serialise concurrent callers)
2. Call machine.outgoingRequests() → list of pending requests
3. For each request, dispatch to the correct homeserver endpoint:
   - KeysUpload  → POST /keys/upload
   - KeysQuery   → POST /keys/query
   - KeysClaim   → POST /keys/claim
   - ToDevice    → PUT /sendToDevice/:eventType/:txnId
4. Feed each response back via machine.markRequestAsSent()
5. Release mutex
```

### keyManager.ts

**Responsibilities:**
- High-level orchestrator that delegates key generation to OlmMachine
- Calls `initCrypto()` (which creates the OlmMachine and auto-generates keys)
- Extracts public identity keys via `getIdentityKeys()` and uploads them
- Triggers `processOutgoingRequests()` to push the OlmMachine's KeysUploadRequest (signed pre-key + one-time pre-keys)
- Fetches contact key bundles and verifies them against the key transparency log

**Key Generation Flow (delegation pattern):**
```
First Launch:
1. initCrypto(userId, deviceId) → OlmMachine auto-generates all keys inside WASM
2. getIdentityKeys() → extract Curve25519 + Ed25519 public keys
3. processOutgoingRequests() → OlmMachine pushes KeysUploadRequest to server
   (contains signed pre-key, signature, and one-time pre-keys)
4. uploadKeys() → secondary identity key upload for homeserver key directory
```

### sessionManager.ts

**Responsibilities:**
- Establish Olm 1:1 sessions and Megolm group sessions using the OlmMachine
- Encrypt/decrypt messages through the OlmMachine's session management
- Handle session key distribution to room members
- Rotate outbound Megolm sessions on membership changes

### cryptoUtils.ts

**Responsibilities:**
- Wrapper around Web Crypto API for supplementary cryptographic operations
- `deriveStorageKey(passphrase, salt)` — PBKDF2 key derivation (100k iterations) for AES-256-GCM at-rest encryption
- `encryptData(key, data)` — AES-256-GCM encrypt with fresh random IV
- `decryptData(key, iv, ciphertext)` — AES-256-GCM decrypt
- `generateFingerprint(publicKey)` — SHA-256 fingerprint as lowercase hex string (for safety-number display)
- `randomBytes(n)` — Cryptographically secure random generation via `crypto.getRandomValues`

> **Note:** Curve25519/Ed25519 key generation and Olm/Megolm signing are handled entirely by vodozemac inside the WASM boundary. cryptoUtils.ts only provides Web Crypto API helpers for at-rest encryption and fingerprinting.

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
| Key management | OlmMachine delegation (keys generated inside WASM) | Manual key generation via Web Crypto API | OlmMachine handles all Olm/Megolm key lifecycle internally; reduces surface for key-handling bugs |
| Supplementary crypto | Web Crypto API (AES-GCM, PBKDF2, SHA-256) | Third-party JS crypto libraries | Native browser API; non-extractable keys; used only for at-rest encryption and fingerprinting |
| Session persistence | IndexedDB (passphrase-protected store per user/device) | In-memory only | Sessions must survive page reloads; IndexedDB is persistent; store name scoped to user+device to avoid key confusion |
| Multi-tab safety | BroadcastChannel coordination | No coordination | Concurrent OlmMachine instances sharing IndexedDB cause key conflicts and decryption failures |
| Prekey count | 50 initial | 100+ | Sufficient for expected user count; auto-replenish via `checkAndReplenishPrekeys()` when count drops below 10 |

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
