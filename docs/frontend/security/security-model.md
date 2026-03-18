# Frontend Security Model

**Owner:** Mohamed Hussain (235697)

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────┐
│              TRUSTED ZONE (Client)              │
│                                                 │
│  Crypto Engine │ Key Store │ Session State       │
│  Verification  │ DOMPurify │ Service Worker      │
│                                                 │
│  Everything inside this boundary is trusted.    │
│  All crypto operations happen here.             │
└──────────────────────┬──────────────────────────┘
                       │
              TRUST BOUNDARY (HTTPS/TLS)
                       │
┌──────────────────────▼──────────────────────────┐
│            UNTRUSTED ZONE (Network + Server)    │
│                                                 │
│  Homeserver │ Federation │ Push Services         │
│  CDN │ DNS │ ISP │ Any network intermediary      │
│                                                 │
│  Nothing outside the client is trusted.         │
│  Server could be compromised or malicious.      │
└─────────────────────────────────────────────────┘
```

---

## Threat Model

### Attack Surface

| Surface | Threat | Severity |
|---------|--------|----------|
| **Message rendering** | XSS injection via malicious message content | Critical |
| **Key exchange** | MitM key substitution by compromised server | Critical |
| **Local storage** | Key extraction from unencrypted IndexedDB | Critical |
| **Push notifications** | Metadata leak to Firebase/APNs | High |
| **Device registration** | Fake device injection to intercept messages | High |
| **JWT token** | Token theft via XSS or storage exposure | High |
| **Memory** | Key exposure in JavaScript heap | Medium |
| **Crypto implementation** | Timing attacks, incorrect ratchet handling | Medium |
| **Browser extensions** | Malicious extensions reading DOM/storage | Medium |

### Attacker Profiles

| Attacker | Capability | Goal |
|----------|-----------|------|
| **Compromised Server** | Can modify API responses, substitute keys, inject events | Read messages, impersonate users |
| **Network Attacker** | Can intercept/modify traffic (if TLS broken) | Read messages in transit |
| **Malicious User** | Can send crafted messages | XSS to steal keys/sessions |
| **Physical Access** | Can access device storage | Extract keys from IndexedDB |
| **Push Service Provider** | Can read push payloads | Learn communication patterns |

---

## Security Guarantees

### What the Frontend Guarantees

| Guarantee | How |
|-----------|-----|
| Messages encrypted before leaving device | vodozemac Olm/Megolm encryption (WASM) |
| Private keys never leave device | Generated and stored locally only |
| Server cannot silently substitute keys | Merkle proof verification |
| XSS cannot steal message content | DOMPurify sanitization |
| Push notifications leak no metadata | Service Worker + opaque payloads |
| New devices require explicit approval | QR-based device linking |
| Forward secrecy | Double Ratchet key advancement |
| Post-compromise security | Ratchet heals after key compromise |

### What the Frontend Does NOT Guarantee

| Non-Guarantee | Why |
|---------------|-----|
| Protection against compromised device OS | Out of scope — kernel-level threats |
| Protection against malicious browser extensions | Cannot sandbox extensions |
| Perfect side-channel resistance | JavaScript timing not fully controllable |
| Availability | Server can deny service; frontend can't prevent DoS |
| Metadata privacy against server | Server sees who talks to whom (timing, IP) |

---

## Defense-in-Depth Layers

```
Layer 1: Transport Security (TLS/HTTPS)
  → Prevents network-level eavesdropping

Layer 2: E2EE (vodozemac Olm/Megolm)
  → Prevents server from reading messages

Layer 3: Key Verification (Merkle + Fingerprints)
  → Prevents server from substituting keys

Layer 4: Input Sanitization (DOMPurify)
  → Prevents XSS from stealing crypto state

Layer 5: Secure Storage (Encrypted IndexedDB)
  → Prevents local data extraction

Layer 6: Notification Privacy (Service Worker)
  → Prevents metadata leak to push services

Layer 7: Device Verification (QR Linking)
  → Prevents fake device injection
```

Each layer protects against different threat vectors. No single layer is sufficient alone.
