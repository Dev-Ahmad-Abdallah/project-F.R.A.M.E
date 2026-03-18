# Backend Security Model

**Owner:** Ahmed Ali Abdallah (234742)

---

## Trust Model

The backend operates under a **zero-trust-for-content** model. The server has control over routing, key discovery, and protocol coordination — but it **never has access to message plaintext or private keys**.

```
┌─────────────────────────────────────────────────┐
│          SERVER CAPABILITIES (Has Access)        │
│                                                  │
│  - User accounts and credentials                 │
│  - Device registrations and public keys          │
│  - Room membership                               │
│  - Encrypted event blobs (ciphertext)            │
│  - Message routing metadata (who → whom, when)   │
│  - Delivery state                                │
│  - Key transparency log                          │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│          SERVER LIMITATIONS (No Access)          │
│                                                  │
│  - Message plaintext                             │
│  - Private encryption keys                       │
│  - Olm/Megolm session state                     │
│  - Decryption capabilities                       │
│  - Key verification decisions                    │
└─────────────────────────────────────────────────┘
```

---

## Threat Surface

### What a Compromised Server CAN Do

| Attack | Description | Defense |
|--------|------------|---------|
| **Key substitution (MitM)** | Serve fake public key for a user | Key Transparency Merkle proofs; client-side fingerprint verification |
| **Metadata collection** | Log who talks to whom and when | Minimal retention policies; no content logging |
| **Event ordering manipulation** | Reorder, delay, or drop messages | Client-side sequence verification; delivery receipts |
| **Fake device injection** | Add unauthorized device to user's device list | Client-side device verification (QR linking) |
| **Denial of service** | Refuse to deliver messages | Client detects missing events via sequence gaps |
| **Federation manipulation** | Forge events from other servers | Server signatures on all federation events |

### What a Compromised Server CANNOT Do

| Prevented Attack | Why |
|-----------------|-----|
| Read message content | Only ciphertext stored; no decryption keys on server |
| Impersonate users cryptographically | Private signing keys are client-only |
| Break forward secrecy | Ratchet state is client-only |
| Forge key transparency proofs | Merkle tree is mathematically verifiable |

---

## Defense Layers

### Layer 1: Authentication & Access Control
- JWT-based authentication on all endpoints
- Rate limiting on sensitive endpoints (login, registration, key fetch)
- Role-based authorization (user can only access own data + shared rooms)

### Layer 2: Data Integrity
- Encrypted events stored as immutable, append-only records
- Key transparency log is append-only (never modified)
- Server signatures on federation events

### Layer 3: Minimal Trust Surface
- Server stores only what's needed for routing and delivery
- No plaintext processing — server treats message content as opaque
- Delivery state purged after confirmation

### Layer 4: Federation Security
- TLS + server signing keys for peer authentication
- Event validation on federation ingress
- Rate limiting on federation endpoints
- Peer allowlisting capability

---

## Metadata Exposure

Even with E2EE, the server knows:

| Metadata | Visible? | Mitigation |
|----------|----------|-----------|
| Who is messaging whom | Yes (routing required) | Minimal logging; short retention |
| Message timing | Yes | No mitigation possible at this layer |
| Message size | Yes (ciphertext length) | Padding could help (not in scope) |
| Device information | Yes (fan-out required) | Minimal device metadata stored |
| IP addresses | Yes (network layer) | Not addressed in this project |
| Online/offline status | Yes (push delivery) | Short TTL on online status |

**Key insight from literature**: Even the best E2EE cannot hide metadata from the server. Full metadata protection requires mixnets or PIR, which are out of scope for this project but acknowledged as a limitation.
