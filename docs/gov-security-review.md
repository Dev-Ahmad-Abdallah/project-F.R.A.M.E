# Government Security Panel Evaluation

**Date:** 2026-03-18
**Classification Level Proposed:** Sensitive but Unclassified (SBU) / Controlled Unclassified Information (CUI)

---

## Panel Members & Verdicts

| Panelist | Role | Verdict |
|----------|------|---------|
| CISO | Crypto compliance, key management | **REJECT** |
| Intelligence Director | Metadata, surveillance resistance | **REJECT** |
| Compliance Officer | FedRAMP, audit, MFA | **REJECT** |
| Counter-Intelligence | Supply chain, insider threat | **REJECT** |
| Field Operations | Usability, reliability, native clients | **CONDITIONAL** |

**Consensus: REJECT for government deployment in current state. Architecture is sound — compliance and operational maturity gaps are the blockers.**

---

## What the System Gets Right

- Zero-trust server model — server never sees plaintext (correctly implemented)
- Opaque push notifications — genuinely leak zero metadata
- Client-side-only crypto via vodozemac WASM — private keys never leave WASM boundary
- Ed25519 federation signing with canonical JSON — prevents signature malleability
- Honest, transparent documentation of limitations (rare and valuable)
- Refresh token rotation with hash-based revocation
- Short-lived access tokens (15 minutes)
- Explicit peer trust allowlisting (no open federation)
- Store-and-forward architecture suits intermittent connectivity

---

## What Blocks Government Deployment

### P0 — Legal Requirements (Must Have)

| Requirement | Current State | Gap |
|-------------|--------------|-----|
| FIPS 140-2/3 crypto modules | Web Crypto API, vodozemac WASM, Node crypto | Not FIPS-validated |
| FedRAMP-authorized hosting | Railway PaaS | Not FedRAMP-authorized |
| Phishing-resistant MFA | Username/password only | No MFA at all |
| SBOM generation | Not implemented | EO 14028 requirement |

### P1 — Security Requirements

| Requirement | Current State | Gap |
|-------------|--------------|-----|
| Build vodozemac from source | Pre-compiled WASM from npm | Opaque binary, foreign jurisdiction |
| HSM-backed key storage | Environment variables in plaintext | No HSM integration |
| Tamper-evident audit logging | Minimal logging | NIST 800-53 AU family |
| Asymmetric JWT signing | HS256 with shared secret | Should be RS256/ES256 with HSM |

### P2 — Operational Requirements

| Requirement | Current State | Gap |
|-------------|--------------|-----|
| Metadata protection | Acknowledged limitation | No sealed sender, no mixnets |
| Native mobile clients | Web-only | No iOS/Android |
| RBAC | No role hierarchy | Admin, auditor, user roles needed |
| Password policy | 8-char minimum, no complexity | NIST 800-63B compliance |

---

## Comparison with Government-Approved Solutions

| | F.R.A.M.E. | Signal | Matrix/Element | Wickr (AWS) |
|---|-----------|--------|----------------|-------------|
| FIPS 140-2/3 | No | No | No | **Yes** |
| FedRAMP | No | No | No (self-host) | **Yes (High)** |
| E2EE | Strong | Strong | Strong | Strong |
| Metadata Protection | None | Sealed Sender | None | Partial |
| Native Clients | No | Yes | Yes | Yes |
| Open Source | Yes | Yes | Yes | No |
| Self-Hosting | Yes | Yes | Yes | No |
| Gov Adoption | None | Informal | UK MOD eval | **US DoD approved** |

---

## Path to Government Readiness

The architecture is fundamentally sound. The remediation path:

1. Replace Railway with FedRAMP-authorized infrastructure (AWS GovCloud, Azure Gov)
2. Build vodozemac from audited Rust source on government-controlled CI
3. Wrap crypto in FIPS-validated modules
4. Add FIDO2/WebAuthn + PIV/CAC authentication
5. Implement HSM-backed key storage (AWS KMS, Azure Key Vault)
6. Add comprehensive audit logging with tamper-evident storage
7. Generate SBOMs in CI pipeline
8. Develop native mobile clients
9. Commission third-party penetration test and source code audit
10. Complete ATO process

**F.R.A.M.E.'s strongest differentiator: honest, transparent documentation of limitations — a quality absent from most commercial offerings.**
