# Project F.R.A.M.E. — Final Deep Audit Report

**Date:** 2026-03-19
**Audited by:** 10 parallel agents analyzing code vs docs across all system pillars

---

## Executive Summary

**Overall Verdict: The project EXCEEDED the original Phase 2 plan.**

- Core scope: 100% of 8-week milestones delivered
- 22 bonus features beyond the proposal
- 27 architectural decisions formally documented
- 147 unit tests passing across 7 suites
- 33 API endpoints implemented

**However**, the audit found specific gaps between documentation and implementation that need attention.

---

## Scorecard by Area

| Area | Score | Status |
|------|-------|--------|
| E2EE (Olm/Megolm) | 8/10 | Core works; docs outdated for file structure |
| Federation | 7/10 | Core works; circuit breaker + directory query missing |
| Key Transparency | 7/10 | Core works; key rotation doesn't update log |
| Security Model | 9/10 | 16/18 checks pass; 2 partial |
| Deployment | 6/10 | Docker/Railway work; monitoring/logging unimplemented |
| Device Management | 7/10 | Core works; key rotation on revoke not triggered |
| Notifications | 6/10 | Security correct; push subscription pipeline incomplete |
| Storage + XSS | 9/10 | Strong; DOMPurify config should be stricter |
| API Contract | 9/10 | 33/33 endpoints exist; 2 lack formal validation |
| Timeline + Deliverables | 10/10 | Exceeded plan; 22 bonus features |

---

## CRITICAL Issues (Must Fix)

| # | Issue | Area | Description |
|---|-------|------|-------------|
| 1 | Key rotation doesn't update transparency log | Key Transparency | `POST /keys/upload` can update identity keys but never calls `addKeyToLog()`. Keys changed after registration are invisible to the transparency log. |
| 2 | Health check always returns 200 | Deployment | Railway can't detect unhealthy services since `/health` returns 200 even when DB/Redis are down. Defeats auto-restart. |
| 3 | PostgreSQL SSL `rejectUnauthorized: false` | Security | Production DB connections accept any certificate. `DB_SSL_REJECT_UNAUTHORIZED` config exists but isn't wired to the pool. |

---

## HIGH Issues (Should Fix)

| # | Issue | Area | Description |
|---|-------|------|-------------|
| 4 | Federation circuit breaker missing | Federation | Documented in 3 places but zero implementation. No tracking of peer failure rates. |
| 5 | Federation backfill has no peer auth | Federation | `GET /federation/backfill` doesn't verify the requester is a trusted peer. Anyone can dump room history. |
| 6 | No CodeQL SAST in CI | Deployment | GitHub Actions has no CodeQL scanning despite documentation promising it. |
| 7 | Push subscription pipeline incomplete | Notifications | No server-side `/push/subscribe` or `/push/vapid-key` endpoints. Push notifications can't work end-to-end. |
| 8 | Device key rotation not triggered on revocation | Devices | Removing a device doesn't trigger Megolm key rotation in affected rooms. |
| 9 | No `.dockerignore` | Deployment | Missing file means Docker builds include `.git`, `node_modules`, `.env`, and test files. |

---

## MEDIUM Issues (Should Address)

| # | Issue | Area | Description |
|---|-------|------|-------------|
| 10 | Docs describe `olmSession.ts` + `megolmSession.ts` | E2EE | These files don't exist. Replaced by `olmMachine.ts` + `sessionManager.ts`. Feature docs need updating. |
| 11 | `cryptoUtils.ts` missing documented functions | E2EE | Docs promise `generateKeyPair()`, `sign()`, `verify()` — none exist. Delegation to vodozemac is correct but docs are wrong. |
| 12 | No prekey replenishment monitoring | E2EE | Docs promise "auto-replenish when below threshold (10 remaining)". No threshold logic exists. |
| 13 | DOMPurify uses default config | XSS | Docs specify strict allowlist config (`ALLOWED_TAGS`, `FORBID_TAGS`). All 4 components use `DOMPurify.sanitize()` with no config. |
| 14 | No structured logging | Deployment | Docs promise JSON structured logging. Only raw `console.*` is used. |
| 15 | `sendToDevice` endpoint lacks Zod validation | API | Inline validation only (`typeof messages !== 'object'`). Every other endpoint uses Zod. |
| 16 | QR code scanning not implemented | Devices | QR code generation works but camera-based scanning is a placeholder. |
| 17 | VAPID key not in `.env.example` | Notifications | Push notification configuration is undocumented for deployment. |
| 18 | `npm install` in CI instead of `npm ci` | Deployment | Docs recommend lockfile integrity via `npm ci`. CI uses `npm install`. |
| 19 | Verified device status persistence unclear | Key Transparency | `onVerified` callback fires but unclear if persisted to secureStorage. |
| 20 | Federation `query/directory` endpoint missing | Federation | Documented in federation feature doc but no route exists. |
| 21 | No max device limit enforced | Devices | Docs identify this risk; no server-side enforcement. |

