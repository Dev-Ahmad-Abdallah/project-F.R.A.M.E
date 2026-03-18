# Feature: Key Management & Verification (Key Transparency)

**Owner:** Mohamed Hussain (235697)
**Priority:** Week 5
**Status:** Planned

---

## Overview

Users need assurance that the public key they receive from the server actually belongs to their contact and wasn't substituted by a malicious server (MitM attack). This is the #1 attack vector in E2EE systems. F.R.A.M.E. defends against this with two mechanisms: **automated Merkle proof verification** and **manual fingerprint comparison**.

---

## Mechanisms

### 1. Key Transparency (Automated)
- Backend maintains a **Merkle Tree append-only log** of all published public keys
- When the client fetches a contact's public key (`GET /keys/:userId`), it also fetches the Merkle proof (`GET /keys/transparency/:userId`)
- Client verifies the proof cryptographically: the key in the log must match what the server returned
- If mismatch detected → **block communication and alert user immediately**
- The Merkle root can be compared across clients to detect log inconsistencies

### 2. Fingerprint Verification (Manual / Out-of-Band)
- Display a short fingerprint (SHA-256 hash of the public key) that users can compare in person or via another channel
- Format: safety number (like Signal) or QR code
- Users scan each other's QR codes to confirm key authenticity
- Once verified, the contact is marked as "verified" in the UI

### 3. Key Change Detection
- If a contact's key changes (device reset, new device, or compromise), show a visible warning
- Block message sending until user acknowledges the change
- User can re-verify via fingerprint or accept the change

---

## Implementation

### Key Files

```
src/verification/
├── keyTransparency.ts   # Merkle proof verification logic
├── fingerprintUI.tsx    # QR code + safety numbers UI component
└── keyChangeAlert.tsx   # Alert component for key changes
```

### keyTransparency.ts

**Responsibilities:**
- Fetch Merkle proof from backend: `GET /keys/transparency/:userId`
- Verify proof against the claimed public key
- Compare Merkle root with previously known root (detect log manipulation)
- Cache verified keys locally to reduce network requests
- Expose verification status to UI components

**Verification Flow:**
```
1. Client fetches contact's key bundle: GET /keys/:userId
2. Client fetches Merkle proof: GET /keys/transparency/:userId
3. Compute hash of received public key
4. Walk the Merkle proof path from leaf to root
5. Compare computed root with proof's claimed root
6. If match → key is authentic (consistent with log)
7. If mismatch → ALERT: possible key substitution attack
8. Store verified key + Merkle root locally for future comparison
```

### fingerprintUI.tsx

**Responsibilities:**
- Generate fingerprint string from public key (SHA-256 → formatted as safety number)
- Display fingerprint as both text and QR code
- Scan QR code from camera (using browser MediaDevices API)
- Compare scanned fingerprint with local computation
- Mark contact as "verified" on successful match

### keyChangeAlert.tsx

**Responsibilities:**
- Monitor for key change events (new key detected for known contact)
- Display warning modal with clear explanation
- Options: "View Fingerprint" / "Accept New Key" / "Block Contact"
- Log key change event locally for audit trail

---

## Security Properties

| Property | How Achieved |
|----------|-------------|
| **Key Authenticity** | Merkle proof verification — server cannot silently substitute keys |
| **Tamper Detection** | Append-only log — any modification breaks the proof chain |
| **User Verification** | Fingerprint/QR comparison — out-of-band confirmation |
| **Change Awareness** | Key change alerts prevent silent key replacement |

---

## Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Merkle Tree over CONIKS | Simpler implementation for 8-week scope | CONIKS adds privacy features but more complexity |
| SHA-256 for fingerprints | Well-understood, sufficient collision resistance | Aligns with Signal's approach |
| QR code for verification | Lower friction than reading hex strings | Standard in secure messaging UX |
| Block on key mismatch | Fail-closed security model | User must acknowledge risk before proceeding |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Users ignore key change alerts | High | Make alerts modal (can't dismiss without action) |
| Merkle proof verification is slow | Medium | Cache verified keys; only re-verify on key change |
| QR code scanning fails in low light | Low | Always show text fingerprint as fallback |
| Merkle root comparison across clients | Complex | Start with single-server verification; cross-client in future |

---

## Testing

- [ ] Tampered Merkle proof is detected and rejected
- [ ] Key change alert fires when contact's key changes
- [ ] Fingerprint matches between two clients with same contact key
- [ ] QR code scan correctly verifies matching fingerprints
- [ ] Key mismatch blocks message sending until resolved
- [ ] Verified status persists across app restarts
