# Infrastructure Security Model

**Owner:** Hossam Elsayed (235174)

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    DEVELOPMENT ENVIRONMENT                   │
│                                                              │
│  Developer Machines → GitHub (Source Code + Secrets)          │
│                                                              │
│  Trust Boundary: Developer authentication (SSH keys / PAT)   │
└──────────────────────────┬───────────────────────────────────┘
                           │
                    Push / PR Merge
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                    CI/CD PIPELINE (GitHub Actions)            │
│                                                              │
│  Has access to: source code, GitHub Secrets, deploy tokens   │
│  Should NOT have: production database access, user data      │
│                                                              │
│  Trust Boundary: Workflow permissions, secret scoping         │
└──────────────────────────┬───────────────────────────────────┘
                           │
                    Deploy Trigger
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                    RAILWAY PLATFORM (Production)             │
│                                                              │
│  Has access to: container runtime, env vars, databases       │
│  Should NOT have: source code (only build artifacts)         │
│                                                              │
│  Trust Boundary: Railway auth, service isolation, network    │
└──────────────────────────────────────────────────────────────┘
```

---

## Threat Model

### CI/CD Pipeline Threats

| Threat | Attack Vector | Severity | Mitigation |
|--------|--------------|----------|-----------|
| Pipeline compromise | Malicious PR modifies workflow | Critical | Branch protection, require reviews for workflow changes |
| Secret exfiltration | Workflow leaks secrets to logs | Critical | GitHub auto-masks secrets; audit workflow outputs |
| Supply chain attack | Compromised GitHub Action | High | Pin actions by SHA hash, not tag |
| Dependency poisoning | Malicious npm package | High | `npm audit`, GHAS dependency scanning |
| Unauthorized deploy | Attacker triggers deploy without review | High | Require PR review + status checks before merge |

### Infrastructure Threats

| Threat | Attack Vector | Severity | Mitigation |
|--------|--------------|----------|-----------|
| Secret exposure | Hardcoded secrets in code | Critical | GHAS secret scanning, `.gitignore`, `.env.example` |
| Container escape | Vulnerable container runtime | High | Railway manages isolation; use non-root user |
| Database exposure | Public database endpoint | Critical | Railway databases accessible only internally |
| DDoS | Flood public endpoints | High | Railway rate limiting, application-level rate limiting |
| Man-in-the-middle | Intercept internal traffic | High | TLS everywhere, Railway internal networking |

### Runtime Threats

| Threat | Attack Vector | Severity | Mitigation |
|--------|--------------|----------|-----------|
| Log poisoning | Inject malicious data via log entries | Medium | Structured logging, sanitize user input in logs |
| Resource exhaustion | Memory leak or CPU spike | Medium | Railway resource limits, health checks, auto-restart |
| Misconfiguration | Wrong env vars in production | High | Environment separation, deployment checklist |
| Unauthorized access | Admin panel exposed | Critical | No admin interfaces exposed publicly |

---

## Defense Layers

```
Layer 1: Source Code Security
  - Branch protection, PR reviews, GHAS scanning
  - Prevents: malicious code, committed secrets

Layer 2: Build Pipeline Security
  - Pinned dependencies, locked lockfiles, security scans
  - Prevents: supply chain attacks, vulnerable dependencies

Layer 3: Container Security
  - Non-root user, minimal base image, multi-stage builds
  - Prevents: container escape, unnecessary attack surface

Layer 4: Network Security
  - TLS everywhere, HSTS, security headers
  - Prevents: eavesdropping, MITM, clickjacking

Layer 5: Runtime Security
  - Rate limiting, health checks, monitoring
  - Prevents: DDoS, service degradation, undetected failures

Layer 6: Data Security
  - Encrypted connections to databases, no public DB access
  - Prevents: data exfiltration, unauthorized access
```

---

## Compliance & Governance

| Practice | Implementation |
|----------|---------------|
| Code review required | Branch protection on main |
| Security scanning | GHAS on every PR |
| Secrets never in code | Secret scanning + `.gitignore` |
| Audit trail | Git history + Railway deploy logs |
| Least privilege | Scoped GitHub tokens, minimal workflow permissions |
| Incident response | Secret rotation procedures documented |
