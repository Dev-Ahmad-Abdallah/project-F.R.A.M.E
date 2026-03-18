# Feature: Secrets Management

**Owner:** Hossam Elsayed (235174)
**Priority:** Week 1
**Status:** Planned

---

## Overview

Secrets (API keys, database credentials, JWT signing keys, federation keys) must be stored securely and never committed to source code. F.R.A.M.E. uses a two-tier approach: GitHub Secrets for CI/CD and Railway's config store for runtime.

---

## Secret Inventory

| Secret | Where Used | Storage |
|--------|-----------|---------|
| `JWT_SECRET` | Backend (token signing) | Railway env var |
| `DATABASE_URL` | Backend (PostgreSQL connection) | Railway auto-injected |
| `REDIS_URL` | Backend (Redis connection) | Railway auto-injected |
| `FEDERATION_SIGNING_KEY` | Backend (server identity) | Railway env var |
| `RAILWAY_TOKEN` | CI/CD (deploy trigger) | GitHub Secrets |
| `GITHUB_TOKEN` | CI/CD (GHAS, PR checks) | GitHub auto-injected |
| `BCRYPT_SALT_ROUNDS` | Backend (password hashing) | Railway env var (or hardcoded constant) |

---

## Storage Tiers

### Tier 1: GitHub Secrets (CI/CD Time)
- Encrypted at rest by GitHub
- Accessible only to GitHub Actions workflows
- Scoped per repository or per environment
- Used for: deploy tokens, CI-only credentials

### Tier 2: Railway Config Store (Runtime)
- Set via Railway dashboard or CLI
- Injected as environment variables at deploy time
- Scoped per service
- Used for: database URLs, JWT secrets, federation keys

### Tier 3: Railway Auto-Injected (Managed Services)
- `DATABASE_URL`, `REDIS_URL` automatically set when linking managed databases
- No manual management needed
- Rotated by Railway when database is recreated

---

## Rules

1. **Never commit secrets to source code** — not in `.env` files, not in config files, not in comments
2. **Use `.env.example`** — template with placeholder values, no real secrets
3. **`.gitignore` must include** — `.env`, `.env.local`, `.env.production`
4. **GitHub secret scanning** — GHAS detects accidentally committed secrets
5. **Rotate secrets periodically** — especially JWT_SECRET and federation keys
6. **Principle of least privilege** — each service only gets the secrets it needs
7. **Short-lived credentials preferred** — where possible (Railway DB URLs are persistent)

---

## Secret Rotation Plan

| Secret | Rotation Frequency | Procedure |
|--------|--------------------|-----------|
| JWT_SECRET | Every 90 days | Update in Railway → redeploy → old tokens invalidate |
| FEDERATION_SIGNING_KEY | Every 180 days | Generate new key → publish old key for verification period → update |
| RAILWAY_TOKEN | On team member change | Regenerate in Railway dashboard → update GitHub Secrets |
| Database passwords | On Railway DB recreation | Auto-rotated by Railway |

---

## Emergency Procedures

### Secret Compromised
```
1. Identify which secret was exposed
2. Rotate the secret immediately
   - Railway: update env var → redeploy
   - GitHub: update secret in repository settings
3. Audit access logs for unauthorized use
4. If JWT_SECRET: all user sessions invalidated (acceptable trade-off)
5. If FEDERATION_SIGNING_KEY: notify peer servers
6. Post-mortem: how was it exposed? Prevent recurrence
```

---

## Security Considerations

1. **GHAS secret scanning** — enabled on all branches and PRs
2. **Pre-commit hooks** — consider adding local secret detection (e.g., detect-secrets)
3. **No secrets in Docker images** — all injected at runtime via env vars
4. **No secrets in CI logs** — GitHub Actions masks secret values automatically
5. **Environment separation** — different secrets for staging vs production (if applicable)
