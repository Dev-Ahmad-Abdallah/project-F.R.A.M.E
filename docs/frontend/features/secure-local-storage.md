# Feature: Secure Local Storage (IndexedDB)

**Owner:** Mohamed Hussain (235697)
**Priority:** Week 3
**Status:** Planned

---

## Overview

All cryptographic state — keys, ratchet states, message history — lives on the user's device, not on the server. IndexedDB provides structured, persistent storage with at-rest encryption to protect this data even if the device is compromised.

---

## What Gets Stored

| Store Name | Contents | Encryption |
|-----------|----------|------------|
| `keys` | Own identity keys, signed prekeys, one-time prekeys (private) | Encrypted at rest |
| `sessions` | Olm/Megolm session state per device pair | Encrypted at rest |
| `messages` | Encrypted message history + metadata | Encrypted at rest |
| `devices` | Known devices per contact (public keys, verification status) | Encrypted at rest |
| `verification` | Verified fingerprints, Merkle roots, key change history | Encrypted at rest |

---

## Implementation

### Key Files

```
src/storage/
└── secureStorage.ts     # IndexedDB wrapper with at-rest encryption
```

### secureStorage.ts

**Responsibilities:**
- Open/create IndexedDB database with versioned schema
- Encrypt all values before writing using a storage encryption key
- Decrypt values on read
- Storage encryption key derived from user passphrase via PBKDF2 (Web Crypto API)
- Provide typed CRUD operations for each store
- Handle schema migrations between versions

### At-Rest Encryption Flow

```
Write Path:
1. Serialize value to JSON
2. Generate random IV (12 bytes)
3. Encrypt with AES-GCM using storage key
4. Store: { iv, ciphertext } in IndexedDB

Read Path:
1. Fetch { iv, ciphertext } from IndexedDB
2. Decrypt with AES-GCM using storage key
3. Parse JSON → return typed object

Storage Key Derivation:
1. User enters passphrase (on app unlock)
2. PBKDF2(passphrase, salt, 100000 iterations, SHA-256) → AES-256 key
3. Salt stored in IndexedDB (not secret, just unique)
4. Key held in memory only — never persisted
```

---

## Security Rules

1. **Never use `localStorage`** for any sensitive data (synchronous, no encryption, accessible to XSS)
2. **Never store private keys in plaintext** — always encrypted at rest
3. **Storage encryption key never persisted** — derived from passphrase, held in memory
4. **Wipe key material from memory** when app is locked or closed
5. **Use `idb` wrapper library** for cleaner async IndexedDB API
6. **Atomic transactions** — don't leave partial state on crash

---

## Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IndexedDB over localStorage | Async, structured, larger capacity, better for binary data | localStorage is synchronous, limited, and XSS-accessible |
| AES-256-GCM for at-rest | Authenticated encryption, hardware-accelerated in browsers | Standard choice, Web Crypto API supports natively |
| PBKDF2 for key derivation | CPU-hard, adjustable iterations | scrypt/argon2 not in Web Crypto API natively |
| `idb` library | Cleaner API over raw IndexedDB | Raw IndexedDB API is callback-based and error-prone |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| IndexedDB cleared by browser (storage eviction) | Critical — loss of crypto state | Request persistent storage permission; warn user |
| Passphrase forgotten — key unrecoverable | Critical — all local data lost | Provide recovery flow via new device linking |
| Side-channel attacks on Web Crypto | High | Use constant-time operations where possible; rely on browser implementation |
| Database corruption | High | Validate data on read; handle gracefully |

---

## Testing

- [ ] Encrypted data in IndexedDB cannot be read without passphrase
- [ ] Storage key derivation produces consistent key from same passphrase + salt
- [ ] Data survives app restart and page reload
- [ ] Clearing storage key from memory prevents further reads without re-auth
- [ ] Schema migration works when adding new stores
