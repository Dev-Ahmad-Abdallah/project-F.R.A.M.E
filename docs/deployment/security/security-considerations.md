# Infrastructure Security Considerations

**Owner:** Hossam Elsayed (235174)

---

## Implementation Guidelines

### CI/CD Pipeline

1. **Pin all GitHub Actions by SHA** — not by tag (tags can be moved)
   ```yaml
   # Good
   uses: actions/checkout@a5ac7e51b41094c92402da3b24376905380afc29  # v4.1.6
   # Bad
   uses: actions/checkout@v4
   ```
2. **Minimal workflow permissions** — set `permissions: read-all` at top, override per job
3. **No secrets in job outputs** — GitHub masks secret values, but be careful with derived values
4. **Separate deployment credentials** — Railway deploy token is not the same as admin token
5. **Audit workflow changes** — any modification to `.github/workflows/` requires review

### Container Security

1. **Non-root user in Dockerfile** — `USER appuser` after installing dependencies
2. **Alpine-based images** — smaller attack surface than full Debian/Ubuntu
3. **Multi-stage builds** — build tools (devDependencies) don't reach production image
4. **`.dockerignore`** — exclude: `.env`, `.git`, `node_modules`, `tests/`, `*.md`
5. **Pin base image versions** — `node:20.11.1-alpine3.19`, not `node:latest`
6. **Health check in Dockerfile** — `HEALTHCHECK CMD wget --spider http://localhost:3000/health`
7. **Scan images** — run `docker scout` or Trivy in CI pipeline

### Secrets Management

1. **GitHub Secrets for CI** — scoped to repository, encrypted at rest
2. **Railway env vars for runtime** — set per service, injected at deploy
3. **No `.env` files in production** — Railway injects env vars directly
4. **Rotate secrets on schedule** — JWT_SECRET every 90 days, federation keys every 180 days
5. **Emergency rotation procedure** — documented in secrets-management.md
6. **Pre-commit hooks for secret detection** — consider `detect-secrets` or `gitleaks`

### Network Security

1. **TLS 1.2+ on all connections** — Railway handles at edge for public traffic
2. **HSTS header** — `max-age=31536000; includeSubDomains`
3. **CSP header** — `default-src 'self'` minimum
4. **No mixed content** — all resources loaded over HTTPS
5. **Database connections encrypted** — `sslmode=require` for PostgreSQL
6. **Internal networking** — use Railway internal URLs between services

### Monitoring & Incident Response

1. **Health check endpoints** — Railway monitors and auto-restarts on failure
2. **Structured logging** — JSON to stdout, collected by Railway
3. **No sensitive data in logs** — mask tokens, keys, user data
4. **Alert thresholds defined** — CPU, memory, error rate, queue depth
5. **Incident playbook** — documented response procedures for common failures

---

## Railway-Specific Gotchas

| Issue | Description | Mitigation |
|-------|-------------|-----------|
| Cold starts | Hobby/free tier services may sleep | Add health check; accept latency on first request |
| Memory limits | Exceeding memory crashes the service | Set `--max-old-space-size` for Node.js |
| Build timeouts | Large Docker builds may timeout | Optimize Dockerfile, use multi-stage builds |
| Database connections | Managed DBs have connection limits | Use connection pooling (pg-pool) |
| Redis memory | Managed Redis has memory limits | Set `maxmemory-policy`, monitor usage |
| Nixpacks detection | May conflict with Dockerfile | If using Docker, ensure `Dockerfile` is in root |
| Environment variables | Not available at build time by default | Use Railway's build-time variables feature if needed |

---

## Pre-Deployment Checklist

### Every Deployment
- [ ] All CI checks pass (build, test, security scan)
- [ ] No secrets committed (GHAS secret scanning clean)
- [ ] No high/critical dependency vulnerabilities
- [ ] Health check endpoint returns 200
- [ ] Environment variables set correctly for target service
- [ ] Docker image builds successfully

### First Deployment
- [ ] Railway project created with correct services
- [ ] PostgreSQL and Redis provisioned
- [ ] Environment variables configured per service
- [ ] Custom domains configured (if applicable)
- [ ] Branch protection enabled on GitHub
- [ ] GHAS scanning enabled
- [ ] GitHub Secrets configured for Railway deploy token
- [ ] `.dockerignore` excludes sensitive files
- [ ] `Dockerfile` uses non-root user
- [ ] Health check endpoint implemented

### Federation Deployment
- [ ] Both homeservers deployed with unique domains
- [ ] Federation signing keys generated and configured
- [ ] Each homeserver knows its peer's domain
- [ ] Server discovery endpoint (`.well-known`) returns correct data
- [ ] TLS working on both homeserver domains
- [ ] Federation API endpoints accessible between servers

---

## Security Testing Checklist

- [ ] HTTPS enforced — HTTP requests redirected or rejected
- [ ] Security headers present (check with securityheaders.com)
- [ ] Rate limiting active on login and message endpoints
- [ ] Database not accessible from public internet
- [ ] Redis not accessible from public internet
- [ ] Docker containers running as non-root
- [ ] No secrets in Docker image layers (`docker history`)
- [ ] Health check doesn't expose sensitive information
- [ ] Error responses don't leak stack traces
- [ ] CORS configured correctly (only allows known origins)
