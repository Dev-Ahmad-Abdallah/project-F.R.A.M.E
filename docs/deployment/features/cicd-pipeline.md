# Feature: CI/CD Pipeline

**Owner:** Hossam Elsayed (235174)
**Priority:** Week 1-2
**Status:** Planned

---

## Overview

The CI/CD pipeline automates building, testing, scanning, and deploying F.R.A.M.E. services. GitHub Actions is the automation engine, with GitHub Advanced Security (GHAS) providing integrated security scanning. The pipeline enforces quality and security gates before any code reaches production.

---

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────┐
│                    GitHub Actions                     │
│                                                      │
│  ┌─────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │  Build   │  │  Test    │  │  Security Scan    │   │
│  │         │  │          │  │                   │   │
│  │ npm ci  │  │ Jest     │  │ CodeQL (SAST)     │   │
│  │ tsc     │  │ API test │  │ Secret Scanning   │   │
│  │ Docker  │  │ Lint     │  │ Dependency Audit  │   │
│  │ build   │  │          │  │ npm audit         │   │
│  └────┬────┘  └────┬─────┘  └────────┬──────────┘   │
│       │            │                  │              │
│       └────────────┴──────────────────┘              │
│                    │                                 │
│              All Gates Pass?                         │
│              ├─ No → Block merge                     │
│              └─ Yes ↓                                │
│         ┌──────────────────┐                         │
│         │  Deploy to       │                         │
│         │  Railway         │                         │
│         └──────────────────┘                         │
└─────────────────────────────────────────────────────┘
```

---

## Workflow Stages

### Stage 1: Build
- `npm ci` — clean install dependencies (lockfile integrity)
- `tsc --noEmit` — TypeScript type checking
- `docker build` — build container image
- **Gate:** build must succeed

### Stage 2: Test
- Unit tests (Jest)
- API endpoint tests
- Linting (ESLint)
- **Gate:** all tests must pass

### Stage 3: Security Scanning
- **CodeQL** — static analysis for vulnerability patterns
- **Secret scanning** — detect committed secrets (API keys, passwords)
- **Dependency audit** — `npm audit` for known vulnerabilities in dependencies
- **Gate:** no high/critical findings

### Stage 4: Deploy
- Triggered only on merge to `main`
- Railway auto-deploys from connected GitHub branch
- Health check after deployment
- Rollback if health check fails

---

## GitHub Actions Workflow Structure

```yaml
# Suggested workflow structure (not implementation)
name: CI/CD Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    # Build and type check
  test:
    needs: build
    # Run tests
  security:
    # GHAS scans (runs in parallel with test)
  deploy:
    needs: [build, test, security]
    if: github.ref == 'refs/heads/main'
    # Deploy to Railway
```

---

## Branch Protection Rules

| Rule | Setting |
|------|---------|
| Require PR for merge to main | Yes |
| Require at least 1 reviewer | Yes |
| Require status checks to pass | Yes (build, test, security) |
| Require up-to-date branch | Yes |
| Dismiss stale reviews on push | Yes |
| No force push to main | Yes |

---

## Security Considerations

1. **Least privilege on workflows** — GitHub Actions permissions set to minimum needed
2. **No secrets in workflow logs** — mask sensitive outputs
3. **Pin action versions** — use SHA hashes, not tags (prevent supply chain attacks)
4. **Separate deploy credentials** — Railway API token scoped to deploy only
5. **Approval required for production deploys** — manual gate for critical changes
6. **Audit workflow changes** — PR required for any `.github/workflows/` modification
