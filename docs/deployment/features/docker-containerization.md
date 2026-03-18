# Feature: Docker Containerization

**Owner:** Hossam Elsayed (235174)
**Priority:** Week 2
**Status:** Planned

---

## Overview

Docker ensures reproducible builds across development, staging, and production. Each F.R.A.M.E. service runs in its own container with minimal attack surface. Railway supports both Docker-based and Nixpacks-based deployments.

---

## Container Strategy

### Services to Containerize

| Service | Base Image | Purpose |
|---------|-----------|---------|
| Homeserver (Backend) | `node:20-alpine` | Express.js application server |
| Frontend | `node:20-alpine` (build) → `nginx:alpine` (serve) | React static build |

### Dockerfile Guidelines (Backend)

```dockerfile
# Multi-stage build (conceptual)
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Dockerfile Guidelines (Frontend)

```dockerfile
# Multi-stage build (conceptual)
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

---

## Container Hardening

| Measure | Implementation |
|---------|---------------|
| Non-root user | `USER appuser` — never run as root |
| Minimal base image | `alpine` variants — smaller attack surface |
| Multi-stage build | Build tools not in runtime image |
| No unnecessary packages | Only production dependencies |
| Read-only filesystem | Where possible (logs to stdout) |
| Health check | `HEALTHCHECK` instruction in Dockerfile |
| No secrets in image | All secrets via environment variables at runtime |

---

## Railway vs Docker

Railway supports two build strategies:

| Strategy | Pros | Cons |
|----------|------|------|
| **Nixpacks** (Railway default) | Auto-detects framework, zero config | Less control, may include unnecessary packages |
| **Docker** (custom Dockerfile) | Full control, reproducible, hardened | More setup, must maintain Dockerfile |

**Decision: Use Docker** — gives full control over build environment, allows hardening, reproducible across environments.

---

## Security Considerations

1. **Never embed secrets in Docker images** — use runtime environment variables
2. **Pin base image versions** — `node:20.11-alpine`, not `node:latest`
3. **Scan images for vulnerabilities** — use `docker scout` or Trivy in CI
4. **Minimize layers** — combine RUN commands where logical
5. **`.dockerignore`** — exclude `.env`, `.git`, `node_modules`, test files from build context