---

## LOW Issues (Nice to Fix)

| # | Issue | Area |
|---|-------|------|
| 22 | No backup/recovery key mechanism for lost devices | Devices |
| 23 | No QR nonce/timestamp (replay attack vector documented but unmitigated) | Devices |
| 24 | Device ID stored in localStorage (minor info leak to XSS) | Storage |
| 25 | `lastMessage` field never populated in room list | API |
| 26 | Unread counts always start at 0 (no server-side tracking) | Notifications |
| 27 | GitHub Actions not pinned by SHA | Deployment |
| 28 | No Docker image vulnerability scanning | Deployment |
| 29 | Frontend `notifications.ts` has 2 raw `fetch()` calls bypassing `client.ts` | Security |
| 30 | No pre-commit hooks (detect-secrets) | Deployment |

---

## Contradictions Between Docs and Code

| Doc Says | Code Does | Resolution |
|----------|-----------|-----------|
| Files: `olmSession.ts`, `megolmSession.ts` | Files: `olmMachine.ts`, `sessionManager.ts` | Update docs (code is correct — vodozemac OlmMachine is the right abstraction) |
| "Generate Curve25519 key pair (Web Crypto API)" | Key generation via vodozemac WASM | Update docs (Web Crypto has no Curve25519 support) |
| `cryptoUtils.ts` has `generateKeyPair()`, `sign()`, `verify()` | These functions don't exist | Update docs (delegation to vodozemac is correct) |
| "Auto-replenish OTKs when below threshold" | No threshold monitoring | Add monitoring or update docs |
| "Federation circuit breaker" | Not implemented | Implement or remove from docs |
| "Structured JSON logging" | Raw `console.*` | Implement pino/winston or update docs |
| "DOMPurify strict config" | Default config used | Add config or update docs |
| Health returns 503 on degraded | Always returns 200 | Fix: return 503 when services down, or document the Railway-specific reasoning |

---

## Features Built Beyond Original Plan

These 22 features were NOT in the Phase 2 proposal but were implemented:

1. Landing page with hero, features, trust signals
2. Disappearing messages (30s to 7 days)
3. View-once messages
4. Password-protected rooms
5. Star/pin conversations
6. Archive conversations
7. Room renaming
8. Room settings panel
9. Message deletion (soft-delete)
10. Leave room functionality
11. Session timeout with auto-lock
12. Lock screen requiring user ID
13. Session warning banner (60s countdown)
14. Optimistic message sending (sending/sent/failed states)
15. Message grouping + date separators
16. Search/filter bar in room list
17. Textarea with auto-grow + Shift+Enter
18. "New messages" scroll pill
19. Error boundary (crash recovery)
20. Mobile responsive (8 components)
21. Global hover/focus/scrollbar styles
22. Government security panel review

---

## What's Working Well

- **E2EE core**: vodozemac integration is solid. Encrypt/decrypt lifecycle works end-to-end.
- **Federation**: Server signing, peer trust, event relay all functional.
- **Security posture**: 16/18 security checklist items pass. No XSS vectors. No SQL injection. JWT in memory only.
- **API completeness**: 33 endpoints, all with real implementations, auth, and rate limiting.
- **Test coverage**: 147 tests across 7 suites covering auth, messages, rooms, keys, validation, federation.
- **Documentation**: 37+ doc files, 27 architectural decisions, comprehensive threat model.
- **Build**: All 3 services compile clean. Docker builds work. CI pipeline runs.

---

## Recommended Priority for Next Steps

### P0 (Fix Now — Security/Correctness)
1. Wire `addKeyToLog()` into `/keys/upload` for key rotation transparency
2. Fix health endpoint: return 503 when DB/Redis disconnected
3. Wire `DB_SSL_REJECT_UNAUTHORIZED` config to pool.ts SSL settings
4. Add `.dockerignore` file

### P1 (Fix Soon — Documented but Missing)
5. Add backfill peer authentication
6. Add CodeQL workflow to CI
7. Build push subscription server endpoints (`/push/subscribe`, `/push/vapid-key`)
8. Trigger key rotation in rooms when a device is revoked
9. DOMPurify strict config on all 4 components

### P2 (Fix Later — Polish)
10. Update E2EE feature docs to match vodozemac architecture
11. Add structured logging (pino)
12. Add federation circuit breaker
13. Pin GitHub Actions by SHA
14. Add Docker image scanning
15. Implement QR code camera scanning
