# ── Stage 1: Builder ─────────────────────────────────────────
# Pinned to exact patch version — never :latest or :20-alpine (floating)
FROM node:20.14.0-alpine3.20 AS builder
WORKDIR /app

# Copy package manifests first for better layer caching
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY shared/tsconfig.json shared/
COPY shared/types/ shared/types/
COPY services/homeserver/package.json services/homeserver/
COPY services/homeserver/tsconfig.json services/homeserver/

# npm ci — uses lockfile for deterministic installs, NOT npm install
RUN npm ci --workspace=@frame/shared --workspace=@frame/homeserver

# Copy source after deps (avoids invalidating dep cache on code changes)
COPY shared/ shared/
COPY services/homeserver/src/ services/homeserver/src/
COPY services/homeserver/migrations/ services/homeserver/migrations/
COPY services/homeserver/migrate.sh services/homeserver/migrate.sh

# Build
RUN npm run build --workspace=@frame/shared
RUN npm run build --workspace=@frame/homeserver

# Prune dev dependencies from node_modules
RUN npm prune --omit=dev

# ── Stage 2: Production runtime ──────────────────────────────
FROM node:20.14.0-alpine3.20

# Non-root user — never run Node.js as root in production
RUN addgroup -g 1001 -S appgroup \
    && adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copy only compiled output + production deps from builder
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/shared/package.json shared/
COPY --from=builder --chown=appuser:appgroup /app/shared/dist/ shared/dist/
COPY --from=builder --chown=appuser:appgroup /app/services/homeserver/package.json services/homeserver/
COPY --from=builder --chown=appuser:appgroup /app/services/homeserver/dist/ services/homeserver/dist/
COPY --from=builder --chown=appuser:appgroup /app/services/homeserver/migrations/ services/homeserver/migrations/
COPY --from=builder --chown=appuser:appgroup /app/services/homeserver/migrate.sh services/homeserver/migrate.sh
COPY --from=builder --chown=appuser:appgroup /app/node_modules/ node_modules/

USER appuser
EXPOSE 3000

# Prevent unbounded memory growth crashing the container on Railway
ENV NODE_OPTIONS="--max-old-space-size=512"

# Docker-native health check (Railway also polls /health via API)
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/health || exit 1

# Run idempotent SQL migrations then start server
CMD ["sh", "-c", "echo '=== CONTAINER STARTING ===' && cd services/homeserver && echo '=== RUNNING MIGRATIONS ===' && sh migrate.sh && echo '=== STARTING NODE ===' && node dist/server.js"]
